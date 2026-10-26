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
 assert.equal(caveMorning({sky:0,crowd:3,y:71,surfaceY:64}),false,'round 57: a sealed box above the surface anchor is no cave');
 assert.equal(caveMorning({sky:0,crowd:3,y:55,surfaceY:64}),true);
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
import {deepBox} from '../src/worker.js';
test('night mine: never from a box deep underground',()=>{
 assert.equal(deepBox(41,0,64),true,'round-54 box at y=41 over the cave');
 assert.equal(deepBox(63,0,64),false,'a surface box under its own roof');
 assert.equal(deepBox(41,15,64),false,'a ravine floor under the open sky');
 assert.equal(deepBox(-60,0,undefined),false,'no surface anchor yet');
});
test('recipes: with no variant the bag pays for as-is, every variant is tried (mixed planks)',()=>{
 const w=Object.create(Worker.prototype);
 const b={recipesFor:()=>[],recipesAll:(id)=>[{id,all:true}]};
 assert.deepEqual(w.recipeVariants(b,5,null),[{id:5,all:true}]);
 b.recipesFor=()=>[{id:5}];assert.deepEqual(w.recipeVariants(b,5,null),[{id:5}],'a fitting variant wins');
 assert.deepEqual(w.recipeVariants({recipesFor:()=>[]},5,null),[],'no recipesAll: nothing');
});
