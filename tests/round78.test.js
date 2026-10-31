import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {waterlogged,headUnderWater,airPocket,waterAbove} from '../src/tasks/movement/get-out-of-water-task.js';
import {sinkGuard} from '../src/worker.js';
import {MobDefenseChain,CREEPER_CHASE_S,CREEPER_CHASED_KEEP} from '../src/chains/mobDefenseChain.js';

// Round 78: the round-77 soak on the Nitrous world copy.
const AIR={name:'air',boundingBox:'empty'},WATER={name:'water',boundingBox:'empty'},PLANKS={name:'cherry_planks',boundingBox:'block'};
const SLAB={name:'cherry_slab',boundingBox:'block',isWaterlogged:true};
// round-77 normal2: feet at y 100.68 in a flooded hole, a waterlogged cherry-slab floor at y=102
// over x 843..845; past its edge (846, 102, -440) is open water with air above
function hole(){
 return p=>{
  if(p.y===102&&p.z===-440&&p.x>=843&&p.x<=845)return SLAB;
  if(p.y>=103)return AIR;
  if(p.x>=843&&p.x<=846&&p.z===-440&&p.y>=100&&p.y<=102)return WATER;
  return PLANKS;
 };
}
const swimmer=blocks=>({entity:{position:new Vec3(844.5,100.68,-439.5)},blockAt:p=>{const f=p.floored();const b=blocks(f);return b&&{...b,position:f};}});
test('round 78: a waterlogged block counts as water, whichever way the state is exposed',()=>{
 assert.equal(waterlogged({name:'oak_slab',isWaterlogged:true}),true);
 assert.equal(waterlogged({name:'oak_slab',getProperties:()=>({waterlogged:true,type:'top'})}),true);
 assert.equal(waterlogged({name:'oak_slab',properties:{waterlogged:'true'}}),true);
 assert.equal(waterlogged({name:'oak_slab',isWaterlogged:false}),false);
 assert.equal(waterlogged({name:'stone'}),false);
 assert.equal(waterlogged(null),false);
});
test('round 78: under a waterlogged slab the head is under water and the pocket swims round the slab',()=>{
 const bot=swimmer(hole());
 assert.equal(headUnderWater(bot),true,'the eye is in the slab cell');
 assert.deepEqual(waterAbove(bot),{roof:{...SLAB,position:new Vec3(844,102,-440)},dy:0});
 const pk=airPocket(bot);
 assert.ok(pk,'a pocket past the slab');
 assert.equal(String(pk.cell),'(846, 103, -440)');
 assert.deepEqual(pk.path.map(String),['(844, 102, -440)','(845, 102, -440)','(846, 102, -440)','(846, 103, -440)']);
 // never up through the slab itself, though the air is right above it
 assert.ok(!pk.path.some(c=>String(c)==='(844, 103, -440)'));
 // the 8 s backstop names it as water now, with no `head block ...` suffix
 const st={},keys=[],sb={...bot,entity:{...bot.entity,isInWater:true},oxygenLevel:9,setControlState:(k,v)=>keys.push(k+'='+v),getControlState:()=>false};
 assert.equal(sinkGuard(sb,st,1000),null);assert.equal(st.since,1000);
 const line=sinkGuard(sb,st,9100);
 assert.match(line,/^Water: head under for 8 s at \(844, 100, -440\) with no swim-up; holding jump \(air 9, isInWater true\)$/);
 assert.ok(keys.includes('jump=true'));
});
const creeperAt=x=>({id:9,name:'creeper',type:'hostile',position:new Vec3(x,64,0),isValid:true,metadata:{}});
function walker(){
 return {entity:{position:new Vec3(0,64,0)},entities:{},health:20,food:20,
  inventory:{items:()=>[],slots:[]},registry:{foodsByName:{}},time:{timeOfDay:1500},heldItem:null,blockAt:()=>null};
}
test('round 78: a creeper that keeps following is kept 20 away, and that flee outranks the job',()=>{
 const bot=walker(),logs=[],m=new MobDefenseChain(),ctx={config:{chains:{}},move:{},trackers:{},blacklist:{},worker:{log:x=>logs.push(x)}};
 let t=100;m.now=()=>t;
 bot.entities[9]=creeperAt(6);
 assert.equal(m.priority(bot,ctx),70);
 assert.equal(logs.at(-1),'Reflex: fleeing creeper (never melee a creeper)');
 assert.equal(m.root.distance,10);
 // round-77 hard2: the flee reaches 10, the craft would resume - the creeper is back at 8
 t+=1;bot.entities[9]=creeperAt(12);
 assert.ok(m.priority(bot,ctx)<50,'not yet a chase: 12 away is out of the flee');
 t+=CREEPER_CHASE_S;bot.entities[9]=creeperAt(8);
 assert.ok(m.priority(bot,ctx)>=55);
 assert.equal(logs.at(-1),'Reflex: a creeper has followed for 4 s; keeping '+CREEPER_CHASED_KEEP+' away');
 assert.equal(m.root.distance,CREEPER_CHASED_KEEP);
 // 14 away is still that chase, above the job's 50
 t+=0.5;bot.entities[9]=creeperAt(14);
 assert.equal(m.priority(bot,ctx),55);
 // past 20 it ends; lost for 5 s, a creeper at 14 is not chased again
 t+=0.5;bot.entities[9]=creeperAt(21);
 assert.ok(m.priority(bot,ctx)<50);
 t+=6;bot.entities[9]=creeperAt(14);
 assert.ok(m.priority(bot,ctx)<50);
});
