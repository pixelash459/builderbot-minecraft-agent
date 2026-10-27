import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';
import {Blacklist} from '../src/trackers/blacklist.js';
// Canopy spawns (soak hard1/hard2, 2026-10-14): the bot sat for minutes on
// "Cannot reach or harvest this block" at the same few logs. A block that cannot be reached
// is skipped at once, by this job and (through the shared blacklist) by the next job.
function canopyFake({blacklist=new Blacklist(),logs,reachable=()=>false}={}){
 const registry={blocksByName:{oak_log:{id:1}},blocks:{1:{drops:[102],harvestTools:null}},items:{102:{name:'oak_log'}}};
 const world=new Map(logs.map(([x,y,z])=>[x+','+y+','+z,{name:'oak_log',type:1,position:new Vec3(x,y,z),boundingBox:'block'}]));
 const tries=[],logLines=[];let cobble=0;
 const bot={registry,entity:{position:new Vec3(0.5,130,0.5)},heldItem:{type:5},
  inventory:{items(){return [];},emptySlotCount(){return 30;}},
  pathfinder:{movements:null,setMovements(){}},
  findBlocks(){return [...world.values()].map(b=>b.position);},
  blockAt(p){return world.get(Math.floor(p.x)+','+Math.floor(p.y)+','+Math.floor(p.z))||null;},
  canDigBlock(b){return reachable(b);},
  tool:{async equipForBlock(b){tries.push(b.position.x+','+b.position.y+','+b.position.z);}},
  async dig(b){world.delete(b.position.x+','+b.position.y+','+b.position.z);cobble++;}};
 const w={bot,blacklist,config:{limits:{radius:32}},count(){return cobble;},save(){},check(){},update(){},
  log(m){logLines.push(m);},exploreMovements(){return {};},
  async walk(){},async reachUp(){},async descendToReach(){},async canopyDrop(){},async sweepDrops(){},async mineColumnUnder(){},
  gatherFailed:Worker.prototype.gatherFailed,gatherBlacklisted:Worker.prototype.gatherBlacklisted,searchMiss:Worker.prototype.searchMiss,takeStrandedTunnel:Worker.prototype.takeStrandedTunnel};
 return {w,tries,logLines,job:()=>({spec:{type:'gather',block:'oak_log',count:2,radius:32}})};
}
test('an unreachable block is tried once, skipped, and the job moves on to the next block',async()=>{
 const f=canopyFake({logs:[[2,128,0],[2,127,0],[5,128,3]]});
 await assert.rejects(Worker.prototype.gather.call(f.w,f.job(),0),/No matching blocks/);
 // Round 59: an unreachable log takes its trunk with it, so the second block of the 2,*,0 trunk
 // is never tried.
 assert.equal(f.tries.filter(k=>/^2,12[78],0$/.test(k)).length,1,f.tries.join(' '));
 assert.ok(f.tries.includes('5,128,3'));assert.equal(new Set(f.tries).size,f.tries.length,'each block at most once');
 assert.equal(f.logLines.filter(l=>/skipping oak_log/.test(l)).length,2);
});
test('the next gather job skips the blocks the last one could not reach (shared blacklist)',async()=>{
 const blacklist=new Blacklist();
 const f=canopyFake({blacklist,logs:[[2,128,0],[5,128,3]]});
 await assert.rejects(Worker.prototype.gather.call(f.w,f.job(),0),/No matching blocks/);
 const g=canopyFake({blacklist,logs:[[2,128,0],[5,128,3]]});
 await assert.rejects(Worker.prototype.gather.call(g.w,g.job(),0),/No matching blocks/);
 assert.deepEqual(g.tries,[],'no retry of a blacklisted block');
 // ...and a block it CAN reach still gets mined
 const h=canopyFake({blacklist,logs:[[2,128,0],[5,128,3],[1,129,1],[1,128,1]],reachable:b=>b.position.x===1});
 h.w.walk=async()=>{};
 await Worker.prototype.gather.call(h.w,h.job(),0);
 assert.ok(h.tries.every(k=>k.startsWith('1,')),h.tries.join(' '));
});
test('other errors blacklist a block on its second failure, counted per block',async()=>{
 // The old single counter blacklisted only the column of every third failure, so attempts
 // alternating between two trunks (A,B,A,B...) never blacklisted either one.
 const f=canopyFake({logs:[[2,128,0],[-2,128,0]],reachable:()=>true});
 let n=0;
 f.w.bot.dig=async()=>{n++;throw Error('Digging aborted');};
 await assert.rejects(Worker.prototype.gather.call(f.w,f.job(),0),/No matching blocks/);
 assert.equal(n,4,'two tries per block, then both skipped');
});
test('a missing tool fails the job at once instead of trying every block',async()=>{
 const f=canopyFake({logs:[[2,128,0],[5,128,3],[7,128,3]],reachable:()=>true});
 f.w.bot.registry.blocks[1].harvestTools={9:true};
 await assert.rejects(Worker.prototype.gather.call(f.w,f.job(),0),/suitable harvesting tool/);
 assert.equal(f.tries.length,1);
});
// Round 9 hard2: never a log in 20 min. The hard runs share one anchor, so run 2 starts among
// run 1's leftovers: canopy logs out of reach above and refused stubs. They are "in range",
// so searchIfMissing never fired and the gather failed in place every time.
test('leftover logs only out of reach: the gather searches further afield instead of failing',async()=>{
 const f=canopyFake({logs:[[2,140,0],[3,141,1],[-2,139,2]],reachable:b=>b.position.x>=100});
 const legs=[];
 f.w.exploreLeg=async(token,o)=>{legs.push(o.direction);f.w.bot.entity.position=new Vec3(100.5,130,0.5);
  const p=new Vec3(102,130,0);f.w.bot.blockAt=q=>Math.floor(q.x)===102&&Math.floor(q.y)===130&&Math.floor(q.z)===0&&!f.dug?{name:'oak_log',type:1,position:p,boundingBox:'block'}:null;
  f.w.bot.findBlocks=()=>f.dug?[]:[p];};
 f.w.bot.dig=async()=>{f.dug=true;f.n=(f.n||0)+1;};f.w.count=()=>f.n||0;
 const job={spec:{type:'gather',block:'oak_log',count:1,radius:32,searchIfMissing:true,belowFoots:true}};
 await Worker.prototype.gather.call(f.w,job,0);
 assert.deepEqual(legs,['east']);assert.equal(f.n,1);
});
test('a grove with 8 refused columns is exhausted, not unsafe: searchIfMissing looks elsewhere',async()=>{
 const logs=[];for(let i=0;i<9;i++)logs.push([i*2-8,130,3],[i*2-8,131,3]); // 2-log stubs: a column drops after 3 failures
 // the 1 s rescan pause between attempts would take 70 s here: a clock that runs 2 s per read
 const real=Date.now;let t=real();Date.now=()=>(t+=2000);
 try{
 const f=canopyFake({logs,reachable:()=>true});
 let digs=0;f.w.bot.dig=async()=>{digs++;throw Error('Digging aborted');};
 const legs=[];f.w.exploreLeg=async(token,o)=>{legs.push(o.direction);f.w.bot.findBlocks=()=>[];};
 const job={spec:{type:'gather',block:'oak_log',count:2,radius:32,searchIfMissing:true}};
 await assert.rejects(Worker.prototype.gather.call(f.w,job,0),/No matching blocks/);
 assert.ok(legs.length>=1,'searched after the refusals');
 assert.ok(f.logLines.some(l=>/refused here; searching further afield/.test(l)),f.logLines.join('|'));
 // without searchIfMissing the old failure stands
 const g=canopyFake({logs,reachable:()=>true});g.w.bot.dig=async()=>{throw Error('Digging aborted');};
 await assert.rejects(Worker.prototype.gather.call(g.w,g.job(),0),/Cannot gather safely/);
 }finally{Date.now=real;}
});
// Round 10, bug D (round-9 hard1: wood at 543 s, after 24 refused canopy blocks and fixed
// east/north/west/south legs).
import {searchHeading,SEARCH_REFUSALS} from '../src/worker.js';
test('searchHeading: the cardinal toward the nearest unseen match',()=>{
 assert.equal(searchHeading(new Vec3(0.5,64,0.5),[]),null);
 const h=searchHeading(new Vec3(0.5,64,0.5),[new Vec3(-60,64,10),new Vec3(5,64,-41),new Vec3(80,64,0)]);
 assert.deepEqual([h.direction,h.target],['north','5,64,-41']);
 assert.ok(h.distance>=41&&h.distance<=42);
});
test('a searchable gather leaves a refusing grove after 5 columns, and heads for logs it can see',async()=>{
 const logs=[];for(let i=0;i<6;i++)logs.push([i*2-6,130,3],[i*2-6,131,3]);
 const real=Date.now;let t=real();Date.now=()=>(t+=2000);
 try{
  const f=canopyFake({logs,reachable:()=>true});
  let digs=0;f.w.bot.dig=async()=>{digs++;throw Error('Digging aborted');};
  const far=new Vec3(-70,131,4);
  const near=f.w.bot.findBlocks;
  f.w.bot.findBlocks=o=>o.maxDistance>32?[...near(),far]:near();
  const legs=[];f.w.exploreLeg=async(token,o)=>{legs.push([o.direction,o.distance]);f.w.bot.findBlocks=()=>[];};
  const job={spec:{type:'gather',block:'oak_log',count:2,radius:32,searchIfMissing:true,belowFoots:true}};
  await assert.rejects(Worker.prototype.gather.call(f.w,job,0),/No matching blocks/);
  assert.equal(legs[0][0],'west','toward the far log, not the fixed east');
  assert.ok(legs[0][1]>24&&legs[0][1]<=64,'a leg long enough to reach it: '+legs[0][1]);
  assert.ok(f.logLines.some(l=>new RegExp(SEARCH_REFUSALS[0]+' columns / \\d+ blocks refused here').test(l)),f.logLines.join('|'));
  assert.ok(f.logLines.some(l=>/search leg 1 west toward oak_log at -70,131,4/.test(l)));
 }finally{Date.now=real;}
});
// Round 11 hard2: `no diggable target left` at a 131 stand with the logs at 136-137 (a tall
// dark-oak canopy over trunks cut by an earlier run): pillar up under them, then chop.
test('canopy logs above the reach band: the gather pillars up under them and chops them',async()=>{
 const f=canopyFake({logs:[[0,136,0],[0,137,0]],reachable:b=>f.w.bot.entity.position.y>=133});
 f.w.bot.entity.position=new Vec3(0.5,131,0.5);
 const held=[{name:'oak_log',count:0}],dig=f.w.bot.dig;
 f.w.bot.inventory.items=()=>held.filter(i=>i.count>0);f.w.bot.dig=async bl=>{await dig(bl);held[0].count++;};
 const pillars=[];
 f.w.pillarToLog=async(job,token,log)=>{pillars.push(log.toString());f.w.bot.entity.position=new Vec3(0.5,133,0.5);return true;};
 await Worker.prototype.gather.call(f.w,{spec:{type:'gather',block:'log',count:2,radius:32,belowFoots:true}},0);
 assert.deepEqual(pillars,['(0, 136, 0)'],'the lowest canopy log, once');
 assert.ok(f.tries.includes('0,136,0')&&f.tries.includes('0,137,0'),f.tries.join(' '));
});
import {TRUNK_PILLAR} from '../src/worker.js';
test('pillarToLog: under the log, dirt in hand, leaves over the head dug, up until it is 3 above the feet',async()=>{
 const cells=new Map([['0,136,0','oak_log'],['0,134,0','oak_leaves']]);
 const solid=n=>n&&!/air/.test(n);
 const nameAt=(x,y,z)=>cells.get(x+','+y+','+z)??(y<=130?'grass_block':'air');
 const blockAt=p=>{const x=Math.floor(p.x),y=Math.floor(p.y),z=Math.floor(p.z),name=nameAt(x,y,z);return {name,position:new Vec3(x,y,z),boundingBox:solid(name)?'block':'empty'};};
 const inv=[{name:'dirt',count:4}],logs=[]; // round 62: the rise (2) plus PILLAR_SPARE (2)
 const bot={entity:{position:new Vec3(0.5,131,0.5)},blockAt,inventory:{items:()=>inv.filter(i=>i.count>0)},
  async equip(){},async dig(bl){cells.set(bl.position.x+','+bl.position.y+','+bl.position.z,'air');},
  setControlState(c,v){if(c==='jump'&&v)bot.entity.position=bot.entity.position.offset(0,1.2,0);},
  clearControlStates(){let p=bot.entity.position.floored();while(!solid(nameAt(p.x,p.y-1,p.z)))p=p.offset(0,-1,0);bot.entity.position=new Vec3(p.x+0.5,p.y,p.z+0.5);},
  async placeBlock(ref,face){const t=ref.position.plus(face);cells.set(t.x+','+t.y+','+t.z,'dirt');inv[0].count--;}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,check(){},log(m){logs.push(m);},async walk(){},
  count(n){return inv.filter(i=>i.name===n).reduce((a,i)=>a+i.count,0);}});
 assert.equal(await w.pillarToLog({},0,new Vec3(0,136,0)),true,logs.join('\n'));
 assert.equal(bot.entity.position.floored().y,133);
 assert.equal(nameAt(0,134,0),'air','the leaf over the head was dug');
 assert.ok(logs.some(l=>/pillaring 2 up to the canopy log at \(0, 136, 0\)/.test(l)));
 assert.equal(await w.pillarToLog({},0,new Vec3(0,133+3+TRUNK_PILLAR+1,0)),false,'too high: no pillar');
});
