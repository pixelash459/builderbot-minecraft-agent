import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';
import {withControl,gotoPoint} from '../src/reflexes.js';
// pump logs every interrupted job through console.error; keep the test output readable.
console.error=()=>{};
// Deterministic interleaving: each setImmediate turn drains all pending microtasks.
const flush=async n=>{for(let i=0;i<(n||1);i++)await new Promise(r=>setImmediate(r));};
let seq=0;
function makeBot(){
 const calls=[];
 const bot=new EventEmitter();
 let gotoNext=()=>new Promise(()=>{});
 const pathfinder={
  movements:null,goal:undefined,
  setGoal(g){calls.push(['setGoal',g]);this.goal=g;},
  stop(){calls.push(['stop']);},
  setMovements(m){calls.push(['setMovements',m]);this.movements=m;},
  // A goto that resolves has arrived (round 21: navigate checks the goal really is reached).
  goto(goal){calls.push(['goto',goal]);this.goal=goal;return Promise.resolve(gotoNext()).then(v=>{if(goal&&goal.x!==undefined)bot.entity.position=new Vec3(goal.x,goal.y??bot.entity.position.y,goal.z);return v;});} // the real pathfinder installs the goal on goto
 };
 Object.assign(bot,{
  entities:{},health:20,food:20,oxygenLevel:20,time:{timeOfDay:1000},
  clearControlStates(){calls.push(['clear']);},
  setControlState(name,value){calls.push(['control',name,value]);},
  entity:{onGround:false,position:new Vec3(0,-60,0)},
  pathfinder,
  registry:{blocksByName:{dirt:{id:1},cobblestone:{id:2},oak_log:{id:3}}},
  inventory:{items(){return [];},emptySlotCount(){return 36;},slots:[]},
  blockAt(){return null;},findBlock(){return null;},findBlocks(){return [];},
  stopDigging(){return {catch(){}};}
 });
 return {bot,calls,goto:setter=>{gotoNext=setter;}};
}
function withWorker(fn){
 const {bot,calls,goto}=makeBot();
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'ownership-test-'));
 const worker=new Worker(root,{limits:{minHealth:10,minFood:6,jobMinutes:5}});
 worker.ready=true;worker.bot=bot;
 worker.movements={id:'normal'};
 worker.exploreMovements=()=>({id:'explore'});
 return Promise.resolve().then(()=>fn({worker,bot,calls,goto})).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
}
// Start a goto job through the real pump and wait until its navigation is in flight. The
// pump promise is returned in a box: returning it bare from this async helper would adopt
// it and silently wait for the job to settle before the caller can fire the stop.
async function startJob(worker,bot){
 worker.jobs.push({id:'job'+(++seq),spec:{type:'goto',position:{x:8,y:-60,z:0}},status:'queued',created:new Date().toISOString(),progress:0,message:'Waiting'});
 const pumping=worker.pump();
 for(let i=0;i<100&&bot.pathfinder.goal===undefined;i++)await flush(4);
 assert.ok(bot.pathfinder.goal,'the job navigation started');
 return {pumping};
}
test('a finishing job still cleans the pathfinder as the owner',async()=>{
 await withWorker(async({worker,bot,calls,goto})=>{
  goto(()=>Promise.resolve());
  const {pumping}=await startJob(worker,bot);
  await pumping;await flush(10);
  assert.equal(worker.jobs[0].status,'complete');
  assert.ok(calls.some(c=>c[0]==='setGoal'&&c[1]===null),'the owner cleared the goal');
  assert.ok(calls.some(c=>c[0]==='clear'),'the owner cleared the control states');
  assert.equal(bot.pathfinder.goal,null);
 });
});
test('a late job cleanup cannot cancel the reflex that took over',async()=>{
 await withWorker(async({worker,bot,calls,goto})=>{
  let resolveGoto;goto(()=>new Promise(r=>resolveGoto=r));
  const {pumping}=await startJob(worker,bot);
  worker.stop('Reflex: hostile near','reflex'); // epoch bumps; the job unwinding is still pending
  await pumping;await flush(8); // pump unwinds its race and finally; the job navigation is NOT done
  assert.equal(worker.jobs[0].status,'paused');
  const reflexGoal={isEnd:()=>true};
  bot.pathfinder.setGoal(reflexGoal); // the reflex takes over
  bot.pathfinder.setMovements({id:'reflex'});
  const mark=calls.length;
  resolveGoto(); // the job's pending finally now fires, late, while the reflex navigates
  await worker.runSettled; // the real reflex handoff signal
  assert.deepEqual(calls.slice(mark),[],'the stale job cleanup must be skipped entirely');
  assert.equal(bot.pathfinder.goal,reflexGoal,'the reflex goal survived the stale unwind');
  assert.equal(bot.pathfinder.movements.id,'reflex','the reflex movements survived');
 });
});
test('a user stop cleans up at once and a stale cleanup stays skipped',async()=>{
 await withWorker(async({worker,bot,calls,goto})=>{
  let resolveGoto;goto(()=>new Promise(r=>resolveGoto=r));
  const {pumping}=await startJob(worker,bot);
  const before=calls.length;
  worker.stop('Stopped by user');
  const taken=calls.slice(before);
  assert.ok(taken.some(c=>c[0]==='stop')&&taken.some(c=>c[0]==='setGoal'&&c[1]===null)&&taken.some(c=>c[0]==='clear'),'stop() resets the pathfinder itself');
  assert.ok(taken.some(c=>c[0]==='setMovements'&&c[1]===worker.movements),'stop() restores the normal movements');
  assert.equal(worker.userStopped,true);
  const mark=calls.length;
  resolveGoto();
  await worker.runSettled;await pumping;
  assert.deepEqual(calls.slice(mark),[],'no late job cleanup after a user stop');
  assert.equal(worker.jobs[0].status,'paused');
  assert.equal(bot.pathfinder.movements,worker.movements,'movements stay normal');
 });
});
test('a stale explore leg cannot restore movements over the reflex',async()=>{
 await withWorker(async({worker,bot,calls,goto})=>{
  let resolveGoto;goto(()=>new Promise(r=>resolveGoto=r));
  bot.pathfinder.setMovements(worker.movements);
  const leg=worker.exploreLeg(0,{direction:'north',distance:8,seconds:30}).catch(e=>e); // token 0 is current
  for(let i=0;i<200&&bot.pathfinder.movements.id!=='explore';i++)await flush(4);
  assert.equal(bot.pathfinder.movements.id,'explore','the leg installed its movements');
  worker.stop('Reflex: hostile near','reflex'); // epoch 0 -> 1; stop() resets the movements
  bot.pathfinder.setMovements({id:'reflex'});
  bot.pathfinder.setGoal({isEnd:()=>true});
  const mark=calls.length;
  resolveGoto();
  const outcome=await leg;
  assert.ok(outcome instanceof Error,'the stale leg failed instead of restoring');
  assert.deepEqual(calls.slice(mark),[],'no movement restore and no goal clear after the reflex took over');
  assert.equal(bot.pathfinder.movements.id,'reflex','the reflex movements were not overwritten');
 });
});
test('withControl waits for the job to unwind, then owns and releases control',async()=>{
 await withWorker(async({worker,bot,calls,goto})=>{
  let resolveGoto,first=true;
  goto(()=>{if(first){first=false;return new Promise(r=>resolveGoto=r);}return Promise.resolve();});
  const {pumping}=await startJob(worker,bot);
  const epochBefore=worker.epoch;
  let acted=false;
  const control=withControl(worker,'unit test',async()=>{
   acted=true;
   await gotoPoint(worker,{isEnd:()=>true},1);
  });
  await flush(20);
  assert.equal(acted,false,'the reflex must wait for the interrupted job to unwind first');
  resolveGoto();
  await control;
  assert.equal(acted,true);
  assert.equal(worker.epoch,epochBefore+2,'stop and release each bump the epoch');
  assert.equal(worker.controlToken,null,'ownership is released');
  assert.equal(bot.pathfinder.movements.id,'normal','the reflex owner restored the movements');
  for(let i=0;i<200&&worker.jobs[0].status!=='complete';i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(worker.jobs[0].status,'complete','the paused job resumed with a fresh token and finished');
  await pumping;
 });
});
test('a reflex that lost ownership mid-flee stops grabbing the pathfinder',async()=>{
 await withWorker(async({worker,bot,calls,goto})=>{
  worker.controlToken=worker.epoch; // as withControl does while its action runs
  bot.pathfinder.setMovements({id:'previous'});
  let killGoto;goto(()=>new Promise((_,reject)=>killGoto=reject));
  const goal={isEnd:()=>false};
  const leg=gotoPoint(worker,goal,30).catch(e=>e);
  await flush(4);
  assert.equal(bot.pathfinder.goal,goal,'the owner reflex is navigating');
  worker.stop('Stopped by user'); // epoch moves while the reflex leg is in flight
  const mark=calls.length;
  killGoto(new Error('interrupted')); // the pathfinder goal died with the stop
  await leg;
  assert.deepEqual(calls.slice(mark),[],'the stale reflex leg cleaned up nothing itself');
  assert.equal(bot.pathfinder.goal,null,'the taker cleaned the pathfinder');
  assert.equal(bot.pathfinder.movements,worker.movements,'movements are the normal ones, not the stale restore');
 });
});
