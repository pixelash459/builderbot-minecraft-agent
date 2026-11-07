import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';
import {Blacklist} from '../src/trackers/blacklist.js';

// Round 103: the round-102 hard1 wood step. A job begun on a hill at y=80-81 walked its search leg down
// to the oak at (756, 74-77, -602). Only the top log passed the surface floor, the walk to it found no
// path, the trunk was blacklisted, and the wooden pick came 1054 s in, over 500 blocks away.
const P=(x,y,z)=>x+','+y+','+z;
function hill({logs=[[756,74,-602],[756,75,-602],[756,76,-602],[756,77,-602]],start=[760,81,-530],end=[761,77,-596],sky=15,block='log',surface=true,walkFails=p=>p.y>=77}={}){
 const registry={blocksByName:{oak_log:{id:1},iron_ore:{id:2}},blocks:{1:{drops:[102],harvestTools:null},2:{drops:[103],harvestTools:null}},items:{102:{name:'oak_log'},103:{name:'raw_iron'}}};
 const world=new Map(logs.map(([x,y,z])=>[P(x,y,z),{name:block==='log'?'oak_log':block,type:block==='iron_ore'?2:1,position:new Vec3(x,y,z),boundingBox:'block'}]));
 const log=[],walks=[],dug=[],legs=[];let got=0,arrived=false;
 const bot={registry,entity:{position:new Vec3(start[0]+.5,start[1],start[2]+.5),eyeHeight:1.62},heldItem:{type:5},
  inventory:{items(){return got?[{name:'oak_log',count:got}]:[];},emptySlotCount(){return 30;}},pathfinder:{movements:null,setMovements(){}},entities:{},
  // nothing in sight from the hill: the logs come into range at the end of the leg
  findBlocks(){return arrived?[...world.values()].map(b=>b.position):[];},
  blockAt(p){return world.get(P(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)))||{name:'air',boundingBox:'empty',skyLight:sky};},
  canDigBlock(b){return arrived&&!walkFails(b.position);},
  tool:{async equipForBlock(){}},
  async dig(b){world.delete(P(b.position.x,b.position.y,b.position.z));dug.push(b.position.y);got++;}};
 const w={bot,blacklist:new Blacklist(),config:{limits:{radius:32}},count(){return got;},save(){},check(){},update(){},
  log(m){log.push(m);},exploreMovements(){return {};},
  async exploreLeg(token,o){legs.push(o);bot.entity.position=new Vec3(end[0]+.5,end[1],end[2]+.5);arrived=true;},
  async walk(p){walks.push(p.y);if(walkFails(p))throw Error('No path to the goal!');},
  async reachUp(){},async descendToReach(){},async canopyDrop(){},async sweepDrops(){},async mineColumnUnder(){},
  gatherFailed:Worker.prototype.gatherFailed,gatherBlacklisted:Worker.prototype.gatherBlacklisted,searchMiss:Worker.prototype.searchMiss,takeStrandedTunnel:Worker.prototype.takeStrandedTunnel};
 return {w,log,walks,dug,legs,bot,job:{spec:{type:'gather',block,count:3,radius:32,searchIfMissing:true,belowFoots:true,surface}}};
}
const run=async f=>{try{await Worker.prototype.gather.call(f.w,f.job,0);return null;}catch(e){return e;}};

test('round 103: the round-102 oak: down from the hill, the top log has no walk, the trunk is cut from its foot',async()=>{
 const f=hill();
 assert.equal(await run(f),null,f.log.join('|'));
 assert.equal(f.job.surfaceY,77,'the floor came down with the leg');
 assert.ok(f.log.includes('Gather: the surface floor comes down from y=77 to y=73 at the end of the leg'),f.log.join('|'));
 assert.ok(f.log.includes('Gather: no walk to the oak_log at 756,77,-602; trying the foot of the trunk'),f.log.join('|'));
 assert.deepEqual(f.dug,[74,75,76]);
 assert.equal(f.log.some(l=>/^Gather: skipping/.test(l)),false,f.log.join('|'));
 assert.equal(f.w.gatherBlacklisted({},new Vec3(756,74,-602)),false,'the trunk is not blacklisted');
});
test('round 103: a leg that ends under a roof leaves the floor where it was',async()=>{
 const f=hill({sky:4});
 const e=await run(f);
 assert.equal(f.job.surfaceY,81);
 assert.equal(f.log.some(l=>/surface floor comes down/.test(l)),false);
 assert.ok(e,'nothing but the top log passes the old floor');
 assert.ok(f.log.some(l=>/^Gather: skipping oak_log at 756,77,-602/.test(l)),f.log.join('|'));
});
test('round 103: a leg that ends higher up leaves the floor where it was',async()=>{
 const f=hill({start:[760,70,-530],end:[761,77,-596],walkFails:()=>false});
 assert.equal(await run(f),null,f.log.join('|'));
 assert.equal(f.job.surfaceY,70);
});
test('round 103: only the wood step has a floor to bring down',async()=>{
 const f=hill({surface:false,walkFails:()=>false});
 assert.equal(await run(f),null,f.log.join('|'));
 assert.equal(f.job.surfaceY,undefined);
 assert.equal(f.log.some(l=>/surface floor comes down/.test(l)),false);
});
test('round 103: a foot with no walk either takes the trunk, as in round 59',async()=>{
 const f=hill({walkFails:()=>true});
 const e=await run(f);
 assert.ok(e);
 assert.equal(f.walks.filter(y=>y===77).length,1,f.walks.join(' '));
 assert.equal(f.walks.filter(y=>y===74).length,1,'the foot, once: '+f.walks.join(' '));
 assert.equal(f.walks.length,2,'nothing between the top and the foot: '+f.walks.join(' '));
 assert.ok(f.log.some(l=>/^Gather: skipping oak_log at 756,74,-602/.test(l)),f.log.join('|'));
 for(const y of [74,75,76,77])assert.equal(f.w.gatherBlacklisted({},new Vec3(756,y,-602)),true,'y='+y);
});
test('round 103: the walk reached the tree and it still cannot be dug: no second try',()=>{
 const seen=new Set(),w=Object.create(Worker.prototype);
 Object.assign(w,{logs:[],log(m){this.logs.push(m);},save(){},blacklist:{block:p=>seen.add(P(p.x,p.y,p.z)),blockRecently:p=>seen.has(P(p.x,p.y,p.z))}});
 const job={spec:{type:'gather',block:'log'}};
 w.gatherFailed(job,{name:'oak_log',position:new Vec3(1,70,1)},Error('Cannot reach or harvest this block (walk ok; bot at (0, 66, 0), 6.4 from the eye)'),true);
 assert.ok(job.badColumns.includes('1,1'));assert.equal(w.gatherBlacklisted({},new Vec3(1,66,1)),true);
});
test('round 103: the lowest log, and an ore, go as they did',()=>{
 const seen=new Set(),w=Object.create(Worker.prototype);
 Object.assign(w,{logs:[],log(m){this.logs.push(m);},save(){},blacklist:{block:p=>seen.add(P(p.x,p.y,p.z)),blockRecently:p=>seen.has(P(p.x,p.y,p.z))}});
 const msg=Error('Cannot reach or harvest this block (walk: No path to the goal!; bot at (0, 66, 0), 6.4 from the eye)');
 const low={spec:{type:'gather',block:'log'}};
 w.gatherFailed(low,{name:'oak_log',position:new Vec3(1,70,1)},msg,false);
 assert.ok(low.badColumns.includes('1,1'),'no log below it: the trunk goes at once');
 const ore={spec:{type:'gather',block:'iron_ore'}};
 w.gatherFailed(ore,{name:'iron_ore',position:new Vec3(5,40,5)},msg,true);
 assert.deepEqual(ore.badColumns,[]);assert.ok(w.logs.some(l=>/^Gather: skipping iron_ore at 5,40,5/.test(l)));
});
