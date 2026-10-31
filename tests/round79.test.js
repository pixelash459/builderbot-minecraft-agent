import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Vec3} from 'vec3';
import {GetOutOfWaterTask,roofDigMs,POCKET_FAR,POCKET_MAX,DIG_AIR_MARGIN_MS,AIR_UNIT_MS} from '../src/tasks/movement/get-out-of-water-task.js';
import {MobDefenseChain,CREEPER_STALL_S,CREEPER_STALL_NEAR} from '../src/chains/mobDefenseChain.js';
import {Worker,GoalSky,CAVE_EXIT_RISE} from '../src/worker.js';

// Round 79: the round-78 soak on the Nitrous world copy.
// round-78 normal3: feet at (837, 100, -446) in the group's build, water at y=100-101 along
// z=-446 from x=830 to x=847, a waterlogged cherry-slab cover at y=102 over x<=846; past its
// edge (847, 102, -446) is air - 11 cells from the head, past POCKET_MAX.
function build({digMs,eye='water',hang=false}={}){
 const controls={},dug=[],logs=[];let stopped=0;
 const at=p=>{const x=Math.floor(p.x),y=Math.floor(p.y),z=Math.floor(p.z),pos=new Vec3(x,y,z);
  if(z===-446&&x>=830&&x<=847&&y===101&&x===837&&eye!=='water')return {name:'cherry_slab',boundingBox:'block',isWaterlogged:true,position:pos};
  if(z===-446&&x>=830&&x<=847&&(y===100||y===101))return {name:'water',boundingBox:'empty',position:pos};
  if(z===-446&&x>=830&&x<=846&&y===102)return {name:'cherry_slab',boundingBox:'block',isWaterlogged:true,position:pos};
  if(z===-446&&x===847&&y>=102)return {name:'air',boundingBox:'empty',position:pos};
  return {name:'cherry_planks',boundingBox:'block',position:pos};};
 const b={entity:{position:new Vec3(837.5,100,-445.5),isInWater:true,onGround:false},oxygenLevel:8,blockAt:at,heldItem:null,
  setControlState:(n,v)=>{controls[n]=v;},clearControlStates(){},
  digTime:()=>digMs,dig:bl=>{dug.push(String(bl.position));return hang?new Promise(()=>{}):Promise.resolve();},stopDigging:()=>{stopped++;},
  lookAt:async()=>{},
  pathfinder:{stop(){},setGoal(){},movements:null,goto:async()=>{throw Error('no path');},setMovements(){}}};
 const ctx={bot:b,worker:{controlToken:1,epoch:1,log:m=>logs.push(m)}};
 return {b,ctx,controls,dug,logs,stopped:()=>stopped};
}
const settle=()=>new Promise(r=>setImmediate(r));
test('round 79: a roof too slow to dig under water before the air runs out is not dug; the air is looked for farther off',async()=>{
 const s=build({digMs:75000});
 const t=new GetOutOfWaterTask({ctx:s.ctx});t.onStart(s.b,s.ctx);t.onTick(s.b,s.ctx);
 await settle();
 assert.deepEqual(s.dug,[],'not dug');
 assert.equal(s.logs.at(-1),'WorldSurvival: the roof at (837, 102, -446) (cherry_slab, held hand) would take 75.0 s to dig under water (air 8); swimming for air up to '+POCKET_FAR+' cells off');
 // the next scan reaches the edge of the cover
 t.onTick(s.b,s.ctx);
 assert.match(s.logs.at(-1),/^WorldSurvival: air at \(847, 102, -446\), 11 cell\(s\) through the water \(air 8\); swimming to it instead of digging$/);
 assert.equal(s.controls.forward,true);
 assert.ok(POCKET_MAX<11&&11<=POCKET_FAR);
 // a roof the air allows is still dug, with the estimate logged
 const q=build({digMs:8*AIR_UNIT_MS+DIG_AIR_MARGIN_MS-500});
 const u=new GetOutOfWaterTask({ctx:q.ctx});u.onStart(q.b,q.ctx);u.onTick(q.b,q.ctx);
 await settle();
 assert.deepEqual(q.dug,['(837, 102, -446)']);
 assert.equal(q.logs.at(-1),'WorldSurvival: roof over the water at (837, 102, -446) (air 8, cherry_slab, 9.5 s); digging it');
});
test('round 79: the dig time counts the water when the eye is in a waterlogged block',()=>{
 assert.equal(roofDigMs(build({digMs:3000}).b,{}),3000,'eye in water: mineflayer already counts it');
 const s=build({digMs:3000,eye:'slab'});s.b.entity.position=new Vec3(837.5,99.6,-445.5);
 assert.equal(roofDigMs(s.b,{}),15000);
 assert.equal(roofDigMs({},{}),0,'no digTime: no estimate');
});
test('round 79: a roof dig that never finishes is stopped and given up',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const s=build({digMs:2000,hang:true});
 const k=new GetOutOfWaterTask({ctx:s.ctx});k.onStart(s.b,s.ctx);k.onTick(s.b,s.ctx);
 await settle();await settle();
 assert.deepEqual(s.dug,['(837, 102, -446)']);
 t.mock.timers.tick(4400);assert.equal(s.stopped(),0);
 t.mock.timers.tick(200);
 assert.equal(s.stopped(),1);
 assert.equal(s.logs.at(-1),'WorldSurvival: the roof dig at (837, 102, -446) did not finish in 4.5 s; giving it up');
 assert.equal(k.digging,false);
 // that roof is not dug again
 k.pocketAt=Date.now()+1e9;k.pocket=null;k.onTick(s.b,s.ctx);await settle();
 assert.equal(s.dug.length,1);
});

const creeperAt=x=>({id:9,name:'creeper',type:'hostile',position:new Vec3(x,64,0),isValid:true,metadata:{}});
function walker(){
 return {entity:{position:new Vec3(0,64,0)},entities:{},health:20,food:20,
  inventory:{items:()=>[],slots:[]},registry:{foodsByName:{}},time:{timeOfDay:1500},heldItem:null,blockAt:()=>null};
}
test('round 79: a creeper that hovers without coming nearer is left for the job, and fled again inside 6',()=>{
 const bot=walker(),logs=[],m=new MobDefenseChain(),ctx={config:{chains:{}},move:{},trackers:{},blacklist:{},worker:{log:x=>logs.push(x)}};
 let t=100;m.now=()=>t;
 // round-78 hard3: the creeper 7.7-14.6 off beside the box, never nearer
 const d=[8,9.9,7.7,12,14.6,9,7.9,10.9];
 let p;
 for(let i=0;t<100+CREEPER_STALL_S+3;i++,t+=1){
  bot.entities[9]=creeperAt(d[i%d.length]);p=m.priority(bot,ctx);
  if(logs.some(l=>/has not come nearer/.test(l)))break;
  assert.ok(p>=50,'fled or kept away at t='+t);
 }
 const line=logs.find(l=>/has not come nearer/.test(l));
 assert.ok(line,'the stall line');
 assert.match(line,/^Reflex: the creeper [\d.]+ away has not come nearer than 7\.7 in 3\d s; back to the job \(fleeing it again inside 6\)$/);
 assert.ok(p<50,'below the job');
 t+=1;bot.entities[9]=creeperAt(9);assert.ok(m.priority(bot,ctx)<50);
 t+=1;bot.entities[9]=creeperAt(14);assert.ok(m.priority(bot,ctx)<50);
 // inside 6 it is fled again, from the start
 t+=1;bot.entities[9]=creeperAt(CREEPER_STALL_NEAR-1);
 assert.equal(m.priority(bot,ctx),75);
 assert.equal(logs.at(-1),'Reflex: fleeing creeper (never melee a creeper)');
 assert.equal(m._creeperChase.stalled,undefined);
});
test('round 79: a creeper that keeps coming nearer is never left',()=>{
 const bot=walker(),logs=[],m=new MobDefenseChain(),ctx={config:{chains:{}},move:{},trackers:{},blacklist:{},worker:{log:x=>logs.push(x)}};
 let t=100;m.now=()=>t;
 for(let i=0;i<40;i++,t+=1){
  // the flee holds it off; every 8 s it gains 1.5 on the bot
  bot.entities[9]=creeperAt(9.5-1.5*Math.floor(i/8));
  assert.ok(m.priority(bot,ctx)>=50,'t='+t);
 }
 assert.ok(!logs.some(l=>/has not come nearer/.test(l)));
});

test('round 79: a cave morning 4 under the surface climbs to the sky',async()=>{
 // round-78 hard3: the box at (804, 84, -516), the surface anchor 88
 const goals=[],logs=[];let sky=0;
 const bot={entity:{position:new Vec3(804.5,84,-515.5)},blockAt:()=>({name:'air',skyLight:sky})};
 const w=Object.assign(Object.create(Worker.prototype),{bot,log:m=>logs.push(m),check(){},strandedTunnel:null,
  navigate:async g=>{goals.push(g);bot.entity.position=new Vec3(804.5,89,-512.5);sky=15;}});
 // the old call: 4 under the target, no climb at all
 await assert.rejects(w.ascend({spec:{type:'ascend',y:88}},0),/^Error: Could not climb toward the surface from y=84$/);
 assert.equal(goals.length,0);
 // the cave morning's: at least CAVE_EXIT_RISE over the box, to the sky
 await w.ascend({spec:{type:'ascend',y:84+CAVE_EXIT_RISE,sky:true}},0);
 assert.equal(goals.length,1);assert.ok(goals[0] instanceof GoalSky);
 assert.equal(logs.at(-1),'Ascend: y=84 -> 89 (surface 89)');
 const src=fs.readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
 assert.ok(src.includes("Math.floor(y0)+CAVE_EXIT_RISE);\n    try{await this.ascend({spec:{type:'ascend',y:top,sky:true}},token);}"));
});
