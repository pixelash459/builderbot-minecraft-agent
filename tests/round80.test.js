import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Vec3} from 'vec3';
import {WorldSurvivalChain,BREATH_SPOT_MS} from '../src/chains/worldSurvivalChain.js';
import {FoodChain} from '../src/chains/foodChain.js';
import {Worker,strandPlan,STRAND_PILLAR_MAX,STRAND_PILLAR_MS,STRAND_PILLAR} from '../src/worker.js';
import {builtLog} from '../src/digDown.js';

// Round 80: the round-79 soak on the Nitrous world copy.
test('round 80: a spot where the head reads under twice with the air and health full is breathing',()=>{
 // round-79 normal1: (703, 58, -373), air 20 and health 20 for 33 min, a stale-air swim-up every ~10 s
 const w=new WorldSurvivalChain(),logs=[],ctx={worker:{log:m=>logs.push(m)}};
 const water={name:'water',boundingBox:'empty'},air={name:'air',boundingBox:'empty'};
 let wet=true;
 const bot={health:20,food:20,oxygenLevel:20,entity:{position:new Vec3(703.5,58,-372.5),isInWater:true,onGround:false},entities:{},
  blockAt:()=>wet?water:air,setControlState(){}};
 const real=Date.now;let t=real();Date.now=()=>t;
 const step=(ms,isWet)=>{t+=ms;wet=isWet;w._handleDrowning(bot,{},ctx);};
 try{
  step(0,true);step(9000,true);
  assert.equal(w._drowning,true,'first 9 s under on a stale reading: the backstop still fires');
  step(500,false);assert.equal(w._drowning,false,'head out: let go');
  step(2500,true);step(9000,true);
  assert.equal(w._drowning,false,'the second time at the same spot: breathing');
  assert.equal(logs.at(-1),'WorldSurvival: the head read under water again at (703, 58, -373) with the air and health full (air 20, health 20); breathing here - no stale-air swim-up within 2 for 180 s');
  step(500,false);step(2000,true);step(9000,true);
  assert.equal(w._drowning,false,'and the third');
  // losing health there: back on
  bot.health=16;step(200,true);
  assert.equal(w._drowning,true);
  // the mark runs out
  const v=new WorldSurvivalChain();
  v._breathSpot={x:703.5,y:58,z:-372.5,health:20,until:t-1};v._headWetSince=t-9000;v._airChanged=t-9000;v._lastAir=20;
  bot.health=20;wet=true;v._handleDrowning(bot,{},ctx);assert.equal(v._drowning,true,'past '+BREATH_SPOT_MS/1000+' s: the backstop fires again');
  // elsewhere: a first episode
  const u=new WorldSurvivalChain();
  u._longUnderAt={x:690,y:58,z:-372,air:20,health:20,at:t-12000};u._headWetSince=t-9000;u._airChanged=t-9000;u._lastAir=20;
  u._handleDrowning(bot,{},ctx);assert.equal(u._drowning,true,'13 blocks off: not the same spot');
 }finally{Date.now=real;}
});
test('round 80: a newer reflex-paused job supersedes an older paused one at resume',()=>{
 const src=fs.readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
 assert.ok(src.includes("if(this.jobs.slice(i+1).some(k=>k.status==='queued'||(k.status==='paused'&&/^(Preempted by|Job interrupted|Reflex:)/.test(String(k.message))))){this.log('Reflex: the paused '+j.spec.type+' job was superseded; cancelled');"));
 // the same rule, on round-79 normal1's queue: three smelts paused by one preempt - only the newest resumes
 const marker=/^(Preempted by|Job interrupted|Reflex:)/;
 const jobs=[1,2,3].map(id=>({id,status:'paused',message:'Reflex: preempted by Misc World Survival Chain',spec:{type:'smelt'}}));
 const resumed=[];
 for(const [i,j] of jobs.entries()){
  if(j.status!=='paused'||!marker.test(j.message))continue;
  if(jobs.slice(i+1).some(k=>k.status==='queued'||(k.status==='paused'&&marker.test(String(k.message))))){j.status='cancelled';continue;}
  j.status='queued';resumed.push(j.id);
 }
 assert.deepEqual(resumed,[3]);assert.deepEqual(jobs.map(j=>j.status),['cancelled','cancelled','queued']);
});
test('round 80: the food a running smelt job is cooking is not eaten meanwhile',()=>{
 const f=new FoodChain();
 const bot={food:6,health:20,inventory:{slots:[],items:()=>[]},entity:{}};
 const ctx={worker:{jobs:[{status:'running',spec:{type:'smelt',item:'porkchop',count:2,leave:true}}]}};
 assert.equal(f.deferReason(bot,ctx,{name:'porkchop'}),'the smelt job is cooking porkchop');
 assert.equal(f.deferReason(bot,ctx,{name:'cooked_beef'}),null,'other food is eaten');
 assert.equal(f.deferReason(bot,{worker:{jobs:[]}},{name:'porkchop'}),null);
});
test('round 80: the strand pillar runs twice on a column, then the bot digs its column down',async()=>{
 const t=1e9,here={x:796.5,z:-588.5};
 assert.equal(strandPlan([],here,t).action,'pillar');
 const two=[{x:796.5,z:-588.5,at:t-60000},{x:797.2,z:-588.1,at:t-30000}];
 assert.equal(STRAND_PILLAR_MAX,2);
 assert.deepEqual({...strandPlan(two,here,t),recent:undefined},{recent:undefined,here:2,action:'dig'});
 assert.equal(strandPlan(two,{x:810,z:-588},t).action,'pillar','another column');
 assert.equal(strandPlan(two,here,t+STRAND_PILLAR_MS).action,'pillar','old pillars expire');
 // round-79 normal3: a dirt pillar, the bot on top at y=217; a path again from y=208
 const solid=new Set();for(let y=150;y<217;y++)solid.add(y);
 const logs=[],goals=[];
 const bot={entity:{position:new Vec3(796.5,217,-588.5)},
  blockAt:p=>{const f=p.floored?p.floored():p;return {name:solid.has(f.y)&&f.x===796&&f.z===-589?'dirt':'air',boundingBox:solid.has(f.y)&&f.x===796&&f.z===-589?'block':'empty',position:f};},
  dig:async bl=>{solid.delete(bl.position.y);bot.entity.position=new Vec3(796.5,bl.position.y,-588.5);}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,log:m=>logs.push(m),check(){},
  navigate:async g=>{goals.push(Math.floor(bot.entity.position.y));if(bot.entity.position.y>208)throw Error('No path to the goal! (empty path)');}});
 assert.equal(await w.strandDigDown(0,{},30),true);
 assert.deepEqual(goals,[214,211,208]);
 assert.equal(logs[0],'Navigation: dug down y=217 -> '+(217-STRAND_PILLAR)+'; pathing again');
 // never into water two below
 const wet=Object.assign(Object.create(Worker.prototype),{log:m=>logs.push(m),check(){},navigate:async()=>{throw Error('No path');},
  bot:{entity:{position:new Vec3(0.5,64,0.5)},blockAt:p=>({name:p.y===62?'water':'dirt',boundingBox:p.y===62?'empty':'block',position:p}),dig:async()=>{throw Error('dug');}}});
 assert.equal(await wet.strandDigDown(0,{},30),false);
 assert.equal(logs.at(-1),'Navigation: the dig down stopped at y=64 (water two below)');
 const src=fs.readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
 assert.ok(src.includes("if(await this.strandDigDown(token,goal,seconds))return;"));
});
test('round 80: a log on or beside a build is not a tree',()=>{
 const world=m=>(x,y,z)=>{const n=m(x,y,z);return n?{name:n}:null;};
 // round-79 hard1: oak logs at (723, 76-78, -518), air under them, then the build's stone_bricks at 73
 const build=world((x,y,z)=>x===723&&z===-518?(y>=76&&y<=78?'oak_log':y===73?'stone_bricks':y<73?'stone':'air'):'air');
 assert.equal(builtLog(build,new Vec3(723,77,-518)),true);
 const tree=world((x,y,z)=>x===0&&z===0?(y>=70&&y<=74?'oak_log':y===69?'grass_block':y<69?'dirt':'oak_leaves'):(y<70?'dirt':'air'));
 assert.equal(builtLog(tree,new Vec3(0,72,0)),false);
 const fenced=world((x,y,z)=>x===0&&z===0?(y>=70&&y<=74?'oak_log':y===69?'grass_block':'air'):x===1&&z===0&&y===71?'oak_fence':'air');
 assert.equal(builtLog(fenced,new Vec3(0,71,0)),true,'a fence on the trunk');
 const branch=world((x,y,z)=>x===0&&z===0?(y===75?'acacia_log':y<72?'grass_block':'air'):'air');
 assert.equal(builtLog(branch,new Vec3(0,75,0)),false,'a branch over grass');
 const beam=world((x,y,z)=>x===0&&z===0?(y===75?'spruce_log':y===74?'spruce_planks':'air'):'air');
 assert.equal(builtLog(beam,new Vec3(0,75,0)),true,'a beam on planks');
});
