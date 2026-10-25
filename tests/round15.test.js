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
test('round 36: tunnelToward steps level toward an ore no walk reaches, until it is in reach',async()=>{
 const w=Object.create(Worker.prototype);const steps=[];const logs=[];
 const ore=new Vec3(6,64,2);
 w.bot={entity:{position:new Vec3(0.5,64,0.5),eyeHeight:1.62},blockAt:p=>p.equals(ore)?{name:'iron_ore',position:ore}:{name:'stone'},
  canDigBlock:bl=>w.bot.entity.position.distanceTo(bl.position)<=4.5};
 w.check=()=>{};w.log=m=>logs.push(m);
 w.tunnelStep=async(job,token,dir,dy)=>{const f=w.bot.entity.position.floored();const next=f.offset(dir.x,dy,dir.z);steps.push([dir.x,dir.z,dy]);w.bot.entity.position=next.offset(0.5,0,0.5);return {dir,next};};
 await w.tunnelToward({name:'iron_ore',position:ore},1);
 assert.ok(w.bot.canDigBlock({position:ore}),'in reach');
 assert.ok(steps.length>=1&&steps.length<=3,'a few steps: '+JSON.stringify(steps));
 assert.ok(steps.every(([x,z,dy])=>dy===0&&(x===1||z===1)),'level, toward the ore');
 assert.ok(logs.some(l=>/tunnelled \d+ to the iron_ore/.test(l)));
 // A tunnel step that stops (fluid, cave) ends it with that error.
 w.bot.entity.position=new Vec3(0.5,64,0.5);
 w.tunnelStep=async()=>{throw Error('Tunnel stopped: water beside (1, 64, 0)');};
 await assert.rejects(()=>w.tunnelToward({name:'iron_ore',position:ore},1),/Tunnel stopped/);
});
test('round 37: an ore gather with no furnace crafts one for its kiln from 8 cobble',async()=>{
 const inv={raw_iron:3,cobblestone:12};const logs=[];const crafted=[];
 const w=Object.create(Worker.prototype);
 w.bot={entity:{position:new Vec3(0,64,0)},blockAt:()=>null};
 w.count=n=>inv[n]||0;w.log=m=>logs.push(m);w.check=()=>{};w.save=()=>{};
 w.craft=async job=>{crafted.push(job.spec.item);inv.furnace=1;inv.cobblestone-=8;};
 w.fuelPlan=async()=>{};w.placeBlockNear=async()=>new Vec3(1,64,0);
 w.walk=async()=>{};
 const job={spec:{block:'iron_ore',smeltAt:3}};
 try{await w.kilnTick(job,1);}catch{} // the fake world has no furnace block to open
 assert.deepEqual(crafted,['furnace']);
 assert.ok(logs.some(l=>/kiln at 1,64,0; smelting raw_iron/.test(l)),'the kiln started: '+JSON.stringify(logs));
 assert.ok(logs.some(l=>/crafted a furnace for the kiln/.test(l)));
 // Without the cobble it stays off, as before.
 const w2=Object.create(Worker.prototype);const inv2={raw_iron:3,cobblestone:4};const logs2=[];
 Object.assign(w2,{bot:w.bot,count:n=>inv2[n]||0,log:m=>logs2.push(m),check(){},save(){},craft:async()=>{throw Error('must not craft');}});
 const job2={spec:{block:'iron_ore',smeltAt:3}};
 await w2.kilnTick(job2,1);
 assert.match(job2.kilnOff,/no furnace held/);
});
test('round 38: a hazard spot keeps gathers away for a while, and any job after a drowning steps out first',async()=>{
 const w=Object.create(Worker.prototype);
 w.bot={entity:{position:new Vec3(312.5,113,10.5)}};
 w.markHazard();
 assert.equal(w.nearHazard(new Vec3(315,110,12)),true,'ore 5 away: skipped');
 assert.equal(w.nearHazard(new Vec3(330,113,10)),false,'ore 18 away: fine');
 w.hazards[0].until=Date.now()-1;
 assert.equal(w.nearHazard(new Vec3(315,110,12)),false,'expired');
 const wk=Object.create(Worker.prototype);let stepped=0;
 wk.leaveWater=async()=>{stepped++;};wk.check=()=>{};wk.takeStrandedTunnel=()=>null;wk.lastDrownAt=Date.now();
 try{await wk.run({spec:{type:'gather',block:'iron_ore',count:6}},1);}catch{}
 assert.equal(stepped,1,'a fresh job right after a drowning steps out too');
});
test('round 38: health falling with no attacker and air below full is treated as drowning',()=>{
 const w=new WorldSurvivalChain();const logs=[];const ctl={};
 const air={name:'air',boundingBox:'empty'};
 const bot={health:20,food:18,oxygenLevel:12,entity:{position:new Vec3(59.5,51,37.5),isInWater:false},entities:{},blockAt:()=>air,setControlState:(k,v)=>{ctl[k]=v;}};
 const ctx={worker:{log:m=>logs.push(m)}};
 w._handleDrowning(bot,{},ctx);assert.equal(w._drowning,undefined);
 bot.health=18;w._handleDrowning(bot,{},ctx);assert.ok(!w._drowning,'one drop is not enough');
 bot.health=16;w._handleDrowning(bot,{},ctx);
 assert.equal(w._drowning,true,'two drops, no attacker, air 12: drowning');assert.equal(ctl.jump,true);
 assert.ok(logs.some(l=>/losing health with no attacker \(air 12, head air, feet air\)/.test(l)),JSON.stringify(logs));
 // A zombie beside the bot explains the damage.
 const w2=new WorldSurvivalChain();const bot2={...bot,health:20,entities:{1:{type:'hostile',position:new Vec3(60,51,37)}}};
 w2._handleDrowning(bot2,{},ctx);bot2.health=18;w2._handleDrowning(bot2,{},ctx);bot2.health=16;w2._handleDrowning(bot2,{},ctx);
 assert.ok(!w2._drowning,'a hostile within 6 explains it');
});
test('round 40: an ascend with no path up pillars straight up instead',async()=>{
 const w=Object.create(Worker.prototype);const logs=[];let pillared=null;
 w.bot={entity:{position:new Vec3(237.5,53,87.5)},blockAt:()=>({name:'stone',boundingBox:'block',skyLight:0,position:new Vec3(0,0,0)})};
 w.navigate=async()=>{throw Error('No path to the goal! (empty path at (237, 53, 87), last path)');};
 w.log=m=>logs.push(m);w.check=()=>{};
 w.pillarUp=async(targetY,token,opts)=>{pillared={targetY,opts};w.bot.entity.position=new Vec3(237.5,70,87.5);return true;};
 await w.ascend({spec:{type:'ascend',y:131,forFood:true}},1);
 assert.ok(pillared,'pillared');assert.equal(pillared.targetY,53+24);
 assert.ok(typeof pillared.opts.clear==='function'&&pillared.opts.maxDigs===24);
 assert.ok(logs.some(l=>/no path up from y=53; pillaring/.test(l)));
 assert.ok(logs.some(l=>/Ascend: y=53 -> 70/.test(l)));
});
test('round 42: a skeleton 20 away or a recent fall explains lost health - not drowning',()=>{
 const air={name:'air',boundingBox:'empty'};
 const mk=()=>({health:20,food:18,oxygenLevel:17,entity:{position:new Vec3(0,64,0),onGround:true},entities:{},blockAt:()=>air,setControlState(){}});
 const w=new WorldSurvivalChain();const bot=mk();bot.entities={1:{type:'hostile',position:new Vec3(20,64,0)}};
 w._handleDrowning(bot,{},{});bot.health=18;w._handleDrowning(bot,{},{});bot.health=16;w._handleDrowning(bot,{},{});
 assert.ok(!w._drowning,'a skeleton 20 away');
 const w2=new WorldSurvivalChain();const b2=mk();
 b2.entity.onGround=false;w2._handleDrowning(b2,{},{});b2.entity.onGround=true;
 b2.health=18;w2._handleDrowning(b2,{},{});b2.health=16;w2._handleDrowning(b2,{},{});
 assert.ok(!w2._drowning,'just landed from a fall');
});
test('round 42: one burrow try per spot - a new stand 3+ away gets another',()=>{
 const w=Object.create(Worker.prototype);w.bot={entity:{position:new Vec3(110.5,136,-25.5)}};
 const job={spec:{type:'shelter'}};
 assert.equal(w.burrowAgain(job),true);assert.equal(job.burrowTried,true);
 assert.equal(w.burrowAgain(job),false,'same spot');
 w.bot.entity.position=new Vec3(100.5,135,-26.5);
 assert.equal(w.burrowAgain(job),true,'10 blocks on');
});
test('round 44: leaving the deep dark gives up a furnace batch there and keeps gathers 32 away',()=>{
 const w=Object.create(Worker.prototype);const logs=[];
 w.bot={entity:{position:new Vec3(148.5,-46,50.5)}};w.log=m=>logs.push(m);
 w.furnaceRun={x:148,y:-44,z:45,started:1};
 w.markDeepDark();
 assert.equal(w.furnaceRun,null,'the batch beside the sculk is given up');
 assert.ok(logs.some(l=>/giving up the furnace batch at 148,-44,45/.test(l)));
 assert.equal(w.nearHazard(new Vec3(160,-40,60)),true,'an ore 20 away is skipped');
 assert.equal(w.nearHazard(new Vec3(200,-40,50)),false,'52 away is fine');
 w.furnaceRun={x:300,y:60,z:10};w.markDeepDark();
 assert.ok(w.furnaceRun,'a far batch is kept');
});
test('round 44: a stand with drops on every side paths once more allowing 6-block drops',async()=>{
 const {EventEmitter:EE}=await import('node:events');
 const mv={maxDropDown:3,exclusionAreasStep:[]};let calls=0,seenDrop=[];
 const bot=Object.assign(new EE(),{health:20,entity:{onGround:true,position:new Vec3(369.5,137,35.5)},targetDigBlock:null,
  pathfinder:{movements:mv,goto(){calls++;seenDrop.push(mv.maxDropDown);bot.emit('path_update',{status:'noPath',path:[],visitedNodes:3});if(mv.maxDropDown===6)bot.entity.position=new Vec3(380.5,131,35.5);return Promise.resolve();},setGoal(){},isMining:()=>false},clearControlStates(){}});
 const w=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,ready:true,deadline:Date.now()+60000,survivalJob:true,config:{limits:{minHealth:10,minFood:6}},logs:[],log(m){this.logs.push(m);},applyMobAvoidance(){},stairOut:async()=>false});
 await w.navigate(new pf.goals.GoalNear(380,131,35,1),0,5);
 assert.deepEqual(seenDrop,[3,6],'second try with 6-block drops');
 assert.equal(mv.maxDropDown,3,'restored');
 assert.ok(w.logs.some(l=>/stranded at .*allowing drops of up to 6 and digging/.test(l)));
 // low health: no deep drops
 bot.health=8;bot.entity.position=new Vec3(369.5,137,35.5);seenDrop=[];
 await assert.rejects(()=>w.navigate(new pf.goals.GoalNear(380,131,35,1),0,5),/No path/);
 assert.deepEqual(seenDrop,[3]);
});
test('round 45: the stranded retry lowers the surface floor with the drop limit, then restores it',async()=>{
 const {EventEmitter:EE}=await import('node:events');
 const mv={maxDropDown:3,exclusionAreasStep:[]};const floors=[];
 const bot=Object.assign(new EE(),{health:20,entity:{onGround:true,position:new Vec3(359.5,101,129.5)},targetDigBlock:null,
  pathfinder:{movements:mv,goto(){floors.push(w.surfaceFloor);bot.emit('path_update',{status:'noPath',path:[],visitedNodes:1});if(mv.maxDropDown===6)bot.entity.position=new Vec3(365.5,97,129.5);return Promise.resolve();},setGoal(){},isMining:()=>false},clearControlStates(){}});
 const w=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,ready:true,deadline:Date.now()+60000,survivalJob:true,config:{limits:{minHealth:10,minFood:6}},logs:[],log(m){this.logs.push(m);},applyMobAvoidance(){},stairOut:async()=>false,surfaceFloor:101});
 await w.navigate(new pf.goals.GoalNear(365,97,129,1),0,5);
 assert.deepEqual(floors,[101,95]);assert.equal(w.surfaceFloor,101,'restored');
});
test('round 45: still stranded after the 6-drop try, the bot pillars up and paths again',async()=>{
 const {EventEmitter:EE}=await import('node:events');
 const mv={maxDropDown:3,exclusionAreasStep:[]};let calls=0,pillared=0;
 const bot=Object.assign(new EE(),{health:20,entity:{onGround:true,position:new Vec3(340.5,78,142.5)},targetDigBlock:null,
  pathfinder:{movements:mv,goto(){calls++;bot.emit('path_update',{status:'noPath',path:[],visitedNodes:1});if(pillared)bot.entity.position=new Vec3(350.5,80,142.5);return Promise.resolve();},setGoal(){},isMining:()=>false},clearControlStates(){}});
 const w=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,ready:true,deadline:Date.now()+60000,survivalJob:true,config:{limits:{minHealth:10,minFood:6}},logs:[],log(m){this.logs.push(m);},applyMobAvoidance(){},stairOut:async()=>false,
  pillarUp:async(y)=>{pillared++;bot.entity.position=new Vec3(340.5,81,142.5);return true;}});
 await w.navigate(new pf.goals.GoalNear(350,80,142,1),0,5);
 assert.equal(pillared,1);
 assert.ok(w.logs.some(l=>/still stranded at .*pillaring up 3/.test(l)));
 assert.equal(mv.maxDropDown,3);
});
test('round 46: job walks sprint (the normal movements allow it, like the explore ones)',async()=>{
 const reg=(await import('prismarine-registry')).default('1.21.4');
 const bot={registry:reg,version:'1.21.4',world:{},entities:{},blockAt:()=>null,entity:{position:new Vec3(0,64,0)}};
 const w=Object.create(Worker.prototype);w.bot=bot;w.applyMobAvoidance=()=>{};w.avoidHazards=()=>{};
 const m=w.normalMovements(bot);
 assert.equal(m.allowSprinting,true);
 assert.equal(m.maxDropDown,3);
});
import {newGait,gaitTick,GAIT_LOG_MS} from '../src/worker.js';
test('round 47: the sprint share of pathfinder walking is logged every 5 min',()=>{
 const g=newGait();let sprint=true;
 const bot={food:18,entity:{onGround:true},pathfinder:{isMoving:()=>true},getControlState:k=>k==='sprint'&&sprint};
 let t=0;assert.equal(gaitTick(bot,g,t),null);
 for(let i=0;i<99;i++){sprint=i%4!==0;t+=50;gaitTick(bot,g,t);}
 const line=gaitTick(bot,g,GAIT_LOG_MS+1);
 assert.match(line,/^Movement: sprinting 7\d% of 5 s of pathfinder walking \(food 18\)$/);
 assert.equal(g.walk,0,'reset');
});
test('round 48: the stranded retry may dig, then the movements go back to no digging',async()=>{
 const {EventEmitter:EE}=await import('node:events');
 const mv={maxDropDown:3,canDig:false,exclusionAreasStep:[]};const digs=[];
 const bot=Object.assign(new EE(),{health:20,entity:{onGround:true,position:new Vec3(313.5,112,51.5)},targetDigBlock:null,
  pathfinder:{movements:mv,goto(){digs.push(mv.canDig);bot.emit('path_update',{status:'noPath',path:[],visitedNodes:1});if(mv.canDig)bot.entity.position=new Vec3(320.5,110,51.5);return Promise.resolve();},setGoal(){},isMining:()=>false},clearControlStates(){}});
 const w=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,ready:true,deadline:Date.now()+60000,survivalJob:true,config:{limits:{minHealth:10,minFood:6}},logs:[],log(m){this.logs.push(m);},applyMobAvoidance(){},stairOut:async()=>false});
 await w.navigate(new pf.goals.GoalNear(320,110,51,1),0,5);
 assert.deepEqual(digs,[false,true]);assert.equal(mv.canDig,false,'restored');
});
test('round 49: a World Survival band says what it saw, at most every 10 s',()=>{
 const w=new WorldSurvivalChain();const logs=[];let t=100;w.now=()=>t;
 const bot={entity:{position:new Vec3(272.5,54,20.5)},blockAt:p=>({name:p.y>55?'gravel':'air'})};
 const ctx={worker:{log:m=>logs.push(m)}};
 w._bandLog(bot,ctx,'wall','head in a wall; digging out');
 w._bandLog(bot,ctx,'wall','head in a wall; digging out');t+=11;w._bandLog(bot,ctx,'wall','head in a wall; digging out');
 assert.equal(logs.length,2);
 assert.match(logs[0],/^WorldSurvival: head in a wall; digging out at \(272, 54, 20\) \(head gravel, feet air\)$/);
});
test('round 49: 30 s under water at full health stands the stale-air backstop down',()=>{
 const w=new WorldSurvivalChain();
 const water={name:'water',boundingBox:'empty'};
 const bot={health:20,food:20,oxygenLevel:20,entity:{position:new Vec3(272.5,54,20.5),isInWater:true,onGround:true},entities:{},blockAt:()=>water,setControlState(){}};
 const real=Date.now;let t=real();Date.now=()=>t;
 try{
  w._handleDrowning(bot,{},{});t+=9000;w._handleDrowning(bot,{},{});
  assert.equal(w._drowning,true,'9 s under with a stale reading: the round-21 backstop still fires');
  w._drowning=false;t+=22000;w._handleDrowning(bot,{},{});
  assert.ok(!w._drowning,'31 s under at full health: breathing, the backstop stands down');
  bot.health=14;w._handleDrowning(bot,{},{});
  assert.equal(w._drowning,true,'losing health: back on');
 }finally{Date.now=real;}
});
