import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {NightPillarTask,PERCH_PINNED_S,PERCH_RETRY_S} from '../src/chains/fallbackTasks.js';
import {MobDefenseChain} from '../src/chains/mobDefenseChain.js';
console.error=()=>{};

// Round 105: the round-104 hard1 perch. Perched 3 up at tod ~9950 with the ring and the walls laid,
// it held to the end of the run (1921 s) - morning never cleared it, and the run got no furnace or iron.
const k=(x,y,z)=>x+','+y+','+z;
const SIDES=[[1,0],[-1,0],[0,1],[0,-1]];
// The finished perch: ground at y=-61, the column at (0,-60..-58,0), the ring at y=-58, the walls at -57/-56.
function perchWorld(){
 const cells=new Map();
 for(let x=-8;x<=8;x++)for(let z=-8;z<=8;z++)cells.set(k(x,-61,z),'grass_block');
 for(let y=-60;y<=-58;y++)cells.set(k(0,y,0),'cobblestone');
 for(const [dx,dz] of [...SIDES,[1,1],[1,-1],[-1,1],[-1,-1]])cells.set(k(dx,-58,dz),'cobblestone');
 for(const y of [-57,-56])for(const [dx,dz] of SIDES)cells.set(k(dx,y,dz),'cobblestone');
 const at=p=>{const x=Math.floor(p.x),y=Math.floor(p.y),z=Math.floor(p.z),name=cells.get(k(x,y,z))||'air';return {name,position:new Vec3(x,y,z),boundingBox:name==='air'?'empty':'block'};};
 return {cells,at};
}
function perchBot(world,{hostiles=[],tod=1500,items=[{name:'cobblestone',count:12},{name:'stone_pickaxe',count:1}]}={}){
 const inv=items.map((i,n)=>({...i,slot:36+n})),calls=[];
 const bot={
  health:20,food:20,time:{timeOfDay:tod,day:3},
  entity:{id:1,position:new Vec3(0.5,-57,0.5),onGround:true,yaw:0,height:1.8,metadata:[0]},
  entities:{},heldItem:null,
  inventory:{items:()=>inv,slots:[]},
  registry:{blocksByName:{dirt:{id:1}},itemsByName:{},foodsByName:{}},
  blockAt:p=>world.at(p),
  setControlState:(n,v)=>calls.push(['control',n,v]),
  look:async()=>{},
  equip:async item=>{calls.push(['equip',item.name]);bot.heldItem=item;},
  placeBlock:async(ref,face)=>{const t=ref.position.plus(face);calls.push(['place',k(t.x,t.y,t.z)]);world.cells.set(k(t.x,t.y,t.z),'cobblestone');},
  dig:async b=>{calls.push(['dig',k(b.position.x,b.position.y,b.position.z)]);world.cells.delete(k(b.position.x,b.position.y,b.position.z));},
  activateItem:()=>{},deactivateItem:()=>{},attack:()=>{}
 };
 hostiles.forEach((h,i)=>{bot.entities[10+i]={id:10+i,type:'hostile',isValid:true,height:1.9,...h,position:new Vec3(...h.position)};});
 return {bot,calls};
}
function perch(bot,logs,{hold=false,day=false}={}){
 const t=new NightPillarTask(3,{hold,day});
 Object.assign(t,{phase:'perch',base:{x:0,y:-60,z:0},ringLogged:true,wallsLogged:true});
 let clock=1000;t.now=()=>clock;
 const ctx={worker:{log:m=>logs.push(m)}};
 return {t,ctx,tick:(s=0)=>{clock+=s;t.onTick(bot,ctx);},flush:()=>new Promise(r=>setImmediate(r))};
}
// the round-104 shape: a zombie and a creeper at the column's foot, in the ring's shade
const UNDER=[{name:'zombie',position:[1.5,-60,0.5]},{name:'creeper',position:[0.5,-60,1.5]}];

test('round 105: a perch held past dawn by mobs in the ring\'s shade opens the wall away from them and comes down',async()=>{
 const world=perchWorld(),logs=[];
 const {bot,calls}=perchBot(world,{hostiles:UNDER});
 const {t,ctx,tick,flush}=perch(bot,logs);
 tick();
 assert.deepEqual(logs,['Night: held on the perch past dawn by zombie 3.2 dy -3 under cover, creeper 3.2 dy -3 under cover']);
 tick(PERCH_PINNED_S-1);
 assert.equal(logs.length,1,'not yet pinned');
 assert.equal(t.isFinished(bot,ctx),false);
 tick(2);
 assert.equal(logs.length,2,logs.join('|'));
 assert.match(logs[1],/^Night: pinned on the perch 31 s past dawn by zombie 3\.2 dy -3 under cover, creeper 3\.2 dy -3 under cover; opening the west wall and coming down$/);
 for(let i=0;i<10&&!t.isFinished(bot,ctx);i++){t._equipAt=-1e9;tick(0.1);await flush();}
 assert.ok(calls.some(c=>c[0]==='equip'&&c[1]==='stone_pickaxe'),'the pick for the wall');
 assert.deepEqual(calls.filter(c=>c[0]==='dig').map(c=>c[1]),[k(-1,-56,0),k(-1,-57,0)],'head, then feet, on the west side');
 assert.equal(t.isFinished(bot,ctx),true);
 assert.equal(calls.filter(c=>c[0]==='place').length,0,'no wall goes back up');
 for(const [dx,dz] of SIDES.slice(0)) if(dx!==-1)assert.equal(world.at({x:dx,y:-57,z:dz}).name,'cobblestone','the other walls stand');
 // a runner teardown keeps the pinned state
 const q=t.resumeCopy();assert.equal(q.pinned,true);assert.equal(q.opened,true);
});
test('round 105: a mob the sun will clear keeps the old hold; a dark morning and a day pillar never pin',async()=>{
 // a zombie in the open: it will burn, so the perch waits as before
 {const world=perchWorld(),logs=[];
  const {bot,calls}=perchBot(world,{hostiles:[{name:'zombie',position:[6.5,-60,0.5]}]});
  const {t,ctx,tick}=perch(bot,logs);
  tick();tick(60);tick(60);
  assert.deepEqual(logs,['Night: held on the perch past dawn by zombie 6.7 dy -3 in the open']);
  assert.equal(t.isFinished(bot,ctx),false);assert.equal(calls.filter(c=>c[0]==='dig').length,0);}
 // still night (tod 500, before MORNING_SAFE): nothing logged, nothing opened
 {const world=perchWorld(),logs=[];
  const {bot,calls}=perchBot(world,{hostiles:UNDER,tod:500});
  const {t,ctx,tick}=perch(bot,logs);
  tick();tick(60);tick(60);
  assert.deepEqual(logs,[]);assert.equal(t.isFinished(bot,ctx),false);assert.equal(calls.filter(c=>c[0]==='dig').length,0);}
 // a day pillar keeps its own rule (down once quiet)
 {const world=perchWorld(),logs=[];
  const {bot,calls}=perchBot(world,{hostiles:UNDER});
  const {tick}=perch(bot,logs,{day:true});
  tick();tick(60);tick(60);
  assert.deepEqual(logs,[]);assert.equal(calls.filter(c=>c[0]==='dig').length,0);}
});
test('round 105: past MORNING_LATE only the holders within 6 count; a held hold pillar pins the same way',async()=>{
 const world=perchWorld(),logs=[];
 // a creeper under the ring, and a zombie 9 away in the open that no longer holds by tod 3500
 const {bot,calls}=perchBot(world,{hostiles:[{name:'creeper',position:[0.5,-60,-0.5]},{name:'zombie',position:[9.5,-60,0.5]}],tod:3500});
 const {t,ctx,tick,flush}=perch(bot,logs,{hold:true});
 tick();tick(PERCH_PINNED_S);
 assert.equal(logs[0],'Night: held on the perch past dawn by creeper 3.2 dy -3 under cover');
 assert.match(logs[1]||'',/^Night: pinned on the perch 30 s past dawn by creeper 3\.2 dy -3 under cover; opening the south wall and coming down$/);
 for(let i=0;i<10&&!t.isFinished(bot,ctx);i++){t._equipAt=-1e9;tick(0.1);await flush();}
 assert.deepEqual(calls.filter(c=>c[0]==='dig').map(c=>c[1]),[k(0,-56,1),k(0,-57,1)]);
});
test('round 105: an opening that cannot finish still ends the perch after PERCH_OPEN_S',()=>{
 const world=perchWorld(),logs=[];
 const {bot}=perchBot(world,{hostiles:UNDER});
 bot.dig=()=>new Promise(()=>{}); // never lands
 const {t,ctx,tick}=perch(bot,logs);
 tick();tick(PERCH_PINNED_S+1);t._equipAt=-1e9;tick(0.1);tick(0.1);
 assert.equal(t.isFinished(bot,ctx),false);
 tick(25);
 assert.equal(t.isFinished(bot,ctx),true);
});
test('round 105: Mob Defense does not climb straight back up after a pinned perch',async()=>{
 const world=perchWorld(),logs=[];
 // a day crowd of 6 within 16 plans a day pillar on the open deck
 // (none within 1.2 of the column: a mob touching it blocks any pillar plan)
 const crowd=[[3,0],[-3,0],[0,3],[0,-3],[3,3],[-3,-3]].map(([x,z])=>({name:'zombie',position:[x+0.5,-60,z+0.5]}));
 const {bot}=perchBot(world,{hostiles:crowd});
 const ctx={config:{chains:{}},move:{},trackers:{},blacklist:{},worker:{log:m=>logs.push(m)}};
 const m=new MobDefenseChain();let clock=5000;m.now=()=>clock;
 const fresh=new MobDefenseChain();fresh.now=()=>clock;
 fresh.priority(bot,ctx);
 assert.ok(fresh.root instanceof NightPillarTask,'without the pinned perch the crowd gets a day pillar');
 const t=new NightPillarTask(3);Object.assign(t,{phase:'perch',base:{x:0,y:-60,z:0},pinned:true,opened:true,exit:{dx:-1,dz:0,at:0}});
 m._pillar=t;
 m.priority(bot,ctx);
 assert.ok(!(m.root instanceof NightPillarTask),'no new pillar on the deck');
 assert.equal(m._pillar,null);
 clock+=PERCH_RETRY_S+1;
 m.priority(bot,ctx);
 assert.ok(m.root instanceof NightPillarTask,'the backoff runs out');
});
