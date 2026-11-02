import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {Vec3} from 'vec3';
import {Worker,nightMineOverride,RESPAWN_GUARD_MS} from '../src/worker.js';
console.error=()=>{};

// Round 85: the round-84 soak on the Nitrous world copy (hard1's nine deaths at the world spawn).
test('round 85: a shelter after a death is guarded until it seals or the guard runs out',()=>{
 assert.equal(RESPAWN_GUARD_MS,180000);
 const shelter={status:'running',spec:{type:'shelter'}};
 const w=Object.assign(Object.create(Worker.prototype),{jobs:[shelter],shelterSealed:false});
 assert.equal(w.survivalHold().respawned,false,'no death: the hold stands as before');
 w.lastDeath={pos:null,t:Date.now()-1000};
 assert.equal(w.survivalHold().respawned,true);
 w.shelterSealed=true;
 assert.equal(w.survivalHold().respawned,false,'sealed (box or burrow): the walls are the answer');
 w.shelterSealed=false;w.lastDeath.t=Date.now()-RESPAWN_GUARD_MS-1000;
 assert.equal(w.survivalHold().respawned,false,'the guard runs out');
 // queued behind the death pause: guarded too
 w.lastDeath.t=Date.now();shelter.status='queued';
 assert.equal(w.survivalHold().respawned,true);
 w.jobs=[{status:'running',spec:{type:'eat'}}];
 assert.equal(w.survivalHold().respawned,false,'an eat job is not a shelter');
 const hold={job:shelter,sealed:false,mining:false,respawned:true};
 assert.equal(nightMineOverride('Mob Defense',hold,'a zombie within 8'),true);
 assert.equal(nightMineOverride('Mob Defense',hold,null),false);
 assert.equal(nightMineOverride('Food',hold,'a hit'),false);
});

test('round 85: the death itself is not a hit',()=>{
 const bot={entity:{position:new Vec3(0,0,0)},entities:{},health:20};
 const w=Object.assign(Object.create(Worker.prototype),{bot,busy:false,config:{limits:{minHealth:6,minFood:6}}});
 w.onHealth(bot);bot.health=0;w.onHealth(bot);
 assert.equal(w.mineThreat(bot),null);
 bot.health=20;w.onHealth(bot);assert.equal(w.mineThreat(bot),null,'the respawn heal is not a hit');
 bot.health=15;w.onHealth(bot);assert.equal(w.mineThreat(bot),'a hit');
});

function gateBot(){
 const bot=new EventEmitter();
 Object.assign(bot,{entities:{},health:20,food:20,time:{timeOfDay:18000,day:3},
  clearControlStates(){},setControlState(){},entity:{onGround:true,position:new Vec3(712,71,-422),metadata:[0],height:1.8},
  pathfinder:{movements:null,setGoal(){},stop(){},setMovements(m){this.movements=m;},goto(){return new Promise(()=>{});}},
  registry:{blocksByName:{},foodsByName:{},itemsByName:{}},inventory:{items(){return [];},emptySlotCount(){return 36;},slots:[]},
  blockAt(){return null;},findBlock(){return null;},findBlocks(){return [];},stopDigging(){return {catch(){}};},respawn(){},
  look(){return Promise.resolve();},lookAt(){return Promise.resolve();}});
 return bot;
}
test('round 85: a zombie at 5 during the respawn shelter - Mob Defense answers; without the death it does not',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r85-'));
 const worker=new Worker(root,{limits:{minHealth:10,minFood:6,jobMinutes:5}});
 const bot=gateBot(),logs=[];worker.ready=true;worker.bot=bot;worker.movements={id:'normal'};worker.log=m=>logs.push(m);
 try{
  const md=worker.taskRunner.chains.find(c=>c.name==='Mob Defense'),ctx=worker.taskRunner.ctx;
  worker.jobs.push({id:'s',spec:{type:'shelter'},status:'running',message:'Working'});
  worker.shelterSealed=false;
  bot.entities={4:{id:4,name:'zombie',type:'hostile',isValid:true,height:1.95,position:new Vec3(717,71,-422),velocity:new Vec3(0,0,0),metadata:[]}};
  assert.equal(md.priority(bot,ctx),-1,'no death: the shelter hold keeps Mob Defense off');
  worker.lastDeath={pos:{x:712,y:71,z:-422},t:Date.now()};
  assert.ok(md.priority(bot,ctx)>=0,'after a death: Mob Defense answers the zombie');
  assert.ok(logs.includes('Reflex: a zombie within 8 after a night respawn; Mob Defense answers'),logs.join('\n'));
  worker.shelterSealed=true;
  assert.equal(md.priority(bot,ctx),-1,'sealed: the hold is back');
 }finally{worker.taskRunner.stop();fs.rmSync(root,{recursive:true,force:true});}
});
