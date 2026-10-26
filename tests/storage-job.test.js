import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';

// A fake world: chests are cells holding {name: count}; the bag is a list of stacks.
function setup(bag,earned){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'storejob-'));fs.mkdirSync(path.join(root,'data'));
 const chests=new Map(),key=p=>p.x+','+p.y+','+p.z;
 const inv=bag.map(([name,count],i)=>({name,count,type:i+1,metadata:0,slot:9+i}));
 const bot={entity:{position:new Vec3(0.5,64,0.5)},inventory:{items:()=>inv.filter(s=>s.count>0),emptySlotCount:()=>bot._free??1},
  blockAt:p=>chests.has(key(p))?{name:'chest',position:p}:(p.y<64?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'}),
  openContainer:async block=>{const c=chests.get(key(block.position));return {
   inventoryStart:27,
   deposit:async(type,meta,n)=>{const s=inv.find(i=>i.type===type);if(!s||s.count<n)throw Error('missing');s.count-=n;c[s.name]=(c[s.name]||0)+n;},
   containerItems:()=>Object.entries(c).map(([name,count])=>({name,count})),
   close:async()=>{}};},
  _syncWindow:async()=>{}};
 const w=Object.create(Worker.prototype);
 Object.assign(w,{bot,root,logs:[],log(m){this.logs.push(m);},check(){},walk:async()=>{},autopilot:{home:{x:0,y:64,z:0}},
  place:async job=>{chests.set(key(job.spec.position),{});},count:n=>inv.filter(s=>s.name===n).reduce((a,s)=>a+s.count,0)});
 for(const [n,k] of Object.entries(earned))w.earn(n,k);
 return {w,chests,inv};
}
test('store: earned items go into one chest per category, the rest stays',async()=>{
 const {w,chests,inv}=setup([['oak_log',20],['cobblestone',100],['raw_iron',6],['cooked_beef',6],['iron_pickaxe',1],['chest',3]],{oak_log:20,cobblestone:100,raw_iron:6});
 await w.store({spec:{type:'store'}},1);
 const cats=w.storage.chests.map(c=>c.category).sort();
 assert.deepEqual(cats,['metal','stone','wood']);
 const left=n=>inv.find(s=>s.name===n).count;
 assert.equal(left('oak_log'),0);assert.equal(left('cobblestone'),32,'the working set stays');
 assert.equal(left('cooked_beef'),6,'server-given food stays');assert.equal(left('iron_pickaxe'),1);
 assert.equal(w.storage.find('raw_iron')[0].count,6);
 assert.ok(w.logs.some(l=>/^Store: put away/.test(l)),JSON.stringify(w.logs));
 assert.equal(w.ledger.of('oak_log'),0,'stored items leave the ledger');
 // a second store reuses the same chests
 inv.find(s=>s.name==='oak_log').count=10;w.earn('oak_log',10);
 await w.store({spec:{type:'store'}},1);
 assert.equal(w.storage.chests.length,3);assert.equal(w.storage.find('oak_log')[0].count,30);
});
test('store: nothing earned, nothing moved',async()=>{
 const {w}=setup([['cooked_beef',6],['cobblestone',10]],{});
 await w.store({spec:{type:'store'}},1);
 assert.equal(w.storage.chests.length,0);assert.ok(w.logs.some(l=>/nothing earned/.test(l)));
});
test('store: chests recorded for a far-away base are forgotten first',async()=>{
 const {w}=setup([['oak_log',10],['chest',1]],{oak_log:10});
 w.storage.record({x:900,y:70,z:900},'wood',{oak_log:64},false);
 await w.store({spec:{type:'store'}},1);
 assert.ok(!w.storage.chests.some(c=>c.x===900),'the far chest is gone from the index');
 assert.equal(w.storage.find('oak_log')[0].count,10);
});
test('store: no chest and nothing to make one - one reason, and the store stands down',async()=>{
 const {w}=setup([['cobblestone',100],['oak_planks',3]],{cobblestone:100});
 await w.store({spec:{type:'store'}},1);
 const why=w.logs.filter(l=>/^Store: no chest for/.test(l));
 assert.equal(why.length,1,JSON.stringify(w.logs));assert.match(why[0],/no chest held, 3 planks, no logs/);
 assert.ok(w.storeIdleUntil>Date.now(),'the autopilot leaves the store for a while');
});
test('store: planks are crafted from a held log for the first chest',async()=>{
 const {w,inv}=setup([['cobblestone',100],['oak_log',3]],{cobblestone:100});
 const crafted=[];
 w.craft=async job=>{crafted.push(job.spec.item+' x'+job.spec.count);
  if(job.spec.item==='oak_planks'){inv.find(s=>s.name==='oak_log').count-=2;inv.push({name:'oak_planks',count:8,type:90,metadata:0,slot:30});}
  if(job.spec.item==='chest'){inv.find(s=>s.name==='oak_planks').count-=8;inv.push({name:'chest',count:1,type:91,metadata:0,slot:31});}};
 await w.store({spec:{type:'store'}},1);
 assert.deepEqual(crafted,['oak_planks x8','chest x1']);
 assert.equal(w.storage.chests.length,1);assert.equal(w.storage.find('cobblestone')[0].count,68);
 assert.ok(!w.storeIdleUntil);
});
test('store: the ledger follows the bag (a clear or a death empties it)',()=>{
 const {w,inv}=setup([['cobblestone',100]],{cobblestone:100});
 assert.equal(w.ledger.of('cobblestone'),100);
 inv.find(s=>s.name==='cobblestone').count=0; // /clear
 inv.push({name:'dirt',count:4,type:50,metadata:0,slot:20});w.earn('dirt',4);
 assert.equal(w.ledger.of('cobblestone'),0);assert.equal(w.ledger.of('dirt'),4);
});
test('store: with room in the bag, logs are chopped for the first chest',async()=>{
 const {w,inv}=setup([['cobblestone',100],['oak_planks',2]],{cobblestone:100});
 w.bot._free=6;const did=[];
 w.gather=async job=>{did.push(job.spec.block+' x'+job.spec.count);inv.push({name:'oak_log',count:2,type:92,metadata:0,slot:32});};
 w.craft=async job=>{did.push(job.spec.item+' x'+job.spec.count);
  if(job.spec.item==='oak_planks'){inv.find(s=>s.name==='oak_log').count-=2;inv.find(s=>s.name==='oak_planks').count+=8;}
  if(job.spec.item==='chest'){inv.find(s=>s.name==='oak_planks').count-=8;inv.push({name:'chest',count:1,type:91,metadata:0,slot:31});}};
 await w.store({spec:{type:'store'}},1);
 assert.deepEqual(did,['log x2','oak_planks x8','chest x1']);
 assert.equal(w.storage.find('cobblestone')[0].count,68);
});
test('store: a full bag tosses spare wooden tools to make room for the log chop',async()=>{
 const {w,inv}=setup([['cobblestone',100],['wooden_pickaxe',1],['stone_pickaxe',1],['wooden_sword',1],['iron_sword',1]],{cobblestone:100});
 w.bot._free=1;const tossed=[];
 w.bot.tossStack=async it=>{tossed.push(it.name);it.count=0;w.bot._free++;};
 w.gather=async()=>{inv.push({name:'oak_log',count:2,type:92,metadata:0,slot:32});};
 w.craft=async job=>{if(job.spec.item==='oak_planks'){inv.find(s=>s.name==='oak_log').count-=2;inv.push({name:'oak_planks',count:8,type:93,metadata:0,slot:33});}
  if(job.spec.item==='chest'){inv.find(s=>s.name==='oak_planks').count-=8;inv.push({name:'chest',count:1,type:91,metadata:0,slot:31});}};
 await w.store({spec:{type:'store'}},1);
 assert.deepEqual(tossed.sort(),['wooden_pickaxe','wooden_sword']);
 assert.equal(inv.find(s=>s.name==='stone_pickaxe').count,1,'the better tool stays');
 assert.equal(w.storage.chests.length,1);
});
