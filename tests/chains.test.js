// Unit tests for the ported chains (docs/ALTOCLEF_PORT_SPEC.md item 2) with fake bots and
// fake tasks: MobDefenseChain priority flips, the 7f no-fight ladder (never fight unarmed;
// get-armed -> walk away -> daylight burn -> shelter -> cornered last resort), FoodChain
// eat/collect, WorldSurvivalChain lava/water/fire/portal, MLG fall, UserTaskChain hold,
// RespawnChain respawn. No live server, no services; the only clock is injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Task} from '../src/tasks/task.js';
import {TaskRunner} from '../src/tasks/runner.js';
import {MobDefenseChain} from '../src/chains/mobDefenseChain.js';
import {FoodChain} from '../src/chains/foodChain.js';
import {WorldSurvivalChain} from '../src/chains/worldSurvivalChain.js';
import {MLGBucketFallChain} from '../src/chains/mlgBucketFallChain.js';
import {UserTaskChain} from '../src/chains/userTaskChain.js';
import {RespawnChain} from '../src/chains/respawnChain.js';
import {KillEntitiesTask,RunAwayFromHostilesTask,KeepDistanceTask,ShelterTask,SleepTask,CraftWeaponTask,ExtinguishWithWaterTask} from '../src/chains/fallbackTasks.js';
import {FightTask} from '../src/chains/fightTask.js';
import {defaultChains} from '../src/chains/index.js';
import {evaluateFight,huntBlocked} from '../src/chains/combatPolicy.js';

const flush=async n=>{for(let i=0;i<(n||3);i++)await new Promise(r=>setImmediate(r));};
const FOODS={apple:{foodPoints:4,saturation:0.3},cooked_beef:{foodPoints:8,saturation:0.8},rotten_flesh:{foodPoints:4,saturation:0.8}};
function makeBot(opts={}){
 const calls=[];
 const inv=(opts.inventory||[]).map(name=>({name,count:opts.counts&&opts.counts[name]||1}));
 const blocks=opts.blocks||{};
 const bot={
  version:'1.21.4',health:opts.health??20,food:opts.food??20,oxygen:opts.oxygen??20,oxygenMax:20,
  time:{timeOfDay:opts.timeOfDay??1000},
  entity:{id:1,position:new Vec3(0,-60,0),velocity:opts.velocity||new Vec3(0,0,0),
   onGround:opts.onGround??true,isInLava:!!opts.isInLava,isInWater:!!opts.isInWater,
   metadata:opts.metadata||[0],height:1.8},
  entities:{},
  inventory:{items:()=>inv,slots:opts.armor?([,,,,,{name:'iron_helmet'},{name:'iron_chestplate'},{name:'iron_leggings'},{name:'iron_boots'}]):[]},
  heldItem:opts.heldItem?{name:opts.heldItem}:null,
  registry:{blocksByName:{dirt:{id:1},cobblestone:{id:2},crafting_table:{id:3},fire:{id:4},lava:{id:5},nether_portal:{id:6}},
   itemsByName:{wooden_sword:{id:332},iron_sword:{id:333},stick:{id:334}},
   foodsByName:FOODS},
  blockAt:p=>{const k=`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;return blocks[k]||null;},
  setControlState:(n,v)=>calls.push(['control',n,v]),
  look:async()=>calls.push(['look']),
  lookAt:async()=>calls.push(['lookAt']),
  equip:async(item)=>{calls.push(['equip',item&&item.name]);bot.heldItem=item?{name:item.name}:null;},
  attack:e=>{calls.push(['attack',e.id]);return Promise.resolve();},
  consume:async()=>calls.push(['consume']),
  dig:async()=>calls.push(['dig']),
  placeBlock:async()=>calls.push(['place']),
  activateBlock:async()=>calls.push(['activate']),
  sleep:async()=>{calls.push(['sleep']);bot.isSleeping=true;},
  recipesFor:()=>[{}],
  craft:async()=>calls.push(['craft']),
  findBlock:q=>{
   if(!opts.bedBlock||!q||!q.matching)return null;
   if(typeof q.matching==='function')return q.matching(opts.bedBlock)?opts.bedBlock:null;
   return opts.bedBlock.name.match(q.matching)?opts.bedBlock:null;
  },
  findBlocks:()=>[],
  _client:{write:(ch,data)=>calls.push(['packet',ch,data])}
 };
 (opts.hostiles||[]).forEach((h,i)=>{
  const e={id:10+i,name:h.name||'zombie',type:'hostile',position:new Vec3(...h.position),height:1.9,isValid:true,metadata:[0]};
  bot.entities[e.id]=e;
 });
 return {bot,calls,inv};
}
const ctxOf=chains=>({config:{chains:chains||{}},move:{},trackers:{},blacklist:{}});
const zombie=at=>({name:'zombie',position:at||[3,-60,0]});

// ---- MobDefenseChain ---------------------------------------------------------------
test('MobDefenseChain: negative with no threat, positive the moment one is close',()=>{
 const m=new MobDefenseChain();
 const {bot}=makeBot({});
 const ctx=ctxOf();
 assert.equal(m.priority(bot,ctx),-1,'no threat: inactive (Java returns 0; -1 is the frozen inactive value)');
 assert.equal(m.root,null);
 const {bot:b2}=makeBot({hostiles:[zombie([4,-60,0])]});
 const p=m.priority(b2,ctx);
 assert.ok(p>0,'threat: chain takes control');
 assert.ok(p>=55,'escape ladder outranks the user task (50)');
});
test('unarmed bot never returns a fight task: daylight burn step keeps distance',()=>{
 const m=new MobDefenseChain();
 const {bot,calls}=makeBot({hostiles:[zombie([4,-60,0])],heldItem:'dirt',timeOfDay:6000});
 const p=m.priority(bot,ctxOf());
 assert.ok(p>0);
 assert.equal(m.root.name,'KeepDistanceTask','day + undead: staying out of reach (7f daylight burn)');
 assert.equal(m.root instanceof KillEntitiesTask,false);
 // holding dirt is never a reason to swing: tick the returned task, no attack happens
 for(let i=0;i<3;i++)m.root.onTick(bot,ctxOf());
 assert.ok(!calls.some(c=>c[0]==='attack'),'no swing while unarmed');
 assert.ok(calls.some(c=>c[0]==='control'&&c[1]==='forward'),'the bot moves away');
});
test('unarmed bot at night walks away (sprinting only with food > 6)',()=>{
 const m=new MobDefenseChain();
 const {bot,calls}=makeBot({hostiles:[zombie([4,-60,0])],timeOfDay:13000,food:10});
 const p=m.priority(bot,ctxOf());
 assert.equal(p,80,'7f walk-away priority');
 assert.ok(m.root instanceof RunAwayFromHostilesTask);
 m.root.onTick(bot,ctxOf());
 assert.ok(calls.some(c=>c[0]==='control'&&c[1]==='sprint'&&c[2]===true),'sprint needs food > 6');
});
test('unarmed bot at night with no food walks but never sprints',()=>{
 const m=new MobDefenseChain();
 const {bot,calls}=makeBot({hostiles:[zombie([4,-60,0])],timeOfDay:13000,food:4});
 m.priority(bot,ctxOf());
 m.root.onTick(bot,ctxOf());
 assert.ok(!calls.some(c=>c[0]==='control'&&c[1]==='sprint'&&c[2]===true),'no sprint below food 7');
});
test('7f: with planks and sticks and a zombie approaching, craft the wooden sword first',()=>{
 const m=new MobDefenseChain();
 const {bot}=makeBot({hostiles:[zombie([9,-60,0])],inventory:['oak_planks','oak_planks','oak_planks','stick'],timeOfDay:6000});
 const p=m.priority(bot,ctxOf({killAnnoyingHostileWhenCloseForSeconds:0}));
 assert.equal(p,75,'get-armed first');
 assert.ok(m.root instanceof CraftWeaponTask);
 assert.equal(m.root instanceof KillEntitiesTask,false);
 // once armed (the craft landed) and the zombie has closed in, the fight task takes over
 const {bot:b2}=makeBot({hostiles:[zombie([4,-60,0])],inventory:['oak_planks','stick','wooden_sword'],timeOfDay:6000});
 const p2=m.priority(b2,ctxOf({killAnnoyingHostileWhenCloseForSeconds:0}));
 assert.equal(p2,65);
 assert.ok(m.root instanceof FightTask);
});
test('armed bot with health >= 14 and one melee mob returns the fight task and verifies heldItem',()=>{
 const m=new MobDefenseChain();
 const {bot,calls}=makeBot({hostiles:[zombie([2,-60,0])],inventory:['iron_sword'],heldItem:'dirt',health:20,timeOfDay:6000});
 const p=m.priority(bot,ctxOf({killAnnoyingHostileWhenCloseForSeconds:0}));
 assert.equal(p,65);
 assert.ok(m.root instanceof FightTask);
 m.root.onTick(bot,ctxOf(bot)); // equips the sword, does NOT swing while holding dirt (7f)
 assert.ok(calls.some(c=>c[0]==='equip'&&c[1]==='iron_sword'),'weapon equipped first');
 assert.ok(!calls.some(c=>c[0]==='attack'),'no swing before heldItem verifies');
 // heldItem verifies -> the full-charge swing lands (26.3: crit hops measured OFF, see
 // src/combat.js opts.critJumps - plain swings killed in half the time for the same hits).
 m.root.onTick(bot,ctxOf(bot));
 assert.deepEqual(calls.filter(c=>c[0]==='attack').map(c=>c[1]),[10]);
});test('never fight three melee mobs even when armed',()=>{
 const m=new MobDefenseChain();
 const {bot}=makeBot({hostiles:[zombie([4,-60,0]),zombie([4,-60,3]),zombie([-4,-60,0])],inventory:['iron_sword'],timeOfDay:6000});
 const p=m.priority(bot,ctxOf({killAnnoyingHostileWhenCloseForSeconds:0}));
 assert.ok(!(m.root instanceof KillEntitiesTask),'7f: at most 2 melee mobs');
 assert.ok(p>0);
});
test('never start a fight below health 14 unarmoured',()=>{
 const m=new MobDefenseChain();
 const {bot}=makeBot({hostiles:[zombie([4,-60,0])],inventory:['iron_sword'],health:12,timeOfDay:6000});
 const p=m.priority(bot,ctxOf({killAnnoyingHostileWhenCloseForSeconds:0}));
 assert.ok(!(m.root instanceof KillEntitiesTask),'7f: health >= 14 gate');
});
test('armoured bot may fight at health 10-13 (7f: >= 10 if armoured)',()=>{
 const m=new MobDefenseChain();
 const {bot}=makeBot({hostiles:[zombie([4,-60,0])],inventory:['iron_sword'],health:12,timeOfDay:6000,armor:true});
 const p=m.priority(bot,ctxOf({killAnnoyingHostileWhenCloseForSeconds:0}));
 assert.equal(p,65);
 assert.ok(m.root instanceof FightTask);
});
test('cornered unarmed bot: last-resort fight with the best item, never a block',()=>{
 const m=new MobDefenseChain();
 const {bot,calls}=makeBot({hostiles:[zombie([2,-60,0])],heldItem:'dirt',timeOfDay:6000});
 const p=m.priority(bot,ctxOf({killAnnoyingHostileWhenCloseForSeconds:0}));
 assert.equal(p,85,'7f ladder step 5');
 assert.ok(m.root instanceof KillEntitiesTask&&m.root.lastResort);
 m.root.onTick(bot,ctxOf());
 assert.ok(!calls.some(c=>c[0]==='attack'),'never swing a block even cornered');
});
test('7f: dusk preparation starts before the first mob arrives (shelter / sleep)',()=>{
 const shelter=new MobDefenseChain();
 const {bot}=makeBot({timeOfDay:12100});
 const p=shelter.priority(bot,ctxOf());
 assert.equal(p,55);
 assert.ok(shelter.root instanceof ShelterTask);
 const sleeper=new MobDefenseChain();
 const {bot:b2}=makeBot({timeOfDay:12100,bedBlock:{name:'red_bed'}});
 assert.equal(sleeper.priority(b2,ctxOf()),55);
 assert.ok(sleeper.root instanceof SleepTask);
});
test('fusing-looking creeper (within 10) outranks the user task; armed bot still not meleeing it',()=>{
 const m=new MobDefenseChain();
 const {bot}=makeBot({hostiles:[{name:'creeper',position:[5,-60,0]}],inventory:['iron_sword'],timeOfDay:6000});
 const p=m.priority(bot,ctxOf({killAnnoyingHostileWhenCloseForSeconds:0}));
 assert.ok(p>=50&&p<=100,'creeper band 50 + urgency*50');
 assert.equal(m.root.name,'RunAwayFromCreepersTask');
 assert.ok(!(m.root instanceof KillEntitiesTask),'never melee a creeper');
});
test('a hunting bot aborts when a hostile comes within 8 blocks (7f)',()=>{
 const {bot}=makeBot({hostiles:[zombie([7,-60,0])]});
 assert.ok(huntBlocked([bot.entities[10]],bot));
 const {bot:b2}=makeBot({hostiles:[zombie([10,-60,0])]});
 assert.equal(huntBlocked([b2.entities[10]],b2),false);
});
test('ctx.move overrides the fallback movement task by Java class name',()=>{
 const m=new MobDefenseChain();
 const custom=new RunAwayFromHostilesTask(30,true);
 const {bot}=makeBot({hostiles:[zombie([4,-60,0])],timeOfDay:13000});
 m.priority(bot,{config:{chains:{}},move:{RunAwayFromHostilesTask:()=>custom},trackers:{},blacklist:{}});
 assert.equal(m.root,custom,'P4 helpers win when wired');
});
test('default chain stack wires the sibling references (food <-> mobDefense <-> mlg)',()=>{
 const chains=defaultChains();
 const md=chains.find(c=>c.name==='Mob Defense');
 const fc=chains.find(c=>c.name==='Food');
 const mlg=chains.find(c=>c.name==='MLG Water Bucket Fall Chain');
 assert.equal(md.food,fc);
 assert.equal(md.mlg,mlg);
 assert.equal(fc.mobDefense,md);
 assert.ok(chains.some(c=>c.name==='Respawn'));
 assert.ok(chains.some(c=>c.name==='User Tasks'));
});

// ---- FoodChain ----------------------------------------------------------------------
test('FoodChain eats when food is low and food exists (async eat, chain stays inactive)',async()=>{
 const f=new FoodChain();
 const {bot,calls}=makeBot({food:6,inventory:['apple'],timeOfDay:1000});
 const p=f.priority(bot,ctxOf());
 assert.equal(p,-1,'eating is asynchronous, no chain control');
 assert.ok(calls.some(c=>c[0]==='equip'&&c[1]==='apple'),'food equipped');
 await flush();
 assert.ok(calls.some(c=>c[0]==='consume'),'food consumed');
 assert.equal(f.isTryingToEat(),true);
});
test('FoodChain is negative when full: no eating at food 20',async()=>{
 const f=new FoodChain();
 const {bot,calls}=makeBot({food:20,inventory:['apple'],timeOfDay:1000});
 assert.equal(f.priority(bot,ctxOf()),-1);
 await flush();
 assert.equal(calls.some(c=>c[0]==='consume'),false);
 assert.equal(calls.some(c=>c[0]==='equip'),false);
});
test('FoodChain will not eat while escaping lava or mid-acrobatics',async()=>{
 const f=new FoodChain({mobDefense:{isDoingAcrobatics:()=>true}});
 const {bot,calls}=makeBot({food:6,inventory:['apple']});
 f.priority(bot,ctxOf());
 await flush();
 assert.equal(calls.some(c=>c[0]==='consume'),false);
 const f2=new FoodChain();
 const {bot:b2}=makeBot({food:6,inventory:['apple'],isInLava:true});
 f2.priority(b2,ctxOf());
 await flush();
 assert.equal(f2.isTryingToEat(),false);
});
test('FoodChain prefers real food, penalises rotten flesh, and skips unsafe foods',()=>{
 const f=new FoodChain();
 const {bot}=makeBot({food:9,inventory:['rotten_flesh','cooked_beef'],timeOfDay:1000});
 const {best}=f.calculateFood(bot);
 assert.equal(best.name,'cooked_beef');
 const {bot:b2}=makeBot({food:9,inventory:['spider_eye'],timeOfDay:1000});
 const r=f.calculateFood(b2);
 assert.equal(r.total,0,'unsafe food is not food');
});
test('FoodChain collects food at priority 55 when the stock is below the configured floor',()=>{
 const f=new FoodChain();
 const {bot}=makeBot({food:18,inventory:['stick'],timeOfDay:1000});
 const p=f.priority(bot,ctxOf({minimumFoodAllowed:10,foodUnitsToCollect:10}));
 assert.equal(p,55);
 assert.equal(f.root.name,'CollectFoodTask');
});
test('FoodChain.needsToEatCritical: RUN NOT EAT vs tank-hits-and-eat',()=>{
 const f=new FoodChain();
 const {bot}=makeBot({health:2,food:2});
 assert.equal(f.needsToEatCritical(bot),false,'low health and low food: run, do not eat');
 const {bot:b2}=makeBot({health:16,food:2,armor:true});
 assert.equal(f.needsToEatCritical(b2),true,'armoured: eat and tank the hits');
});

// ---- WorldSurvivalChain -------------------------------------------------------------
test('WorldSurvivalChain escapes lava at priority 100 via the EscapeFromLavaTask name',()=>{
 const w=new WorldSurvivalChain();
 const {bot,calls}=makeBot({isInLava:true});
 const p=w.priority(bot,ctxOf());
 assert.equal(p,100);
 assert.equal(w.root.name,'EscapeFromLavaTask');
 w.root.onTick(bot,ctxOf());
 assert.ok(calls.some(c=>c[0]==='control'&&c[1]==='jump'&&c[2]===true),'port of the sprint+jump lava escape');
 assert.ok(calls.some(c=>c[0]==='control'&&c[1]==='sprint'&&c[2]===true));
});
test('WorldSurvivalChain swims up while drowning, at 97 - above every Mob Defense band',()=>{
 // Round 4 drowned at 02:46 with the jump only a side effect under Mob Defense's flee.
 const w=new WorldSurvivalChain();
 const {bot,calls}=makeBot({isInWater:true,oxygen:5});
 assert.equal(w.priority(bot,ctxOf()),97);
 assert.equal(w.root.name,'SwimUpTask');
 assert.ok(calls.some(c=>c[0]==='control'&&c[1]==='jump'&&c[2]===true));
 // Latched until the air is back to 18 (not dropped the tick it reads 7).
 bot.oxygen=7;assert.equal(w.priority(bot,ctxOf()),97);
 bot.oxygen=18;assert.equal(w.priority(bot,ctxOf()),-1);
 // The runner hands the tree to the drowning band even with a zombie on the bot.
 const chains=defaultChains();
 const {bot:b2}=makeBot({isInWater:true,oxygen:4,hostiles:[zombie([2,-60,0])],timeOfDay:15000});
 const runner=new TaskRunner({bot:b2,epoch:0,controlToken:null,jobs:[],log(){}},chains);
 runner.tick();
 assert.equal(runner.status().chain,'Misc World Survival Chain');
});
test('WorldSurvivalChain escapes fire at 100 via PutOutFireTask',()=>{
 const w=new WorldSurvivalChain();
 const {bot}=makeBot({metadata:[1],blocks:{'0,-60,0':{name:'fire',boundingBox:'empty'}}});
 const p=w.priority(bot,ctxOf());
 assert.equal(p,100);
 assert.equal(w.root.name,'PutOutFireTask');
 w.root.onTick(bot,ctxOf());
});
test('WorldSurvivalChain escapes powder snow at 100: digs the snow and pushes to the clear side',()=>{
 const w=new WorldSurvivalChain();
 // snow at the feet and a wall of snow to the east; west and north are clear
 const blocks={'0,-60,0':{name:'powder_snow',boundingBox:'empty'}};
 for(const s of [1,2,3])for(const dy of [0,1])blocks[`${s},${-60+dy},0`]={name:'powder_snow',boundingBox:'empty'};
 const {bot,calls}=makeBot({metadata:[0,300,null,null,null,null,null,80],blocks});
 assert.equal(w.priority(bot,ctxOf()),100);
 assert.equal(w.root.name,'EscapeFreezingTask');
 assert.equal(w.root.isFinished(bot,ctxOf()),false);
 w.root.onTick(bot,ctxOf());
 assert.ok(calls.some(c=>c[0]==='dig'),'the powder snow at the feet is dug');
 assert.ok(calls.some(c=>c[0]==='control'&&c[1]==='jump'&&c[2]===true));
 assert.ok(calls.some(c=>c[0]==='control'&&c[1]==='forward'&&c[2]===true));
 // out of the snow: the band drops and the task reports finished
 delete blocks['0,-60,0'];
 assert.equal(w.root.isFinished(bot,ctxOf()),true);
 assert.equal(w.priority(bot,ctxOf()),-1);
});
test('WorldSurvivalChain extinguishes itself with a water bucket at 90',()=>{
 const w=new WorldSurvivalChain();
 const {bot}=makeBot({metadata:[1],inventory:['water_bucket']});
 const p=w.priority(bot,ctxOf());
 assert.equal(p,90);
 assert.equal(w.root.name,'ExtinguishWithWaterTask');
});
test('WorldSurvivalChain douses right after a lava exit even with no fire metadata bit',()=>{
 // Regression (A4, measured 2026-10-13): post-exit the chain went -1 with a STALE
 // EscapeFromLavaTask root (onTick only runs while selected), so `root?.name!=='...'`
 // blocked the douse every tick; with the fire bit missing on Via the burn ran to hp 1.
 const w=new WorldSurvivalChain();
 const {bot}=makeBot({isInLava:true,inventory:['water_bucket']});
 assert.equal(w.priority(bot,ctxOf()),100);
 assert.equal(w.root.name,'EscapeFromLavaTask');
 bot.entity.isInLava=false; // out of the lava, and the client never reports the fire flag
 assert.equal(w.priority(bot,ctxOf()),90,'the recent-lava window arms the douse');
 assert.equal(w.root.name,'ExtinguishWithWaterTask');
});
test('ExtinguishWithWaterTask holds still and delegates the pour to the worker once',async()=>{
 // Regression (A4, measured 2026-10-13): the in-task equip/aim/pour variants all failed
 // live (bare {name} equip rejected by mineflayer, pours on a stale rotation, the root
 // churning before the equip settled). The task now stops the bot and delegates to the
 // worker's integration-verified douseFire() exactly once per attempt.
 const task=new ExtinguishWithWaterTask({worker:{controlToken:1,log:()=>{},douseFire:()=>{calls.push(['douseFire']);return new Promise(()=>{});}}});
 const calls=[];const bucket={name:'water_bucket',count:1,slot:36,type:777};
 const bot={
  entity:{position:new Vec3(0,-60,0)},
  inventory:{items:()=>[bucket]},
  clearControlStates:()=>calls.push(['clear'])
 };
 task.onTick(bot,{});
 await flush(3);
 assert.ok(calls.some(c=>c[0]==='clear'),'stops moving so the aim lands');
 assert.ok(calls.some(c=>c[0]==='douseFire'),'delegates the pour to the worker');
 task.onTick(bot,{});
 assert.equal(calls.filter(c=>c[0]==='douseFire').length,1,'one pour in flight at a time');
});
test('WorldSurvivalChain shimmies out of a nether portal after 5 stuck seconds',()=>{
 const w=new WorldSurvivalChain();
 let t=1000;w.now=()=>t;
 const {bot}=makeBot({blocks:{'0,-60,0':{name:'nether_portal',boundingBox:'empty'}}});
 assert.equal(w.priority(bot,ctxOf()),-1,'stuck timer not elapsed yet');
 t+=6;
 assert.equal(w.priority(bot,ctxOf()),60);
 assert.equal(w.root.name,'SafeRandomShimmyTask');
});

// ---- MLGBucketFallChain -------------------------------------------------------------
test('MLGBucketFallChain: falling fast triggers the MLG bucket task at 100',()=>{
 const m=new MLGBucketFallChain();
 const {bot}=makeBot({onGround:false,velocity:new Vec3(0,-0.8,0),inventory:['water_bucket']});
 assert.equal(m.priority(bot,ctxOf()),100);
 assert.equal(m.root.name,'MLGBucketTask');
});
test('MLGBucketFallChain: grounded or slow fall is inactive',()=>{
 const m=new MLGBucketFallChain();
 const {bot}=makeBot({onGround:true,velocity:new Vec3(0,-2,0)});
 assert.equal(m.priority(bot,ctxOf()),-1);
 const {bot:b2}=makeBot({onGround:false,velocity:new Vec3(0,-0.3,0)});
 assert.equal(m.priority(b2,ctxOf()),-1,'-0.5 drift is not a fall (Java threshold -0.7)');
});

// ---- UserTaskChain ------------------------------------------------------------------
class FakeJob extends Task{
 constructor(){super('MyJob');this.ticks=0;}
 isFinished(){return this.ticks>=2;}
 onTick(){this.ticks++;return null;}
}
test('UserTaskChain holds the user task at priority 50 until it finishes',()=>{
 const u=new UserTaskChain();
 const job=new FakeJob();
 const {bot}=makeBot({});
 u.runTask(job,results=>u.results=results);
 assert.equal(u.priority(bot,ctxOf()),50);
 assert.equal(u.onTick(bot,ctxOf()),job,'same task instance keeps running');
 assert.equal(u.onTick(bot,ctxOf()),job);
 job.onTick(bot);job.onTick(bot); // the runner ticks the returned task; the job finishes
 assert.equal(u.onTick(bot,ctxOf()),null,'finished task releases the chain');
 assert.ok(u.results&&u.results.cancelled===false);
 assert.ok(u.results.seconds>=0);
 assert.equal(u.root,null);
});
test('UserTaskChain.cancel stops the task and reports cancelled',()=>{
 const u=new UserTaskChain();
 const job=new FakeJob();
 const {bot}=makeBot({});
 u.runTask(job,r=>u.r=r);
 u.cancel(bot);
 assert.equal(u.r.cancelled,true);
 assert.equal(u.onTick(bot,ctxOf()),null);
});

// ---- RespawnChain -------------------------------------------------------------------
test('RespawnChain respawns after the 2s death-screen wait and counts deaths',()=>{
 let t=100;const r=new RespawnChain();r.now=()=>t;
 const {bot,calls}=makeBot({health:0});
 const ctx=ctxOf();
 assert.equal(r.priority(bot,ctx),100,'death outranks every survival chain');
 r.onTick(bot,ctx);
 assert.equal(calls.some(c=>c[0]==='packet'),false,'2s wait on the death screen (DeathMenuChain timer)');
 t+=3;
 r.onTick(bot,ctx);
 const packet=calls.find(c=>c[0]==='packet'&&c[1]==='client_command');
 assert.ok(packet,'respawn packet written');
 assert.equal(packet[2].actionId,0);
 assert.equal(r.deathCount,1);
 t+=0.1;
 r.onTick(bot,ctx);
 assert.equal(r.deathCount,1,'no instant re-respawn while still dead');
});
test('RespawnChain with autoRespawn off announces the death instead (cancel path)',()=>{
 const deaths=[];
 const r=new RespawnChain({onDeath:()=>deaths.push(1)});
 const {bot,calls}=makeBot({health:0});
 const ctx=ctxOf({autoRespawn:false});
 assert.equal(r.priority(bot,ctx),100);
 r.onTick(bot,ctx);
 assert.equal(deaths.length,1);
 assert.equal(calls.some(c=>c[0]==='packet'),false,'no forced respawn');
});
test('RespawnChain is inactive while alive',()=>{
 const r=new RespawnChain();
 const {bot}=makeBot({health:20});
 assert.equal(r.priority(bot,ctxOf()),-1);
});

// ---- policy sanity ------------------------------------------------------------------
test('evaluateFight: the 7f gate order and reasons',()=>{
 const {bot}=makeBot({hostiles:[zombie([3,-60,0])],timeOfDay:6000});
 const no=evaluateFight(bot,[bot.entities[10]]);
 assert.equal(no.allowed,false);
 assert.equal(no.reason,'no real weapon (sword/axe)');
 const {bot:b2}=makeBot({hostiles:[zombie([3,-60,0])],inventory:['iron_sword'],health:10,timeOfDay:6000});
 assert.equal(evaluateFight(b2,[b2.entities[10]]).reason,'health 10 below 14');
 const {bot:b3}=makeBot({hostiles:[{name:'creeper',position:[4,-60,0]},zombie([3,-60,0])],inventory:['iron_sword'],timeOfDay:6000});
 assert.equal(evaluateFight(b3,Object.values(b3.entities)).reason,'creeper within 5 blocks without a bow');
 const {bot:b4}=makeBot({hostiles:[zombie([3,-60,0])],inventory:['iron_sword','bow','arrow'],health:20,timeOfDay:6000});
 const yes=evaluateFight(b4,[b4.entities[10]]);
 assert.equal(yes.allowed,true);
 const {bot:b5}=makeBot({hostiles:[zombie([3,-60,0])],inventory:['bow','arrow'],health:20,timeOfDay:6000});
 assert.equal(evaluateFight(b5,[b5.entities[10]]).allowed,false,'a bow is not a melee weapon (7f)');
});

// ---- smoke: the whole stack through P1's TaskRunner ----------------------------------
test('smoke: the default stack runs through TaskRunner; survival outranks the user task',()=>{
 const job=new FakeJob();
 const {bot}=makeBot({hostiles:[zombie([4,-60,0])],timeOfDay:6000});
 const worker={bot,epoch:0,controlToken:null,log(){}};
 const chains=defaultChains();
 chains.find(c=>c.name==='User Tasks').runTask(job,r=>worker.result=r);
 const runner=new TaskRunner(worker,chains,{config:{chains:{killAnnoyingHostileWhenCloseForSeconds:0}}});
 runner.tick();
 const st=runner.status();
 assert.equal(st.chain,'Mob Defense','threat policy outranks priority-50 user tasks');
 assert.equal(st.task,'KeepDistanceTask');
 assert.ok(job.ticks===0,'the user task did not tick while the threat chain held control');
 runner.stop();
 assert.equal(worker.controlToken,null,'control token released when the tree stops');
 assert.equal(runner.status().running,false);
});
test('smoke: with no threats the user task is the active chain and completes',()=>{
 const job=new FakeJob();
 const {bot}=makeBot({});
 const worker={bot,epoch:0,controlToken:null,log(){}};
 const chains=defaultChains();
 chains.find(c=>c.name==='User Tasks').runTask(job,r=>worker.result=r);
 const runner=new TaskRunner(worker,chains,{config:{chains:{}}});
 runner.tick();
 assert.equal(runner.status().chain,'User Tasks');
 assert.equal(runner.status().task,'MyJob');
 job.onTick(bot);job.onTick(bot);
 runner.tick();
 assert.ok(worker.result&&worker.result.cancelled===false,'onFinish reported with duration');
 assert.ok(worker.result.seconds>=0);
 runner.stop();
});
// Cloud session 2026-10-14: the fallback tasks steered with the Notchian yaw (z=+cos) through
// mineflayer's bot.look (yaw 0 faces -z), so every flee along z ran INTO the mob.
import {RunAwayFromCreepersTask} from '../src/chains/fallbackTasks.js';
import {headingOf} from '../src/heading.js';
test('run-away and keep-distance face away from a mob on the z axis',async()=>{
 for(const [mx,mz] of [[0,5],[0,-5],[5,0],[-3,4]]){
  const looks=[];
  const me={position:new Vec3(0,-60,0)};
  const mob={name:'creeper',type:'hostile',position:new Vec3(mx,-60,mz),isValid:true};
  const bot={entity:me,entities:{1:me,2:mob},food:20,look:async(yaw)=>{looks.push(yaw);},setControlState(){}};
  new RunAwayFromCreepersTask(10).onTick(bot,{});
  new KeepDistanceTask(10).onTick(bot,{});
  await new Promise(r=>setImmediate(r));
  assert.equal(looks.length,2);
  const n=Math.hypot(mx,mz);
  for(const yaw of looks){
   const h=headingOf(yaw);
   assert.ok(h.x*mx/n+h.z*mz/n<-0.99,'forward points away from the mob at '+[mx,mz]);
  }
 }
});
// Round 16 (round-15 hard2 fled a witch for 1000 s): a witch is fled only within 10 with a line
// of sight, and a flee that has run 45 s gives up on witches beyond 6 for a minute.
test('MobDefenseChain: the witch flee is bounded',()=>{
 const witch=at=>({name:'witch',position:at});
 const m=new MobDefenseChain();
 const far=makeBot({hostiles:[witch([14,-60,0])],timeOfDay:6000});
 assert.notEqual(m.priority(far.bot,ctxOf()),68,'a witch 14 away is not fled');
 const near=makeBot({hostiles:[witch([8,-60,0])],timeOfDay:6000});
 assert.equal(m.priority(near.bot,ctxOf()),68,'a witch 8 away is fled');
 m._witchSince=Date.now()-46000;
 assert.notEqual(m.priority(near.bot,ctxOf()),68,'45 s of fleeing: witches beyond 6 are ignored');
 assert.ok(m._witchIgnoreUntil>Date.now());
 const close=makeBot({hostiles:[witch([4,-60,0])],timeOfDay:6000});
 assert.equal(m.priority(close.bot,ctxOf()),68,'still fled within 6');
});
test('round 46: a lone creeper that keeps following for 20 s is fought (from a pillar), not fled forever',()=>{
 const m=new MobDefenseChain();let t=1000;m.now=()=>t;
 const {bot}=makeBot({hostiles:[{name:'creeper',position:[8,-60,0]}],inventory:['iron_sword','cobblestone'],counts:{cobblestone:16},timeOfDay:6000});
 m.priority(bot,ctxOf({killAnnoyingHostileWhenCloseForSeconds:0}));
 assert.equal(m.root.name,'RunAwayFromCreepersTask','first: flee');
 for(let i=0;i<5;i++){t+=2;m.priority(bot,ctxOf({killAnnoyingHostileWhenCloseForSeconds:0}));}
 assert.equal(m.root.name,'RunAwayFromCreepersTask','10 s: still flee');
 for(let i=0;i<6;i++){t+=2;m.priority(bot,ctxOf({killAnnoyingHostileWhenCloseForSeconds:0}));}
 assert.equal(m.root.name,'FightTask','21 s of the same creeper: fight it');
 // no blocks for the pillar: keep fleeing
 const m2=new MobDefenseChain();let t2=1000;m2.now=()=>t2;
 const {bot:b2}=makeBot({hostiles:[{name:'creeper',position:[8,-60,0]}],inventory:['iron_sword'],timeOfDay:6000});
 for(let i=0;i<13;i++){t2+=2;m2.priority(b2,ctxOf({killAnnoyingHostileWhenCloseForSeconds:0}));}
 assert.equal(m2.root.name,'RunAwayFromCreepersTask');
});
