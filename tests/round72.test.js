import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {createRequire} from 'node:module';
import pf from 'mineflayer-pathfinder';
import {waterExits,SWIM_UP_COST} from '../src/worker.js';
const require=createRequire(import.meta.url);
const Move=require('mineflayer-pathfinder/lib/move.js');
const AStar=require('mineflayer-pathfinder/lib/astar.js');
const {Physics,PlayerState}=require('prismarine-physics');

// A water pool over x -5..5, z -5..5 from y 50 to 61 (top cell 61), stone around it up to bankTop.
async function world(bankTop=61){
 const reg=(await import('prismarine-registry')).default('1.21.4');
 const Block=(await import('prismarine-block')).default(reg);
 const nameAt=(x,y,z)=>{
  if(Math.abs(x)<=5&&Math.abs(z)<=5)return y>=50&&y<=61?'water':(y<50?'stone':'air');
  return y<=bankTop?'stone':'air';
 };
 const blockAt=p=>{const q=new Vec3(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z));const b=Block.fromStateId(reg.blocksByName[nameAt(q.x,q.y,q.z)].defaultState,0);b.position=q;return b;};
 const bot={registry:reg,version:'1.21.4',game:{minY:-64},entities:{},blockAt,pathfinder:{bestHarvestTool:()=>null},entity:{position:new Vec3(0.5,55,0.5)}};
 const m=new pf.Movements(bot);m.canDig=false;
 return {reg,blockAt,m};
}
// The pathfinder calls compute() again while it is partial (a 40 ms slice each).
const solve=a=>{let r;do r=a.compute();while(r.status==='partial');return r;};
// The bot's own physics: forward and jump held toward +x (the pathfinder's controls in water).
function swimEast({reg,blockAt},y,ticks=200){
 const physics=Physics(reg,{getBlock:blockAt});
 const bot={version:'1.21.4',entity:{position:new Vec3(4.5,y,0.5),velocity:new Vec3(0,0,0),onGround:false,isInWater:true,isInLava:false,isInWeb:false,
  isCollidedHorizontally:false,isCollidedVertically:false,elytraFlying:false,yaw:-Math.PI/2,pitch:0,effects:{},attributes:{}},jumpTicks:0,jumpQueued:false,fireworkRocketDuration:0,inventory:{slots:[]}};
 const ctl={forward:true,back:false,left:false,right:false,jump:true,sprint:false,sneak:false};
 let top=-Infinity;
 for(let t=0;t<ticks;t++){physics.simulatePlayer(new PlayerState(bot,ctl),{getBlock:blockAt}).apply(bot);top=Math.max(top,bot.entity.position.y);if(bot.entity.onGround&&bot.entity.position.x>6)return {out:true,y:bot.entity.position.y};}
 return {out:false,top};
}

test('round 72: the physics climbs a swimmer onto a level bank, never onto one a block higher',async()=>{
 const level=swimEast(await world(61),61);
 assert.equal(level.out,true);assert.equal(level.y,62);
 const fromFloor=swimEast(await world(61),51);
 assert.equal(fromFloor.out,true,'from the pool floor too');
 const high=swimEast(await world(62),61);
 assert.equal(high.out,false);assert.ok(high.top<63,'tops out under the landing: '+high.top);
});
test('round 72: under the surface a swimmer swims up, one water cell at a time',async()=>{
 const {m}=await world();
 const up=n=>m.getNeighbors(n).filter(x=>x.x===n.x&&x.z===n.z&&x.y===n.y+1);
 assert.deepEqual(up(new Move(0,55,0,0,0)),[],'the stock movements: no way up in water');
 waterExits(m);
 const u=up(new Move(0,55,0,0,0));
 assert.equal(u.length,1);assert.equal(u[0].cost,SWIM_UP_COST+m.liquidCost);
 assert.deepEqual(up(new Move(0,61,0,0,0)),[],'not up out of the top water cell into the air');
});
test('round 72: a search from the pool floor reaches land, where the stock search found no path',async()=>{
 const goal=new pf.goals.GoalXZ(20,0);
 const stock=solve(new AStar(new Move(0,51,0,0,0),(await world()).m,goal,5000));
 assert.equal(stock.status,'noPath');
 const fixed=solve(new AStar(new Move(0,51,0,0,0),waterExits((await world()).m),goal,5000));
 assert.equal(fixed.status,'success');
 const end=fixed.path[fixed.path.length-1];assert.deepEqual([end.x,end.y,end.z],[20,62,0]);
 const high=solve(new AStar(new Move(0,51,0,0,0),waterExits((await world(62)).m),goal,5000));
 assert.equal(high.status,'noPath','a pool walled one block over the water: no plan the bot cannot follow');
});
import {Worker} from '../src/worker.js';
test('round 72: stepping out of the water tries once more when the goal was changed',async()=>{
 const cell=p=>p.y<=61&&p.x<=5?{name:'water',boundingBox:'empty'}:p.y<=61?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'};
 const bot={entity:{position:new Vec3(5.5,61.2,0.5)},blockAt:cell};
 const logs=[];let calls=0;
 const w=Object.assign(Object.create(Worker.prototype),{bot,log:m=>logs.push(m),check(){},
  async navigate(goal){calls++;if(calls===1)throw new Error('The goal was changed before it could be completed!');}});
 await w.leaveWater(0);
 assert.equal(calls,2);
 assert.match(logs.join(' '),/^Water: stepped out to \(6, 62, 0\)$/);
 calls=-5;logs.length=0;
 w.navigate=async()=>{calls++;throw new Error('The goal was changed before it could be completed!');};
 await w.leaveWater(0);
 assert.equal(calls,-3,'two tries, then it gives up');
 assert.match(logs[0],/^Water: could not step out to \(6, 62, 0\) \(The goal was changed/);
});
import {leaveRefuge,MORNING_LATE,CREEPER_LATE,REFUGE_CLEAR,REFUGE_WALL} from '../src/night.js';
test('round 72: a creeper within 16 holds the refuge until noon, then only at the wall',()=>{
 assert.equal(leaveRefuge(MORNING_LATE,10.9),true,'round-71 hard2: the late rule let a 10.9 hostile go');
 assert.equal(leaveRefuge(MORNING_LATE,10.9,10.9),false,'a creeper at 10.9 holds it');
 assert.equal(leaveRefuge(MORNING_LATE,20,REFUGE_CLEAR+0.1),true);
 assert.equal(leaveRefuge(CREEPER_LATE,10,10),true,'after noon a creeper off the wall no longer holds it');
 assert.equal(leaveRefuge(CREEPER_LATE,REFUGE_WALL,REFUGE_WALL),false);
});
test('round 72: the box comes down outer cells first; the walls wait (sealed) for a creeper to clear',async()=>{
 const solid=new Set();const k=c=>c.x+','+c.y+','+c.z;
 const shell=[{x:1,y:64,z:0},{x:-1,y:64,z:0},{x:0,y:66,z:0},{x:2,y:63,z:0},{x:0,y:64,z:1},{x:-1,y:63,z:1}];
 for(const c of shell)solid.add(k(c));
 const creeper={name:'creeper',type:'hostile',position:new Vec3(8.5,64,0.5)};
 const order=[];const logs=[];
 const bot={entity:{position:new Vec3(0.5,64,0.5)},entities:{1:creeper},
  blockAt:p=>({boundingBox:solid.has(k(p))?'block':'empty',position:p}),
  tool:{equipForBlock:async()=>{}},
  dig:async bl=>{order.push(k(bl.position));solid.delete(k(bl.position));}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,log:m=>logs.push(m),check(){},update(){},sweepDrops:async()=>{}});
 const real=Date.now;let t=real();Date.now=()=>t;
 const realSet=globalThis.setTimeout;
 globalThis.setTimeout=(fn,ms)=>{t+=ms;if(t-real()>3000)creeper.position=new Vec3(30.5,64,0.5);return realSet(fn,0);};
 try{await w.removeShelter({shell,placed:[]},0);}finally{Date.now=real;globalThis.setTimeout=realSet;}
 assert.deepEqual(order.slice(0,2).sort(),['-1,63,1','2,63,0'],'outer supports first');
 assert.deepEqual(order.slice(2).sort(),['-1,64,0','0,64,1','0,66,0','1,64,0']);
 assert.match(logs[0],/^Shelter: a creeper 8\.0 away; keeping the walls up$/);
 assert.match(logs[1],/^Shelter: creeper 30\.0 away; opening the walls$/);
});
test('round 72: boxed in with no pickaxe, the stair-out digs cobblestone by hand; other digs still refuse',async()=>{
 const reg=(await import('prismarine-registry')).default('1.21.4');
 const Block=(await import('prismarine-block')).default(reg);
 const mk=(name,p)=>{const b=Block.fromStateId(reg.blocksByName[name].defaultState,0);b.position=p;return b;};
 const solid=new Map([['1,64,0','cobblestone'],['1,65,0','deepslate']]);
 const dug=[];const logs=[];
 const bot={entities:{},inventory:{items:()=>[]},tool:{equipForBlock:async()=>{}},
  blockAt:p=>mk(solid.get(p.x+','+p.y+','+p.z)||'air',p),dig:async bl=>{dug.push(bl.name);solid.delete(bl.position.x+','+bl.position.y+','+bl.position.z);}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,log:m=>logs.push(m),check(){}});
 const cob=[new Vec3(1,64,0)];
 await assert.rejects(w.clearCells(0,cob,undefined,false,{tunnel:[]}),/Tunnel needs a suitable tool in the inventory for cobblestone/,'a plain tunnel still refuses');
 const job={tunnel:[],handDig:true};
 await w.clearCells(0,cob,undefined,false,job);
 assert.deepEqual(dug,['cobblestone']);
 assert.match(logs[0],/^Boxed in: no tool for cobblestone at \(1, 64, 0\); digging it by hand \(it drops nothing\)$/);
 await assert.rejects(w.clearCells(0,[new Vec3(1,65,0)],undefined,false,job),/for deepslate/,'not deepslate (hardness 3)');
});
