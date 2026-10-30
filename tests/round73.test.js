import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {createRequire} from 'node:module';
import pf from 'mineflayer-pathfinder';
import {Worker,waterExits,LIQUID_COST,WATER_SEARCH_RADIUS,WET_NOPATH_MS,DAY_HOSTILE,inWater} from '../src/worker.js';
const require=createRequire(import.meta.url);
const Move=require('mineflayer-pathfinder/lib/move.js');
const AStar=require('mineflayer-pathfinder/lib/astar.js');
const reg=require('prismarine-registry')('1.21.4');
const Block=require('prismarine-block')(reg);
const mk=(name,p)=>{const b=Block.fromStateId(reg.blocksByName[name].defaultState,0);b.position=p;return b;};
const solve=a=>{let r;do r=a.compute();while(r.status==='partial');return r;};

// A lake over x -30..30, z -6..6 (water y 50..61): its bank is a block over the water (no climb
// out) but on the far east side, level with it (top 61).
const lakeAt=(x,y,z)=>Math.abs(x)<=30&&Math.abs(z)<=6?(y>=50&&y<=61?'water':y<50?'stone':'air'):(y<=(x>30?61:62)?'stone':'air');
const lakeBlock=p=>{const q=new Vec3(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z));return mk(lakeAt(q.x,q.y,q.z),q);};
test('round 73: a long swim runs out of the 128 search budget; the water budget reaches the far bank',()=>{
 const moves=()=>{const bot={registry:reg,version:'1.21.4',game:{minY:-64},entities:{},blockAt:lakeBlock,pathfinder:{bestHarvestTool:()=>null},entity:{position:new Vec3(0,61,0)}};const m=new pf.Movements(bot);m.canDig=false;m.liquidCost=LIQUID_COST;return waterExits(m);};
 const goal=new pf.goals.GoalXZ(40,0);
 const near=solve(new AStar(new Move(-26,61,0,0,0),moves(),goal,20000,40,128));
 assert.equal(near.status,'noPath','55 water cells at 4 more each pass the budget');
 assert.ok(near.path.length>0,'with a partial path - goto rejects, it does not resolve empty');
 const wide=solve(new AStar(new Move(-26,61,0,0,0),moves(),goal,20000,40,WATER_SEARCH_RADIUS));
 assert.equal(wide.status,'success');
});

// navigate() with a stub pathfinder: goto() as the stock one, rejecting a budget-limited search.
function navBot(start,wet){
 const listeners={};
 const bot={entity:{position:start.clone(),onGround:true},on:(e,f)=>{listeners[e]=f;},off(){},clearControlStates(){},
  blockAt:p=>({name:wet&&p.y<62?'water':'air',boundingBox:'empty',position:p}),
  pathfinder:{searchRadius:128,movements:{exclusionAreasStep:[]},setGoal(){},isMining:()=>false,calls:[]}};
 return bot;
}
function navWorker(bot,logs){return Object.assign(Object.create(Worker.prototype),{bot,epoch:0,log:m=>logs.push(m),check(){},applyMobAvoidance(){}});}
test('round 73: a no-path from the water searches once more with the water budget, then puts the budget back',async()=>{
 const bot=navBot(new Vec3(-25.5,61,0.5),true),logs=[];
 bot.pathfinder.goto=async goal=>{bot.pathfinder.calls.push(bot.pathfinder.searchRadius);if(bot.pathfinder.searchRadius<WATER_SEARCH_RADIUS)throw new Error('No path to the goal!');bot.entity.position=new Vec3(40.5,62,0.5);};
 const w=navWorker(bot,logs);
 await w.navigate(new pf.goals.GoalBlock(40,62,0),0,5);
 assert.deepEqual(bot.pathfinder.calls,[128,WATER_SEARCH_RADIUS]);
 assert.equal(bot.pathfinder.searchRadius,128,'the budget is put back');
 assert.match(logs.join('\n'),/^Navigation: no path from the water at \(-26, 61, 0\) within the search budget; searching 320$/m);
 const dry=navBot(new Vec3(-25.5,64,0.5),false),dl=[];
 dry.pathfinder.goto=async()=>{dry.pathfinder.calls.push(dry.pathfinder.searchRadius);throw new Error('No path to the goal!');};
 await assert.rejects(navWorker(dry,dl).navigate(new pf.goals.GoalBlock(40,62,0),0,5),/^Error: No path to the goal!$/);
 assert.deepEqual(dry.pathfinder.calls,[128],'on land: no second search');
 const deep=navBot(new Vec3(-25.5,61,0.5),true),el=[];
 deep.pathfinder.goto=async()=>{deep.pathfinder.calls.push(deep.pathfinder.searchRadius);throw new Error('No path to the goal!');};
 const wd=navWorker(deep,el);wd.stairOut=async()=>false; // round 74: then a stair-out, that cannot rise here
 await assert.rejects(wd.navigate(new pf.goals.GoalBlock(40,62,0),0,5),/No path/);
 assert.deepEqual(deep.pathfinder.calls,[128,WATER_SEARCH_RADIUS],'once only');
});
test('round 73: a no-path rejection with mob avoidance on paths again without it',async()=>{
 const bot=navBot(new Vec3(0.5,64,0.5),false),logs=[];
 const hook=()=>40;bot.pathfinder.movements={exclusionAreasStep:[hook],_mobAvoidHook:hook};
 bot.pathfinder.goto=async()=>{const on=bot.pathfinder.movements.exclusionAreasStep.includes(hook);bot.pathfinder.calls.push(on);if(on)throw new Error('No path to the goal!');bot.entity.position=new Vec3(10.5,64,0.5);};
 await navWorker(bot,logs).navigate(new pf.goals.GoalBlock(10,64,0),0,5);
 assert.deepEqual(bot.pathfinder.calls,[true,false]);
 assert.match(logs[0],/^Navigation: no path with mob avoidance at \(0, 64, 0\); trying without it$/);
});
test('round 73: the job after a no-path from the water steps out first',async()=>{
 assert.equal(inWater({entity:{position:new Vec3(0.5,60,0.5)},blockAt:p=>({name:p.y===61?'water':'air'})}),true,'head under');
 assert.equal(inWater({entity:{position:new Vec3(0.5,62,0.5)},blockAt:p=>({name:p.y<62?'water':'air'})}),false,'on the surface stand');
 const wk=Object.create(Worker.prototype);let stepped=0;
 wk.leaveWater=async()=>{stepped++;};wk.check=()=>{};wk.takeStrandedTunnel=()=>null;
 wk.wetNoPathAt=Date.now()-WET_NOPATH_MS+5000;
 try{await wk.run({spec:{type:'gather',block:'oak_log',count:3}},1);}catch{}
 assert.equal(stepped,1);assert.equal(wk.wetNoPathAt,0,'once');
 wk.wetNoPathAt=Date.now()-WET_NOPATH_MS-1;
 try{await wk.run({spec:{type:'gather',block:'oak_log',count:3}},1);}catch{}
 assert.equal(stepped,1,'not once it is stale');
});

// The probe's cobble_box_bare: a 3x3x3 cobblestone block with the bot's 1x2 column hollow.
function boxBot(over='air'){
 const solid=new Map();
 for(let x=-1;x<=1;x++)for(let y=64;y<=66;y++)for(let z=-1;z<=1;z++)if(!(x===0&&z===0&&y<66))solid.set(x+','+y+','+z,'cobblestone');
 solid.set('0,67,0',over);
 const dug=[];
 const bot={entities:{},entity:{position:new Vec3(0.5,64,0.5)},inventory:{items:()=>[]},tool:{equipForBlock:async()=>{}},
  blockAt:p=>mk(solid.get(p.x+','+p.y+','+p.z)||'air',p),
  dig:async bl=>{dug.push(bl.position.x+','+bl.position.y+','+bl.position.z);solid.set(bl.position.x+','+bl.position.y+','+bl.position.z,'air');}};
 return {bot,dug,solid};
}
test('round 73: boxed in, the stair-out clears the roof over its head before the step up',async()=>{
 const {bot,dug,solid}=boxBot();const logs=[];
 const w=Object.assign(Object.create(Worker.prototype),{bot,log:m=>logs.push(m),check(){}});
 w.tunnelStep=async(job,token,d)=>{
  assert.equal(solid.get('0,66,0'),'air','the roof is open before the step');
  const f=bot.entity.position.floored(),n=f.offset(d.x,1,d.z);
  await w.clearCells(token,[n.offset(0,1,0),n],undefined,true,job);
  bot.entity.position=new Vec3(n.x+.5,n.y,n.z+.5);
  return {dir:d,next:n};
 };
 assert.equal(await w.stairOut(0,{x:10,z:0}),true);
 assert.deepEqual(dug,['0,66,0','1,66,0','1,65,0'],'roof, then the step\'s head and feet');
 assert.match(logs[0],/^Boxed in: no tool for cobblestone at \(0, 66, 0\); digging it by hand/);
 assert.match(logs[1],/^Boxed in at \(0, 64, 0\): dug 1 steps up east to \(1, 65, 0\)$/);
});
test('round 73: sand over the roof is never pulled down onto the head',async()=>{
 const {bot,dug}=boxBot('sand');const logs=[];
 const w=Object.assign(Object.create(Worker.prototype),{bot,log:m=>logs.push(m),check(){}});
 let steps=0;w.tunnelStep=async()=>{steps++;throw Error('Tunnel stopped: test');};
 assert.equal(await w.stairOut(0,{x:10,z:0}),false);
 assert.deepEqual(dug,[]);assert.equal(steps,0);
 assert.match(logs.at(-1),/no way to stair out/);
});

test('round 73: the tunnel climb skips the filled cell under the bot and never pillars out of the tunnel',async()=>{
 const goals=[];const own=[];
 const bot={entity:{position:new Vec3(2.5,-62,0.5)},pathfinder:{movements:null,searchRadius:128,setMovements(m){this.movements=m;}}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,movements:{},log(){},check(){},exploreMovements:()=>({})});
 w.navigate=async goal=>{goals.push([goal.x,goal.y,goal.z]);own.push(w._ownFallback);bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5);};
 await w.climbTunnel({tunnel:[{x:0,y:-62,z:0},{x:1,y:-63,z:0},{x:2,y:-63,z:0}]},0);
 assert.deepEqual(goals,[[1,-63,0],[0,-62,0]]);
 assert.deepEqual(own,[true,true],'the stranded stair-out, drop and pillar stay off');
 assert.ok(!w._ownFallback,'and come back on after');
});

test('round 73: a skeleton holds the morning box as a creeper does, and holds its walls',async()=>{
 assert.ok(DAY_HOSTILE.test('skeleton')&&DAY_HOSTILE.test('stray')&&DAY_HOSTILE.test('bogged')&&!DAY_HOSTILE.test('zombie'));
 const skel={name:'skeleton',type:'hostile',position:new Vec3(10.8,64,0.5)};
 const bot={entity:{position:new Vec3(0.5,64,0.5)},entities:{1:skel},time:{timeOfDay:3000}};
 const logs=[];const w=Object.assign(Object.create(Worker.prototype),{bot,log:m=>logs.push(m),check(){},deadline:Infinity});
 assert.equal(w.shelterExitSafe(),false,'a skeleton 10.3 away at tod 3000 (round-72 hard3) holds');
 skel.name='zombie';assert.equal(w.shelterExitSafe(),true,'a zombie there does not');
 skel.name='skeleton';bot.time.timeOfDay=6000;assert.equal(w.shelterExitSafe(),true,'from noon only within the wall');
 skel.position=new Vec3(8.5,64,0.5);
 const real=Date.now;let t=real();Date.now=()=>t;
 const realSet=globalThis.setTimeout;
 globalThis.setTimeout=(fn,ms)=>{t+=ms;if(t-real()>2000)delete bot.entities[1];return realSet(fn,0);};
 try{await w.waitCreeperClear(0);}finally{Date.now=real;globalThis.setTimeout=realSet;}
 assert.deepEqual(logs,['Shelter: a skeleton 8.0 away; keeping the walls up','Shelter: skeleton gone; opening the walls']);
});
