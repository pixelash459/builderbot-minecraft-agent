import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,THROW_RUN} from '../src/worker.js';
import {guardEquip} from '../src/eating.js';

// Round 63: the round-62 soak on seed 20261027.
test('round 63: before the target is locked, the job entity names the prey',()=>{
 const w=Object.create(Worker.prototype);
 w.bot={entity:{position:new Vec3(0,64,0)},entities:{}};
 assert.equal(w.harmlessFight({entityFilter:'pig',controller:{target:null}}),true,'no target yet: the pig hunt is still harmless');
 assert.equal(w.harmlessFight({entityFilter:'zombie',controller:null}),false);
 w.bot.entities[4]={id:4,name:'zombie',type:'hostile',position:new Vec3(5,64,0)};
 assert.equal(w.harmlessFight({entityFilter:'pig'}),false,'a zombie within 10');
});
test('round 63: an equip refused by a stale container window closes it and retries once',async()=>{
 let calls=0;const logs=[];
 const bot={currentWindow:{type:'minecraft:furnace'},closeWindow(w){if(this.currentWindow===w)this.currentWindow=null;},
  equip:async()=>{calls++;if(bot.currentWindow)throw Error('invalid operation');},__windowLog:m=>logs.push(m)};
 guardEquip(bot);
 await bot.equip({name:'dirt'},'hand');
 assert.equal(calls,2);assert.equal(bot.currentWindow,null);
 assert.ok(/closed a stale minecraft:furnace window/.test(logs[0]),logs[0]);
 const plain={currentWindow:null,equip:async()=>{throw Error('invalid operation');}};
 guardEquip(plain);
 await assert.rejects(plain.equip({name:'dirt'},'hand'),/invalid operation/,'no window: the error stands');
});
test('round 63: a job starts with no container window left over',()=>{
 const w=Object.create(Worker.prototype),logs=[];
 w.log=m=>logs.push(m);
 w.bot={currentWindow:{type:'minecraft:furnace'},closeWindow(x){this.currentWindow=null;}};
 assert.equal(w.closeStaleWindow('before the shelter job'),true);
 assert.equal(w.bot.currentWindow,null);
 assert.ok(/^Window: closed a stale minecraft:furnace window left open before the shelter job/.test(logs[0]));
 assert.equal(w.closeStaleWindow('x'),false);
});
function tossWorld(open,{pathfinder=false,stays=true}={}){
 const inv=[{name:'wooden_pickaxe',count:1},{name:'stone_pickaxe',count:1}],tossed=[],looks=[],navs=[];
 const w=Object.create(Worker.prototype);
 Object.assign(w,{logs:[],log(m){this.logs.push(m);},check(){},count:n=>inv.filter(s=>s.name===n).reduce((a,s)=>a+s.count,0),
  dropSettleMs:0,navigate:async g=>{navs.push(g);},
  bot:{entity:{position:new Vec3(0.5,64,0.5)},pathfinder:pathfinder?{}:undefined,
   blockAt:p=>({name:open(p)?'air':'stone',boundingBox:open(p)?'empty':'block'}),
   look:async(y,p)=>looks.push([y,p]),
   inventory:{items:()=>inv.filter(s=>s.count>0)},tossStack:async it=>{tossed.push(it.name);if(stays)it.count=0;}}});
 return {w,tossed,looks,navs};
}
test('round 63/64: a spare tool is thrown down an open run, or kept with no room near',async()=>{
 // a 1x2 tunnel running east: open from x=1 to x=5
 const t=tossWorld(p=>p.z===0&&p.x>=0&&p.x<=5&&(p.y===64||p.y===65));
 assert.equal(THROW_RUN,3);
 await t.w.tossSpareTools('stone_pickaxe',1);
 assert.deepEqual(t.tossed,['wooden_pickaxe']);
 assert.equal(t.looks.length,1);
 assert.ok(Math.abs(t.looks[0][0]-Math.atan2(-1,-0))<1e-9,'faces east, down the tunnel');
 // a dead end two cells long, nowhere to walk to: keep it, and do not retry at once
 const k=tossWorld(p=>p.z===0&&p.x>=0&&p.x<=2&&(p.y===64||p.y===65),{pathfinder:true});
 await k.w.tossSpareTools('stone_pickaxe',1);
 assert.deepEqual(k.tossed,[]);
 assert.ok(/^Craft: keeping the spare wooden_pickaxe for now \(no room to throw it within 12/.test(k.w.logs[0]),k.w.logs[0]);
 await k.w.tossSpareTools('stone_pickaxe',1);
 assert.equal(k.w.logs.length,1,'kept for SPARE_RETRY_MS');
});
test('round 64: after the toss the bot steps away; a spare that came back is kept for 5 min',async()=>{
 const open=p=>p.z===0&&p.x>=0&&p.x<=6&&(p.y===64||p.y===65);
 const ok=tossWorld(open,{pathfinder:true});
 await ok.w.tossSpareTools('stone_pickaxe',1);
 assert.equal(ok.navs.length,1,'walked away from the landing spot');
 assert.ok(!ok.w.logs.some(l=>/came back/.test(l)));
 const back=tossWorld(open,{pathfinder:true,stays:false});
 await back.w.tossSpareTools('stone_pickaxe',1);
 assert.ok(back.w.logs.some(l=>/^Craft: the dropped wooden_pickaxe came back \(picked up again\); keeping it for 5 min/.test(l)),JSON.stringify(back.w.logs));
 back.tossed.length=0;
 await back.w.tossSpareTools('stone_pickaxe',1);
 assert.deepEqual(back.tossed,[],'no second toss within 5 min');
});
