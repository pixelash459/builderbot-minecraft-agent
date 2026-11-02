import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {RunAwayFromCreepersTask,fuseWallCells,FUSE_WALL_NEAR,FUSE_STUCK_S} from '../src/chains/fallbackTasks.js';
console.error=()=>{};

// Round 86: the round-85 soak on the Nitrous world copy (two creeper fuses with the flee going nowhere).
const k=(x,y,z)=>x+','+y+','+z;
// round-85 hard1: a 1x2 tunnel at y=45 running east-west, the creeper two blocks east
function tunnel(){
 const cells=new Map();
 for(let x=-6;x<=6;x++){cells.set(k(x,44,0),'stone');cells.set(k(x,47,0),'stone');for(const y of [45,46]){cells.set(k(x,y,1),'stone');cells.set(k(x,y,-1),'stone');}}
 return cells;
}
function tunnelBot(cells,{items=[{name:'cobblestone',count:157}],creeperAt=new Vec3(2.5,45,0.5),fusing=true}={}){
 const inv=items.map((i,n)=>({...i,slot:36+n})),logs=[],placed=[],controls={};
 const creeper={id:9,name:'creeper',type:'hostile',isValid:true,height:1.7,position:creeperAt,metadata:{16:fusing?1:-1}};
 const bot={entity:{position:new Vec3(0.5,45,0.5),height:1.8},entities:{9:creeper},heldItem:{name:'stone_pickaxe'},food:16,health:20,
  inventory:{items:()=>inv},
  blockAt:p=>{const name=cells.get(k(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)))||'air';return {name,position:new Vec3(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)),boundingBox:name==='air'?'empty':'block'};},
  equip:async item=>{bot.heldItem=item;},
  placeBlock:async(ref,face)=>{const t=ref.position.plus(face);placed.push(k(t.x,t.y,t.z));cells.set(k(t.x,t.y,t.z),bot.heldItem.name);},
  setControlState:(n,v)=>{controls[n]=v;},look:async()=>{}};
 const ctx={worker:{log:m=>logs.push(m),shelterSpot:null},bot};
 return {bot,ctx,logs,placed,controls,creeper};
}
function run(task,bot,ctx,clock,steps,dt){for(let i=0;i<steps;i++){clock.t+=dt;task.onTick(bot,ctx);}}
function withClock(fn){const real=Date.now,clock={t:real()};Date.now=()=>clock.t;try{return fn(clock);}finally{Date.now=real;}}

test('round 86: the wall cells - feet and head toward the creeper, both axes when it stands diagonal',()=>{
 assert.equal(FUSE_WALL_NEAR,4);assert.equal(FUSE_STUCK_S,0.4);
 const me=new Vec3(0.5,45,0.5);
 assert.deepEqual(fuseWallCells(me,new Vec3(2.5,45,0.5)).map(q=>[q.x,q.y,q.z]),[[1,45,0],[1,46,0]]);
 assert.deepEqual(fuseWallCells(me,new Vec3(0.5,45,-2)).map(q=>[q.x,q.y,q.z]),[[0,45,-1],[0,46,-1]]);
 assert.deepEqual(fuseWallCells(me,new Vec3(3,45,-1.5)).map(q=>[q.x,q.y,q.z]),[[1,45,0],[1,46,0],[0,45,-1],[0,46,-1]],'the larger axis first');
 assert.deepEqual(fuseWallCells(me,new Vec3(0.6,48,0.4)),[],'straight above: no side wall');
});

test('round 86: a fusing creeper 2 away in a tunnel and the bot not moving - the tunnel is walled and the bot holds',()=>withClock(clock=>{
 const cells=tunnel(),{bot,ctx,logs,placed,controls}=tunnelBot(cells);
 const task=new RunAwayFromCreepersTask(7,{fuse:true});
 run(task,bot,ctx,clock,6,50);
 assert.deepEqual(placed,[],'0.3 s: still the flee');
 run(task,bot,ctx,clock,30,50);
 assert.deepEqual(placed,['1,45,0','1,46,0']);
 assert.equal(bot.heldItem.name,'cobblestone');
 assert.deepEqual(logs,['Reflex: creeper fuse at 2.0 and the flee is not moving the bot; walling 2 cell(s) toward it']);
 assert.equal(controls.forward,false,'holding behind the wall');
 // the fuse ends: back to the plain flee
 bot.entities[9].metadata={16:-1};
 task.onTick(bot,ctx);
 assert.equal(task.walling,false);
}));

test('round 86: no wall while the flee moves the bot, without blocks, without a fuse, or from a plain flee',()=>withClock(clock=>{
 // moving 1 block every 0.2 s
 {const {bot,ctx,placed}=tunnelBot(tunnel());const task=new RunAwayFromCreepersTask(7,{fuse:true});
  for(let i=0;i<20;i++){clock.t+=200;bot.entity.position=bot.entity.position.offset(-1,0,0);task.onTick(bot,ctx);}
  assert.deepEqual(placed,[]);}
 {const {bot,ctx,placed}=tunnelBot(tunnel(),{items:[{name:'stone_pickaxe',count:1}]});const task=new RunAwayFromCreepersTask(7,{fuse:true});
  run(task,bot,ctx,clock,30,50);assert.deepEqual(placed,[],'no blocks held');assert.equal(task.walling,undefined);}
 {const {bot,ctx,placed}=tunnelBot(tunnel(),{fusing:false});const task=new RunAwayFromCreepersTask(7,{fuse:true});
  run(task,bot,ctx,clock,30,50);assert.deepEqual(placed,[],'not fusing');}
 {const {bot,ctx,placed}=tunnelBot(tunnel(),{creeperAt:new Vec3(5.5,45,0.5)});const task=new RunAwayFromCreepersTask(7,{fuse:true});
  run(task,bot,ctx,clock,30,50);assert.deepEqual(placed,[],'fusing 5 away: beyond the wall range');}
 {const {bot,ctx,placed}=tunnelBot(tunnel());const task=new RunAwayFromCreepersTask(10);
  run(task,bot,ctx,clock,30,50);assert.deepEqual(placed,[],'the keep-away flee never walls');}
 assert.equal(new RunAwayFromCreepersTask(7,{fuse:true}).isEqual(new RunAwayFromCreepersTask(7)),false);
}));

test('round 86: in the open with nothing under the cell, the head cell goes against the block beyond; a creeper in a cell is not built into',()=>withClock(clock=>{
 // a ledge: no floor east of the bot, the creeper standing in the feet cell's column one further on
 const cells=new Map([[k(0,44,0),'stone'],[k(2,45,0),'stone'],[k(2,46,0),'stone']]);
 const {bot,ctx,placed}=tunnelBot(cells,{creeperAt:new Vec3(1.5,45,0.5)});
 const task=new RunAwayFromCreepersTask(7,{fuse:true});
 run(task,bot,ctx,clock,40,50);
 assert.deepEqual(placed,[],'the creeper stands in both cells');
 const b=tunnelBot(new Map([[k(0,44,0),'stone'],[k(2,45,0),'stone'],[k(2,46,0),'stone']]),{creeperAt:new Vec3(3.5,47,0.5)});
 const t2=new RunAwayFromCreepersTask(7,{fuse:true});
 run(t2,b.bot,b.ctx,clock,40,50);
 assert.deepEqual(b.placed,['1,45,0','1,46,0'],'against the block beyond, then on the placed feet cell');
}));
