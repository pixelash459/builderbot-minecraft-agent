// Unit tests for the P4 port: trackers (blacklist, blocks, entities, storage) and the
// Baritone-independent movement tasks, on a fake bot (fake chunk/blockAt map, fake
// pathfinder). No live server is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {EventEmitter} from 'node:events';
import {Blacklist,ObjectBlacklist} from '../src/trackers/blacklist.js';
import {BlockTracker} from '../src/trackers/block-tracker.js';
import {EntityTracker} from '../src/trackers/entity-tracker.js';
import {ItemStorageTracker,containerTypeFromBlock} from '../src/trackers/storage.js';
import {GetToXZTask} from '../src/tasks/movement/get-to-xz-task.js';
import {GetToBlockTask} from '../src/tasks/movement/get-to-block-task.js';
import {ChunkSearchTask} from '../src/tasks/movement/chunk-search-task.js';
import {RunAwayFromPositionTask} from '../src/tasks/movement/run-away-from-position-task.js';
import {EscapeFromLavaTask,findSafeBlock,inLava} from '../src/tasks/movement/escape-from-lava-task.js';
import * as move from '../src/tasks/movement/move.js';
import {setDefaultMoveContext,createMoveApi} from '../src/tasks/movement/move.js';
import {createMoveTasks} from '../src/tasks/movement/factories.js';
import {createTrackers} from '../src/trackers/index.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Flat-memory guard: captured once at load; the last test asserts the whole run's RSS
// growth stayed small (P3's leak was 46.5 GB; anything past 512 MB here is a bug).
const START_RSS=process.memoryUsage().rss;
const SOLID=new Set(['stone','dirt','oak_log','oak_planks']);
const passableName=n=>['air','cave_air','void_air','water','lava','tall_grass'].includes(n);

// Fake bot: a block map keyed "x,y,z", one loaded chunk column at (0,0), a scripted
// pathfinder, and a plain EventEmitter surface for world events.
function makeBot({pos=[0,64,0],blocks={},gotoImpl}={}){
 const calls=[];
 const bot=new EventEmitter();
 const blockAt=p=>{
  const v=new Vec3(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z));
  const name=blocks[`${v.x},${v.y},${v.z}`]??'air';
  return {name,position:v,boundingBox:SOLID.has(name)?'block':'empty'};
 };
 const column={
  chunkX:0,chunkZ:0,
  getWorldHeight:()=>80,
  getBlock(v){return blockAt(new Vec3(v.x,v.y,v.z));} // fake column takes world coords
 };
 const pathfinder={
  movements:null,goal:null,
  setMovements(m){calls.push(['setMovements',m]);this.movements=m;},
  setGoal(g){calls.push(['setGoal',g]);this.goal=g;},
  stop(){calls.push(['stop']);},
  goto(goal){calls.push(['goto',goal]);this.goal=goal;return gotoImpl?gotoImpl(goal):sleep(20).then(()=>{});}
 };
 Object.assign(bot,{
  entities:{},username:'tester',health:20,food:20,oxygenLevel:20,oxygenMaximum:20,
  game:{dimension:'overworld'},
  entity:{id:1,onGround:true,position:new Vec3(...pos),metadata:[0]},
  blockAt,registry:{blocksByName:{}},
  clearControlStates(){calls.push(['clear']);},
  setControlState(name,value){calls.push(['control',name,value]);},
  lookAt:async()=>{},
  pathfinder,
  world:{
   columns:{'0,0':column},
   getLoadedColumn:(cx,cz)=>cx===0&&cz===0?column:null,
   on(...a){bot.on(...a);},off(...a){bot.off(...a);}
  }
 });
 return {bot,calls};
}
function makeCtx(bot,over={}){
 const worker={controlToken:0,epoch:0,movements:{name:'normal'},log(){},exploreMovements(){return {name:'explore'};}};
 return {worker,bot,config:{},trackers:{},blacklist:{},move:{},...over};
}

// --- blacklisting ---
test('Blacklist: wasRecently true within the timeout, false after it',()=>{
 let clock=0;
 const bl=new Blacklist({now:()=>clock});
 const at=new Vec3(3,64,2);
 bl.entity('zombie',at,5);
 assert.equal(bl.wasRecently('zombie',at),true);
 clock+=4000;
 assert.equal(bl.wasRecently('zombie',at),true);
 clock+=2000; // past the 5s timeout
 assert.equal(bl.wasRecently('zombie',at),false);
 // kinds and positions do not collide
 bl.entity('spider',at,5);
 assert.equal(bl.wasRecently('zombie',at),false);
 assert.equal(bl.wasRecently('spider',new Vec3(9,64,9)),false);
});

test('ObjectBlacklist: unreachable after the allowed failures, reset by a better approach',()=>{
 const {bot}=makeBot({pos:[0,64,0]});
 const bl=new ObjectBlacklist();
 const target=new Vec3(40,64,40);
 bl.blackListItem(bot,target,2);
 assert.equal(bl.unreachable(target),false); // 1 of 2
 bl.blackListItem(bot,target,2);
 assert.equal(bl.unreachable(target),false); // 2 of 2 (not > yet)
 bl.blackListItem(bot,target,2);
 assert.equal(bl.unreachable(target),true); // gave up
 // Getting meaningfully closer resets the counter (port of the Java best-distance reset).
 bot.entity.position=new Vec3(35,64,35);
 bl.blackListItem(bot,target,2);
 assert.equal(bl.unreachable(target),false);
});

// --- BlockTracker ---
test('BlockTracker: finds, re-finds after world changes, and clears on invalidate',()=>{
 const blocks={'2,63,2':'dirt','2,64,2':'oak_log','5,64,5':'oak_log','9,64,9':'oak_log'};
 const {bot}=makeBot({pos:[0,64,0],blocks});
 const tracker=new BlockTracker({scanInterval:9999}); // manual scanning: only when we ask
 tracker.trackBlock(bot,'oak_log');
 const first=tracker.getNearestTracking(bot,['oak_log']);
 assert.ok(first,'expected a found log');
 assert.equal(`${first.x},${first.y},${first.z}`,'2,64,2');
 // World change: the nearest log is mined away. Validity cleanup re-finds the next one.
 delete blocks['2,64,2'];
 const second=tracker.getNearestTracking(bot,['oak_log']);
 assert.ok(second,'expected a re-found log');
 assert.equal(`${second.x},${second.y},${second.z}`,'5,64,5');
 // The stale entry is dropped, not served again.
 assert.equal(tracker.getKnownLocations(bot,'oak_log').some(p=>`${p.x},${p.y},${p.z}`==='2,64,2'),false);
 // Unreachable blacklisting skips a known position: with the default 4 allowed failures
 // it gives up on the 5th report (failures > allowed, exactly like the Java blacklist).
 for(let i=0;i<4;i++)tracker.requestBlockUnreachable(bot,new Vec3(5,64,5));
 assert.equal(tracker.unreachable(new Vec3(5,64,5)),false);
 tracker.requestBlockUnreachable(bot,new Vec3(5,64,5));
 assert.equal(tracker.unreachable(new Vec3(5,64,5)),true);
 const third=tracker.getNearestTracking(bot,['oak_log']);
 assert.equal(`${third.x},${third.y},${third.z}`,'9,64,9');
 // invalidate clears everything.
 tracker.invalidate();
 assert.equal(tracker.getKnownLocations(bot,'oak_log').length,0);
 assert.equal(tracker.anyFound(bot,'oak_log'),false);
});

test('BlockTracker: scanning slice discovers tracked blocks in loaded chunks',()=>{
 const blocks={'7,64,7':'diamond_ore'};
 const {bot}=makeBot({pos:[0,64,0],blocks});
 const tracker=new BlockTracker({scanInterval:0});
 tracker.trackBlock(bot,'diamond_ore');
 tracker.tick(bot);
 const found=tracker.getNearestTracking(bot,['diamond_ore']);
 assert.ok(found,'scan should discover the ore');
 assert.equal(`${found.x},${found.y},${found.z}`,'7,64,7');
});

// --- EntityTracker ---
test('EntityTracker: lists nearby entities by category and honours the give-up list',()=>{
 const {bot}=makeBot({pos:[0,64,0]});
 const zombie={id:2,name:'zombie',kind:'hostile',type:'mob',position:new Vec3(4,64,0),onGround:true};
 const cow={id:3,name:'cow',kind:'passive',type:'mob',position:new Vec3(12,64,0),onGround:true};
 const drop={id:4,name:'item',type:'item',position:new Vec3(1,64,1),onGround:true,metadata:[null,null,null,null,null,null,null,null,{name:'dirt',count:3}]};
 const player={id:5,username:'alice',type:'player',position:new Vec3(30,64,30)};
 bot.entities={1:bot.entity,2:zombie,3:cow,4:drop,5:player};
 const tracker=new EntityTracker();
 tracker.updateState(bot);
 assert.equal(tracker.getClosestEntity(bot,['zombie']),zombie);
 assert.deepEqual(tracker.getTrackedEntities(bot,'cow'),[cow]);
 assert.ok(tracker.getHostiles(bot).includes(zombie));
 assert.ok(!tracker.getHostiles(bot).includes(cow));
 assert.equal(tracker.getClosestItemDrop(bot,['dirt']),drop);
 assert.ok(tracker.itemDropped(bot,'dirt'));
 assert.equal(tracker.isPlayerLoaded(bot,'alice'),true);
 assert.equal(tracker.getPlayerMostRecentPosition(bot,'alice').distanceTo(player.position),0);
 assert.equal(tracker.getCloseEntities(bot).length,2); // zombie + drop within 4.5
 // The give-up list: 3 failures are allowed, so the 4th unreachable report gives up on
 // the zombie (failures > allowed, exactly the Java blacklist rule).
 for(let i=0;i<4;i++)tracker.requestEntityUnreachable(bot,zombie);
 assert.equal(tracker.isEntityReachable(bot,zombie),false);
 assert.equal(tracker.getClosestEntity(bot,['zombie']),null);
 tracker.invalidate();
 assert.equal(tracker.isEntityReachable(bot,zombie),true);
});

// --- storage tracker ---
test('ItemStorageTracker: counts inventory and caches an opened chest',()=>{
 const {bot}=makeBot({pos:[0,64,0],blocks:{'2,64,2':'chest','2,63,2':'stone'}});
 bot.inventory={items:()=>[{name:'oak_log',count:3},{name:'stick',count:8}]};
 const storage=new ItemStorageTracker();
 assert.equal(storage.getItemCount(bot,'oak_log'),3);
 assert.equal(storage.hasItemAll(bot,'oak_log','stick'),true);
 const chestPos=new Vec3(2,64,2);
 storage.onBlockInteract(bot,chestPos,'chest');
 const window={type:'minecraft:generic_9x3',inventoryStart:27,slots:()=>[...Array(27).keys()].map(i=>i===4?{name:'iron_ingot',count:12}:null).concat([{name:'stick',count:1}])};
 bot.currentWindow=window;
 storage.onScreenOpen(bot,window);
 storage.onTick(bot);
 assert.equal(storage.hasItemContainer(bot,'iron_ingot'),true);
 const cache=storage.getContainerAtPosition(bot,chestPos);
 assert.ok(cache);
 assert.equal(cache.getItemCount('iron_ingot'),12);
 assert.equal(cache.getEmptySlotCount(),26);
 assert.equal(storage.getClosestContainerWithItem(bot,new Vec3(0,64,0),'iron_ingot'),cache);
 storage.onScreenClose(bot);
 // Container-type mapping (the Java ContainerType.getFromBlock).
 assert.equal(containerTypeFromBlock('chest'),'CHEST');
 assert.equal(containerTypeFromBlock('furnace'),'FURNACE');
 assert.equal(containerTypeFromBlock('ender_chest'),'ENDER_CHEST');
 assert.equal(containerTypeFromBlock('stone'),'EMPTY');
});

// --- movement tasks ---
test('GetToXZTask issues a GoalXZ through the guarded helper, finishes there, tolerates failures',async()=>{
 const {bot,calls}=makeBot({pos:[0,64,0]});
 const ctx=makeCtx(bot);
 const task=new GetToXZTask(10,10);
 task.onStart(bot,ctx);
 task.onTick(bot,ctx);
 assert.ok(bot.pathfinder.goal,'a goal was issued');
 assert.equal(bot.pathfinder.goal.x,10);
 assert.equal(bot.pathfinder.goal.z,10);
 assert.ok(calls.some(c=>c[0]==='setMovements'&&c[1].name==='explore'),'movements set via the guarded helper');
 assert.equal(task.isFinished(bot,ctx),false);
 bot.entity.position=new Vec3(10,64,10);
 assert.equal(task.isFinished(bot,ctx),true);
 // isEqual prevents needless restarts; a different goal is not equal.
 assert.equal(new GetToXZTask(10,10).isEqual(task),true);
 assert.equal(new GetToXZTask(11,10).isEqual(task),false);
 // The in-flight leg cleans up after resolving.
 await sleep(80);
 assert.ok(calls.some(c=>c[0]==='setGoal'&&c[1]===null),'goal cleared on cleanup');
 assert.ok(calls.some(c=>c[0]==='clear'),'controls cleared on cleanup');
 // A stale owner (epoch moved) must NOT touch the pathfinder: its cleanup is skipped, so
 // the goal it set stays installed.
 const stale=makeCtx(bot);
 stale.worker.controlToken=5;stale.worker.epoch=0;
 const t2=new GetToXZTask(20,20);
 t2.onStart(bot,stale);
 t2.onTick(bot,stale);
 await sleep(80);
 assert.ok(bot.pathfinder.goal,'stale owner skipped its cleanup');
 assert.equal(bot.pathfinder.goal.x,20);
});

test('GetToXZTask: pathfinder failures never throw, even after the timeout',async()=>{
 // goto that never resolves: the leg times out (navSeconds 0.05) and resolves false.
 const {bot}=makeBot({pos:[0,64,0],gotoImpl:()=>new Promise(()=>{})});
 const ctx=makeCtx(bot);
 const task=new GetToXZTask(30,30,{});
 task.navSeconds=0.05;
 task.onStart(bot,ctx);
 assert.doesNotThrow(()=>task.onTick(bot,ctx));
 await sleep(200); // timeout fires, navPromise cleared
 assert.equal(task.navPromise,null);
 // A hard pathfinder rejection is also absorbed.
 const {bot:bot2}=makeBot({pos:[0,64,0],gotoImpl:()=>Promise.reject(new Error('NoPath'))});
 const task2=new GetToXZTask(30,30);
 task2.onStart(bot2,makeCtx(bot2));
 assert.doesNotThrow(()=>task2.onTick(bot2,makeCtx(bot2)));
 await sleep(120);
});

test('RunAwayFromPositionTask computes the away direction and finishes at distance',()=>{
 const {bot}=makeBot({pos:[0,64,0]});
 const danger=new Vec3(3,64,0);
 const task=new RunAwayFromPositionTask(16,[danger]);
 task.onStart(bot,makeCtx(bot));
 task.onTick(bot,makeCtx(bot));
 // The computed destination points away from the danger.
 assert.ok(task.dest,'an away destination was computed');
 assert.ok(task.dest.x<0,'destination is on the far side of the bot from the danger');
 const dest=RunAwayFromPositionTask.awayFrom(new Vec3(0,64,0),danger,10);
 assert.ok(dest.x<0);
 assert.equal(task.isFinished(bot,makeCtx(bot)),false); // bot sits 3 blocks from the danger
 bot.entity.position=new Vec3(40,64,0); // 37 blocks away now
 assert.equal(task.isFinished(bot,makeCtx(bot)),true);
});

test('inLava: block data beats a sticky isInLava flag (Via keeps it true after exiting)',()=>{
 // A4 measured 2026-10-13: the flag stuck true after the bot left the trench, so the
 // escape never popped, the chain stayed at priority 100 and the douse band never armed.
 const {bot:sticky}=makeBot({pos:[4,64,0],blocks:{'4,63,0':'stone','4,64,0':'air'}});
 sticky.entity.isInLava=true; // the stuck client flag
 assert.equal(inLava(sticky),false,'block data says grass: not in lava');
 // With no block data under the bot (unloaded chunk) the flag stays authoritative.
 const blind={entity:{isInLava:true,position:new Vec3(4,64,0)},blockAt:()=>null};
 assert.equal(inLava(blind),true);
});

test('EscapeFromLavaTask picks the nearest non-lava safe block and finishes when out',()=>{
 const blocks={
  '0,64,0':'lava','1,64,0':'lava','0,63,0':'lava','1,63,0':'stone', // the bot stands IN lava
  '4,63,0':'stone','4,64,0':'air' // nearest safe ground
 };
 const {bot,calls}=makeBot({pos:[0,64,0],blocks});
 assert.equal(inLava(bot),true);
 const safe=findSafeBlock(bot,bot.entity.position.floored(),8);
 assert.ok(safe,'a safe block was found');
 assert.equal(`${safe.x},${safe.y},${safe.z}`,'4,64,0');
 const ctx=makeCtx(bot);
 const task=new EscapeFromLavaTask();
 task.onStart(bot,ctx);
 assert.equal(task.isFinished(bot,ctx),false);
 task.onTick(bot,ctx);
 // The scramble owns movement while in lava: raw jump/sprint/forward, NO pathfinder leg
 // (a nav's physics hook clears the scramble controls and a lava route wades anyway).
 const controls=calls.filter(c=>c[0]==='control');
 assert.ok(controls.some(c=>c[1]==='jump'&&c[2]===true)&&controls.some(c=>c[1]==='sprint'&&c[2]===true),'raw jump+sprint while in lava');
 assert.ok(!bot.pathfinder.goal,'no pathfinder leg while in the lava');
 // Out of the lava the task is done - the post-exit FIRE belongs to the
 // ExtinguishWithWater chain (it cannot run while this task holds the tree).
 bot.entity.position=new Vec3(4,64,0);
 bot.entity.metadata=[1]; // still on fire: extinguish is the next chain's job
 assert.equal(task.isFinished(bot,ctx),true);
 bot.entity.metadata=[0];
 // Jump+sprint controls are released once out.
 task.onTick(bot,ctx);
 // Lava on all sides with a single safe exit further away: still found within the radius.
 const trapped=makeBot({pos:[0,64,0],blocks:{
  '-1,64,0':'lava','1,64,0':'lava','0,64,1':'lava','0,64,-1':'lava','0,63,0':'lava','0,65,0':'lava',
  '6,63,0':'stone','6,64,0':'air'
 }}).bot;
 const out=findSafeBlock(trapped,trapped.entity.position.floored(),8);
 assert.equal(`${out.x},${out.y},${out.z}`,'6,64,0');
});

test('GetToBlockTask blacklists its position on wander (the gather-failure replacement)',()=>{
 const {bot}=makeBot({pos:[0,64,0]});
 const seen=[];
 const trackers={blocks:{requestBlockUnreachable:(b,p)=>seen.push(p)}};
 const ctx=makeCtx(bot,{trackers});
 const target=new Vec3(50,64,50);
 const task=new GetToBlockTask(target);
 task.onWander(bot,ctx);
 assert.equal(seen.length,1);
 assert.equal(seen[0].distanceTo(target),0);
 // No trackers wired (ctx.trackers={}): tolerated, no throw.
 assert.doesNotThrow(()=>task.onWander(bot,makeCtx(bot)));
 assert.doesNotThrow(()=>task.onWander(bot,null));
});

test('move helpers: guarded goto resolves false on timeout and stale owners skip cleanup',async()=>{
 const {bot,calls}=makeBot({pos:[0,64,0],gotoImpl:()=>new Promise(()=>{})});
 const ctx=makeCtx(bot);
 setDefaultMoveContext({worker:ctx.worker,get bot(){return ctx.bot;}}); // the wiring line
 const goal={isEnd:p=>p.x>=25,heuristic:()=>0};
 const reached=await move.goto(null,goal,{seconds:0.05}); // ctx=null falls back to the default
 assert.equal(reached,false,'unreached goal resolves false, no throw');
 await sleep(50);
 assert.ok(calls.some(c=>c[0]==='setGoal'&&c[1]===null),'the owner cleaned up');
 // A worker whose epoch moved: no cleanup calls at all.
 const stale=makeCtx(bot);
 stale.worker.controlToken=99;stale.worker.epoch=0;
 const pending=move.goto(stale,{isEnd:()=>true},{seconds:0.05}); // setMovements may happen pre-await
 const before=calls.length;
 await pending;
 await sleep(50);
 assert.equal(calls.length,before,'stale owner made no pathfinder or control calls');
});

test('trackers facade lets chains omit the bot; move factories carry ctx',()=>{
 const {bot}=makeBot({pos:[0,64,0]});
 const zombie={id:2,name:'zombie',kind:'hostile',type:'mob',position:new Vec3(4,64,0),onGround:true};
 bot.entities={1:bot.entity,2:zombie};
 let live=bot;
 const trackers=createTrackers({getBot:()=>live});
 // P2-style call with NO bot argument resolves through the live getter.
 assert.equal(trackers.api.entities.getHostiles().length,1);
 assert.equal(trackers.api.entities.getClosestEntity(['zombie']),zombie);
 // Explicit-bot calls still work unchanged.
 assert.equal(trackers.entities.getHostiles(bot).length,1);
 // The move factories build real tasks carrying the ctx base (live bot getter).
 const worker={controlToken:0,epoch:0,movements:{},exploreMovements(){return {};}};
 const tasks=createMoveTasks({worker,get bot(){return live;}});
 const task=tasks.getToEntity(zombie,2);
 assert.equal(task.name,'GetToEntityTask');
 assert.equal(typeof task.onTick,'function');
 assert.equal(task.isFinished(bot),false); // 4 blocks away, beyond the 2-block range
 zombie.position=new Vec3(1,64,0);
 assert.equal(task.isFinished(bot),true); // now within range
});

test('bounded memory: blacklists prune, tracker caches stay capped, run RSS stays flat',()=>{
 // Blacklists prune their oldest entries instead of growing forever.
 const timed=new Blacklist({maxEntries:100});
 for(let i=0;i<500;i++)timed.block(new Vec3(i,64,0),60);
 assert.equal(timed.entries.size,100);
 const obj=new ObjectBlacklist({key:p=>`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`,maxEntries:50});
 const {bot:botO}=makeBot({pos:[0,64,0]});
 for(let i=0;i<200;i++)obj.blackListItem(botO,new Vec3(i,64,0),2);
 assert.ok(obj.entries.size<=50);
 // ChunkSearch queues are capped even for an always-true search predicate.
 const {bot:botC}=makeBot({pos:[0,64,0]});
 const cs=new ChunkSearchTask({x:0,y:64,z:0},{isChunkPartOfSearchSpace:()=>true,maxQueue:16});
 cs.first=false; // skip the start-chunk auto-search
 cs.searchChunkOrQueueSearch(botC,0,0); // chunk (0,0) is loaded: searched, neighbours queued
 for(let cx=1;cx<=40;cx++)cs.searchChunkOrQueueSearch(botC,cx,0);
 assert.ok(cs.searchLater.length<=16,'searchLater stayed capped');
 // BlockTracker bursts: repeated rescans keep the cache within its per-type cap.
 const blocks={};
 for(let i=0;i<6;i++)blocks[`${2+i},64,2`]='oak_log';
 const {bot}=makeBot({pos:[0,64,0],blocks});
 const tracker=new BlockTracker({scanInterval:0});
 tracker.trackBlock(bot,'oak_log');
 for(let i=0;i<40;i++)tracker.tick(bot);
 assert.ok(tracker.getKnownLocations(bot,'oak_log').length<=tracker.config.maxCacheSizePerBlockType);
 // EntityTracker rebuilds (clears first) stay flat over many updates.
 const et=new EntityTracker();
 for(let i=0;i<300;i++)et.updateState(bot);
 assert.ok(et.getTrackedEntities(bot,'unknown').length===0);
 assert.equal(et.getHostiles(bot).length,0);
 // Whole-run flat-memory guard (generous: a real leak crashes long before this fires).
 const growth=process.memoryUsage().rss-START_RSS;
 assert.ok(growth<512*1024*1024,'RSS grew by '+(growth>>20)+' MB during the run');
});

test('round 58: a lava target the bot gains no ground on in 1.5 s is skipped for the next one',()=>{
 const {bot}=makeBot({pos:[0,64,0],blocks:{'0,64,0':'lava','0,63,0':'lava','4,63,0':'stone','4,64,0':'air','-6,63,0':'stone','-6,64,0':'air'}});
 const ctx=makeCtx(bot),logs=[];ctx.worker={log:m=>logs.push(m)};
 const task=new EscapeFromLavaTask();task.onStart(bot,ctx);
 const real=Date.now;let t=1000;Date.now=()=>t;
 try{
  task.onTick(bot,ctx);
  assert.ok(logs.some(l=>/^Lava: heading for 4,64,0/.test(l)),JSON.stringify(logs));
  t+=1600;task.onTick(bot,ctx); // stuck in place
  assert.ok(logs.some(l=>/no ground gained toward 4,64,0/.test(l)),JSON.stringify(logs));
  t+=100;task.onTick(bot,ctx);
  assert.ok(logs.some(l=>/^Lava: heading for -6,64,0/.test(l)),JSON.stringify(logs));
 }finally{Date.now=real;}
});
