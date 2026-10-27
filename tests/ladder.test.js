import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Vec3} from 'vec3';
import {Autopilot} from '../src/autopilot.js';
import {Worker} from '../src/worker.js';
// Ladder regressions from the 2026-10-14 dual soak: hard2 ended its stone step with no table
// held (the step's last craft never collected it), and normal3's autopilot went idle twice
// (its own food-explore cancel was read as the user's Stop all).
const tmp=()=>fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'ladder-test-'));

// ---- the worker's craft table contract -----------------------------------------------------
function craftFake({tableInWorld=null}={}){
 const calls=[];const inv={oak_planks:8,stick:4,wooden_axe:0,crafting_table:tableInWorld?0:1};
 const tableAt=new Vec3(3,64,0);let standing=tableInWorld;
 const w={
  epoch:0,
  bot:{registry:{itemsByName:{wooden_axe:{id:1}},blocksByName:{crafting_table:{id:9}}},entity:{position:new Vec3(0.5,64,0.5)},
   findBlock(){return standing?{position:standing,name:'crafting_table'}:null;},
   recipesFor(id,meta,n,table){return table?[{id}]:[];}},
  count(n){return inv[n]||0;},save(){},check(){},update(){},log(m){calls.push(['log',m]);},
  recipeVariants:Worker.prototype.recipeVariants,
  usableRecipe(b,list){return list.length?{recipe:list[0],subst:{}}:null;},withSubstitutions:r=>r,
  async walk(){},
  async ensureTable(){calls.push(['place']);inv.crafting_table--;standing=tableAt;return {block:{position:tableAt,name:'crafting_table'},created:tableAt};},
  async pickUp(p,name){calls.push(['pickUp',name,p.x]);standing=null;inv[name]++;}
 };
 return {w,calls,inv,job:spec=>({spec:{type:'craft',item:'wooden_axe',count:1,...spec}})};
}
// The fake has no crafting window, so the craft click itself fails; what is under test is the
// finally block's table contract, which runs the same way after a success or a failure.
const runCraft=(f,spec)=>Worker.prototype.craft.call(f.w,f.job(spec),0).catch(()=>{});
test('craft: collectTable wins over keepTable - the step-end craft picks its table back up',async()=>{
 const f=craftFake();
 await runCraft(f,{keepTable:true,collectTable:true});
 assert.deepEqual(f.calls.filter(c=>c[0]==='pickUp'),[['pickUp','crafting_table',3]],'the axe/furnace craft collects the table');
 assert.equal(f.w.leftTable??null,null);
});
test('craft: keepTable alone leaves the table standing and remembers where',async()=>{
 const f=craftFake();
 await runCraft(f,{keepTable:true});
 assert.equal(f.calls.filter(c=>c[0]==='pickUp').length,0);
 assert.deepEqual(f.w.leftTable,{x:3,y:64,z:0});
 // the next step-end craft reuses it and collects it, which clears the memory
 const g=craftFake({tableInWorld:new Vec3(3,64,0)});g.w.leftTable={x:3,y:64,z:0};
 await runCraft(g,{keepTable:true,collectTable:true});
 assert.deepEqual(g.calls.filter(c=>c[0]==='pickUp'),[['pickUp','crafting_table',3]]);
 assert.equal(g.w.leftTable,null);
});
test('craft: a plain craft still takes back the table it placed',async()=>{
 const f=craftFake();
 await runCraft(f,{});
 assert.deepEqual(f.calls.filter(c=>c[0]==='pickUp'),[['pickUp','crafting_table',3]]);
});

// ---- stops that are not the user's ----------------------------------------------------------
function stopFake(){
 return {jobs:[{id:'a',status:'running',spec:{type:'explore'}},{id:'b',status:'queued',spec:{type:'gather'}}],
  epoch:0,userStopped:false,bot:null,save(){},log(){},stop:Worker.prototype.stop,cancel:Worker.prototype.cancel};
}
test('worker: an autopilot cancel and the job watchdog do not count as the user pressing Stop',()=>{
 let w=stopFake();w.cancel('a','autopilot');
 assert.equal(w.userStopped,false);assert.equal(w.jobs[0].status,'cancelled');
 w=stopFake();w.stop('Job time limit reached','timeout');assert.equal(w.userStopped,false);
 w=stopFake();w.stop('Reflex: flee','reflex');assert.equal(w.userStopped,false);
 // the user's own cancel / Stop keep the old contract
 w=stopFake();w.cancel('a');assert.equal(w.userStopped,true);
 w=stopFake();w.stop();assert.equal(w.userStopped,true);
});

const STONE_KIT={oak_log:4,oak_planks:8,stick:10,cobblestone:32,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1};
function ladderWorker({items,position=new Vec3(0.5,64,0.5),entities={},jobs=[],table=null}){
 const submitted=[];
 const worker={ready:true,userStopped:false,deathResume:false,jobs,epoch:0,bot:null,leftTable:null,
  log(){},save(){},
  submit(spec){const job={id:'j'+(submitted.length+1),spec,status:'queued'};submitted.push(spec);this.jobs.push(job);this.userStopped=false;return job;},
  stop:Worker.prototype.stop,cancel:Worker.prototype.cancel};
 worker.bot={time:{timeOfDay:1000,day:1},inventory:{items(){return Object.entries(items).map(([name,count])=>({name,count}));}},
  entities,registry:{blocksByName:{crafting_table:{id:9},furnace:{id:10},chest:{id:11}},foodsByName:{},itemsByName:{}},
  findBlock(o){if(!table||o.matching!==9)return null;return worker.bot.entity.position.distanceTo(table)<=o.maxDistance?{position:table}:null;},
  blockAt(p){return table&&p.x===table.x&&p.y===table.y&&p.z===table.z?{name:'crafting_table'}:{name:'air'};},
  entity:{position}};
 entities.self=worker.bot.entity;
 return {worker,submitted};
}
test('autopilot: its own food-explore cancel leaves the ladder running (normal3 idled twice)',()=>{
 const root=tmp();
 try{
  const cow={name:'cow',position:new Vec3(10,64,0)};
  const {worker,submitted}=ladderWorker({items:{...STONE_KIT,stone_pickaxe:1,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1,crafting_table:1},entities:{c:cow}});
  const ap=new Autopilot(worker,root);
  ap.start();
  const explore={id:'e1',spec:{type:'explore',distance:32},status:'running'};
  worker.jobs.push(explore);ap.current={id:'e1',step:'food',spec:explore.spec};ap.currentStep='food';
  ap.tick(); // animals in range: the running explore is cancelled
  assert.equal(explore.status,'cancelled');
  assert.equal(worker.userStopped,false);
  ap.tick(); // the next tick hunts instead of switching the ladder off
  assert.equal(ap.enabled,true,'autopilot state: '+ap.state);
  assert.equal(submitted.at(-1).type,'fight');assert.equal(submitted.at(-1).entity,'cow');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('autopilot: a table left standing out of reach is walked back to, not re-crafted',()=>{
 const root=tmp();
 try{
  const table=new Vec3(14,64,0);
  const {worker,submitted}=ladderWorker({items:{...STONE_KIT,stone_pickaxe:1},table});
  worker.leftTable={x:14,y:64,z:0};
  const ap=new Autopilot(worker,root);
  ap.start();ap.tick();
  // wood stays done (no new table), and the stone sword craft is preceded by the walk back
  assert.deepEqual(submitted.at(-1),{type:'goto',position:{x:14,y:64,z:0}});
  ap.settle({status:'complete'});worker.jobs.length=0;
  worker.bot.entity.position=new Vec3(13.5,64,0.5);
  ap.tick();
  assert.equal(submitted.at(-1).type,'craft');assert.equal(submitted.at(-1).item,'stone_sword');
  // a table that is gone (picked up / broken) is forgotten
  worker.bot.blockAt=()=>({name:'air'});ap.settle({status:'complete'});worker.jobs.length=0;ap.tick();
  assert.equal(worker.leftTable,null);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('autopilot: two trips that never reach the table forget it and craft on',()=>{
 const root=tmp();
 try{
  const table=new Vec3(20,64,0);
  const {worker,submitted}=ladderWorker({items:{...STONE_KIT,stone_pickaxe:1,crafting_table:1},table});
  worker.leftTable={x:20,y:64,z:0};
  const ap=new Autopilot(worker,root);
  ap.start();
  for(let i=0;i<3;i++){ap.tick();ap.settle({status:'complete'});worker.jobs.length=0;}
  assert.deepEqual(submitted.map(s=>s.type),['goto','goto','craft']);
  assert.equal(worker.leftTable,null);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('round 58: a craft short only of sticks gets 4 sticks crafted first, once',async()=>{
 const inv={oak_planks:8,stick:1,cobblestone:10,stone_shovel:0},logs=[],sub=[];
 const w={
  bot:{registry:{itemsByName:{stone_shovel:{id:20},stick:{id:7}},blocksByName:{crafting_table:{id:9}}},entity:{position:new Vec3(0.5,64,0.5)},
   inventory:{items:()=>Object.entries(inv).map(([name,count])=>({name,count}))},
   findBlock(){return {position:new Vec3(1,64,0),name:'crafting_table'};},
   recipesFor(id){return inv.stick>=2?[{id}]:[];},
   recipesAll(){return [{id:20,delta:[{id:7,count:-2},{id:4,count:-1},{id:20,count:1}]}];}},
  count(n){return inv[n]||0;},save(){},check(){},update(){},log(m){logs.push(m);},earn(){},
  recipeVariants:Worker.prototype.recipeVariants,
  usableRecipe(b,list){return list.find(r=>!r.delta)?{recipe:list[0],subst:{}}:null;},withSubstitutions:r=>r,
  async walk(){},async ensureTable(){return {};},async tossSpareTools(){},
  async craft(job){sub.push(job.spec.item+' x'+job.spec.count);inv.stick+=4;inv.oak_planks-=2;}
 };
 await Worker.prototype.craft.call(w,{spec:{type:'craft',item:'stone_shovel',count:1,keepTable:true}},0).catch(()=>{});
 assert.deepEqual(sub,['stick x4']);
 assert.ok(logs.some(l=>/stone_shovel needs 2 sticks and 1 are held; crafting 4 first/.test(l)),JSON.stringify(logs));
 // no planks: the old error, no stick craft
 inv.stick=1;inv.oak_planks=0;sub.length=0;
 await assert.rejects(Worker.prototype.craft.call(w,{spec:{type:'craft',item:'stone_shovel',count:1}},0),/Missing ingredients/);
 assert.deepEqual(sub,[]);
});
