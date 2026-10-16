// Local fallback tasks used by the ported chains while P3 (resource tasks) and P4
// (movement helpers) are not wired into ctx yet. Names mirror the original AltoClef task
// classes so the ctx.move overrides resolve by name. Behaviour is guarded and minimal —
// the ownership rule holds: no direct pathfinder.setGoal/setMovements calls here, only
// player-level controls and equipped-item actions.
// Ported from src/main/java/adris/altoclef/tasks/movement/{RunAwayFromHostilesTask,
// RunAwayFromCreepersTask, DodgeProjectilesTask, EscapeFromLavaTask, GetToBlockTask,
// SafeRandomShimmyTask, MLGBucketTask}.java and tasks/entity/KillEntitiesTask.java,
// tasks/resources/CollectFoodTask.java (adapted).
// Original AltoClef (https://github.com/gaucho-matrero/altoclef,
// commit af22e3bc2f03dde45da703f5f7535baae18ea486), MIT License,
// Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
import {Task} from '../tasks/task.js';
import {dayTicks} from '../daytime.js';
import {yawToward} from '../heading.js';
import {dist,onFire,inGame} from './settings.js';
import {getHostiles,distanceTo,bestWeapon,attackCooldown,hasItemName,inventoryItems,withinRange,huntBlocked} from './combatPolicy.js';
import {NATURAL_DIG,isGravity} from '../digDown.js';
import {Vec3} from 'vec3';
import {fleeHeading,darkNow,leaveRefuge} from '../night.js';
import {pickCtx} from '../tasks/movement/move.js';

const setControl=(bot,name,value)=>{try{bot.setControlState(name,value);}catch{}};
const look=async(bot,yaw,pitch)=>{try{await bot.look(yaw,pitch,false);}catch{}};
const forget=(bot,...names)=>names.forEach(n=>setControl(bot,n,false));
// Resolve a P4 movement helper by Java class name, camelCase, or the verb-style factory
// key (EscapeFromLavaTask -> escapeFromLava); fall back to the local task.
const camel=s=>s[0].toLowerCase()+s.slice(1);
const resolveMove=(m,name)=>{
 if(!m)return null;
 if(typeof m[name]==='function')return m[name];
 const c=camel(name);
 if(typeof m[c]==='function')return m[c];
 if(c.endsWith('Task')&&typeof m[c.slice(0,-4)]==='function')return m[c.slice(0,-4)];
 return null;
};
export const movementTask=(ctx,name,mk)=>{
 const f=resolveMove(ctx&&ctx.move,name);
 if(f){try{const t=f();if(t&&typeof t.onTick==='function')return t;}catch{}}
 return mk();
};
// One dig at a time per bot: these tasks tick at 20 Hz, and a bot.dig per tick restarts the
// dig every 50 ms (dig start + abort + swing + look) - a packet flood toward Paper's
// 'You are sending too many packets!' kick, and the block never breaks.
const digging=new WeakSet();
const digSafe=(bot,block)=>{
 if(digging.has(bot))return;
 const p=bot.dig(block);
 if(p&&p.then){
  digging.add(bot);
  const t=setTimeout(()=>digging.delete(bot),5000);t.unref&&t.unref(); // a dig that never settles
  p.then(()=>{clearTimeout(t);digging.delete(bot);},()=>{clearTimeout(t);digging.delete(bot);});
 }
};
// mineflayer's equip reads item.slot: a bare {name} made the equip THROW silently, the
// item never reached the hand and every placement that depended on it was refused by the
// server (the A4 water douse burned the full fire clock this way - measured 2026-10-13).
const equipSafe=(bot,item,slot='hand')=>{
 let real=item;
 if(item&&item.name&&item.slot===undefined){
  real=((bot.inventory&&bot.inventory.items())||[]).find(i=>i.name===item.name)||null;
 }
 if(!real)return;
 const p=bot.equip(real,slot);p&&p.catch&&p.catch(()=>{});
};

// Feet or head in water (Via may never flip isInWater).
export const swimming=bot=>{
 const e=bot&&bot.entity;if(!e||!e.position)return false;
 if(e.isInWater)return true;
 const at=cellAt(bot),p=e.position;
 return [0.2,1.4].some(dy=>/water/.test((at(Math.floor(p.x),Math.floor(p.y+dy),Math.floor(p.z))||{}).name||''));
};
// blockAt over integer coordinates for the pure night helpers (null when unknown).
export const cellAt=bot=>(x,y,z)=>{try{return (bot&&bot.blockAt&&bot.blockAt(new Vec3(x,y,z)))||null;}catch{return null;}};
// tasks/movement/RunAwayFromEntitiesTask.java family: face away, hold forward, sprint only
// when food > 6 (7f), until every qualifying hostile is farther than `distance`. The heading
// is away from the whole crowd (weighted by closeness), never into water, lava, a deep drop
// or through another mob within 4-8 blocks (round 4: the blind sprint away from the nearest
// mob ran the bot through the pack at night and into the lake it drowned in).
class RunAwayTask extends Task{
 constructor(name,distance,{kinds=null,exclude=null}={}){super(name);this.distance=distance;this.kinds=kinds;this.exclude=exclude;}
 targets(bot,ctx){
  let hs=getHostiles(bot,ctx);
  if(this.kinds)hs=hs.filter(e=>this.kinds.has(e.name));
  if(this.exclude)hs=hs.filter(e=>!this.exclude.has(e.name));
  return hs;
 }
 isFinished(bot,ctx){return !this.targets(bot,ctx).some(e=>withinRange(e,bot,this.distance));}
 onTick(bot,ctx){
  const list=this.targets(bot,ctx).filter(e=>withinRange(e,bot,Math.max(this.distance,16)));
  if(!list.length){forget(bot,'forward','sprint');return null;}
  const c=pickCtx(this,ctx),w=c&&c.worker;
  const h=fleeHeading(cellAt(bot),bot.entity.position,list,{shelter:w&&w.shelterSpot||null,inWater:swimming(bot)});
  look(bot,yawToward(h.x,h.z),0); // along the chosen away vector (heading.js convention)
  // Every heading is a hazard (cornered against a lake or a cliff): stand, do not walk in.
  setControl(bot,'forward',!h.blocked);
  setControl(bot,'sprint',!h.blocked&&(bot.food||20)>6); // 7f: sprint needs food > 6
  return null;
 }
 onStop(bot){forget(bot,'forward','sprint','jump');}
 isEqual(o){return o&&o.constructor===this.constructor&&Math.abs(o.distance-this.distance)<1;}
}
export class RunAwayFromHostilesTask extends RunAwayTask{
 constructor(distance,includeSkeletons=false){
  super('RunAwayFromHostilesTask',distance,{exclude:includeSkeletons?null:new Set(['skeleton','stray','bogged'])});
  this.includeSkeletons=includeSkeletons;
 }
}
export class RunAwayFromCreepersTask extends RunAwayTask{
 constructor(distance){super('RunAwayFromCreepersTask',distance,{kinds:new Set(['creeper'])});}
}
// 7f daylight-burn ladder step: undead burn in the sun, so merely staying out of reach wins.
export class KeepDistanceTask extends Task{
 constructor(distance){super('KeepDistanceTask');this.distance=distance;}
 isFinished(bot,ctx){return !getHostiles(bot,ctx).some(e=>withinRange(e,bot,this.distance));}
 onTick(bot,ctx){
  const near=getHostiles(bot,ctx).sort((a,b)=>distanceTo(a,bot)-distanceTo(b,bot))[0];
  if(!near){forget(bot,'forward','sprint','back');return null;}
  const d=distanceTo(near,bot);
  const dx=near.position.x-bot.entity.position.x,dz=near.position.z-bot.entity.position.z;
  const tooClose=d<this.distance;
  // Opening the gap walks forward: the same water/drop-aware crowd heading as the run-away.
  const h=tooClose?fleeHeading(cellAt(bot),bot.entity.position,getHostiles(bot,ctx).filter(e=>withinRange(e,bot,16)),{inWater:swimming(bot)}):null;
  look(bot,h?yawToward(h.x,h.z):yawToward(-dx,-dz),0); // face AWAY from the threat: forward opens the gap
  const go=tooClose&&!(h&&h.blocked);
  setControl(bot,'forward',go);
  setControl(bot,'back',!tooClose&&d<this.distance+4);
  setControl(bot,'sprint',go&&(bot.food||20)>6);
  return null;
 }
 onStop(bot){forget(bot,'forward','back','sprint');}
 isEqual(o){return o&&o.constructor===this.constructor&&Math.abs(o.distance-this.distance)<1;}
}
// projectiles: closest approach along the velocity line (port of the arrow-dodge check).
export const approachingProjectiles=bot=>{
 if(!bot.entity)return [];
 return Object.values(bot.entities||{}).filter(e=>{
  if(!e||e===bot.entity||!e.position||!e.velocity||e.isValid===false)return false;
  if(!/^(arrow|spectral_arrow|thrown_trident|small_fireball|fireball|snowball|egg|shulker_bullet|wind_charge)$/.test(e.name||''))return false;
  if(e.name==='fireball')return false; // ghast ball: ignored like AltoClef
  const speed=e.velocity.norm?e.velocity.norm():Math.sqrt(e.velocity.x**2+e.velocity.y**2+e.velocity.z**2);
  return speed>0.3;
 });
};
export const projectileClose=(bot,horiz=2,vert=10)=>{
 const me=bot.entity.position;
 for(const p of approachingProjectiles(bot)){
  const rx=p.position.x-me.x,ry=p.position.y-me.y,rz=p.position.z-me.z;
  const vx=p.velocity.x,vy=p.velocity.y,vz=p.velocity.z;
  const vv=vx*vx+vy*vy+vz*vz;if(vv<1e-4)continue;
  const t=-(rx*vx+ry*vy+rz*vz)/vv;if(t<0)continue;
  const hx=rx+vx*t-me.x,hz=rz+vz*t-me.z,hy=ry+vy*t;
  if(hx*hx+hz*hz<horiz*horiz&&Math.abs(hy)<vert)return true;
 }
 return false;
};
export class DodgeProjectilesTask extends Task{
 constructor(horiz=2,vert=10){super('DodgeProjectilesTask');this.horiz=horiz;this.vert=vert;this._side=Math.random()<0.5?'left':'right';}
 isFinished(bot,ctx){return !projectileClose(bot,this.horiz,this.vert);}
 onTick(bot,ctx){
  if(!projectileClose(bot,this.horiz,this.vert)){forget(bot,'left','right','forward');return null;}
  setControl(bot,this._side,true); // strafe perpendicular; flip side every second
  if((Date.now()/1000|0)%2)setControl(bot,this._side,false);
  setControl(bot,'forward',true);
  return null;
 }
 onStop(bot){forget(bot,'left','right','forward');}
}
export class EscapeFromLavaTask extends Task{
 constructor(){super('EscapeFromLavaTask');}
 isFinished(bot,ctx){const e=bot.entity||{};return !e.isInLava&&!onFire(bot);}
 onTick(bot,ctx){
  // Port of EscapeFromLavaTask.onTick: sprint through lava and jump; head toward the
  // direction with the fewest lava blocks nearby (Baritone goal replacement).
  const me=bot.entity.position;
  let best=[0,1],bestCount=Infinity;
  for(const[dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]]){
   let c=0;
   for(const s of[1,2]){
    const b=bot.blockAt&&bot.blockAt(me.offset(dx*s,0,dz*s));
    if(b&&/lava/.test(b.name))c++;
   }
   if(c<bestCount){bestCount=c;best=[dx,dz];}
  }
  look(bot,yawToward(best[0],best[1]),0);
  setControl(bot,'jump',true);setControl(bot,'sprint',true);setControl(bot,'forward',true);
  return null;
 }
 onStop(bot){forget(bot,'jump','sprint','forward');}
 isEqual(o){return o&&o.constructor===this.constructor;}
}
// Drowning fallback (the ctx.move GetOutOfWaterTask paths to land when the wiring has it):
// look up, hold jump, and swim toward the nearest side whose head cell is air.
export class SwimUpTask extends Task{
 constructor(){super('SwimUpTask');}
 isFinished(bot,ctx){
  const e=bot.entity||{};
  const head=bot.blockAt&&bot.blockAt(e.position.offset(0,1.4,0));
  return !e.isInWater&&!(head&&/water/.test(head.name));
 }
 onTick(bot,ctx){
  const me=bot.entity.position;
  setControl(bot,'jump',true);setControl(bot,'sprint',false);
  let dir=null;
  for(const[dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]]){
   const b=bot.blockAt&&bot.blockAt(me.offset(dx,1,dz));
   if(b&&b.boundingBox!=='block'&&!/water|lava/.test(b.name)){dir=[dx,dz];break;}
  }
  if(dir){look(bot,yawToward(dir[0],dir[1]),0.6);setControl(bot,'forward',true);}
  else{
   look(bot,bot.entity.yaw||0,Math.PI/2);setControl(bot,'forward',false);
   // Flooded tunnel or cave with a solid roof (round 11 normal2 drowned at y=56 holding
   // jump under stone): no side opens to air, so dig the roof over the head cell.
   const roof=SwimUpTask.roofToDig(bot);
   if(roof)digSafe(bot,roof);
  }
  return null;
 }
 // The solid, diggable block right above the head cell, when there is one; null when the
 // way up is open water or air, or the block must not be broken.
 static roofToDig(bot){
  const me=bot.entity&&bot.entity.position;if(!me||!bot.blockAt)return null;
  const b=bot.blockAt(me.offset(0,2,0));
  if(!b||b.boundingBox!=='block'||/water|lava/.test(b.name))return null;
  if(/bedrock|barrier|obsidian|end_portal|spawner/.test(b.name))return null;
  for(const[dx,dy,dz]of[[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]]){
   const n=bot.blockAt(me.offset(dx,2+dy,dz));
   if(n&&/lava/.test(n.name))return null;
  }
  return b;
 }
 onStop(bot){forget(bot,'jump','forward','sprint');}
 isEqual(o){return o&&o.constructor===this.constructor;}
}
// Powder snow: a bot that walks into it sinks, freezes (entity metadata 7 = TicksFrozen,
// damage once fully frozen at 140) and, with "Health or food is low" refusing every new
// job, stands there until it dies ("BuilderBot froze to death", soak normal2 2026-10-14,
// 180 blocks up a snowy slope during the food-step explore). Dig the snow at feet and head
// (hand-breakable, drops nothing) and push toward the side with the least powder snow.
export class EscapeFreezingTask extends Task{
 constructor(){super('EscapeFreezingTask');}
 static snowAt(bot,offset){const b=bot.blockAt&&bot.blockAt(bot.entity.position.offset(0,offset,0));return b&&b.name==='powder_snow'?b:null;}
 static inPowderSnow(bot){return !!(bot.entity&&bot.entity.position&&(EscapeFreezingTask.snowAt(bot,0)||EscapeFreezingTask.snowAt(bot,1)));}
 static ticksFrozen(bot){const m=bot.entity&&bot.entity.metadata;const v=m&&m[7];return typeof v==='number'?v:0;}
 isFinished(bot,ctx){return !EscapeFreezingTask.inPowderSnow(bot);}
 onTick(bot,ctx){
  const me=bot.entity.position;
  const snow=EscapeFreezingTask.snowAt(bot,0)||EscapeFreezingTask.snowAt(bot,1);
  if(snow)digSafe(bot,snow);
  let best=[0,1],bestCount=Infinity;
  for(const[dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]]){
   let c=0;
   for(const s of[1,2,3])for(const dy of[0,1]){
    const b=bot.blockAt&&bot.blockAt(me.offset(dx*s,dy,dz*s));
    if(b&&b.name==='powder_snow')c++;
   }
   if(c<bestCount){bestCount=c;best=[dx,dz];}
  }
  look(bot,yawToward(best[0],best[1]),0);
  setControl(bot,'jump',true);setControl(bot,'forward',true);setControl(bot,'sprint',(bot.food||20)>6);
  return null;
 }
 onStop(bot){forget(bot,'jump','sprint','forward');}
 isEqual(o){return o&&o.constructor===this.constructor;}
}
// Head inside a solid block: sand or gravel that fell on the bot in a tunnel, or a stop that
// left it wedged (soak hard1/hard2 2026-10-14, 'suffocated in a wall' twice; nothing moved
// the bot once the low-health stop froze the job). Dig the block out (one dig at a time: a
// re-dig every tick restarts it and floods the server with dig packets). Only natural
// terrain and falling blocks are dug; inside anything else the bot pushes toward the side
// whose feet and head cells are open.
const suffocates=bl=>!!bl&&bl.boundingBox==='block'&&!/_leaves$|glass|_slab$|_stairs$|fence|_wall$|door|pane|_bars$|chest|scaffolding|^snow$|farmland|dirt_path|_carpet$|ladder|vine/.test(bl.name);
export class EscapeSuffocationTask extends Task{
 constructor(){super('EscapeSuffocationTask');this.digging=null;}
 static cells(bot){const p=bot.entity.position;return [bot.blockAt&&bot.blockAt(p.offset(0,1.62,0)),bot.blockAt&&bot.blockAt(p.offset(0,0.2,0))];}
 static inWall(bot){return !!(bot&&bot.entity&&bot.entity.position&&suffocates(EscapeSuffocationTask.cells(bot)[0]));}
 static diggable(bl){return NATURAL_DIG.has(bl.name)||isGravity(bl)||/_ore$/.test(bl.name);}
 isFinished(bot,ctx){return !EscapeSuffocationTask.inWall(bot);}
 onTick(bot,ctx){
  if(this.digging)return null;
  const [head,feet]=EscapeSuffocationTask.cells(bot);
  const target=[head,feet].find(bl=>suffocates(bl)&&EscapeSuffocationTask.diggable(bl));
  if(target){
   forget(bot,'forward','jump');
   const w=ctx&&ctx.worker;if(w&&w.log)try{w.log('WorldSurvival: head in '+target.name+' at '+target.position+', digging out');}catch{}
   this.digging=(async()=>{
    try{if(bot.tool&&bot.tool.equipForBlock)await bot.tool.equipForBlock(target);}catch{}
    try{await bot.dig(target);}catch{}
   })().finally(()=>{this.digging=null;});
   return null;
  }
  const me=bot.entity.position;
  for(const[dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]]){
   const open=[0.2,1.62].every(dy=>!suffocates(bot.blockAt&&bot.blockAt(me.offset(dx,dy,dz))));
   if(open){look(bot,yawToward(dx,dz),0);setControl(bot,'forward',true);setControl(bot,'jump',true);return null;}
  }
  return null;
 }
 onStop(bot){forget(bot,'forward','jump');if(this.digging)try{bot.stopDigging();}catch{}}
 isEqual(o){return o&&o.constructor===this.constructor;}
}
export class GetToBlockTask extends Task{
 constructor(blockName){super('GetToBlockTask');this.blockName=blockName;}
 findBlock(bot){
  try{return bot.findBlock({matching:b=>b&&b.name===this.blockName,useExtraInfo:false,maxDistance:48});}catch{return null;}
 }
 isFinished(bot,ctx){
  const me=bot.entity.position;
  if(this.blockName==='water'&&bot.entity.isInWater)return true;
  const b=this.findBlock(bot);
  return !!b&&dist(b.position,me)<3;
 }
 onTick(bot,ctx){
  const b=this.findBlock(bot);
  if(!b){forget(bot,'forward','sprint');return null;}
  const dx=b.position.x-bot.entity.position.x,dz=b.position.z-bot.entity.position.z;
  look(bot,yawToward(dx,dz),-0.3); // a little down (mineflayer: negative pitch looks down)
  setControl(bot,'forward',true);setControl(bot,'sprint',(bot.food||20)>6);
  return null;
 }
 onStop(bot){forget(bot,'forward','sprint');}
 isEqual(o){return o&&o.constructor===this.constructor&&o.blockName===this.blockName;}
}
export class PutOutFireTask extends Task{
 constructor(){super('PutOutFireTask');}
 static touchingFire(bot){
  const p=bot.entity.position,out=[];
  for(const[dx,dz]of[[0,0],[1,0],[1,1],[1,-1],[0,1],[0,-1],[-1,1],[-1,-1],[-1,0]]){
   const b=bot.blockAt&&bot.blockAt(p.offset(dx,0,dz));
   if(b&&/fire/.test(b.name))out.push(b);
  }
  return out;
 }
 isFinished(bot,ctx){return !onFire(bot)||PutOutFireTask.touchingFire(bot).length===0;}
 onTick(bot,ctx){
  const fire=PutOutFireTask.touchingFire(bot)[0];
  if(fire)digSafe(bot,fire);
  return null;
 }
 isEqual(o){return o&&o.constructor===this.constructor;}
}
export class SafeRandomShimmyTask extends Task{
 constructor(){super('SafeRandomShimmyTask');this._until=0;this._dirs=[];}
 isFinished(bot,ctx){
  const b=bot.blockAt&&bot.blockAt(bot.entity.position);
  return !(b&&b.name==='nether_portal');
 }
 onTick(bot,ctx){
  const now=Date.now()/1000;
  if(now>this._until){
   this._until=now+0.5;
   const keys=['forward','back','left','right'];
   this._dirs=keys.filter(()=>Math.random()<0.5);
   if(!this._dirs.length)this._dirs=[keys[Math.floor(Math.random()*4)]];
  }
  for(const k of['forward','back','left','right'])setControl(bot,k,this._dirs.includes(k));
  setControl(bot,'jump',true);
  return null;
 }
 onStop(bot){forget(bot,'forward','back','left','right','jump');}
 isEqual(o){return o&&o.constructor===this.constructor;}
}
export class MLGBucketTask extends Task{
 constructor(){super('MLGBucketTask');this.placedPos=null;}
 isFinished(bot,ctx){const e=bot.entity||{};return !!(e.onGround||e.isInWater||e.isInLava);}
 onTick(bot,ctx){
  if(this.placedPos||!hasItemName(bot,'water_bucket'))return null;
  look(bot,0,-Math.PI/2);
  const below=bot.blockAt&&bot.blockAt(bot.entity.position.offset(0,-1,0));
  if(below){
   equipSafe(bot,{name:'water_bucket'},'hand');
   const p=bot.placeBlock(below,{x:0,y:1,z:0});p&&p.catch&&p.catch(()=>{});
   this.placedPos=below.position;
  }
  return null;
 }
 isEqual(o){return o&&o.constructor===this.constructor;}
}

export class InteractWithBlockTask extends Task{
 constructor(blockPos,useItemName){super('InteractWithBlockTask');this.pos=blockPos;this.item=useItemName;}
 isFinished(bot,ctx){return this.item==='water_bucket'&&hasItemName(bot,'water_bucket');}
 onTick(bot,ctx){
  const p=this.pos;if(!p)return null;
  const block=bot.blockAt&&bot.blockAt(p);
  if(!block)return null;
  equipSafe(bot,{name:this.item},'hand');
  const lookP=bot.lookAt(p.offset(0.5,0.5,0.5));lookP&&lookP.catch&&lookP.catch(()=>{});
  const use=bot.activateBlock(block);use&&use.catch&&use.catch(()=>{});
  return null;
 }
 isEqual(o){return o&&o.constructor===this.constructor&&o.pos&&this.pos&&o.pos.equals?o.pos.equals(this.pos):o.pos===this.pos;}
}
export class ExtinguishWithWaterTask extends Task{
 // The pour itself is the worker's verified douseFire() (equip -> confirm -> forced
 // lookAt -> settle -> activate, the integration-proven use() sequence). The in-task
 // variants all failed live: the equip never settled across the chain's root churn, and
 // pours fired on a stale rotation - the A4 probe burned to death twice (2026-10-13).
 constructor({worker=null}={}){super('ExtinguishWithWaterTask');this.worker=worker;this._pourPromise=null;this._poured=false;}
 // STICKY until one pour has been attempted: onFire flips false on the client LATE (the
 // flag arrives with a delay through Via), so a naive "!onFire" finished the task the tick
 // after it armed - the chain cleared the root before the equip ever settled.
 isFinished(bot,ctx){
  if(!this._poured)return false;
  return !onFire(bot)||!hasItemName(bot,'water_bucket');
 }
 onTick(bot,ctx){
  if(!hasItemName(bot,'water_bucket'))return null;
  if(this.inFlight&&this.inFlight())return null;
  // Stop-drop-roll: a moving bot outruns its own aim and the click never lands.
  try{bot.clearControlStates();}catch{}
  const w=this.worker||(ctx&&ctx.worker);
  if(!this._pourPromise&&w&&typeof w.douseFire==='function'){
   this._pourPromise=(async()=>{
    try{await w.douseFire();}
    catch(e){try{w.log('Douse failed: '+e.message);}catch{}}
    finally{this._poured=true;this._pourPromise=null;}
   })();
  }
  return null;
 }
 isEqual(o){return o&&o.constructor===this.constructor;}
}
// tasks/entity/KillEntitiesTask.java, adapted to 7f: equips the best weapon first and
// verifies heldItem before every swing; never attacks while holding a block or food;
// unarmed non-cornered fights abort instead of swinging. Full-charge cooldown per 7b.
const FOODISH=new Set(['apple','bread','cooked_beef','beef','cooked_porkchop','porkchop','cooked_chicken','chicken','cooked_mutton','mutton','carrot','potato','baked_potato','golden_apple','sweet_berries','melon_slice','pumpkin_pie','cookie','rotten_flesh','spider_eye']);
const holdsBlockOrFood=(bot,name)=>!!name&&!FOODISH.has(name)&&!!(bot.registry&&bot.registry.blocksByName&&bot.registry.blocksByName[name]);
export class KillEntitiesTask extends Task{
 constructor(targets,{lastResort=false}={}){
  super('KillEntitiesTask');this.targets=targets;this.lastResort=lastResort;
  this.aborted=false;this._lastAttack=-1e9;this._equipAge=99;this._ticks=0;
 }
 currentTargets(bot,ctx){
  const list=typeof this.targets==='function'?this.targets(bot,ctx):this.targets;
  return (list||[]).filter(e=>e&&e.position&&e.isValid!==false);
 }
 isFinished(bot,ctx){
  if(inGame(bot)&&bot.health<=6&&!this.lastResort)return true; // bail out; the chain re-evaluates and flees (7f)
  if(this.aborted)return true;
  return !this.currentTargets(bot,ctx).some(e=>withinRange(e,bot,24));
 }
 onTick(bot,ctx){
  const list=this.currentTargets(bot,ctx).sort((a,b)=>distanceTo(a,bot)-distanceTo(b,bot));
  const target=list[0];if(!target)return null;
  // 7f: equip a real weapon and verify heldItem before the first and every swing
  const weapon=bestWeapon(bot,{allowPickaxe:this.lastResort});
  this._ticks++;this._equipAge++;
  if(weapon){
   if(!bot.heldItem||bot.heldItem.name!==weapon.name){
    // re-equip at most every 5 ticks until the held item verifies (equip is async)
    if(this._equipAge>=5){this._equipAge=0;equipSafe(bot,weapon,'hand');}
    return null;
   }
   this._equipAge=0;
  }else if(!this.lastResort){this.aborted=true;return null;} // 7f: never fight unarmed when not cornered
  else if(holdsBlockOrFood(bot,bot.heldItem&&bot.heldItem.name))return null; // cornered bare-hand: never a block or food
  const d=distanceTo(target,bot);
  if(d>2.9){ // 26.3 entity_interaction_range: swings past ~3.0 are rejected server-side
   // close distance: P4 getToEntity when available, otherwise face-and-walk
   const m=ctx&&ctx.move;
   if(m&&typeof m.getToEntity==='function'){
    try{const t=m.getToEntity(target);if(t&&typeof t.onTick==='function')return t;}catch{}
   }
   const dx=target.position.x-bot.entity.position.x,dz=target.position.z-bot.entity.position.z;
   look(bot,yawToward(dx,dz),0);
   setControl(bot,'forward',true);setControl(bot,'sprint',d>6&&(bot.food||20)>6);
   return null;
  }
  const now=Date.now()/1000;
  if(now-this._lastAttack<attackCooldown(weapon&&weapon.name))return null;
  this._lastAttack=now;
  const swing=bot.attack(target);swing&&swing.catch&&swing.catch(()=>{});
  return null;
 }
 onStop(bot,ctx){forget(bot,'forward','sprint');}
 isEqual(o){return o&&o.constructor===this.constructor&&o.lastResort===this.lastResort;}
}
// 7f ladder step 1 (review directive): craft the sword the moment a hostile approaches and
// materials exist - sticks first (2 planks, 2x2), then a table (find, place, or craft from
// 4 planks), then the sword at the table. Every craft is fire-and-forget with a retry gate
// (the Async-actions contract); the sword/axe in the inventory ends the task.
const plankCountOf=bot=>inventoryItems(bot).filter(i=>/_planks$/.test(i.name)).reduce((a,i)=>a+(i.count||1),0);
// Pick the recipe variant the held materials satisfy (see the planks-family note in
// worker.craft - mc-data lists one variant per species and [0] is just the first).
const usableVariant=(bot,itemId,table)=>{
 const variants=bot.recipesFor(bot.registry.itemsByName[itemId].id,null,1,table)||[];
 const held=inventoryItems(bot);
 for(const recipe of variants){
  const cells=recipe.inShape?recipe.inShape.flat().filter(x=>x&&x.id!==-1):(recipe.ingredients||[]);
  const tally={};
  for(const x of cells){const id=typeof x==='number'?x:x.id;tally[id]=(tally[id]||0)+1;}
  let ok=true;
  for(const [id,need] of Object.entries(tally)){
   const name=bot.registry.items[id]?.name;
   const have=name&&/_planks$/.test(name)
    ?held.filter(i=>/_planks$/.test(i.name)).reduce((a,i)=>a+(i.count||1),0)
    :(held.find(i=>i.name===name)||{count:0}).count;
   if(have<need){ok=false;break;}
  }
  if(ok)return recipe;
 }
 return null;
};
export class CraftWeaponTask extends Task{
 constructor(){super('CraftWeaponTask');this._retryAt=0;}
 isFinished(bot,ctx){
  if(hasItemName(bot,'wooden_sword')||hasItemName(bot,'wooden_axe'))return true;
  // Unachievable right now (not even 2 planks and no sticks to start from): end cleanly so
  // the chain re-evaluates and walks away instead of standing still (7f).
  return plankCountOf(bot)<2&&!hasItemName(bot,'stick');
 }
 onTick(bot,ctx){
  const mc=bot.registry&&bot.registry.itemsByName&&bot.registry.itemsByName.wooden_sword;
  if(!mc||typeof bot.recipesFor!=='function'||typeof bot.craft!=='function')return null;
  const now=Date.now();
  if(now<this._retryAt)return null; // every craft is async: gate the retries
  this._retryAt=now+500;
  const planks=plankCountOf(bot),sticks=hasItemName(bot,'stick');
  let table=null;
  try{table=bot.findBlock({matching:b=>b&&b.name==='crafting_table',useExtraInfo:false,maxDistance:4});}catch{}
  // 1. Sticks first (2 planks -> 4 sticks): the sword recipe needs one. Any plank species
  // satisfies the stick recipe - pick the variant the held planks actually match.
  if(!sticks&&planks>=2){
   const r=usableVariant(bot,'stick',null);
   if(r){const p=bot.craft(r,1,null);p&&p.catch&&p.catch(()=>{});}
   return null;
  }
  // 2. A table within reach, else place the held one, else craft one from 4 planks.
  if(!table){
   if(hasItemName(bot,'crafting_table')){
    const ground=bot.blockAt&&bot.blockAt(bot.entity.position.offset(0,-1,0));
    if(ground){
     equipSafe(bot,{name:'crafting_table'});
     const placed=bot.placeBlock(ground,{x:0,y:1,z:0});
     if(placed&&placed.then)placed.then(()=>{}).catch(()=>{});
     this._retryAt=now+1200; // place first; craft on a later tick next to the new table
    }
    return null;
   }
   if(planks>=4){
    const r=usableVariant(bot,'crafting_table',null);
    if(r){const p=bot.craft(r,1,null);p&&p.catch&&p.catch(()=>{});}
   }
   return null;
  }
  // 3. The sword, at the table (variant matched to the held planks species).
  const r=usableVariant(bot,'wooden_sword',table);
  if(r){const p=bot.craft(r,1,table);p&&p.catch&&p.catch(()=>{});}
  return null;
 }
 isEqual(o){return o&&o.constructor===this.constructor;}
}
// 7f night option: sleep skips the night entirely when a bed is reachable.
export class SleepTask extends Task{
 constructor(){super('SleepTask');this._tried=false;}
 isFinished(bot,ctx){
  const t=dayTicks(bot);
  return bot.isSleeping===true||(t!=null&&t<12000);
 }
 onTick(bot,ctx){
  if(this._tried)return null;
  let bed=null;
  try{bed=bot.findBlock({matching:b=>b&&/_bed$/.test(b.name),useExtraInfo:false,maxDistance:32});}catch{}
  if(!bed){this._tried=true;return null;}
  this._tried=true;
  const p=bot.sleep(bed);p&&p.catch&&p.catch(()=>{});
  return null;
 }
 isEqual(o){return o&&o.constructor===this.constructor;}
}
// 7f night option: hold position through the night, blocking the gap against any hostile
// that closes in (cornered step: block with a block — zombies cannot break it on normal).
// Full 3x3x3/hillside building stays with the existing shelter job until the main agent
// migrates it to a task.
export class ShelterTask extends Task{
 constructor(){super('ShelterTask');}
 isFinished(bot,ctx){
  const t=dayTicks(bot);
  return t!=null?t<12000:false; // hold until morning
 }
 onTick(bot,ctx){
  // A shelter/sleep JOB owns night-shelter building: hold position only, never place -
  // a chain-placed gap block would contest the job's own placement cells.
  const jobs=ctx&&ctx.worker&&ctx.worker.jobs;
  if(jobs&&jobs.some(j=>['running','queued'].includes(j.status)&&['sleep','shelter'].includes((j.spec||{}).type)))return null;
  const near=getHostiles(bot,ctx).sort((a,b)=>distanceTo(a,bot)-distanceTo(b,bot))[0];
  if(near&&distanceTo(near,bot)<3){
   const placeable=inventoryItems(bot).find(i=>/^(dirt|cobblestone|netherrack|sandstone|.*_planks)$/.test(i.name));
   if(placeable){
    const between=bot.blockAt&&bot.blockAt(bot.entity.position.offset(0,-1,0));
    if(between){
     equipSafe(bot,placeable,'hand');
     const dx=near.position.x-bot.entity.position.x,dz=near.position.z-bot.entity.position.z;
     look(bot,yawToward(dx,dz),0);
     const p=bot.placeBlock(between,{x:0,y:1,z:0});p&&p.catch&&p.catch(()=>{});
    }
   }
  }
  return null;
 }
 isEqual(o){return o&&o.constructor===this.constructor;}
}
// Caught outside after dark in a crowd (night.js nightRefuge): climb a 3-block column under
// the feet and hold it until morning or until nothing hostile has been within 16 for 15 s.
// Zombies cannot reach the top and a creeper cannot start its fuse from the base; the
// shield goes up toward archers. Only a mob that reaches the top (a climbing spider) is hit.
// The climb is the combat pillar's (hold jump, look down, place on the block under the feet
// at the apex) and gives up after 5 s or when knocked off the column.
// Round 7 (hard2 knocked off four times, then killed by a spider - spiders climb): once
// perched the bot lays an overhang ring around the column top - the 4 side cells, then the 4
// corners, each one block out at the top block's level. A spider climbing any face of the
// column meets the ring's underside and cannot climb past it; the bot stands on a 3x3 deck
// (harder to knock off), sneaks back to the middle when pushed, and hits anything that still
// reaches the top.
export const RING=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
const PILLAR_ITEMS=[/^cobblestone$/,/^cobbled_deepslate$/,/^netherrack$/,/^dirt$/,/_planks$/];
export const pillarBlocks=bot=>{
 const items=inventoryItems(bot);
 for(const re of PILLAR_ITEMS){
  const list=items.filter(i=>re.test(i.name));
  const count=list.reduce((s,i)=>s+(i.count||1),0);
  if(count>=1)return {item:list[0],count,total:items.filter(i=>PILLAR_ITEMS.some(r=>r.test(i.name))).reduce((s,i)=>s+(i.count||1),0)};
 }
 return null;
};
export class NightPillarTask extends Task{
 // hold: the shelter fallback - stay perched until morning, however quiet it gets.
 constructor(height=3,{hold=false}={}){
  super('NightPillarTask');this.height=height;this.hold=hold;this.phase='climb';this.base=null;this.t0=null;
  this.clickAt=-1e9;this.clickY=null;this.failed=false;this.quietSince=null;this._shield=false;
  this._lastAttack=-1e9;this._equipAt=-1e9;this.now=()=>Date.now()/1000;
  this.ringTries={};this.ringAt=-1e9;this.ringLogged=false;
 }
 _log(ctx,m){const c=pickCtx(this,ctx),w=c&&c.worker;if(w&&w.log)try{w.log(m);}catch{}}
 // A runner teardown (a higher band took over for a moment) stops this instance for good:
 // the chain adopts a fresh one that keeps the column, the phase and the quiet clock.
 resumeCopy(){const q=new NightPillarTask(this.height,{hold:this.hold});Object.assign(q,{base:this.base,phase:this.phase,t0:this.t0,quietSince:this.quietSince,ringTries:this.ringTries,ringLogged:this.ringLogged});return q;}
 isFinished(bot,ctx){
  if(this.failed)return true;
  // Morning: down once it is light and clear (round 7: not at the wrap to 0 - the night's
  // mobs are still standing, and shaded ones never burn).
  if(!darkNow(dayTicks(bot))&&(this.phase!=='perch'||leaveRefuge(dayTicks(bot),nearestHostile(bot,ctx))))return true;
  return !this.hold&&this.phase==='perch'&&this.quietSince!=null&&this.now()-this.quietSince>=15;
 }
 _top(bot){
  let n=0;
  while(n<this.height){const b=bot.blockAt&&bot.blockAt(new Vec3(this.base.x,this.base.y+n,this.base.z));if(!b||b.boundingBox!=='block')break;n++;}
  return n;
 }
 onTick(bot,ctx){
  const e=bot.entity,now=this.now();
  if(!this.base){
   this.base={x:Math.floor(e.position.x),y:Math.floor(e.position.y),z:Math.floor(e.position.z)};this.t0=now;
   this._log(ctx,'Night: caught outside in a crowd; pillar-up '+this.height+' at '+this.base.x+','+this.base.y+','+this.base.z);
  }
  const cx=Math.floor(e.position.x)-this.base.x,cz=Math.floor(e.position.z)-this.base.z;
  const off=cx!==0||cz!==0;
  if(this.phase==='climb'){
   const top=this._top(bot);
   if(top>=this.height&&e.position.y>=this.base.y+this.height-0.01){
    this.phase='perch';forget(bot,'jump');this._log(ctx,'Night: perched '+this.height+' up; holding until morning');return null;
   }
   this.rise=Math.max(this.rise||0,e.position.y-this.base.y);
   if(off||now-this.t0>5){
    this.failed=true;forget(bot,'jump','forward','sprint');
    // Round 9 hard2: `timed out at 0/3` every few seconds for 9 minutes, with no clue why.
    // Say what the climb saw: how high it got, clicks sent, the item in hand, the support.
    const under=bot.blockAt&&bot.blockAt(new Vec3(this.base.x,this.base.y-1,this.base.z));
    this._log(ctx,'Night: pillar-up failed ('+(off?'left the column':'timed out')+' at '+top+'/'+this.height+'; rose '+(this.rise||0).toFixed(2)
     +', '+(this.clicks||0)+' clicks, holding '+(bot.heldItem&&bot.heldItem.name||'nothing')+', on '+(under&&under.name||'unloaded')+(e.onGround===false?', airborne':'')+(this.staleGoal?', cleared a pathfinder goal':'')
     +(solidAt(bot,this.base.x,this.base.y+2,this.base.z)?', ceiling over the head':'')+')');
    return null;
   }
   // Round 11 (hard3: `timed out at 0/3; rose 0.00, 0 clicks`): a pathfinder goal left over
   // from an interrupted move makes the pathfinder clear the controls every physics tick, so
   // the held jump never lands. No goal while climbing.
   try{if(bot.pathfinder&&bot.pathfinder.goal){this.staleGoal=true;bot.pathfinder.setGoal(null);}}catch{}
   forget(bot,'forward','back','left','right','sprint','sneak');setControl(bot,'jump',true);
   try{const p=bot.look(e.yaw||0,-Math.PI/2,true);p&&p.catch&&p.catch(()=>{});}catch{}
   const blocks=pillarBlocks(bot);
   if(!blocks){this.failed=true;forget(bot,'jump');return null;}
   if(!bot.heldItem||!PILLAR_ITEMS.some(re=>re.test(bot.heldItem.name))){
    if(now-this._equipAt>=0.5){this._equipAt=now;equipSafe(bot,blocks.item,'hand');}
    return null;
   }
   const next=this.base.y+top;
   if(e.position.y>=next+1.1&&(this.clickY!==next||now-this.clickAt>=0.5)){
    const ref=bot.blockAt&&bot.blockAt(new Vec3(this.base.x,next-1,this.base.z));
    if(ref&&ref.boundingBox==='block'){
     this.clickAt=now;this.clickY=next;this.clicks=(this.clicks||0)+1;
     try{const p=bot.placeBlock(ref,new Vec3(0,1,0));p&&p.catch&&p.catch(()=>{});}catch{}
    }
   }
   return null;
  }
  // perch: the 3x3 deck (column top plus the ring) is still the perch
  const top=this.base.y+this.height-1;
  const deck=!off||(Math.abs(cx)<=1&&Math.abs(cz)<=1&&solidAt(bot,this.base.x+cx,top,this.base.z+cz));
  if(!deck||e.position.y<this.base.y+this.height-0.5){this.failed=true;forget(bot,'forward','sneak');this._log(ctx,'Night: knocked off the pillar');return null;}
  forget(bot,'back','left','right','sprint','jump');
  setControl(bot,'sneak',true); // never walk off the edge
  const hostiles=getHostiles(bot,ctx).filter(h=>withinRange(h,bot,16)).sort((a,b)=>distanceTo(a,bot)-distanceTo(b,bot));
  if(!hostiles.length){if(this.quietSince==null)this.quietSince=now;}else this.quietSince=null;
  // Something on top with us (a spider climbs): hit it with the best weapon.
  const climber=hostiles.find(h=>distanceTo(h,bot)<=3&&h.position.y>=e.position.y-1.5);
  if(climber){
   this._lower(bot);
   const weapon=bestWeapon(bot,{allowPickaxe:true});
   if(weapon&&(!bot.heldItem||bot.heldItem.name!==weapon.name)){if(now-this._equipAt>=0.5){this._equipAt=now;equipSafe(bot,weapon,'hand');}return null;}
   forget(bot,'forward');
   lookAtEntity(bot,climber);
   if(now-this._lastAttack>=attackCooldown(weapon&&weapon.name)){this._lastAttack=now;const a=bot.attack(climber);a&&a.catch&&a.catch(()=>{});}
   return null;
  }
  // Pushed onto the ring: sneak back to the middle of the deck.
  if(off){
   this._lower(bot);
   const dx=this.base.x+0.5-e.position.x,dz=this.base.z+0.5-e.position.z;
   try{const p=bot.look(yawToward(dx,dz),0,true);p&&p.catch&&p.catch(()=>{});}catch{}
   setControl(bot,'forward',true);
   return null;
  }
  forget(bot,'forward');
  if(this._ring(bot,ctx,now))return null;
  const archer=hostiles.find(h=>/^(skeleton|stray|bogged|pillager)$/.test(h.name||''));
  const shield=bot.inventory&&bot.inventory.slots&&bot.inventory.slots[45]&&bot.inventory.slots[45].name==='shield';
  if(archer&&shield){
   lookAtEntity(bot,archer);
   if(!this._shield){this._shield=true;try{const p=bot.activateItem(true);p&&p.catch&&p.catch(()=>{});}catch{}}
  }else this._lower(bot);
  return null;
 }
 // One ring placement per 0.3 s, against the column top (sides) or a placed side (corners);
 // a cell that refuses three clicks is skipped. True while a click is in flight.
 _ring(bot,ctx,now){
  const y=this.base.y+this.height-1;
  let open=0,placed=0;
  for(const [dx,dz] of RING){
   const x=this.base.x+dx,z=this.base.z+dz,key=dx+','+dz;
   if(solidAt(bot,x,y,z)){placed++;continue;}
   if((this.ringTries[key]||0)>=3)continue;
   open++;
   if(now-this.ringAt<0.3)return true;
   const refs=dx&&dz?[[x-dx,z],[x,z-dz]]:[[this.base.x,this.base.z]];
   const ref=refs.map(([rx,rz])=>bot.blockAt&&bot.blockAt(new Vec3(rx,y,rz))).find(b=>b&&b.boundingBox==='block');
   if(!ref)continue;
   const blocks=pillarBlocks(bot);
   if(!blocks)return false;
   if(!bot.heldItem||!PILLAR_ITEMS.some(re=>re.test(bot.heldItem.name))){
    if(now-this._equipAt>=0.5){this._equipAt=now;equipSafe(bot,blocks.item,'hand');}
    return true;
   }
   this.ringAt=now;this.ringTries[key]=(this.ringTries[key]||0)+1;
   try{const p=bot.placeBlock(ref,new Vec3(x-ref.position.x,0,z-ref.position.z));p&&p.catch&&p.catch(()=>{});}catch{}
   return true;
  }
  if(!open&&!this.ringLogged){this.ringLogged=true;this._log(ctx,'Night: overhang ring '+placed+'/'+RING.length+' around the pillar top (spiders cannot climb past it)');}
  return false;
 }
 _lower(bot){if(!this._shield)return;this._shield=false;try{const p=bot.deactivateItem();p&&p.catch&&p.catch(()=>{});}catch{}}
 onStop(bot){forget(bot,'jump','forward','sprint','sneak');this._lower(bot);}
 isEqual(o){return o===this;}
}
const nearestHostile=(bot,ctx)=>getHostiles(bot,ctx).reduce((m,h)=>Math.min(m,distanceTo(h,bot)),Infinity);
const solidAt=(bot,x,y,z)=>{const b=bot.blockAt&&bot.blockAt(new Vec3(x,y,z));return !!b&&b.boundingBox==='block';};
const lookAtEntity=(bot,e)=>{
 const me=bot.entity.position,dx=e.position.x-me.x,dz=e.position.z-me.z,dy=(e.position.y+(e.height||1.8)*0.8)-(me.y+1.62);
 try{const p=bot.look(yawToward(dx,dz),Math.atan2(dy,Math.hypot(dx,dz)),true);p&&p.catch&&p.catch(()=>{});}catch{}
};
// tasks/resources/CollectFoodTask.java (placeholder): the real gathering belongs to P3's
// resource tasks; this fallback aborts on nearby hostiles per 7f hunting rules and waits.
export class CollectFoodTask extends Task{
 constructor(units){super('CollectFoodTask');this.units=units;}
 isFinished(bot,ctx){
  const food=inventoryItems(bot).filter(i=>bot.registry&&bot.registry.foodsByName&&bot.registry.foodsByName[i.name]);
  const total=food.reduce((s,i)=>s+(bot.registry.foodsByName[i.name].foodPoints||0)*(i.count||1),0);
  return total>=this.units;
 }
 onTick(bot,ctx){
  if(huntBlocked(getHostiles(bot,ctx),bot))return null; // 7f: hostile within 8 — let the threat chain take over
  return null;
 }
 isEqual(o){return o&&o.constructor===this.constructor&&o.units===this.units;}
}
