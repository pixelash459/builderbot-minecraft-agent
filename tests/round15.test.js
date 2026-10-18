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
