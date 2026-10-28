import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {CombatController} from '../src/combat.js';
import {planksFor} from '../src/autopilot.js';
import {sinkGuard,SINK_MS,installSprintHold,SPRINT_FOOD} from '../src/worker.js';
import {EventEmitter} from 'node:events';

// Round 68: the round-67 soak on the Nitrous world copy.
function bot(held){
 const ctl={};
 const sheep={id:9,name:'sheep',type:'animal',position:new Vec3(1.5,64,0.5),height:1.3,isValid:true};
 const b={health:20,food:2,entity:{id:1,position:new Vec3(0.5,64,0.5),velocity:new Vec3(0,0,0),onGround:true,height:1.8,yaw:0,pitch:0},
  entities:{9:sheep},controlState:ctl,registry:{itemsByName:{},blocksByName:{},foodsByName:{}},
  inventory:{items:()=>held?[{name:held,count:1}]:[],slots:[]},heldItem:held?{name:held}:null,
  blockAt:()=>null,setControlState:(n,v)=>{ctl[n]=v;},look:async()=>{},lookAt:async()=>{},attack:()=>{},swingArm:()=>{},
  activateItem(){},deactivateItem(){},equip:async()=>{},unequip:async()=>{}};
 return {b,sheep};
}
test('round 68: a sheep is fought with a pickaxe (or the hand) on a food fight, not avoided',()=>{
 for(const held of ['stone_pickaxe',null]){
  const {b,sheep}=bot(held);
  const c=new CombatController(b,{},{now:()=>0,allowHand:true});
  c.setTarget(sheep);c.tick();
  assert.notEqual(c.state,'avoid',String(held));
  assert.match(c.tactic.reason,/hunt: hand strikes on a passive animal/);
 }
 const {b,sheep}=bot('stone_pickaxe');
 const off=new CombatController(b,{},{now:()=>0});
 off.setTarget(sheep);off.tick();
 assert.equal(off.state,'avoid','without allowHand the 7f rule stands');
});
test('round 68: planks are named from any log, stripped included',()=>{
 assert.equal(planksFor('stripped_spruce_log'),'spruce_planks');
 assert.equal(planksFor('dark_oak_log'),'dark_oak_planks');
 assert.equal(planksFor(null),'oak_planks');
});
test('round 68: a head under water for SINK_MS holds jump and says so once; out of the water it lets go',()=>{
 const ctl={};let wet=true;
 const bot={entity:{position:new Vec3(0.5,48,0.5),isInWater:false},oxygenLevel:20,
  blockAt:()=>({name:wet?'water':'air'}),getControlState:k=>!!ctl[k],setControlState:(k,v)=>{ctl[k]=v;}};
 const st={};
 assert.equal(sinkGuard(bot,st,0),null);
 assert.equal(sinkGuard(bot,st,SINK_MS-1),null);assert.ok(!ctl.jump);
 const line=sinkGuard(bot,st,SINK_MS);
 assert.match(line,/^Water: head under for 8 s at \(0, 48, 0\) with no swim-up; holding jump \(air 20, isInWater false\)/);
 assert.equal(ctl.jump,true);
 assert.equal(sinkGuard(bot,st,SINK_MS+500),null,'once');
 wet=false;sinkGuard(bot,st,SINK_MS+1000);
 assert.equal(ctl.jump,false,'released when the head is out');
});
test('round 68: no sprint-on at or under the sprint food floor (no key flip, no packets)',()=>{
 const ctl={sprint:false},writes=[];
 const bot=Object.assign(new EventEmitter(),{food:SPRINT_FOOD,entity:{onGround:true},pathfinder:{isMoving:()=>true},
  getControlState:k=>!!ctl[k],setControlState:(k,v)=>{if(ctl[k]!==v)writes.push(k+'='+v);ctl[k]=v;}});
 installSprintHold(bot);
 for(let i=0;i<5;i++){bot.setControlState('sprint',true);bot.setControlState('sprint',false);}
 assert.deepEqual(writes,[],'hungry: never on');
 bot.food=20;bot.setControlState('sprint',true);
 assert.deepEqual(writes,['sprint=true']);
});
