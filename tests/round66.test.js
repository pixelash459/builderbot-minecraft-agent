import test from 'node:test';
import assert from 'node:assert/strict';
import {Autopilot,FOOD_HEADINGS} from '../src/autopilot.js';
import {sprintAssist,ledgeGuard,SPRINT_FOOD} from '../src/worker.js';

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
test('round 66: a pathfinder walk on the ground runs; not hungry, in water, sneaking or standing still',()=>{
 const mk=(o={})=>{const ctl={forward:true,sprint:false,sneak:false,...(o.ctl||{})};
  return {ctl,bot:{food:o.food??20,entity:{onGround:o.onGround??true,isInWater:!!o.water},pathfinder:{isMoving:()=>o.moving??true},
   getControlState:k=>!!ctl[k],setControlState:(k,v)=>{ctl[k]=v;}}};};
 let t=mk();assert.equal(sprintAssist(t.bot),true);assert.equal(t.ctl.sprint,true);
 for(const o of [{food:SPRINT_FOOD},{water:true},{onGround:false},{moving:false},{ctl:{sneak:true}},{ctl:{forward:false}}]){
  t=mk(o);assert.equal(sprintAssist(t.bot),false,JSON.stringify(o));assert.equal(t.ctl.sprint,false,JSON.stringify(o));
 }
 assert.equal(SPRINT_FOOD,6);
});
