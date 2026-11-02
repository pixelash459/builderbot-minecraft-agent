import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {sinkGuard,SINK_MS} from '../src/worker.js';
import {GetOutOfWaterTask,riseBlockedCentre,NO_RISE_MS} from '../src/tasks/movement/get-out-of-water-task.js';
import {RunAwayFromCreepersTask} from '../src/chains/fallbackTasks.js';

// Round 87: the round-86 soak on the Nitrous world copy (hard3 drowned on a cell corner under a neighbouring roof).
// Four water columns x,z in {0,1}, the floor at y=59: an open column holds water at y 60-62 with
// air from 63; a roofed column holds water at y 60-61 under stone at 62.
function corner(roofed,pos){
 const controls={},looks=[];
 const at=p=>{const x=Math.floor(p.x),y=Math.floor(p.y),z=Math.floor(p.z),position=new Vec3(x,y,z);
  if(x<0||x>1||z<0||z>1||y<60)return {name:'stone',boundingBox:'block',position};
  if(roofed(x,z)?y>=62:false)return {name:'stone',boundingBox:'block',position};
  if(y>=63)return {name:'air',boundingBox:'empty',position};
  return {name:'water',boundingBox:'empty',position};};
 const bot={entity:{position:pos,isInWater:true,onGround:false},oxygenLevel:6,blockAt:at,
  getControlState:k=>!!controls[k],setControlState:(k,v)=>{controls[k]=v;},clearControlStates(){},
  lookAt:async v=>{looks.push(v);},dig:async()=>{},
  pathfinder:{isMoving:()=>false,stop(){},setGoal(){},movements:null,goto:async()=>{throw Error('no path');},setMovements(){}}};
 return {bot,controls,looks};
}
const eastRoof=x=>x===1;
function withClock(fn){const real=Date.now;const clock={t:real()};Date.now=()=>clock.t;try{return fn(clock);}finally{Date.now=real;}}

test('round 87: the body over a corner under a neighbouring roof - the centre of the open column',()=>{
 const c=p=>{const r=riseBlockedCentre(corner(eastRoof,p).bot);return r&&[r.x,r.z];};
 assert.deepEqual(c(new Vec3(0.95,60,0.5)),[0.5,0.5],'0.25 of the body under the roof east');
 assert.deepEqual(c(new Vec3(1.05,60,0.5)),[0.5,0.5],'floored into the roofed column: the open one west');
 assert.equal(c(new Vec3(0.5,60,0.5)),null,'inside its own column');
 assert.equal(c(new Vec3(0.65,60,0.5)),null,'touching the edge, not over it');
 assert.equal(riseBlockedCentre(corner(()=>false,new Vec3(0.95,60,0.95)).bot),null,'no roof anywhere');
 assert.equal(riseBlockedCentre(corner(()=>true,new Vec3(0.95,60,0.5)).bot),null,'every overlapped column roofed: left to the pocket search');
 const d=riseBlockedCentre(corner((x,z)=>x===1&&z===1,new Vec3(0.95,60,0.95)).bot);
 assert.deepEqual([d.x,d.z],[0.5,0.5],'over all four columns, only (1, 1) roofed');
});

test('round 87: swimming straight up from a corner steps into the open column first, then rises straight',()=>withClock(clock=>{
 const {bot,controls,looks}=corner(eastRoof,new Vec3(0.95,60,0.5)),logs=[];
 const ctx={bot,worker:{controlToken:1,epoch:1,log:m=>logs.push(m)}};
 const task=new GetOutOfWaterTask({ctx});task.onStart(bot,ctx);
 task.onTick(bot,ctx);
 assert.equal(controls.jump,true);assert.equal(controls.forward,true,'stepping west');
 assert.ok(looks.at(-1).x===0.5&&looks.at(-1).z===0.5,'looking at the open column centre');
 assert.equal(logs[0],'WorldSurvival: the body at (0, 60, 0) is under a roof beside the column; centring to (0, 0) to swim up');
 assert.match(logs[1],/^WorldSurvival: open water 2 up/);
 bot.entity.position=new Vec3(0.55,60,0.5);clock.t+=300;task.onTick(bot,ctx);
 assert.equal(controls.forward,false,'in the column: straight up');
 assert.equal(logs.filter(m=>/centring/.test(m)).length,1,'said once');
}));

test('round 87: a corner flip between two open columns no longer restarts the no-rise clock',()=>withClock(clock=>{
 // (0, 0) and (1, 0) open, the z=1 row roofed; the bot pinned at the corner, the floored x flipping
 const {bot}=corner((x,z)=>z===1,new Vec3(0.98,60,0.95)),logs=[];
 const ctx={bot,worker:{controlToken:1,epoch:1,log:m=>logs.push(m)}};
 const task=new GetOutOfWaterTask({ctx});task.onStart(bot,ctx);
 for(let i=0;i<20;i++){bot.entity.position=new Vec3(i%2?1.02:0.98,60,0.95);task.upAt=0;task.onTick(bot,ctx);clock.t+=200;}
 assert.ok(logs.some(m=>/^WorldSurvival: no rise in 3 s swimming up/.test(m)),logs.join('\n'));
 // a real rise still restarts it
 const r=corner((x,z)=>z===1,new Vec3(0.98,60,0.95)),rl=[];const rc={bot:r.bot,worker:{controlToken:1,epoch:1,log:m=>rl.push(m)}};
 const rt=new GetOutOfWaterTask({ctx:rc});rt.onStart(r.bot,rc);
 for(let i=0;i<5;i++){r.bot.entity.position=new Vec3(i%2?1.02:0.98,60+0.6*i,0.5);rt.upAt=0;rt.onTick(r.bot,rc);clock.t+=NO_RISE_MS/2;}
 assert.ok(!rl.some(m=>/no rise/.test(m)));
}));

test('round 87: the sink guard steps a corner-pinned body into the open column, only with no path steering',()=>{
 const {bot,controls,looks}=corner(eastRoof,new Vec3(0.95,60,0.5)),st={};
 assert.equal(sinkGuard(bot,st,0),null);
 const line=sinkGuard(bot,st,SINK_MS);
 assert.match(line,/^Water: head under for 8 s at \(0, 60, 0\) with no swim-up; holding jump .*\); centring to \(0, 0\) off a roof beside the column$/);
 assert.equal(controls.jump,true);assert.equal(controls.forward,true);
 assert.ok(looks.at(-1).x===0.5&&looks.at(-1).z===0.5);
 bot.entity.position=new Vec3(0.5,60,0.5);
 assert.equal(sinkGuard(bot,st,SINK_MS+50),null);
 assert.equal(controls.forward,false,'centred: let go of forward');
 bot.blockAt=p=>({name:'air',boundingBox:'empty',position:p});bot.oxygenLevel=20;
 sinkGuard(bot,st,SINK_MS+100);
 assert.equal(controls.jump,false);assert.equal(controls.forward,false);
 // pinned already when the line is said: a second line names the centring
 const late=corner(eastRoof,new Vec3(0.5,60,0.5)),ls={};
 sinkGuard(late.bot,ls,0);assert.doesNotMatch(sinkGuard(late.bot,ls,SINK_MS),/centring/);
 late.bot.entity.position=new Vec3(0.95,60,0.5);
 assert.equal(sinkGuard(late.bot,ls,SINK_MS+50),'Water: the body at (0, 60, 0) is under a roof beside the column; centring to (0, 0)');
 assert.equal(sinkGuard(late.bot,ls,SINK_MS+100),null,'once');
 // a path steering the bot is left alone
 const nav=corner(eastRoof,new Vec3(0.95,60,0.5)),ns={};nav.bot.pathfinder.isMoving=()=>true;
 sinkGuard(nav.bot,ns,0);sinkGuard(nav.bot,ns,SINK_MS);
 assert.equal(nav.controls.jump,true);assert.notEqual(nav.controls.forward,true);
});

test('round 87: the fuse wall says how it ended - blocks placed, cells standing, the block held',async()=>{
 const real=Date.now,clock={t:real()};Date.now=()=>clock.t;
 try{
  const k=(x,y,z)=>x+','+y+','+z,cells=new Map();
  for(let x=-6;x<=6;x++){cells.set(k(x,44,0),'stone');cells.set(k(x,47,0),'stone');for(const y of [45,46]){cells.set(k(x,y,1),'stone');cells.set(k(x,y,-1),'stone');}}
  const logs=[],creeper={id:9,name:'creeper',type:'hostile',isValid:true,height:1.7,position:new Vec3(2.5,45,0.5),metadata:{16:1}};
  const bot={entity:{position:new Vec3(0.5,45,0.5),height:1.8},entities:{9:creeper},heldItem:{name:'dirt'},food:16,health:20,
   inventory:{items:()=>[{name:'dirt',count:12,slot:36}]},
   blockAt:p=>{const name=cells.get(k(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)))||'air';return {name,position:new Vec3(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)),boundingBox:name==='air'?'empty':'block'};},
   equip:async()=>{},placeBlock:async(ref,face)=>{const q=ref.position.plus(face);cells.set(k(q.x,q.y,q.z),'dirt');},
   setControlState(){},look:async()=>{}};
  const ctx={worker:{log:m=>logs.push(m),shelterSpot:null},bot};
  const task=new RunAwayFromCreepersTask(7,{fuse:true});
  for(let i=0;i<36;i++){clock.t+=50;task.onTick(bot,ctx);await null;}
  creeper.metadata={16:-1};task.onTick(bot,ctx);task.onTick(bot,ctx);
  assert.deepEqual(logs,['Reflex: creeper fuse at 2.0 and the flee is not moving the bot; walling 2 cell(s) toward it',
   'Reflex: the fuse wall is done: 2 block(s) placed, 2 of 2 cell(s) standing (held dirt 12)']);
 }finally{Date.now=real;}
});
