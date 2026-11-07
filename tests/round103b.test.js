import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,DROP_CLIMB_MIN,SHELTER_EXIT_MARGIN_MS,SHELTER_OPEN_MS,CREEPER_WAIT_MS} from '../src/worker.js';
import {ironRung,TORCHES} from '../src/autopilot.js';

// Round 103, pre-soak: the first armour piece (round-102: first armour at 2110/1657/1808 s on the normal
// runs, none on hard1/hard2; the last three deaths `shot by Skeleton`, hard2's death line `armour 0`).
const cnt=map=>n=>map[n]||0;
const KIT={iron_pickaxe:1,iron_sword:1,shield:1,stone_sword:1,stick:8,oak_planks:8,crafting_table:1,cobblestone:20,stone_pickaxe:2};
const WOOD={planksTotal:8,logsTotal:0,heldLog:null};
test('round 103: five ingots after the iron core make the helmet at once, before torches or the bucket',()=>{
 assert.deepEqual(ironRung(cnt({...KIT,iron_ingot:5}),WOOD),{type:'craft',item:'iron_helmet',count:1},'no torches held: still the helmet first');
 assert.deepEqual(ironRung(cnt({...KIT,iron_ingot:5,torch:TORCHES}),WOOD),{type:'craft',item:'iron_helmet',count:1});
 assert.deepEqual(ironRung(cnt({...KIT,iron_ingot:3,torch:TORCHES}),WOOD).block,'iron_ore','3 ingots and no helmet: no bucket, dig for the helmet');
 assert.deepEqual(ironRung(cnt({...KIT,iron_ingot:3,torch:TORCHES,iron_helmet:1}),WOOD),{type:'craft',item:'bucket',count:1},'the bucket once the helmet is on');
});
test('round 103: raw iron for the helmet is smelted before the torch trip',()=>{
 const j=ironRung(cnt({...KIT,iron_ingot:2,raw_iron:3,furnace:1,coal:4}),WOOD);
 assert.equal(j.type,'smelt');assert.equal(j.item,'raw_iron');
 assert.equal(ironRung(cnt({...KIT,iron_ingot:0,raw_iron:2}),WOOD).block,'coal_ore','2 raw iron are under the smelt batch: the torch coal first, as before');
});

// Round 103, pre-soak: the round-102 normal3 full-bag stall. `Dropped cobblestone came back into the
// inventory` 15 times at (831, 57, -418), a dead-end iron tunnel 34 under the surface (y=91), and the
// ladder stood 7.5 min on `waiting: bag full (iron craft)`.
function tunnelDrop({y=57,surface=63,backAt=[57],ascendTo=null}={}){
 const air={name:'air',boundingBox:'empty'},stone={name:'stone',boundingBox:'block'};
 const inv=[{name:'cobblestone',count:320,type:1}];const tossed=[],ascends=[];
 const bot={entity:{position:new Vec3(831.5,y,-417.5)},async look(){},pathfinder:{},
  // a 6-long tunnel east of the feet at every height (the toss always has an open run)
  blockAt(p){const dx=p.x-831,dy=p.y-Math.floor(bot.entity.position.y);return dx>0&&dx<=6&&p.z===-418&&(dy===0||dy===1)?air:stone;},
  inventory:{items:()=>inv.filter(i=>i.count>0)},
  async toss(t,m,n){tossed.push({n,y:Math.floor(bot.entity.position.y)});if(!backAt.includes(Math.floor(bot.entity.position.y)))inv[0].count-=n;}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,dropSettleMs:0,logs:[],log(m){this.logs.push(m);},check(){},
  autopilot:{lastSurfaceY:surface},
  count(n){return inv.filter(i=>i.name===n).reduce((a,i)=>a+i.count,0);},
  async navigate(){},
  async ascend(job){ascends.push(job.spec);if(ascendTo!=null)bot.entity.position=new Vec3(831.5,ascendTo,-417.5);}});
 return {w,tossed,ascends,bot};
}
test('round 103: a toss that came back in a tunnel climbs to the surface and tosses again there',async()=>{
 const {w,tossed,ascends}=tunnelDrop({backAt:[57],ascendTo:63});
 const job={spec:{type:'drop',item:'cobblestone',count:256}};
 await w.drop(job,0);
 assert.deepEqual(ascends,[{type:'ascend',y:63}]);
 assert.deepEqual(tossed.map(t=>t.y),[57,63],'one toss below, one on top');
 assert.equal(w.count('cobblestone'),64);
 assert.ok(w.logs.includes('Drop: the toss at (831, 57, -418) came straight back; climbing to the surface (y=63) to toss there'),w.logs.join('\n'));
 assert.match(w.logs.at(-1),/^Dropped 256 cobblestone/);
});
test('round 103: the climb is tried once a drop job; a toss that comes back on top still fails',async()=>{
 const {w,tossed,ascends}=tunnelDrop({backAt:[57,63],ascendTo:63});
 const job={spec:{type:'drop',item:'cobblestone',count:256}};
 await assert.rejects(w.drop(job,0),/came back/);
 assert.equal(ascends.length,1);assert.equal(tossed.length,2);
 assert.equal(job.retriedUp,true);
});
test('round 103: no climb on the surface, just under it, or with no surface known',async()=>{
 for(const opts of [{y:63,surface:63},{y:63-DROP_CLIMB_MIN+1,surface:63},{y:57,surface:null}]){
  const {w,ascends}=tunnelDrop({...opts,backAt:[opts.y]});
  await assert.rejects(w.drop({spec:{type:'drop',item:'cobblestone',count:256}},0),/came back/);
  assert.deepEqual(ascends,[],JSON.stringify(opts));
 }
});
test('round 103: a climb that did not rise gives the old failure, with the stop logged',async()=>{
 const {w,ascends}=tunnelDrop({backAt:[57],ascendTo:null});
 await assert.rejects(w.drop({spec:{type:'drop',item:'cobblestone',count:256}},0),/came back/);
 assert.equal(ascends.length,1);
 assert.ok(w.logs.some(l=>/climbing to the surface/.test(l)));
});

// Round 103, pre-soak: the shelter's exit margin and the creeper wait (round-101 hard3: both 60 s, so
// a creeper at the wall on the margin ran the job into `Job time limit reached` with the walls up).
// A fake clock: every sleep advances it.
async function clocked(fn){
 const real=Date.now,timers=globalThis.setTimeout;let now=1e6;const t0=now;
 Date.now=()=>now;
 globalThis.setTimeout=(f,ms)=>{now+=ms;if(now-t0>900000)throw Error('never ended');return timers(f,0);};
 try{await fn(()=>now);}finally{Date.now=real;globalThis.setTimeout=timers;}
 return (now-t0)/1000;
}
function opening({creeper=true,deadlineIn=Infinity}={}){
 const logs=[];
 const w=Object.assign(Object.create(Worker.prototype),{bot:{entity:{position:new Vec3(0,64,0)},inventory:{items:()=>[]},entities:{},time:{timeOfDay:15000}},
  logs,log:m=>logs.push(m),check(){},nearestOf:()=>creeper?{name:'creeper',d:3}:{name:null,d:Infinity},hostilesWithin:()=>1});
 w.deadline=Number.isFinite(deadlineIn)?Date.now()+deadlineIn:Infinity;
 return w;
}
test('round 103: the hold ends a whole creeper wait plus the opening before the job limit',()=>{
 assert.equal(SHELTER_EXIT_MARGIN_MS,CREEPER_WAIT_MS+SHELTER_OPEN_MS);
 assert.equal(SHELTER_EXIT_MARGIN_MS,105000);
 const w=opening({deadlineIn:SHELTER_EXIT_MARGIN_MS-1000});
 assert.equal(w.shelterExitSafe(),true,'inside the margin: the hold ends even at night');
 w.deadline=Date.now()+SHELTER_EXIT_MARGIN_MS+1000;
 assert.equal(w.shelterExitSafe(),false,'outside it: the night holds');
});
test('round 103: a creeper at the wall is waited out for the full 60 s when the job has time',async()=>{
 let w;
 const s=await clocked(async()=>{w=opening({deadlineIn:10*60000});await w.waitCreeperClear(0);});
 assert.ok(s>=60&&s<61,s+' s');
 assert.deepEqual(w.logs,['Shelter: a creeper 3.0 away; keeping the walls up','Shelter: creeper 3.0 away; opening the walls']);
});
test('round 103: near the job limit the creeper wait stops SHELTER_OPEN_MS before it and says so',async()=>{
 let w;
 const s=await clocked(async()=>{w=opening({deadlineIn:65000});await w.waitCreeperClear(0);});
 assert.ok(s>=20&&s<21,s+' s, not 60');
 assert.equal(w.logs.at(-1),'Shelter: creeper 3.0 away with 45 s left on the job; opening the walls');
});
test('round 103: the crowd wait also stops SHELTER_OPEN_MS before the limit',async()=>{
 let w;
 const s=await clocked(async()=>{w=opening({creeper:false,deadlineIn:65000});w.hostilesWithin=()=>8;await w.waitCreeperClear(0);});
 assert.ok(s>=20&&s<21,s+' s');
 assert.ok(w.logs.some(l=>/^Shelter: 8 hostiles within 32 \(no weapon held\); keeping the walls up$/.test(l)),w.logs.join('\n'));
 assert.ok(w.logs.some(l=>/^Shelter: 8 hostiles within 32 after 20 s; opening the walls$/.test(l)),w.logs.join('\n'));
});

// Round 103, review of the first live pin (flat world): inside the sealed box the head read sky 15, so
// the sky test ended the pillar before it began, and `Shelter: could not climb out; holding the box`.
function roofClimb(spec){
 const bot={entity:{position:new Vec3(0.5,64,0.5)},health:20,blockAt:()=>({name:'air',boundingBox:'empty',skyLight:15})};
 const w=Object.assign(Object.create(Worker.prototype),{bot,log(){},check(){},
  async pillarUp(target,token,{until}){while(bot.entity.position.y<target&&!until?.())bot.entity.position=bot.entity.position.offset(0,1,0);return true;},
  async navigate(){throw Error('No path to the goal!');}});
 return {w,bot,job:{spec}};
}
test('round 103: a pinned climb rises through its own roof though the head reads open sky',async()=>{
 const {w,bot,job}=roofClimb({type:'ascend',y:96,sky:true,minY:67});
 await w.ascend(job,0).catch(()=>{});
 assert.equal(bot.entity.position.y,67,'up past the roof, then the sky test stops it');
});
test('round 103: with no minY a sky climb stops on open sky at once, as a cave climb always has',async()=>{
 const {w,bot,job}=roofClimb({type:'ascend',y:96,sky:true});
 await w.ascend(job,0).catch(()=>{});
 assert.equal(bot.entity.position.y,64);
});
