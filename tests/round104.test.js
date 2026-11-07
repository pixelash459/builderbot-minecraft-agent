// Round 104 (round-103 hard2: a zombie hit the bot on its way home up the night mine; Mob Defense
// took over, the paused shelter no longer counted as mining, it resumed 0.3 s later, began a new box
// in the tunnel with 5 hostiles within 8, and the bot was slain 5 s later): the paused job keeps the
// night mine's override for OPENED_GUARD_MS, as an opened box does.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {Vec3} from 'vec3';
import {Worker,OPENED_GUARD_MS} from '../src/worker.js';
console.error=()=>{};
const P=new Vec3(837,88,-534);
const column=()=>{const s=new Set(['837,90,-534']);for(const dy of [0,1])for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]])s.add((837+dx)+','+(88+dy)+','+(-534+dz));return s;};
function gateBot(solid){
 const bot=new EventEmitter();
 Object.assign(bot,{entities:{},health:15.4,food:20,time:{timeOfDay:6000,day:3},
  clearControlStates(){},setControlState(){},entity:{onGround:true,position:P.offset(0.5,0,0.5),metadata:[0],height:1.8},
  pathfinder:{movements:null,setGoal(){},stop(){},setMovements(m){this.movements=m;},goto(){return new Promise(()=>{});}},
  registry:{blocksByName:{},foodsByName:{},itemsByName:{}},inventory:{items(){return [];},emptySlotCount(){return 36;},slots:[]},
  blockAt(v){return solid.has(v.x+','+v.y+','+v.z)?{name:'cobblestone',boundingBox:'block',position:v}:{name:'air',boundingBox:'empty',position:v};},
  findBlock(){return null;},findBlocks(){return [];},stopDigging(){return {catch(){}};},respawn(){},
  look(){return Promise.resolve();},lookAt(){return Promise.resolve();}});
 return bot;
}
async function withWorker(solid,fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r104-'));
 const worker=new Worker(root,{limits:{minHealth:10,minFood:6,jobMinutes:5}});
 const bot=gateBot(solid),logs=[];worker.ready=true;worker.bot=bot;worker.movements={id:'normal'};worker.log=m=>logs.push(m);
 const md=worker.taskRunner.chains.find(c=>c.name==='Mob Defense'),ctx=worker.taskRunner.ctx;
 try{await fn({worker,bot,logs,md,ctx});}finally{worker.taskRunner.stop();fs.rmSync(root,{recursive:true,force:true});}
}
const skeleton=(id,dx,dz=0)=>({id,name:'skeleton',type:'hostile',isValid:true,height:1.99,position:P.offset(0.5+dx,0,0.5+dz),metadata:{},velocity:new Vec3(0,0,0)});
const zombie=(id,dx,dz=0)=>({id,name:'zombie',type:'hostile',isValid:true,height:1.95,position:P.offset(0.5+dx,0,0.5+dz),metadata:{},velocity:new Vec3(0,0,0)});
const LINE='Reflex: the shelter job waits off the night mine while Mob Defense answers ';
test('round 104: the round-103 hard2 night mine: hit on the way home, the paused shelter waits while the zombies are near',async()=>{
 await withWorker(new Set(),async({worker,bot,logs,md,ctx})=>{
  const job={id:'s',spec:{type:'shelter'},status:'running',message:'Night mine',placed:[]};
  worker.jobs.push(job);worker.nightMining=true;worker.shelterSealed=false;
  bot.entities={5:zombie(5,0.8),6:zombie(6,2.1),7:skeleton(7,2.6)};worker.hurtAt=Date.now();
  assert.ok(md.priority(bot,ctx)>=0,'the hit on the night mine: Mob Defense answers');
  assert.ok(logs.includes('Reflex: a hit on the night mine; Mob Defense answers'),logs.join('\n'));
  assert.ok(Date.now()-job.minedUnder<1000,'the job is marked');
  // the runner pauses the job; nightMine's finally clears the flag
  job.status='paused';job.message='Reflex: preempted by Mob Defense';worker.nightMining=false;
  assert.equal(worker.survivalHold().mining,true);
  assert.ok(md.priority(bot,ctx)>=0,'paused: Mob Defense still answers the zombie at 0.8');
  assert.ok(md.priority(bot,ctx)>=0);
  assert.equal(logs.filter(l=>l.startsWith(LINE)).length,1,logs.join('\n'));
  assert.ok(logs.includes(LINE+'a hit'),logs.join('\n'));
  worker.hurtAt=0;
  assert.ok(md.priority(bot,ctx)>=0,'no fresh hit, the zombie still within 8: still answers');
 });
});
test('round 104: the tunnel clear, the paused shelter gets its turn; past the guard it gets it anyway',async()=>{
 await withWorker(new Set(),async({worker,bot,md,ctx})=>{
  const job={id:'s',spec:{type:'shelter'},status:'paused',message:'Reflex: preempted by Mob Defense',placed:[],minedUnder:Date.now()};
  worker.jobs.push(job);
  bot.entities={};worker.hurtAt=0;
  assert.equal(md.priority(bot,ctx),-1,'nothing within 8 and no hit: the job resumes');
  bot.entities={5:zombie(5,3)};
  job.minedUnder=Date.now()-OPENED_GUARD_MS-1000;
  assert.equal(worker.survivalHold().mining,false);
  assert.equal(md.priority(bot,ctx),-1,'past the guard: the old hold');
 });
});
test('round 104: a paused shelter that never mined keeps the old hold',async()=>{
 await withWorker(new Set(),async({worker,bot,logs,md,ctx})=>{
  worker.jobs.push({id:'s',spec:{type:'shelter'},status:'paused',message:'Reflex: preempted by Mob Defense',placed:[]});
  bot.entities={5:zombie(5,1)};worker.hurtAt=Date.now();
  assert.equal(worker.survivalHold().mining,false);
  assert.equal(md.priority(bot,ctx),-1);
  assert.equal(logs.some(l=>l.startsWith(LINE)),false);
 });
});
test('round 104: a sealed box after the mine, and a box still going up, keep the old hold',async()=>{
 await withWorker(new Set(),async({worker,bot,md,ctx})=>{
  const job={id:'s',spec:{type:'shelter'},status:'running',message:'Sealing',placed:[],minedUnder:Date.now()};
  worker.jobs.push(job);worker.nightMining=false;
  bot.entities={5:zombie(5,1)};worker.hurtAt=Date.now();
  worker.shelterSealed=true;
  assert.equal(md.priority(bot,ctx),-1,'back in a sealed box: the walls are the answer');
  worker.shelterSealed=false;
  assert.equal(md.priority(bot,ctx),-1,'the resumed job building its box: the old hold');
 });
});
