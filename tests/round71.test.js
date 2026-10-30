import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {createRequire} from 'node:module';
import pf from 'mineflayer-pathfinder';
import {waterExits,SWIM_OUT_COST} from '../src/worker.js';
const require=createRequire(import.meta.url);
const Move=require('mineflayer-pathfinder/lib/move.js');

// A pool of `fluid` over x -5..5, z -5..5, y 58..61 (top cell 61), stone around it up to `bankTop`.
async function pool({fluid='water',bankTop=61}={}){
 const reg=(await import('prismarine-registry')).default('1.21.4');
 const Block=(await import('prismarine-block')).default(reg);
 const nameAt=(x,y,z)=>{
  const inPool=Math.abs(x)<=5&&Math.abs(z)<=5;
  if(inPool)return y>=58&&y<=61?fluid:(y<58?'stone':'air');
  return y<=bankTop?'stone':'air';
 };
 const blockAt=p=>{const b=Block.fromStateId(reg.blocksByName[nameAt(p.x,p.y,p.z)].defaultState,0);b.position=new Vec3(p.x,p.y,p.z);return b;};
 const bot={registry:reg,version:'1.21.4',game:{minY:-64},entities:{},blockAt,pathfinder:{bestHarvestTool:()=>null},entity:{position:new Vec3(5.5,61.2,0.5)}};
 const m=new pf.Movements(bot);m.canDig=false;return m;
}
const east=(m,node)=>m.getNeighbors(node).filter(n=>n.x===node.x+1&&n.z===node.z);

test('round 71: the stock pathfinder will not climb out of deep water onto a bank level with the surface',async()=>{
 const m=await pool();
 assert.deepEqual(east(m,new Move(5,61,0,0,0)),[],'the bug: no way east onto the bank');
});
test('round 71: a swimmer climbs out onto a bank level with the surface',async()=>{
 const m=waterExits(await pool());
 const out=east(m,new Move(5,61,0,0,0));
 assert.equal(out.length,1);assert.deepEqual([out[0].x,out[0].y,out[0].z],[6,62,0]);
 assert.equal(out[0].cost,SWIM_OUT_COST+m.liquidCost);
 const fromAir=east(m,new Move(5,62,0,0,0));
 assert.deepEqual(fromAir.map(n=>[n.x,n.y,n.z]),[[6,62,0]],'over the surface the stock forward step already lands');
});
test('round 72: a bank one block over the water is not planned (the physics cannot climb it)',async()=>{
 const m=waterExits(await pool({bankTop:62}));
 assert.deepEqual(east(m,new Move(5,61,0,0,0)),[]);
 assert.deepEqual(east(m,new Move(5,62,0,0,0)),[]);
});
test('round 71: no climb out of lava or from under the surface',async()=>{
 const lava=waterExits(await pool({fluid:'lava'}));
 assert.deepEqual(east(lava,new Move(5,61,0,0,0)),[]);
 const m=waterExits(await pool());
 assert.deepEqual(east(m,new Move(5,60,0,0,0)),[],'a cell with water over it is not the surface');
 assert.equal(waterExits(m),m,'installed once');
});
test('round 71: a full search from mid-pool reaches land past the bank, where the stock search found no path',async()=>{
 const AStar=require('mineflayer-pathfinder/lib/astar.js');
 const goal=new pf.goals.GoalXZ(20,0);
 const stock=new AStar(new Move(0,61,0,0,0),await pool(),goal,2000).compute();
 assert.equal(stock.status,'noPath','the round-70 hard3 stall');
 const fixed=new AStar(new Move(0,61,0,0,0),waterExits(await pool()),goal,2000).compute();
 assert.equal(fixed.status,'success');
 const end=fixed.path[fixed.path.length-1];
 assert.deepEqual([end.x,end.z],[20,0]);
 assert.ok(fixed.path.some(n=>n.x===6&&n.y===62),'out over the bank');
});
import {sinkGuard,SINK_MS,LEAVE_WATER_R} from '../src/worker.js';
test('round 71: the sink guard names the eye height and says in water, not that no water is seen',()=>{
 const ctl={};
 const bot={oxygenLevel:20,entity:{position:new Vec3(742.5,61.4,-612.5),isInWater:true},blockAt:()=>({name:'air'}),
  getControlState:k=>!!ctl[k],setControlState:(k,v)=>{ctl[k]=v;}};
 const st={};let line=null;
 for(let t=0,a=20;t<=SINK_MS+2500;t+=750,a--){bot.oxygenLevel=a;line=sinkGuard(bot,st,t)||line;}
 assert.match(line,/isInWater true, head block air at eye y 63\.0, in water - the air is falling\)$/);
 assert.doesNotMatch(line,/not seen/);
 assert.equal(LEAVE_WATER_R,12);
});
