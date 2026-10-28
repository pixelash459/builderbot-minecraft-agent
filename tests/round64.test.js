import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {GetOutOfWaterTask,airPocket,POCKET_MAX} from '../src/tasks/movement/get-out-of-water-task.js';
import {Worker,floodedAround,FLOODED_MS} from '../src/worker.js';

// Round 64: the round-63 soak on seed 20261027.
// A flooded room: water at y=40-41 from x=0 to x=3 (z=0), stone roof at y=42 except an air cell
// over x=`open` (none when open is null); stone everywhere else.
function cave(open=2){
 const controls={},dug=[],looks=[];
 const at=p=>{const x=Math.floor(p.x),y=Math.floor(p.y),z=Math.floor(p.z),pos=new Vec3(x,y,z);
  if(z===0&&x>=0&&x<=3&&(y===40||y===41))return {name:'water',boundingBox:'empty',position:pos};
  if(z===0&&open!=null&&x===open&&y>=42)return {name:'air',boundingBox:'empty',position:pos};
  return {name:'stone',boundingBox:'block',position:pos};};
 const b={entity:{position:new Vec3(0.5,39.6,0.5),isInWater:true,onGround:false},oxygenLevel:6,blockAt:at,
  setControlState:(n,v)=>{controls[n]=v;},clearControlStates(){},dig:async bl=>{dug.push(bl.position.toString());},
  lookAt:async v=>{looks.push(v);},
  pathfinder:{stop(){},setGoal(){},movements:null,goto:async()=>{throw Error('no path');},setMovements(){}}};
 return {b,controls,dug,looks};
}
const ctx=b=>({bot:b,worker:{controlToken:1,epoch:1,log(){} }});
test('round 64: under a stone roof with air two cells over, the bot swims to it and does not dig',async()=>{
 const {b,controls,dug,looks}=cave(2);
 const pk=airPocket(b);
 assert.ok(pk,'found');assert.equal(pk.cell.toString(),new Vec3(2,42,0).toString());assert.equal(pk.steps,3);
 const t=new GetOutOfWaterTask({ctx:ctx(b)});t.onStart(b,ctx(b));t.onTick(b,ctx(b));
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(dug,[],'no roof dig');
 assert.equal(controls.forward,true);assert.equal(controls.jump,true);
 assert.ok(looks[0]&&looks[0].x===1.5&&looks[0].y===41.5,'toward the next water cell east');
});
test('round 64: no air within reach - the roof over the head is still dug',async()=>{
 const {b,dug}=cave(null);
 assert.equal(airPocket(b),null);
 const t=new GetOutOfWaterTask({ctx:ctx(b)});t.onStart(b,ctx(b));t.onTick(b,ctx(b));
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(dug,[new Vec3(0,42,0).toString()]);
 assert.equal(POCKET_MAX,8);
});
test('round 64: a furnace in water the bot just escaped is left, not walked back to',async()=>{
 const wet=new Set(['-155,44,97']);
 const b={blockAt:p=>({name:wet.has(p.x+','+p.y+','+p.z)?'water':'stone'})};
 assert.equal(floodedAround(b,new Vec3(-156,44,97)),true);
 assert.equal(floodedAround(b,new Vec3(-160,44,97)),false);
 const w=Object.create(Worker.prototype),logs=[];let walked=false;
 Object.assign(w,{bot:b,log:m=>logs.push(m),lastDrownAt:Date.now()-60000,walkToFurnace:async()=>{walked=true;},
  furnaceRun:{x:-156,y:44,z:97,item:'raw_iron',output:'iron_ingot',count:3}});
 await assert.rejects(w.takeSmelt({spec:{}},1),/flooded ground/);
 assert.equal(walked,false);assert.equal(w.furnaceRun,null);
 assert.ok(/^Smelt: the furnace at -156,44,97 stands in water the bot just escaped/.test(logs[0]),logs[0]);
 w.furnaceRun={x:-156,y:44,z:97,item:'raw_iron',output:'iron_ingot',count:3};w.lastDrownAt=Date.now()-FLOODED_MS-1000;
 await w.takeSmelt({spec:{}},1).catch(()=>{});
 assert.equal(walked,true,'long after the escape the take goes ahead');
});
