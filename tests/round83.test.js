import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,guardDiagonals,UNARMED_CLEAR} from '../src/worker.js';
import {MobDefenseChain,CREEPER_MEAL_NEAR,MEAL_CLEAR} from '../src/chains/mobDefenseChain.js';
import {FoodChain} from '../src/chains/foodChain.js';
import {RunAwayFromCreepersTask} from '../src/chains/fallbackTasks.js';

// Round 83: the round-82 soak on the Nitrous world copy, and upstream mineflayer-pathfinder #393.
test('round 83: no diagonal that lands one block up (#393); flat diagonals with both sides clear still go',()=>{
 const solid=new Set();
 let called=0;
 const mv={getBlock:(node,dx,dy,dz)=>({physical:solid.has(dx+','+dy+','+dz)}),getMoveDiagonal:()=>{called++;}};
 guardDiagonals(mv);
 const node={x:0,y:64,z:0},dir={x:1,z:1};
 mv.getMoveDiagonal(node,dir,[]);assert.equal(called,1,'flat, both sides clear');
 solid.add('1,0,1');mv.getMoveDiagonal(node,dir,[]);assert.equal(called,1,'the landing cell is a step up: refused');
 solid.clear();solid.add('1,1,0');mv.getMoveDiagonal(node,dir,[]);assert.equal(called,1,'a side blocked: refused as before');
 solid.clear();mv.getMoveDiagonal(node,dir,[]);assert.equal(called,2);
});
const creeperAt=(me,dx,fusing=false)=>({id:7,name:'creeper',type:'hostile',position:me.offset(dx,0,0),metadata:fusing?{16:1}:{16:-1}});
const keepAwayBot=(hp,mobs)=>{
 const me=new Vec3(827.5,90,-452.5);
 const ents={};mobs(me).forEach((e,i)=>{ents[i+1]=e;});
 return {health:hp,food:17,entity:{position:me},entities:ents,inventory:{items:()=>[{name:'beef',count:3}],slots:[]},
  blockAt:p=>({name:'air',boundingBox:'empty',position:p}),registry:{foodsByName:{beef:{foodPoints:3,saturation:1.8}}}};
};
const keeping=md=>{md.root=new RunAwayFromCreepersTask(20);md._cachedLastPriority=60;md._cachedAt=Date.now();return md;};
test('round 83: a meal at low health goes ahead through a creeper keep-away that leaves room for one',()=>{
 assert.equal(CREEPER_MEAL_NEAR,5);assert.equal(MEAL_CLEAR,8);
 const md=keeping(new MobDefenseChain()),f=new FoodChain({mobDefense:md});md.food=f;
 const ctx={worker:{jobs:[]}};
 // round-82 hard3: hp 2.2, food 17, the creeper 6-8 away and not fusing
 const bot=keepAwayBot(2.2,me=>[creeperAt(me,7)]);
 assert.equal(md.mealKeepAway(bot,ctx),true);
 assert.equal(f.keepAwayMeal(bot,ctx),true);
 assert.equal(f.deferReason(bot,ctx),null,'no mid-fight deferral');
 // the creeper inside 5, or fusing, or a zombie within 8: the keep-away stays a fight
 assert.equal(f.deferReason(keepAwayBot(2.2,me=>[creeperAt(me,4)]),ctx),'mid-fight (Mob Defense active)');
 assert.equal(f.deferReason(keepAwayBot(2.2,me=>[creeperAt(me,7,true)]),ctx),'mid-fight (Mob Defense active)');
 assert.equal(f.deferReason(keepAwayBot(2.2,me=>[creeperAt(me,7),{id:8,name:'zombie',type:'hostile',position:me.offset(0,0,6)}]),ctx),'mid-fight (Mob Defense active)');
 // health 10 or more: no meal through the keep-away
 assert.equal(f.keepAwayMeal(keepAwayBot(12,me=>[creeperAt(me,7)]),ctx),false);
 // a different hold (the hostile run-away) is not a keep-away
 const md2=new MobDefenseChain();md2.root={name:'RunAwayFromHostilesTask'};md2._cachedLastPriority=80;md2._cachedAt=Date.now();
 assert.equal(md2.mealKeepAway(bot,ctx),false);
});
test('round 83: the meal through the keep-away is logged once per episode',()=>{
 const logs=[],md=keeping(new MobDefenseChain()),f=new FoodChain({mobDefense:md});md.food=f;
 md._doingFunkyStuff=true;
 let started=0;f.startEat=()=>{started++;};
 const ctx={worker:{jobs:[],log:m=>logs.push(m)}};
 const bot=keepAwayBot(2.2,me=>[creeperAt(me,7)]);
 bot.game={gameMode:'survival'};bot.isAlive=true;
 f.calculateFood=()=>({total:9,best:{name:'beef',fills:3},items:3});
 f.priority(bot,ctx);f.priority(bot,ctx);
 assert.equal(started,2,'the acrobatics gate stands aside');
 assert.deepEqual(logs.filter(m=>m.startsWith('Food: eating through')),['Food: eating through the creeper keep-away (health 2.2, food 17)']);
});
test('round 83: an armed bot\'s flee line names the gate that refused the fight',()=>{
 const logs=[],md=new MobDefenseChain();
 const me=new Vec3(854.5,84,-587.5),hostiles=[{name:'skeleton',position:me.offset(9,0,0)},{name:'zombie',position:me.offset(0,0,10)}];
 const bot={entity:{position:me},inventory:{items:()=>[]}};
 const ctx={worker:{log:m=>logs.push(m)}};
 md._escapeLadder(bot,ctx,hostiles,{},{weapon:{name:'iron_sword'},allowed:false,reason:'health 11 below 14',daylight:false});
 assert.equal(logs.at(-1),'Reflex: fleeing skeleton,zombie (armed, but health 11 below 14 - COMBAT_SPEC 7f)');
 md._fleeTag=null;
 md._escapeLadder(bot,ctx,hostiles,{},{weapon:null,allowed:false,reason:'no real weapon (sword/axe)',daylight:false});
 assert.equal(logs.at(-1),'Reflex: fleeing skeleton,zombie (unarmed - COMBAT_SPEC 7f)');
});
test('round 83: with no weapon held the morning crowd is counted out to 32',async()=>{
 assert.equal(UNARMED_CLEAR,32);
 const logs=[],radii=[];let t=0,items=[];
 const real=Date.now;Date.now=()=>t;
 const timers=globalThis.setTimeout;
 try{
  const w=Object.assign(Object.create(Worker.prototype),{log:m=>logs.push(m),check(){},deadline:Infinity,
   bot:{inventory:{items:()=>items}},nearestOf:()=>({d:Infinity,name:null}),
   hostilesWithin:r=>{radii.push(r);return r>=32?(t>=30000?2:7):3;}});
  globalThis.setTimeout=(fn,ms)=>{t+=ms;return timers(fn,0);};
  // round-82 hard2: respawned, no sword, the canopy crowd beyond 16
  await w.waitCreeperClear(0);
  assert.equal(radii[0],32);
  assert.equal(logs[0],'Shelter: 7 hostiles within 32 (no weapon held); keeping the walls up');
  assert.equal(logs.at(-1),'Shelter: 2 hostiles within 32; opening the walls');
  // armed: the 16 of round 81, and 3 there is no crowd
  logs.length=0;radii.length=0;items=[{name:'stone_sword',count:1}];
  await w.waitCreeperClear(0);
  assert.deepEqual(radii,[16]);assert.equal(logs.length,0);
 }finally{globalThis.setTimeout=timers;Date.now=real;}
});
