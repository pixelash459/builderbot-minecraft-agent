// Round 15 (round-14 soak): normal2 sat at health 9 with no food for 13 min, hard2 drowned
// twice when the drowning latch let go in seagrass/against a ceiling, its tunnel climb walked
// off the tunnel into a flooded cave, and normal1 waited 511 s on a full bag.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {foodDone} from '../src/autopilot.js';
import {WorldSurvivalChain} from '../src/chains/worldSurvivalChain.js';
import {Worker,CLIMB_LOST} from '../src/worker.js';
const counts=o=>n=>o[n]||0;
test('foodDone: low health with no food and a bar under 18 brings the food step back',()=>{
 const c=counts({_edible:0,_eaten:4});
 assert.equal(foodDone(c,{foodBar:17,foodOff:true}),true,'healthy: the set-aside holds');
 assert.equal(foodDone(c,{foodBar:17,foodOff:true,lowHealth:true}),false,'health 9, bar 17, nothing to eat');
 assert.equal(foodDone(c,{foodBar:19,foodOff:true,lowHealth:true}),true,'bar 18+: health regenerates on its own');
});
function drowningBot(head,{isInWater=false,air=4}={}){
 const blocks={'0,-59,0':head,'0,-60,0':{name:'stone'}};
 return {oxygenLevel:air,entity:{position:new Vec3(0.5,-60,0.5),isInWater},
  blockAt:p=>blocks[Math.floor(p.x)+','+Math.floor(p.y)+','+Math.floor(p.z)]||null,setControlState(){}};
}
test('drowning: seagrass at the head is water, and a ceiling block does not end the escape',()=>{
 const w=new WorldSurvivalChain();
 const bot=drowningBot({name:'seagrass'});
 w._handleDrowning(bot,{});assert.equal(w._drowning,true,'seagrass at the head: drowning');
 bot.oxygenLevel=7;bot.entity.position=new Vec3(0.5,-60,0.5);
 const blocks={'0,-59,0':{name:'stone'},'0,-60,0':{name:'water'}};bot.blockAt=p=>blocks[Math.floor(p.x)+','+Math.floor(p.y)+','+Math.floor(p.z)]||null;
 w._handleDrowning(bot,{});assert.equal(w._drowning,true,'head against stone, feet in water: still escaping');
 blocks['0,-59,0']={name:'air'};blocks['0,-60,0']={name:'air'};
 w._handleDrowning(bot,{});assert.equal(w._drowning,false,'head in air: done');
});
test('tunnel climb: a bot that left the tunnel after a failed step stops climbing',async()=>{
 const tunnel=[{x:0,y:60,z:0},{x:1,y:61,z:0},{x:2,y:62,z:0}];
 const logs=[];let calls=0;
 const bot={entity:{position:new Vec3(2.5,62,0.5)},pathfinder:{movements:null,searchRadius:-1,setMovements(){},setGoal(){},stop(){}}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,movements:{},log(m){logs.push(m);},check(){},exploreMovements(){return {};},
  async navigate(){calls++;if(calls===1){bot.entity.position=new Vec3(14.5,61,6.5);throw Error('Navigation timed out');}if(calls===2)throw Error('No path to the goal!');}});
 await assert.rejects(w.climbTunnel({tunnel},0),/Left the tunnel/);
 assert.equal(calls,2,'no chase of the next step from '+CLIMB_LOST+'+ away');
 assert.equal(bot.pathfinder.searchRadius,-1,'search radius restored');
});
// ---- round 16 ----
import {plan,foodEmergency,OPTIONAL_KIT} from '../src/autopilot.js';
test('round 16: a food emergency jumps the ladder; a skipped kit piece does not hold the stone step',()=>{
 const c=counts({_edible:0});
 assert.equal(foodEmergency(c,{foodBar:5}),true);
 assert.equal(foodEmergency(c,{foodBar:17,lowHealth:true}),true);
 assert.equal(foodEmergency(c,{foodBar:17}),false);
 assert.equal(foodEmergency(counts({_edible:2}),{foodBar:3}),false,'food held: eat it');
 const p=plan({oak_log:1},{foodBar:5});
 assert.equal(p.step,'food','the wood step waits while the bar is nearly empty');
 assert.equal(plan({oak_log:1},{foodBar:15}).step,'wood');
 assert.ok(OPTIONAL_KIT.has('stone_shovel'));
 const kit={oak_planks:8,stick:10,crafting_table:1,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,stone_pickaxe:1,stone_sword:1,stone_axe:1,furnace:1,cobblestone:20,cooked_beef:8,_edible:8};
 assert.equal(plan(kit,{foodBar:20}).job?.item,'stone_shovel','the shovel is still wanted');
 assert.notEqual(plan(kit,{foodBar:20,kitSkip:{stone_shovel:Date.now()+60000}}).step,'stone','skipped: the stone step is done');
});
// ---- round 18 ----
test('round 18: ascend climbs the recorded tunnel, then paths up; no progress fails',async()=>{
 const logs=[];const bot={entity:{position:new Vec3(0.5,-9,0.5)}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,log(m){logs.push(m);},check(){},strandedTunnel:{points:[{x:0,y:-9,z:0}]},
  async climbTunnel(){bot.entity.position=new Vec3(0.5,60,0.5);},async navigate(){bot.entity.position=new Vec3(0.5,131,0.5);}});
 await w.ascend({spec:{type:'ascend',y:131}},0);
 assert.equal(w.strandedTunnel,null);
 assert.match(logs.at(-1),/Ascend: y=-9 -> 131/);
 const stuck=Object.assign(Object.create(Worker.prototype),{bot:{entity:{position:new Vec3(0.5,-9,0.5)}},log(){},check(){},async navigate(){throw Error('No path to the goal!');}});
 await assert.rejects(stuck.ascend({spec:{type:'ascend',y:131}},0),/Could not climb/);
});
// ---- round 19 ----
test('round 19: the drowning latch holds while the head bobs above the surface',()=>{
 const w=new WorldSurvivalChain();
 const blocks={'0,-59,0':{name:'water'},'0,-60,0':{name:'water'}};
 const bot={oxygenLevel:2,entity:{position:new Vec3(0.5,-60,0.5),isInWater:false},blockAt:p=>blocks[Math.floor(p.x)+','+Math.floor(p.y)+','+Math.floor(p.z)]||null,setControlState(){}};
 w._handleDrowning(bot,{});assert.equal(w._drowning,true);
 blocks['0,-59,0']={name:'air'}; // head out, feet still in the water, air 2
 w._handleDrowning(bot,{});assert.equal(w._drowning,true,'bobbing: still escaping');
 bot.oxygenLevel=18;w._handleDrowning(bot,{});assert.equal(w._drowning,false,'air back: done');
});
test('round 19: deep underground means far under the anchor with no sky light',async()=>{
 const {Autopilot}=await import('../src/autopilot.js');
 const mk=(y,sky)=>{const ap=Object.create(Autopilot.prototype);ap.lastSurfaceY=131;
  ap.worker={bot:{entity:{position:new Vec3(0.5,y,0.5)},blockAt:()=>({name:'air',skyLight:sky})}};return ap;};
 assert.equal(mk(-54,0).deepUnderground(),true);
 assert.equal(mk(86,15).deepUnderground(),false,'a valley under open sky');
 assert.equal(mk(125,0).deepUnderground(),false,'near the anchor');
});
// ---- round 20 ----
import {unstickDigging} from '../src/worker.js';
import {installToolWear} from '../src/toolWear.js';
test('round 20: a null block never throws in the tool lookup, and a stale digging flag is cleared',()=>{
 const bot={inventory:{items:()=>[]},pathfinder:{bestHarvestTool(){throw Error('digTime of null');}},tool:null};
 installToolWear(bot);
 assert.equal(bot.pathfinder.bestHarvestTool(null),null);
 let fired=0;const b2={pathfinder:{isMining:()=>true},targetDigBlock:null,emit(ev){if(ev==='diggingAborted')fired++;}};
 unstickDigging(b2);assert.equal(fired,1,'flag set with no dig running: aborted');
 b2.targetDigBlock={name:'stone'};unstickDigging(b2);assert.equal(fired,1,'a real dig is left alone');
});
// ---- round 21 ----
import {deepDarkNear} from '../src/worker.js';
import {MobDefenseChain} from '../src/chains/mobDefenseChain.js';
import pf from 'mineflayer-pathfinder';
test('round 21: an empty path is a failure, not an arrival',async()=>{
 const {EventEmitter}=await import('node:events');
 const bot=Object.assign(new EventEmitter(),{entity:{onGround:true,position:new Vec3(0.5,64,0.5)},targetDigBlock:null,
  pathfinder:{movements:{},goto:()=>Promise.resolve(),setGoal(){},isMining:()=>false},clearControlStates(){}});
 const w=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,ready:true,deadline:Date.now()+60000,survivalJob:true,config:{limits:{minHealth:10,minFood:6}},applyMobAvoidance(){}});
 await assert.rejects(w.navigate(new pf.goals.GoalNear(20,64,0,1),0,5),/No path to the goal! \(empty path/);
 await w.navigate(new pf.goals.GoalNear(0,64,0,1),0,5); // already there: fine
});
test('round 21: deep dark and the warden',()=>{
 const reg={blocksByName:{sculk_shrieker:{id:7},sculk_sensor:{id:8}}};
 const shrieker={name:'sculk_shrieker',position:new Vec3(3,-40,0)};
 assert.equal(deepDarkNear({registry:reg,findBlock:()=>shrieker}),shrieker);
 assert.equal(deepDarkNear({registry:reg,findBlock:()=>null}),null);
 assert.equal(deepDarkNear({registry:{blocksByName:{}},findBlock:()=>shrieker}),null,'no sculk in the registry');
 const m=new MobDefenseChain();
 const bot={entity:{position:new Vec3(0,-40,0)},health:20};
 assert.equal(m._universallyDangerous([{name:'warden',position:new Vec3(20,-40,0)}],bot),true);
 assert.equal(m._universallyDangerous([{name:'warden',position:new Vec3(40,-40,0)}],bot),false);
});
test('round 21: a head under water for 8 s is drowning even with a stale air reading',()=>{
 const w=new WorldSurvivalChain();
 const blocks={'0,-59,0':{name:'water'},'0,-60,0':{name:'water'}};
 const bot={oxygenLevel:20,entity:{position:new Vec3(0.5,-60,0.5),isInWater:false},blockAt:p=>blocks[Math.floor(p.x)+','+Math.floor(p.y)+','+Math.floor(p.z)]||null,setControlState(){}};
 w._handleDrowning(bot,{});assert.equal(w._drowning,false,'just under: air reads 20');
 w._headWetSince=Date.now()-9000;w._airChanged=Date.now()-9000;w._handleDrowning(bot,{});assert.equal(w._drowning,true,'9 s under with a stale reading: swim up');
 // round 24: a live reading (it moved) is trusted - no backstop
 const w2=new WorldSurvivalChain();bot.oxygenLevel=19;w2._handleDrowning(bot,{});w2._headWetSince=Date.now()-9000;bot.oxygenLevel=17;w2._handleDrowning(bot,{});
 assert.equal(w2._drowning,false,'air reading live and above 6: not drowning');
 // round 24: raw ticks (0-300) are scaled to bubbles: 400 reads as full, 60 as 4
 bot.oxygenLevel=60;w2._headWetSince=0;w2._handleDrowning(bot,{});assert.equal(w2._drowning,true,'60 ticks = 4 bubbles: drowning');
});
// ---- round 22 ----
test('round 22: an empty path under mob avoidance is retried without it, then a boxed-in bot stairs out',async()=>{
 const {EventEmitter}=await import('node:events');
 const hook=()=>0;let gotoCalls=0,stair=0;
 const mv={exclusionAreasStep:[hook],_mobAvoidHook:hook};
 const bot=Object.assign(new EventEmitter(),{entity:{onGround:true,position:new Vec3(0.5,64,0.5)},targetDigBlock:null,
  pathfinder:{movements:mv,goto(){gotoCalls++;if(gotoCalls===2)bot.entity.position=new Vec3(20.5,64,0.5);return Promise.resolve();},setGoal(){},isMining:()=>false},clearControlStates(){}});
 const w=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,ready:true,deadline:Date.now()+60000,survivalJob:true,config:{limits:{minHealth:10,minFood:6}},logs:[],log(m){this.logs.push(m);},applyMobAvoidance(){}});
 await w.navigate(new pf.goals.GoalNear(20,64,0,1),0,5);
 assert.equal(gotoCalls,2,'the second try (no avoidance) arrived');
 assert.equal(mv._mobAvoidHook,null);assert.ok(w.logs.some(m=>/trying without it/.test(m)));
 // no avoidance hook and a 1-node search: stair out, then path again
 bot.entity.position=new Vec3(0.5,64,0.5);gotoCalls=0;
 bot.pathfinder.goto=()=>{gotoCalls++;bot.emit('path_update',{status:'noPath',path:[],visitedNodes:1});if(stair)bot.entity.position=new Vec3(20.5,64,0.5);return Promise.resolve();};
 w.stairOut=async()=>{stair++;return true;};
 await w.navigate(new pf.goals.GoalNear(20,64,0,1),0,5);
 assert.equal(stair,1);assert.equal(gotoCalls,2);
});
test('round 22: distant silverfish are ignored by Mob Defense',()=>{
 const m=new MobDefenseChain();
 const ent=(name,x)=>({name,type:'hostile',position:new Vec3(x,64,0),isValid:true});
 const bot={entity:{position:new Vec3(0,64,0)},entities:{1:ent('silverfish',6),2:ent('silverfish',7)},health:20,food:20,inventory:{items:()=>[],slots:[]},time:{timeOfDay:6000},heldItem:null,blockAt:()=>null};
 assert.ok(m.priority(bot,{config:{chains:{}},move:{},trackers:{},blacklist:{}})<60,'two silverfish 6-7 away: no flee');
});
// ---- round 23 ----
import {bedSpots} from '../src/worker.js';
test('round 23: a bed spot needs its head cell open on solid ground too',()=>{
 // flat ground at y=63, the bot at (0,64,0), a wall at x=2 (so east r=1 has no head room)
 const at=(x,y,z)=>y<64?{name:'stone',boundingBox:'block'}:(x===2&&y<66?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'});
 const spots=bedSpots(at,{x:0,y:64,z:0});
 assert.ok(spots.length>0);
 assert.ok(!spots.some(s=>s.foot.x===1&&s.foot.z===0),'east: the head would be in the wall');
 const west=spots.find(s=>s.foot.x===-1&&s.foot.z===0);
 assert.deepEqual(west.head,{x:-2,y:64,z:0});assert.deepEqual(west.dir,{x:-1,z:0});
 assert.deepEqual(bedSpots(()=>({name:'stone',boundingBox:'block'}),{x:0,y:64,z:0}),[],'boxed in: no spot');
});
test('round 23: a deep-dark refusal climbs out and sets diamond trips aside',async()=>{
 const {Autopilot,DIAMOND_OFF_MS}=await import('../src/autopilot.js');
 const ap=Object.create(Autopilot.prototype);
 const submitted=[];
 Object.assign(ap,{failures:{},current:{id:'j1',step:'iron',spec:{type:'gather',block:'iron_ore'}},currentStep:'iron',lastSurfaceY:122,log(){},state:'',
  worker:{bot:{entity:{position:new Vec3(0,-30,0)},blockAt:()=>null}},submit(step,spec){submitted.push([step,spec]);}});
 ap.settle({id:'j1',status:'failed',message:'Deep dark: sculk_catalyst at (511, -31, 79); leaving (warden)',spec:{type:'gather'}});
 assert.equal(ap.escapeDark,true);assert.ok(ap.diamondOffUntil>Date.now()+DIAMOND_OFF_MS-1000);
 ap.counts=()=>({});ap.decide({});
 assert.deepEqual(submitted[0],['escape',{type:'ascend',y:122}]);
});
// ---- round 24 ----
import {creeperDistance,CREEPER_RELEASE} from '../src/worker.js';
test('round 24: creeper distance for the override hysteresis',()=>{
 const bot={entity:{position:new Vec3(0,64,0)},entities:{1:{name:'creeper',position:new Vec3(7,64,0)},2:{name:'zombie',position:new Vec3(1,64,0)}}};
 assert.equal(creeperDistance(bot),7);
 assert.ok(creeperDistance(bot)<=CREEPER_RELEASE,'7 away: a latched override holds');
 assert.equal(creeperDistance({entity:{position:new Vec3(0,64,0)},entities:{}}),Infinity);
});
