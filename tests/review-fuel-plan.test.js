import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';
console.error=()=>{};

// A furnace has one fuel slot. fuelPlan added every kind of fuel held towards the batch and
// returned only the last kind it reached: 2 oak planks and 3 oak logs "covered" 7 raw iron and
// the furnace was given the 3 logs (4 items of burn) under 7 raw iron - 3 never smelted and the
// job failed on its timeout.
const IDS={raw_iron:{id:1},iron_ingot:{id:2},coal:{id:3},furnace:{id:4},oak_planks:{id:5},oak_log:{id:6},birch_planks:{id:7}};
function fake(inv){
 const calls=[];
 const w={bot:{registry:{itemsByName:IDS,blocksByName:{furnace:{id:40}}},
   inventory:{items(){return Object.entries(inv).filter(([,n])=>n>0).map(([name,count])=>({name,count}));}},
   findBlock(){return {position:new Vec3(2,64,0),name:'furnace'};},
   async openFurnace(){let out=0;return {
    async putInput(id,meta,n){calls.push(['input',n]);inv.raw_iron-=n;out=n;},
    async putFuel(id,meta,n){calls.push(['fuel',id,n]);},
    outputItem(){return {count:out};},
    async takeOutput(){inv.iron_ingot=(inv.iron_ingot||0)+out;out=0;}};},
   async closeWindow(){}},
  log(m){calls.push(['log',m]);},check(){},count(n){return inv[n]||0;},fuelPlan:Worker.prototype.fuelPlan,async walk(){},async pickUp(){}};
 return {w,calls,inv};
}
test('fuelPlan: one kind that covers the batch alone is the plan, in coal-planks-logs order',async()=>{
 let t=fake({coal:1,oak_planks:10});
 assert.deepEqual(await t.w.fuelPlan(6),{id:3,count:1,covers:6,name:'coal'});
 t=fake({oak_planks:10,oak_log:9});
 assert.deepEqual(await t.w.fuelPlan(7),{id:5,count:5,covers:7,name:'oak_planks'});
 // the first kind is short, a later one covers alone: the later one, and enough of it
 t=fake({oak_planks:2,oak_log:6});
 assert.deepEqual(await t.w.fuelPlan(7),{id:6,count:5,covers:7,name:'oak_log'});
});
test('fuelPlan: kinds that only cover the batch together give the biggest one and what it burns',async()=>{
 const t=fake({oak_planks:2,oak_log:3});
 const plan=await t.w.fuelPlan(7);
 assert.equal(plan.name,'oak_log');assert.equal(plan.count,3);
 assert.equal(plan.covers,4,'3 logs burn 4.5 items: 4 whole ones');
 const u=fake({coal:1,birch_planks:3});
 assert.deepEqual(await u.w.fuelPlan(12),{id:3,count:1,covers:8,name:'coal'});
 await assert.rejects(fake({oak_planks:2,oak_log:1}).w.fuelPlan(7),/Not enough fuel/);
 await assert.rejects(fake({}).w.fuelPlan(1),/Not enough fuel/);
});
test('smelt: a batch the one fuel slot cannot cover is cut to what the fuel burns',async()=>{
 const t=fake({raw_iron:7,oak_planks:2,oak_log:3});
 const job={spec:{type:'smelt',item:'raw_iron',count:7}};
 await Worker.prototype.smelt.call(t.w,job,0);
 assert.deepEqual(t.calls.find(c=>c[0]==='input'),['input',4]);
 assert.deepEqual(t.calls.find(c=>c[0]==='fuel'),['fuel',6,3]);
 assert.equal(t.inv.iron_ingot,4);assert.equal(t.inv.raw_iron,3,'the rest stays in the bag for the next batch');
 assert.ok(t.calls.some(c=>c[0]==='log'&&/burn 4 of the 7 raw_iron/.test(c[1])),JSON.stringify(t.calls));
});
test('smelt: a covered batch goes in whole',async()=>{
 const t=fake({raw_iron:7,coal:1});
 await Worker.prototype.smelt.call(t.w,{spec:{type:'smelt',item:'raw_iron',count:7}},0);
 assert.deepEqual(t.calls.find(c=>c[0]==='input'),['input',7]);
 assert.equal(t.inv.iron_ingot,7);
});
