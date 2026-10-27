import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';

// Round 61 (user, 2026-10-27: the bot breaking blocks with dirt in hand): the pillar's ceiling
// is dug with the best tool held, and a pillar that never rises says so.
test('round 61: the pillar digs its ceiling with the best tool, not the dirt it pillars with',async()=>{
 const w=Object.create(Worker.prototype),calls=[];
 let roof={name:'stone',boundingBox:'block',position:new Vec3(0,66,0)};
 const bot={entity:{position:new Vec3(0.5,64,0.5)},heldItem:{name:'dirt'},
  tool:{equipForBlock:async bl=>{calls.push('equip '+bl.name);bot.heldItem={name:'stone_pickaxe'};}},
  dig:async bl=>{calls.push('dig '+bl.name+' with '+bot.heldItem.name);roof=null;},
  blockAt:p=>p.y===66?(roof||{name:'air',boundingBox:'empty'}):p.y===63?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'},
  inventory:{items:()=>[]},setControlState(){},clearControlStates(){}};
 Object.assign(w,{bot,logs:[],log(m){this.logs.push(m);},check(){},epoch:1});
 await w.pillarUp(70,1,{clear:()=>true,maxDigs:4});
 assert.deepEqual(calls.slice(0,2),['equip stone','dig stone with stone_pickaxe']);
});
test('round 61: a pillar that never rises logs what it stood on and held',async()=>{
 const w=Object.create(Worker.prototype);
 const bot={entity:{position:new Vec3(0.5,12,0.5)},heldItem:{name:'dirt'},pathfinder:null,
  blockAt:p=>p.y===11?{name:'deepslate',boundingBox:'block'}:{name:'air',boundingBox:'empty'},
  inventory:{items:()=>[{name:'dirt',count:20}]},equip:async()=>{},placeBlock:async()=>{},setControlState(){},clearControlStates(){}};
 Object.assign(w,{bot,logs:[],log(m){this.logs.push(m);},check(){},epoch:1});
 const ok=await w.pillarUp(20,1);
 assert.equal(ok,false);
 assert.ok(w.logs.some(m=>/^Pillar: no rise in 3 jump-places at y=12 \(held dirt, under deepslate/.test(m)),w.logs.join(' | '));
});
