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
