import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {Vec3} from 'vec3';
import {Worker,lavaAhead,lavaGuard,ASCEND_PILLAR} from '../src/worker.js';
import {Autopilot,SHALLOW_BELOW} from '../src/autopilot.js';
import {watchToolLoss} from '../src/toolWear.js';

// Round 76: the round-75 soak on the Nitrous world copy.
const AIR={name:'air',boundingBox:'empty'},STONE={name:'stone',boundingBox:'block'},LAVA={name:'lava',boundingBox:'empty'};
function walker(blocks,{vel=new Vec3(0.2,0,0),pathing=false}={}){
 const ctl={forward:true,sprint:true};
 return {ctl,bot:{entity:{position:new Vec3(10.5,64,0.5),velocity:vel,onGround:true},
  pathfinder:{isMoving:()=>pathing},getControlState:k=>!!ctl[k],setControlState:(k,v)=>{ctl[k]=v;},
  blockAt:p=>{const b=blocks(p.floored?p.floored():p);return b&&{...b,position:p};}}};
}
test('round 76: a key-driven walk into lava stops and steps back',()=>{
 // round-75 hard3: lava at the feet one ahead (east)
 const pool=p=>p.x===11&&p.y===64?LAVA:p.y<64?STONE:AIR;
 const w=walker(pool);
 assert.ok(lavaAhead(w.bot));
 assert.ok(lavaGuard(w.bot));
 assert.equal(w.ctl.forward,false);assert.equal(w.ctl.sprint,false);assert.equal(w.ctl.back,true,'steps back from it');
 // a lava pool two below an open floor ahead
 const pit=p=>p.x===11&&(p.y===63)?AIR:p.x===11&&p.y===62?LAVA:p.y<64?STONE:AIR;
 assert.ok(lavaGuard(walker(pit).bot));
 // flat stone ahead, a wall ahead, the pathfinder walking, no key held, the bot already in lava
 assert.equal(lavaGuard(walker(p=>p.y<64?STONE:AIR).bot),null);
 assert.equal(lavaAhead(walker(p=>p.x===11?STONE:p.y<64?STONE:AIR).bot),null,'a wall, not lava');
 assert.equal(lavaGuard(walker(pool,{pathing:true}).bot),null);
 const idle=walker(pool);idle.ctl.forward=false;assert.equal(lavaGuard(idle.bot),null);
 const inLava=walker(p=>p.x===10&&p.y===64||p.x===11&&p.y===64?LAVA:p.y<64?STONE:AIR);
 assert.equal(lavaGuard(inLava.bot),null,'the lava escape walks through it');
 assert.equal(inLava.ctl.forward,true);
});

function ascender(startY){
 const logs=[],pillars=[];
 const bot={entity:{position:new Vec3(854.5,startY,-446.5)},blockAt:()=>STONE};
 const w=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,log:m=>logs.push(m),check(){},
  navigate:async()=>{throw Error('No path to the goal!');},
  pillarUp:async(y)=>{pillars.push([Math.floor(bot.entity.position.y),y]);bot.entity.position=new Vec3(854.5,y,-446.5);return true;}});
 return {w,bot,logs,pillars};
}
test('round 76: the ascend pillars on past one segment while each one rises',async()=>{
 // round-75 normal1: y=38, surface 71 - the one segment stopped at 62
 const {w,logs,pillars}=ascender(38);
 await w.ascend({spec:{type:'ascend',y:71}},0);
 assert.deepEqual(pillars,[[38,38+ASCEND_PILLAR],[62,71]]);
 assert.ok(logs.includes('Ascend: pillared y=38 -> 62, 9 below the surface; pillaring on'));
 assert.equal(logs.at(-1),'Ascend: y=38 -> 71 (surface 71)');
 // a segment that does not rise ends it
 const stuck=ascender(38);stuck.w.pillarUp=async()=>false;
 await assert.rejects(stuck.w.ascend({spec:{type:'ascend',y:71}},0),/Could not climb/);
 assert.ok(!stuck.logs.some(l=>/pillaring on/.test(l)));
});

test('round 76: a blocked step under rock below the surface climbs out instead of exploring',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r76-'));
 try{
  const head={skyLight:0};
  const bot={entity:{position:new Vec3(854.5,62,-446.5)},blockAt:()=>head};
  const ap=new Autopilot({log(){},bot},root);
  ap.lastSurfaceY=71;
  assert.equal(ap.enclosedBelowSurface(),true,'9 below, no sky');
  head.skyLight=15;assert.equal(ap.enclosedBelowSurface(),false,'under the sky');
  head.skyLight=0;bot.entity.position=new Vec3(854.5,71-SHALLOW_BELOW,-446.5);
  assert.equal(ap.enclosedBelowSurface(),false,'within '+SHALLOW_BELOW+' of the surface');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
 // the blocked-step branch submits the ascend
 const src=fs.readFileSync(new URL('../src/autopilot.js',import.meta.url),'utf8');
 const i=src.indexOf('this.enclosedBelowSurface()&&');
 assert.ok(i>0&&src.indexOf("this.submit('escape',{type:'ascend'",i)>i);
});

function sumpWorker(start,origin,blocks,{held=[{name:'cobblestone',count:8}]}={}){
 const logs=[],placed=[],pillars=[];
 const world=new Map();
 const at=p=>{const k=p.x+','+p.y+','+p.z;return world.has(k)?world.get(k):blocks(p);};
 const bot={entity:{position:start.clone(),onGround:true,velocity:new Vec3(0,0,0)},pathfinder:{movements:{},setMovements(){}},look:async()=>{},clearControlStates(){},
  inventory:{items:()=>held},equip:async()=>{},
  blockAt:p=>{const b=at(p.floored());return b&&{...b,position:p.floored()};},setControlState(){},
  placeBlock:async(ref,face)=>{const c=ref.position.plus(face);placed.push(String(c));world.set(c.x+','+c.y+','+c.z,STONE);}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,log:m=>logs.push(m),check(){},exploreMovements:()=>({}),
  climbTunnel:async()=>{},navigate:async()=>{throw Error('Took to long to decide path to goal!');},
  pillarUp:async y=>{pillars.push(bot.entity.position.clone());bot.entity.position=new Vec3(origin.x+0.5,y,origin.z+0.5);return true;}});
 return {w,bot,logs,placed,pillars,world};
}
test('round 76: beside the box, the sump is filled before the step in',async()=>{
 // round-75 hard2: box at (835, 96, -467), the bot one east of it
 const origin=new Vec3(835,96,-467);
 const sump=p=>p.x===835&&p.z===-467&&p.y>=94&&p.y<=97?AIR:p.x===836&&p.z===-467&&p.y>=96?AIR:p.y<=97?STONE:AIR;
 const s=sumpWorker(new Vec3(836.5,96,-466.5),origin,sump);
 s.w.walkTunnelBack=async()=>{s.bot.entity.position=new Vec3(835.5,96,-466.5);return true;};
 assert.equal(await s.w.nightMineReturn({id:'n',tunnel:[]},0,origin),true);
 assert.deepEqual(s.placed,['(835, 94, -467)','(835, 95, -467)'],'the bottom first, then the floor');
 assert.equal(s.logs[1],'Night mine: one step from the shelter at (836, 96, -467); filled the sump (2 blocks); stepping in');
 assert.deepEqual(s.pillars,[],'no pillar');
 // nothing to fill with: steps in as before
 const bare=sumpWorker(new Vec3(836.5,96,-466.5),origin,sump,{held:[]});
 bare.w.walkTunnelBack=async()=>{bare.bot.entity.position=new Vec3(835.5,96,-466.5);return true;};
 await bare.w.nightMineReturn({id:'n',tunnel:[]},0,origin);
 assert.equal(bare.logs[1],'Night mine: one step from the shelter at (836, 96, -467); stepping in');
});
test('round 76: down the sump, the bot is centred on the column before the pillar',async()=>{
 const origin=new Vec3(3000,-60,0);
 const s=sumpWorker(new Vec3(3000.95,-62,0.5),origin,p=>p.x===3000&&p.z===0&&p.y>=-62?AIR:p.y<=-60?STONE:AIR);
 s.w.walkTunnelBack=async()=>false;
 const keys=[];
 s.bot.setControlState=(k,v)=>{keys.push(k+'='+v);if(k==='forward'&&v){const p=s.bot.entity.position;s.bot.entity.position=new Vec3(p.x-0.2,p.y,p.z);}};
 assert.equal(await s.w.nightMineReturn({id:'n',tunnel:[]},0,origin),true);
 assert.ok(keys.includes('forward=true'));
 assert.equal(s.pillars.length,1);
 assert.ok(Math.abs(s.pillars[0].x-3000.5)<0.15,'centred: '+s.pillars[0].x);
 assert.equal(s.logs.at(-1),'Night mine: pillaring up the sump from y=-62');
});

test('round 76: a sword one use down after a strike is not a tool loss',async()=>{
 const inv=new EventEmitter();let items=[];inv.items=()=>items;
 const b={inventory:inv,health:20,registry:{itemsByName:{stone_sword:{maxDurability:131}}}};
 const logs=[];watchToolLoss(b,m=>logs.push(m),{settleMs:30});
 const sword={name:'stone_sword',slot:36,durabilityUsed:0};
 inv.emit('updateSlot',36,sword,null); // the strike's wear: the slot empties
 items=[{...sword,durabilityUsed:1}]; // then the sword comes back one use down
 await new Promise(r=>setTimeout(r,60));
 assert.deepEqual(logs,[]);
 // a fresh sword in place of a nearly broken one is still a loss of the old one
 const old={name:'stone_sword',slot:36,durabilityUsed:130};
 items=[];inv.emit('updateSlot',36,old,null);items=[{...old,durabilityUsed:0}];
 await new Promise(r=>setTimeout(r,60));
 assert.equal(logs.length,1);assert.match(logs[0],/^Tool left the inventory: stone_sword \(1 uses left, broke\)/);
});
