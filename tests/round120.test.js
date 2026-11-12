import test from 'node:test';
import assert from 'node:assert/strict';
import {plan,bedJob,bedPrepJob,ironPickFirst,IRON_PICK_INGOTS} from '../src/autopilot.js';
console.error=()=>{};

// Round 120: the round-119 hard2 miss - 3 iron ingots held from t=1870, then food, stick, shovel,
// torch and cow jobs went first, and the dusk bed prep made shears from 2 of the ingots; health
// 15.5 on hard (no regen under a bar of 18) kept the iron-first rule off and the run ended with 4
// ingots and no iron pick. Ingots for the pick become one before any other step, and the shears
// only come out of ingots beyond the pick's 3.
const HARD2={wooden_axe:1,stone_pickaxe:1,stone_sword:1,stone_axe:1,furnace:1,crafting_table:1,cobblestone:120,spruce_planks:12,iron_ingot:3,torch:8,dirt:40};
const at=(inv,ctx={})=>plan(inv,{foodBar:14,lowHealth:true,tod:6000,...ctx});

test('round 120: three ingots held and no iron pick - the pick comes before food, the stone kit and torches',()=>{
 assert.equal(IRON_PICK_INGOTS,3);
 // hard2 at t=1870: no sticks, 12 planks, a table held - sticks first, then the pick
 assert.deepEqual(at(HARD2),{step:'iron',job:{type:'craft',item:'stick',count:2}});
 assert.deepEqual(at({...HARD2,stick:2}),{step:'iron',job:{type:'craft',item:'iron_pickaxe',count:1}});
 // a food emergency (nothing to eat, bar 3) waits the few seconds the craft takes
 assert.deepEqual(at({...HARD2,stick:2},{foodBar:3}),{step:'iron',job:{type:'craft',item:'iron_pickaxe',count:1}});
 // a log and no planks: planks first; a table standing near counts as held
 const {spruce_planks,crafting_table,...bare}=HARD2;
 assert.deepEqual(at({...bare,spruce_log:1},{worldTable:true}),{step:'iron',job:{type:'craft',item:'spruce_planks',count:4}});
 assert.deepEqual(at({...bare,stick:2},{worldTable:true}),{step:'iron',job:{type:'craft',item:'iron_pickaxe',count:1}});
 // no table: sticks and a table's 4 planks from what is held
 assert.deepEqual(ironPickFirst(n=>({...bare,spruce_planks:6})[n]||0,{planksTotal:6,logsTotal:0}),{type:'craft',item:'stick',count:2});
});

test('round 120: with the pick held, two ingots, no wood, or the iron step blocked, the ladder is unchanged',()=>{
 const c=o=>n=>o[n]||0;
 assert.equal(ironPickFirst(c({...HARD2,iron_pickaxe:1}),{planksTotal:12,logsTotal:0}),null);
 assert.equal(ironPickFirst(c({...HARD2,diamond_pickaxe:1}),{planksTotal:12,logsTotal:0}),null);
 assert.equal(ironPickFirst(c({...HARD2,iron_ingot:2}),{planksTotal:12,logsTotal:0}),null);
 assert.equal(ironPickFirst(c({iron_ingot:3}),{planksTotal:0,logsTotal:0}),null,'no wood held: not a log trip');
 assert.equal(ironPickFirst(c({iron_ingot:3,oak_planks:5}),{planksTotal:5,logsTotal:0}),null,'no table and 5 planks: short of sticks plus a table');
 assert.equal(ironPickFirst(c(HARD2),{planksTotal:12,logsTotal:0,blocked:'iron'}),null);
 assert.equal(ironPickFirst(c(HARD2),{planksTotal:12,logsTotal:0,kitSkip:{iron_pickaxe:Date.now()+60000}}),null);
 // the pick held: the ladder goes on to its food step as before
 assert.notEqual(at({...HARD2,iron_pickaxe:1}).job?.item,'iron_pickaxe');
 assert.equal(at({...HARD2,iron_pickaxe:1}).step,'food');
 // no pickaxe at all: the stone pick (round 65) still comes first
 const {stone_pickaxe,...noPick}=HARD2;
 assert.equal(at({...noPick,stick:2}).step,'stone');
});

test('round 120: the shears never take the iron pick\'s ingots',()=>{
 const c=o=>n=>o[n]||0;
 const ctx={planksTotal:12,logsTotal:0,sheepNear:2};
 // hard2 at dusk: 3 ingots and a stone sword - a sheep hunt for the wool, the ingots kept
 assert.deepEqual(bedJob(c(HARD2),ctx),{type:'hunt',entity:'sheep',count:2});
 assert.deepEqual(bedPrepJob(HARD2,{tod:10000,sheepNear:2}),{type:'hunt',entity:'sheep',count:2});
 // 5 ingots with no pick: 3 for the pick, 2 for the shears
 assert.deepEqual(bedJob(c({...HARD2,iron_ingot:5}),ctx),{type:'craft',item:'shears',count:1});
 // the pick held: 2 ingots make shears, as before
 assert.deepEqual(bedJob(c({...HARD2,iron_ingot:2,iron_pickaxe:1}),ctx),{type:'craft',item:'shears',count:1});
 // no sword and only the pick's ingots: no wool job
 const {stone_sword,...unarmed}=HARD2;
 assert.equal(bedJob(c(unarmed),ctx),null);
});
