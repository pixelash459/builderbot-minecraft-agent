// Round 10, habit 6: home base and inventory management - surplus into the home chest, a chest
// placed (or crafted) beside home, junk dropped when full far from home, never walked back to.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';
import {Autopilot,surplus,inventoryJob,INV_OFF_MS} from '../src/autopilot.js';
import {jobSchema} from '../src/schema.js';
test('surplus: what is kept on the bot and what is extra',()=>{
 const s=surplus({dirt:50,cobblestone:70,gravel:9,oak_sapling:5,wheat_seeds:10,iron_ingot:20,stone_pickaxe:1,poppy:2,_edible:3});
 assert.deepEqual(s.map(x=>[x.item,x.extra,x.keep]),[['dirt',18,32],['gravel',9,0],['cobblestone',6,64],['oak_sapling',3,2],['poppy',2,0]]);
});
test('inventoryJob: deposit at the home chest, place or craft one, drop junk far from home',()=>{
 const inv={dirt:60,gravel:20,iron_ingot:5,chest:0,oak_planks:4};
 const chestAt={x:3,y:64,z:0};
 let j=inventoryJob(inv,{slotsFull:0.8,chestAt,chestDistance:30});
 assert.deepEqual(j,{type:'deposit',position:chestAt,item:'dirt',keep:32});
 assert.ok(jobSchema.safeParse(j).success);
 assert.equal(inventoryJob(inv,{slotsFull:0.8,chestAt,chestDistance:60,homeDistance:60}).type,'drop','home too far: junk goes');
 assert.equal(inventoryJob(inv,{slotsFull:0.5,chestAt,chestDistance:30}),null,'not full and not passing');
 assert.equal(inventoryJob(inv,{slotsFull:0.5,chestAt,chestDistance:5}).type,'deposit','passing by');
 assert.equal(inventoryJob({dirt:40},{slotsFull:0.5,chestAt,chestDistance:5}),null,'passing by: not for 8 dirt');
 j=inventoryJob({...inv,chest:1},{slotsFull:0.8,homeDistance:20,chestSpot:{x:1,y:64,z:0}});
 assert.deepEqual(j,{type:'place',block:'chest',position:{x:1,y:64,z:0}});
 assert.deepEqual(inventoryJob({...inv,oak_planks:12},{slotsFull:0.8,homeDistance:20}),{type:'craft',item:'chest',count:1});
 assert.equal(inventoryJob({...inv,oak_planks:8},{slotsFull:0.8,homeDistance:20}).type,'drop','8 planks and no table: not enough for a chest');
 j=inventoryJob({iron_ingot:5,gravel:20,dirt:40},{slotsFull:0.9});
 assert.deepEqual(j,{type:'drop',item:'gravel',count:20},'no home: the largest junk');
 assert.ok(jobSchema.safeParse(j).success);
 assert.equal(inventoryJob({iron_ingot:64,oak_log:64},{slotsFull:0.9}),null,'nothing to spare');
});
test('deposit keep: all but that many of the item go into the chest',async()=>{
 const inv=[{name:'dirt',count:64,type:9},{name:'dirt',count:20,type:9}];
 const deposited=[];
 const w=Object.assign(Object.create(Worker.prototype),{
  bot:{blockAt(){return {name:'chest'};},inventory:{items:()=>inv.filter(i=>i.count>0)},
   async openContainer(){return {async deposit(type,meta,n){deposited.push(n);let left=n;for(const i of inv){const k=Math.min(i.count,left);i.count-=k;left-=k;}},async close(){}};},async _syncWindow(){}},
  check(){},async walk(){},count(n){return inv.filter(i=>i.name===n).reduce((a,i)=>a+i.count,0);}});
 await w.deposit({spec:{type:'deposit',position:{x:0,y:64,z:0},item:'dirt',keep:32}},0);
 assert.equal(w.count('dirt'),32);
 assert.deepEqual(deposited,[52]);
});
test('drop: junk is tossed and the sweeps leave it lying',async()=>{
 const inv=[{name:'gravel',count:20,type:13}];const tossed=[];
 const w=Object.assign(Object.create(Worker.prototype),{
  bot:{inventory:{items:()=>inv.filter(i=>i.count>0)},async toss(type,meta,n){tossed.push(n);inv[0].count-=n;}},
  logs:[],log(m){this.logs.push(m);},check(){},count(n){return inv.filter(i=>i.name===n).reduce((a,i)=>a+i.count,0);}});
 await w.drop({spec:{type:'drop',item:'gravel',count:20}},0);
 assert.deepEqual(tossed,[20]);
 assert.equal(w.isDroppedJunk({getDroppedItem:()=>({name:'gravel'})}),true);
 assert.equal(w.isDroppedJunk({getDroppedItem:()=>({name:'iron_ingot'})}),false);
 await assert.rejects(w.drop({spec:{type:'drop',item:'gravel'}},0),/No gravel to drop/);
});
function autopilot({items={},home=null,chestAt=null,blocks={}}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'inv-'));
 const submitted=[],jobs=[];
 const inv=()=>Object.entries(items).filter(([,n])=>n>0).map(([name,count])=>({name,count}));
 const worker={ready:true,userStopped:false,deathResume:false,jobs,log(){},slotsFull:()=>inv().length/36,
  submit(spec){jobSchema.parse(spec);submitted.push(spec);const job={id:'j'+submitted.length,status:'running',spec};jobs.push(job);return job;},cancel(){},
  bot:{time:{timeOfDay:3000,day:3},inventory:{items:inv,slots:[]},entities:{},
   registry:{blocksByName:{},foodsByName:{cooked_beef:{}},itemsByName:{}},findBlock(){return null;},
   blockAt(p){const k=p.x+','+p.y+','+p.z;return blocks[k]?{name:blocks[k],boundingBox:blocks[k]==='air'?'empty':'block'}:null;},
   entity:{position:new Vec3(0.5,64,0.5)}}};
 const ap=new Autopilot(worker,root);ap.home=home;ap.homeChestAt=chestAt;ap.homeChest=!!chestAt;
 return {ap,worker,jobs,submitted,items,done(){fs.rmSync(root,{recursive:true,force:true});}};
}
const KIT={oak_planks:8,stick:10,crafting_table:1,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,stone_pickaxe:2,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1,cooked_beef:8};
const fill=n=>{const o={};for(let i=0;i<n;i++)o['filler_'+i]=1;return o;};
test('autopilot: a full inventory deposits at home first; a failed deposit is set aside',()=>{
 const t=autopilot({items:{...KIT,...fill(18),dirt:60,cobblestone:90},home:{x:2,y:64,z:2},chestAt:{x:3,y:64,z:2},blocks:{'3,64,2':'chest'}});
 try{
  t.ap.start();t.ap.tick();
  assert.deepEqual(t.submitted[0],{type:'deposit',position:{x:3,y:64,z:2},item:'dirt',keep:32},'the largest surplus first (28 dirt over 26 cobble)');
  assert.equal(t.ap.currentStep,'inventory');
  t.jobs[0].status='failed';t.ap.tick();
  assert.ok(t.ap.invOffUntil>Date.now()+INV_OFF_MS-1000);
  t.ap.coolUntil=0;t.ap.tick();
  assert.notEqual(t.submitted.at(-1).type,'deposit','set aside: the ladder goes on');
 }finally{t.done();}
});
test('autopilot: a remembered chest that is gone is forgotten, and a new one is placed by home',()=>{
 const t=autopilot({items:{...KIT,...fill(18),dirt:60,chest:1},home:{x:2,y:64,z:2},chestAt:{x:3,y:64,z:2},blocks:{'3,64,2':'air','3,63,2':'grass_block'}});
 try{
  t.ap.start();t.ap.tick();
  assert.equal(t.ap.homeChestAt,null);
  assert.deepEqual(t.submitted[0],{type:'place',block:'chest',position:{x:3,y:64,z:2}});
 }finally{t.done();}
});
// ---- round 11: `Inventory nearly full; deposit items first` twice, never a chest or a deposit ----
test('surplus when full: what the ladder does not use is surplus too; its materials never are',()=>{
 const bag={raw_copper:20,redstone:9,bone:3,leather:2,coal:12,raw_iron:6,iron_ingot:4,oak_log:20,stick:9,torch:16,cooked_beef:5,beef:3,stone_pickaxe:1,iron_helmet:1,string:8,white_wool:2,diamond:1};
 assert.deepEqual(surplus(bag),[],'not full: only the junk list');
 assert.deepEqual(surplus(bag,true).map(x=>x.item),['raw_copper','redstone','bone','leather']);
 assert.ok(surplus(bag,true).every(x=>x.keep===0));
});
test('inventoryJob: full with no home chest - a chest where the bot stands, even with no home',()=>{
 const bag={raw_copper:30,iron_ingot:5,oak_planks:16,crafting_table:1};
 const here={x:7,y:64,z:2};
 assert.deepEqual(inventoryJob(bag,{slotsFull:0.95,chestSpotHere:here}),{type:'craft',item:'chest',count:1},'no home: craft one');
 const j=inventoryJob({...bag,chest:1},{slotsFull:0.95,chestSpotHere:here});
 assert.deepEqual(j,{type:'place',block:'chest',position:here});
 assert.ok(jobSchema.safeParse(j).success);
 assert.deepEqual(inventoryJob({...bag,chest:1},{slotsFull:0.95,homeDistance:200,chestSpotHere:here}),{type:'place',block:'chest',position:here},'home out of range: here');
 assert.deepEqual(inventoryJob({...bag,chest:1},{slotsFull:0.95,homeDistance:10,chestSpot:{x:1,y:64,z:0},chestSpotHere:here}).position,{x:1,y:64,z:0},'home in range: beside home');
 // a far home chest: junk is dropped first; with nothing droppable, a new chest here
 const far={slotsFull:0.95,chestAt:{x:300,y:64,z:0},chestDistance:300,homeDistance:300,chestSpotHere:here};
 assert.equal(inventoryJob({...bag,chest:1,gravel:30},far).type,'drop');
 assert.deepEqual(inventoryJob({...bag,chest:1},far),{type:'place',block:'chest',position:here});
 // and once a chest is in reach, the copper goes in
 assert.deepEqual(inventoryJob(bag,{slotsFull:0.95,chestAt:here,chestDistance:2}),{type:'deposit',position:here,item:'raw_copper',keep:0});
});
test('autopilot: full with no home - a chest is placed, becomes home, and the surplus goes in',()=>{
 const t=autopilot({items:{...KIT,...fill(26),raw_copper:40,chest:1},blocks:{'1,64,0':'air','1,63,0':'grass_block'}});
 const logs=[];t.worker.log=m=>logs.push(m);
 try{
  t.ap.start();t.ap.tick();
  assert.deepEqual(t.submitted[0],{type:'place',block:'chest',position:{x:1,y:64,z:0}});
  assert.equal(t.ap.currentStep,'inventory');
  t.jobs[0].status='complete';t.items.chest=0;
  t.worker.bot.blockAt=p=>p.x===1&&p.y===64&&p.z===0?{name:'chest',boundingBox:'block'}:null;
  t.ap.tick();
  assert.deepEqual(t.ap.homeChestAt,{x:1,y:64,z:0});
  assert.deepEqual(t.ap.home,{x:1,y:64,z:0},'the chest is home');
  assert.ok(logs.some(l=>/home chest placed at 1,64,0/.test(l)));
  assert.deepEqual(t.submitted[1],{type:'deposit',position:{x:1,y:64,z:0},item:'raw_copper',keep:0});
 }finally{t.done();}
});
