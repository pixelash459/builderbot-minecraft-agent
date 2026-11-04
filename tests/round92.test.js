// Round 92 (round-91 hard2: the box opening at noon, `creeper at 6.0 overrides the shelter hold`
// 1.5 s in, and 4.5 min of a creeper flee that never moved the bot - the walls beside it were
// still up - until the day was gone): a box coming down holds against a creeper while the bot's
// own column (feet ring, head ring, roof) stands.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {Vec3} from 'vec3';
import {Worker,walledIn} from '../src/worker.js';
console.error=()=>{};
const P=new Vec3(817,88,-552);
const column=()=>{const s=new Set(['817,90,-552']);for(const dy of [0,1])for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]])s.add((817+dx)+','+(88+dy)+','+(-552+dz));return s;};
function gateBot(solid){
 const bot=new EventEmitter();
 Object.assign(bot,{entities:{},health:20,food:20,time:{timeOfDay:7020,day:3},
  clearControlStates(){},setControlState(){},entity:{onGround:true,position:P.offset(0.5,0,0.5),metadata:[0],height:1.8},
  pathfinder:{movements:null,setGoal(){},stop(){},setMovements(m){this.movements=m;},goto(){return new Promise(()=>{});}},
  registry:{blocksByName:{},foodsByName:{},itemsByName:{}},inventory:{items(){return [];},emptySlotCount(){return 36;},slots:[]},
  blockAt(v){return solid.has(v.x+','+v.y+','+v.z)?{name:'cobblestone',boundingBox:'block',position:v}:{name:'air',boundingBox:'empty',position:v};},
  findBlock(){return null;},findBlocks(){return [];},stopDigging(){return {catch(){}};},respawn(){},
  look(){return Promise.resolve();},lookAt(){return Promise.resolve();}});
 return bot;
}
async function withWorker(solid,fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r92-'));
 const worker=new Worker(root,{limits:{minHealth:10,minFood:6,jobMinutes:5}});
 const bot=gateBot(solid),logs=[];worker.ready=true;worker.bot=bot;worker.movements={id:'normal'};worker.log=m=>logs.push(m);
 try{await fn({worker,bot,logs});}finally{worker.taskRunner.stop();fs.rmSync(root,{recursive:true,force:true});}
}
const creeper=(id,dx,{fusing=false}={})=>({id,name:'creeper',type:'hostile',isValid:true,height:1.7,position:P.offset(0.5+dx,0,0.5),metadata:fusing?{16:1}:{16:-1},velocity:new Vec3(0,0,0)});
test('walledIn: the feet ring, the head ring and the roof over the bot, all solid',()=>{
 const s=column(),bot={entity:{position:P.offset(0.5,0,0.5)},blockAt:v=>s.has(v.x+','+v.y+','+v.z)?{boundingBox:'block'}:{boundingBox:'empty'}};
 assert.equal(walledIn(bot),true);
 for(const k of [...column()]){s.delete(k);assert.equal(walledIn(bot),false,k+' open');s.add(k);}
 assert.equal(walledIn({entity:null}),false);
 assert.equal(walledIn({entity:{position:P},blockAt:()=>{throw Error('unloaded');}}),false);
});
test('the round-91 hard2 morning: a creeper at 6 while the box comes down does not override the hold while the column stands',async()=>{
 const solid=column();
 await withWorker(solid,async({worker,bot,logs})=>{
  const md=worker.taskRunner.chains.find(c=>c.name==='Mob Defense'),ctx=worker.taskRunner.ctx;
  worker.jobs.push({id:'s',spec:{type:'shelter'},status:'running',message:'Removing the shelter'});
  worker.shelterSealed=false;worker.shelterOpening=true;
  bot.entities={9:creeper(9,6)};
  assert.equal(md.priority(bot,ctx),-1,'walled: the creeper at 6 waits on the walls');
  bot.entities={9:creeper(9,3,{fusing:true})};
  assert.equal(md.priority(bot,ctx),-1,'a fuse too, as in a sealed box');
  assert.ok(!logs.some(l=>/overrides the shelter hold/.test(l)),logs.join('\n'));
  // the walls beside the bot come down: the override is back
  solid.delete('818,88,-552');
  bot.entities={9:creeper(9,6)};
  assert.ok(md.priority(bot,ctx)>=0,'a feet cell open: Mob Defense takes over');
  assert.ok(logs.some(l=>/^Reflex: creeper at 6\.0 overrides the shelter hold/.test(l)),logs.join('\n'));
 });
});
test('a shelter still placing its walls, and a box not coming down, keep the old override',async()=>{
 await withWorker(column(),async({worker,bot})=>{
  const md=worker.taskRunner.chains.find(c=>c.name==='Mob Defense'),ctx=worker.taskRunner.ctx;
  worker.jobs.push({id:'s',spec:{type:'shelter'},status:'running',message:'Working'});
  worker.shelterSealed=false;worker.shelterOpening=false;
  bot.entities={9:creeper(9,5)};
  assert.ok(md.priority(bot,ctx)>=0,'building (not opening): a creeper at 5 takes over, walled or not');
 });
 await withWorker(column(),async({worker,bot})=>{
  const md=worker.taskRunner.chains.find(c=>c.name==='Mob Defense'),ctx=worker.taskRunner.ctx;
  worker.jobs.push({id:'e',spec:{type:'eat'},status:'running',message:'Working'});
  worker.shelterOpening=true;
  bot.entities={9:creeper(9,5)};
  assert.ok(md.priority(bot,ctx)>=0,'an eat hold is not a box: the creeper overrides');
 });
});
test('removeShelter marks the box as coming down and clears the mark when it ends or throws',async()=>{
 await withWorker(column(),async({worker})=>{
  let seen=null;
  worker._removeShelter=async()=>{seen=worker.shelterOpening;throw Error('Job interrupted');};
  await assert.rejects(worker.removeShelter({},{}),/Job interrupted/);
  assert.equal(seen,true);assert.equal(worker.shelterOpening,false);
  worker._removeShelter=async()=>{seen=worker.shelterOpening;};
  await worker.removeShelter({},{});
  assert.equal(seen,true);assert.equal(worker.shelterOpening,false);
 });
});
