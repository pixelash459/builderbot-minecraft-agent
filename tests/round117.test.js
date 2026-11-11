import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Autopilot,duskHuntOff} from '../src/autopilot.js';
console.error=()=>{};

// Round 117: the round-116 hard3 death - at dawn with 36 hostiles on the flee list, the food step
// sent `fight pig` 3 s after `Mob Defense engaging`, and each time the flee paused it a `collect`
// went out within a second (superseding it), then another fight; the last collect walked the bot
// to a zombie (13.5 -> 9 -> 4.5 -> 0, food 11). While Mob Defense is fleeing or fighting, no
// food trip goes out unless it is a food emergency.
const hunt={step:'food',job:{type:'fight',entity:'pig',maxSeconds:90}};
const none=()=>0;

test('round 117: no food trip while Mob Defense is on, unless starving',()=>{
 for(const type of ['fight','hunt','collect','explore'])
  assert.equal(duskHuntOff(1000,{step:'food',job:{type}},none,{foodBar:11,crowd:0,defending:'active'}),true,type);
 assert.equal(duskHuntOff(1000,hunt,none,{foodBar:11,crowd:0,defending:'paused a job'}),true);
 // the same moment with Mob Defense idle: the hunt goes (crowd 2 is under CROWD_NEAR)
 assert.equal(duskHuntOff(1000,hunt,none,{foodBar:11,crowd:2,defending:null}),false);
 // starving with nothing to eat, or hurt with the bar under 18 and nothing to eat: still go
 assert.equal(duskHuntOff(1000,hunt,none,{foodBar:5,defending:'active'}),false);
 assert.equal(duskHuntOff(1000,hunt,none,{foodBar:12,lowHealth:true,defending:'active'}),false);
 // cooking held meat and the other steps are untouched
 assert.equal(duskHuntOff(1000,{step:'food',job:{type:'smelt'}},none,{foodBar:11,defending:'active'}),false);
 assert.equal(duskHuntOff(1000,{step:'iron',job:{type:'gather'}},none,{foodBar:11,defending:'active'}),false);
});

test('round 117: Mob Defense is on while its chain runs or a job it preempted is paused',()=>{
 const ap=Object.create(Autopilot.prototype);
 const at=(chain,jobs=[])=>{ap.worker={taskRunner:{status:()=>({running:true,chain,task:null})},jobs};return ap.mobDefenseOn();};
 assert.equal(at('Mob Defense'),'active');
 assert.equal(at(null,[{status:'paused',message:'Reflex: preempted by Mob Defense'}]),'paused a job');
 assert.equal(at(null,[{status:'paused',message:'Reflex: preempted by Misc World Survival Chain'}]),null);
 assert.equal(at(null,[{status:'cancelled',message:'Reflex: preempted by Mob Defense'}]),null,'only a paused job');
 assert.equal(at('User Tasks'),null);
 assert.equal(at(null),null);
 ap.worker={jobs:[]};assert.equal(ap.mobDefenseOn(),null,'no task runner');
});

// decide() at the hard3 moment: stone kit and furnace held, no food, a pig in range, food 11.
function setup({chain=null,jobs=[]}={}){
 const logs=[],subs=[];
 const inv={wooden_pickaxe:1,stone_pickaxe:1,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1,crafting_table:1,cobblestone:40,stick:4,cherry_planks:8,dirt:20};
 const items=Object.entries(inv).map(([name,count])=>({name,count}));
 const bot={entity:{position:new Vec3(822.5,81,-584.5),velocity:new Vec3(0,0,0)},health:14,food:11,time:{day:5,timeOfDay:1000},entities:{},
  inventory:{items:()=>items,slots:[]},registry:{blocksByName:{},itemsByName:{}},findBlock:()=>null,findBlocks:()=>[],blockAt:()=>({name:'air',skyLight:15})};
 const w={bot,jobs,log:m=>logs.push(m),taskRunner:{status:()=>({running:true,chain,task:null})},config:{limits:{minHealth:10}}};
 const ap=Object.create(Autopilot.prototype);
 Object.assign(ap,{worker:w,log:m=>logs.push(m),submit:(step,spec)=>subs.push([step,spec]),state:'',lastSurfaceY:83,failures:{},huntPhase:false,food:{},heal:{},
  counts:()=>({...inv}),animalsNearby:()=>({type:'pig',close:1})});
 return {ap,bot,logs,subs};
}

test('round 117: decide sends no pig fight while Mob Defense flees, and sends it once Mob Defense is idle',()=>{
 const idle=setup();
 idle.ap.decide(idle.bot);
 assert.deepEqual(idle.subs.map(([s,j])=>[s,j.type]),[['food','fight']],idle.logs.join('\n'));
 for(const [chain,jobs,why] of [['Mob Defense',[],'active'],[null,[{id:4,status:'paused',spec:{type:'fight',entity:'pig'},message:'Reflex: preempted by Mob Defense'}],'paused a job']]){
  const s=setup({chain,jobs});
  s.ap.decide(s.bot);
  assert.ok(!s.subs.some(([st])=>st==='food'),why+': '+JSON.stringify(s.subs));
  // the ladder moves on to a step that does not walk to the animals (here the stone kit's craft)
  assert.deepEqual(s.subs,[['iron',{type:'craft',item:'stone_pickaxe',count:1}]],why);
  assert.equal(s.ap.state,'mob defense: no hunting');
  assert.ok(s.logs.includes('Autopilot: mob defense: no hunting (Mob Defense '+why+'; 0 hostiles within 16)'),s.logs.join('\n'));
 }
});
