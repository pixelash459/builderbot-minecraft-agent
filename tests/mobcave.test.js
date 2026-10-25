import test from 'node:test';
import assert from 'node:assert/strict';
import {mobCave} from '../src/autopilot.js';
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
