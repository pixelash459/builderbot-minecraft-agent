// Round 101 (round-100 hard1: died at (800, 71, -569) with the whole stone kit, and `Bag run: given up
// after 3 run(s)` 20 s later with 240 s left on the drops: three legs across the river by the spawn went
// over the search budget, each walked 11-16 blocks along the bank, and each `No path` ended a run).
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,BAG_RUN_LEG,BAG_RUN_TURNS} from '../src/worker.js';

const DEATH={x:800,y:71,z:-569};
// `leg(goal,n)` stands in for the pathfinder: it returns where the bot ends up, or throws.
function runner(leg,{from=[706.5,71,-427.5],left=268000}={}){
 const logs=[],goals=[],bot={entity:{position:new Vec3(...from)},inventory:{items:()=>[]}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,log:m=>logs.push(m),check(){},lastDeath:{t:Date.now()-270000+left,bag:{worth:['stone_pickaxe']}},
  async navigate(goal,token,seconds){goals.push({x:goal.x,z:goal.z,from:bot.entity.position.clone()});leg(goal,goals.length,bot);},
  async walk(t,token,range){goals.push({x:t.x,z:t.z,range,from:bot.entity.position.clone()});leg(t,goals.length,bot);},
  async sweepDrops(){w.swept=true;}});
 return {w,bot,logs,goals,job:{spec:{type:'bagrun',position:DEATH}}};
}
const arrive=(g,n,bot)=>{bot.entity.position=new Vec3(g.x+0.5,70,g.z+0.5);};
const noPath=()=>{throw Error('No path to the goal!');};
const bearing=g=>Math.atan2(g.z-g.from.z,g.x-g.from.x)*180/Math.PI;
const toDeath=g=>Math.atan2(DEATH.z-g.from.z,DEATH.x-g.from.x)*180/Math.PI;
const turned=g=>Math.round(((bearing(g)-toDeath(g)+540)%360)-180);

test('round 101: a leg with no path turns off the line and the run goes on',async()=>{
 assert.deepEqual(BAG_RUN_TURNS,[45,-45,90,-90]);
 const {w,logs,goals,job}=runner((g,n,bot)=>{if(n===1)noPath();arrive(g,n,bot);});
 await w.bagRun(job,0);
 assert.ok(Math.abs(turned(goals[1])-45)<=2,JSON.stringify(goals[1]));
 assert.ok(Math.abs(Math.hypot(goals[1].x-goals[1].from.x,goals[1].z-goals[1].from.z)-BAG_RUN_LEG)<2);
 assert.ok(logs.includes('Bag run: no path on the line from (706, 71, -428); turning'),logs.join('\n'));
 assert.equal(w.swept,true);assert.match(logs.at(-1),/^Bag run: at the death after/);
});

test('round 101: the round-100 river: partial paths along the bank, then round it to the death',async()=>{
 // east along the bank at z=-433 the straight line never gets across; a leg from the bank that heads
 // north of the line does, as round-99 hard2's run did by (727, 69, -465)
 const {w,bot,logs,job}=runner((g,n,bot)=>{
  const p=bot.entity.position;
  if(p.z>-440&&g.z>-470){bot.entity.position=new Vec3(p.x+12,63,-433.5);noPath();}
  if(p.z>-440&&g.x>p.x){bot.entity.position=new Vec3(p.x+12,63,-433.5);noPath();}
  arrive(g,n,bot);
 });
 await w.bagRun(job,0);
 assert.ok(Math.hypot(bot.entity.position.x-DEATH.x,bot.entity.position.z-DEATH.z)<=6);
 assert.equal(w.swept,true);
 assert.equal(logs.filter(l=>/^Bag run: walking/.test(l)).length,1,'one run, one start line');
 assert.ok(logs.filter(l=>/turning$/.test(l)).length>=1);
});

test('round 101: every bearing is tried once, in order, before the run fails',async()=>{
 const {w,logs,goals,job}=runner(noPath);
 await assert.rejects(w.bagRun(job,0),/^Error: No path to the goal!$/);
 assert.deepEqual(goals.map(turned).map(d=>Math.round(d/45)*45+0),[0,45,-45,90,-90]);
 assert.equal(logs.filter(l=>/turning$/.test(l)).length,4);
 assert.equal(w.swept,undefined);
});

test('round 101: only a no-path turns: a timeout, a pause or the clock ends the leg as before',async()=>{
 {const {w,goals,job}=runner(()=>{throw Error('Navigation timed out at (1, 2, 3)');});
  await assert.rejects(w.bagRun(job,0),/timed out/);assert.equal(goals.length,1);}
 {const r=runner(noPath);r.w.check=(()=>{let n=0;return()=>{if(++n>2)throw Error('Reflex: preempted by Mob Defense');};})();
  await assert.rejects(r.w.bagRun(r.job,0),/preempted/);assert.equal(r.goals.length,1,'a paused job turns no further');}
 {const clock=Date.now,r=runner(()=>{const at=clock()+265000;Date.now=()=>at;noPath();});
  try{await assert.rejects(r.w.bagRun(r.job,0),/No path/);}finally{Date.now=clock;}
  assert.equal(r.goals.length,1,'out of time: no turn');}
});

test('round 101: the last stretch turns too, by no more than what is left',async()=>{
 const {w,logs,goals,job}=runner((g,n,bot)=>{if(n===1)noPath();arrive(g,n,bot);},{from:[780.5,71,-549.5]});
 await w.bagRun(job,0);
 assert.equal(goals[0].range,5,'inside a leg the first try is the walk to the cell');
 const d=Math.hypot(DEATH.x-780.5,DEATH.z+549.5);
 assert.ok(Math.abs(Math.hypot(goals[1].x-780.5,goals[1].z+549.5)-d)<2,JSON.stringify(goals[1]));
 assert.equal(w.swept,true);assert.equal(logs.filter(l=>/turning$/.test(l)).length,1);
});

test('round 101: a stopped run names the death, not where the bot stood',async()=>{
 const {w,job}=runner(arrive,{left:4000});
 await assert.rejects(w.bagRun(job,0),/^Error: Bag run: stopped 170 short of the death at \(800, 71, -569\)$/);
});
