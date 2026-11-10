import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {WorldSurvivalChain,FIRE_WATER_NEAR,nearWater} from '../src/chains/worldSurvivalChain.js';
console.error=()=>{};

// Round 115: the round-114 hard2 death - set alight by a burning zombie with no water bucket, the
// walk to any water within 48 outranked the flee at 90, the bot stood 4.6 s and was killed. With
// no bucket the walk to water runs only for water within FIRE_WATER_NEAR (or after lava).
function bot({fire=true,water=null,inventory=[],lava=false}){
 const logs=[];
 const b={version:'1.21.4',health:12,food:20,oxygen:20,oxygenMax:20,time:{timeOfDay:1000},
  entity:{id:1,position:new Vec3(0.5,64,0.5),velocity:new Vec3(0,0,0),onGround:true,isInLava:lava,isInWater:false,metadata:[fire?1:0],height:1.8},
  entities:{},inventory:{items:()=>inventory.map(name=>({name,count:1})),slots:[]},heldItem:null,
  registry:{blocksByName:{water:{id:9}}},
  blockAt:()=>null,
  // findBlock honours maxDistance like mineflayer
  findBlock:q=>{if(!water)return null;const at=new Vec3(...water);const blk={name:'water',position:at};
   return at.distanceTo(b.entity.position)<=(q.maxDistance??16)&&q.matching(blk)?blk:null;}};
 const ctx={config:{chains:{}},move:{},trackers:{},blacklist:{},worker:{log:m=>logs.push(m)}};
 return {b,ctx,logs};
}

test('round 115: on fire with no bucket and water 30 away, the chain does not take the bot to it',()=>{
 assert.equal(FIRE_WATER_NEAR,8);
 const w=new WorldSurvivalChain();
 const {b,ctx,logs}=bot({water:[30,63,0]});
 assert.equal(w.priority(b,ctx),-1,'the flee or the fight keeps the bot');
 assert.notEqual(w.root?.name,'GetToBlockTask');
 assert.deepEqual(logs,['WorldSurvival: on fire with no water bucket and no water within 8 (health 12); not leaving for water, it burns out']);
 w.priority(b,ctx);assert.equal(logs.length,1,'once a burn');
 // the fire goes out, then a new burn logs again
 b.entity.metadata=[0];w.priority(b,ctx);b.entity.metadata=[1];w.priority(b,ctx);
 assert.equal(logs.length,2);
});

test('round 115: water within 8, a lava exit and a water bucket still put the fire out',()=>{
 const near=new WorldSurvivalChain();
 const n=bot({water:[5,63,0]});
 assert.equal(near.priority(n.b,n.ctx),90);
 assert.equal(near.root.name,'GetToBlockTask');
 assert.match(n.logs[0],/^WorldSurvival: on fire with no water bucket; walking to the water 4\.6 away$/);
 assert.ok(nearWater(n.b));assert.equal(nearWater(bot({water:[9,64,0]}).b),null);
 // just out of lava (the 4 s window), no fire bit, water far: walk to it anyway
 const lv=new WorldSurvivalChain();
 const l=bot({fire:false,water:[30,63,0]});
 lv._lavaUntil=lv.now()+3;
 assert.equal(lv.priority(l.b,l.ctx),90);assert.equal(lv.root.name,'GetToBlockTask');
 assert.match(l.logs[0],/out of lava, walking to water/);
 // a water bucket: the douse, whatever the distance
 const bk=new WorldSurvivalChain();
 const k=bot({water:null,inventory:['water_bucket']});
 assert.equal(bk.priority(k.b,k.ctx),90);assert.equal(bk.root.name,'ExtinguishWithWaterTask');
 // not burning: nothing
 const q=new WorldSurvivalChain();
 assert.equal(q.priority(bot({fire:false,water:[3,63,0]}).b,bot({}).ctx),-1);
});

test('round 115: a walk to water that falls out of range mid-burn is dropped',()=>{
 const w=new WorldSurvivalChain();
 const s=bot({water:[6,63,0]});
 assert.equal(w.priority(s.b,s.ctx),90);assert.equal(w.root.name,'GetToBlockTask');
 s.b.entity.position=new Vec3(-10.5,64,0.5); // the flee carried it 16 from the water
 assert.equal(w.priority(s.b,s.ctx),-1);
 assert.equal(w.root,null);
});
