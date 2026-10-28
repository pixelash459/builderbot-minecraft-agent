import test from 'node:test';
import assert from 'node:assert/strict';
import {Autopilot,FOOD_HEADINGS} from '../src/autopilot.js';
import {sprintAssist,ledgeGuard,SPRINT_FOOD,installSprintHold,newGait,gaitTick,guardPlace,builtLooking,installDigWatch} from '../src/worker.js';
import {EventEmitter} from 'node:events';
import {Vec3} from 'vec3';

// Round 66: the round-65 soak on seed 20261027.
test('round 66: with no graze biome the food search keeps one heading, and turns when set aside',()=>{
 const ap=Object.create(Autopilot.prototype);
 ap.worker={log(){},meals:{}};ap.log=()=>{};ap.state='';
 const h=ap.foodHeading('random');
 assert.ok(FOOD_HEADINGS.includes(h));
 for(let i=0;i<5;i++)assert.equal(ap.foodHeading('random'),h,'the same heading leg after leg');
 ap.deferFood('6 explore legs without food');
 const next=FOOD_HEADINGS[(FOOD_HEADINGS.indexOf(h)+1)%4];
 assert.equal(ap.foodHeading('random'),next,'a quarter turn after a set-aside');
 assert.equal(ap.foodHeading('south'),'south','a graze biome still wins');
});
test('round 66: a pathfinder walk on the ground runs; not hungry, in water, sneaking or standing still',()=>{
 const mk=(o={})=>{const ctl={forward:true,sprint:false,sneak:false,...(o.ctl||{})};
  return {ctl,bot:{food:o.food??20,entity:{onGround:o.onGround??true,isInWater:!!o.water},pathfinder:{isMoving:()=>o.moving??true},
   getControlState:k=>!!ctl[k],setControlState:(k,v)=>{ctl[k]=v;}}};};
 let t=mk();assert.equal(sprintAssist(t.bot),true);assert.equal(t.ctl.sprint,true);
 for(const o of [{food:SPRINT_FOOD},{water:true},{onGround:false},{moving:false},{ctl:{sneak:true}},{ctl:{forward:false}}]){
  t=mk(o);assert.equal(sprintAssist(t.bot),false,JSON.stringify(o));assert.equal(t.ctl.sprint,false,JSON.stringify(o));
 }
 assert.equal(SPRINT_FOOD,6);
});
test('round 67: the pathfinder own sprint-off is held back while running is wanted; combat and the ledge guard still let go',()=>{
 const ctl={forward:true,sprint:true,sneak:false},writes=[];
 const bot=Object.assign(new EventEmitter(),{food:20,entity:{onGround:true,isInWater:false},pathfinder:{isMoving:()=>true},
  getControlState:k=>!!ctl[k],setControlState:(k,v)=>{if(ctl[k]!==v&&k==='sprint')writes.push(v);ctl[k]=v;}});
 installSprintHold(bot);
 bot.on('physicsTick',()=>{bot.setControlState('sprint',false);}); // the pathfinder's monitorMovement verdict
 bot.on('physicsTick',()=>{bot.__pathTick=false;sprintAssist(bot);});  // the worker's listener
 for(let i=0;i<20;i++)bot.emit('physicsTick');
 assert.equal(ctl.sprint,true);assert.deepEqual(writes,[],'no off/on packet pairs');
 bot.setControlState('sprint',false); // outside the pathfinder's part of the tick: combat, the ledge guard
 assert.equal(ctl.sprint,false);
 ctl.sprint=true;bot.food=SPRINT_FOOD;bot.emit('physicsTick');
 assert.equal(ctl.sprint,false,'hungry: the pathfinder walk stands');
});
test('round 67: the gait gauge counts walking ticks only (forward down), not standing to dig',()=>{
 const g=newGait();let fwd=true;
 const bot={food:20,entity:{onGround:true},pathfinder:{isMoving:()=>true},getControlState:k=>k==='forward'?fwd:k==='sprint'&&fwd};
 for(let i=0;i<100;i++){fwd=i%2===0;gaitTick(bot,g,i*50);}
 assert.equal(g.walk,50);assert.equal(g.sprint,50);
});
test('round 67: a block placed against a chest sneaks (no window opened); against stone it does not',async()=>{
 const ctl={},log=[];
 const bot={getControlState:k=>!!ctl[k],setControlState:(k,v)=>{ctl[k]=v;log.push(k+'='+v);},
  placeBlock:async ref=>{log.push('place on '+ref.name+' sneak='+!!ctl.sneak);}};
 guardPlace(bot);
 await bot.placeBlock({name:'chest'},{x:1,y:0,z:0});
 assert.deepEqual(log,['sneak=true','place on chest sneak=true','sneak=false']);
 log.length=0;await bot.placeBlock({name:'stone'},{x:0,y:1,z:0});
 assert.deepEqual(log,['place on stone sneak=false']);
 log.length=0;await bot.placeBlock({name:'crafting_table'},{x:0,y:1,z:0});
 assert.ok(log.includes('place on crafting_table sneak=true'));
});
test('round 67: a broken block that looks built is logged with the job; a tree log is not',()=>{
 const world={};const at=(x,y,z,n)=>{world[x+','+y+','+z]=n;};
 at(0,70,0,'oak_log');at(1,72,0,'oak_leaves');at(10,70,0,'oak_log');
 const bot=Object.assign(new EventEmitter(),{blockAt:p=>({name:world[p.x+','+p.y+','+p.z]||'air'})});
 const logs=[];installDigWatch(bot,m=>logs.push(m),()=>'gather');
 bot.emit('diggingCompleted',{name:'oak_log',position:new Vec3(0,70,0)});
 bot.emit('diggingCompleted',{name:'oak_log',position:new Vec3(10,70,0)});
 bot.emit('diggingCompleted',{name:'spruce_planks',position:new Vec3(5,70,5)});
 bot.emit('diggingCompleted',{name:'stone',position:new Vec3(5,60,5)});
 assert.deepEqual(logs,['Dig: broke oak_log at (10, 70, 0) (no leaves within 3; job gather)','Dig: broke spruce_planks at (5, 70, 5) (looks built; job gather)']);
 assert.equal(builtLooking(bot,{name:'glass_pane'}),'looks built');
});
