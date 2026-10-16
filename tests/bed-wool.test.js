// Round 10, bug B / habit 5: no bed in any round-9 run. The rung asked for a bed only with
// a sheep already within 32 (and gave up otherwise), and the dusk bed prep never runs on the
// frozen-day normal runs. Now: wool by day at any step after the wood kit, a log gather for
// the bed's planks when the wool is held, and sheep-search legs before the bed is set aside.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Vec3} from 'vec3';
import {Autopilot,bedJob,woolJob,isBedJob,BED_SEARCH_LEGS,BED_OFF_MS} from '../src/autopilot.js';
import {jobSchema} from '../src/schema.js';
const c=map=>n=>map[n]||0;
const WOOD={wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,crafting_table:1};
test('bedJob: wool held and no wood -> a short log gather; no sheep -> a search leg only when asked',()=>{
 const j=bedJob(c({white_wool:3,crafting_table:1}),{planksTotal:0,logsTotal:0});
 assert.deepEqual(j,{type:'gather',block:'log',count:1,radius:32,belowFoots:true});
 assert.equal(jobSchema.safeParse(j).success,true);
 assert.deepEqual(bedJob(c({white_wool:3}),{planksTotal:1,logsTotal:0}),{type:'gather',block:'log',count:2,radius:32,belowFoots:true},'7 planks without a table');
 assert.deepEqual(bedJob(c({white_wool:3,crafting_table:1}),{planksTotal:0,logsTotal:1,heldLog:'birch_log'}),{type:'craft',item:'birch_planks',count:3});
 assert.deepEqual(bedJob(c({white_wool:3,crafting_table:1}),{planksTotal:3,logsTotal:0}),{type:'craft',item:'white_bed',count:1});
 const kit={stone_sword:1,crafting_table:1};
 assert.equal(bedJob(c(kit),{sheepNear:0,planksTotal:3,logsTotal:0}),null);
 const leg=bedJob(c(kit),{sheepNear:0,planksTotal:3,logsTotal:0,bedSearch:true,grazeDirection:'east'});
 assert.deepEqual(leg,{type:'explore',direction:'east',distance:32});
 assert.equal(jobSchema.safeParse(leg).success,true);
 // No wood at all: the wool still comes first (the log gather pays the planks later).
 assert.deepEqual(bedJob(c({...kit,white_wool:2}),{sheepNear:1,planksTotal:0,logsTotal:0}),{type:'hunt',entity:'sheep',count:1});
});
test('woolJob: a sheep in reach by day after the wood kit; never at night, near a hostile or while set aside',()=>{
 assert.deepEqual(woolJob({...WOOD},{sheepNear:2,tod:3000}),{type:'hunt',entity:'sheep',count:2});
 assert.equal(woolJob({wooden_pickaxe:1},{sheepNear:2,tod:3000}),null,'the wood kit first');
 assert.equal(woolJob({...WOOD},{sheepNear:2,tod:12500}),null,'after sunset');
 assert.equal(woolJob({...WOOD},{sheepNear:2,tod:3000,hostileDistance:10}),null);
 assert.equal(woolJob({...WOOD},{sheepNear:2,tod:3000,bedOff:true}),null);
 assert.equal(woolJob({...WOOD,white_bed:1},{sheepNear:2,tod:3000}),null,'a bed held');
 assert.equal(woolJob({...WOOD},{sheepNear:0,tod:3000}),null,'no search legs outside the rung');
 assert.deepEqual(woolJob({...WOOD,shears:1},{sheepNear:1,tod:3000}),{type:'shear'});
});
function autopilot({tod=3000,items={},sheep=[]}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bed-wool-'));
 const submitted=[],jobs=[];
 const inv=Object.entries(items).map(([name,count])=>({name,count}));
 const entities={};sheep.forEach((p,i)=>{entities[100+i]={name:'sheep',position:new Vec3(...p)};});
 const worker={ready:true,userStopped:false,deathResume:false,jobs,log(){},
  submit(spec){jobSchema.parse(spec);submitted.push(spec);const job={id:'j'+submitted.length,status:'running',spec};jobs.push(job);return job;},
  cancel(id){const j=jobs.find(x=>x.id===id);if(j)j.status='cancelled';},
  bot:{time:{timeOfDay:tod,day:3},inventory:{items:()=>inv,slots:[]},entities,
   registry:{blocksByName:{},foodsByName:{cooked_beef:{}},itemsByName:{}},findBlock(){return null;},blockAt(){return null;},
   entity:{position:new Vec3(0.5,64,0.5)}}};
 const ap=new Autopilot(worker,root);ap.start();
 return {ap,worker,inv,jobs,submitted,done(){fs.rmSync(root,{recursive:true,force:true});}};
}
test('the stone step takes a passing sheep for its wool, as a bed job',()=>{
 const t=autopilot({items:{...WOOD,stick:4,oak_planks:4},sheep:[[8,64,3]]});
 try{
  t.ap.tick();
  assert.deepEqual(t.submitted[0],{type:'hunt',entity:'sheep',count:1});
  assert.equal(t.ap.currentStep,'bed-rung');
  t.jobs[0].status='failed';t.ap.tick();
  assert.equal(t.ap.failures.stone||0,0,'the stone step is not charged');
  t.ap.coolUntil=0;t.ap.tick();
  assert.equal(t.submitted.at(-1).block,'stone','set aside: back to the stone step');
 }finally{t.done();}
});
test('a sheep 30 blocks off is out of the hunt reach: no wool job',()=>{
 const t=autopilot({items:{...WOOD,stick:4,oak_planks:4},sheep:[[30,64,0]]});
 try{t.ap.tick();assert.equal(t.submitted[0].block,'stone');}finally{t.done();}
});
const RUNG={oak_planks:8,stick:10,crafting_table:1,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,cobblestone:32,stone_pickaxe:2,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1,cooked_beef:8,
 iron_pickaxe:1,iron_sword:1,shield:1,torch:16,iron_helmet:1,iron_chestplate:1};
test('the rung searches for sheep before it gives the bed up, then moves on to diamonds',()=>{
 const slots=[];slots[5]={name:'iron_helmet',count:1};slots[6]={name:'iron_chestplate',count:1};
 const t=autopilot({items:RUNG});t.worker.bot.inventory.slots=slots;
 try{
  for(let i=0;i<BED_SEARCH_LEGS;i++){
   t.ap.coolUntil=0;t.ap.tick();
   assert.equal(t.submitted.at(-1).type,'explore','search leg '+(i+1));
   assert.equal(t.ap.currentStep,'bed-rung');
   t.jobs.at(-1).status='complete';
  }
  assert.ok(t.ap.bedOffUntil>Date.now()+BED_OFF_MS-1000,'set aside after the last leg');
  t.ap.coolUntil=0;t.ap.tick();
  assert.equal(t.submitted.at(-1).block,'diamond_ore');
 }finally{t.done();}
});
test('a log gather the bed asked for is a bed job (never charged to the iron step)',()=>{
 assert.equal(isBedJob({type:'gather',block:'log',count:1}),false,'a plain log gather is not');
 const slots=[];slots[5]={name:'iron_helmet',count:1};slots[6]={name:'iron_chestplate',count:1};
 const t=autopilot({items:{...RUNG,oak_planks:0,stick:4,white_wool:3}});t.worker.bot.inventory.slots=slots;
 try{
  t.ap.tick();
  assert.equal(t.submitted[0].type,'gather');assert.equal(t.submitted[0].block,'log');
  assert.equal(t.ap.currentStep,'bed-rung');
  t.jobs[0].status='failed';t.ap.tick();
  assert.equal(t.ap.failures.iron||0,0,'the iron step is not charged');
  assert.ok(t.ap.bedOffUntil>Date.now()+BED_OFF_MS-1000);
 }finally{t.done();}
});
// Round 10, habit 5: the bed is the base and the spawn point.
import {Worker} from '../src/worker.js';
import {HOME_BED_RANGE} from '../src/autopilot.js';
function sleeper({home=null,placed=true}={}){
 const logs=[],calls=[];
 const bedAt=new Vec3(4,64,1);
 const ap={home,save(){calls.push('save');}};
 const bot={time:{timeOfDay:13000},isSleeping:false,entity:{position:new Vec3(0.5,64,0.5)},
  registry:{blocksByName:{white_bed:{id:7,name:'white_bed'}}},inventory:{items:()=>placed?[{name:'white_bed',count:1}]:[]},
  findBlock(){return placed?null:{name:'white_bed',position:bedAt};},blockAt(){return {name:'white_bed',position:bedAt};},
  async sleep(){bot.isSleeping=true;setTimeout(()=>{bot.isSleeping=false;bot.time.timeOfDay=100;},5);}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,autopilot:ap,check(){},update(){},log(m){logs.push(m);},
  async placeBlockNear(){calls.push('place');return bedAt;},async walk(){},async pickUp(p,name){calls.push('pickUp '+name+' '+p.x);}});
 return {w,ap,logs,calls,bedAt};
}
test('the first bed the bot places and sleeps in becomes home (the spawn point)',async()=>{
 const t=sleeper();
 await t.w.sleep({spec:{type:'sleep'}},0);
 assert.deepEqual(t.ap.home,{x:4,y:64,z:1});
 assert.ok(t.calls.includes('save'));
 assert.ok(t.logs.some(l=>/Home set to the bed at 4,64,1 \(spawn point\)/.test(l)));
 assert.ok(!t.calls.some(c=>c.startsWith('pickUp')),'the home bed stays');
});
test('a bed placed away from home is picked up in the morning; a world bed is left alone',async()=>{
 const t=sleeper({home:{x:90,y:64,z:90}});
 await t.w.sleep({spec:{type:'sleep'}},0);
 assert.deepEqual(t.calls.filter(c=>c.startsWith('pickUp')),['pickUp white_bed 4']);
 const u=sleeper({home:{x:90,y:64,z:90},placed:false});
 await u.w.sleep({spec:{type:'sleep'}},0);
 assert.deepEqual(u.calls.filter(c=>c.startsWith('pickUp')),[],'not the bot\'s to take');
 const v=sleeper({home:{x:4,y:64,z:1},placed:false});
 await v.w.sleep({spec:{type:'sleep'}},0);
 assert.ok(v.logs.some(l=>/Slept at home/.test(l)));
});
test('night: the home bed within range is walked back to, beyond it the shelter',()=>{
 for(const [dist,expect] of [[40,{type:'sleep',position:{x:40,y:64,z:0}}],[HOME_BED_RANGE+10,{type:'shelter'}]]){
  const t=autopilot({tod:13000,items:{wooden_pickaxe:1,cobblestone:30}});
  try{
   t.ap.home={x:dist,y:64,z:0};
   t.worker.bot.blockAt=p=>p.x===dist&&p.y===64&&p.z===0?{name:'white_bed'}:null;
   t.ap.tick();
   assert.deepEqual(t.submitted.at(-1),expect,'home bed '+dist+' away');
  }finally{t.done();}
 }
});
// ---- round 11: `no sheep after 3 search legs; bed set aside` in both normal runs ----------------
import {SHEEP_FAR,BED_SEARCH_DIST} from '../src/autopilot.js';
test('bedJob: a sheep seen beyond the hunt reach is walked toward; blind legs go wider',()=>{
 const kit={stone_sword:1,crafting_table:1};
 const toward=bedJob(c(kit),{sheepNear:0,planksTotal:3,logsTotal:0,bedSearch:true,sheepFar:{dx:-70,dz:20,distance:73}});
 assert.deepEqual(toward,{type:'explore',direction:'west',distance:58});
 assert.equal(jobSchema.safeParse(toward).success,true);
 assert.deepEqual(bedJob(c(kit),{sheepNear:0,planksTotal:3,logsTotal:0,bedSearch:true,sheepFar:{dx:3,dz:30,distance:30}}),{type:'explore',direction:'south',distance:18});
 assert.deepEqual(bedJob(c(kit),{sheepNear:0,planksTotal:3,logsTotal:0,bedSearch:true,grazeDirection:'north',searchDistance:96}),{type:'explore',direction:'north',distance:96});
 assert.equal(bedJob(c(kit),{sheepNear:0,planksTotal:3,logsTotal:0,sheepFar:{dx:40,dz:0}}),null,'outside the rung: no chase');
 assert.ok(BED_SEARCH_DIST.every(d=>d>=64&&d<=SHEEP_FAR));
});
test('bedJob: string is a wool source (4 string craft a white wool)',()=>{
 assert.deepEqual(bedJob(c({stone_sword:1,string:12}),{sheepNear:0,planksTotal:7,logsTotal:0}),{type:'craft',item:'white_wool',count:3});
 assert.deepEqual(bedJob(c({white_wool:2,string:4}),{sheepNear:0,planksTotal:7,logsTotal:0}),{type:'craft',item:'white_wool',count:1});
 assert.equal(bedJob(c({white_wool:1,string:7}),{sheepNear:0,planksTotal:7,logsTotal:0}),null,'one wool short');
});
test('the rung heads for a sheep it can see 60 blocks off, and widens its blind legs',()=>{
 const slots=[];slots[5]={name:'iron_helmet',count:1};slots[6]={name:'iron_chestplate',count:1};
 const t=autopilot({items:RUNG,sheep:[[0.5,64,-59.5]]});t.worker.bot.inventory.slots=slots;
 try{
  t.ap.tick();
  assert.deepEqual(t.submitted.at(-1),{type:'explore',direction:'north',distance:48});
  assert.equal(t.ap.currentStep,'bed-rung');
 }finally{t.done();}
 const u=autopilot({items:RUNG});u.worker.bot.inventory.slots=slots;
 try{
  u.ap.tick();
  assert.equal(u.submitted.at(-1).distance,BED_SEARCH_DIST[0]);
  u.jobs.at(-1).status='complete';u.ap.tick();
  assert.equal(u.submitted.at(-1).distance,BED_SEARCH_DIST[1]);
 }finally{u.done();}
});
test('with 2 iron ingots and a sheep in reach, shears come before killing sheep for wool',()=>{
 const c=o=>(n=>o[n]||0);
 assert.deepEqual(bedJob(c({iron_ingot:2,iron_sword:1}),{planksTotal:8,logsTotal:0,sheepNear:3}),{type:'craft',item:'shears',count:1});
 assert.deepEqual(bedJob(c({shears:1,iron_sword:1}),{planksTotal:8,logsTotal:0,sheepNear:3}),{type:'shear'});
 assert.equal(bedJob(c({iron_ingot:1,iron_sword:1}),{planksTotal:8,logsTotal:0,sheepNear:3}).type,'hunt','no ingots spare: hunt');
});
