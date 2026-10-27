import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';

// A fake world: chests are cells holding {name: count}; the bag is a list of stacks.
function setup(bag,earned){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'storejob-'));fs.mkdirSync(path.join(root,'data'));
 const chests=new Map(),plants=new Map(),key=p=>p.x+','+p.y+','+p.z;
 const inv=bag.map(([name,count],i)=>({name,count,type:i+1,metadata:0,slot:9+i}));
 const bot={entity:{position:new Vec3(0.5,64,0.5)},inventory:{items:()=>inv.filter(s=>s.count>0),emptySlotCount:()=>bot._free??1},
  blockAt:p=>chests.has(key(p))?{name:'chest',position:p}:plants.has(key(p))?{name:plants.get(key(p)),boundingBox:'empty',position:p}:(p.y<64?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'}),
  openContainer:async block=>{const c=chests.get(key(block.position));return {
   inventoryStart:27,
   deposit:async(type,meta,n)=>{const s=inv.find(i=>i.type===type);if(!s||s.count<n)throw Error('missing');s.count-=n;c[s.name]=(c[s.name]||0)+n;},
   containerItems:()=>Object.entries(c).map(([name,count])=>({name,count})),
   close:async()=>{}};},
  findBlock:()=>bot._noTable?null:{name:'crafting_table'},dig:async bl=>{bot._dug=(bot._dug||[]).concat(bl.name);plants.delete(key(bl.position));},
  _syncWindow:async()=>{}};
 const w=Object.create(Worker.prototype);
 Object.assign(w,{bot,root,logs:[],log(m){this.logs.push(m);},check(){},walk:async()=>{},autopilot:{home:{x:0,y:64,z:0}},
  place:async job=>{chests.set(key(job.spec.position),{});},count:n=>inv.filter(s=>s.name===n).reduce((a,s)=>a+s.count,0)});
 for(const [n,k] of Object.entries(earned))w.earn(n,k);
 return {w,chests,inv,plants};
}
test('store: earned items go into one chest per category, the rest stays',async()=>{
 const {w,chests,inv}=setup([['oak_log',20],['cobblestone',100],['raw_copper',6],['raw_iron',6],['cooked_beef',6],['iron_pickaxe',1],['chest',3]],{oak_log:20,cobblestone:100,raw_copper:6,raw_iron:6});
 await w.store({spec:{type:'store'}},1);
 const cats=w.storage.chests.map(c=>c.category).sort();
 assert.deepEqual(cats,['metal','stone','wood']);
 const left=n=>inv.find(s=>s.name===n).count;
 assert.equal(left('oak_log'),0);assert.equal(left('cobblestone'),32,'the working set stays');
 assert.equal(left('cooked_beef'),6,'server-given food stays');assert.equal(left('iron_pickaxe'),1);
 assert.equal(w.storage.find('raw_copper')[0].count,6);
 assert.equal(left('raw_iron'),6,'iron stays for the iron kit (round 56)');
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
test('store: with no table near, the first chest needs 12 planks (the table first)',async()=>{
 const {w,inv}=setup([['cobblestone',100],['oak_planks',8],['oak_log',1]],{cobblestone:100});
 w.bot._noTable=true;const did=[];
 w.craft=async job=>{did.push(job.spec.item+' x'+job.spec.count);
  if(job.spec.item==='oak_planks'){inv.find(s=>s.name==='oak_log').count-=1;inv.find(s=>s.name==='oak_planks').count+=4;}
  if(job.spec.item==='chest'){inv.find(s=>s.name==='oak_planks').count-=12;inv.push({name:'chest',count:1,type:91,metadata:0,slot:31});}};
 await w.store({spec:{type:'store'}},1);
 assert.deepEqual(did,['oak_planks x4','chest x1']);
});
test('store: petals on the storage row are broken by hand, then the chest goes there',async()=>{
 const {w,plants}=setup([['cobblestone',100],['chest',1]],{cobblestone:100});
 plants.set('0,64,2','pink_petals');
 await w.store({spec:{type:'store'}},1);
 assert.deepEqual(w.bot._dug,['pink_petals']);
 assert.deepEqual(w.storage.chests.map(c=>[c.x,c.y,c.z]),[[0,64,2]]);
});
test('round 57: a full bag with no plank stack tosses loose stone so the planks have a slot',async()=>{
 const {w,inv}=setup([['cobblestone',100],['granite',16],['diorite',5],['oak_log',3]],{cobblestone:100});
 w.bot._free=0;const tossed=[];
 w.bot.tossStack=async it=>{tossed.push(it.name);it.count=0;w.bot._free++;};
 w.craft=async job=>{if(job.spec.item==='oak_planks'){if(!w.bot._free)throw Error('No room for crafting result');inv.find(s=>s.name==='oak_log').count-=2;inv.push({name:'oak_planks',count:8,type:93,metadata:0,slot:33});}
  if(job.spec.item==='chest'){inv.find(s=>s.name==='oak_planks').count-=8;inv.push({name:'chest',count:1,type:91,metadata:0,slot:31});}};
 await w.store({spec:{type:'store'}},1);
 assert.deepEqual(tossed,['granite'],'the biggest loose-stone stack, once');
 assert.equal(w.storage.chests.length,1,JSON.stringify(w.logs));
});
test('round 57: a category with no chest and no way to make one goes into a chest with room',async()=>{
 const {w,chests}=setup([['cobblestone',100],['pink_petals',22],['oak_planks',1]],{cobblestone:100,pink_petals:22});
 chests.set('0,64,2',{});w.storage.record({x:0,y:64,z:2},'stone',{},false);
 await w.store({spec:{type:'store'}},1);
 assert.equal(w.storage.find('pink_petals')[0]?.count,22,JSON.stringify(w.logs));
 assert.equal(w.storage.chests.length,1);assert.equal(w.storage.chests[0].category,'stone','the chest keeps its category');
 assert.equal(w.logs.filter(l=>/^Store: no chest for/.test(l)).length,1);
 assert.ok(w.logs.some(l=>/no misc chest; putting misc in the stone chest/.test(l)),JSON.stringify(w.logs));
});
test('round 57: crafting a stone tool drops the wooden one of the same kind',async()=>{
 const inv=[{name:'wooden_pickaxe',count:1},{name:'wooden_sword',count:1},{name:'stone_pickaxe',count:1},{name:'wooden_axe',count:1},{name:'stone_axe',count:1}];
 const w=Object.create(Worker.prototype),tossed=[];
 Object.assign(w,{logs:[],log(m){this.logs.push(m);},check(){},count:n=>inv.filter(s=>s.name===n).reduce((a,s)=>a+s.count,0),
  bot:{inventory:{items:()=>inv.filter(s=>s.count>0)},tossStack:async it=>{tossed.push(it.name);it.count=0;}}});
 await w.tossSpareTools('stone_pickaxe',1);
 assert.deepEqual(tossed,['wooden_pickaxe','wooden_axe'],'round 58: every spare kind; the wooden sword stays until a better sword');
 assert.ok(w.droppedJunk.has('wooden_pickaxe'),'not picked back up');
 await w.tossSpareTools('oak_planks',1);assert.equal(tossed.length,2);
});
test('round 58: a place onto pink petals breaks them by hand first',async()=>{
 const cells={'5,64,5':{name:'pink_petals',boundingBox:'empty'}},logs=[],dug=[];
 const w=Object.create(Worker.prototype);
 const bot={registry:{blocksByName:{chest:{}},itemsByName:{chest:{}}},
  blockAt:p=>({position:p,...(cells[p.x+','+p.y+','+p.z]||(p.y<64?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'}))}),
  dig:async bl=>{dug.push(bl.name);delete cells[bl.position.x+','+bl.position.y+','+bl.position.z];},
  pathfinder:{setMovements(){}}};
 Object.assign(w,{bot,logs,log(m){logs.push(m);},check(){},walk:async()=>{},movements:{exclusionAreasStep:[]}});
 await w.place({spec:{type:'place',block:'chest',position:{x:5,y:64,z:5}}},1).catch(e=>logs.push('ERR '+e.message));
 assert.deepEqual(dug,['pink_petals']);
 assert.ok(logs.some(l=>/Place: broke the pink_petals/.test(l)),JSON.stringify(logs));
 assert.ok(!logs.some(l=>/occupied by pink_petals/.test(l)),JSON.stringify(logs));
});
