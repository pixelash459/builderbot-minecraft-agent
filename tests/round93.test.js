// Round 93 (round-92 hard1: the noon box opened with a skeleton 13.5 away, 19 s of digging the
// walls down with the pickaxe held, shot from 15.4 to 0 by two skeletons at 4.9 and 5.8, and no
// Reflex line - the shelter hold kept Mob Defense off): once the walls beside the bot are open,
// a hostile within 8 or a fresh hit lets Mob Defense through, and the paused job keeps that for
// OPENED_GUARD_MS.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {Vec3} from 'vec3';
import {Worker,nightMineOverride,OPENED_GUARD_MS} from '../src/worker.js';
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
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r93-'));
 const worker=new Worker(root,{limits:{minHealth:10,minFood:6,jobMinutes:5}});
 const bot=gateBot(solid),logs=[];worker.ready=true;worker.bot=bot;worker.movements={id:'normal'};worker.log=m=>logs.push(m);
 const md=worker.taskRunner.chains.find(c=>c.name==='Mob Defense'),ctx=worker.taskRunner.ctx;
 try{await fn({worker,bot,logs,md,ctx});}finally{worker.taskRunner.stop();fs.rmSync(root,{recursive:true,force:true});}
}
const skeleton=(id,dx,dz=0)=>({id,name:'skeleton',type:'hostile',isValid:true,height:1.99,position:P.offset(0.5+dx,0,0.5+dz),metadata:{},velocity:new Vec3(0,0,0)});
test('nightMineOverride: an exposed box counts like the night mine',()=>{
 const hold={job:{spec:{type:'shelter'}},sealed:false};
 assert.equal(nightMineOverride('Mob Defense',{...hold,exposed:true},'a skeleton within 8'),true);
 assert.equal(nightMineOverride('Mob Defense',{...hold,exposed:true},null),false);
 assert.equal(nightMineOverride('Food',{...hold,exposed:true},'a hit'),false);
 assert.equal(nightMineOverride('Mob Defense',hold,'a hit'),false);
 assert.equal(OPENED_GUARD_MS,60000);
});
test('the round-92 hard1 noon box: walls standing hold Mob Defense off; a wall beside the bot open lets it through',async()=>{
 const solid=column();
 await withWorker(solid,async({worker,bot,logs,md,ctx})=>{
  const job={id:'s',spec:{type:'shelter'},status:'running',message:'Removing the shelter',placed:[]};
  worker.jobs.push(job);worker.shelterSealed=false;worker.shelterOpening=true;
  bot.entities={5:skeleton(5,4.9)};
  assert.equal(md.priority(bot,ctx),-1,'the column stands: the walls are the answer');
  solid.delete('837,89,-533');
  assert.ok(md.priority(bot,ctx)>=0,'a head cell dug: Mob Defense answers the skeleton at 4.9');
  assert.ok(logs.includes('Reflex: a skeleton within 8 with the box open; Mob Defense answers'),logs.join('\n'));
  assert.ok(Date.now()-job.openedUnder<1000,'the job is marked');
 });
});
test('a fresh hit with no hostile within 8 lets it through too, and nothing near with no hit does not',async()=>{
 const solid=column();solid.delete('838,88,-534');
 await withWorker(solid,async({worker,bot,md,ctx})=>{
  worker.jobs.push({id:'s',spec:{type:'shelter'},status:'running',message:'Removing the shelter',placed:[]});
  worker.shelterOpening=true;
  bot.entities={};
  assert.equal(md.priority(bot,ctx),-1,'nothing near, no hit: the job digs on');
  worker.hurtAt=Date.now();
  assert.equal(worker.mineThreat(bot),'a hit','a hit in the last 3 s is the threat');
 });
});
test('the paused job keeps the override for OPENED_GUARD_MS; a sealed box and a box still building do not get it',async()=>{
 const solid=column();solid.delete('838,88,-534');
 await withWorker(solid,async({worker,bot,md,ctx})=>{
  const job={id:'s',spec:{type:'shelter'},status:'paused',message:'Reflex: preempted by Mob Defense',placed:[],openedUnder:Date.now()};
  worker.jobs.push(job);
  bot.entities={5:skeleton(5,5)};
  assert.equal(worker.survivalHold().opened,true);
  assert.ok(md.priority(bot,ctx)>=0,'paused after the walls opened: Mob Defense still answers');
  job.openedUnder=Date.now()-OPENED_GUARD_MS-1000;
  assert.equal(worker.survivalHold().opened,false);
  assert.equal(md.priority(bot,{...ctx}),-1,'past the guard: the job gets its turn');
 });
 await withWorker(column(),async({worker,bot,md,ctx})=>{
  worker.jobs.push({id:'s',spec:{type:'shelter'},status:'running',message:'Working',placed:[]});
  bot.entities={5:skeleton(5,5)};
  worker.shelterSealed=true;
  assert.equal(md.priority(bot,ctx),-1,'sealed: no override');
  worker.shelterSealed=false;worker.shelterOpening=false;
  bot.blockAt=()=>({name:'air',boundingBox:'empty'});
  bot.entities={5:skeleton(5,5)};
  assert.equal(md.priority(bot,ctx),-1,'still building, the walls not up yet: the old hold');
 });
});
