// Round 10, efficiency 1 (observed live in the round-9 soak): while smelting iron the bot stood
// looking at the furnace with exposed coal all around it. A furnace works on its own: load it,
// work nearby, come back when the batch is ready. Fake clock + fake furnace.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Vec3} from 'vec3';
import {Worker,KILN_ITEM_MS} from '../src/worker.js';
import {Autopilot,furnaceWork,FURNACE_SIDE_JOBS,FURNACE_DUSK} from '../src/autopilot.js';
import {jobSchema} from '../src/schema.js';
// A furnace that smelts one item per KILN_ITEM_MS of the (fake) clock.
function clock(){let t=1e12;return {now:()=>t,advance:ms=>{t+=ms;}};}
function smeltFake({worldFurnace=false,clk=clock()}={}){
 const calls=[],inv={raw_iron:6,coal:1,iron_ingot:0,furnace:worldFurnace?0:1,stone_pickaxe:1};
 const furnaceAt=new Vec3(2,64,0);let present=true;
 const state={input:0,output:0,fuel:0,loadedAt:0,done:0};
 const tick=()=>{const n=Math.min(state.input,Math.floor((clk.now()-state.loadedAt)/KILN_ITEM_MS)-state.done);if(n>0){state.input-=n;state.output+=n;state.done+=n;}};
 const w=Object.assign(Object.create(Worker.prototype),{
  bot:{registry:{itemsByName:{raw_iron:{id:1},iron_ingot:{id:2},coal:{id:3},furnace:{id:4}},blocksByName:{furnace:{id:40}},foodsByName:{}},
   inventory:{items(){return Object.entries(inv).filter(([,n])=>n>0).map(([name,count])=>({name,count}));}},
   findBlock(){return worldFurnace?{position:furnaceAt,name:'furnace'}:null;},
   blockAt(p){return present?{position:furnaceAt,name:'furnace'}:{position:p,name:'air'};},
   async openFurnace(){calls.push(['open']);return {
    async putInput(id,meta,n){inv.raw_iron-=n;state.input+=n;state.loadedAt=clk.now();state.done=0;},
    async putFuel(id,meta,n){inv.coal-=n;state.fuel+=n;},
    inputItem(){tick();return state.input?{count:state.input}:null;},
    outputItem(){tick();return state.output?{count:state.output}:null;},
    fuelItem(){return state.fuel?{count:state.fuel,name:'coal',type:3}:null;},
    async takeOutput(){inv.iron_ingot+=state.output;state.output=0;},
    async takeInput(){inv.raw_iron+=state.input;state.input=0;},
    async takeFuel(){inv.coal+=state.fuel;state.fuel=0;}};},
   async closeWindow(){}},
  meals:{cooked:0},logs:[],log(m){this.logs.push(m);},check(){},save(){},
  count(n){return inv[n]||0;},
  async placeBlockNear(token,name){calls.push(['place',name]);inv[name]--;return furnaceAt;},
  async walk(){calls.push(['walk']);},
  async pickUp(p,name){calls.push(['pickUp',name]);present=false;inv[name]=(inv[name]||0)+1;}});
 return {w,calls,inv,state,clk,gone(){present=false;}};
}
const withClock=async(clk,fn)=>{const real=Date.now;Date.now=clk.now;try{return await fn();}finally{Date.now=real;}};
test('smelt leave:true loads the furnace and ends at once; the placed furnace stays',async()=>{
 const t=smeltFake();
 await withClock(t.clk,()=>Worker.prototype.smelt.call(t.w,{spec:{type:'smelt',item:'raw_iron',count:6,leave:true}},0));
 assert.equal(t.state.input,6,'all six in the furnace');
 assert.equal(t.inv.iron_ingot,0,'nothing waited for');
 assert.deepEqual(t.calls.filter(c=>c[0]==='pickUp'),[],'the furnace keeps working');
 const run=t.w.furnaceRun;
 assert.deepEqual([run.item,run.output,run.count,run.placed],['raw_iron','iron_ingot',6,true]);
 assert.equal(run.readyAt,t.clk.now()+6*KILN_ITEM_MS+1000);
 assert.ok(t.w.logs.some(l=>/loaded with 6 raw_iron; back for the iron_ingot in ~60 s/.test(l)));
});
test('the take job waits only for what is left, takes everything and picks the furnace up',async()=>{
 const t=smeltFake();
 await withClock(t.clk,async()=>{
  await Worker.prototype.smelt.call(t.w,{spec:{type:'smelt',item:'raw_iron',count:6,leave:true}},0);
  t.clk.advance(40000); // 4 of 6 done while the bot mined coal
  const real=globalThis.setTimeout;let waited=0;
  globalThis.setTimeout=(fn,ms)=>{waited+=ms;t.clk.advance(ms);return real(fn,0);};
  try{await Worker.prototype.smelt.call(t.w,{spec:{type:'smelt',item:'raw_iron',count:6,take:true}},0);}
  finally{globalThis.setTimeout=real;}
  assert.ok(waited<=21000,'waited the last ~20 s only: '+waited);
 });
 assert.equal(t.inv.iron_ingot,6);
 assert.equal(t.w.furnaceRun,null);
 assert.deepEqual(t.calls.filter(c=>c[0]==='pickUp'),[['pickUp','furnace']]);
 assert.equal(t.inv.furnace,1);
});
test('take with keepFurnace leaves it standing and fuelled; a vanished furnace clears the run',async()=>{
 const t=smeltFake();
 await withClock(t.clk,async()=>{
  await Worker.prototype.smelt.call(t.w,{spec:{type:'smelt',item:'raw_iron',count:6,leave:true}},0);
  t.clk.advance(70000);
  await Worker.prototype.smelt.call(t.w,{spec:{type:'smelt',item:'raw_iron',count:6,take:true,keepFurnace:true}},0);
 });
 assert.equal(t.inv.iron_ingot,6);
 assert.deepEqual(t.calls.filter(c=>c[0]==='pickUp'),[]);
 const u=smeltFake();
 await withClock(u.clk,()=>Worker.prototype.smelt.call(u.w,{spec:{type:'smelt',item:'raw_iron',count:6,leave:true}},0));
 u.gone();
 await assert.rejects(Worker.prototype.smelt.call(u.w,{spec:{type:'smelt',item:'raw_iron',count:6,take:true}},0),/is gone/);
 assert.equal(u.w.furnaceRun,null);
 assert.ok(jobSchema.safeParse({type:'smelt',item:'raw_iron',count:6,leave:true}).success);
 assert.ok(jobSchema.safeParse({type:'smelt',item:'raw_iron',count:6,take:true,keepFurnace:true}).success);
});
const RUN={item:'raw_iron',count:6,readyAt:1000,started:1};
test('furnaceWork: coal, iron, torches, logs or drops near the furnace while it works',()=>{
 const kit={stone_pickaxe:1,coal:2,stick:2,oak_log:8};
 assert.deepEqual(furnaceWork(RUN,kit,{now:0,tod:3000,coalNear:true}),{type:'gather',block:'coal_ore',count:4,radius:16});
 assert.deepEqual(furnaceWork(RUN,{...kit,coal:16},{now:0,tod:3000,coalNear:true,ironNear:true}),{type:'gather',block:'iron_ore',count:2,radius:16});
 assert.deepEqual(furnaceWork(RUN,kit,{now:0,tod:3000}),{type:'craft',item:'torch',count:8});
 assert.deepEqual(furnaceWork(RUN,{stone_pickaxe:1},{now:0,tod:3000,logNear:true}),{type:'gather',block:'log',count:2,radius:16,belowFoots:true});
 assert.deepEqual(furnaceWork(RUN,{stone_pickaxe:1,oak_log:8},{now:0,tod:3000,dropsNear:true}),{type:'collect',radius:16});
 assert.equal(furnaceWork(RUN,{stone_pickaxe:1,oak_log:8},{now:0,tod:3000}),null,'nothing useful: wait');
 assert.equal(furnaceWork(RUN,kit,{now:0,tod:3000,coalNear:true,sideJobs:FURNACE_SIDE_JOBS}),null,'side jobs are capped');
 for(const j of [furnaceWork(RUN,kit,{now:0,coalNear:true}),furnaceWork(RUN,kit,{now:0})])assert.ok(jobSchema.safeParse(j).success);
});
test('furnaceWork: back to the furnace when ready, at dusk, near a hostile or off the leash',()=>{
 const take={type:'smelt',item:'raw_iron',count:6,take:true};
 assert.deepEqual(furnaceWork(RUN,{},{now:1000,tod:3000,coalNear:true}),take);
 assert.deepEqual(furnaceWork(RUN,{stone_pickaxe:1},{now:0,tod:FURNACE_DUSK,coalNear:true}),take,'never left across a night');
 assert.deepEqual(furnaceWork(RUN,{stone_pickaxe:1},{now:0,tod:3000,coalNear:true,hostileDistance:12}),take);
 assert.deepEqual(furnaceWork(RUN,{stone_pickaxe:1},{now:0,tod:3000,coalNear:true,furnaceDistance:12}),take);
 assert.deepEqual(furnaceWork(RUN,{},{now:1000,moreCooking:true}),{...take,keepFurnace:true});
});
test('autopilot: the iron smelt is left to work, coal is mined beside it, then the take',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'furnace-'));
 const clk=clock(),submitted=[],jobs=[];
 const items={oak_planks:8,stick:10,crafting_table:1,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,cobblestone:32,stone_pickaxe:2,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1,cooked_beef:8,raw_iron:6,coal:2};
 const inv=()=>Object.entries(items).filter(([,n])=>n>0).map(([name,count])=>({name,count}));
 const worker={ready:true,userStopped:false,deathResume:false,jobs,log(){},furnaceRun:null,
  submit(spec){jobSchema.parse(spec);submitted.push(spec);const job={id:'j'+submitted.length,status:'running',spec};jobs.push(job);return job;},
  cancel(){},
  bot:{time:{timeOfDay:3000,day:3},inventory:{items:inv,slots:[]},entities:{},
   registry:{blocksByName:{coal_ore:{id:16},deepslate_coal_ore:{id:17}},foodsByName:{cooked_beef:{}},itemsByName:{}},
   findBlock(o){return Array.isArray(o.matching)&&o.matching.includes(16)?{position:new Vec3(5,64,0)}:null;},blockAt(){return null;},
   entity:{position:new Vec3(0.5,64,0.5)}}};
 const ap=new Autopilot(worker,root);
 try{
  await withClock(clk,()=>{
   ap.start();ap.tick();
   assert.deepEqual(submitted[0],{type:'smelt',item:'raw_iron',count:6,leave:true});
   // the worker loads it and records the run
   items.raw_iron=0;items.coal=1;worker.furnaceRun={x:1,y:64,z:0,item:'raw_iron',output:'iron_ingot',count:6,readyAt:clk.now()+61000,placed:true,started:clk.now()};
   jobs[0].status='complete';ap.tick();
   assert.deepEqual(submitted[1],{type:'gather',block:'coal_ore',count:4,radius:16},'coal beside the furnace, not a staircase dig');
   assert.equal(ap.currentStep,'furnace');
   items.coal=5;jobs[1].status='complete';
   clk.advance(62000);ap.tick();
   assert.deepEqual(submitted[2],{type:'smelt',item:'raw_iron',count:6,take:true});
   worker.furnaceRun=null;items.iron_ingot=6;jobs[2].status='complete';ap.tick();
   assert.equal(ap.currentStep,'iron');
   assert.deepEqual(submitted[3],{type:'craft',item:'iron_pickaxe',count:1},'the ladder goes on with the ingots');
  });
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
// Round 10, efficiency 2 (seen live: one kill, cook, break the furnace, walk to the next
// animal right beside it, repeat): hunt everything in reach first, then one furnace run.
import {plan,FOOD_BATCH} from '../src/autopilot.js';
const STONE={oak_planks:8,stick:10,crafting_table:1,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,cobblestone:32,stone_pickaxe:1,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1};
test('food batching: animals still in reach are hunted before the meat is cooked',()=>{
 let r=plan({...STONE,beef:2,_edible:2},{animalsNearby:'cow',animalsClose:3,huntPhase:false});
 assert.deepEqual([r.step,r.job.type,r.job.entity],['food','fight','cow'],'hunt on, no furnace yet');
 r=plan({...STONE,beef:2,_edible:2},{animalsNearby:'cow',animalsClose:3,huntPhase:true});
 assert.equal(r.job.type,'collect','the drops of the kills');
 r=plan({...STONE,beef:FOOD_BATCH,_edible:FOOD_BATCH},{animalsNearby:'cow',animalsClose:3});
 assert.deepEqual([r.job.type,r.job.item,r.job.count],['smelt','beef',FOOD_BATCH],'a full batch: cook it all at once');
 r=plan({...STONE,beef:2,_edible:2},{animalsNearby:'cow',animalsClose:0});
 assert.deepEqual([r.job.type,r.job.count],['smelt',2],'the rest are far: cook what is held');
});
test('a furnace the bot placed is still its own when a later run reuses it, fuel and all',async()=>{
 const t=smeltFake();t.inv.coal=0;t.inv.charcoal=0;
 t.w.fuelPlan=async()=>({id:3,count:1});t.inv.coal=1; // one coal, put in once
 await withClock(t.clk,async()=>{
  await Worker.prototype.smelt.call(t.w,{spec:{type:'smelt',item:'raw_iron',count:3,leave:true}},0);
  t.clk.advance(40000);
  await Worker.prototype.smelt.call(t.w,{spec:{type:'smelt',item:'raw_iron',count:3,take:true,keepFurnace:true}},0);
  assert.deepEqual(t.calls.filter(c=>c[0]==='pickUp'),[],'kept for the next batch');
  // the next batch finds that furnace standing (no new placement) ...
  t.w.bot.findBlock=()=>({position:new Vec3(2,64,0),name:'furnace'});
  t.state.fuel=1; // a second coal still in the fuel slot (the fake never burns the slot)
  t.w.fuelPlan=Worker.prototype.fuelPlan; // nothing held: the slot must cover the batch
  await Worker.prototype.smelt.call(t.w,{spec:{type:'smelt',item:'raw_iron',count:3,leave:true}},0);
  assert.equal(t.calls.filter(c=>c[0]==='place').length,1);
  assert.equal(t.inv.coal,0,'no fuel needed from the inventory');
  assert.equal(t.w.furnaceRun.placed,true,'still the bot\'s own furnace');
  t.clk.advance(40000);
  await Worker.prototype.smelt.call(t.w,{spec:{type:'smelt',item:'raw_iron',count:3,take:true}},0);
 });
 assert.deepEqual(t.calls.filter(c=>c[0]==='pickUp'),[['pickUp','furnace']],'... and the last take picks it up');
 assert.equal(t.inv.iron_ingot,6);
});
test('autopilot: exposed coal in arm\'s reach is a short pickup between jobs, once a minute',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pickup-'));
 const clk=clock(),submitted=[],jobs=[];
 const items={...STONE,stone_pickaxe:2,cooked_beef:8,stick:4};
 const coal=new Vec3(3,64,0);
 const worker={ready:true,userStopped:false,deathResume:false,jobs,log(){},
  submit(spec){jobSchema.parse(spec);submitted.push(spec);const job={id:'j'+submitted.length,status:'running',spec};jobs.push(job);return job;},cancel(){},
  bot:{time:{timeOfDay:3000,day:3},inventory:{items:()=>Object.entries(items).map(([name,count])=>({name,count})),slots:[]},entities:{},
   registry:{blocksByName:{coal_ore:{id:16},deepslate_coal_ore:{id:17}},foodsByName:{cooked_beef:{}},itemsByName:{}},
   findBlock(){return null;},findBlocks(o){return o.matching.includes(16)?[coal]:[];},
   blockAt(p){return p.x===coal.x&&p.y===coal.y&&p.z===coal.z?{name:'coal_ore',boundingBox:'block'}:{name:'air',boundingBox:'empty'};},
   entity:{position:new Vec3(0.5,64,0.5)}}};
 const ap=new Autopilot(worker,root);
 try{
  await withClock(clk,()=>{
   ap.start();ap.tick();
   assert.deepEqual(submitted[0],{type:'gather',block:'coal_ore',count:1,radius:6});
   assert.equal(ap.currentStep,'pickup');
   jobs[0].status='complete';ap.tick();
   assert.equal(ap.currentStep,'iron','the ladder goes on');
   assert.notEqual(submitted[1].radius,6);
   jobs[1].status='complete';clk.advance(61000);ap.tick();
   assert.deepEqual(submitted[2],{type:'gather',block:'coal_ore',count:1,radius:6},'a minute later: the next pickup');
  });
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
// ---- round 11: normal2 loaded three batches it never collected (`take queued twice`, then the
// next smelt placed a new furnace) ----------------------------------------------------------
import {FURNACE_TAKE_TRIES} from '../src/worker.js';
test('a new smelt walks back and collects the left batch first, in the same furnace',async()=>{
 const t=smeltFake();
 await withClock(t.clk,async()=>{
  await Worker.prototype.smelt.call(t.w,{spec:{type:'smelt',item:'raw_iron',count:3,leave:true}},0);
  t.clk.advance(40000);
  t.inv.raw_iron=3;
  t.w.bot.findBlock=()=>({position:new Vec3(2,64,0),name:'furnace'});
  const real=globalThis.setTimeout;globalThis.setTimeout=(fn,ms)=>{t.clk.advance(ms);return real(fn,0);};
  try{await Worker.prototype.smelt.call(t.w,{spec:{type:'smelt',item:'raw_iron',count:3}},0);}
  finally{globalThis.setTimeout=real;}
 });
 assert.ok(t.w.logs.some(l=>/Smelt: collecting the iron_ingot at 2,64,0 before a new batch/.test(l)),t.w.logs.join('\n'));
 assert.ok(t.w.logs.some(l=>/took 3 iron_ingot .*\(left standing\)/.test(l)));
 assert.equal(t.inv.iron_ingot,6,'both batches');
 assert.equal(t.calls.filter(c=>c[0]==='place').length,1,'no second furnace');
 assert.deepEqual(t.calls.filter(c=>c[0]==='pickUp'),[['pickUp','furnace']],'the kept furnace comes back with the last batch');
 assert.equal(t.w.furnaceRun,null);
});
test('the take walks back with the explore moves when the plain walk fails',async()=>{
 const t=smeltFake();let walks=0,navs=0;t.w.epoch=0;
 t.w.bot.pathfinder={movements:'normal',setMovements(m){this.movements=m;}};
 t.w.exploreMovements=()=>'explore';
 t.w.walk=async()=>{walks++;throw Error('No path to the goal!');};
 t.w.navigate=async goal=>{navs++;assert.equal(t.w.bot.pathfinder.movements,'explore');assert.equal(goal.rangeSq,9);};
 await withClock(t.clk,async()=>{
  t.w.furnaceRun={x:2,y:64,z:0,item:'raw_iron',output:'iron_ingot',count:3,readyAt:t.clk.now(),placed:true,started:1};
  t.state.output=3;t.state.input=0;
  await Worker.prototype.smelt.call(t.w,{spec:{type:'smelt',item:'raw_iron',count:3,take:true}},0);
 });
 assert.ok(navs>=1);
 assert.equal(t.w.bot.pathfinder.movements,'normal','movements restored');
 assert.equal(t.inv.iron_ingot,3);
});
test('a furnace the bot cannot get back to is given up after FURNACE_TAKE_TRIES walks; then a new one',async()=>{
 const t=smeltFake();
 t.w.bot.pathfinder={movements:'normal',setMovements(m){this.movements=m;}};
 t.w.exploreMovements=()=>'explore';
 await withClock(t.clk,()=>Worker.prototype.smelt.call(t.w,{spec:{type:'smelt',item:'raw_iron',count:3,leave:true}},0));
 t.w.walk=async()=>{throw Error('No path to the goal!');};
 t.w.navigate=async()=>{throw Error('Navigation timed out');};
 for(let i=1;i<FURNACE_TAKE_TRIES;i++){
  await assert.rejects(Worker.prototype.smelt.call(t.w,{spec:{type:'smelt',item:'raw_iron',count:3}},0),/The batch at 2,64,0 is not collected yet: Could not get back/);
  assert.ok(t.w.furnaceRun,'kept after '+i+' failed walks');
 }
 t.inv.furnace=1;t.inv.coal=1;let walked=0;
 const realNav=t.w.navigate;t.w.navigate=async(...a)=>{if(walked++<1)return realNav(...a);};
 const realWalk=t.w.walk;t.w.walk=async(...a)=>{if(t.w.furnaceRun)return realWalk(...a);};
 await withClock(t.clk,()=>Worker.prototype.smelt.call(t.w,{spec:{type:'smelt',item:'raw_iron',count:3,leave:true}},0));
 assert.ok(t.w.logs.some(l=>/gave up on the batch at 2,64,0 after 3 failed walks/.test(l)),t.w.logs.join('\n'));
 assert.equal(t.calls.filter(c=>c[0]==='place').length,2,'only now a new furnace');
});
test('autopilot: two failed takes keep the run for the next smelt instead of dropping it',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'furnace-take-'));
 const clk=clock(),submitted=[],jobs=[],logs=[];
 const items={oak_planks:8,stick:10,crafting_table:1,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,cobblestone:32,stone_pickaxe:2,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1,cooked_beef:8,coal:16};
 const worker={ready:true,userStopped:false,deathResume:false,jobs,log(m){logs.push(m);},furnaceRun:null,
  submit(spec){jobSchema.parse(spec);submitted.push(spec);const job={id:'j'+submitted.length,status:'running',spec};jobs.push(job);return job;},
  cancel(){},
  bot:{time:{timeOfDay:3000,day:3},inventory:{items:()=>Object.entries(items).filter(([,n])=>n>0).map(([name,count])=>({name,count})),slots:[]},entities:{},
   registry:{blocksByName:{},foodsByName:{cooked_beef:{}},itemsByName:{}},findBlock(){return null;},blockAt(){return null;},
   entity:{position:new Vec3(0.5,64,0.5)}}};
 const ap=new Autopilot(worker,root);
 try{
  await withClock(clk,()=>{
   ap.start();
   const run={x:1,y:64,z:0,item:'raw_iron',output:'iron_ingot',count:6,readyAt:clk.now()-1,placed:true,started:clk.now()};
   worker.furnaceRun=run;
   for(let i=0;i<2;i++){ap.coolUntil=0;ap.tick();assert.equal(submitted.at(-1).take,true);jobs.at(-1).status='failed';}
   ap.coolUntil=0;ap.tick();
   assert.equal(worker.furnaceRun,run,'the batch is still remembered');
   assert.ok(!submitted.at(-1).take||submitted.length>2&&submitted.filter(j=>j.take).length===2,'no third take');
   assert.ok(logs.some(l=>/next smelt collects it first/.test(l)),logs.join('\n'));
   assert.notEqual(ap.currentStep,'furnace','the ladder goes on');
  });
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
