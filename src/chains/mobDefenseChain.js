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
import {getHostiles,nearestDistance,withinRange,distanceTo,armorValue,BURNS_IN_SUNLIGHT,canDealWithCount,evaluateFight,isCornered,canCraftWoodenSword,hasItemName,inventoryItems,nightish,isMeleeMob,meleeCount} from './combatPolicy.js';
import {movementTask,RunAwayFromHostilesTask,RunAwayFromCreepersTask,DodgeProjectilesTask,KeepDistanceTask,KillEntitiesTask,CraftWeaponTask,ShelterTask,SleepTask,NightPillarTask,PERCH_RETRY_S,WitchCoverTask,pillarBlocks,cellAt,projectileClose,approachingProjectiles} from './fallbackTasks.js';
import {nightRefuge,pillarRoom,DAY_CROWD} from '../night.js';
import {dayTicks} from '../daytime.js';
import {FightTask} from './fightTask.js';
import {creeperSwell} from '../creeper.js';
import {UNSAFE_FOOD} from './foodChain.js';
// MobDefenseChain.java constants.
const CREEPER_KEEP_DISTANCE=10;
export const CREEPER_PERSIST=20;
// Round 78 (round-77 hard2: 49 s after the box opened, unarmed, `fleeing creeper` and `resumed the
// craft job` alternating every 0.2-0.6 s for 11 s, then `creeper fuse (swell 1)` and blown up -
// the flee ends at CREEPER_KEEP_DISTANCE, the craft resumes standing still, and the creeper walks
// back in): a creeper that has followed for CREEPER_CHASE_S is kept CREEPER_CHASED_KEEP away,
// past its 16-block follow range, and that flee outranks the job.
export const CREEPER_CHASE_S=3,CREEPER_CHASED_KEEP=20;
// Round 79 (round-78 hard3: 116 s of `a creeper has followed` beside its box, keep-away and
// pillar-fight flipping every few seconds, the creeper 7.7-14.6 off and never nearer, and 25 min
// with the gather queued and the bot in one cell - a creeper that cannot path to the bot hovers):
// one that has not come CREEPER_CLOSE_STEP nearer in CREEPER_STALL_S is left while it stays beyond
// CREEPER_STALL_NEAR; inside that it is fled again from the start. A fuse is answered either way.
export const CREEPER_STALL_S=30,CREEPER_STALL_NEAR=6,CREEPER_CLOSE_STEP=1;
// Round 83: a meal goes ahead through a creeper keep-away with no creeper fusing or nearer than
// CREEPER_MEAL_NEAR and no other hostile within MEAL_CLEAR.
export const CREEPER_MEAL_NEAR=5,MEAL_CLEAR=8;
// Round 95 (round-94 hard3: out of a cave-morning climb at y=89 with a creeper beside it, health
// 20 and a stone sword; `fleeing creeper`, `keeping 20 away` 3 s later, and 6 s after that
// `creeper fuse (swell 1)` at 2.9 with `the flee is not moving the bot` - the keep-away had not
// kept it off, and the pillar fight waited for CREEPER_PERSIST): a chased creeper that comes within
// CREEPER_CLOSING_NEAR through the keep-away is fought from a pillar at once (the combat pillar
// starts inside 8), and stays so for that chase. The 7f creeper-within-5 check does not apply to
// the pillar, which is the answer to exactly that; the rest of the fight policy does. Alone is
// this creeper with no other within CREEPER_KEEP_DISTANCE: it backing off past 10 does not end it.
export const CREEPER_CLOSING_NEAR=6;
const pillarFightOk=p=>!!p.weapon&&(p.health>=14||(p.armoured&&p.health>=10))&&p.melee<=2&&(p.daylight||p.armoured);
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
// Round 75 (round-74 hard1: `fleeing ... (still recovering)` at 6.3 health with the bar at 6 and
// no food held, then 10 minutes standing at (708, 63, -526) - regeneration needs a bar of 18,
// and the cow hunt that would have fed it was the job the hold had paused): the recovering hold
// is only for a bot that can heal - a bar of 18+ or something to eat.
export const canHeal=bot=>(bot.food|0)>=18||inventoryItems(bot).some(i=>{const m=bot.registry?.foodsByName?.[i.name];return !!(m&&m.foodPoints>0)&&!UNSAFE_FOOD.has(i.name);});
// Round 75 (round-74 hard1 above, and hard2: `fleeing ... (vulnerable)` at 17 health, armour 0,
// and 3.5 minutes at (813, 84, -551) to the end of the run, a mob cave below keeping one hostile
// within 30): a run-away or keep-distance hold that has not moved the bot FLEE_STALL_BLOCKS in
// FLEE_STALL_S, with nothing within 8 in sight, stands down for FLEE_STALL_OFF s and the paused
// job resumes. A hostile within 8 in sight ends the stand-down at once.
export const FLEE_STALL_S=20,FLEE_STALL_BLOCKS=3,FLEE_STALL_OFF=60;
const HOLDS=new Set(['RunAwayFromHostilesTask','KeepDistanceTask']);
// Round 91 (round-90 hard2: health 18.2 to 3.7 in 30 s at (847, 71, -625), a creeper keep-away
// then a `(vulnerable)` flee holding it in that cell, and `slain by Zombie` with `held stone_sword;
// 1 hostile(s) within 8: zombie 1.2`): a flee that has kept the bot within FLEE_PINNED_BLOCKS for
// FLEE_PINNED_S, with a melee mob (not a creeper) within PINNED_NEAR in sight, is cornered - the 7f
// last resort fights it with the best weapon, and keeps on while one stays within PINNED_KEEP.
export const FLEE_PINNED_S=2,FLEE_PINNED_BLOCKS=1,PINNED_NEAR=3,PINNED_KEEP=5;
const FLEES=new Set(['RunAwayFromHostilesTask','RunAwayFromCreepersTask','KeepDistanceTask']);
// Round 107 (round-106: hard3 opened its box with a stone sword at health 17, struck a spider once,
// then `fleeing ... (vulnerable)` - armour 0 and health under 18 - and was bitten 17 -> 14 -> 11 ->
// 8 -> 5 -> 2 -> 0 in 7 s from behind; `cornered - fighting back` came at health 2. hard2 ran the
// same way from one zombie, cornered at health 4.3, and died. A mob that stays on the bot through a
// flee is landing free hits.) A sprinting player (5.6 blocks/s) outruns a spider (about 3.9) and a
// zombie (about 2.3), so a melee mob that keeps within CHASE_NEAR for CHASE_S means the flee is not
// working - hard3 was stranded on its box top, hard2's flee stopped at lava. Then a skilled player
// turns and fights: with a real weapon and at most CHASE_MAX_MELEE melee mobs within 8, that mob (not
// a creeper, in sight) is fought as the cornered fight (round 91), which keeps on while one stays
// within PINNED_KEEP. Round 108: no mob is fought at once any more (round 107 took a spider for as
// fast as a sprint, which it is not).
export const CHASE_NEAR=3,CHASE_S=1,CHASE_MAX_MELEE=2;
// Round 108 (the user: measure how fast the bot really runs): every flee episode of FLEE_METER_MIN s
// or more logs the distance it covered, its speed against the game's sprint (5.612 blocks/s, the
// wiki's Sprinting page; walking 4.317, sprint-jumping about 7.13), the sprint and forward key
// shares of its ticks, and the nearest hostile at its start and end - whether the flee ran at all.
export const GAME_SPRINT=5.612,GAME_WALK=4.317,GAME_SPRINT_JUMP=7.13,FLEE_METER_MIN=1;
// Round 98 (WitchCoverTask in fallbackTasks.js): a cover with no cell left to fill falls back to the
// flee for WITCH_COVER_OFF s before it looks again from the same spot.
export const WITCH_COVER_OFF=3;
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
  let p=this._priorityInner(bot,ctx);
  if(p>=0&&this._holdStood(bot,ctx))p=-1;
  this._cachedLastPriority=p;this._cachedAt=Date.now();
  try{this._fleeMeter(bot,ctx,p);}catch{}
  return p;
 }
 // Round 108: the flee speed meter (above). One episode is one flee task name on consecutive ticks.
 _fleeMeter(bot,ctx,p){
  const r=this.root,me=bot&&bot.entity&&bot.entity.position;
  if(!me)return;
  const now=this.now(),name=p>=0&&r&&FLEES.has(r.name)?r.name:null,m=this._meter;
  const key=k=>{try{return !!bot.getControlState?.(k);}catch{return false;}};
  if(m&&m.name===name){
   m.path+=Math.hypot(me.x-m.lx,me.z-m.lz);m.lx=me.x;m.lz=me.z;m.t1=now;m.n++;
   if(key('sprint'))m.sprint++;
   if(key('forward'))m.fwd++;
   return;
  }
  if(m){this._meter=null;m.path+=Math.hypot(me.x-m.lx,me.z-m.lz);m.t1=now;this._meterLog(bot,ctx,m);} // the last step ran under the flee
  if(name)this._meter={name,t0:now,t1:now,x0:me.x,z0:me.z,lx:me.x,lz:me.z,path:0,n:0,sprint:0,fwd:0,food:bot.food,near0:this._nearestNamed(bot,ctx)};
 }
 _nearestNamed(bot,ctx){
  let best=null;
  for(const e of getHostiles(bot,ctx)){const d=distanceTo(e,bot);if(d<Infinity&&(!best||d<best.d))best={name:e.name,d};}
  return best?best.name+' '+best.d.toFixed(1):'none';
 }
 _meterLog(bot,ctx,m){
  const secs=m.t1-m.t0;
  if(secs<FLEE_METER_MIN)return;
  const me=bot.entity.position,straight=Math.hypot(me.x-m.x0,me.z-m.z0),v=m.path/secs;
  const pct=x=>m.n?Math.round(100*x/m.n):0;
  if(ctx&&ctx.worker&&ctx.worker.log)try{ctx.worker.log('Speed: the '+m.name+' ran '+m.path.toFixed(1)+' blocks (straight '+straight.toFixed(1)+') in '+secs.toFixed(1)+' s = '+v.toFixed(2)+' blocks/s, '+Math.round(100*v/GAME_SPRINT)+'% of the game sprint '+GAME_SPRINT+' (walk '+GAME_WALK+'); sprint key '+pct(m.sprint)+'% and forward '+pct(m.fwd)+'% of '+m.n+' ticks, food '+(m.food??'?')+'; nearest hostile '+m.near0+' -> '+this._nearestNamed(bot,ctx));}catch{}
 }
 // Seconds the flee this chain ran on its last tick has kept the bot within FLEE_PINNED_BLOCKS.
 _pinnedFor(bot){
  const r=this.root,me=bot.entity.position,now=this.now();
  if(!(this._cachedLastPriority>=0)||!r||!FLEES.has(r.name)){this._pin=null;return 0;}
  const p=this._pin;
  if(!p||now-p.seen>2||Math.hypot(me.x-p.x,me.z-p.z)>FLEE_PINNED_BLOCKS){this._pin={x:me.x,z:me.z,at:now,seen:now};return 0;}
  p.seen=now;return now-p.at;
 }
 // Round 107: {e,secs,melee} when a melee mob has stayed within CHASE_NEAR through this chain's
 // flee long enough to stand and fight it (above); null otherwise.
 _chasedBy(bot,hostiles,policy){
  const r=this.root,now=this.now();
  const fleeing=this._cachedLastPriority>=0&&!!r&&FLEES.has(r.name)&&r.name!=='RunAwayFromCreepersTask';
  const melee=meleeCount(hostiles,bot);
  if(!fleeing||!policy||!policy.weapon||melee>CHASE_MAX_MELEE){this._chase=null;return null;}
  const near=hostiles.filter(e=>e.name!=='creeper'&&isMeleeMob(e.name)&&withinRange(e,bot,CHASE_NEAR)&&canSee(bot,e,CHASE_NEAR))
   .sort((a,b)=>distanceTo(a,bot)-distanceTo(b,bot));
  if(!near.length){this._chase=null;return null;}
  const c=this._chase&&now-this._chase.seen<=1?this._chase:(this._chase={since:now});
  c.seen=now;
  const e=near[0],secs=now-c.since;
  return secs>=CHASE_S?{e,secs,melee}:null;
 }
 _holdStood(bot,ctx){
  const r=this.root;
  if(!r||!HOLDS.has(r.name)){this._hold=null;return false;}
  const now=this.now(),me=bot.entity.position;
  if(getHostiles(bot,ctx).some(e=>withinRange(e,bot,SAFE_KEEP_DISTANCE)&&canSee(bot,e,SAFE_KEEP_DISTANCE))){this._hold=null;this._holdOffUntil=0;return false;}
  if(now<(this._holdOffUntil||0)){this._runAwayTask=null;return true;}
  const h=this._hold;
  if(!h||now-h.seen>2||Math.hypot(me.x-h.x,me.z-h.z)>FLEE_STALL_BLOCKS){this._hold={x:me.x,z:me.z,at:now,seen:now};return false;}
  h.seen=now;
  if(now-h.at<FLEE_STALL_S)return false;
  this._hold=null;this._holdOffUntil=now+FLEE_STALL_OFF;this._runAwayTask=null;this._fleeTag=null;
  if(ctx&&ctx.worker&&ctx.worker.log)try{ctx.worker.log('Reflex: the '+r.name+' held '+FLEE_STALL_S+' s without moving the bot (health '+Math.round(bot.health)+', food '+(bot.food|0)+', nothing within '+SAFE_KEEP_DISTANCE+' in sight); standing down for '+FLEE_STALL_OFF+' s');}catch{}
  return true;
 }
 // Round 83 (round-82 hard3: hp 2.2 at food 17 for 7 minutes, a creeper hovering 4.7-8.5 away for
 // 488 s, 13 food items held and no meal - the keep-away read as acrobatics and as a fight, so
 // FoodChain stood aside the whole time): the creeper keep-away is a walk, and a meal (1.6 s) is
 // shorter than a creeper's approach from CREEPER_MEAL_NEAR plus its fuse. FoodChain asks this.
 mealKeepAway(bot,ctx){
  const r=this.root;
  if(!r||r.name!=='RunAwayFromCreepersTask'||!this.isActive())return false;
  return !getHostiles(bot,ctx).some(e=>e.name==='creeper'?(creeperSwell(e).fusing||withinRange(e,bot,CREEPER_MEAL_NEAR)):withinRange(e,bot,MEAL_CLEAR));
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
  const flee=this.root,pinned=this._pinnedFor(bot);
  // Round 22 (round-21 normal3: `fleeing silverfish x4` and then 17 min of nothing, a drop job
  // queued behind the flee): silverfish and endermites (1 damage, slow) are not worth a flee
  // or a reflex unless one is within MINOR_NEAR - then it is fought like any other mob.
  let hostiles=getHostiles(bot,ctx).filter(e=>!(MINOR_MOBS.has(e.name)&&!withinRange(e,bot,MINOR_NEAR)));
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
   this.root=new RunAwayFromCreepersTask(info.keep,{fuse:true});
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
  // Cornered by a pinned flee (round 91, above), or chased through one (round 107).
  const chased=!this._cornered&&pinned<FLEE_PINNED_S?this._chasedBy(bot,hostiles,policy):null;
  if(this._cornered||pinned>=FLEE_PINNED_S||chased){
   const near=r=>e=>e.name!=='creeper'&&isMeleeMob(e.name)&&withinRange(e,bot,r)&&canSee(bot,e,r);
   const close=hostiles.filter(near(this._cornered?PINNED_KEEP:PINNED_NEAR)).sort((a,b)=>distanceTo(a,bot)-distanceTo(b,bot));
   if(close.length){
    if(!this._cornered&&chased){
     const e=chased.e,hp=Math.round(bot.health*10)/10;
     this._fleeTag=null;
     this._fleeLog(ctx,'chased','Reflex: '+e.name+' '+distanceTo(e,bot).toFixed(1)+' away has kept up with the '+flee.name+' for '+chased.secs.toFixed(1)+' s (health '+hp+', held '+(bot.heldItem?bot.heldItem.name:'nothing')+', '+chased.melee+' melee within 8); standing to fight');
    }else if(!this._cornered){
     const h=flee&&flee.heading,hp=Math.round(bot.health*10)/10;
     this._fleeTag=null;
     this._fleeLog(ctx,'pinned','Reflex: the '+flee.name+' has kept the bot in one spot for '+pinned.toFixed(1)+' s with '+close[0].name+' '+distanceTo(close[0],bot).toFixed(1)+' away (health '+hp+', held '+(bot.heldItem?bot.heldItem.name:'nothing')+(h?', heading hazard '+h.hazard+(h.blocked?' blocked':''):'')+'); cornered - fighting back');
    }
    this._cornered=true;this._runAwayTask=null;this._doingFunkyStuff=true;
    this.root=new KillEntitiesTask((b,c)=>getHostiles(b,c).filter(near(PINNED_KEEP)),{lastResort:true});
    return 85;
   }
   this._cornered=false;
  }
  // Run away from the closest creeper (AltoClef: 50 + fuse*50; mineflayer does not expose
  // the client fuse, so proximity stands in for urgency — 7f says walk away regardless).
  const ch=this._creeperChase,chasing=e=>!!ch&&ch.id===e.id&&this.now()-ch.last<=5&&this.now()-ch.since>=CREEPER_CHASE_S;
  {const c=ch&&!ch.stalled&&this.now()-ch.last<=5&&hostiles.find(e=>e.id===ch.id&&e.name==='creeper');
   if(c){const d=distanceTo(c,bot),t=this.now();
    if(ch.closest==null||d<ch.closest-CREEPER_CLOSE_STEP){ch.closest=d;ch.closedAt=t;}
    else if(t-ch.closedAt>=CREEPER_STALL_S&&d>CREEPER_STALL_NEAR&&withinRange(c,bot,CREEPER_CHASED_KEEP)){
     ch.stalled=true;this._fleeTag=null;
     if(ctx.worker&&ctx.worker.log)try{ctx.worker.log('Reflex: the creeper '+d.toFixed(1)+' away has not come nearer than '+ch.closest.toFixed(1)+' in '+Math.round(t-ch.closedAt)+' s; back to the job (fleeing it again inside '+CREEPER_STALL_NEAR+')');}catch{}
    }}}
  const stalled=e=>!!ch&&ch.id===e.id&&ch.stalled&&distanceTo(e,bot)>CREEPER_STALL_NEAR;
  // the rest of the ladder (the unarmed flee, the annoying-mob timers) leaves it too
  if(ch&&ch.stalled)hostiles=hostiles.filter(e=>!stalled(e));
  const creeper=hostiles.filter(e=>e.name==='creeper'&&!stalled(e)&&withinRange(e,bot,chasing(e)?CREEPER_CHASED_KEEP:CREEPER_KEEP_DISTANCE))
   .sort((a,b)=>distanceTo(a,bot)-distanceTo(b,bot))[0];
  if(creeper){
   // Round 46 (round-45 hard2: a creeper fled every second for 3.5 min under the canopy, the
   // iron gather never ran, no hard iron): one creeper that keeps following for CREEPER_PERSIST
   // seconds is fought instead - the combat controller's creeper tactic (pillar up, strike or
   // bow from the top), which took 0 damage in every combat run - when armed and able to fight,
   // holding blocks for the pillar, and with nothing else within 6.
   const now=this.now();
   if(!this._creeperChase||this._creeperChase.id!==creeper.id||now-this._creeperChase.last>5||this._creeperChase.stalled)this._creeperChase={id:creeper.id,since:now,last:now};
   this._creeperChase.last=now;
   const lone=hostiles.filter(e=>withinRange(e,bot,CREEPER_KEEP_DISTANCE)&&e.name==='creeper').length===1&&!hostiles.some(e=>e.name!=='creeper'&&withinRange(e,bot,6));
   const blocks=pillarBlocks(bot),cd=distanceTo(creeper,bot);
   if(!this._creeperChase.closing&&now-this._creeperChase.since>=CREEPER_CHASE_S&&cd<=CREEPER_CLOSING_NEAR)this._creeperChase.closing={d:cd};
   const alone=!hostiles.some(e=>e.id!==creeper.id&&(e.name==='creeper'?withinRange(e,bot,CREEPER_KEEP_DISTANCE):withinRange(e,bot,6)));
   const closing=!!this._creeperChase.closing&&pillarFightOk(policy)&&alone;
   if((closing||policy.allowed&&lone&&now-this._creeperChase.since>=CREEPER_PERSIST)&&blocks&&blocks.total>=2){
    this._runAwayTask=null;
    this.root=this._fight(ctx);
    if(closing)this._fleeLog(ctx,'creeper-closing','Reflex: a creeper has followed for '+Math.round(now-this._creeperChase.since)+' s and closed to '+this._creeperChase.closing.d.toFixed(1)+' through the keep-away; fighting it from a pillar');
    else this._fleeLog(ctx,'creeper-fight','Reflex: a creeper has followed for '+Math.round(now-this._creeperChase.since)+' s; fighting it from a pillar');
    return 66;
   }
   this._runAwayTask=null;
   this._doingFunkyStuff=true;
   const fuse=Math.max(0,Math.min(1,1-distanceTo(creeper,bot)/CREEPER_KEEP_DISTANCE));
   if(now-this._creeperChase.since>=CREEPER_CHASE_S){
    this.root=new RunAwayFromCreepersTask(CREEPER_CHASED_KEEP);
    this._fleeLog(ctx,'creeper-chase','Reflex: a creeper has followed for '+Math.round(now-this._creeperChase.since)+' s; keeping '+CREEPER_CHASED_KEEP+' away');
    return 55+fuse*45;
   }
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
   const cover=this._coverFrom(bot,ctx,witch,pinned);
   if(cover){this._runAwayTask=null;this._doingFunkyStuff=true;this.root=cover;return 68;}
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
  if(!policy.allowed&&hostiles.length&&this._dangerUntil>this.now()&&bot.health<14&&canHeal(bot)){
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
  // Round 105: a perch pinned past dawn came down on purpose; climbing straight back up on the
  // same deck would hold it again (a day crowd of DAY_CROWD still plans a pillar).
  if(p&&p.pinned)this._pillarRetryAt=Math.max(this._pillarRetryAt||0,this.now()+PERCH_RETRY_S);
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
  // Round 83 (round-82 hard2 fled `(unarmed - COMBAT_SPEC 7f)` holding the iron sword it crafted 55 s
  // before, health 11 in a canopy crowd): an armed bot's line names the gate that refused the fight.
  const why=!policy||!policy.weapon?'unarmed':policy.allowed?'armed; creepers only':'armed, but '+policy.reason;
  this._fleeLog(ctx,'unarmed','Reflex: fleeing '+hostiles.map(e=>e.name).join(',')+' ('+why+' - COMBAT_SPEC 7f)');
  this._runAwayTask=movementTask(ctx,'RunAwayFromHostilesTask',()=>new RunAwayFromHostilesTask(30,true));
  this.root=this._runAwayTask;
  return 80;
 }
 // Round 98: a flee pinned FLEE_PINNED_S in one spot with a witch in sight takes cover from it, and
 // keeps to the cover while the bot stays in that spot (the witch walking round to a new line).
 _coverFrom(bot,ctx,witch,pinned){
  const me=bot.entity.position,now=this.now(),c=this._cover;
  if(!(c&&Math.hypot(me.x-c.x,me.z-c.z)<=FLEE_PINNED_BLOCKS&&Math.abs(me.y-c.y)<1)){
   this._cover=null;
   const blocks=pinned>=FLEE_PINNED_S&&pillarBlocks(bot);
   if(!blocks)return null;
   this._cover={x:me.x,y:me.y,z:me.z,tries:{},task:null,offUntil:0};
   if(ctx&&ctx.worker&&ctx.worker.log)try{ctx.worker.log('Reflex: the witch flee has kept the bot in one spot for '+pinned.toFixed(1)+' s with the witch '+distanceTo(witch,bot).toFixed(1)+' away in sight (health '+Math.round(bot.health*10)/10+', '+blocks.item.name+' '+blocks.count+'); blocking its line of sight');}catch{}
  }
  const k=this._cover;
  if(k.task&&k.task.exhausted){k.task=null;k.offUntil=now+WITCH_COVER_OFF;}
  if(now<k.offUntil)return null;
  if(!k.task||k.task.stopped||k.task.witchId!==witch.id)k.task=new WitchCoverTask(witch.id,k.tries);
  return k.task;
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
