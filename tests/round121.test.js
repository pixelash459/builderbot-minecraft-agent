import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Autopilot,defenseHold,DEFENSE_HOLD_JOBS,DEFENSE_PAUSE_MS,FOOD_CRITICAL} from '../src/autopilot.js';
console.error=()=>{};

// Round 121: the round-120 hard1 death - in a 25-mob dawn crowd round a drowned with a trident,
// the wood gather was preempted by Mob Defense and a new one submitted within a second, eight
// times in 10 s; then a pig fight and a drop collect went out under the low-health emergency at
// health 2 and a trident killed it. While Mob Defense is on, no walking ladder job goes out.
const STONE={wooden_axe:1,stone_pickaxe:1,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1,cobblestone:200,raw_iron:7,iron_ingot:1,cooked_mutton:1};
function setup({inv=STONE,chain=null,jobs=[],health=18.3,food=16}={}){
 const logs=[],subs=[];
 const items=Object.entries(inv).map(([name,count])=>({name,count}));
 const bot={entity:{position:new Vec3(769.5,69,-436.5),velocity:new Vec3(0,0,0)},health,food,time:{day:3,timeOfDay:1500},entities:{},
  inventory:{items:()=>items,slots:[]},registry:{blocksByName:{},itemsByName:{}},findBlock:()=>null,findBlocks:()=>[],blockAt:()=>({name:'air',skyLight:15})};
 const w={bot,jobs,log:m=>logs.push(m),taskRunner:{status:()=>({running:true,chain,task:null})},config:{limits:{minHealth:10}}};
 const ap=Object.create(Autopilot.prototype);
 Object.assign(ap,{worker:w,log:m=>logs.push(m),submit:(step,spec)=>subs.push([step,spec]),state:'',lastSurfaceY:70,failures:{},huntPhase:false,food:{},heal:{},
  counts:()=>({...inv,_edible:inv.cooked_mutton||0}),animalsNearby:()=>({type:'pig',close:1})});
 return {ap,bot,logs,subs,w};
}
const paused={id:9,status:'paused',spec:{type:'gather',block:'log',count:3},message:'Reflex: preempted by Mob Defense'};

test('round 121: Mob Defense on - the wood gather is held, once logged, and goes when the reflex is idle',()=>{
 const idle=setup();
 idle.ap.decide(idle.bot);
 assert.equal(idle.subs.length,1,idle.logs.join('\n'));
 const job=idle.subs[0][1];
 assert.ok(DEFENSE_HOLD_JOBS.has(job.type),JSON.stringify(idle.subs));
 for(const [chain,jobs,why] of [['Mob Defense',[],'active'],[null,[paused],'paused a job']]){
  const s=setup({chain,jobs});
  s.ap.decide(s.bot);s.ap.decide(s.bot);
  assert.deepEqual(s.subs,[],why+': nothing submitted over the reflex');
  assert.equal(s.ap.state,'mob defense: holding the ladder');
  assert.deepEqual(s.logs.filter(l=>/holding the ladder/.test(l)),['Autopilot: mob defense: holding the ladder (Mob Defense '+why+'; 0 hostiles within 16; the '+idle.subs[0][0]+' '+job.type+' waits)'],why);
 }
});

test('round 121: a job paused a minute with the reflex idle no longer holds the ladder',()=>{
 const s=setup({jobs:[paused]});
 s.ap.decide(s.bot);
 assert.deepEqual(s.subs,[]);
 s.ap.defensePausedAt=Date.now()-DEFENSE_PAUSE_MS-1;
 s.ap.decide(s.bot);
 assert.equal(s.subs.length,1,s.logs.join('\n'));
 // the reflex running again starts a fresh hold
 s.w.taskRunner={status:()=>({running:true,chain:'Mob Defense',task:null})};s.subs.length=0;
 s.ap.decide(s.bot);
 assert.deepEqual(s.subs,[]);assert.equal(s.ap.defensePausedAt,null);
});

test('round 121: the hard1 emergency pig fight at health 2 waits; a starving bot and quick jobs still go',()=>{
 const c=o=>n=>o[n]||0;
 const pig={step:'food',job:{type:'fight',entity:'pig',maxSeconds:90}};
 // health 2.1, bar 16, nothing to eat: the low-health emergency's fight waits for the reflex
 assert.equal(defenseHold(pig,c({}),{defending:'active',foodBar:16,lowHealth:true}),true);
 assert.equal(defenseHold({step:'food',job:{type:'collect',radius:16}},c({}),{defending:'paused a job',foodBar:16,lowHealth:true}),true);
 // starving (bar at FOOD_CRITICAL) with nothing to eat: the trip goes
 assert.equal(defenseHold(pig,c({}),{defending:'active',foodBar:FOOD_CRITICAL}),false);
 assert.equal(defenseHold(pig,c({cooked_beef:1,_edible:1}),{defending:'active',foodBar:FOOD_CRITICAL}),true,'food held: eat it, no fight');
 // escape climbs, the night jobs, crafts, smelts, meals, equips, drops are never held
 for(const type of ['ascend','shelter','sleep','craft','smelt','eat','equip','drop','place','bagrun'])
  assert.equal(defenseHold({step:'iron',job:{type}},c({}),{defending:'active'}),false,type);
 // Mob Defense idle: nothing held
 assert.equal(defenseHold({step:'wood',job:{type:'gather'}},c({}),{defending:null}),false);
 // decide: the stone kit's craft goes out with Mob Defense active (round 117's case)
 const {stone_shovel,...noShovel}=STONE;
 const s=setup({inv:{...noShovel,stick:2,crafting_table:1,oak_planks:8},chain:'Mob Defense'});
 s.ap.decide(s.bot);
 assert.deepEqual(s.subs.map(([st,j])=>[st,j.type]),[['stone','craft']],s.logs.join('\n'));
});
