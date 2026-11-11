import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {NightPillarTask,PERCH_DAY_S,PERCH_PINNED_S} from '../src/chains/fallbackTasks.js';
console.error=()=>{};

// Round 118: the round-117 hard3 stall - a day crowd of 7 at tod ~1300 put the bot on a day perch
// over the mob cave it had just climbed out of; a day perch came down only after 15 s with no
// hostile within 16, the cave's mobs 5-14 below in the rock never left, and the bot stood on the
// perch from t=904 to the end of the run (1506 s; the queued craft never ran, no furnace, no iron).
// A day perch held PERCH_DAY_S by hostiles the sun will not clear opens the wall away from them.
const k=(x,y,z)=>x+','+y+','+z;
const SIDES=[[1,0],[-1,0],[0,1],[0,-1]];
// the finished perch on solid ground (y=-61 and the rock under it), the column at (0,-60..-58,0),
// the ring at -58, the walls at -57/-56; a cave cut into the rock east of the column at y=-67..-66
function world(){
 const cells=new Map();
 for(let x=-8;x<=8;x++)for(let z=-8;z<=8;z++)for(let y=-70;y<=-61;y++)cells.set(k(x,y,z),y===-61?'grass_block':'stone');
 for(let x=3;x<=7;x++)for(let z=-1;z<=3;z++)for(const y of [-67,-66])cells.delete(k(x,y,z));
 for(let y=-60;y<=-58;y++)cells.set(k(0,y,0),'cobblestone');
 for(const [dx,dz] of [...SIDES,[1,1],[1,-1],[-1,1],[-1,-1]])cells.set(k(dx,-58,dz),'cobblestone');
 for(const y of [-57,-56])for(const [dx,dz] of SIDES)cells.set(k(dx,y,dz),'cobblestone');
 const at=p=>{const x=Math.floor(p.x),y=Math.floor(p.y),z=Math.floor(p.z),name=cells.get(k(x,y,z))||'air';return {name,position:new Vec3(x,y,z),boundingBox:name==='air'?'empty':'block'};};
 return {cells,at};
}
function setup({hostiles,tod=1300,day=true}){
 const w=world(),logs=[],calls=[];
 const inv=[{name:'cobblestone',count:12,slot:36},{name:'stone_pickaxe',count:1,slot:37}];
 const bot={health:17,food:16,time:{timeOfDay:tod,day:3},
  entity:{id:1,position:new Vec3(0.5,-57,0.5),onGround:true,yaw:0,height:1.8,metadata:[0]},entities:{},heldItem:null,
  inventory:{items:()=>inv,slots:[]},registry:{blocksByName:{dirt:{id:1}},itemsByName:{},foodsByName:{}},
  blockAt:p=>w.at(p),setControlState:()=>{},look:async()=>{},
  equip:async item=>{calls.push(['equip',item.name]);bot.heldItem=item;},
  placeBlock:async(ref,face)=>{const t=ref.position.plus(face);calls.push(['place',k(t.x,t.y,t.z)]);w.cells.set(k(t.x,t.y,t.z),'cobblestone');},
  dig:async b=>{calls.push(['dig',k(b.position.x,b.position.y,b.position.z)]);w.cells.delete(k(b.position.x,b.position.y,b.position.z));},
  activateItem:()=>{},deactivateItem:()=>{},attack:()=>{}};
 hostiles.forEach((h,i)=>{bot.entities[10+i]={id:10+i,type:'hostile',isValid:true,height:1.9,...h,position:new Vec3(...h.position)};});
 const t=new NightPillarTask(3,{day});
 Object.assign(t,{phase:'perch',base:{x:0,y:-60,z:0},ringLogged:true,wallsLogged:true});
 let clock=1000;t.now=()=>clock;
 const ctx={worker:{log:m=>logs.push(m)}};
 return {w,t,bot,ctx,logs,calls,tick:(s=0)=>{clock+=s;t.onTick(bot,ctx);},flush:()=>new Promise(r=>setImmediate(r))};
}
// the round-117 shape: mobs in the cave under the rock, 9-12 from the deck and 9-10 below it
const CAVE=[{name:'zombie',position:[4.5,-66,0.5]},{name:'skeleton',position:[6.5,-67,2.5]},{name:'creeper',position:[5.5,-66,-0.5]}];

test('round 118: a day perch held a minute by mobs in the cave under it opens the far wall and comes down',async()=>{
 assert.equal(PERCH_DAY_S,60);
 const s=setup({hostiles:CAVE});
 s.tick();
 assert.deepEqual(s.logs,['Night: held on the day perch by zombie 9.8 dy -9 under cover, creeper 10.3 dy -9 under cover, skeleton 11.8 dy -10 under cover']);
 s.tick(PERCH_PINNED_S+1);s.tick(PERCH_DAY_S-PERCH_PINNED_S-2);
 assert.equal(s.logs.length,1,'59 s: the old quiet rule still waits');
 assert.equal(s.t.isFinished(s.bot,s.ctx),false);
 s.tick(2);
 assert.equal(s.logs[1],'Night: pinned on the day perch 61 s by zombie 9.8 dy -9 under cover, creeper 10.3 dy -9 under cover, skeleton 11.8 dy -10 under cover; opening the west wall and coming down');
 for(let i=0;i<10&&!s.t.isFinished(s.bot,s.ctx);i++){s.t._equipAt=-1e9;s.tick(0.1);await s.flush();}
 assert.ok(s.calls.some(c=>c[0]==='equip'&&c[1]==='stone_pickaxe'));
 assert.deepEqual(s.calls.filter(c=>c[0]==='dig').map(c=>c[1]),[k(-1,-56,0),k(-1,-57,0)],'head, then feet, away from the cave');
 assert.equal(s.t.isFinished(s.bot,s.ctx),true);
 assert.equal(s.calls.filter(c=>c[0]==='place').length,0,'no wall goes back up');
 // a runner teardown keeps the hold clock and the pinned state (Mob Defense's PERCH_RETRY_S applies)
 const q=s.t.resumeCopy();assert.equal(q.day,true);assert.equal(q.pinned,true);assert.equal(q.opened,true);
});

test('round 118: a mob the sun will clear, a quiet perch and the night keep the day perch\'s old rules',async()=>{
 // a zombie in the open 7 away: it burns by day, so the perch waits for it
 {const s=setup({hostiles:[{name:'zombie',position:[6.5,-60,0.5]}]});
  s.tick();s.tick(90);s.tick(90);
  assert.deepEqual(s.logs,['Night: held on the day perch by zombie 6.7 dy -3 in the open']);
  assert.equal(s.t.isFinished(s.bot,s.ctx),false);assert.equal(s.calls.filter(c=>c[0]==='dig').length,0);}
 // nothing within 16: no line, down after 15 quiet seconds as before
 {const s=setup({hostiles:[{name:'zombie',position:[0.5,-66,17.5]}]});
  s.tick();s.tick(16);s.tick();
  assert.deepEqual(s.logs,[]);assert.equal(s.t.isFinished(s.bot,s.ctx),true);}
 // the day perch held into the night (tod 14000): it is the night's refuge, nothing opens
 {const s=setup({hostiles:CAVE,tod:14000});
  s.tick();s.tick(120);s.tick(120);
  assert.deepEqual(s.logs,[]);assert.equal(s.t.isFinished(s.bot,s.ctx),false);assert.equal(s.calls.filter(c=>c[0]==='dig').length,0);
  // at the next light morning the cave still holds it: a minute on, it opens
  s.bot.time.timeOfDay=1200;s.tick();s.tick(PERCH_DAY_S+1);
  assert.match(s.logs.at(-1),/^Night: pinned on the day perch 61 s by .*; opening the west wall and coming down$/);}
 // a night perch past dawn keeps round 105's 30 s and its wording
 {const s=setup({hostiles:CAVE,day:false});
  s.tick();s.tick(PERCH_PINNED_S+1);
  assert.match(s.logs[0],/^Night: held on the perch past dawn by zombie 9\.8 dy -9 under cover/);
  assert.match(s.logs[1],/^Night: pinned on the perch 31 s past dawn by .*; opening the west wall and coming down$/);}
});
