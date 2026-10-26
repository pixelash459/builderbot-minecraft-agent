import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {GetOutOfWaterTask,waterAbove,headUnderWater} from '../src/tasks/movement/get-out-of-water-task.js';
// A column: water from y=40 to top-1, then `cap` at y=top (air or stone); stone everywhere else.
function bot({top=50,cap='air',air=6,y=40}={}){
 const controls={},dug=[];
 const at=p=>{const x=Math.floor(p.x),yy=Math.floor(p.y),z=Math.floor(p.z);
  if(x===0&&z===0){if(yy>=40&&yy<top)return {name:'water',boundingBox:'empty',position:new Vec3(x,yy,z)};if(yy===top)return {name:cap,boundingBox:cap==='air'?'empty':'block',position:new Vec3(x,yy,z)};if(yy>top)return {name:'air',boundingBox:'empty',position:new Vec3(x,yy,z)};}
  return {name:'stone',boundingBox:'block',position:new Vec3(x,yy,z)};};
 const b={entity:{position:new Vec3(0.5,y,0.5),isInWater:true,onGround:false},oxygenLevel:air,oxygenMaximum:20,blockAt:at,
  setControlState:(n,v)=>{controls[n]=v;},clearControlStates(){},dig:async bl=>{dug.push(bl.position.y);},
  pathfinder:{stop(){},setGoal(){},movements:null,goto:async()=>{throw Error('no path');},setMovements(){}}};
 return {b,controls,dug};
}
const ctx=b=>({bot:b,worker:{controlToken:1,epoch:1,log(){} }});
test('swim up: the water column over the head is measured',()=>{
 const {b}=bot({top:50});
 assert.ok(headUnderWater(b));
 assert.deepEqual(waterAbove(b,24),{open:9},'head y=41, air at 50');
 const r=bot({top:43,cap:'stone'});assert.equal(waterAbove(r.b,24).dy,2,'head y=41, stone at 43');
});
test('swim up: low air under open water goes straight up, no sideways leg',()=>{
 const {b,controls}=bot({top:50,air:6});
 const t=new GetOutOfWaterTask({ctx:ctx(b)});t.onStart(b,ctx(b));t.onTick(b,ctx(b));
 assert.equal(controls.jump,true);assert.equal(controls.forward,false);
 assert.equal(t.navPromise,null,'no land leg while the way up is open');
});
test('swim up: a stone roof right over the head is dug',async()=>{
 const {b,dug}=bot({top:42,cap:'stone',air:5});
 const t=new GetOutOfWaterTask({ctx:ctx(b)});t.onStart(b,ctx(b));t.onTick(b,ctx(b));
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(dug,[42]);
});
test('swim up: the air reading no longer gates it; a head above the water keeps the land search',()=>{
 const t0=bot({top:50,air:267});const t1=new GetOutOfWaterTask({ctx:ctx(t0.b)});t1.onStart(t0.b,ctx(t0.b));t1.onTick(t0.b,ctx(t0.b));
 assert.equal(t1.upLogged,true,'ticks-scale 267 (17.8) under water: straight up');
 const {b}=bot({top:42,air:20,y:40.5});
 const t=new GetOutOfWaterTask({ctx:ctx(b)});t.onStart(b,ctx(b));t.onTick(b,ctx(b));
 assert.equal(t.upLogged,undefined);
});
