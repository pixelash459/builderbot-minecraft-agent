import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {MobDefenseChain,FLEE_PINNED_S,PINNED_NEAR,PINNED_KEEP} from '../src/chains/mobDefenseChain.js';
import {RunAwayFromCreepersTask} from '../src/chains/fallbackTasks.js';
console.error=()=>{};

// Round 91: the round-90 soak on the Nitrous world copy (hard2 slain by a zombie 1.2 away, the flees
// holding it in one cell for its last minute, and six fuse walls with no done line).
const mob=(id,name,x,z=0.5)=>({id,name,type:'hostile',position:new Vec3(x,71,z),isValid:true,height:1.95});
function pinnedBot({health=5.7,entities={},solid=()=>false}={}){
 return {entity:{position:new Vec3(0.5,71,0.5),onGround:true},entities,health,food:16,
  inventory:{items:()=>[{name:'stone_sword',count:1,slot:36},{name:'cobblestone',count:83,slot:37}],slots:[]},
  registry:{foodsByName:{}},time:{timeOfDay:6000},heldItem:{name:'stone_sword'},
  blockAt:p=>{const s=solid(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z));return {name:s?'stone':'air',boundingBox:s?'block':'empty',position:p.floored()};}};
}
const chainCtx=logs=>({config:{chains:{}},move:{},trackers:{},blacklist:{},worker:{log:m=>logs.push(m)}});
// Round 107 fights a melee mob that keeps up with a flee for 1 s (round107.test.js); these tests
// keep to the round-91 pinned path on its own.
class PinnedOnly extends MobDefenseChain{_chasedBy(){return null;}}

test('round 91: a vulnerable flee that has not moved the bot, a zombie 1.2 away - cornered, it fights back',()=>{
 assert.equal(FLEE_PINNED_S,2);assert.equal(PINNED_NEAR,3);assert.equal(PINNED_KEEP,5);
 // round-90 hard2: health 5.7, stone sword held, a zombie 1.2 away, the bot at (847, 71, -625) the whole time
 const bot=pinnedBot({entities:{7:mob(7,'zombie',1.7)}}),logs=[],m=new PinnedOnly(),ctx=chainCtx(logs);
 let t=1000;m.now=()=>t;
 assert.equal(m.priority(bot,ctx),70,'the vulnerable flee first');
 assert.equal(m.root.name,'RunAwayFromHostilesTask');
 assert.match(logs.at(-1),/\(vulnerable\)$/);
 t+=1;assert.equal(m.priority(bot,ctx),70,'the pin starts on the first flee tick');
 t+=1;assert.equal(m.priority(bot,ctx),70,'1 s pinned: still fleeing');
 t+=1.1;assert.equal(m.priority(bot,ctx),85,'2 s pinned: cornered');
 assert.equal(m.root.name,'KillEntitiesTask');assert.equal(m.root.lastResort,true);
 assert.equal(logs.at(-1),'Reflex: the RunAwayFromHostilesTask has kept the bot in one spot for 2.1 s with zombie 1.2 away (health 5.7, held stone_sword); cornered - fighting back');
 // knocked back to 4: the fight keeps on inside PINNED_KEEP, and logs once
 bot.entities[7]=mob(7,'zombie',4.5);
 t+=0.5;assert.equal(m.priority(bot,ctx),85);
 assert.equal(logs.filter(l=>/cornered/.test(l)).length,1);
 // past PINNED_KEEP: back to the flee, and the pin starts over
 bot.entities[7]=mob(7,'zombie',6.5);
 t+=0.5;assert.equal(m.priority(bot,ctx),70);assert.equal(m.root.name,'RunAwayFromHostilesTask');
 bot.entities[7]=mob(7,'zombie',1.7);
 t+=0.5;assert.equal(m.priority(bot,ctx),70,'not pinned again yet');
});

test('round 91: no cornered fight for a flee that moves, a zombie behind a wall, or only a creeper near',()=>{
 // the flee moves the bot: never cornered
 {const bot=pinnedBot({entities:{7:mob(7,'zombie',1.7)}}),logs=[],m=new PinnedOnly(),ctx=chainCtx(logs);let t=0;m.now=()=>t;
  for(let i=0;i<10;i++){t+=1;bot.entity.position=new Vec3(0.5+i*1.5,71,0.5);bot.entities[7]=mob(7,'zombie',bot.entity.position.x+1.2);assert.equal(m.priority(bot,ctx),70);}
  assert.ok(!logs.some(l=>/cornered/.test(l)));}
 // the zombie is through a wall (the night box): not in sight, no fight
 {const bot=pinnedBot({entities:{7:mob(7,'zombie',2)},solid:(x,y,z)=>x===1&&(y===71||y===72)}),logs=[],m=new PinnedOnly(),ctx=chainCtx(logs);let t=0;m.now=()=>t;
  for(let i=0;i<5;i++){t+=1;assert.notEqual(m.priority(bot,ctx),85);}
  assert.ok(!logs.some(l=>/cornered/.test(l)));}
 // a creeper is never the cornered melee target: the keep-away stays (round 95: until the chase
 // has run CREEPER_CHASE_S with it inside 6 - then the pillar fight, still not the cornered line)
 {const bot=pinnedBot({health:20,entities:{9:mob(9,'creeper',2.5)}}),logs=[],m=new PinnedOnly(),ctx=chainCtx(logs);let t=0;m.now=()=>t;
  for(let i=0;i<5;i++){t+=1;m.priority(bot,ctx);assert.equal(m.root.constructor.name,i<3?'RunAwayFromCreepersTask':'FightTask');}
  assert.ok(logs.some(l=>/closed to [\d.]+ through the keep-away; fighting it from a pillar$/.test(l)));
  assert.ok(!logs.some(l=>/cornered/.test(l)));}
 // a skeleton 2 away (ranged) is not a cornering melee mob (the old isCornered ladder step still answers it)
 {const bot=pinnedBot({entities:{8:mob(8,'skeleton',2.5)}}),logs=[],m=new PinnedOnly(),ctx=chainCtx(logs);let t=0;m.now=()=>t;
  for(let i=0;i<5;i++){t+=1;m.priority(bot,ctx);}
  assert.ok(!logs.some(l=>/cornered/.test(l)));}
});

test('round 91: a creeper keep-away pinned with a zombie in reach fights the zombie, and the line names the heading',()=>{
 const bot=pinnedBot({health:18,entities:{9:mob(9,'creeper',-4.5),7:mob(7,'zombie',2.2)}}),logs=[],m=new PinnedOnly(),ctx=chainCtx(logs);
 let t=0;m.now=()=>t;
 m.priority(bot,ctx);assert.equal(m.root.name,'RunAwayFromCreepersTask');
 t+=0.5;m.priority(bot,ctx);
 for(let i=0;i<3;i++){t+=0.5;assert.ok(m.priority(bot,ctx)<85,'not yet 2 s');}
 m.root.heading={x:1,z:0,hazard:100,blocked:true}; // what the last flee tick chose
 t+=0.5;assert.equal(m.priority(bot,ctx),85);
 assert.equal(logs.at(-1),'Reflex: the RunAwayFromCreepersTask has kept the bot in one spot for 2.0 s with zombie 1.7 away (health 18, held stone_sword, heading hazard 100 blocked); cornered - fighting back');
 const targets=m.root.currentTargets(bot,ctx).map(e=>e.name);
 assert.deepEqual(targets,['zombie'],'the creeper is not a target');
});

test('round 91: a fuse wall whose flee is replaced logs its done line on stop',()=>{
 const logs=[],task=new RunAwayFromCreepersTask(7,{fuse:true});
 task._wall0={cells:[{x:1,y:71,z:0},{x:1,y:72,z:0}],placed:1,held:'cobblestone 83',w:{log:m=>logs.push(m)}};
 const bot={blockAt:p=>({name:p.y===71?'cobblestone':'air',boundingBox:p.y===71?'block':'empty'}),setControlState(){},clearControlStates(){}};
 task.onStop(bot,true);
 assert.deepEqual(logs,['Reflex: the fuse wall is done: 1 block(s) placed, 1 of 2 cell(s) standing (held cobblestone 83) - the fuse flee was replaced']);
 task.onStop(bot,true);assert.equal(logs.length,1,'once');
});
