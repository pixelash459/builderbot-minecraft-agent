import test from 'node:test';
import assert from 'node:assert/strict';
import {plan,pickFirst} from '../src/autopilot.js';

// Round 65: the round-64 soak on seed 20261027.
test('round 65: no pickaxe at all - a stone pick from what is held comes before the food emergency',()=>{
 // round-64 normal2 at y=27: a log, a table, 146 cobble, no food, food bar 5, no pickaxe
 const held={spruce_log:1,crafting_table:1,cobblestone:146,stone_sword:1,furnace:1,raw_iron:10,diamond:2};
 let r=plan(held,{foodBar:5});
 assert.equal(r.step,'stone');assert.equal(r.job.type,'craft');assert.match(r.job.item,/_planks$/);
 r=plan({...held,spruce_log:0,spruce_planks:4},{foodBar:5});
 assert.deepEqual([r.step,r.job.item],['stone','stick']);
 r=plan({...held,spruce_log:0,spruce_planks:2,stick:4},{foodBar:5});
 assert.deepEqual([r.step,r.job.item],['stone','stone_pickaxe']);
 // deepslate cobble counts
 r=plan({crafting_table:1,cobbled_deepslate:20,stick:2},{foodBar:5});
 assert.equal(r.job.item,'stone_pickaxe');
});
test('round 65: any pickaxe held, or no wood and no table, leaves the ladder alone',()=>{
 const c=counts=>n=>counts[n]||0;
 assert.equal(pickFirst(c({wooden_pickaxe:1,cobblestone:10,stick:4,crafting_table:1}),{}),null);
 assert.equal(pickFirst(c({cobblestone:10}),{}),null,'nothing to make the sticks or the table from');
 assert.equal(pickFirst(c({cobblestone:10,stick:2,crafting_table:1}),{blocked:'stone'}),null,'a blocked stone step is not retried here');
});
