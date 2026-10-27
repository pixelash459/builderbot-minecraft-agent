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
import {EventEmitter} from 'node:events';
import {installProvoked,provoked,PROVOKED_MS} from '../src/provoked.js';
import {getHostiles} from '../src/chains/combatPolicy.js';

// Round 61 (round-60 soak: `slain by Polar Bear`, no Mob Defense line before it): a mob that
// hurts the bot is a threat, and a polar bear mother near her cub is one on sight.
test('round 61: a passive-filed mob that hits the bot becomes a hostile for Mob Defense',()=>{
 const bot=new EventEmitter(),logs=[];
 bot.entity={position:new Vec3(0,64,0)};
 const bear={id:7,name:'polar_bear',type:'animal',position:new Vec3(2,64,0),metadata:[]};
 bot.entities={1:bot.entity,7:bear};
 installProvoked(bot,m=>logs.push(m));
 assert.equal(getHostiles(bot,null).length,0,'a lone adult bear is left alone');
 bot.emit('entityHurt',bot.entity,bear);
 assert.deepEqual(getHostiles(bot,null),[bear]);
 assert.ok(/^Threat: polar_bear .* hit the bot; treating it as hostile for 60 s$/.test(logs[0]),logs[0]);
 assert.equal(provoked(bot,bear,Date.now()+PROVOKED_MS+1),false,'it calms down after a minute');
 bot.emit('entityHurt',{id:9},bear);
 assert.equal(logs.length,1,'another entity hurt is not the bot');
});
test('round 61: an adult polar bear with a cub close by is a threat on sight',()=>{
 const bot={entity:{position:new Vec3(0,64,0)}};
 const mum={id:7,name:'polar_bear',type:'animal',position:new Vec3(6,64,0),metadata:[]};
 const cub={id:8,name:'polar_bear',type:'animal',position:new Vec3(9,64,0),metadata:{16:true}};
 bot.entities={7:mum,8:cub};
 assert.equal(provoked(bot,mum),true);
 assert.equal(provoked(bot,cub),false,'the cub itself is no threat');
 mum.position=new Vec3(20,64,0);
 assert.equal(provoked(bot,mum),false,'a mother out of reach is left alone');
});
