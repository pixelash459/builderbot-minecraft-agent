// Round 99 (round-98 hard1: `speared by Zombie` at (793, 89, -530) with the stone kit in the bag, the
// respawn 140 blocks off, no iron pick in the 25 minutes left; hard2 the same, twice): after a death
// with a kit in the bag the ladder walks back for the drops before it starts over.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Vec3} from 'vec3';
import {Autopilot,bagRunSkip,deathBag,BAG_RUN_MS,BAG_RUN_FAR,BAG_RUN_DEEP,BAG_RUN_TRIES} from '../src/autopilot.js';
import {Worker,BAG_RUN_LEG,BAG_RUN_NEAR,BAG_RUN_SWEEP,BAG_RUN_SWEEP_MS} from '../src/worker.js';
import {jobSchema} from '../src/schema.js';

const NOW=1e12,death=(over={})=>({pos:{x:793.7,y:89,z:-529.7},t:NOW-10000,bag:{items:9,worth:['stone_pickaxe','stone_sword','furnace'],lava:false},...over});
const spawn=new Vec3(697.5,68,-421.5);

test('round 99: what a death leaves is read from the bag, and only a kit is worth the walk',()=>{
 const inv=names=>({inventory:{items:()=>names.map(([name,count])=>({name,count}))},blockAt:()=>({name:'air'})});
 const at=new Vec3(1.5,70,1.5);
 assert.deepEqual(deathBag(inv([['stone_pickaxe',1],['stone_pickaxe',1],['stone_sword',1],['furnace',1],['dirt',30]]),at),{items:34,worth:['stone_pickaxe','stone_sword','furnace'],lava:false});
 assert.deepEqual(deathBag(inv([['dirt',30],['oak_log',2],['cobblestone',17]]),at).worth,[]);
 assert.equal(deathBag({...inv([['stone_sword',1]]),blockAt:()=>({name:'lava'})},at).lava,true);
 assert.equal(deathBag({},at),null);
 assert.equal(bagRunSkip(death(),null,spawn,NOW),null);
 assert.equal(bagRunSkip(death({pos:null}),null,spawn,NOW),'no death position');
 assert.equal(bagRunSkip(death({bag:null}),null,spawn,NOW),'nothing worth the walk in the bag');
 assert.equal(bagRunSkip(death({bag:{items:3,worth:[],lava:false}}),null,spawn,NOW),'nothing worth the walk in the bag');
 assert.equal(bagRunSkip(death({bag:{items:3,worth:['furnace'],lava:true}}),null,spawn,NOW),'the drops went in the lava');
 assert.equal(bagRunSkip(death({pos:{x:697.5+BAG_RUN_FAR+1,y:68,z:-421.5}}),null,spawn,NOW),'221 away');
 assert.equal(bagRunSkip(death({pos:{x:700,y:68-BAG_RUN_DEEP-1,z:-420}}),null,spawn,NOW),'33 above or below');
 // round-97 normal3: y=-25 from a y=68 respawn
 assert.equal(bagRunSkip(death({pos:{x:720,y:-25,z:-430}}),null,spawn,NOW),'93 above or below');
 const iso=t=>new Date(t).toISOString();
 assert.equal(bagRunSkip(death(),{t:iso(NOW-120000),pos:{x:790,y:89,z:-532}},spawn,NOW),'two deaths at that spot');
 assert.equal(bagRunSkip(death(),{t:iso(NOW-120000),pos:{x:700,y:68,z:-430}},spawn,NOW),null,'elsewhere');
 assert.equal(bagRunSkip(death(),{t:iso(NOW-900000),pos:{x:790,y:89,z:-532}},spawn,NOW),null,'long ago');
 assert.ok(jobSchema.parse({type:'bagrun',position:{x:793,y:89,z:-530}}));
});

function pilot(d=death({t:Date.now()-10000})){
 const logs=[],jobs=[],w={lastDeath:d,deathLog:[{t:new Date(d.t).toISOString(),pos:d.pos}],jobs,log:m=>logs.push(m),
  submit(spec){const j={id:'j'+jobs.length,spec,status:'queued'};jobs.push(j);return j;}};
 const a=Object.create(Autopilot.prototype);Object.assign(a,{worker:w,failures:{}});
 return {a,w,logs,jobs,b:{entity:{position:spawn}}};
}

test('round 99: one bag run per death, held through a reflex, and over once it settles',()=>{
 const {a,w,logs,jobs,b}=pilot();
 assert.equal(a.bagRun(b),true);
 assert.deepEqual(jobs[0].spec,{type:'bagrun',position:{x:793,y:89,z:-530}});
 assert.equal(a.currentStep,'bag');
 assert.equal(logs.at(-1),'Autopilot [bag] {"type":"bagrun","position":{"x":793,"y":89,"z":-530}}');
 // a flee pauses it: the ladder waits, nothing new goes out to supersede it
 jobs[0].status='paused';jobs[0].message='Reflex: preempted by Mob Defense';
 assert.equal(a.bagRun(b),true);assert.equal(a.state,'bag: waiting on a reflex');assert.equal(jobs.length,1);
 // done: the ladder has the bot back, and the next death gets its own run
 jobs[0].status='complete';a.settle(jobs[0]);
 assert.equal(a.bagRun(b),false);assert.equal(jobs.length,1);
 w.lastDeath=death({t:Date.now()-5000,pos:{x:735.3,y:61,z:-518.3}});
 assert.equal(a.bagRun(b),true);assert.equal(jobs.length,2);
});

test('round 99: a failed run retries up to the limit, and old drops or a skip end it with one line',()=>{
 {const {a,logs,jobs,b}=pilot();
  assert.equal(BAG_RUN_TRIES,3);
  for(let i=0;i<3;i++){assert.equal(a.bagRun(b),true);jobs[i].status='failed';a.settle(jobs[i]);a.coolUntil=0;}
  assert.equal(a.bagRun(b),false);assert.equal(jobs.length,3);
  assert.equal(logs.at(-1),'Bag run: given up after 3 run(s); the ladder starts over');
  a.bagRun(b);assert.equal(logs.filter(l=>/given up/.test(l)).length,1);}
 {const {a,logs,jobs,b}=pilot(death({t:Date.now()-BAG_RUN_MS-1}));
  assert.equal(a.bagRun(b),false);assert.equal(jobs.length,0);
  assert.equal(logs.at(-1),'Bag run: too late for the drops; the ladder starts over');}
 {const {a,logs,jobs,b}=pilot(death({t:Date.now()-10000,bag:{items:30,worth:[],lava:false}}));
  assert.equal(a.bagRun(b),false);assert.equal(a.bagRun(b),false);assert.equal(jobs.length,0);
  assert.deepEqual(logs,['Bag run: skipped (nothing worth the walk in the bag)']);}
 {const {a,logs,jobs,b}=pilot();
  a.bagRun(b);jobs[0].status='paused';jobs[0].message='Reflex: preempted by Mob Defense';
  const clock=Date.now;Date.now=()=>clock()+BAG_RUN_MS;
  try{assert.equal(a.bagRun(b),false,'the flee outlasted the drops');}finally{Date.now=clock;}
  assert.equal(logs.at(-1),'Bag run: out of time after 1 run(s); the ladder starts over');}
 {const {a,jobs,b}=pilot();a.worker.lastDeath=null;assert.equal(a.bagRun(b),false);assert.equal(jobs.length,0);}
});

function walker({fail=null,drops=[['stone_pickaxe',2],['stone_sword',1]],bag=[]}={}){
 const logs=[],goalsSeen=[],items=[...bag];
 const bot={entity:{position:new Vec3(697.5,68,-421.5)},inventory:{items:()=>items}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,log:m=>logs.push(m),check(){},lastDeath:death({t:Date.now()-10000}),
  async navigate(goal,token,seconds){
   goalsSeen.push({x:goal.x,z:goal.z,seconds});
   if(fail&&goalsSeen.length===fail)throw Error('No path to the goal!');
   bot.entity.position=new Vec3(goal.x+0.5,70,goal.z+0.5);
  },
  async walk(t,token,range,seconds){goalsSeen.push({x:t.x,z:t.z,range,seconds});bot.entity.position=new Vec3(t.x+0.5,t.y,t.z+0.5);},
  async sweepDrops(token,radius,ms){w.swept=[radius,ms];for(const [name,count] of drops)items.push({name,count});}});
 return {w,bot,logs,goalsSeen,job:{spec:{type:'bagrun',position:{x:793,y:89,z:-530}}}};
}

test('round 99: the run walks straight-line legs to the death and sweeps the drops',async()=>{
 assert.equal(BAG_RUN_LEG,48);assert.equal(BAG_RUN_NEAR,6);assert.equal(BAG_RUN_SWEEP,24);assert.equal(BAG_RUN_SWEEP_MS,30000);
 const {w,logs,goalsSeen,job}=walker({bag:[{name:'dirt',count:3}]});
 await w.bagRun(job,0);
 assert.match(logs[0],/^Bag run: walking 145 back to the death at \(793, 89, -530\) \(stone_pickaxe, stone_sword, furnace; 2[56]\d s left on the drops\)$/);
 // 145 blocks: legs of 48, then the death cell
 const legs=goalsSeen.filter(g=>g.range===undefined);
 assert.ok(legs.length>=2&&legs.length<=3,JSON.stringify(goalsSeen));
 assert.equal(legs[0].seconds,45);
 assert.ok(Math.abs(Math.hypot(legs[0].x-697.5,legs[0].z+421.5)-48)<2,JSON.stringify(legs[0]));
 assert.equal(goalsSeen.at(-1).x,793);assert.equal(goalsSeen.at(-1).range,2);
 assert.deepEqual(w.swept,[24,30000]);
 assert.match(logs.at(-1),/^Bag run: at the death after \d+ s; picked up stone_pickaxe 2, stone_sword 1$/);
 assert.equal(logs.length,2);
 // a run the flee paused starts again from where the bot stands, with no second start line
 await w.bagRun(job,0);
 assert.equal(logs.filter(l=>/walking/.test(l)).length,1);
});

test('round 99: a leg with no path fails the run, and time running out stops it',async()=>{
 {const {w,job}=walker({fail:1});await assert.rejects(w.bagRun(job,0),/No path to the goal/);}
 {const {w,logs,job}=walker();w.lastDeath.t=Date.now()-BAG_RUN_MS+2000;
  await assert.rejects(w.bagRun(job,0),/^Error: Bag run: stopped 145 short of the death at \(697, 68, -422\)$/);
  assert.equal(logs.length,1);}
 // nothing left there: the run still ends cleanly
 {const {w,logs,job}=walker({drops:[]});await w.bagRun(job,0);assert.match(logs.at(-1),/no drops picked up$/);}
});

test('round 99: the death records the bag; the ladder looks for a run after the recovery and off the night',()=>{
 const src=fs.readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
 assert.ok(src.includes('t:Date.now(),bag:deathBag(bot,at)};'));
 assert.ok(src.includes("if(spec.type==='bagrun')return this.bagRun(job,token);"));
 const ap=fs.readFileSync(new URL('../src/autopilot.js',import.meta.url),'utf8');
 const i=ap.indexOf('if(!shelterDue(dayTicks(b))&&this.bagRun(b))return;');
 assert.ok(i>ap.indexOf('if(!shelterDue(dayTicks(b))&&this.recovering(b))return;')&&i<ap.indexOf('this.rememberHome(b);\n  // Dusk prep'));
});
