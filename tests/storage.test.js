import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {categoryOf,Ledger,storePlan,StorageIndex,storageSpots,NEVER_STORE} from '../src/storage.js';
test('storage: items sort into categories',()=>{
 assert.equal(categoryOf('oak_log'),'wood');assert.equal(categoryOf('spruce_planks'),'wood');assert.equal(categoryOf('stick'),'wood');
 assert.equal(categoryOf('cobblestone'),'stone');assert.equal(categoryOf('dirt'),'stone');assert.equal(categoryOf('flint'),'stone');
 assert.equal(categoryOf('raw_iron'),'metal');assert.equal(categoryOf('iron_ingot'),'metal');assert.equal(categoryOf('coal'),'metal');assert.equal(categoryOf('diamond'),'metal');
 assert.equal(categoryOf('cooked_beef'),'food');assert.equal(categoryOf('wheat_seeds'),'food');
 assert.equal(categoryOf('string'),'drops');assert.equal(categoryOf('white_wool'),'drops');
 assert.equal(categoryOf('pink_petals'),'misc');
 assert.ok(NEVER_STORE.test('iron_pickaxe')&&NEVER_STORE.test('white_bed')&&NEVER_STORE.test('crafting_table'));
});
test('storage: only earned items above the working set are stored; server-given ones never',()=>{
 const l=new Ledger();
 l.add('oak_log',20);l.add('cobblestone',100);l.add('raw_iron',6);l.add('raw_copper',6);
 // the harness gave 6 steak (never earned); the bot also holds tools
 const held={oak_log:20,cobblestone:100,raw_iron:6,raw_copper:6,cooked_beef:6,iron_pickaxe:1,coal:5};
 const m=Object.fromEntries(storePlan(held,l).map(p=>[p.item,p.count]));
 assert.equal(m.oak_log,20);assert.equal(m.cobblestone,68,'keeps 32 cobble');assert.equal(m.raw_copper,6);assert.equal(m.raw_iron,undefined,'iron is kept for the kit (round 56)');
 assert.equal(m.cooked_beef,undefined,'given food is not stored (and food is kept anyway)');
 assert.equal(m.iron_pickaxe,undefined);assert.equal(m.coal,undefined,'coal kept and not earned');
 l.clamp({oak_log:5});assert.equal(l.of('oak_log'),5);assert.equal(l.of('cobblestone'),0,'a /clear empties the ledger');
});
test('storage: the index finds a chest per category, records contents, and finds items',()=>{
 const f=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'store-')),'storage.json');
 const ix=new StorageIndex(f);
 assert.equal(ix.chestFor('wood'),null);
 ix.record({x:1,y:64,z:0},'wood',{oak_log:20},false);
 ix.record({x:3,y:64,z:0},'stone',{cobblestone:1728},true);
 assert.deepEqual(ix.chestFor('wood'),ix.get({x:1,y:64,z:0}));
 assert.equal(ix.chestFor('stone'),null,'the full stone chest is skipped');
 const again=new StorageIndex(f);
 assert.deepEqual(again.find('oak_log'),[{x:1,y:64,z:0,count:20}],'persisted');
 assert.equal(again.totals().cobblestone,1728);
 assert.deepEqual(storageSpots({x:0,y:64,z:0},3),[{x:0,y:64,z:2},{x:2,y:64,z:2},{x:4,y:64,z:2}]);
});
import {inventoryJob} from '../src/autopilot.js';
test('storage: a full bag near the base stores instead of dropping',()=>{
 const counts={cobblestone:200,dirt:64,oak_log:40};
 assert.deepEqual(inventoryJob(counts,{slotsFull:0.9,canStore:true}),{type:'store'});
 assert.notDeepEqual(inventoryJob(counts,{slotsFull:0.9,canStore:false}),{type:'store'},'no base nearby: the old path');
 assert.equal(inventoryJob(counts,{slotsFull:0.3,canStore:true}),null,'not full: nothing');
});
import {sheepSearchJob} from '../src/autopilot.js';
test('sheep search: from deep underground the bot climbs out first',()=>{
 const job={type:'explore',direction:'north',distance:96};
 assert.deepEqual(sheepSearchJob(job,{underSky:false,standY:22,lastSurfaceY:70}),{type:'ascend',y:70});
 assert.deepEqual(sheepSearchJob(job,{underSky:true,standY:22,lastSurfaceY:70}),job,'open sky (a ravine floor): search');
 assert.deepEqual(sheepSearchJob(job,{underSky:false,standY:64,lastSurfaceY:70}),job,'just under a canopy: search');
 assert.deepEqual(sheepSearchJob(job,{underSky:false,standY:30}),{type:'ascend',y:64},'no anchor: y=64');
});
test('storage: a wooden tool with a better tier held is stored whole; the only pickaxe stays',()=>{
 const held={wooden_pickaxe:1,stone_pickaxe:1,wooden_sword:1,iron_sword:1,wooden_axe:1};
 const m=Object.fromEntries(storePlan(held,new Ledger()).map(p=>[p.item,p.category]));
 assert.equal(m.wooden_pickaxe,'tools');assert.equal(m.wooden_sword,'tools');
 assert.equal(m.wooden_axe,undefined,'no better axe: the wooden one is the axe');
 assert.equal(m.stone_pickaxe,undefined);assert.equal(m.iron_sword,undefined);
});
