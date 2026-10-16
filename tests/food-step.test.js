import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Vec3} from 'vec3';
import {plan,foodDone,Autopilot,FOOD_ENOUGH,FOOD_LEGS} from '../src/autopilot.js';
// Round 9: round-8 normal1 crafted its furnace at 13:27, cooked 3 porkchops, ate them at a bar
// of 14 and sat on [food] for the rest of the run (27 explore legs, `food failed 3 times`
// x12) under an 8-edible rule - no iron pickaxe in any run. The food step completes at
// FOOD_ENOUGH held or held + eaten, is set aside after FOOD_LEGS barren legs or 3 failures,
// and comes back only when the bot is hungry with nothing to eat.
const counts=map=>({__proto__:null,...map});
const c=map=>name=>map[name]||0;
const STONE={oak_log:4,oak_planks:8,stick:10,cobblestone:32,crafting_table:1,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,stone_pickaxe:1,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1};
test('foodDone: enough held, or held + eaten this run, unless hungry with none held',()=>{
 assert.equal(FOOD_ENOUGH,4);
 assert.equal(foodDone(c({_edible:4}),{}),true);
 assert.equal(foodDone(c({_edible:3}),{}),false);
 assert.equal(foodDone(c({_edible:1,_eaten:3}),{foodBar:18}),true,'the meals it ate count');
 assert.equal(foodDone(c({_edible:0,_eaten:4}),{foodBar:20}),true,'ate its 4 porkchops, not hungry: on to iron');
 assert.equal(foodDone(c({_edible:0,_eaten:4}),{foodBar:14}),false,'hungry with none held: back to food');
 assert.equal(foodDone(c({_edible:4,porkchop:1,furnace:1}),{}),false,'raw meat still cooks first');
 assert.equal(foodDone(c({_edible:0}),{foodOff:true,foodBar:12}),true,'set aside: never loops');
 // Round 11 normal1 starved at a bar of 5 while the step sat set aside: a nearly empty bar
 // with nothing held always brings it back.
 assert.equal(foodDone(c({_edible:0}),{foodOff:true,foodBar:5}),false,'starving overrides the set-aside');
 assert.equal(foodDone(c({_edible:0}),{foodDeferred:true,foodBar:18}),true,'deferred: only hunger brings it back');
 assert.equal(foodDone(c({_edible:0}),{foodDeferred:true,foodBar:12}),false);
});
test('plan: 4 cooked porkchops eaten at 14 move the ladder to iron, not back to the graze',()=>{
 let r=plan(counts({...STONE,_edible:3,cooked_porkchop:3}),{foodBar:20});
 assert.equal(r.step,'food','3 held, none eaten: one more hunt');
 r=plan(counts({...STONE,_edible:0,_eaten:4}),{foodBar:20});
 assert.equal(r.step,'iron');
 r=plan(counts({...STONE,_edible:1,_eaten:3}),{foodBar:19});
 assert.equal(r.step,'iron');
});
function ladder({items={},food=20,meals={eaten:0,ok:0}}={}){
 const submitted=[];
 const worker={ready:true,userStopped:false,deathResume:false,jobs:[],epoch:0,leftTable:null,meals,logs:[],
  log(m){this.logs.push(m);},
  submit(spec){const job={id:'j'+(submitted.length+1),spec,status:'queued'};submitted.push(spec);this.jobs.push(job);return job;}};
 const position=new Vec3(0.5,64,0.5);
 worker.bot={food,health:20,time:{timeOfDay:1000,day:1},inventory:{items(){return Object.entries(items).filter(([,n])=>n>0).map(([name,count])=>({name,count}));}},
  entities:{},registry:{blocksByName:{crafting_table:{id:9},furnace:{id:10},chest:{id:11}},foodsByName:{cooked_porkchop:{foodPoints:8}},itemsByName:{}},
  findBlock(){return null;},blockAt(){return {name:'air'};},entity:{position}};
 return {worker,submitted};
}
// The next tick settles the finished job and decides the next one.
const finish=(w,status='complete')=>{w.jobs.at(-1).status=status;};
test('autopilot: FOOD_LEGS barren graze legs set the food step aside and the ladder moves on to iron',()=>{
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'food-step-'));
 try{
  const {worker,submitted}=ladder({items:{...STONE}});
  const ap=new Autopilot(worker,root);ap.start();
  for(let i=0;i<FOOD_LEGS-1;i++){ap.tick();assert.equal(submitted.at(-1).type,'explore','leg '+(i+1));finish(worker);}
  const before=submitted.length;
  ap.tick(); // the leg that would be the FOOD_LEGS-th: set aside instead
  assert.equal(submitted.length,before,'no further graze leg');
  assert.ok(worker.logs.some(l=>/food step set aside/.test(l)),worker.logs.join('|'));
  ap.tick();
  assert.equal(submitted.filter(j=>j.type==='explore').length,FOOD_LEGS-1);
  assert.equal(ap.currentStep,'iron','iron next: '+ap.state);
  // still not hungry after the set-aside expires: the deferred step stays done
  ap.food.offUntil=0;w(ap,worker);
  assert.equal(ap.currentStep,'iron');
  // hungry with nothing held: food again
  ap.food.offUntil=0;worker.bot.food=12;w(ap,worker);
  assert.equal(ap.currentStep,'food');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
function w(ap,worker){worker.jobs.length=0;ap.current=null;ap.coolUntil=0;ap.tick();}
test('autopilot: 3 food failures set the step aside instead of the blocked explore loop',()=>{
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'food-step-'));
 try{
  const {worker,submitted}=ladder({items:{...STONE}});
  const ap=new Autopilot(worker,root);ap.start();
  for(let i=0;i<3;i++){ap.coolUntil=0;ap.tick();assert.equal(ap.currentStep,'food');finish(worker,'failed');}
  ap.coolUntil=0;ap.tick();
  assert.ok(worker.logs.some(l=>/food step set aside .*failed 3 times/.test(l)),worker.logs.join('|'));
  assert.ok(!worker.logs.some(l=>/exploring before retry/.test(l)));
  assert.equal(ap.currentStep,'iron',ap.state);
  assert.notEqual(submitted.at(-1).type,'explore');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('autopilot: meals eaten since start count toward the food step (meals.ok or meals.eaten)',()=>{
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'food-step-'));
 try{
  const meals={eaten:0,ok:5};
  const {worker}=ladder({items:{...STONE,cooked_porkchop:1},meals});
  const ap=new Autopilot(worker,root);ap.start();
  assert.equal(ap.counts()._eaten,0,'meals before start() are not this run\'s');
  meals.ok=8;
  assert.equal(ap.counts()._eaten,3);
  ap.tick();
  assert.equal(ap.currentStep,'iron');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
