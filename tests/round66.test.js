import test from 'node:test';
import assert from 'node:assert/strict';
import {Autopilot,FOOD_HEADINGS} from '../src/autopilot.js';

// Round 66: the round-65 soak on seed 20261027.
test('round 66: with no graze biome the food search keeps one heading, and turns when set aside',()=>{
 const ap=Object.create(Autopilot.prototype);
 ap.worker={log(){},meals:{}};ap.log=()=>{};ap.state='';
 const h=ap.foodHeading('random');
 assert.ok(FOOD_HEADINGS.includes(h));
 for(let i=0;i<5;i++)assert.equal(ap.foodHeading('random'),h,'the same heading leg after leg');
 ap.deferFood('6 explore legs without food');
 const next=FOOD_HEADINGS[(FOOD_HEADINGS.indexOf(h)+1)%4];
 assert.equal(ap.foodHeading('random'),next,'a quarter turn after a set-aside');
 assert.equal(ap.foodHeading('south'),'south','a graze biome still wins');
});
