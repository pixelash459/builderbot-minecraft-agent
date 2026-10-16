// Round 11 shelter cases (split from shelter-seal.test.js to keep each file under the
// 60 s test timeout): a bot that is not in its box seals where it stands, a box one or two
// cells short under a closed roof is held instead of the night pillar, and the pillar clears
// a stale pathfinder goal before it jumps.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';
import {NightPillarTask} from '../src/chains/fallbackTasks.js';
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
// Round 11 hard1: the night mine could not climb home and the job re-sealed an empty box for
// 7 minutes while the bot stood 16 blocks away. Out of the cell, it seals where it stands.
test('a night mine that cannot climb home seals a new box where the bot stands',async()=>{
 const world=flat();
 const {w,bot,logs}=shelterWorker(world,{items:[{name:'cobblestone',count:60},{name:'stone_pickaxe',count:1}],tod:13500});
 const origins=[];
 w.removeShelter=async()=>{};
 w.nightMine=async()=>{bot.entity.position=new Vec3(5.5,-60,-3.5);return 'away';};
 const realGuard=w.guardShelter;
 w.guardShelter=async function(job,token,origin){origins.push(origin.toString());if(origin.x===5)this.bot.time.timeOfDay=1500;return realGuard.call(this,job,token,origin);};
 const job={spec:{type:'shelter'}};
 await w.shelter(job,0);
 assert.ok(logs.some(m=>/^Shelter: not in the box at \(0, -60, 0\) \(the night mine could not climb home; bot at \(5, -60, -4\)\); sealing where it stands/.test(m)),logs.join('\n'));
 assert.ok(logs.some(m=>/^Shelter: sealed at \(5, -60, -4\)/.test(m)),logs.join('\n'));
 assert.equal(job.nightMined,true,'one night mine a night');
 assert.deepEqual(job.origin,{x:5,y:-60,z:-4});
});
test('pushed out of the sealed cell for 3 s, the shelter seals again where the bot stands',async()=>{
 const world=flat();
 const {w,bot,logs}=shelterWorker(world,{items:[{name:'cobblestone',count:60}],tod:12100});
 w.removeShelter=async()=>{};
 let n=0;
 const realGuard=w.guardShelter;
 w.guardShelter=async function(job,token,origin){if(origin.x===0&&++n===1)bot.entity.position=new Vec3(-4.5,-60,0.5);if(origin.x!==0)this.bot.time.timeOfDay=1500;return realGuard.call(this,job,token,origin);};
 await w.shelter({spec:{type:'shelter'}},0);
 assert.ok(logs.some(m=>/^Shelter: not in the box at \(0, -60, 0\) \(the bot left the cell/.test(m)),logs.join('\n'));
 assert.ok(logs.some(m=>/^Shelter: sealed at \(-5, -60, 0\)/.test(m)),logs.join('\n'));
});
// Round 11 hard3: `the shelter failed (1 open cells)` and the night pillar that replaced it
// `timed out at 0/3; rose 0.00, 0 clicks`. A box one block short is still a refuge.
import {holdableShell,HOLD_GAPS} from '../src/night.js';
test('holdableShell: a few gaps under a closed roof are held; a door, the roof or the floor are not',()=>{
 const o={x:0,y:-60,z:0};
 assert.equal(holdableShell(o,[]),true);
 assert.equal(holdableShell(o,[{x:1,y:-59,z:0}]),true,'a head-ring cell');
 assert.equal(holdableShell(o,[{x:1,y:-60,z:1},{x:-1,y:-58,z:1}]),true,'a feet corner and a roof corner');
 assert.equal(holdableShell(o,[{x:1,y:-60,z:0},{x:1,y:-59,z:0}]),false,'a two-high door');
 assert.equal(holdableShell(o,[{x:0,y:-58,z:0}]),false,'the roof over the bot');
 assert.equal(holdableShell(o,[{x:0,y:-61,z:0}]),false,'the floor');
 assert.equal(holdableShell(o,[{x:1,y:-59,z:0},{x:-1,y:-59,z:0},{x:0,y:-59,z:1}].slice(0,HOLD_GAPS+1)),false,'too many');
});
test('a seal that runs out of time one head-ring cell short holds the box instead of the pillar',async()=>{
 const world=flat(),c=clock();
 try{
  // the head-ring cell east of the bot never takes a block (a ghost placement)
  const {w,logs}=shelterWorker(world,{place:async(ref,face)=>{const t=ref.position.plus(face);c.spend(500);if(t.x===1&&t.y===-59&&t.z===0)return;world.set(t.x,t.y,t.z,'cobblestone');}});
  w.removeShelter=async()=>{};
  w.guardShelter=async function(){this.bot.time.timeOfDay=1500;};
  await w.shelter({spec:{type:'shelter'}},0);
  assert.equal(w.nightPillarWanted(),false,'no pillar tonight');
  assert.ok(logs.some(m=>/^Shelter: 1 open cell\(s\) left at 1,-59,0 under a closed roof; holding the box/.test(m)),logs.join('\n'));
 }finally{c.restore();}
});
test('the night pillar clears a stale pathfinder goal before it jumps',()=>{
 const world=flat();
 const inv=[{name:'cobblestone',count:5,slot:36}];
 const controls={};
 const bot={health:20,food:20,time:{timeOfDay:14000,day:3},entity:{id:1,position:new Vec3(0.5,-60,0.5),onGround:true,yaw:0,height:1.8},
  entities:{},heldItem:{name:'cobblestone'},inventory:{items:()=>inv,slots:[]},blockAt:p=>world.at(p),
  pathfinder:{goal:{x:9},setGoal(g){this.goal=g;}},
  setControlState(n,v){controls[n]=v;},look:async()=>{},equip:async()=>{},placeBlock:async()=>{}};
 const t=new NightPillarTask(3);
 t.onTick(bot,{});
 assert.equal(bot.pathfinder.goal,null);
 assert.equal(controls.jump,true);
});
