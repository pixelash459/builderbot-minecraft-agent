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
 w._handleDrowning(bot,{});assert.equal(w._drowning,true,'round 33: one dry tick is a bob, not out');
 w._drySince=Date.now()-1600;w._handleDrowning(bot,{});assert.equal(w._drowning,false,'head in air for 1.5 s: done');
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
 // round 25: after a walk a pathfinder dig that never finished is stopped (its block update
 // never came): stopDigging clears the target and fires the abort itself.
 let mining=true,stopped=0;const b3={pathfinder:{isMining:()=>mining},targetDigBlock:{name:'stone'},stopDigging(){stopped++;this.targetDigBlock=null;mining=false;},emit(){fired++;}};
 unstickDigging(b3);assert.equal(stopped,1);assert.equal(fired,1,'stopDigging handled it: no extra abort');
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
// ---- round 25 ----
test('round 25: after a fill the bot steps out of the water; air 8 is drowning',async()=>{
 const water={name:'water',boundingBox:'empty'},air={name:'air',boundingBox:'empty'},stone={name:'stone',boundingBox:'block'};
 // a pool x<=1 at y 64-65 over stone, dry land from x=2
 const at=p=>p.y<64?stone:(p.x<=1?(p.y<=65?water:air):air);
 let went=null;const logs=[];
 const w=Object.assign(Object.create(Worker.prototype),{bot:{entity:{position:new Vec3(0.5,64,0.5)},blockAt:at},check(){},log(m){logs.push(m);},async navigate(g){went=g;}});
 await w.leaveWater(0);
 assert.ok(went&&went.x===2&&went.y===64,'the nearest dry stand: '+JSON.stringify(went));
 const c=new WorldSurvivalChain();
 const blocks={'0,-59,0':{name:'water'},'0,-60,0':{name:'water'}};
 c._handleDrowning({oxygenLevel:8,entity:{position:new Vec3(0.5,-60,0.5),isInWater:true},blockAt:p=>blocks[Math.floor(p.x)+','+Math.floor(p.y)+','+Math.floor(p.z)]||null,setControlState(){}},{});
 assert.equal(c._drowning,true);
});
// ---- round 26 ----
test('round 26: a furnace batch, left table or stranded tunnel far away is forgotten',async()=>{
 const {Autopilot,FORGET_FAR}=await import('../src/autopilot.js');
 const ap=Object.create(Autopilot.prototype);const logs=[];
 ap.log=m=>logs.push(m);
 ap.worker={furnaceRun:{x:308,y:85,z:76},leftTable:{x:300,y:80,z:70},strandedTunnel:{points:[{x:300,y:60,z:70}]}};
 ap.forgetFar({entity:{position:new Vec3(141,131,30)}});
 assert.equal(ap.worker.furnaceRun,null);assert.equal(ap.worker.leftTable,null);assert.equal(ap.worker.strandedTunnel,null);
 assert.ok(logs.some(m=>/forgot the furnace batch/.test(m)));
 ap.worker={furnaceRun:{x:150,y:131,z:30},leftTable:null,strandedTunnel:null};
 ap.forgetFar({entity:{position:new Vec3(141,131,30)}});
 assert.ok(ap.worker.furnaceRun,'9 blocks away: kept (under '+FORGET_FAR+')');
});
// ---- round 27 ----
test('round 27: a worn iron pickaxe with no iron is replaced by one stone pickaxe, not fourteen',()=>{
 const STONE={oak_planks:8,stick:10,crafting_table:1,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,stone_pickaxe:1,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1,cobblestone:40,_edible:8,coal:16,torch:16};
 const base={...STONE,iron_pickaxe:1,_worn_iron_pickaxe:1,iron_ingot:0,stone_pickaxe:0};
 let r=plan(base,{});
 assert.equal(r.job?.item,'stone_pickaxe','no iron: the stone replacement');
 r=plan({...base,stone_pickaxe:2},{}); // the iron step keeps STONE_PICKS=2 spares on purpose
 assert.notEqual(r.job?.item,'stone_pickaxe','two sound stone pickaxes: no more crafted');
});
// ---- round 28 ----
import {duskHuntOff} from '../src/autopilot.js';
test('round 28: no food trips between dusk prep and sunset unless it is an emergency',()=>{
 const c=counts({_edible:0});
 const hunt={step:'food',job:{type:'fight',entity:'pig'}};
 assert.equal(duskHuntOff(11500,hunt,c,{foodBar:15}),true,'dusk, bar 15: wait for morning');
 assert.equal(duskHuntOff(11500,hunt,c,{foodBar:5}),false,'dusk but starving: go');
 assert.equal(duskHuntOff(6000,hunt,c,{foodBar:15}),false,'midday: hunt');
 assert.equal(duskHuntOff(11500,{step:'food',job:{type:'smelt'}},c,{foodBar:15}),false,'cooking held meat is fine');
 assert.equal(duskHuntOff(11500,{step:'iron',job:{type:'gather'}},c,{foodBar:15}),false,'other steps untouched');
});
test('round 29: a crowd of hostiles holds food trips back even by day',()=>{
 const c=counts({_edible:0});const hunt={step:'food',job:{type:'fight',entity:'pig'}};
 assert.equal(duskHuntOff(6000,hunt,c,{foodBar:15,crowd:3}),true);
 assert.equal(duskHuntOff(6000,hunt,c,{foodBar:15,crowd:2}),false);
 assert.equal(duskHuntOff(6000,hunt,c,{foodBar:4,crowd:5}),false,'starving: still go');
});
// ---- round 30 ----
import {ledgeGuard,dropBelow,standBeside} from '../src/worker.js';
test('round 30: the ledge guard lets go of raw controls before a big drop',()=>{
 // ground at y=63 for x<=1, a 10-deep drop from x=2
 const at=p=>p.x>=2?(p.y<54?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'}):(p.y<64?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'});
 const ctl={forward:true,sprint:true};
 const bot={entity:{onGround:true,position:new Vec3(1.6,64,0.5),velocity:new Vec3(0.2,0,0)},blockAt:at,
  getControlState:k=>!!ctl[k],setControlState:(k,v)=>{ctl[k]=v;},pathfinder:{isMoving:()=>false}};
 assert.equal(ledgeGuard(bot),true);assert.equal(ctl.forward,false);
 ctl.forward=true;bot.pathfinder.isMoving=()=>true;
 assert.equal(ledgeGuard(bot),false,'pathfinder walks are its own business');
 bot.pathfinder.isMoving=()=>false;bot.entity.position=new Vec3(0.2,64,0.5);
 assert.equal(ledgeGuard(bot),false,'flat ground ahead');
});
test('round 30: dropBelow and standBeside for picking up a block safely',()=>{
 const at=p=>{if(p.x===0&&p.z===0&&p.y<64&&p.y>50)return {name:'air',boundingBox:'empty'};return p.y<=64?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'};};
 const b={blockAt:at};
 assert.equal(dropBelow(b,new Vec3(0,64,0)),6,'a deep shaft under the table');
 const side=standBeside(b,new Vec3(0,64,0));
 assert.ok(side&&side.y===65&&(side.x!==0||side.z!==0),'a stand beside it on the ground: '+JSON.stringify(side));
});
import {fallWatch,FALL_LOG,GoalSky,headSky,SKY_OPEN} from '../src/worker.js';
import {underSky} from '../src/autopilot.js';
test('round 31: a pathfinder walk lets go of sprint beside a big drop, and keeps it on flat ground',()=>{
 const at=p=>p.x>=2?(p.y<54?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'}):(p.y<64?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'});
 const ctl={forward:true,sprint:true};
 const bot={entity:{onGround:true,position:new Vec3(1.6,64,0.5),velocity:new Vec3(0.2,0,0)},blockAt:at,
  getControlState:k=>!!ctl[k],setControlState:(k,v)=>{ctl[k]=v;},pathfinder:{isMoving:()=>true}};
 assert.equal(ledgeGuard(bot),false,'the pathfinder keeps the walk');
 assert.equal(ctl.sprint,false,'but not the sprint');assert.equal(ctl.forward,true);
 ctl.sprint=true;bot.entity.position=new Vec3(0.2,64,0.5);
 assert.equal(ledgeGuard(bot),false);assert.equal(ctl.sprint,true,'flat ground ahead keeps the sprint');
});
test('round 31: fallWatch names a fall once, from its top',()=>{
 const st={},e={onGround:true,position:new Vec3(5,105,5)},bot={entity:e};
 assert.equal(fallWatch(bot,st),null);
 e.onGround=false;e.position=new Vec3(5,106,5);assert.equal(fallWatch(bot,st),null,'a jump');
 e.position=new Vec3(5,104,5);assert.equal(fallWatch(bot,st),null,'2 down: not yet');
 e.position=new Vec3(5,106-FALL_LOG,5);const f=fallWatch(bot,st);
 assert.ok(f&&f.from.y===106,'logged from the top of the arc: '+JSON.stringify(f));
 e.position=new Vec3(5,90,5);assert.equal(fallWatch(bot,st),null,'only once per fall');
 e.onGround=true;fallWatch(bot,st);e.onGround=false;e.position=new Vec3(5,89.5,5);
 assert.equal(fallWatch(bot,st),null,'landing resets it');
});
test('round 31: a food ascend ends at open sky (GoalSky), a cave still climbs to y',()=>{
 // sky light 15 over the hillside x>=10; a covered cave elsewhere
 const b={blockAt:p=>({name:'air',boundingBox:'empty',skyLight:p.x>=10?15:0})};
 const g=new GoalSky(b,137);
 assert.equal(g.isEnd({x:12,y:100,z:0}),true,'open sky at y=100 is the surface');
 assert.equal(g.isEnd({x:0,y:100,z:0}),false,'a cave is not');
 assert.equal(g.isEnd({x:0,y:137,z:0}),true,'the anchor height still ends it');
 assert.equal(g.heuristic({x:0,y:100,z:0}),37);
 assert.equal(headSky(b,new Vec3(12,100,0))>=SKY_OPEN,true);
 assert.equal(underSky({entity:{position:new Vec3(12.5,100,0.5)},blockAt:b.blockAt}),true);
 assert.equal(underSky({entity:{position:new Vec3(0.5,100,0.5)},blockAt:b.blockAt}),false);
});
test('round 31: a food ascend under open sky is done where it stands',async()=>{
 const w=Object.create(Worker.prototype);let walked=0;const logs=[];
 w.bot={entity:{position:new Vec3(339.5,105,27.5)},blockAt:()=>({name:'air',boundingBox:'empty',skyLight:15})};
 w.navigate=async()=>{walked++;};w.log=m=>logs.push(m);w.check=()=>{};
 await w.ascend({spec:{type:'ascend',y:137,forFood:true}},1);
 assert.equal(walked,0,'no climb toward y=137');
 await assert.rejects(()=>w.ascend({spec:{type:'ascend',y:137}},1),/Could not climb/,'an escape ascend still needs height');
});
import {burrowPlan} from '../src/worker.js';
test('round 32: burrowPlan digs three soft cells with solid walls and a floor',()=>{
 // grass at y=64, dirt under it to y=60, stone below; the bot stands at y=65
 const ground=(x,y,z)=>y===64?{name:'grass_block',boundingBox:'block'}:y>=60&&y<64?{name:'dirt',boundingBox:'block'}:y<60?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'};
 const p=burrowPlan(ground,{x:0,y:65,z:0});
 assert.ok(p.cells,'a plan: '+JSON.stringify(p));
 assert.deepEqual(p.cells.map(c=>c.y),[64,63,62]);
 assert.deepEqual(p.feet,{x:0,y:62,z:0});assert.deepEqual(p.cap,{x:0,y:64,z:0});
 assert.deepEqual(p.ref,{x:1,y:64,z:0},'the cap goes against a side wall at its own level');
 // stone at the feet: by hand no, with a pickaxe yes
 const rocky=(x,y,z)=>y<=64?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'};
 assert.match(burrowPlan(rocky,{x:0,y:65,z:0}).why,/stone/);
 assert.ok(burrowPlan(rocky,{x:0,y:65,z:0},true).cells);
 // a cave right under: no floor
 const cave=(x,y,z)=>y===61&&x===0&&z===0?{name:'air',boundingBox:'empty'}:ground(x,y,z);
 assert.match(burrowPlan(cave,{x:0,y:65,z:0}).why,/no floor/);
 // a cliff edge: an open wall beside a cell
 const edge=(x,y,z)=>x>=1&&y>=62?{name:'air',boundingBox:'empty'}:ground(x,y,z);
 assert.match(burrowPlan(edge,{x:0,y:65,z:0}).why,/open wall/);
 // water beside
 const wet=(x,y,z)=>x===-1&&y===63&&z===0?{name:'water',boundingBox:'empty'}:ground(x,y,z);
 assert.match(burrowPlan(wet,{x:0,y:65,z:0}).why,/open wall/);
});
test('round 32: burrow digs down three and caps the top from below',async()=>{
 const world=new Map();
 const key=(x,y,z)=>x+','+y+','+z;
 const at3=(x,y,z)=>{const k=key(x,y,z);if(world.has(k))return world.get(k);return y<=64?{name:'dirt',boundingBox:'block',position:new Vec3(x,y,z)}:{name:'air',boundingBox:'empty'};};
 const inv=[];
 const w=Object.create(Worker.prototype);const logs=[];
 w.bot={entity:{position:new Vec3(0.5,65,0.5)},blockAt:p=>at3(p.x,p.y,p.z),
  inventory:{items:()=>inv},equip:async()=>{},pathfinder:{},
  dig:async bl=>{world.set(key(bl.position.x,bl.position.y,bl.position.z),{name:'air',boundingBox:'empty'});w.bot.entity.position=new Vec3(0.5,bl.position.y,0.5);inv.push({name:'dirt',count:1});}};
 w.count=n=>inv.filter(i=>i.name===n).length;w.log=m=>logs.push(m);w.check=()=>{};w.update=()=>{};
 let placed=null;w.placeBlocks=async(ref,face,target,name)=>{placed={ref:ref.position,face,target,name};};
 const plan=await w.burrow({spec:{type:'shelter'}},1);
 assert.equal(Math.floor(w.bot.entity.position.y),62,'feet at the bottom of the hole');
 assert.ok(placed&&placed.target.y===64&&placed.name==='dirt','capped at y=64 with dug dirt: '+JSON.stringify(placed));
 assert.equal(placed.ref.x,1);assert.equal(placed.face.x,-1);
 assert.ok(logs.some(l=>/^Burrow: dug in/.test(l)));
 assert.deepEqual(plan.feet,{x:0,y:62,z:0});
});
test('round 32: a night shelter with no blocks burrows first, and holds the burrow',async()=>{
 const w=Object.create(Worker.prototype);const calls=[];
 w.bot={time:{timeOfDay:18000,age:100},entity:{position:new Vec3(0.5,65,0.5)},blockAt:()=>null,inventory:{items:()=>[]}};
 w.check=()=>{};w.log=()=>{};w.update=()=>{};w.save=()=>{};
 w.shelterStock=()=>0;w.shelterNeed=()=>11;
 w.burrow=async()=>{calls.push('burrow');return {feet:{x:0,y:62,z:0}};};
 w.holdBurrow=async()=>{calls.push('hold');return 'held';};
 w.digShelterDirt=async()=>{calls.push('dirt');};
 const job={spec:{type:'shelter'}};
 assert.equal(await w.shelter(job,1),'held');
 assert.deepEqual(calls,['burrow','hold'],'no walk to dig dirt first');
 assert.equal(job.burrowTried,true,'one burrow attempt per job');
});
test('round 33: ensureTable walks back to the table it left, and forgets one it cannot reach',async()=>{
 const w=Object.create(Worker.prototype);const logs=[];let walked=0;
 const table=new Vec3(20,64,0);
 w.bot={entity:{position:new Vec3(0.5,64,0.5)},blockAt:p=>p.equals(table)?{name:'crafting_table',position:table}:{name:'stone'},
  findBlock:()=>null,registry:{blocksByName:{crafting_table:{id:1}},itemsByName:{crafting_table:{id:1}}},recipesFor:()=>[]};
 w.count=()=>0;w.log=m=>logs.push(m);w.check=()=>{};w.usableRecipe=()=>null;
 w.leftTable={x:20,y:64,z:0};
 w.walk=async()=>{walked++;w.bot.entity.position=new Vec3(18.5,64,0.5);};
 const r=await w.ensureTable(1);
 assert.equal(walked,1);assert.ok(r.block&&r.block.name==='crafting_table');
 w.bot.entity.position=new Vec3(0.5,64,0.5);w.walk=async()=>{walked++;};
 await assert.rejects(()=>w.ensureTable(1),/need a crafting table/);
 assert.equal(w.leftTable,null,'an unreachable table is forgotten');
 assert.ok(logs.some(l=>/could not get back to the crafting table/.test(l)));
});
test('round 33: a drowning escape marks the worker, and a job resumed right after steps out first',async()=>{
 const w=new WorldSurvivalChain();const worker={};
 const bot=drowningBot({name:'water'});
 w._handleDrowning(bot,{},{worker});
 assert.ok(worker.lastDrownAt>0,'the escape stamps lastDrownAt');
 const wk=Object.create(Worker.prototype);let stepped=0;
 wk.leaveWater=async()=>{stepped++;};wk.check=()=>{};
 wk.takeStrandedTunnel=()=>null;wk.smelt=async()=>'smelted';
 const job={spec:{type:'smelt',item:'raw_iron',count:3},leaveWaterFirst:true};
 try{await wk.run(job,1);}catch{}
 assert.equal(stepped,1,'stepped out of the water before the job');
 assert.equal(job.leaveWaterFirst,false,'only once');
});
test('round 35: a plank recipe fills its cells from two woods when neither covers it alone',()=>{
 const reg={itemsByName:{oak_planks:{id:1,name:'oak_planks'},spruce_planks:{id:2,name:'spruce_planks'},dark_oak_planks:{id:3,name:'dark_oak_planks'},iron_ingot:{id:9,name:'iron_ingot'}},items:{}};
 for(const v of Object.values(reg.itemsByName))reg.items[v.id]=v;
 const inv={spruce_planks:4,dark_oak_planks:2,iron_ingot:1};
 const w=Object.create(Worker.prototype);w.count=n=>inv[n]||0;
 const b={registry:reg,inventory:{items:()=>Object.entries(inv).map(([name,count])=>({name,count,type:reg.itemsByName[name].id}))}};
 const P={id:1},I={id:9},_={id:-1};
 const shield={inShape:[[P,I,P],[P,P,P],[_,P,_]]};
 const r=w.usableRecipe(b,[shield],{});
 assert.ok(r,'6 planks of two woods make a shield');
 const done=w.withSubstitutions(r.recipe,r.subst);
 const ids=done.inShape.flat().filter(x=>x.id!==-1&&x.id!==9).map(x=>x.id).sort();
 assert.deepEqual(ids,[2,2,2,2,3,3],'4 spruce cells and 2 dark oak cells');
 assert.equal(shield.inShape[0][0].id,1,'the original recipe is untouched');
 inv.dark_oak_planks=1;
 assert.equal(w.usableRecipe(b,[shield],{}),null,'5 planks are not enough');
});
test('round 35: after a ledge stop the bot steps away with the opposite key, then lets go',async()=>{
 const at=p=>p.x>=2?(p.y<54?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'}):(p.y<64?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'});
 const ctl={forward:true};
 const bot={entity:{onGround:true,position:new Vec3(1.6,64,0.5),velocity:new Vec3(0.2,0,0),yaw:0},blockAt:at,
  getControlState:k=>!!ctl[k],setControlState:(k,v)=>{ctl[k]=v;},pathfinder:{isMoving:()=>false}};
 assert.equal(ledgeGuard(bot),true);
 assert.equal(ctl.forward,false);assert.equal(ctl.back,true,'walked forward to the edge: back away');
 bot.entity.velocity=new Vec3(-0.1,0,0);
 assert.equal(ledgeGuard(bot),false);assert.equal(ctl.back,true,'still backing within the window');
 bot._ledgeBack.until=Date.now()-1;
 ledgeGuard(bot);assert.equal(ctl.back,false,'released after the window');
 // A bot that backed toward the edge steps forward instead.
 Object.keys(ctl).forEach(k=>ctl[k]=false);ctl.back=true;bot.entity.velocity=new Vec3(0.2,0,0);bot._ledgeBack=null;
 assert.equal(ledgeGuard(bot),true);assert.equal(ctl.forward,true,'backed to the edge: step forward');
 // Something else steering ends the back-off at once.
 ctl.left=true;bot.entity.velocity=new Vec3(0,0,0.2);ledgeGuard(bot);assert.equal(bot._ledgeBack,null);
});
