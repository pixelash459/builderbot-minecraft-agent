import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';
import {pickStairDir} from '../src/digDown.js';
import {WorldSurvivalChain} from '../src/chains/worldSurvivalChain.js';
import {EscapeSuffocationTask} from '../src/chains/fallbackTasks.js';
// Soak 2026-10-14 hard1 [149,129,36] and hard2 [140,129,34]: 'suffocated in a wall' during
// the stone dig-down. The step cells were dug feet -> head -> corner and the bot walked in
// 80 ms later, so a sand/gravel stack over the corner fell onto it; then the low-health stop
// froze the job and nothing ever freed the head.
const GRAVITY=new Set(['gravel','sand']);
// A world with gravity: digging a cell lets every sand/gravel block above it drop to the
// first solid block (instantly, or on the next `fall()` when `late` is set).
function world(edit={},{late=false}={}){
 const cells=new Map(Object.entries(edit));
 const nameAt=(x,y,z)=>{const k=x+','+y+','+z;if(cells.has(k))return cells.get(k);return y>129?'air':y>=126?'dirt':y>=110?'stone':'bedrock';};
 const blockAt=(x,y,z)=>{const name=nameAt(x,y,z);return {name,position:new Vec3(x,y,z),boundingBox:name==='air'?'empty':'block'};};
 const set=(x,y,z,name)=>cells.set(x+','+y+','+z,name);
 const pending=new Set();
 const fall=()=>{
  for(const k of [...pending]){
   pending.delete(k);const [x,z]=k.split(',').map(Number);
   for(let y=111;y<=140;y++){
    const n=nameAt(x,y,z);if(!GRAVITY.has(n))continue;
    let to=y;while(nameAt(x,to-1,z)==='air')to--;
    if(to!==y){set(x,to,z,n);set(x,y,z,'air');}
   }
  }
 };
 const dig=p=>{set(p.x,p.y,p.z,'air');pending.add(p.x+','+p.z);if(!late)fall();};
 return {nameAt,blockAt,set,dig,fall};
}
const natural=bl=>['stone','dirt','grass_block','gravel','sand'].includes(bl.name);
function tunneller(w,start=new Vec3(0.5,130,0.5)){
 const digs=[];
 const bot={entity:{position:start.clone()},entities:{},
  blockAt:p=>w.blockAt(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)),
  inventory:{items:()=>[]},tool:{async equipForBlock(){}},
  async dig(bl){digs.push(bl.name+'@'+bl.position.y);w.dig(bl.position);}};
 const worker={bot,epoch:0,logs:[],check(){},save(){},log(m){this.logs.push(m);},async placeTorch(){},
  clearCells:Worker.prototype.clearCells,digTunnelStep:Worker.prototype.digTunnelStep,tunnelStep:Worker.prototype.tunnelStep,
  takeStrandedTunnel:Worker.prototype.takeStrandedTunnel,
  async stepInto(next){bot.entity.position=new Vec3(next.x+0.5,next.y,next.z+0.5);if(worker.onStep)worker.onStep(next);}};
 return {bot,worker,digs};
}
const air=(w,p)=>w.nameAt(p.x,p.y,p.z)==='air';
test('pickStairDir never picks a step with sand or gravel sitting on top of it',()=>{
 const w=world();
 // East is the only direction with a stack of gravel over its third step's corner.
 const plain=pickStairDir(w.blockAt,{x:0,y:130,z:0},{isNatural:natural});
 assert.ok(plain);
 for(const [dx,dz] of [[1,0],[0,1],[-1,0],[0,-1]])w.set(3*dx,130,3*dz,'gravel'); // y-3+3 = 130
 assert.equal(pickStairDir(w.blockAt,{x:0,y:130,z:0},{isNatural:natural,min:3}),null,'every way has loose blocks over step 3');
 w.set(0,130,-3,'air');
 const pick=pickStairDir(w.blockAt,{x:0,y:130,z:0},{isNatural:natural,min:3});
 assert.deepEqual([pick.dir.x,pick.dir.z],[0,-1]);
});
test('a tunnel step digs top-down and clears a gravel stack before the bot may step in',async()=>{
 const w=world();
 // Step cells (1,127..129,0) in the dirt; three gravel above the corner at y=130..132.
 for(const y of [130,131,132])w.set(1,y,0,'gravel');
 const {worker,digs}=tunneller(w);
 await worker.digTunnelStep({},0,new Vec3(1,127,0),true,natural);
 for(const y of [127,128,129])assert.ok(air(w,new Vec3(1,y,0)),'cell y='+y+' open');
 assert.ok(!GRAVITY.has(w.nameAt(1,130,0)),'nothing loose left on top');
 assert.equal(digs.filter(d=>d.startsWith('gravel')).length,3,'each gravel dug once: '+digs.join(' '));
 assert.match(digs[0],/^dirt@129$/,'the corner first: '+digs.join(' '));
});
test('gravel in the head cell never drops into an open feet cell',async()=>{
 const w=world({'1,130,0':'gravel','1,131,0':'dirt','1,132,0':'dirt'});
 const order=[];
 const {worker,bot}=tunneller(w);
 const real=bot.dig;bot.dig=async bl=>{order.push(bl.position.y);await real(bl);};
 await worker.digTunnelStep({},0,new Vec3(1,129,0),true,natural);
 assert.deepEqual(order,[131,130,129],'corner, head, feet');
 for(const y of [129,130,131])assert.ok(air(w,new Vec3(1,y,0)));
});
test('a step whose sand keeps coming is refused, not entered',async()=>{
 const w=world();
 for(let y=132;y<=139;y++)for(const x of [1])w.set(x,y,0,'sand');
 const {worker}=tunneller(w);
 // Eight sand over the corner fit in the settle budget; a bottomless supply would not.
 await worker.digTunnelStep({},0,new Vec3(1,129,0),true,natural);
 const deep=world();
 const {worker:w2,bot:b2}=tunneller(deep);
 b2.dig=async bl=>{deep.set(bl.position.x,bl.position.y,bl.position.z,'air');deep.set(1,131,0,'sand');}; // refills forever
 await assert.rejects(w2.digTunnelStep({},0,new Vec3(1,129,0),true,natural),/keeps falling/);
});
test('a late fall onto the bot after it stepped in is dug out before the next step',async()=>{
 const w=world({},{late:true});
 const {worker,bot}=tunneller(w);
 // Gravel lands in the head cell of the first step right after the bot walks in.
 let once=true;
 worker.onStep=next=>{if(once){once=false;w.set(next.x,next.y+1,next.z,'gravel');}};
 const job={id:'j1'};
 await Worker.prototype.staircase.call(worker,job,0,127,{dir:new Vec3(1,0,0),natural});
 assert.equal(job.tunnel.length,3);
 for(const p of job.tunnel){assert.ok(air(w,new Vec3(p.x,p.y,p.z)),'feet '+JSON.stringify(p));assert.ok(air(w,new Vec3(p.x,p.y+1,p.z)),'head '+JSON.stringify(p));}
});
test('a stopped staircase leaves its tunnel for the next job to climb',async()=>{
 const w=world();
 const {worker,bot}=tunneller(w);
 const job={id:'dig'};
 await Worker.prototype.staircase.call(worker,job,0,127,{dir:new Vec3(1,0,0),natural});
 assert.equal(worker.strandedTunnel.job,'dig');
 assert.equal(worker.takeStrandedTunnel('dig'),null,'the job that dug it climbs it itself');
 assert.ok(worker.strandedTunnel,'still recorded');
 const points=worker.takeStrandedTunnel('other');
 assert.equal(points.length,3);
 assert.equal(worker.strandedTunnel,null);
 // Far from the tunnel's bottom (respawned, teleported): nothing to climb.
 worker.strandedTunnel={points,job:'dig'};bot.entity.position=new Vec3(40,130,40);
 assert.equal(worker.takeStrandedTunnel('other'),null);
});
test('an explore after an interrupted dig-down climbs out first',async()=>{
 const w=world();
 const {worker,bot}=tunneller(w);
 await Worker.prototype.staircase.call(worker,{id:'dig'},0,127,{dir:new Vec3(1,0,0),natural});
 const order=[];
 worker.climbTunnel=async j=>{order.push('climb '+j.tunnel.length);};
 worker.explore=async()=>{order.push('explore');};
 await Worker.prototype.run.call(worker,{spec:{type:'explore',direction:'north',distance:32}},0);
 assert.deepEqual(order,['climb 3','explore']);
 await Worker.prototype.run.call(worker,{spec:{type:'explore',direction:'north',distance:32}},0);
 assert.deepEqual(order,['climb 3','explore','explore'],'climbed once');
});
// ---- the escape ----------------------------------------------------------------------
function wallBot(blocks){
 const calls=[];
 const bot={health:20,food:20,entity:{position:new Vec3(0.5,-60,0.5),metadata:[0],onGround:true},entities:{},
  inventory:{items:()=>[]},
  blockAt:p=>{const k=Math.floor(p.x)+','+Math.floor(p.y)+','+Math.floor(p.z);const n=blocks[k];return n?{name:n,position:new Vec3(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)),boundingBox:n==='air'?'empty':'block'}:null;},
  setControlState:(n,v)=>calls.push(['control',n,v]),look:async()=>calls.push(['look']),
  dig:bl=>{calls.push(['dig',bl.name]);return new Promise(()=>{});},stopDigging(){calls.push(['stopDigging']);}};
 return {bot,calls};
}
const ctx={config:{chains:{}},move:{},trackers:{},blacklist:{}};
test('head in gravel: the survival chain digs out at priority 100, one dig at a time',()=>{
 const {bot,calls}=wallBot({'0,-59,0':'gravel'});
 const chain=new WorldSurvivalChain();let t=100;chain.now=()=>t;
 assert.equal(chain.priority(bot,ctx),-1,'a single frame is not a wall');
 t+=0.35;
 assert.equal(chain.priority(bot,ctx),100);
 assert.equal(chain.root.name,'EscapeSuffocationTask');
 for(let i=0;i<5;i++)chain.root.onTick(bot,ctx);
 assert.equal(calls.filter(c=>c[0]==='dig').length,1,'no re-dig while the dig runs (packet flood)');
 assert.deepEqual(calls.find(c=>c[0]==='dig'),['dig','gravel']);
 chain.root.onStop(bot);assert.ok(calls.some(c=>c[0]==='stopDigging'));
});
test('head in a built block: no dig, push toward the open side',()=>{
 const {bot,calls}=wallBot({'0,-59,0':'oak_planks','1,-60,0':'stone','1,-59,0':'stone','-1,-60,0':'air','-1,-59,0':'air'});
 assert.equal(EscapeSuffocationTask.inWall(bot),true);
 const task=new EscapeSuffocationTask();task.onTick(bot,ctx);
 assert.ok(!calls.some(c=>c[0]==='dig'),'a player block is never broken');
 assert.ok(calls.some(c=>c[0]==='control'&&c[1]==='forward'&&c[2]===true));
});
test('round 63: a head in ice over water digs the ice instead of shimmying under the sheet',()=>{
 const {bot,calls}=wallBot({'0,-59,0':'ice','0,-60,0':'water','1,-60,0':'water','1,-59,0':'water','-1,-59,0':'ice','-1,-60,0':'water'});
 assert.equal(EscapeSuffocationTask.inWall(bot),true);
 const task=new EscapeSuffocationTask();task.onTick(bot,ctx);
 assert.deepEqual(calls.find(c=>c[0]==='dig'),['dig','ice']);
 assert.ok(!calls.some(c=>c[0]==='control'&&c[1]==='forward'&&c[2]===true),'no shimmy while the ice is dug');
 for(const n of ['packed_ice','blue_ice'])assert.equal(EscapeSuffocationTask.diggable({name:n}),true,n);
});
test('leaves, slabs and open air at the head are not a wall',()=>{
 for(const n of ['oak_leaves','stone_slab','air'])assert.equal(EscapeSuffocationTask.inWall(wallBot({'0,-59,0':n}).bot),false,n);
 assert.equal(EscapeSuffocationTask.inWall(wallBot({'0,-59,0':'dirt'}).bot),true);
});
test('a tunnel step clears snow blocks bare-handed but still refuses stone without a pickaxe',async()=>{
 // Round 3, 16:42Z: 'Tunnel needs a suitable tool in the inventory for snow_block'.
 const w=world({'1,129,0':'snow_block','1,130,0':'snow_block','1,131,0':'snow_block'});
 const {worker,bot}=tunneller(w);
 const real=bot.blockAt;
 bot.blockAt=p=>{const bl=real(p);if(bl.name==='snow_block')Object.assign(bl,{hardness:0.2,harvestTools:{900:true}});if(bl.name==='stone')Object.assign(bl,{hardness:1.5,harvestTools:{901:true}});return bl;};
 const snowy=bl=>natural(bl)||bl.name==='snow_block';
 await worker.digTunnelStep({},0,new Vec3(1,129,0),true,snowy);
 for(const y of [129,130,131])assert.ok(air(w,new Vec3(1,y,0)));
 await assert.rejects(worker.digTunnelStep({},0,new Vec3(1,124,0),true,snowy),/needs a suitable tool in the inventory for stone/);
});
// Round 6, task 7: two climbs out of a tunnel at (144,124,53) failed with 'No path to the
// goal!' / 'Navigation timed out'. A refilled step is retried with the digging (natural
// blocks only) movements, a step that still fails is skipped, and only the top must hold.
test('climbTunnel retries a blocked step with the explore movements and skips one that still fails',async()=>{
 const moves=[],navs=[],logs=[];
 const normal={id:'normal'},explore={id:'explore'};
 const bot={entity:{position:new Vec3(0.5,-70,0.5)},pathfinder:{movements:normal,setMovements(m){this.movements=m;moves.push(m.id);}}};
 const blocked=new Set(['1,-69,0','2,-68,0']),hard=new Set(['2,-68,0']);
 const w=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,movements:normal,check(){},log:m=>logs.push(m),exploreMovements:()=>explore,
  navigate:async(goal,token)=>{
   const key=goal.x+','+goal.y+','+goal.z;navs.push(key+'@'+bot.pathfinder.movements.id);
   if(blocked.has(key)&&(bot.pathfinder.movements===normal||hard.has(key)))throw Error('No path to the goal!');
   bot.entity.position=new Vec3(goal.x+0.5,goal.y,goal.z+0.5);
  }});
 const tunnel=[{x:3,y:-67,z:0},{x:2,y:-68,z:0},{x:1,y:-69,z:0}];
 await w.climbTunnel({tunnel},0);
 assert.deepEqual(navs,['1,-69,0@normal','1,-69,0@explore','2,-68,0@normal','2,-68,0@explore','3,-67,0@normal']);
 assert.equal(bot.entity.position.y,-67,'reached the top');
 assert.equal(bot.pathfinder.movements,normal,'movements restored');
 assert.equal(logs.length,2);
 // The top itself unreachable even by digging: the climb fails (the caller logs it).
 hard.add('3,-67,0');blocked.add('3,-67,0');bot.entity.position=new Vec3(0.5,-70,0.5);
 await assert.rejects(w.climbTunnel({tunnel},0),/No path to the goal/);
});
