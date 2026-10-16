// Cloud round 5, task 2: 'BuilderBot drowned' at 02:46 during the round-4 night chaos, while
// Mob Defense was fleeing a crowd. Every flee path must stay out of deep water after dark,
// and the swim-up must own the bot over any Mob Defense band.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {fleeHeading} from '../src/night.js';
import {Worker} from '../src/worker.js';
import {TaskRunner} from '../src/tasks/runner.js';
import {defaultChains} from '../src/chains/index.js';
import {KeepDistanceTask} from '../src/chains/fallbackTasks.js';
console.error=()=>{};
const k=(x,y,z)=>x+','+y+','+z;
// Ground at y=-61; a lake (2 deep) over x<=-1 unless `lake` is false.
function shore({lake=true}={}){
 const cells=new Map();
 for(let x=-8;x<=8;x++)for(let z=-8;z<=8;z++){
  if(lake&&x<=-1){cells.set(k(x,-60,z),'water');cells.set(k(x,-61,z),'water');cells.set(k(x,-62,z),'sand');}
  else cells.set(k(x,-61,z),'grass_block');
 }
 const blockAt=(x,y,z)=>{const name=cells.get(k(x,y,z))||'air';return {name,position:new Vec3(x,y,z),boundingBox:/^(air|water|lava)$/.test(name)?'empty':'block'};};
 return {cells,blockAt,at:p=>blockAt(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z))};
}
test('a swimming bot flees toward the shore, not further out (and is never "blocked" by water)',()=>{
 const w=shore();
 const me={x:-2.5,y:-60,z:0.5}; // two blocks out in the lake
 // The zombie is due south: straight away (north) runs along the lake; the shore wins.
 const h=fleeHeading(w.blockAt,me,[{position:{x:-2.5,y:-60,z:4.5}}],{inWater:true});
 assert.equal(h.blocked,false);
 assert.ok(h.x>0,'east, toward the grass: '+JSON.stringify(h));
 // On land the same lake rules the westward headings out entirely.
 const land=fleeHeading(w.blockAt,{x:0.5,y:-60,z:0.5},[{position:{x:4,y:-60,z:0.5}}]);
 for(let s=1;s<=4;s++)assert.notEqual(w.blockAt(Math.floor(0.5+land.x*s),-60,Math.floor(0.5+land.z*s)).name,'water');
});
test('KeepDistanceTask opens the gap along the shore, never into the lake',async()=>{
 const w=shore();
 const calls=[];
 const me={position:new Vec3(0.5,-60,0.5),onGround:true};
 const mob={name:'zombie',type:'hostile',position:new Vec3(4.5,-60,0.5),isValid:true};
 const bot={entity:me,entities:{1:me,2:mob},food:20,blockAt:p=>w.at(p),look:async(yaw)=>{calls.push(['look',yaw]);},setControlState:(n,v)=>calls.push([n,v])};
 new KeepDistanceTask(16).onTick(bot,{});
 const yaw=calls.find(c=>c[0]==='look')[1];
 const hx=-Math.sin(yaw),hz=-Math.cos(yaw);
 for(let s=1;s<=4;s++)assert.notEqual(w.blockAt(Math.floor(0.5+hx*s),-60,Math.floor(0.5+hz*s)).name,'water','step '+s);
 assert.ok(calls.some(c=>c[0]==='forward'&&c[1]===true));
});
test("the fight job's retreat sprint never runs into water; with water all round it stands",async()=>{
 const run=async(world,pos)=>{
  const controls=[];let yaw=null;
  const bot={entity:{position:new Vec3(...pos),isInWater:false},health:20,entities:{},
   pathfinder:{stop(){},setGoal(){}},clearControlStates(){},blockAt:p=>world.at(p),
   look:async y=>{yaw=y;},setControlState:(n,v)=>controls.push([n,v])};
  const zombie={name:'zombie',type:'hostile',position:new Vec3(pos[0]+3,pos[1],pos[2])};
  bot.entities[2]=zombie;
  const w=Object.assign(Object.create(Worker.prototype),{bot,epoch:1,check(){}});
  await w.retreatSprint(1,zombie,0.05);
  return {controls,yaw};
 };
 const w=shore();
 // West of the zombie is the lake: the sprint turns along the shore.
 const r=await run(w,[1.5,-60,0.5]);
 const hx=-Math.sin(r.yaw),hz=-Math.cos(r.yaw);
 for(let s=1;s<=4;s++)assert.notEqual(w.blockAt(Math.floor(1.5+hx*s),-60,Math.floor(0.5+hz*s)).name,'water');
 assert.ok(r.controls.some(c=>c[0]==='forward'&&c[1]===true));
 // A spit of land with water on every side: no sprint at all.
 const pond=shore({lake:false});
 for(let x=-8;x<=8;x++)for(let z=-8;z<=8;z++)if(Math.abs(x)>=1||Math.abs(z)>=1){pond.cells.set(k(x,-60,z),'water');pond.cells.set(k(x,-61,z),'water');}
 const p=await run(pond,[0.5,-60,0.5]);
 assert.ok(!p.controls.some(c=>c[0]==='forward'&&c[1]===true));
});
test('the pathfinder hook bans deep water after dark, but not for a bot already swimming out',()=>{
 const w=shore();
 const movement={blocksToAvoid:new Set(),exclusionAreasStep:[]};
 const bot={registry:{blocksByName:{}},time:{timeOfDay:15000},entity:{position:new Vec3(2.5,-60,0.5),isInWater:false},blockAt:p=>w.at(p)};
 Worker.prototype.avoidHazards.call({},movement,bot);
 assert.equal(movement.exclusionAreasStep.length,1);
 const hook=movement.exclusionAreasStep[0];
 const deep=w.blockAt(-3,-60,0),grass=w.blockAt(2,-61,0);
 assert.equal(hook(deep),100,'night: no step into deep water');
 assert.equal(hook(grass),0);
 bot.time.timeOfDay=6000;
 assert.equal(hook(deep),12,'day: costly, not banned');
 bot.time.timeOfDay=15000;bot.entity.isInWater=true;
 assert.equal(hook(deep),0,'already in the water: the way out is through it');
 Worker.prototype.avoidHazards.call({},movement,bot);
 assert.equal(movement.exclusionAreasStep.length,1,'installed once per movements object');
});
test('drowning takes the tree from a running Mob Defense flee, and hands it back when the air is back',()=>{
 const calls=[];
 const bot={version:'1.21.4',health:20,food:20,oxygen:20,time:{timeOfDay:15000},
  entity:{id:1,position:new Vec3(0,-60,0),velocity:new Vec3(0,0,0),onGround:true,isInWater:true,metadata:[0],height:1.8},
  entities:{10:{id:10,name:'zombie',type:'hostile',position:new Vec3(3,-60,0),height:1.9,isValid:true,metadata:[0]}},
  inventory:{items:()=>[],slots:[]},heldItem:null,registry:{blocksByName:{},itemsByName:{},foodsByName:{}},
  blockAt:()=>null,setControlState:(n,v)=>calls.push([n,v]),look:async()=>{},findBlock:()=>null,findBlocks:()=>[]};
 const runner=new TaskRunner({bot,epoch:0,controlToken:null,jobs:[],log(){}},defaultChains());
 runner.tick();
 assert.equal(runner.status().chain,'Mob Defense','unarmed at night: the flee');
 bot.oxygen=5;
 runner.tick();
 assert.equal(runner.status().chain,'Misc World Survival Chain');
 assert.equal(runner.status().task,'SwimUpTask');
 assert.ok(calls.some(c=>c[0]==='jump'&&c[1]===true));
 bot.oxygen=12;runner.tick();
 assert.equal(runner.status().chain,'Misc World Survival Chain','latched until 18');
 bot.oxygen=19;runner.tick();
 assert.equal(runner.status().chain,'Mob Defense');
});
test('SwimUpTask digs a solid roof over a flooded tunnel, never lava-side or bedrock',async()=>{
 const {SwimUpTask}=await import('../src/chains/fallbackTasks.js');
 const mk=(cells)=>({entity:{position:new Vec3(0.5,10,0.5),isInWater:true,yaw:0},
  blockAt:p=>{const n=cells[`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`]||'stone';return {name:n,position:p,boundingBox:/^(air|water|lava)$/.test(n)?'empty':'block'};}});
 // feet and head cells are water, everything around is stone: dig the stone at y=12
 const flooded={'0,10,0':'water','0,11,0':'water'};
 assert.equal(SwimUpTask.roofToDig(mk(flooded)).name,'stone');
 assert.equal(SwimUpTask.roofToDig(mk({...flooded,'0,12,0':'water'})),null,'open water above: just swim');
 assert.equal(SwimUpTask.roofToDig(mk({...flooded,'0,12,0':'bedrock'})),null);
 assert.equal(SwimUpTask.roofToDig(mk({...flooded,'1,12,0':'lava'})),null,'never open a cell beside lava');
});
