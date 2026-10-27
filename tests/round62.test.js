import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,HARMLESS_PREY,SEARCH_MISSES} from '../src/worker.js';

// Round 62: the round-60 soak on seed 20261027.
test('round 62: a low-health hunt keeps going after prey that cannot hit back, not with a hostile near',()=>{
 const w=Object.create(Worker.prototype);
 const chicken={id:3,name:'chicken',type:'animal',position:new Vec3(2,64,0)};
 w.bot={entity:{position:new Vec3(0,64,0)},entities:{3:chicken}};
 const task={controller:{target:chicken}};
 assert.ok(HARMLESS_PREY.has('chicken'));
 assert.equal(w.harmlessFight(task),true);
 w.bot.entities[4]={id:4,name:'zombie',type:'hostile',position:new Vec3(6,64,0)};
 assert.equal(w.harmlessFight(task),false,'a zombie within 10');
 delete w.bot.entities[4];
 assert.equal(w.harmlessFight({controller:{target:{id:5,name:'zombie',type:'hostile',position:new Vec3(2,64,0)}}}),false);
 w.bot._provoked=new Map([[3,Date.now()+60000]]);
 assert.equal(w.harmlessFight(task),false,'prey that hit back is no longer harmless');
});
test('round 62: a search target missed twice has its column blacklisted; reaching it clears the count',()=>{
 const seen=new Set(),w=Object.create(Worker.prototype);
 Object.assign(w,{logs:[],log(m){this.logs.push(m);},bot:{entity:{position:new Vec3(62.5,71,205.5)}},
  blacklist:{block:p=>seen.add(p.x+','+p.y+','+p.z)}});
 w.searchMiss('4,77,212');
 assert.equal(seen.size,0,'one miss');
 w.searchMiss('4,77,212');
 assert.equal(SEARCH_MISSES,2);
 assert.ok(seen.has('4,77,212')&&seen.has('4,69,212')&&seen.has('4,85,212'));
 assert.ok(/^Gather: the search target at 4,77,212 was missed 2 times/.test(w.logs[0]),w.logs[0]);
 seen.clear();w.logs.length=0;
 w.searchMiss('10,70,10');
 w.bot.entity.position=new Vec3(12,70,12);
 w.searchMiss('10,70,10');
 w.bot.entity.position=new Vec3(62.5,71,205.5);
 w.searchMiss('10,70,10');
 assert.equal(seen.size,0,'reached once in between: the count started over');
});
test('round 62: the canopy pillar digs two spare blocks',async()=>{
 const w=Object.create(Worker.prototype);let asked=null;
 const log=new Vec3(0,82,0);
 Object.assign(w,{logs:[],log(m){this.logs.push(m);},check(){},walk:async()=>{},
  bot:{entity:{position:new Vec3(0.5,77,0.5)}},
  shelterStock:()=>asked==null?3:0,
  digShelterDirt:async(job,token,need)=>{asked=need();}});
 await w.pillarToLog({},1,log);
 assert.equal(asked,4,'rise 2 + 2 spare');
});
