import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';
import {plan} from '../src/autopilot.js';
import {jobSchema} from '../src/schema.js';
import {coverCell,lineBlocked} from '../src/move-safety.js';
// Round 3 normal3, 17:14Z: 'shot by Skeleton' at [355,41,81] during the food-step explore,
// 90 blocks below the y=131 anchor. The graze is a surface activity: it gets a floor, and an
// unshielded bot under fire breaks line of sight instead of walking on.
const STONE_DONE={oak_log:4,oak_planks:8,stick:10,crafting_table:1,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,cobblestone:20,stone_pickaxe:1,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1};
const food=ctx=>plan({__proto__:null,...STONE_DONE,_edible:0},ctx);
test('the food explore carries a floor a few blocks under its anchor',()=>{
 let {step,job}=food({lastSurfaceY:131,standY:131});
 assert.equal(step,'food');assert.equal(job.type,'explore');
 assert.equal(job.surfaceCeiling,139);assert.equal(job.surfaceFloor,125);
 assert.equal(jobSchema.safeParse(job).success,true,'the strict schema takes it');
 ({job}=food({lastSurfaceY:131,standY:120}));
 assert.equal(job.surfaceFloor,120,'already below: it may not descend further, but the leg starts');
 ({job}=food({lastSurfaceY:131,standY:110}));
 assert.equal(job.type,'ascend','21 below the anchor (round 18): climb up first');
});
test('an explore with a floor arms the surface check and a path cost below it, then clears both',async()=>{
 const moves={exclusionAreasStep:[]};let seen=null;
 const fake={bot:{entity:{position:new Vec3(0,131,0)}},save(){},exploreMovements:()=>moves,
  async exploreLeg(){seen={floor:fake.surfaceFloor,hooks:moves.exclusionAreasStep.length,
   deep:moves.exclusionAreasStep[0]({position:{y:120}}),level:moves.exclusionAreasStep[0]({position:{y:128}})};}};
 await Worker.prototype.explore.call(fake,{spec:{type:'explore',distance:32,direction:'east',surfaceFloor:125}},0);
 assert.deepEqual(seen,{floor:125,hooks:1,deep:100,level:0});
 assert.equal(fake.surfaceFloor,null);assert.equal(moves.exclusionAreasStep.length,0);
});
// A flat field (floor y=63, stand y=64) with a 2-high wall at x=3, z=-1..1.
function field(wall=true){
 return (x,y,z)=>{
  const solid=y<=63||(wall&&x===3&&z>=-1&&z<=1&&(y===64||y===65));
  return {name:solid?'stone':'air',boundingBox:solid?'block':'empty'};
 };
}
test('lineBlocked sees a wall between two eyes, and open air as open',()=>{
 assert.equal(lineBlocked(field(),{x:10.5,y:65.62,z:0.5},{x:0.5,y:65.62,z:0.5}),true);
 assert.equal(lineBlocked(field(false),{x:10.5,y:65.62,z:0.5},{x:0.5,y:65.62,z:0.5}),false);
});
test('coverCell picks the nearest cell behind the wall, or none in an open field',()=>{
 const skeleton={x:12.5,y:64,z:0.5};
 const cell=coverCell(field(),{x:5.5,y:64,z:0.5},[skeleton]);
 assert.ok(cell,'a covered cell exists');
 assert.ok(cell.x<3,'behind the wall from the skeleton: '+JSON.stringify(cell));
 assert.equal(lineBlocked(field(),{x:12.5,y:65.62,z:0.5},{x:cell.x+0.5,y:cell.y+1.62,z:cell.z+0.5}),true);
 assert.equal(coverCell(field(false),{x:5.5,y:64,z:0.5},[skeleton]),null);
});
test('shot at with no shield: the explore leg stops and takes cover behind the wall',async()=>{
 const blockAt=field();
 const skeleton={name:'skeleton',type:'hostile',position:new Vec3(12.5,64,0.5)};
 const calls=[];
 const bot={health:20,entity:{position:new Vec3(5.5,64,0.5)},entities:{s:skeleton},inventory:{slots:[]},
  world:{raycast:()=>null},blockAt:p=>blockAt(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)),
  pathfinder:{setMovements(m){calls.push(['moves',m]);},setGoal(){},stop(){}},clearControlStates(){}};
 const fake={bot,epoch:0,movements:{id:'normal'},check(){},log(m){calls.push(['log',m]);},exploreMovements:()=>({id:'explore'}),
  takeCover:Worker.prototype.takeCover,
  navigate(){setTimeout(()=>{bot.health=16;},50);return new Promise(()=>{});},
  async walk(p){calls.push(['walk',p.x,p.y,p.z]);}};
 await assert.rejects(Worker.prototype.exploreLeg.call(fake,0,{direction:'east',distance:32}),/Shot at by skeleton with no shield/);
 const walk=calls.find(c=>c[0]==='walk');
 assert.ok(walk,'took cover: '+JSON.stringify(calls));
 assert.ok(walk[1]<3,'behind the wall');
 assert.ok(calls.some(c=>c[0]==='moves'&&c[1].id==='normal'),'the cover walk never digs (normal movements)');
 // With a shield in the off hand the leg is left to the shield and the fight chains.
 bot.health=20;calls.length=0;bot.inventory.slots[45]={name:'shield'};
 let fail=null;fake.navigate=()=>{setTimeout(()=>{bot.health=16;},50);return new Promise((_,r)=>setTimeout(()=>r(Error('timed out')),600));};
 await Worker.prototype.exploreLeg.call(fake,0,{direction:'east',distance:32}).catch(e=>{fail=e;});
 assert.match(fail.message,/timed out/);assert.ok(!calls.some(c=>c[0]==='walk'));
});
