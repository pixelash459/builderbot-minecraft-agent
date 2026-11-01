import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,lavaGuard,lavaHeld,NO_AVOID_NEAR} from '../src/worker.js';
import {inLava} from '../src/tasks/movement/escape-from-lava-task.js';
import {FoodChain} from '../src/chains/foodChain.js';
import {waterBank,WATER_BANK} from '../src/autopilot.js';
import {GetOutOfWaterTask,POCKET_FAR} from '../src/tasks/movement/get-out-of-water-task.js';

// Round 82: the round-81 soak on the Nitrous world copy.
const AIR={name:'air',boundingBox:'empty'},STONE={name:'stone',boundingBox:'block'},LAVA={name:'lava',boundingBox:'empty'},WATER={name:'water',boundingBox:'empty'};
test('round 82: the lava guard and its hold stand aside for the escape with the lava under the feet',()=>{
 // round-81 hard2: feet and head in air at (830, 73, -538), the pool at y=72 under them and ahead
 const ctl={forward:true,sprint:true,jump:true};
 const bot={entity:{position:new Vec3(830.5,73.2,-537.5),velocity:new Vec3(0.2,0,-0.1),onGround:false},
  pathfinder:{isMoving:()=>false},getControlState:k=>!!ctl[k],setControlState:(k,v)=>{ctl[k]=v;},
  blockAt:p=>{const f=p.floored?p.floored():p;return {...(f.y===72&&f.x>=829&&f.x<=832?LAVA:f.y<72?STONE:AIR),position:f};}};
 assert.equal(inLava(bot),true,'the escape runs here');
 assert.equal(lavaGuard(bot),null,'no stop');
 assert.equal(ctl.forward,true);assert.equal(ctl.jump,true);assert.equal(ctl.sprint,true);
 bot._lavaHold={x:831.5,z:-538.5,until:Date.now()+1500};
 assert.equal(lavaHeld(bot,'jump'),false,'the escape jumps');
 assert.equal(lavaHeld(bot,'forward'),false);
 // on the ground beside the pool the guard still stops a walk toward it
 bot.entity.position=new Vec3(828.5,73,-537.5);bot.entity.velocity=new Vec3(0.2,0,0);bot.entity.onGround=true;
 bot.blockAt=p=>{const f=p.floored?p.floored():p;return {...(f.x>=829&&f.y===72?LAVA:f.y<=72?STONE:AIR),position:f};};
 assert.equal(inLava(bot),false);
 assert.ok(lavaGuard(bot));assert.equal(ctl.forward,false);
 assert.equal(lavaHeld(bot,'jump'),true,'held as before');
});
test('round 82: no meal with the head under water, not even a critical one',()=>{
 const f=new FoodChain();
 const bot=(eye)=>({food:6,health:3,entity:{position:new Vec3(776.5,47,-612.5)},inventory:{items:()=>[]},
  blockAt:p=>({...(Math.floor(p.y)===48?eye:STONE),position:p})});
 assert.equal(f.deferReason(bot(WATER),{worker:{jobs:[]}}),'the head is under water');
 assert.equal(f.deferReason(bot({name:'oak_slab',boundingBox:'block',isWaterlogged:true}),{worker:{jobs:[]}}),'the head is under water');
 assert.equal(f.deferReason(bot(AIR),{worker:{jobs:[]}}),null,'the head out: a critical meal goes ahead');
});
test('round 82: a bucket source needs a dry bank beside it',()=>{
 assert.equal(WATER_BANK,2);
 const src=new Vec3(776,49,-615);
 // round-81 normal3: a flooded tunnel - water round the source, stone walls and roof
 const tunnel=p=>({...(p.y===49&&Math.abs(p.z+615)<=1&&p.x>=774&&p.x<=778?WATER:p.y===50&&p.x===776&&p.z===-615?AIR:STONE),position:p});
 assert.equal(waterBank(tunnel,src),null);
 // a bank: stone at y=49 two east, air for the body and the head above it
 const bank=p=>p.x===778&&p.z===-615&&(p.y===50||p.y===51)?{...AIR,position:p}:p.x===778&&p.z===-615&&p.y===49?{...STONE,position:p}:tunnel(p);
 assert.deepEqual(waterBank(bank,src),new Vec3(778,50,-615));
 // a bank whose ground is waterlogged is not dry
 const wet=p=>p.x===778&&p.z===-615&&p.y===49?{name:'oak_slab',boundingBox:'block',isWaterlogged:true,position:p}:bank(p);
 assert.equal(waterBank(wet,src),null);
});
test('round 82: the far air search coming up empty is logged once, with what the bot does instead',async()=>{
 const logs=[],controls={};
 // a flooded corridor under a waterlogged slab cover with no edge in reach: no air, no land
 const at=p=>{const x=Math.floor(p.x),y=Math.floor(p.y),z=Math.floor(p.z),pos=new Vec3(x,y,z);
  if(z===-446&&x>=800&&x<=880&&(y===100||y===101))return {...WATER,position:pos};
  if(z===-446&&x>=800&&x<=880&&y===102)return {name:'cherry_slab',boundingBox:'block',isWaterlogged:true,position:pos};
  return {name:'cherry_planks',boundingBox:'block',position:pos};};
 const b={entity:{position:new Vec3(837.5,100,-445.5),isInWater:true,onGround:false},oxygenLevel:8,blockAt:at,heldItem:null,
  setControlState:(n,v)=>{controls[n]=v;},clearControlStates(){},digTime:()=>75000,dig:async()=>{},stopDigging(){},lookAt:async()=>{},
  pathfinder:{stop(){},setGoal(){},movements:null,goto:async()=>{throw Error('no path');},setMovements(){}}};
 const ctx={bot:b,worker:{controlToken:1,epoch:1,log:m=>logs.push(m)}};
 const t=new GetOutOfWaterTask({ctx});t.onStart(b,ctx);t.onTick(b,ctx);
 await new Promise(r=>setImmediate(r));
 assert.match(logs.at(-1),/would take 75\.0 s to dig under water/);
 t.onTick(b,ctx);
 assert.equal(logs.at(-1),'WorldSurvival: no air within '+POCKET_FAR+' cells through the water (air 8); no land within 16 either');
 const n=logs.length;t.searchedAt=0;t.onTick(b,ctx);assert.equal(logs.length,n,'once');
});
test('round 82: the no-avoidance retry line is logged once per area, not per stair cell',async()=>{
 assert.equal(NO_AVOID_NEAR,4);
 const logs=[];let t=1e9;const real=Date.now;Date.now=()=>t;
 try{
  const mv={exclusionAreasStep:[],_mobAvoidHook:null};
  const w=Object.assign(Object.create(Worker.prototype),{log:m=>logs.push(m),navigate:async()=>{},
   bot:{entity:{position:new Vec3(829.5,76,-544.5)},pathfinder:{movements:mv}}});
  // round-81 hard1: the night-mine climb home, a new stair cell each 0.5 s
  for(let i=0;i<4;i++){w.bot.entity.position=new Vec3(829.5,76+i,-544.5-i);await w.navigateNoAvoid({},0,10);t+=500;}
  assert.equal(logs.length,1);
  // 5 stairs on from the first line: a new area
  w.bot.entity.position=new Vec3(829.5,81,-549.5);await w.navigateNoAvoid({},0,10);
  assert.equal(logs.length,2);assert.equal(logs[1],'Navigation: no path with mob avoidance at (829, 81, -550); trying without it');
 }finally{Date.now=real;}
});
