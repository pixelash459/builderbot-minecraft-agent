// Round 100 (round-99 hard2: `Bag run: walking 171 back`, a creeper flee 64 s in, and 80 ms after the
// pause `Autopilot [wood]` superseded the run - settle() took the paused job for a finished one, so
// bagRun() was over before its reflex hold was reached). These tests go through tick(), the path the
// round-99 tests stepped round.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Vec3} from 'vec3';
import {Autopilot} from '../src/autopilot.js';
import {Worker} from '../src/worker.js';

const spawn=new Vec3(697.5,68,-421.5);
function pilot(){
 const d={pos:{x:793.7,y:75,z:-567.7},t:Date.now()-10000,bag:{items:9,worth:['stone_pickaxe','furnace'],lava:false}};
 const logs=[],jobs=[];
 const b={entity:{position:spawn},time:{timeOfDay:3000,day:1}};
 const w={ready:true,bot:b,lastDeath:d,deathLog:[{t:new Date(d.t).toISOString(),pos:d.pos}],jobs,log:m=>logs.push(m),
  submit(spec){const j={id:'j'+jobs.length,spec,status:'queued'};jobs.push(j);return j;}};
 const a=Object.create(Autopilot.prototype);
 // rememberHome is the first line of the ladder after the bag run: reaching it means the ladder is back
 Object.assign(a,{worker:w,failures:{},enabled:true,respawnNight:()=>false,recovering:()=>false,publishReserve(){},bedForNight:()=>false,crowdNear:()=>0,rememberHome(){throw Error('the ladder');}});
 return {a,w,logs,jobs,b};
}
const preempted=j=>{j.status='paused';j.message='Reflex: preempted by Mob Defense';};

test('round 100: a reflex pause does not end the run, and the ladder waits through it',()=>{
 const {a,jobs}=pilot();
 a.tick();assert.equal(jobs.length,1);assert.equal(jobs[0].spec.type,'bagrun');
 jobs[0].status='running';a.tick();assert.equal(a.state,'working: bagrun');
 preempted(jobs[0]);
 a.tick();
 assert.equal(a.state,'bag: waiting on a reflex');assert.equal(jobs.length,1,'nothing went out to supersede it');
 assert.notEqual(a.bagDone,a.worker.lastDeath.t);
 a.tick();assert.equal(a.state,'bag: waiting on a reflex');assert.equal(jobs.length,1);
});

test('round 100: a run that finishes after a pause ends with no second run',()=>{
 const {a,jobs}=pilot();
 a.tick();jobs[0].status='running';a.tick();preempted(jobs[0]);a.tick();
 // the reflex resumes it, a second flee pauses it, and it goes on to finish
 jobs[0].status='running';a.tick();preempted(jobs[0]);a.tick();assert.equal(jobs.length,1);
 jobs[0].status='running';a.tick();
 jobs[0].status='complete';
 assert.throws(()=>a.tick(),/the ladder/);
 assert.equal(a.bagDone,a.worker.lastDeath.t);assert.equal(jobs.length,1);
});

test('round 100: a run that finishes with no pause still ends through settle',()=>{
 const {a,jobs}=pilot();
 a.tick();jobs[0].status='complete';
 assert.throws(()=>a.tick(),/the ladder/);
 assert.equal(a.bagDone,a.worker.lastDeath.t);assert.equal(jobs.length,1);
});

test('round 100: a run that fails after a pause gets its next try, and the next death its own run',()=>{
 const {a,w,jobs}=pilot();
 a.tick();preempted(jobs[0]);a.tick();
 jobs[0].status='failed';a.coolUntil=0;
 a.tick();assert.equal(jobs.length,2,'the second try');assert.equal(a.bag.tries,2);
 jobs[1].status='complete';a.coolUntil=0;
 assert.throws(()=>a.tick(),/the ladder/);
 // the old run's `complete` must not close the next death before its first run goes out
 w.lastDeath={...w.lastDeath,t:Date.now()-5000,pos:{x:735.3,y:61,z:-518.3}};
 a.tick();assert.equal(jobs.length,3);assert.deepEqual(jobs[2].spec.position,{x:735,y:61,z:-519});
});

test('round 100, diagnostic: the mobs holding a box are named with height and sky',()=>{
 const me=new Vec3(825.5,87,-567.5);
 const mob=(name,x,y,z,type='hostile')=>({name,type,position:new Vec3(x,y,z),isValid:true});
 const self={position:me};
 const b={entity:self,entities:{a:self,b:mob('creeper',825.5,80,-562.5),c:mob('zombie',820.5,87,-567.5),d:mob('cow',826.5,87,-567.5,'animal'),e:mob('skeleton',825.5,87,-500)},
  blockAt:p=>({skyLight:p.y>=87?15:0})};
 const w=Object.assign(Object.create(Worker.prototype),{bot:b});
 assert.equal(w.hostileSpread(16),'zombie 5.0 dy 0 sky 15, creeper 8.6 dy -7 sky 0');
 assert.equal(w.hostileSpread(16,1),'zombie 5.0 dy 0 sky 15 and 1 more');
 assert.equal(w.hostileSpread(2),'nothing');
 assert.equal(Object.assign(Object.create(Worker.prototype),{bot:{}}).hostileSpread(16),'nothing');
});

test('round 100, diagnostic: the box says who holds it at dawn and as it opens, and the walls wait as before',()=>{
 const src=fs.readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
 assert.ok(src.includes("this.log('Shelter: held past dawn by '+this.hostileSpread(REFUGE_CLEAR));"));
 const open=src.indexOf("if(this.hostilesWithin(REFUGE_CLEAR))this.log('Shelter: around the box as it opens: '+this.hostileSpread(REFUGE_CLEAR));");
 assert.ok(open>src.indexOf("'); opening up');")&&open<src.indexOf('await this.removeShelter(job,token);\n }'));
});
