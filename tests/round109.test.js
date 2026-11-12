import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {fleeHeading,fleeJump,compass,FLEE_KEEP,FLEE_AVOID_COST} from '../src/night.js';
import {RunAwayFromHostilesTask,RunAwayFromCreepersTask,FLEE_STUCK_S,FLEE_STUCK_BLOCKS,FLEE_AVOID_S,FLEE_STUCK_LOGS,FLEE_STUCK_GAP} from '../src/chains/fallbackTasks.js';
console.error=()=>{};

// Round 109: the round-107 soak's flee speed meter - 34 flees, median 1.2 blocks/s against the game
// sprint's 5.6; hard2 held sprint and forward 14.8 s and moved 1.3 blocks. The blind flee never pressed
// jump (a one-block step stops it: the game steps up 0.6 without a jump), never gave up a heading that
// was not moving it, and re-chose its heading every tick.
const S={name:'stone',boundingBox:'block'},A={name:'air',boundingBox:'empty'},W={name:'water',boundingBox:'empty'};
// a world of air over a stone floor at y=63, with extra cells
const world=(extra={})=>(x,y,z)=>extra[x+','+y+','+z]||(y<=63?S:A);
const me=new Vec3(0.5,64,0.5),east={x:1,z:0,blocked:false};

test('round 109: the flee jumps a one-block step and sprint-jumps open ground, never into a low roof, water or a drop',()=>{
 // a one-block step east with room over it
 assert.equal(fleeJump(world({'1,64,0':S}),me,east,{sprint:false}),true,'a step: jump even walking');
 // a two-high wall: no jump (the stuck check turns it)
 assert.equal(fleeJump(world({'1,64,0':S,'1,65,0':S}),me,east,{sprint:true}),false);
 // a step with a block over it (no room to land)
 assert.equal(fleeJump(world({'1,64,0':S,'1,66,0':S}),me,east,{sprint:true}),false);
 // open ground, sprinting: the sprint-jump
 assert.equal(fleeJump(world(),me,east,{sprint:true}),true,'open ground: sprint-jump');
 assert.equal(fleeJump(world(),me,east,{sprint:false}),false,'no sprint (food 6 or less): no hop');
 // a roof over the bot's head (a 2-high tunnel): no hop
 assert.equal(fleeJump(world({'0,66,0':S}),me,east,{sprint:true}),false);
 // no footing ahead (a hole or a drop): no hop into it
 assert.equal(fleeJump(world({'1,63,0':A}),me,east,{sprint:true}),false);
 // water ahead: no hop (swimming: round 119 holds jump - see round119.test.js)
 assert.equal(fleeJump(world({'1,64,0':W}),me,east,{sprint:true}),false);
 assert.equal(fleeJump(world(),me,east,{sprint:true,inWater:true}),true);
 // a blocked heading: no jump
 assert.equal(fleeJump(world(),me,{x:1,z:0,blocked:true},{sprint:true}),false);
 assert.equal(compass(1,0),'east');assert.equal(compass(0,-1),'north');assert.equal(compass(-0.7,0.7),'south-west');
});

test('round 109: the heading keeps to the last one and turns off a heading set aside',()=>{
 const mob=x=>({name:'zombie',position:new Vec3(x,64,0.5)});
 const h0=fleeHeading(world(),me,[mob(-5)]);
 assert.ok(h0.x>0.99,'away from a zombie to the west: east');
 // set east aside: the flee turns at least FLEE_AVOID_RAD off it
 const h1=fleeHeading(world(),me,[mob(-5)],{avoid:[{x:1,z:0}]});
 assert.ok(Math.atan2(Math.abs(h1.z),h1.x)>0.6,JSON.stringify(h1));
 assert.equal(FLEE_AVOID_COST,50);
 // the last tick's heading costs FLEE_KEEP less: a near tie keeps the way the bot is already running
 const h2=fleeHeading(world(),me,[mob(-5)],{prev:{x:1,z:0}});
 assert.ok(h2.x>0.99);assert.equal(h2.cost,h0.cost-FLEE_KEEP);assert.equal(FLEE_KEEP,4);
 // the next heading over (0.39 rad) costs 3.1: with the bot already running that way it is kept
 const prev={x:Math.cos(0.79),z:Math.sin(0.79)},mobs=[mob(-5),{name:'zombie',position:new Vec3(0.5-5*Math.cos(0.79)*0.2,64,0.5-5*Math.sin(0.79)*0.2)}];
 const free=fleeHeading(world(),me,mobs),kept=fleeHeading(world(),me,mobs,{prev});
 assert.ok(kept.cost<=free.cost);
});

function fleeBot(extra={}){
 const keys={};
 const at=world(extra);
 return {keys,entity:{position:new Vec3(0.5,64,0.5),onGround:true},health:12,food:18,
  entities:{7:{id:7,name:'zombie',type:'hostile',position:new Vec3(-4.5,64,0.5),isValid:true,height:1.95}},
  inventory:{items:()=>[],slots:[]},registry:{foodsByName:{}},time:{timeOfDay:6000},
  setControlState:(k,v)=>{keys[k]=v;},getControlState:k=>!!keys[k],look:async()=>{},
  blockAt:p=>{const b=at(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z));return {...b,position:p.floored(),skyLight:15};}};
}
test('round 109: a flee that makes no headway for FLEE_STUCK_S sets that heading aside and logs it',()=>{
 assert.equal(FLEE_STUCK_S,1);assert.equal(FLEE_STUCK_BLOCKS,0.8);assert.equal(FLEE_AVOID_S,3);assert.equal(FLEE_STUCK_LOGS,3);
 // a dead-end pocket open only to the west, where the zombie is: a two-high wall east (x=1) and
 // walls north and south of the bot's row
 const pocket={};for(let z=-3;z<=3;z++)for(const y of [64,65])pocket['1,'+y+','+z]=S;
 for(let x=-3;x<=0;x++)for(const z of [-1,1])for(const y of [64,65])pocket[x+','+y+','+z]=S;
 const bot=fleeBot(pocket),logs=[],ctx={config:{chains:{}},worker:{log:x=>logs.push(x)}};
 const t=new RunAwayFromHostilesTask(16);let now=100;t.now=()=>now;
 t.onTick(bot,ctx);
 assert.ok(t.heading.x>0.9,'east first (a wall costs less than running through the zombie)');
 assert.equal(bot.keys.forward,true);assert.equal(bot.keys.sprint,true);assert.equal(bot.keys.jump,false,'a wall is not a step');
 // pinned against the wall: the bot does not move
 now+=0.5;t.onTick(bot,ctx);assert.ok(t.heading.x>0.9);
 now+=0.5;t.onTick(bot,ctx);
 assert.equal(logs.length,1);
 assert.equal(logs[0],'Flee: no headway for 1.0 s heading east from (0, 64, 0) (ahead: feet stone, head stone); trying another way');
 assert.ok(Math.atan2(Math.abs(t.heading.z),t.heading.x)>0.6,'turned off east: '+JSON.stringify(t.heading));
 assert.equal(t.stuck,1);
 // moving again: no more lines
 for(let i=0;i<6;i++){now+=0.25;bot.entity.position=bot.entity.position.offset(t.heading.x*1.4,0,t.heading.z*1.4);t.onTick(bot,ctx);}
 assert.equal(logs.length,1);
 // the set-aside heading comes back after FLEE_AVOID_S
 now+=FLEE_AVOID_S;bot.entity.position=bot.entity.position.offset(2,0,0);t.onTick(bot,ctx);assert.equal(t._avoid.length,0);
 // a bot that stands for a long time logs FLEE_STUCK_LOGS lines, not one a second
 for(let i=0;i<20;i++){now+=0.5;t.onTick(bot,ctx);}
 assert.equal(logs.filter(l=>/^Flee: no headway/.test(l)).length,FLEE_STUCK_LOGS);
 t.onStop(bot);assert.equal(bot.keys.forward,false);assert.equal(bot.keys.jump,false);
});

test('round 109: the flee jumps the step that stopped it; a blocked heading stands without a jump',()=>{
 const bot=fleeBot({'1,64,0':S}),ctx={config:{chains:{}},worker:{log:()=>{}}};
 const t=new RunAwayFromHostilesTask(16);t.now=()=>0;
 t.onTick(bot,ctx);
 assert.ok(t.heading.x>0.9);assert.equal(bot.keys.jump,true,'the one-block step east: jump');
 // the bot standing in water to its feet and every way hazardous: stand (blocked), no jump
 const lake={};for(let x=-6;x<=6;x++)for(let z=-6;z<=6;z++)if(x||z)lake[x+','+64+','+z]=W;
 const b2=fleeBot(lake),t2=new RunAwayFromHostilesTask(16);t2.now=()=>0;
 t2.onTick(b2,ctx);
 assert.equal(t2.heading.blocked,true);assert.equal(b2.keys.forward,false);assert.equal(b2.keys.jump,false);
});

test('round 109: time off the flee (the fuse wall holding, another chain) does not count as no headway',()=>{
 assert.equal(FLEE_STUCK_GAP,0.5);
 const pocket={};for(let z=-3;z<=3;z++)for(const y of [64,65])pocket['1,'+y+','+z]=S;
 for(let x=-3;x<=0;x++)for(const z of [-1,1])for(const y of [64,65])pocket[x+','+y+','+z]=S;
 const bot=fleeBot(pocket),logs=[],ctx={config:{chains:{}},worker:{log:x=>logs.push(x)}};
 const t=new RunAwayFromHostilesTask(16);let now=0;t.now=()=>now;
 t.onTick(bot,ctx);now+=0.25;t.onTick(bot,ctx);
 // 2 s with the flee not ticking, then back: the headway clock starts again
 now+=2;t.onTick(bot,ctx);assert.equal(logs.length,0);
 now+=0.5;t.onTick(bot,ctx);assert.equal(logs.length,0);
 now+=0.5;t.onTick(bot,ctx);assert.equal(logs.length,1,'1 s of real flee ticks without headway');
 assert.ok(RunAwayFromCreepersTask);
});
