import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,shelterReport} from '../src/worker.js';

// Round 60: the night skip. observe reports how long the bot has been sealed and safe in its
// shelter; the soak operator moves the clock to the next morning after a few safe minutes.
test('round 60: the safe-since clock runs only while sealed with nothing open, and unsealing clears it',()=>{
 const w=Object.create(Worker.prototype);
 assert.equal(shelterReport(w),null,'not sheltered');
 w.shelterSealed=true;w.shelterKind='box';w.shelterGaps=0;
 assert.deepEqual(shelterReport(w),{kind:'box',safe:false,seconds:0,gaps:0},'sealed, not yet confirmed safe');
 const t0=Date.now();
 w.noteShelter(true);
 const r=shelterReport(w,t0+151000);
 assert.equal(r.safe,true);assert.ok(r.seconds>=150,'seconds '+r.seconds);
 w.noteShelter(true);
 assert.ok(shelterReport(w,t0+151000).seconds>=150,'a second safe note keeps the clock');
 w.noteShelter(false);
 assert.equal(shelterReport(w).safe,false,'a gap or leaving the cell restarts it');
 w.noteShelter(true);w.shelterSealed=false;
 assert.equal(shelterReport(w),null,'the morning (or a night mine) unseals');
 assert.equal(w.shelterSafeSince,null);
 w.noteShelter(true);
 assert.equal(w.shelterSafeSince,null,'no clock while unsealed');
});
test('round 60: guardShelter records the open gaps and an intruder for the safe check',async()=>{
 const w=Object.create(Worker.prototype);
 Object.assign(w,{logs:[],log(m){this.logs.push(m);},check(){},
  bot:{entity:{position:new Vec3(0.5,64,0.5)},entities:{},inventory:{items:()=>[]},blockAt:()=>({name:'cobblestone',boundingBox:'block'})}});
 await w.guardShelter({pod:null},1,new Vec3(0,64,0));
 assert.equal(w.shelterGaps,0,'a closed box');
 assert.equal(w.shelterIntruder,false);
});
