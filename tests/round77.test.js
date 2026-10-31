import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Vec3} from 'vec3';
import {Worker,lavaAhead,lavaGuard,lavaHeld,keyHeading,installSprintHold,LAVA_HOLD_MS,RESPAWN_LOOP_MS} from '../src/worker.js';
import {Autopilot} from '../src/autopilot.js';

// Round 77: the round-76 soak on the Nitrous world copy.
const AIR={name:'air',boundingBox:'empty'},STONE={name:'stone',boundingBox:'block'},LAVA={name:'lava',boundingBox:'empty'};
const BEDS={white_bed:{id:7,name:'white_bed'}};
function cave(y,{sky=0,items=[],bed=null}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r77-'));
 const bot={entity:{position:new Vec3(811.5,y,-549.5)},registry:{blocksByName:BEDS},inventory:{items:()=>items},
  findBlock:()=>bed,blockAt:()=>({name:'air',skyLight:sky}),time:{day:3,timeOfDay:14000}};
 const ap=new Autopilot({log(){},bot,jobs:[]},root);
 ap.lastSurfaceY=71;
 return {ap,bot,done:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('round 77: no bed underground - the night there is the shelter',async()=>{
 // round-76 hard1: (811, 32, -549), 39 under the anchor at 71, a bed held
 const c=cave(32,{items:[{name:'white_bed',count:1}]});
 try{
  assert.equal(c.ap.undergroundForBed(c.bot.entity.position),true);
  assert.equal(c.ap.bedNear(c.bot),true);
  assert.equal(c.ap.bedForNight(c.bot),false,'a bed held, but underground');
  // depth and sky: 21 under with sky still counts, 11 under with sky does not, 5 under with none does
  const at=y=>new Vec3(811.5,y,-549.5);
  c.bot.blockAt=()=>({name:'air',skyLight:15});
  assert.equal(c.ap.undergroundForBed(at(50)),true);
  assert.equal(c.ap.undergroundForBed(at(60)),false);
  c.bot.blockAt=()=>({name:'air',skyLight:0});
  assert.equal(c.ap.undergroundForBed(at(66)),true);
  assert.equal(c.ap.undergroundForBed(at(68)),false,'within 4 of the surface');
  c.ap.lastSurfaceY=null;c.ap.foodAnchorY=null;
  assert.equal(c.ap.undergroundForBed(at(32)),false,'no surface known');
  // the sleep job refuses there too
  c.ap.lastSurfaceY=71;
  const w=Object.assign(Object.create(Worker.prototype),{bot:c.bot,autopilot:c.ap,check(){},update(){},log(){}});
  await assert.rejects(w.sleep({spec:{type:'sleep'}},0),/^Error: Underground at y=32 \(surface 71\): a bed here would put the respawn point in the cave$/);
  // a bed in a cave is not a home
  c.bot.findBlock=()=>({name:'white_bed',position:new Vec3(811,32,-550)});
  c.ap.home=null;c.ap.lastHomeScan=0;c.ap.rememberHome(c.bot);
  assert.equal(c.ap.home,null);
 }finally{c.done();}
});

function respawned({deaths,under=false,home=null}){
 const logs=[],dug=[],saved=[];
 const bedAt=new Vec3(811,32,-550);
 const bot={health:20,entity:{position:new Vec3(811.5,32,-548.5)},registry:{blocksByName:BEDS},
  findBlock:({maxDistance})=>maxDistance<=3?{name:'white_bed',position:bedAt}:null,dig:async b=>{dug.push(String(b.position));}};
 const ap={home,undergroundForBed:()=>under,save(){saved.push(1);}};
 const now=Date.now();
 const w=Object.assign(Object.create(Worker.prototype),{bot,autopilot:ap,log:m=>logs.push(m),
  deathLog:deaths.map(([x,y,z,ago])=>({t:new Date(now-ago).toISOString(),pos:{x,y,z}}))});
 return {w,bot,ap,logs,dug,saved};
}
test('round 77: a respawn bed the bot keeps dying at is broken',async()=>{
 // round-76 hard2: two deaths beside the cave bed inside a minute
 const r=respawned({deaths:[[838,85,-539,90000],[809,31,-547,40000],[810,32,-548,5000]],home:{x:811,y:32,z:-550}});
 assert.equal(await r.w.respawnBedCheck(r.bot),true);
 assert.deepEqual(r.dug,['(811, 32, -550)']);
 assert.equal(r.logs[0],'Respawn: 2 deaths within 24 of the bed at (811, 32, -550) in 10 min; breaking it so the next respawn is the world spawn');
 assert.equal(r.ap.home,null);assert.equal(r.logs[1],'Respawn: home cleared (it was that bed)');
 // one death near an underground bed is enough
 const u=respawned({deaths:[[809,31,-547,5000]],under:true});
 assert.equal(await u.w.respawnBedCheck(u.bot),true);
 assert.match(u.logs[0],/^Respawn: 1 death within 24 of the bed at \(811, 32, -550\) in 10 min \(underground\); breaking it/);
 // one death near a bed on the surface, deaths far off, or old deaths: the bed stays
 for(const deaths of [[[809,31,-547,5000]],[[838,85,-539,5000],[700,64,-400,4000]],[[809,31,-547,RESPAWN_LOOP_MS+1000],[810,32,-548,RESPAWN_LOOP_MS+500]]]){
  const k=respawned({deaths});
  assert.equal(await k.w.respawnBedCheck(k.bot),null);
  assert.deepEqual(k.dug,[]);
 }
 // a dead bot, or no bed beside the respawn
 const d=respawned({deaths:[[809,31,-547,5000],[810,32,-548,4000]]});d.bot.health=0;
 assert.equal(await d.w.respawnBedCheck(d.bot),null);
 const n=respawned({deaths:[[809,31,-547,5000],[810,32,-548,4000]]});n.bot.findBlock=()=>null;
 assert.equal(await n.w.respawnBedCheck(n.bot),null);
 // the death handler runs the check after the respawn
 const src=fs.readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
 const i=src.indexOf(' onDeath(bot){'),j=src.indexOf('respawnBedCheck(bot)',i);
 assert.ok(i>0&&j>i&&j<src.indexOf(' onHealth(bot){',i));
});

function sprinter(blocks,{vel,yaw=-Math.PI/2}={}){
 const ctl={forward:true,sprint:true};
 const bot={entity:{position:new Vec3(10.5,64,0.5),velocity:vel,onGround:true,yaw},
  pathfinder:{isMoving:()=>false},getControlState:k=>!!ctl[k],setControlState:(k,v)=>{ctl[k]=v;},
  blockAt:p=>{const b=blocks(p.floored?p.floored():p);return b&&{...b,position:p};}};
 return {ctl,bot};
}
test('round 77: at sprint speed the lava guard reads one cell farther',()=>{
 // open floor at x=11, the lava two cells on at x=12
 const far=p=>p.x===12&&p.y===64?LAVA:p.y<64?STONE:AIR;
 assert.ok(lavaAhead(sprinter(far,{vel:new Vec3(0.28,0,0)}).bot),'sprinting');
 assert.equal(lavaAhead(sprinter(far,{vel:new Vec3(0.1,0,0)}).bot),null,'walking: still one cell');
 const air=sprinter(far,{vel:new Vec3(0.1,0,0)});air.bot.entity.onGround=false;
 assert.ok(lavaAhead(air.bot),'off the ground');
 // a wall in the near cell hides the far one
 assert.equal(lavaAhead(sprinter(p=>p.x===11&&p.y===64?STONE:far(p),{vel:new Vec3(0.28,0,0)}).bot),null);
});
test('round 77: after a lava stop, the walking keys toward it are held off',()=>{
 assert.deepEqual(keyHeading('forward',0),{x:-0,z:-1});
 const s=sprinter(p=>p.x===11&&p.y===64?LAVA:p.y<64?STONE:AIR,{vel:new Vec3(0.2,0,0)});
 installSprintHold(s.bot);
 assert.ok(lavaGuard(s.bot));
 assert.equal(s.ctl.back,true,'the step back goes through');
 s.bot.setControlState('forward',true);assert.equal(s.ctl.forward,false,'facing the lava');
 s.bot.setControlState('sprint',true);assert.equal(s.ctl.sprint,false);
 s.bot.setControlState('jump',true);assert.equal(s.ctl.jump,false);
 s.bot.entity.yaw=Math.PI/2;s.bot.setControlState('forward',true);assert.equal(s.ctl.forward,true,'facing away');
 s.bot.entity.yaw=0;assert.equal(lavaHeld(s.bot,'right'),true,'strafing toward it');assert.equal(lavaHeld(s.bot,'left'),false);
 assert.equal(lavaHeld(s.bot,'right',Date.now()+LAVA_HOLD_MS+10),false,'the hold ends');
 // in the lava itself the escape is never held
 s.bot.blockAt=p=>({...(p.floored().x===10?LAVA:AIR),position:p});
 assert.equal(lavaHeld(s.bot,'right'),false);
});
