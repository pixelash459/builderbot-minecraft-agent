import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,crowdAt,ORE_CROWD,ORE_CROWD_R,MOB_CAVE_MS} from '../src/worker.js';
import {Blacklist} from '../src/trackers/blacklist.js';
console.error=()=>{};

// Round 114: the round-113 hard1 death 1 - three minutes fleeing a 40+ mob crowd round a cave,
// then the iron gather picked an ore in that cave and the bot was shot dead 8 s after the
// `a mob cave` line (logged only once it was inside). An ore with ORE_CROWD+ hostiles within
// ORE_CROWD_R of it is not picked, and its spot is marked a mob cave.
function fake({ores,mobs=[],block='iron_ore'}){
 const registry={blocksByName:{[block]:{id:1}},blocks:{1:{drops:[102],harvestTools:null}},items:{102:{name:block==='iron_ore'?'raw_iron':block}}};
 const world=new Map(ores.map(([x,y,z])=>[x+','+y+','+z,{name:block,type:1,position:new Vec3(x,y,z),boundingBox:'block'}]));
 const entities={};mobs.forEach(([name,x,y,z,meta],i)=>{entities[i+10]={id:i+10,name,type:'hostile',position:new Vec3(x,y,z),metadata:meta||[]};});
 const dug=[],logLines=[];let n=0;
 const bot={registry,entity:{position:new Vec3(0.5,40,0.5)},heldItem:{type:5},entities,
  inventory:{items(){return [];},emptySlotCount(){return 30;}},
  pathfinder:{movements:null,setMovements(){}},
  findBlocks(){return [...world.values()].map(b=>b.position);},
  blockAt(p){return world.get(Math.floor(p.x)+','+Math.floor(p.y)+','+Math.floor(p.z))||null;},
  canDigBlock(){return true;},
  tool:{async equipForBlock(){}},
  async dig(b){world.delete(b.position.x+','+b.position.y+','+b.position.z);dug.push(b.position.x+','+b.position.y+','+b.position.z);n++;}};
 const w={bot,blacklist:new Blacklist(),config:{limits:{radius:32}},count(){return n;},save(){},check(){},update(){},
  log(m){logLines.push(m);},exploreMovements(){return {};},
  async walk(){},async reachUp(){},async descendToReach(){},async canopyDrop(){},async sweepDrops(){},async mineColumnUnder(){},
  gatherFailed:Worker.prototype.gatherFailed,gatherBlacklisted:Worker.prototype.gatherBlacklisted,searchMiss:Worker.prototype.searchMiss,
  takeStrandedTunnel:Worker.prototype.takeStrandedTunnel,markMobCave:Worker.prototype.markMobCave,nearHazard:Worker.prototype.nearHazard};
 return {w,dug,logLines,bot};
}
// a crowd of `k` mobs of `name` round (x, y, z), each within 6
const crowd=(name,k,[x,y,z])=>Array.from({length:k},(_,i)=>[name,x+(i%3)-1,y,z+Math.floor(i/3)-1]);

test('round 114: the nearer ore with a crowd round it is passed over for a clear one, and its spot is marked',async()=>{
 assert.equal(ORE_CROWD,6);assert.equal(ORE_CROWD_R,16);
 const f=fake({ores:[[8,40,0],[-20,40,0]],mobs:[...crowd('zombie',4,[12,40,0]),...crowd('skeleton',3,[10,41,4])]});
 await Worker.prototype.gather.call(f.w,{spec:{type:'gather',block:'iron_ore',count:1,radius:32}},0);
 assert.deepEqual(f.dug,['-20,40,0'],'the clear ore, not the one in the cave');
 const line=f.logLines.find(l=>/^Gather: iron_ore at/.test(l));
 assert.ok(line,f.logLines.join('\n'));
 assert.match(line,/^Gather: iron_ore at \(8, 40, 0\) has 7 hostiles within 16 of it \(((zombie|skeleton) [\d.]+, ){3}(zombie|skeleton) [\d.]+ and 3 more\); a mob cave - its ores set aside for 20 min$/);
 assert.equal(f.w.mobCaves.length,1);
 assert.deepEqual([f.w.mobCaves[0].x,f.w.mobCaves[0].y,f.w.mobCaves[0].z],[8,40,0]);
 assert.ok(f.w.mobCaves[0].until-Date.now()>MOB_CAVE_MS-5000);
 // the next job: ores near the marked spot are set aside, with no second line
 const g=fake({ores:[[10,40,6],[-20,40,0]]});g.w.mobCaves=f.w.mobCaves;
 await Worker.prototype.gather.call(g.w,{spec:{type:'gather',block:'iron_ore',count:1,radius:32}},0);
 assert.deepEqual(g.dug,['-20,40,0']);
 assert.equal(g.logLines.filter(l=>/a mob cave/.test(l)).length,0);
});

test('round 114: under the crowd count, calm endermen, a far crowd and a wood gather are all unchanged',async()=>{
 // 5 hostiles round the ore: one short of a crowd - the nearer ore is mined
 const a=fake({ores:[[8,40,0],[-14,40,0]],mobs:crowd('zombie',5,[10,40,0])});
 await Worker.prototype.gather.call(a.w,{spec:{type:'gather',block:'iron_ore',count:1,radius:32}},0);
 assert.deepEqual(a.dug,['8,40,0']);
 // 7 calm endermen are no crowd; 7 angry ones are
 const b=fake({ores:[[8,40,0],[-14,40,0]],mobs:crowd('enderman',7,[10,40,0])});
 await Worker.prototype.gather.call(b.w,{spec:{type:'gather',block:'iron_ore',count:1,radius:32}},0);
 assert.deepEqual(b.dug,['8,40,0']);
 const angry=crowd('enderman',7,[10,40,0]).map(m=>[...m,Object.assign([],{17:true})]);
 assert.equal(crowdAt(fake({ores:[],mobs:angry}).bot,new Vec3(8,40,0)).length,7);
 // the crowd 20 from the ore (beyond 16) does not count
 const c=fake({ores:[[8,40,0],[-14,40,0]],mobs:crowd('zombie',8,[28,40,0])});
 await Worker.prototype.gather.call(c.w,{spec:{type:'gather',block:'iron_ore',count:1,radius:32}},0);
 assert.deepEqual(c.dug,['8,40,0']);
 // logs are not ores: a wood gather keeps its old choice
 const d=fake({block:'oak_log',ores:[[8,40,0],[-14,40,0]],mobs:crowd('zombie',8,[10,40,0])});
 await Worker.prototype.gather.call(d.w,{spec:{type:'gather',block:'oak_log',count:1,radius:32}},0);
 assert.deepEqual(d.dug,['8,40,0']);
 assert.equal(d.w.mobCaves,undefined);
});

test('round 114: with every ore in a crowd the job searches further afield instead of walking in',async()=>{
 const f=fake({ores:[[8,40,0],[9,40,2]],mobs:crowd('zombie',7,[10,40,1])});
 const legs=[];
 f.w.exploreLeg=async(token,o)=>{legs.push(o.direction);f.bot.entity.position=new Vec3(-60.5,40,0.5);
  const p=new Vec3(-62,40,0);f.bot.blockAt=q=>Math.floor(q.x)===-62&&Math.floor(q.y)===40&&Math.floor(q.z)===0&&!f.done?{name:'iron_ore',type:1,position:p,boundingBox:'block'}:null;
  f.bot.findBlocks=()=>f.done?[]:[p];f.bot.dig=async()=>{f.done=true;f.dug.push('-62,40,0');};f.w.count=()=>f.done?1:0;};
 await Worker.prototype.gather.call(f.w,{spec:{type:'gather',block:'iron_ore',count:1,radius:32,searchIfMissing:true}},0);
 assert.equal(legs.length,1,f.logLines.join('\n'));
 assert.deepEqual(f.dug,['-62,40,0'],'no dig in the cave');
 assert.ok(f.logLines.some(l=>/only refused iron_ore/.test(l)),f.logLines.join('\n'));
});
