// Port of adris/altoclef chains/MobDefenseChain.java, with the fight/no-fight decision
// adapted to docs/COMBAT_SPEC.md 7f: never fight unarmed (get-armed -> walk away ->
// daylight burn -> shelter -> cornered last resort), health >= 14 (>= 10 armoured),
// at most 2 melee mobs, no creeper within 5 blocks without a bow, equip and verify the
// weapon before every swing, eat to full and return to the task only at health >= 14.
// The client-only KillAura force field is NOT ported (a server would see the swings;
// attacks happen only through KillEntitiesTask behind the 7f gate).
// Original AltoClef (https://github.com/gaucho-matrero/altoclef,
// commit af22e3bc2f03dde45da703f5f7535baae18ea486), MIT License,
// Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
import {SingleTaskChain} from './singleTaskChain.js';
import {chainConfig,inGame,onFire} from './settings.js';
import {getHostiles,nearestDistance,withinRange,distanceTo,armorValue,BURNS_IN_SUNLIGHT,canDealWithCount,evaluateFight,isCornered,canCraftWoodenSword,hasItemName,inventoryItems,nightish} from './combatPolicy.js';
import {movementTask,RunAwayFromHostilesTask,RunAwayFromCreepersTask,DodgeProjectilesTask,KeepDistanceTask,KillEntitiesTask,CraftWeaponTask,ShelterTask,SleepTask,NightPillarTask,pillarBlocks,cellAt,projectileClose,approachingProjectiles} from './fallbackTasks.js';
import {nightRefuge,pillarRoom,DAY_CROWD} from '../night.js';
import {dayTicks} from '../daytime.js';
import {FightTask} from './fightTask.js';
import {creeperSwell} from '../creeper.js';
// MobDefenseChain.java constants.
const CREEPER_KEEP_DISTANCE=10;
const ARROW_KEEP_DISTANCE_HORIZONTAL=2;
const ARROW_KEEP_DISTANCE_VERTICAL=10;
const DANGER_KEEP_DISTANCE=15*2;
const SAFE_KEEP_DISTANCE=8;
const fireTouching=bot=>{
 if(!bot.entity)return false;
 const p=bot.entity.position;
 for(const[dx,dz]of[[0,0],[1,0],[1,1],[1,-1],[0,1],[0,-1],[-1,1],[-1,-1],[-1,0]]){
  const b=bot.blockAt&&bot.blockAt(p.offset(dx,0,dz));
  if(b&&/fire/.test(b.name))return true;
 }
 return false;
};
// Seconds before a holding night pillar climbs again after `streak` failed climbs in a row
// (0: knocked off a perch - straight back up).
export const pillarBackoff=streak=>streak<=1?3:Math.min(60,3*2**(streak-1));
export class MobDefenseChain extends SingleTaskChain{
 constructor({food=null,mlg=null}={}){
  super('Mob Defense');
  this.food=food;this.mlg=mlg;
  this._runAwayTask=null;
  this._closeAnnoying=new Map(); // entity id -> TimerGame (MobDefenseChain._closeAnnoyingEntities)
  this._targetEntity=null;
  this._dangerUntil=0;
  this.now=()=>Date.now()/1000;
 }
 setTargetEntity(e){this._targetEntity=e;}
 resetTargetEntity(){this._targetEntity=null;}
 // The flee bands re-evaluate every tick: log each episode once, not 20 times a second.
 _fleeLog(ctx,tag,message){
  if(this._fleeTag===tag)return;
  this._fleeTag=tag;
  if(ctx&&ctx.worker&&ctx.worker.log)try{ctx.worker.log(message);}catch{}
 }
 priority(bot,ctx){
  const p=this._priorityInner(bot,ctx);
  this._cachedLastPriority=p;this._cachedAt=Date.now();
  return p;
 }
 // Fighting or fleeing as of this tick. A gate that skipped priority() leaves a stale cache,
 // which must not read as a fight forever (FoodChain defers meals on it).
 isActive(){return this._cachedLastPriority>=0&&Date.now()-(this._cachedAt||0)<1000;}
 _priorityInner(bot,ctx){
  if(!inGame(bot))return -1;
  const cfg=chainConfig(ctx);
  if(cfg.mobDefense===false)return -1;
  // Fire under our feet: WorldSurvivalChain handles it at priority 100 (Java digs it out
  // here with Baritone look/click; stepping aside keeps one owner of that behaviour).
  if(onFire(bot)&&fireTouching(bot))return -1;
  // prioritizeEating: let FoodChain's critical eat happen before dodging anything.
  if(this.food&&this.food.needsToEatCritical&&this.food.needsToEatCritical(bot))return -1;
  this._doingFunkyStuff=false;
  // Round 22 (round-21 normal3: `fleeing silverfish x4` and then 17 min of nothing, a drop job
  // queued behind the flee): silverfish and endermites (1 damage, slow) are not worth a flee
  // or a reflex unless one is within MINOR_NEAR - then it is fought like any other mob.
  const hostiles=getHostiles(bot,ctx).filter(e=>!(MINOR_MOBS.has(e.name)&&!withinRange(e,bot,MINOR_NEAR)));
  if(hostiles.some(e=>withinRange(e,bot,16)))this._dangerUntil=this.now()+8;
  const policy=evaluateFight(bot,hostiles);
  // Night refuge (night.js): a perched bot holds its column (a creeper fusing at the base is
  // exactly what the column answers); a climb still yields to the fuse flee below.
  const pillar=this._nightPillar(bot,ctx,hostiles,policy);
  if(pillar&&pillar.phase==='perch'){this.root=pillar;this._runAwayTask=null;return 72;}
  // A swelling creeper (metadata swell_dir === 1) outranks every other flee: sprint past 7,
  // or 14 when powered. Distance alone is not the fuse.
  const swelling=hostiles.filter(e=>e.name==='creeper'&&creeperSwell(e).fusing)
   .sort((a,b)=>distanceTo(a,bot)-distanceTo(b,bot))[0];
  if(swelling){
   const info=creeperSwell(swelling);
   this._runAwayTask=null;
   this._doingFunkyStuff=true;
   this.root=new RunAwayFromCreepersTask(info.keep);
   this._fleeLog(ctx,'creeper-fuse','Reflex: creeper fuse (swell '+info.swell+(info.powered?', powered':'')+') sprinting past '+info.keep);
   return 96;
  }
  // Caught outside after dark in a crowd: up a 3-block column, not a sprint through the pack.
  if(pillar){
   this._runAwayTask=null;this._doingFunkyStuff=true;
   this.root=pillar;
   this._fleeLog(ctx,'pillar',pillar.hold?'Reflex: no shelter tonight; night pillar until morning':'Reflex: night crowd ('+hostiles.filter(e=>withinRange(e,bot,16)).length+' hostiles); pillaring up instead of fleeing');
   return 72;
  }
  // Run away from the closest creeper (AltoClef: 50 + fuse*50; mineflayer does not expose
  // the client fuse, so proximity stands in for urgency — 7f says walk away regardless).
  const creeper=hostiles.filter(e=>e.name==='creeper'&&withinRange(e,bot,CREEPER_KEEP_DISTANCE))
   .sort((a,b)=>distanceTo(a,bot)-distanceTo(b,bot))[0];
  if(creeper){
   this._runAwayTask=null;
   this._doingFunkyStuff=true;
   const fuse=Math.max(0,Math.min(1,1-distanceTo(creeper,bot)/CREEPER_KEEP_DISTANCE));
   this.root=new RunAwayFromCreepersTask(CREEPER_KEEP_DISTANCE);
   this._fleeLog(ctx,'creeper','Reflex: fleeing creeper (never melee a creeper)');
   return 50+fuse*50;
  }
  // Witches are never engaged (7c/26.3 measured: they kite and out-potion every rush,
  // knockback does not apply, arrows cannot be calibrated) - break line of sight instead:
  // the run-away band covers armed and unarmed bots alike.
  // Round 16 (round-15 hard2: `fleeing witch` 330 times over 1000 s, the run lost): a witch
  // throws within ~10 blocks and only with a line of sight, so only that one is fled; and a
  // flee that has run WITCH_FLEE_MS gives up on witches beyond 6 blocks for WITCH_IGNORE_MS.
  const now=Date.now(),ignoring=now<(this._witchIgnoreUntil||0);
  const witch=hostiles.find(e=>e.name==='witch'&&withinRange(e,bot,ignoring?6:WITCH_FLEE)&&canSee(bot,e,WITCH_FLEE));
  if(!witch)this._witchSince=0;
  else if(this._witchSince&&now-this._witchSince>=WITCH_FLEE_MS&&distanceTo(witch,bot)>6){
   this._witchSince=0;this._witchIgnoreUntil=now+WITCH_IGNORE_MS;
   if(ctx.worker&&ctx.worker.log)try{ctx.worker.log('Reflex: fled a witch for '+WITCH_FLEE_MS/1000+' s; ignoring witches beyond 6 for '+WITCH_IGNORE_MS/1000+' s');}catch{}
  }else{
   if(!this._witchSince)this._witchSince=now;
   this._runAwayTask=movementTask(ctx,'RunAwayFromHostilesTask',()=>new RunAwayFromHostilesTask(30,true));
   this.root=this._runAwayTask;
   this._fleeLog(ctx,'witch','Reflex: fleeing witch (26.3: it kites and out-potions the rush)');
   return 68;
  }
  // Universally dangerous mobs (wither skeleton wither / hoglin chipping us down at low health).
  if(this._universallyDangerous(hostiles,bot)){
   this._runAwayTask=movementTask(ctx,'RunAwayFromHostilesTask',()=>new RunAwayFromHostilesTask(DANGER_KEEP_DISTANCE,false));
   this.root=this._runAwayTask;
   const worst=hostiles.find(e=>e.name==='warden')||hostiles.find(e=>e.name==='wither_skeleton')||hostiles[0];
   this._fleeLog(ctx,'danger-'+(worst?.name||'?'),'Reflex: fleeing '+(worst?.name||'a dangerous mob')+' (universally dangerous)');
   return 70;
  }
  // Dodge incoming projectiles while not busy eating.
  if(!(this.food&&this.food.isTryingToEat&&this.food.isTryingToEat())&&cfg.dodgeProjectiles!==false&&projectileClose(bot,ARROW_KEEP_DISTANCE_HORIZONTAL,ARROW_KEEP_DISTANCE_VERTICAL)){
   this._doingFunkyStuff=true;
   this._runAwayTask=null;
   this.root=movementTask(ctx,'DodgeProjectilesTask',()=>new DodgeProjectilesTask(ARROW_KEEP_DISTANCE_HORIZONTAL,ARROW_KEEP_DISTANCE_VERTICAL));
   return 65;
  }
  // Dodge everything while vulnerable (AltoClef isInDanger; skeletons burn/are ranged).
  if(this._inDanger(bot,hostiles)){
   this._fleeLog(ctx,'vulnerable','Reflex: fleeing '+hostiles.map(e=>e.name).join(',')+' (vulnerable)');
   this._runAwayTask=movementTask(ctx,'RunAwayFromHostilesTask',()=>new RunAwayFromHostilesTask(DANGER_KEEP_DISTANCE,false));
   this.root=this._runAwayTask;
   return 70;
  }
  // 7f hard gates fire immediately when a hostile is close (AltoClef force-fielded in the
  // interim; we do not swing unequipped, so escaping now is the only safe move).
  const nearest=nearestDistance(hostiles,bot);
  if(!policy.allowed&&hostiles.length&&nearest<=SAFE_KEEP_DISTANCE+2)return this._escapeLadder(bot,ctx,hostiles,cfg,policy);
  // User-approved close-threat bypass: any hostile within ~5 blocks with line of sight
  // answers NOW, outside AltoClef's 12 s annoyance window. The 7f gates already passed
  // above when they forbid the fight, so here the armed bot engages at once; the FightTask
  // still verifies the held weapon before every swing.
  if(policy.allowed&&hostiles.some(e=>withinRange(e,bot,5)&&canSee(bot,e,5))){
   this._runAwayTask=null;
   this.root=this._fight(ctx);
   return 65;
  }
  // 7f: after a dangerous encounter, eat to full and return to the task only at health >= 14.
  // Only when the fight policy still forbids fighting: a winnable fight comes first.
  if(!policy.allowed&&hostiles.length&&this._dangerUntil>this.now()&&bot.health<14){
   // Keep distance FROM the hostiles: with none nearby the band must stay inactive (its
   // task otherwise wanders the bot - e.g. out of a drowning pool it should sit in).
   this._fleeLog(ctx,'recovering','Reflex: fleeing '+hostiles.map(e=>e.name).join(',')+' (still recovering)');
   this.root=new KeepDistanceTask(16);
   return 60;
  }
  // 7f: night preparation starts at dusk, not when the first mob arrives.
  if(!policy.weapon&&!policy.daylight&&nightish(bot)&&!hostiles.some(e=>withinRange(e,bot,16))){
   this.root=hasBed(bot)?new SleepTask():new ShelterTask();
   return 55;
  }
  // Hostiles lingering close for a while (AltoClef shouldDealWithAnnoyingHostiles).
  const deal=this._annoying(bot,ctx,hostiles,cfg);
  if(deal.length&&!policy.allowed)return this._escapeLadder(bot,ctx,hostiles,cfg,policy);
  if(deal.length){
   // Creepers are never melee targets (7c bow/shield tactics live in src/combat.js and the
   // flee branch above owns every creeper within 10). The fight runs as a FightTask: the
   // controller re-picks the nearest hostile per tick under the 7d priority.
   const fightable=deal.filter(e=>e.name!=='creeper');
   if(fightable.length){
    if(canDealWithCount(policy)+1>=fightable.length){
     this._runAwayTask=null;
     this.root=this._fight(ctx);
     return 65;
    }
    this._runAwayTask=movementTask(ctx,'RunAwayFromHostilesTask',()=>new RunAwayFromHostilesTask(30,true));
    this.root=this._runAwayTask;
    return 80;
   }
   return this._escapeLadder(bot,ctx,hostiles,cfg,policy);
  }
  // By default, if not immediately in danger but already running away, keep running (cached priority).
  if(this._runAwayTask&&!this._runAwayTask.isFinished(bot,ctx)){
   this.root=this._runAwayTask;
   return this._cachedLastPriority>0?this._cachedLastPriority:70;
  }
  // Java returns 0 here; -1 is the frozen API's "inactive" and behaviourally identical
  // (the chain holds no task, so the runner simply skips it).
  this._fleeTag=null; // idle: the next episode logs again
  return -1;
 }
 // The night pillar: keep the running one (a fresh copy after a runner teardown), start one
 // when nightRefuge says so, and back off 10 s after a failed climb.
 _nightPillar(bot,ctx,hostiles,policy){
  let p=this._pillar;
  if(p&&!p.failed&&!p.isFinished(bot,ctx)){
   if(p.stopped)p=this._pillar=p.resumeCopy();
   return p;
  }
  // A holding pillar knocked off re-climbs sooner: it is the whole night's refuge. Round 9
  // hard2: a climb that never got off the ground retried every few seconds for 9 minutes -
  // climbs that fail in a row back off (PILLAR_BACKOFF: 3, 6, 12 ... 60 s); a perch resets.
  if(p&&p.failed){
   this._pillarStreak=p.phase==='climb'?(this._pillarStreak||0)+1:0;
   this._pillarRetryAt=this.now()+(p.hold?pillarBackoff(this._pillarStreak):10);
  }
  if(p&&p.phase==='perch')this._pillarStreak=0;
  this._pillar=null;
  if(this.now()<(this._pillarRetryAt||0))return null;
  const e=bot.entity,w=ctx&&ctx.worker;
  const blocks=pillarBlocks(bot);
  const x=Math.floor(e.position.x),y=Math.floor(e.position.y),z=Math.floor(e.position.z);
  const plan=nightRefuge({tod:dayTicks(bot),me:e.position,hostiles,blocks:blocks?blocks.total:0,
   room:blocks?pillarRoom(cellAt(bot),x,y,z,3):0,onGround:e.onGround!==false,inFluid:!!(e.isInWater||e.isInLava),fightAllowed:policy.allowed,
   forced:!!(w&&typeof w.nightPillarWanted==='function'&&w.nightPillarWanted(bot))});
  if(!plan){
   // Round 42: a big crowd and no pillar - say why (once per 10 s).
   const crowd=hostiles.filter(h=>h&&h.position&&h.position.distanceTo(e.position)<=16).length;
   if(crowd>=DAY_CROWD&&this.now()-(this._noPillarLog||-99)>=10){this._noPillarLog=this.now();try{w&&w.log&&w.log('Night: no pillar for '+crowd+' hostiles (blocks '+(blocks?blocks.total:0)+', room '+(blocks?pillarRoom(cellAt(bot),x,y,z,3):'-')+', onGround '+(e.onGround!==false)+', fluid '+!!(e.isInWater||e.isInLava)+')');}catch{}}
   return null;
  }
  return this._pillar=new NightPillarTask(plan.height,{hold:plan.hold,day:!!plan.day});
 }
 // The armed response as a FightTask (ActionTask subclass): the TaskRunner is the single
 // owner, the controller only ever sees the ownership-guarded move helper.
 _fight(ctx){
  const w=ctx&&ctx.worker;
  return new FightTask({
   move:ctx&&ctx.move||{},
   log:w&&w.log?(m=>{try{w.log(m);}catch{}}):null,
   opts:{range:16}});
 }
 // 7f "no weapon / fight not winnable" ladder, in the spec's order of preference.
 _escapeLadder(bot,ctx,hostiles,cfg,policy){
  const nearest=nearestDistance(hostiles,bot);
  // 5. Cornered with no escape path: very last resort, best item (axe > pickaxe > fist; never a block).
  if(isCornered(hostiles,bot)){
   this._runAwayTask=null;
   this.root=new KillEntitiesTask(hostiles,{lastResort:true});
   return 85;
  }
  // 1. Get armed first — but only while there is time (a zombie covers ~8 blocks while a sword is crafted).
  if(!policy.weapon&&canCraftWoodenSword(bot)&&nearest>SAFE_KEEP_DISTANCE){
   this.root=new CraftWeaponTask();
   return 75;
  }
  // 3. Daytime threats burn: staying out of reach is often enough.
  if(policy.daylight&&hostiles.every(e=>BURNS_IN_SUNLIGHT.has(e.name))){
   this._fleeLog(ctx,'daylight','Reflex: fleeing '+hostiles.map(e=>e.name).join(',')+' (daylight - they burn)');
   this.root=new KeepDistanceTask(16);
   return 65;
  }
  // 2. Walk away (sprint if food > 6, break line of sight, keep far more than the 16-block minimum).
  this._fleeLog(ctx,'unarmed','Reflex: fleeing '+hostiles.map(e=>e.name).join(',')+' (unarmed - COMBAT_SPEC 7f)');
  this._runAwayTask=movementTask(ctx,'RunAwayFromHostilesTask',()=>new RunAwayFromHostilesTask(30,true));
  this.root=this._runAwayTask;
  return 80;
 }
 _universallyDangerous(hostiles,bot){
  const angry=e=>true; // mineflayer has no anger state; presence within range stands in
  const wither=hostiles.find(e=>e.name==='wither_skeleton'&&withinRange(e,bot,SAFE_KEEP_DISTANCE-2));
  if(wither&&angry(wither))return true;
  if(hostiles.some(e=>e.name==='warden'&&withinRange(e,bot,WARDEN_FLEE)))return true; // round 21
  if(bot.health<10&&hostiles.some(e=>(e.name==='hoglin'||e.name==='zoglin')&&withinRange(e,bot,SAFE_KEEP_DISTANCE-1)))return true;
  return false;
 }
 _inDanger(bot,hostiles){
  const armor=armorValue(bot),health=bot.health;
  const vulnerable=(armor<=15&&health<3)||(armor<10&&health<10)||(armor<5&&health<18);
  if(!vulnerable)return false;
  return hostiles.some(e=>e.name!=='skeleton'&&e.name!=='stray'&&e.name!=='bogged'&&withinRange(e,bot,SAFE_KEEP_DISTANCE));
 }
 // MobDefenseChain's per-hostile timers: close for killAnnoyingHostileWhenCloseForSeconds -> deal with it.
 _annoying(bot,ctx,hostiles,cfg){
  const out=[];
  for(const e of hostiles){
   const range=(e.name==='skeleton'||e.name==='stray'||e.name==='bogged'||e.name==='witch')?18:5;
   if(!withinRange(e,bot,range))continue;
   if(!canSee(bot,e,range))continue;
   let timer=this._closeAnnoying.get(e.id);
   if(!timer){
    timer={t0:this.now(),period:cfg.killAnnoyingHostileWhenCloseForSeconds};
    this._closeAnnoying.set(e.id,timer);
   }
   if(this.now()-timer.t0>=timer.period)out.push(e);
  }
  for(const id of[...this._closeAnnoying.keys()]){
   const e=(bot.entities||{})[id];
   if(!e||e.isValid===false)this._closeAnnoying.delete(id);
  }
  return out;
 }
}
// LookHelper.seesPlayer port: sample the eye line for solid blocks. With no block data
// (fake bots, unloaded chunks) the target counts as visible.
export const MINOR_MOBS=new Set(['silverfish','endermite']),MINOR_NEAR=3;
export const WARDEN_FLEE=24,WITCH_FLEE=10,WITCH_FLEE_MS=45000,WITCH_IGNORE_MS=60000;
const canSee=(bot,from,range)=>{
 try{
  const me=bot.entity.position;
  const eyes=from.position.offset(0,from.height?from.height*0.9:1.6,0);
  const mine=me.offset(0,1.6,0);
  const steps=Math.ceil(from.position.distanceTo(me)*2);
  for(let i=1;i<steps;i++){
   const t=i/steps;
   const b=bot.blockAt&&bot.blockAt(mine.offset((eyes.x-mine.x)*t,(eyes.y-mine.y)*t,(eyes.z-mine.z)*t));
   if(b&&b.boundingBox==='block')return false;
  }
 }catch{}
 return true;
};
const hasBed=bot=>{
 if(hasItemName(bot,'bed')||inventoryItems(bot).some(i=>/_bed$/.test(i.name)))return true;
 try{return !!bot.findBlock({matching:b=>b&&/_bed$/.test(b.name),useExtraInfo:false,maxDistance:32});}catch{return false;}
};
