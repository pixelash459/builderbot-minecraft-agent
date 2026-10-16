// Cloud round 6, task 1: round-5 hard1/hard2 ran `[night] shelter` for 11 minutes without a
// `Shelter: sealed` line until the soak bell cancelled it. The job demanded 26 spare blocks
// wherever it stood and its dirt loop re-walked the same unreachable block forever. Now it
// needs only the open shell cells, digs for at most SHELTER_DIG_MS with every spot tried once,
// seals within SHELTER_SEAL_MS, and otherwise fails with the reason into the night pillar.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Vec3} from 'vec3';
import {Worker,SHELTER_DIG_MS,SHELTER_SEAL_MS} from '../src/worker.js';
import {Autopilot,NIGHT_RETRIES} from '../src/autopilot.js';
import {MobDefenseChain} from '../src/chains/mobDefenseChain.js';
import {NightPillarTask} from '../src/chains/fallbackTasks.js';
import {nightRefuge,shelterShell,shellGaps} from '../src/night.js';
console.error=()=>{};
const k=(x,y,z)=>x+','+y+','+z;
function makeWorld(fill){
 const cells=new Map();
 const set=(x,y,z,name)=>cells.set(k(x,y,z),name);
 fill(set);
 const blockAt=(x,y,z)=>{
  const name=cells.get(k(x,y,z))||'air';
  return {name,position:new Vec3(x,y,z),boundingBox:/^(air|water|lava|.*_mushroom|poppy)$/.test(name)?'empty':'block'};
 };
 return {cells,set,blockAt,at:p=>blockAt(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z))};
}
const flat=()=>makeWorld(set=>{for(let x=-8;x<=8;x++)for(let z=-8;z<=8;z++)set(x,-61,z,'grass_block');});
// A 1x2 stone tunnel: solid stone all round except the bot's two cells.
const tunnel=()=>makeWorld(set=>{for(let x=-3;x<=3;x++)for(let y=-63;y<=-57;y++)for(let z=-3;z<=3;z++)if(!(x===0&&z===0&&(y===-60||y===-59)))set(x,y,z,'stone');});
// Fake clock: Date.now() advances only when the fake world spends time.
function clock(){const real=Date.now,base=real();let off=0;Date.now=()=>base+off;return {spend(ms){off+=ms;},restore(){Date.now=real;}};}
function shelterWorker(world,{items=[{name:'cobblestone',count:40}],tod=12100,reserve=0,walk,place,spots}={}){
 const placed=[],logs=[],walks=[];
 const inv=items.map((i,n)=>({...i,slot:36+n}));
 const bot={
  time:{timeOfDay:tod,day:3},entity:{position:new Vec3(0.5,-60,0.5),height:1.8},entities:{},heldItem:null,health:20,food:20,
  registry:{itemsByName:{},blocksByName:{dirt:{id:1},grass_block:{id:2}}},
  inventory:{items:()=>inv.filter(i=>i.count>0)},
  blockAt:p=>world.at(p),
  findBlocks:()=>(spots||[]).map(p=>new Vec3(p.x,p.y,p.z)),
  canDigBlock:()=>true,tool:{equipForBlock:async()=>{}},
  equip:async item=>{bot.heldItem=item;},
  placeBlock:place||(async(ref,face)=>{
   const t=ref.position.plus(face);
   const item=inv.find(i=>i.name===bot.heldItem?.name&&i.count>0);
   if(!item)throw Error('nothing held');
   world.set(t.x,t.y,t.z,item.name);item.count--;placed.push(k(t.x,t.y,t.z));
  }),
  lookAt:async()=>{},attack:async()=>{},
  dig:async bl=>{world.set(bl.position.x,bl.position.y,bl.position.z,'air');const d=inv.find(i=>i.name==='dirt');if(d)d.count++;else inv.push({name:'dirt',count:1,slot:44});}
 };
 const w=Object.assign(Object.create(Worker.prototype),{bot,cobbleReserve:reserve,deadline:Infinity,survivalJob:true,epoch:0,ready:true,config:{limits:{}},
  log:m=>logs.push(m),save(){},update(){},check(){},sweepDrops:async()=>{},
  walk:walk||(async p=>{walks.push(k(p.x,p.y,p.z));})});
 return {w,bot,placed,logs,walks,inv};
}
test('in a stone tunnel the shelter needs 2 blocks, not 26: it seals at once with kit cobble held',async()=>{
 const world=tunnel();
 // hard1's end inventory: 19 cobble, 14 of it reserved for the unfinished kit.
 const {w,placed,walks,logs}=shelterWorker(world,{items:[{name:'cobblestone',count:19}],reserve:14,spots:[{x:5,y:-61,z:5}]});
 world.set(0,-58,0,'air'); // the tunnel's open stair cell above the head
 world.set(1,-60,0,'air');world.set(1,-59,0,'air'); // and the stair step beside the bot
 assert.equal(w.shelterNeed(new Vec3(0,-60,0)),3);
 const job={spec:{type:'shelter'}};
 // tod wraps to morning after the first guard tick so the job ends.
 const realGuard=w.guardShelter;w.guardShelter=async function(...a){this.bot.time.timeOfDay=1500;return realGuard.apply(this,a);};
 await w.shelter(job,0);
 assert.deepEqual(walks,[],'no dirt walk: 5 spare cobble cover the 3 open cells');
 assert.equal(placed.length,3);
 assert.ok(logs.some(m=>/^Shelter: sealed at .* \(3 blocks placed\)/.test(m)));
});
test('one unreachable dirt block is tried once, not for 11 minutes: the job fails into the night pillar',async()=>{
 const world=flat(),c=clock();
 try{
  let tries=0;
  const {w}=shelterWorker(world,{items:[{name:'cobblestone',count:5}],spots:[{x:6,y:-61,z:6}],
   walk:async()=>{tries++;c.spend(15000);throw Error('No path to the goal!');}});
  const job={spec:{type:'shelter'}};
  await assert.rejects(w.shelter(job,0),/^Error: Short of shelter blocks: 5 held, 25 needed at \(0, -60, 0\); night pillar instead/);
  assert.equal(tries,1,'the same block is never walked to twice');
  assert.equal(w.nightPillarWanted(),true);
 }finally{c.restore();}
});
test('digging for shelter dirt stops at SHELTER_DIG_MS even with endless unreachable spots',async()=>{
 const world=flat(),c=clock();
 try{
  const spots=Array.from({length:60},(_,i)=>({x:-8+(i%16),y:-61,z:-8+Math.floor(i/16)}));
  let tries=0;
  const {w}=shelterWorker(world,{items:[],spots,walk:async()=>{tries++;c.spend(10000);throw Error('Navigation timed out');}});
  await assert.rejects(w.shelter({spec:{type:'shelter'}},0),/Short of shelter blocks: 0 held, 25 needed/);
  assert.ok(tries<=Math.ceil(SHELTER_DIG_MS/10000)+1,'bounded by the dig budget ('+tries+' walks)');
 }finally{c.restore();}
});
test('short on blocks, reachable dirt is dug and the box seals (reserved cobble only as the last resort)',async()=>{
 const world=flat();
 const spots=Array.from({length:30},(_,i)=>({x:-8+(i%16),y:-61,z:5+Math.floor(i/16)}));
 const {w,logs,inv}=shelterWorker(world,{items:[{name:'cobblestone',count:19}],reserve:14,spots});
 const realGuard=w.guardShelter;w.guardShelter=async function(...a){this.bot.time.timeOfDay=1500;return realGuard.apply(this,a);};
 w.removeShelter=async()=>{};
 await w.shelter({spec:{type:'shelter'}},0);
 assert.ok(logs.some(m=>/^Shelter: sealed/.test(m)));
 assert.equal(inv.find(i=>i.name==='cobblestone').count,14,'the kit cobble stayed in the inventory');
});
test('a seal that cannot finish in SHELTER_SEAL_MS fails with the reason into the night pillar',async()=>{
 const world=flat(),c=clock();
 try{
  // Every placement takes 4 s and silently fails (lag, a ghost block).
  const {w}=shelterWorker(world,{place:async()=>{c.spend(4000);}});
  await assert.rejects(w.shelter({spec:{type:'shelter'}},0),new RegExp('Could not seal the shelter in '+SHELTER_SEAL_MS/1000+' s: 25 open cells.*night pillar instead'));
  assert.equal(w.nightPillarWanted(),true);
  w.bot.time.timeOfDay=500;
  assert.equal(w.nightPillarWanted(),false,'morning ends the fallback');
 }finally{c.restore();}
});
test('a Stop mid-seal is not a shelter failure: no night pillar',async()=>{
 const world=flat();
 const {w}=shelterWorker(world);
 let n=0;w.check=()=>{if(++n>5)throw Error('Job interrupted');};
 await assert.rejects(w.shelter({spec:{type:'shelter'}},0),/Job interrupted/);
 assert.equal(w.nightPillarWanted(),false);
});
// ---- the fallback pillar --------------------------------------------------------------------
test('nightRefuge forced: climb with no mob in sight, and hold until morning',()=>{
 const me={x:0.5,y:-60,z:0.5};
 assert.equal(nightRefuge({tod:14000,me,hostiles:[],blocks:10,room:3}),null,'no shelter failure: no pillar without a crowd');
 assert.deepEqual(nightRefuge({tod:14000,me,hostiles:[],blocks:10,room:3,forced:true}),{action:'pillar',height:3,crowd:0,hold:true});
 assert.equal(nightRefuge({tod:14000,me,hostiles:[],blocks:2,room:3,forced:true}),null,'2 blocks are not a pillar');
 assert.equal(nightRefuge({tod:3000,me,hostiles:[],blocks:10,room:3,forced:true}),null,'day');
});
test('Mob Defense starts the holding pillar once the shelter failed, and the perch outlasts a quiet spell',()=>{
 const world=flat();
 const inv=[{name:'cobblestone',count:5,slot:36}];
 const bot={health:20,food:20,time:{timeOfDay:14000,day:3},entity:{id:1,position:new Vec3(0.5,-60,0.5),onGround:true,yaw:0,height:1.8,metadata:[0]},
  entities:{},heldItem:null,inventory:{items:()=>inv,slots:[]},registry:{blocksByName:{},itemsByName:{},foodsByName:{}},blockAt:p=>world.at(p),
  setControlState(){},look:async()=>{},equip:async i=>{bot.heldItem=i;},placeBlock:async()=>{}};
 const worker={wanted:false,nightPillarWanted(){return this.wanted;},log(){}};
 const ctx={config:{chains:{}},move:{},trackers:{},blacklist:{},worker};
 const m=new MobDefenseChain();
 m.priority(bot,ctx);
 assert.ok(!(m.root instanceof NightPillarTask),'nothing hostile and no failure: no pillar');
 worker.wanted=true;
 const m2=new MobDefenseChain();
 assert.equal(m2.priority(bot,ctx),72);
 assert.ok(m2.root instanceof NightPillarTask&&m2.root.hold);
 const t=m2.root;t.phase='perch';t.quietSince=t.now()-60;
 assert.equal(t.isFinished(bot),false,'a fallback pillar is not left after 15 quiet seconds');
 assert.equal(t.resumeCopy().hold,true);
 const crowdPillar=new NightPillarTask(3);crowdPillar.phase='perch';crowdPillar.quietSince=crowdPillar.now()-60;
 assert.equal(crowdPillar.isFinished(bot),true,'the crowd pillar still comes down when quiet');
 // Round 7: a holding pillar that is knocked off re-climbs after 3 s (a crowd pillar: 10 s).
 t.failed=true;const now=m2.now();
 m2.priority(bot,ctx);
 assert.ok(m2._pillarRetryAt-now<=3.1&&m2._pillarRetryAt-now>=2.9,'hold retry '+(m2._pillarRetryAt-now));
});
test('the ladder does not resend a shelter that failed short of blocks; it holds for morning',()=>{
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'shelter-ap-'));
 const submitted=[],jobs=[];
 const worker={ready:true,userStopped:false,deathResume:false,jobs,lastDeath:null,log(){},wanted:false,
  nightPillarWanted(){return this.wanted;},
  submit(spec){submitted.push(spec);const job={id:'j'+submitted.length,status:'queued',spec};jobs.push(job);return job;},
  cancel(id){const j=jobs.find(x=>x.id===id);if(j)j.status='cancelled';},
  bot:{health:20,food:20,time:{timeOfDay:14000,day:3},inventory:{items(){return [];}},entities:{},
   registry:{blocksByName:{},foodsByName:{},itemsByName:{}},findBlock(){return null;},blockAt(){return null;},
   entity:{position:{y:-60,floored(){return {x:0,y:-60,z:0,offset(){return this;}};}}}}};
 try{
  const ap=new Autopilot(worker,root);ap.start();
  ap.tick();assert.deepEqual(submitted,[{type:'shelter'}]);
  jobs[0].status='failed';jobs[0].message='Short of shelter blocks: 5 held, 25 needed at (0, -60, 0); night pillar instead';
  worker.wanted=true;
  for(let i=0;i<NIGHT_RETRIES+1;i++){ap.coolUntil=0;ap.tick();}
  assert.equal(submitted.length,1,'no retry: it would gate the pillar off and dig the same ground');
  assert.match(ap.state,/holding for morning/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('the shell math: flat ground needs 25 (the grass floor is there)',()=>{
 const world=flat();
 const {w}=shelterWorker(world);
 assert.equal(w.shelterNeed(new Vec3(0,-60,0)),25);
 assert.equal(shellGaps(world.blockAt,shelterShell({x:0,y:-60,z:0}).required).length,25,'the floor is grass already');
});
// ---- round 7: the last open cells --------------------------------------------------------
// hard2: `Could not seal the shelter: 2 open cells, first at 158,154,-8` - a feet/head pair
// on one side. The server refuses a placement that overlaps the player, and a bot standing
// off its cell centre overlaps the neighbour column.
function serverPlace(world,bot,inv,placed){
 return async(ref,face)=>{
  const t=ref.position.plus(face),p=bot.entity.position;
  if(t.x<p.x+0.3&&t.x+1>p.x-0.3&&t.z<p.z+0.3&&t.z+1>p.z-0.3&&t.y<p.y+1.8&&t.y+1>p.y)throw Error('placement inside the player');
  if(world.blockAt(t.x,t.y,t.z).name!=='air')throw Error('not replaceable: '+world.blockAt(t.x,t.y,t.z).name);
  const item=inv.find(i=>i.name===bot.heldItem?.name&&i.count>0);
  world.set(t.x,t.y,t.z,item.name);item.count--;placed.push(k(t.x,t.y,t.z));
 };
}
const morningAfterGuard=w=>{const g=w.guardShelter;w.guardShelter=async function(...a){this.bot.time.timeOfDay=1500;return g.apply(this,a);};w.removeShelter=async()=>{};};
test('round 7: an off-centre bot sneaks back to the middle before sealing, so no ring cell overlaps it',async()=>{
 const world=flat();
 const {w,bot,placed,logs,inv}=shelterWorker(world);
 bot.placeBlock=serverPlace(world,bot,inv,placed);
 bot.entity.position=new Vec3(0.85,-60,0.5); // overlaps x=1 (feet and head ring cells)
 const controls=[];
 bot.look=async yaw=>{bot._yaw=yaw;};
 bot.setControlState=(n,v)=>{controls.push([n,v]);if(n==='forward'&&v){const p=bot.entity.position;bot.entity.position=new Vec3(p.x-Math.sin(bot._yaw)*0.2,p.y,p.z-Math.cos(bot._yaw)*0.2);}};
 morningAfterGuard(w);
 await w.shelter({spec:{type:'shelter'}},0);
 assert.ok(logs.some(m=>/^Shelter: sealed at .* \(25 blocks placed\)/.test(m)),logs.join('\n'));
 assert.ok(Math.abs(bot.entity.position.x-0.5)<=0.2,'centred: '+bot.entity.position.x);
 assert.ok(controls.some(([n,v])=>n==='sneak'&&v)&&controls.at(-1)[1]===false,'sneaked, then released');
});
test('round 7: without the centring the same seal leaves exactly the feet/head pair open',async()=>{
 const world=flat(),c=clock();
 try{
  const {w,bot,placed,logs,inv}=shelterWorker(world);
  bot.placeBlock=serverPlace(world,bot,inv,placed);
  bot.entity.position=new Vec3(0.85,-60,0.5);
  w.centreInCell=async()=>{c.spend(1500);return false;};
  await assert.rejects(w.shelter({spec:{type:'shelter'}},0),/Could not seal the shelter.*2 open cells, first at 1,-60,0/);
  assert.ok(logs.some(m=>/^Shelter: open cells 1,-60,0=air 1,-59,0=air \(bot at 0\.85,0\.50\)/.test(m)),logs.join('\n'));
 }finally{c.restore();}
});
test('round 7: a mushroom in a ring cell is dug out (a notch), then the cell is filled',async()=>{
 const world=flat();
 world.set(-1,-60,1,'brown_mushroom');world.set(1,-60,-1,'poppy');
 const {w,bot,placed,logs,inv}=shelterWorker(world);
 bot.placeBlock=serverPlace(world,bot,inv,placed);
 const dug=[];const dig=bot.dig;bot.dig=async bl=>{dug.push(bl.name);world.set(bl.position.x,bl.position.y,bl.position.z,'air');};
 morningAfterGuard(w);
 await w.shelter({spec:{type:'shelter'}},0);
 assert.deepEqual(dug.sort(),['brown_mushroom','poppy']);
 assert.ok(logs.some(m=>/^Shelter: sealed/.test(m)));
 assert.equal(world.blockAt(-1,-60,1).name,'cobblestone');
});
// ---- round 7: leaving the shelter -------------------------------------------------------
// hard3 sealed at sunset and was shot by a skeleton 3 blocks from the box during a gather
// right after the clock wrapped to 0: the box came down at the wrap.
import {leaveRefuge,stillNight,MORNING_SAFE,MORNING_LATE} from '../src/night.js';
test('round 7: leaveRefuge - light morning and clear only; a shaded archer stops holding it late',()=>{
 assert.equal(stillNight(12000),true);assert.equal(stillNight(23999),true);assert.equal(stillNight(0),true);assert.equal(stillNight(MORNING_SAFE),false);
 assert.equal(leaveRefuge(0),false,'the wrap to 0 is not morning');
 assert.equal(leaveRefuge(MORNING_SAFE-1),false);
 assert.equal(leaveRefuge(MORNING_SAFE),true,'light and nothing near');
 assert.equal(leaveRefuge(1500,10),false,'a hostile within 16');
 assert.equal(leaveRefuge(MORNING_LATE,10),true,'late: only a hostile at the wall holds it');
 assert.equal(leaveRefuge(MORNING_LATE,5),false);
 assert.equal(leaveRefuge(13000),false,'evening');
});
test('round 7: the sealed shelter holds through the wrap to 0 and opens only once the morning is light and clear',async()=>{
 const world=flat();
 const {w,bot,logs}=shelterWorker(world);
 const removed=[];w.removeShelter=async()=>{removed.push(bot.time.timeOfDay);};
 // the clock: 23900 -> 100 (wrap) -> 600 -> 1100 with a skeleton 5 away -> 1400 clear
 const ticks=[23900,100,600,1100,1400];let i=0;
 w.guardShelter=async function(){
  const tod=ticks[Math.min(i++,ticks.length-1)];bot.time.timeOfDay=tod;
  bot.entities={};
  if(tod===1100)bot.entities[9]={type:'hostile',name:'skeleton',isValid:true,position:new Vec3(5.5,-60,0.5)};
 };
 await w.shelter({spec:{type:'shelter'}},0);
 assert.deepEqual(removed,[1400],'opened at 1400, not at the wrap (100), at 600 or with the skeleton near (1100)');
 assert.ok(logs.some(m=>/^Shelter: dawn \(tod 100\); staying sealed/.test(m)));
 assert.ok(logs.some(m=>/^Shelter: morning \(tod 1400, nearest hostile none\); opening up/.test(m)));
});
test('round 7: the dawn hold never outlives the job deadline (a timed-out job would leave the box up)',async()=>{
 const world=flat();
 const {w,bot,logs}=shelterWorker(world);
 const removed=[];w.removeShelter=async()=>{removed.push(bot.time.timeOfDay);};
 let n=0;
 w.guardShelter=async function(){
  bot.time.timeOfDay=200; // a long dark dawn
  if(++n===3)w.deadline=Date.now()+30000; // the 13-minute limit is close
 };
 await w.shelter({spec:{type:'shelter'}},0);
 assert.equal(removed.length,1);assert.equal(n,3);
});
test('round 7: a shelter resumed at dawn with its box up re-seals and holds instead of tearing it down',async()=>{
 const world=flat();
 const {w,bot}=shelterWorker(world,{tod:300});
 const removed=[];w.removeShelter=async()=>{removed.push(bot.time.timeOfDay);};
 const job={spec:{type:'shelter'},placed:[{x:1,y:-60,z:0}]};
 let n=0;w.guardShelter=async function(){bot.time.timeOfDay=++n<3?400:1200;};
 await w.shelter(job,0);
 assert.deepEqual(removed,[1200]);
 const done={spec:{type:'shelter'},placed:[{x:1,y:-60,z:0}]};bot.time.timeOfDay=2000;removed.length=0;
 await w.shelter(done,0);
 assert.deepEqual(removed,[2000],'resumed in a light morning: just take it down');
});
// ---- round 9: a pod before the pillar -----------------------------------------------------
// hard2: `Short of shelter blocks: 10 held, 14 needed at (140, 128, 31); night pillar instead`,
// then 9 minutes of `pillar-up failed (timed out at 0/3)` every few seconds.
test('round 9: the 1x1 pod shell - four feet faces, the full head ring, the roof and its anchor',()=>{
 const {required,support}=shelterShell({x:0,y:-60,z:0},true);
 assert.equal(required.length,15,'floor + 4 + 8 + 2');
 assert.ok(!required.some(c=>c.y===-60&&c.x&&c.z),'no feet diagonals');
 assert.ok(required.some(c=>c.y===-59&&c.x===1&&c.z===1),'the head ring keeps its diagonals: no 2-high mob stands at a feet diagonal');
 assert.deepEqual(required.filter(c=>c.y===-58),[{x:0,y:-58,z:0},{x:1,y:-58,z:0}],'the roof cell has no face to place against without the x+1 anchor');
 assert.equal(support.length,4);
 assert.equal(shelterShell({x:0,y:-60,z:0}).required.length,26,'the box is unchanged');
});
test('round 9: short for the box but not for a pod, the shelter seals the pod instead of the pillar',async()=>{
 const world=flat();
 const {w,logs,placed}=shelterWorker(world,{items:[{name:'cobblestone',count:14}]});
 morningAfterGuard(w);
 const job={spec:{type:'shelter'}};
 await w.shelter(job,0);
 assert.ok(logs.some(m=>/^Shelter: 14 blocks held, 25 for the box; sealing a 1x1 pod \(14\)/.test(m)),logs.join('\n'));
 assert.ok(logs.some(m=>/^Shelter: sealed at .* \(14 blocks placed\)/.test(m)),logs.join('\n'));
 assert.equal(shellGaps(world.blockAt,shelterShell({x:0,y:-60,z:0},true).required).length,0);
 assert.equal(placed.length,14);assert.equal(w.nightPillarWanted(),false);
});
test('round 9: short even for the pod, it still falls back to the night pillar with the pod count logged',async()=>{
 const world=flat();
 const {w,logs}=shelterWorker(world,{items:[{name:'cobblestone',count:10}]});
 await assert.rejects(w.shelter({spec:{type:'shelter'}},0),/Short of shelter blocks: 10 held, 25 needed .*; night pillar instead/);
 assert.ok(logs.includes('Shelter: a 1x1 pod would need 14 here'),logs.join('\n'));
});
test('round 9: failed climbs back off 3, 6, 12 ... 60 s; a perch knocked off re-climbs in 3',async()=>{
 const {pillarBackoff}=await import('../src/chains/mobDefenseChain.js');
 assert.deepEqual([0,1,2,3,4,5,6,9].map(pillarBackoff),[3,3,6,12,24,48,60,60]);
});
