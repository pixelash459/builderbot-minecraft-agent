import test from 'node:test';
import assert from 'node:assert/strict';
import {mobCave} from '../src/autopilot.js';
import {Vec3} from 'vec3';
import {Worker,MOB_CAVE_AVOID} from '../src/worker.js';
test('mob cave: a crowd underground, not on the surface or a ravine floor',()=>{
 assert.equal(mobCave({crowd:7,underSky:false,standY:38,lastSurfaceY:64}),true);
 assert.equal(mobCave({crowd:5,underSky:false,standY:38,lastSurfaceY:64}),false,'a small crowd: the reflexes');
 assert.equal(mobCave({crowd:9,underSky:true,standY:38,lastSurfaceY:64}),false,'open sky: the surface crowd rules');
 assert.equal(mobCave({crowd:9,underSky:false,standY:60,lastSurfaceY:64}),false,'just under a canopy');
});
test('mob cave: marked once, and its ores count as a hazard',()=>{
 const w=Object.create(Worker.prototype);
 w.bot={entity:{position:{x:17,y:39,z:76}}};
 assert.equal(w.markMobCave(),true);
 assert.equal(w.markMobCave(),false,'the same cave is not new');
 assert.equal(w.nearHazard({x:20,y:30,z:90}),true);
 assert.equal(w.nearHazard({x:17+MOB_CAVE_AVOID+5,y:39,z:76}),false);
 w.bot.entity.position={x:200,y:20,z:76};assert.equal(w.markMobCave(),true,'another cave');
});
import {caveMorning,CAVE_EXIT_NEAR} from '../src/worker.js';
test('cave morning: a box underground with a crowd is left through the roof',()=>{
 assert.equal(caveMorning({sky:0,crowd:5}),true);
 assert.equal(caveMorning({sky:0,crowd:2}),false,'a quiet cave: open up as before');
 assert.equal(caveMorning({sky:15,crowd:9}),false,'on the surface the morning burns them');
 const w=Object.create(Worker.prototype);
 const me=new Vec3(0,39,0);
 const mob=(x)=>({type:'hostile',position:new Vec3(x,39,0)});
 w.bot={entity:{position:me},entities:{1:mob(5),2:mob(20),3:mob(CAVE_EXIT_NEAR+3),4:{type:'animal',position:new Vec3(1,39,0)}}};
 assert.equal(w.hostilesWithin(CAVE_EXIT_NEAR),2);
});
test('mob cave: the live check - a crowd within 24, no sky, deep - marks the cave',()=>{
 const w=Object.create(Worker.prototype);
 const sky={v:0};
 const mobs={};for(let i=0;i<6;i++)mobs[i]={type:'hostile',position:new Vec3(10+i,39,0)};
 w.bot={entity:{position:new Vec3(0,39,0)},entities:mobs,blockAt:()=>({name:'cave_air',skyLight:sky.v})};
 w.autopilot={lastSurfaceY:64};
 assert.match(w.mobCaveHere(),/6 hostiles within 24/);
 assert.equal(w.nearHazard({x:5,y:39,z:5}),true,'marked');
 sky.v=15;w.mobCaves=[];assert.equal(w.mobCaveHere(),null,'a ravine under the open sky');
 sky.v=0;delete mobs[5];assert.equal(w.mobCaveHere(),null,'five is the reflexes\' job');
 mobs[5]={type:'hostile',position:new Vec3(1,39,0)};w.bot.entity.position=new Vec3(0,60,0);
 assert.equal(w.mobCaveHere(),null,'just under the surface');
});
