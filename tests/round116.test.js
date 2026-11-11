import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Autopilot,CAVE_CLIMBS,CAVE_CLIMB_MS} from '../src/autopilot.js';
import {Worker,MOB_CAVE_AVOID,MOB_CAVE_MS} from '../src/worker.js';
console.error=()=>{};

// Round 116: the round-115 hard2 death - five `a mob cave ... climbing out` lines in 74 s from y=44
// down to y=22; each climb, paused by a flee, was superseded by a cobblestone drop, a porkchop
// smelt, a heal meal, an iron gather to y=16 and the night shelter, and zombies killed the bot at
// y=24 6 s after the fifth mark. Under rock near a mob cave it stood in, the climb out is the only
// autopilot job.
function setup({y=31,sky=0,jobs=[],marks=[]}={}){
 const logs=[],subs=[];
 const bot={entity:{position:new Vec3(813.5,y,-541.5)},blockAt:()=>({name:'air',skyLight:sky}),time:{day:4,timeOfDay:1000}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,jobs,log:m=>logs.push(m)});
 w.mobCaves=marks;
 const ap=Object.create(Autopilot.prototype);
 Object.assign(ap,{worker:w,log:m=>logs.push(m),submit:(step,spec)=>subs.push([step,spec]),state:'',lastSurfaceY:103});
 return {ap,w,bot,logs,subs};
}
const mark=(x,y,z,{ago=6000,kind='here'}={})=>({x,y,z,at:Date.now()-ago,until:Date.now()-ago+MOB_CAVE_MS,kind});

test('round 116: under rock near the mob cave the bot stood in, the climb out goes before any other job',()=>{
 assert.equal(CAVE_CLIMBS,3);assert.equal(CAVE_CLIMB_MS,600000);
 const s=setup({y:24,marks:[mark(810,23,-527)]});
 s.bot.entity.position=new Vec3(813.5,24,-520.5);
 assert.equal(s.ap.caveClimb(s.bot),true);
 assert.deepEqual(s.subs,[['escape',{type:'ascend',y:103}]]);
 assert.equal(s.logs.length,1);
 assert.match(s.logs[0],/^Autopilot: under rock at y=24 \(surface 103\), 7 from the mob cave marked at \(810, 23, -527\) 6 s ago; climbing out before any other job$/);
 // the climb, paused by a flee (or queued, or running): nothing is submitted over it
 for(const status of ['paused','queued','running']){
  s.w.jobs=[{status,spec:{type:'ascend',y:103},message:'Reflex: preempted by Mob Defense'}];s.subs.length=0;
  assert.equal(s.ap.caveClimb(s.bot),true,status);
  assert.deepEqual(s.subs,[],status+': no drop, no smelt, no meal, no gather, no shelter');
  assert.equal(s.ap.state,'mob cave near: climbing out');
 }
 assert.equal(s.logs.length,1,'the hold logs nothing');
});

test('round 116: out of the cave, far from it, under sky, an ore mark or an old mark - the ladder runs',()=>{
 // near the surface (within 8 of it)
 const at=(o)=>{const s=setup(o);return [s.ap.caveClimb(s.bot),s.subs.length];};
 assert.deepEqual(at({y:96,marks:[mark(813,90,-541)]}),[false,0]);
 // under open sky in a ravine
 assert.deepEqual(at({y:31,sky:15,marks:[mark(813,31,-541)]}),[false,0]);
 // the mark 25 away (past MOB_CAVE_AVOID)
 assert.equal(MOB_CAVE_AVOID,24);
 assert.deepEqual(at({y:31,marks:[mark(838.5,31,-541.5)]}),[false,0]);
 // a round-114 ore mark (a crowd round an ore the gather passed over) is not a cave the bot stood in
 assert.deepEqual(at({y:31,marks:[mark(813,31,-530,{kind:'ore'})]}),[false,0]);
 // an expired mark
 assert.deepEqual(at({y:31,marks:[mark(813,31,-530,{ago:MOB_CAVE_MS+1000})]}),[false,0]);
 // no marks at all
 assert.deepEqual(at({y:31}),[false,0]);
 // the marks themselves: kind 'here' from the bot's own spot, 'ore' from a position
 const w=Object.assign(Object.create(Worker.prototype),{bot:{entity:{position:new Vec3(1,30,1)}}});
 assert.equal(w.markMobCave(),true);assert.equal(w.markMobCave(new Vec3(100,30,0)),true);
 assert.deepEqual(w.mobCaves.map(h=>h.kind),['here','ore']);
 assert.equal(w.mobCaveNear(new Vec3(5,30,1)).kind,'here');
 assert.equal(w.mobCaveNear(new Vec3(100,30,5)),null,'only the ore mark there');
});

test('round 116: three climbs in 10 min that do not get out hand the bot back to the ladder',()=>{
 const s=setup({y:31,marks:[mark(813,31,-541)]});
 for(let i=0;i<CAVE_CLIMBS;i++){assert.equal(s.ap.caveClimb(s.bot),true);}
 assert.equal(s.subs.length,CAVE_CLIMBS);
 assert.equal(s.ap.caveClimb(s.bot),false);
 assert.match(s.logs.at(-1),/^Autopilot: 3 climbs out of the mob cave at \(813, 31, -541\) in 10 min did not get the bot out; back to the ladder$/);
 s.ap.caveClimb(s.bot);assert.equal(s.logs.filter(l=>/did not get the bot out/.test(l)).length,1,'once');
 // ten minutes on, the climbs are back
 s.ap.caveClimbs=s.ap.caveClimbs.map(t=>t-CAVE_CLIMB_MS-1);
 assert.equal(s.ap.caveClimb(s.bot),true);
});

test('round 116: the autopilot tick holds the paused climb instead of submitting the night shelter or a meal',()=>{
 const s=setup({y:31,marks:[mark(813,31,-541)],jobs:[{id:5,status:'paused',spec:{type:'ascend',y:103},message:'Reflex: preempted by Mob Defense'}]});
 Object.assign(s.w,{ready:true,taskRunner:{status:()=>({chain:'Mob Defense'})},deathResume:false,userStopped:false});
 s.bot.time.timeOfDay=13500; // night: the shelter would go out
 s.bot.inventory={items:()=>[]};s.bot.registry={blocksByName:{}};s.bot.findBlock=()=>null;s.bot.health=12;s.bot.food=14;
 const called=[];
 Object.assign(s.ap,{enabled:true,failures:{},currentStep:'escape',current:{id:5,step:'escape'},respawnNight:()=>false,publishReserve(){},
  recovering:()=>{called.push('recovering');return false;},bagRun:()=>{called.push('bag');return false;},
  rememberHome(){called.push('home');},decide(){called.push('decide');}});
 s.ap.tick();
 assert.deepEqual(s.subs,[],'nothing submitted over the paused climb');
 assert.deepEqual(called,[],'the night job, the bag run and the ladder wait for the climb');
 assert.equal(s.ap.state,'mob cave near: climbing out');
 // the climb done (the bot near the surface): the tick goes on as before
 s.w.jobs=[{id:5,status:'complete',spec:{type:'ascend',y:103}}];s.bot.entity.position=new Vec3(813.5,100,-541.5);
 s.ap.tick();
 assert.ok(called.includes('home'),called.join(',')); // past the hold (at night the recovery wait is skipped)
});
