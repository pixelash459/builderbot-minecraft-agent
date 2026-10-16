// Round 10, bug A: round-9 normal2 'fell from a high place' at (444,13,10) on the diamond
// rung and normal3 fell 18.4 -> 12.4 -> 3.5 hp on its staircase. The ore staircase (and the
// strip mine) never looked under the next step, so a cave or ravine opening there dropped
// the bot. Now every step's footing is checked two cells down: a shallow hole is filled, a
// deep opening turns the tunnel, and no safe way on stops it - the bot never drops > 1.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,planTunnelStep,descendLeg,STAIR_TURNS} from '../src/worker.js';
import {stepFooting,turnOrder} from '../src/digDown.js';

// Stone below y=130, air above; `edit` overrides cells ('x,y,z' -> name).
function world(edit={}){
 const cells=new Map(Object.entries(edit));
 const nameAt=(x,y,z)=>{const k=x+','+y+','+z;if(cells.has(k))return cells.get(k);return y>=130?'air':'stone';};
 const blockAt=(x,y,z)=>{const name=nameAt(x,y,z);return {name,position:new Vec3(x,y,z),boundingBox:/air|water|lava/.test(name)?'empty':'block'};};
 const set=(x,y,z,name)=>cells.set(x+','+y+','+z,name);
 return {nameAt,blockAt,set};
}
const solidAt=(w,x,y,z)=>w.blockAt(x,y,z).boundingBox==='block';
// A cave: every cell in the box is air.
const carve=(w,[x0,x1],[y0,y1],[z0,z1])=>{for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++)w.set(x,y,z,'air');};
function digger(w,start=new Vec3(0.5,130,0.5),items=[{name:'cobblestone',count:16}]){
 const placed=[],drops=[],logs=[];
 const bot={entity:{position:start.clone()},entities:{},heldItem:null,
  blockAt:p=>w.blockAt(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)),
  inventory:{items:()=>items.filter(i=>i.count>0)},tool:{async equipForBlock(){}},
  async equip(item){bot.heldItem=item;},
  async placeBlock(support,face){const p=support.position.plus(face);w.set(p.x,p.y,p.z,bot.heldItem.name);bot.heldItem.count--;placed.push(p.x+','+p.y+','+p.z);},
  async dig(bl){w.set(bl.position.x,bl.position.y,bl.position.z,'air');}};
 const worker=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,check(){},save(){},log(m){logs.push(m);},async placeTorch(){},
  // Walk into the cell, then fall like the game does until something solid is underfoot.
  async stepInto(next){
   let y=next.y;while(y>100&&!solidAt(w,next.x,y-1,next.z))y--;
   drops.push(next.y-y);bot.entity.position=new Vec3(next.x+0.5,y,next.z+0.5);
  }});
 return {bot,worker,placed,drops,logs};
}

test('stepFooting: solid floor ok, a shallow hole is filled, a deep opening or lava turns',()=>{
 const w=world();
 assert.deepEqual(stepFooting(w.blockAt,{x:1,y:129,z:0}),{ok:true});
 // A one-deep pocket under the step: fill it from the block below (top face).
 w.set(1,128,0,'air');
 const fill=stepFooting(w.blockAt,{x:1,y:129,z:0});
 assert.deepEqual(fill.fill,{x:1,y:128,z:0});
 assert.deepEqual([fill.support,fill.face],[{x:1,y:127,z:0},{x:0,y:1,z:0}]);
 // Three deep: a cave opening, not a pocket.
 w.set(1,127,0,'air');w.set(1,126,0,'air');
 assert.match(stepFooting(w.blockAt,{x:1,y:129,z:0}).turn,/cave opening/);
 const lava=world({'1,127,0':'lava'});
 assert.match(stepFooting(lava.blockAt,{x:1,y:129,z:0}).turn,/lava two below/);
 const loose=world({'1,128,0':'gravel','1,127,0':'air'});
 assert.match(stepFooting(loose.blockAt,{x:1,y:129,z:0}).turn,/loose gravel over a hollow/);
 // One-deep water on solid ground (a lake edge): filled like a hole (round 11 diamond trips).
 const puddle=world({'1,128,0':'water'});
 const wf=stepFooting(puddle.blockAt,{x:1,y:129,z:0});
 assert.deepEqual([wf.fill,wf.support,wf.water],[{x:1,y:128,z:0},{x:1,y:127,z:0},true]);
 // Deep water (water under water) still turns.
 const lake=world({'1,128,0':'water','1,127,0':'water'});
 assert.match(stepFooting(lake.blockAt,{x:1,y:129,z:0}).turn,/water under/);
});
test('turnOrder: straight on, then the two sides, never back',()=>{
 assert.deepEqual(turnOrder({x:1,z:0}).map(d=>[d.x,d.z]),[[1,0],[0,-1],[0,1]]);
});
test('a staircase reaching a cave opening turns aside and never drops more than one block',async()=>{
 const w=world();
 // A cave right under the third step east: (3,126..121,0) and around it.
 carve(w,[3,6],[118,126],[-1,1]);
 const {worker,drops,logs}=digger(w);
 const job={id:'dia'};
 await Worker.prototype.staircase.call(worker,job,0,124,{dir:new Vec3(1,0,0)});
 assert.ok(drops.every(d=>d===0),'every step lands on its own floor: '+drops);
 assert.equal(job.tunnel.length,6);
 for(const p of job.tunnel)assert.ok(solidAt(w,p.x,p.y-1,p.z),'floor under '+JSON.stringify(p));
 assert.ok(logs.some(l=>/cave opening.*turning (north|south)/.test(l)),logs.join('\n'));
 assert.ok(job.stairTurns>=1);
});
test('a one-deep pocket under a step is filled with cobblestone, then stepped on',async()=>{
 const w=world({'2,127,0':'air'}); // under step 2 (feet y=128)
 const {worker,placed,drops,logs}=digger(w);
 const job={id:'iron'};
 await Worker.prototype.staircase.call(worker,job,0,127,{dir:new Vec3(1,0,0)});
 assert.deepEqual(placed,['2,127,0']);
 assert.equal(w.nameAt(2,127,0),'cobblestone');
 assert.ok(drops.every(d=>d===0));
 assert.ok(logs.some(l=>/filled a hole under/.test(l)));
 assert.equal(job.stairTurns||0,0,'filled, not turned');
});
test('a hole with no block to fill it turns the tunnel instead',async()=>{
 const w=world({'1,128,0':'air'});
 const {worker,placed,drops}=digger(w,undefined,[]);
 const job={id:'x'};
 await Worker.prototype.staircase.call(worker,job,0,128,{dir:new Vec3(1,0,0)});
 assert.deepEqual(placed,[]);
 assert.ok(drops.every(d=>d===0));
 assert.notEqual(job.tunnel[0].x,1,'turned away from the hole');
});
test('openings on every side stop the staircase where it stands',async()=>{
 const w=world();
 carve(w,[-3,3],[120,128],[-3,3]);w.set(0,129,0,'stone'); // the bot stands on a pillar over a cave
 for(let x=-3;x<=3;x++)for(let z=-3;z<=3;z++)if(x||z)w.set(x,129,z,'stone');
 const {worker,bot,drops}=digger(w);
 const job={id:'d'};
 await assert.rejects(Worker.prototype.staircase.call(worker,job,0,120,{dir:new Vec3(1,0,0)}),/Tunnel stopped: cave opening.*no safe way on/);
 assert.equal(bot.entity.position.y,130,'never walked off');
 assert.deepEqual(drops,[]);
});
test('turns are capped per job',()=>{
 const w=world();carve(w,[1,1],[120,128],[0,0]);
 const bot={entity:{position:new Vec3(0.5,130,0.5)},blockAt:p=>w.blockAt(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)),inventory:{items:()=>[]}};
 const job={stairTurns:STAIR_TURNS};
 const plan=planTunnelStep(bot,job,new Vec3(1,0,0),-1);
 assert.equal(plan.next,undefined);
 assert.ok(plan.why.includes('turn limit'));
});
test('the strip mine turns at a ravine instead of walking into it',async()=>{
 const w=world();
 // Strip at the bot's level (feet y=130 on stone): a ravine two cells ahead in its direction.
 for(let y=130;y<=131;y++)for(let x=-40;x<=40;x++)for(let z=-40;z<=40;z++)w.set(x,y,z,'stone'); // buried
 w.set(0,130,0,'air');w.set(0,131,0,'air');
 const start=new Vec3(0.5,130,0.5);
 const dir=[new Vec3(1,0,0),new Vec3(0,0,1),new Vec3(-1,0,0),new Vec3(0,0,-1)][Math.abs(0+0*5)%4];
 carve(w,[2*dir.x-1+(dir.x?0:0),2*dir.x+1],[110,129],[-1,1]);
 const {worker,drops,logs}=digger(w,start);
 const job={id:'s'};
 await Worker.prototype.stripMine.call(worker,job,0,6);
 assert.ok(drops.every(d=>d===0),'drops '+drops);
 for(const p of job.tunnel)assert.ok(solidAt(w,p.x,p.y-1,p.z));
 assert.ok(logs.some(l=>/turning/.test(l)),logs.join('\n'));
});
test('descendToReach refuses a dig that opens a deep drop (the precedence bug)',async()=>{
 const w=world();carve(w,[0,0],[120,128],[0,0]); // the block under the feet hides a shaft
 const {worker,bot}=digger(w);
 let digs=0;bot.dig=async()=>{digs++;};bot.canDigBlock=()=>false;
 await Worker.prototype.descendToReach.call(worker,{position:new Vec3(1,124,0)},0);
 assert.equal(digs,0,'a 9-block shaft under the floor is never opened');
 const shallow=world({'0,128,0':'air'});
 const t=digger(shallow);let d2=0;t.bot.dig=async bl=>{d2++;shallow.set(bl.position.x,bl.position.y,bl.position.z,'air');t.bot.entity.position=new Vec3(0.5,128,0.5);};t.bot.canDigBlock=()=>false;
 await Worker.prototype.descendToReach.call(t.worker,{position:new Vec3(1,124,0)},0);
 assert.ok(d2>=1,'a 2-block drop is still allowed');
});
test('an ore descent stopped by a cave opening hands back to the gather; lava still fails it',async()=>{
 const {worker,logs}=digger(world());
 worker.staircase=async()=>{throw Error('Tunnel stopped: cave opening under 1,120,0 (3+ deep); no safe way on');};
 await descendLeg(worker,{},0,-54);
 assert.ok(logs.some(l=>/descent stopped at y=130.*searching from here/.test(l)));
 worker.staircase=async()=>{throw Error('Tunnel stopped: lava at 1,120,0');};
 await assert.rejects(descendLeg(worker,{},0,-54),/lava at/);
});
// Round 10, efficiency 3: ore in arm's reach of the tunnel is mined on the way.
import {wallOre} from '../src/digDown.js';
import {pickupJob,PICKUP_EVERY_MS} from '../src/autopilot.js';
import {jobSchema} from '../src/schema.js';
test('wallOre: the side walls of the feet and head cells only, never beside a fluid',()=>{
 const w=world({'0,130,1':'coal_ore','0,131,-1':'iron_ore','1,130,0':'coal_ore','0,129,0':'coal_ore','0,132,0':'coal_ore','-1,130,0':'coal_ore','0,131,1':'diamond_ore','0,131,2':'lava'});
 const ore=bl=>/_ore$/.test(bl.name);
 const got=wallOre(w.blockAt,{x:0,y:130,z:0},{x:1,z:0},ore).map(p=>p.x+','+p.y+','+p.z+' '+p.name).sort();
 assert.deepEqual(got,['0,130,1 coal_ore','0,131,-1 iron_ore'],'ahead, behind, floor and ceiling are left; the diamond touches lava');
});
test('a staircase mines coal in its side wall as it passes, with the right tool only',async()=>{
 const w=world({'1,129,1':'coal_ore','2,128,-1':'iron_ore'});
 const {worker,bot,logs}=digger(w);
 bot.blockAt=(p=>{const real=w.blockAt(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z));if(real.name==='iron_ore')real.harvestTools={901:true};return real;});
 const job={id:'c'};
 await Worker.prototype.staircase.call(worker,job,0,127,{dir:new Vec3(1,0,0)});
 assert.equal(w.nameAt(1,129,1),'air','the coal beside step 1 was mined');
 assert.equal(w.nameAt(2,128,-1),'iron_ore','no stone pickaxe: the iron stays');
 assert.equal(job.wallPickups,1);
 assert.ok(logs.some(l=>/mined coal_ore in the wall at 1,129,1/.test(l)));
 // a hostile within 8: no wall digs
 const w2=world({'1,129,1':'coal_ore'});
 const t=digger(w2);t.bot.entities={9:{type:'hostile',name:'zombie',position:new Vec3(3,129,0)}};
 await Worker.prototype.staircase.call(t.worker,{id:'d'},0,128,{dir:new Vec3(1,0,0)});
 assert.equal(w2.nameAt(1,129,1),'coal_ore');
});
test('pickupJob: exposed ore the ladder needs within 6, rate-limited, never at night or near hostiles',()=>{
 const kit={wooden_pickaxe:1,stone_pickaxe:1,oak_log:4};
 assert.deepEqual(pickupJob(kit,{tod:3000,exposed:{coal:3}}),{type:'gather',block:'coal_ore',count:3,radius:6});
 assert.deepEqual(pickupJob(kit,{tod:3000,exposed:{coal:3,iron:9}}),{type:'gather',block:'iron_ore',count:4,radius:6},'iron first, capped');
 assert.equal(pickupJob({wooden_pickaxe:1,oak_log:4},{tod:3000,exposed:{iron:2}}),null,'iron needs a stone pickaxe');
 assert.equal(pickupJob({...kit,coal:16},{tod:3000,exposed:{coal:3}}),null,'enough coal');
 assert.equal(pickupJob(kit,{tod:13000,exposed:{coal:3}}),null,'night');
 assert.equal(pickupJob(kit,{tod:3000,exposed:{coal:3},hostileDistance:10}),null);
 assert.equal(pickupJob(kit,{tod:3000,exposed:{coal:3},sinceLast:PICKUP_EVERY_MS-1}),null,'once a minute');
 assert.deepEqual(pickupJob({stone_pickaxe:1},{tod:3000,exposed:{log:5}}),{type:'gather',block:'log',count:2,radius:6,belowFoots:true},'logs when wood is low');
 assert.equal(pickupJob(kit,{tod:3000,exposed:{log:5}}),null,'4 logs held: no detour');
 assert.deepEqual(pickupJob({iron_pickaxe:1},{tod:3000,exposed:{diamond:1,coal:2}}),{type:'gather',block:'diamond_ore',count:1,radius:6});
 for(const j of [pickupJob(kit,{tod:3000,exposed:{coal:3}}),pickupJob({stone_pickaxe:1},{tod:3000,exposed:{log:5}})])assert.ok(jobSchema.safeParse(j).success);
});
// ---- round 11: normal1 stopped at y=-16 and normal3 at y=84 after three cave openings -------
import {BRIDGE_WIDTH} from '../src/digDown.js';
test('stepFooting: a narrow crack along the heading is bridged, a wide cave still turns',()=>{
 const w=world();
 carve(w,[1,1],[110,128],[-3,3]); // a 1-wide crack across the way east, 19 deep
 const next={x:1,y:129,z:0};
 assert.match(stepFooting(w.blockAt,next).turn,/cave opening/,'no heading: the old answer');
 const f=stepFooting(w.blockAt,next,{x:1,z:0});
 assert.equal(f.bridge,true);
 assert.deepEqual(f.fill,{x:1,y:128,z:0});
 assert.equal(w.blockAt(f.support.x,f.support.y,f.support.z).boundingBox,'block');
 assert.notDeepEqual(f.support,{x:1,y:127,z:0},'never against the open cell below');
 const wide=world();carve(wide,[1,1+BRIDGE_WIDTH],[110,128],[-3,3]);
 assert.match(stepFooting(wide.blockAt,next,{x:1,z:0}).turn,/cave opening/,'wider than BRIDGE_WIDTH: turn');
});
test('a staircase bridges a narrow crack with a held block and never drops',async()=>{
 const w=world();
 carve(w,[3,3],[100,127],[-3,3]); // the crack under step 3 (feet y=127)
 const {worker,placed,drops,logs}=digger(w);
 const job={id:'dia'};
 await Worker.prototype.staircase.call(worker,job,0,124,{dir:new Vec3(1,0,0)});
 assert.ok(drops.every(d=>d===0),'drops '+drops);
 assert.ok(placed.includes('3,126,0'),'bridged under step 3: '+placed);
 assert.ok(logs.some(l=>/Tunnel: bridged a gap under \(3, 127, 0\)/.test(l)),logs.join('\n'));
 assert.equal(job.bridges,1);
 assert.equal(job.stairTurns||0,0,'straight on, no turn');
 for(const p of job.tunnel)assert.ok(solidAt(w,p.x,p.y-1,p.z));
});
test('no safe way down here: the leg moves sideways and starts a new staircase',async()=>{
 const w=world();
 // the bot stands on a stone lid over a 7x7 cave (the stop-where-it-stands case above)
 carve(w,[-3,3],[110,128],[-3,3]);
 const {worker,bot,drops,logs}=digger(w);
 worker.tunnelStep=Worker.prototype.tunnelStep;worker.staircase=Worker.prototype.staircase;
 worker.digTunnelStep=Worker.prototype.digTunnelStep;worker.clearCells=Worker.prototype.clearCells;
 const job={id:'dia',tunnel:[{x:-1,y:131,z:0},{x:0,y:130,z:0}]}; // came down heading east
 await descendLeg(worker,job,0,120);
 assert.ok(logs.some(l=>/Tunnel: no safe way down; moved 3 (north|south) to start a new staircase/.test(l)),logs.join('\n'));
 assert.ok(drops.every(d=>d===0),'drops '+drops);
 assert.ok(bot.entity.position.y<=120,'reached the leg target: y='+bot.entity.position.y);
 for(const p of job.tunnel.slice(2))assert.ok(solidAt(w,p.x,p.y-1,p.z),'floor under '+JSON.stringify(p));
 assert.ok(!logs.some(l=>/descent stopped/.test(l)));
});
test('sidesteps are capped: a lid with caves everywhere still stops where it is safe',async()=>{
 const w=world();
 carve(w,[-12,12],[110,128],[-12,12]);
 const {worker,bot,drops,logs}=digger(w);
 const job={id:'dia',tunnel:[{x:-1,y:131,z:0},{x:0,y:130,z:0}]};
 await descendLeg(worker,job,0,120);
 assert.ok(drops.every(d=>d===0));
 assert.equal(bot.entity.position.y,130,'never walked off the lid');
 assert.ok(logs.some(l=>/descent stopped at y=130/.test(l)),logs.join('\n'));
 assert.ok(logs.filter(l=>/moved \d/.test(l)).length<=3);
});
