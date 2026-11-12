import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {fleeJump} from '../src/night.js';
import {RunAwayFromHostilesTask,RunAwayFromCreepersTask} from '../src/chains/fallbackTasks.js';
console.error=()=>{};

// Round 119: the round-118 soak's one death - hard3 at dawn in the spawn river, unarmed, fleeing a
// crowd with drowned in the water. The flee never pressed jump in water (round 109: "the swim has its
// own jump", but that rescue comes only after 8 s with the head under), so the bot sank to the
// riverbed at y=57, 5 under the surface, and ran into the stone banks: 13 `no headway` lines and 5
// `head under for 8 s` rescues in three minutes, then the drowned killed it in the water.
const S={name:'stone',boundingBox:'block'},A={name:'air',boundingBox:'empty'},W={name:'water',boundingBox:'empty'};
// a river: stone bed at y=56, water y=57..61, air above; stone banks for |z|>=3 up to y=62
function river(extra={}){
 return (x,y,z)=>{const c=extra[x+','+y+','+z];if(c)return c;
  if(y<=56)return S;if(Math.abs(z)>=3)return y<=62?S:A;return y<=61?W:A;};
}
function fleeBot(at,{pos=new Vec3(0.5,57,0.5),mobs=[['drowned',-4.5,57,0.5]],isInWater=true}={}){
 const keys={},entities={};
 mobs.forEach(([name,x,y,z],i)=>{entities[10+i]={id:10+i,name,type:'hostile',position:new Vec3(x,y,z),isValid:true,height:1.95};});
 return {keys,entity:{position:pos,onGround:false,isInWater,velocity:new Vec3(0,0,0)},health:10.5,food:20,entities,
  inventory:{items:()=>[],slots:[]},registry:{foodsByName:{}},time:{timeOfDay:200},
  setControlState:(k,v)=>{keys[k]=v;},getControlState:k=>!!keys[k],look:async()=>{},
  blockAt:p=>{const b=at(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z));return {...b,position:p.floored(),skyLight:15};}};
}
const ctx={config:{chains:{}},worker:{log:()=>{}}};

test('round 119: fleeing through water the bot holds jump - it swims at the surface instead of walking the riverbed',()=>{
 assert.equal(fleeJump(river(),new Vec3(0.5,57,0.5),{x:1,z:0,blocked:false},{sprint:true,inWater:true}),true);
 assert.equal(fleeJump(river(),new Vec3(0.5,57,0.5),{x:1,z:0,blocked:true},{inWater:true}),true,'blocked or not');
 // the hard3 shape: on the bed, head under, a drowned 5 to the west
 const b=fleeBot(river()),t=new RunAwayFromHostilesTask(16);t.now=()=>0;
 t.onTick(b,ctx);
 assert.equal(b.keys.jump,true,'up toward the air');
 assert.equal(b.keys.forward,true);
 assert.ok(t.heading.x>0.5,'away from the drowned: '+JSON.stringify(t.heading));
 // Via never flips isInWater: the water in the feet and head cells is enough
 const v=fleeBot(river(),{isInWater:false}),tv=new RunAwayFromHostilesTask(16);tv.now=()=>0;
 tv.onTick(v,ctx);assert.equal(v.keys.jump,true);
 // at the surface (head in the air, feet in the water) against the bank: still jump, to climb out
 const s=fleeBot(river(),{pos:new Vec3(0.5,61,2.5),mobs:[['drowned',0.5,61,-2.5]]}),ts=new RunAwayFromHostilesTask(16);ts.now=()=>0;
 ts.onTick(s,ctx);assert.equal(s.keys.jump,true);
 // the creeper flee shares the step
 const c=fleeBot(river(),{mobs:[['creeper',-4.5,57,0.5]]}),tc=new RunAwayFromCreepersTask(16);tc.now=()=>0;
 tc.onTick(c,ctx);assert.equal(c.keys.jump,true);
});

test('round 119: every heading blocked in water - the bot stands its ground but still swims up; on land nothing changes',()=>{
 // a pool closed by stone on all four sides at the feet and the head: every heading costs a wall or
 // water - forward may go either way, jump is held
 const pool=fleeBot((x,y,z)=>{if(y<=56)return S;if(Math.abs(x)>=1||Math.abs(z)>=1)return y<=60?W:A;return y<=61?W:A;});
 const tp=new RunAwayFromHostilesTask(16);tp.now=()=>0;tp.onTick(pool,ctx);
 assert.equal(pool.keys.jump,true);
 if(tp.heading.blocked)assert.equal(pool.keys.forward,false,'blocked: no walking in');
 // dry ground: a blocked heading (water every way round the bot's dry cell) still stands with no jump
 const lake={};for(let x=-6;x<=6;x++)for(let z=-6;z<=6;z++)if(x||z)lake[x+',64,'+z]=W;
 const dry=(x,y,z)=>lake[x+','+y+','+z]||(y<=63?S:A);
 const d=fleeBot(dry,{pos:new Vec3(0.5,64,0.5),mobs:[['zombie',-4.5,64,0.5]],isInWater:false}),td=new RunAwayFromHostilesTask(16);td.now=()=>0;
 td.onTick(d,ctx);
 assert.equal(td.heading.blocked,true);assert.equal(d.keys.forward,false);assert.equal(d.keys.jump,false);
 // open dry ground keeps round 109's sprint-jump; the stop lets go of jump
 const o=fleeBot((x,y,z)=>y<=63?S:A,{pos:new Vec3(0.5,64,0.5),mobs:[['zombie',-4.5,64,0.5]],isInWater:false}),to=new RunAwayFromHostilesTask(16);to.now=()=>0;
 to.onTick(o,ctx);assert.equal(o.keys.jump,true);assert.equal(o.keys.sprint,true);
 to.onStop(o);assert.equal(o.keys.jump,false);
});
