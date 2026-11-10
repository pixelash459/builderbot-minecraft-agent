// Round 10, habit 12: know which mobs to leave alone - a calm enderman, a spider in daylight.
// Creepers (never melee) and witches (backed away from) keep their own rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {leaveAlone,getHostiles,LEAVE_ALONE_CLOSE} from '../src/chains/combatPolicy.js';
import {MobDefenseChain} from '../src/chains/mobDefenseChain.js';
const mob=(name,x,extra={})=>({name,type:'hostile',position:new Vec3(x,64,0),isValid:true,height:name==='enderman'?2.9:0.9,...extra});
function bot({tod=6000,sky=15,entities=[]}={}){
 const b={entity:{position:new Vec3(0,64,0)},time:{timeOfDay:tod},health:20,food:20,
  blockAt:()=>({name:'air',boundingBox:'empty',skyLight:sky}),inventory:{items:()=>[{name:'iron_sword',count:1}]},entities:{}};
 entities.forEach((e,i)=>{b.entities[i+1]=e;});
 return b;
}
test('leaveAlone: a calm enderman at any distance (round 113), but not an angry one',()=>{
 const b=bot();
 assert.equal(leaveAlone(mob('enderman',6),b),true);
 const angry=mob('enderman',6);angry.metadata=[];angry.metadata[17]=true;
 assert.equal(leaveAlone(angry,b),false,'screaming: it is coming');
 assert.equal(leaveAlone(mob('enderman',LEAVE_ALONE_CLOSE),b),true,'round 113: a calm one beside the bot is still harmless - a hit provokes it');
 assert.equal(leaveAlone(mob('enderman',0.5),b),true);
});
test('leaveAlone: a spider in daylight, never at night, in the dark or a cave spider',()=>{
 assert.equal(leaveAlone(mob('spider',6),bot()),true);
 assert.equal(leaveAlone(mob('spider',6),bot({tod:14000})),false,'night');
 assert.equal(leaveAlone(mob('spider',6),bot({sky:4})),false,'a cave');
 assert.equal(leaveAlone(mob('cave_spider',6),bot()),false);
 assert.equal(leaveAlone(mob('zombie',6),bot()),false);
 assert.equal(leaveAlone(mob('creeper',6),bot()),false,'creepers keep their own (flee) rule');
});
test('getHostiles leaves the neutral ones out; Mob Defense ignores a calm enderman beside it',()=>{
 const b=bot({entities:[mob('enderman',4),mob('spider',5),mob('zombie',30)]});
 assert.deepEqual(getHostiles(b,{}).map(e=>e.name),['zombie']);
 const calm=bot({entities:[mob('enderman',3)]});
 const chain=new MobDefenseChain();
 assert.equal(chain.priority(calm,{config:{chains:{}},trackers:{},move:{}}),-1,'no fight, no flee');
 const angry=mob('enderman',3);angry.metadata=[];angry.metadata[17]=true;
 const a=bot({entities:[angry]});
 assert.ok(new MobDefenseChain().priority(a,{config:{chains:{}},trackers:{},move:{}})>0,'an angry one is answered');
});
