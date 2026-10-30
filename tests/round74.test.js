import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import pf from 'mineflayer-pathfinder';
import {Worker,WATER_SEARCH_RADIUS} from '../src/worker.js';
import {GetOutOfWaterTask,airPocket,POCKET_MAX,NO_RISE_MS} from '../src/tasks/movement/get-out-of-water-task.js';

// Round 74: the round-73 soak on the Nitrous world copy.
function navBot(start){
 const bot={entity:{position:start.clone(),onGround:true},on(){},off(){},clearControlStates(){},
  blockAt:p=>({name:p.y<62?'water':'air',boundingBox:'empty',position:p}),
  pathfinder:{searchRadius:128,movements:{exclusionAreasStep:[]},setGoal(){},isMining:()=>false,calls:[]}};
 return bot;
}
const navWorker=(bot,logs)=>Object.assign(Object.create(Worker.prototype),{bot,epoch:0,log:m=>logs.push(m),check(){},applyMobAvoidance(){}});
test('round 74: walled in in the water, a no-path at both budgets stairs out once and paths again',async()=>{
 const bot=navBot(new Vec3(709.5,60,-419.5)),logs=[];let staired=0;
 bot.pathfinder.goto=async()=>{bot.pathfinder.calls.push(bot.pathfinder.searchRadius);if(bot.entity.position.y<62)throw new Error('No path to the goal!');bot.entity.position=new Vec3(708.5,66,-420.5);};
 const w=navWorker(bot,logs);
 w.stairOut=async()=>{staired++;bot.entity.position=new Vec3(710.5,63,-419.5);return true;};
 await w.navigate(new pf.goals.GoalNear(708,66,-421,1),0,5);
 assert.equal(staired,1);
 assert.deepEqual(bot.pathfinder.calls,[128,WATER_SEARCH_RADIUS,WATER_SEARCH_RADIUS]);
 assert.equal(bot.pathfinder.searchRadius,128);
 // A stair-out that cannot rise leaves the no-path as it was, and is tried once only.
 const deep=navBot(new Vec3(709.5,60,-419.5));let tries=0;
 deep.pathfinder.goto=async()=>{throw new Error('No path to the goal!');};
 const wd=navWorker(deep,[]);wd.stairOut=async()=>{tries++;return false;};
 await assert.rejects(wd.navigate(new pf.goals.GoalNear(708,66,-421,1),0,5),/^Error: No path to the goal!$/);
 assert.equal(tries,1);
 // Not from a tunnel climb (it has its own fallback).
 const own=navBot(new Vec3(709.5,60,-419.5));own.pathfinder.goto=deep.pathfinder.goto;
 const wo=navWorker(own,[]);wo._ownFallback=true;wo.stairOut=async()=>{tries++;return true;};
 await assert.rejects(wo.navigate(new pf.goals.GoalNear(708,66,-421,1),0,5),/No path/);
 assert.equal(tries,1);
});

// normal1's pit: the table at (711, 60, -420) with water on its sides.
function tableBot(wet,{held=1}={}){
 const table={name:'crafting_table',position:new Vec3(711,60,-420)};
 const bot={entity:{position:new Vec3(710.5,63,-420.5)},registry:{blocksByName:{crafting_table:{id:1}},itemsByName:{crafting_table:{id:2}}},
  findBlock:()=>table,
  blockAt:p=>p.equals(table.position)?table:p.equals(new Vec3(709,63,-421))?{name:'crafting_table',position:p}:{name:wet&&p.y>=60&&p.y<=62?'water':'air',position:p}};
 const logs=[],walks=[],placed=[];
 const w=Object.assign(Object.create(Worker.prototype),{bot,log:m=>logs.push(m),check(){},
  count:n=>n==='crafting_table'?held:0,usableRecipe:()=>null,recipeVariants:()=>[],
  walk:async p=>{walks.push(p.toString());},placeBlockNear:async()=>{placed.push(1);return new Vec3(709,63,-421);}});
 return {w,logs,walks,placed};
}
test('round 74: a crafting table standing in water is passed over for a new one',async()=>{
 const {w,logs,walks,placed}=tableBot(true);
 const r=await w.ensureTable(0);
 assert.deepEqual(walks,[],'never walked back down to it');
 assert.equal(placed.length,1);assert.equal(r.created.toString(),new Vec3(709,63,-421).toString());
 assert.equal(logs[0],'Craft: the crafting table at (711, 60, -420) stands in water; placing another');
 const dry=tableBot(false);
 const d=await dry.w.ensureTable(0);
 assert.equal(d.created,null);assert.equal(dry.placed.length,0,'a dry table is used as before');
 const none=tableBot(true,{held:0});
 const n=await none.w.ensureTable(0);
 assert.equal(n.created,null,'with nothing to replace it the flooded table is still used');
 assert.deepEqual(none.logs,[]);
});

// A water column 3 deep at x=0 and x=1 (y 60-62, air from 63) in stone; the bot's feet at y 60.
function pitBot(){
 const controls={},looks=[];
 const at=p=>{const x=Math.floor(p.x),y=Math.floor(p.y),z=Math.floor(p.z),pos=new Vec3(x,y,z);
  if(z===0&&(x===0||x===1)&&y>=60&&y<=62)return {name:'water',boundingBox:'empty',position:pos};
  if(z===0&&(x===0||x===1)&&y>=63)return {name:'air',boundingBox:'empty',position:pos};
  return {name:'stone',boundingBox:'block',position:pos};};
 const b={entity:{position:new Vec3(0.5,60,0.5),isInWater:true,onGround:false},oxygenLevel:6,blockAt:at,
  setControlState:(n,v)=>{controls[n]=v;},clearControlStates(){},dig:async()=>{},lookAt:async v=>{looks.push(v);},
  pathfinder:{stop(){},setGoal(){},movements:null,goto:async()=>{throw Error('no path');},setMovements(){}}};
 return {b,controls,looks};
}
test('round 74: swimming straight up that does not rise in 3 s swims round the column',()=>{
 const {b,controls,looks}=pitBot(),logs=[];
 const ctx={bot:b,worker:{controlToken:1,epoch:1,log:m=>logs.push(m)}};
 const real=Date.now;let t=real();Date.now=()=>t;
 try{
  const task=new GetOutOfWaterTask({ctx});task.onStart(b,ctx);
  task.onTick(b,ctx);
  assert.equal(controls.jump,true);assert.notEqual(controls.forward,true,'straight up first');
  assert.match(logs[0],/^WorldSurvival: open water 2 up/);
  t+=NO_RISE_MS-100;task.onTick(b,ctx);assert.equal(logs.length,1,'not yet');
  t+=200;task.onTick(b,ctx);
  assert.equal(logs[1],'WorldSurvival: no rise in 3 s swimming up at (0, 60, 0) (air 6); swimming round it');
  assert.equal(controls.forward,true);
  assert.ok(looks.at(-1).x===1.5&&looks.at(-1).y===61.5,'toward the next column east');
  assert.match(logs[2],/^WorldSurvival: air at \(1, 63, 0\), 3 cell\(s\) through the water/);
  // A bot that does rise is left swimming up.
  const r=pitBot(),rl=[];const rc={bot:r.b,worker:{controlToken:1,epoch:1,log:m=>rl.push(m)}};
  const rt=new GetOutOfWaterTask({ctx:rc});rt.onStart(r.b,rc);rt.onTick(r.b,rc);
  for(let i=0;i<8;i++){t+=1000;r.b.entity.position=r.b.entity.position.offset(0,0.6,0);rt.upAt=0;if(r.b.entity.position.y<61.4)rt.onTick(r.b,rc);}
  assert.ok(!rl.some(m=>/no rise/.test(m)));
 }finally{Date.now=real;}
 assert.equal(airPocket(b,POCKET_MAX,null).cell.toString(),new Vec3(0,63,0).toString(),'unstuck: straight up');
});

test('round 74: one step beside the shelter cell after the climb, the bot steps in by hand',async()=>{
 const origin=new Vec3(811,87,-531),logs=[];
 const bot={entity:{position:new Vec3(812.5,87,-530.5)},pathfinder:{movements:{},setMovements(){}},look:async()=>{},clearControlStates(){},
  setControlState(n,v){if(n==='forward'&&v)bot.entity.position=new Vec3(811.5,87,-530.5);}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,log:m=>logs.push(m),check(){},exploreMovements:()=>({}),
  climbTunnel:async()=>{},navigate:async()=>{throw Error('Took to long to decide path to goal!');}});
 assert.equal(await w.nightMineReturn({id:'n',tunnel:[{x:812,y:84,z:-531}]},0,origin),true);
 assert.deepEqual(logs,['Night mine: could not climb back into (811, 87, -531): Took to long to decide path to goal!','Night mine: one step from the shelter at (812, 87, -531); stepping in']);
 // Two away, or a level off, is not a step.
 const far=Object.assign(Object.create(Worker.prototype),{bot:{...bot,entity:{position:new Vec3(813.5,87,-530.5)},setControlState(){}},epoch:0,log(){},check(){},exploreMovements:()=>({}),
  climbTunnel:async()=>{},navigate:async()=>{throw Error('x');},walkTunnelBack:async()=>{throw Error('not called');}});
 far.walkTunnelBack=async()=>false;
 assert.equal(await far.nightMineReturn({id:'n',tunnel:[]},0,origin),false);
});
