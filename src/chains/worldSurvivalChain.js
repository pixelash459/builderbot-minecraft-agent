// Port of adris/altoclef chains/WorldSurvivalChain.java: lava escape (100), fire escape
// (100), self-extinguishing with a water bucket (90, pick the water back up at 60),
// drowning swim-up (input side effect, like the Java getPriority side effect), and the
// nether-portal stuck shimmy (60). Baritone goals map to ctx.move helpers (P4) with local
// guarded fallbacks of the same names.
// Original AltoClef (https://github.com/gaucho-matrero/altoclef,
// commit af22e3bc2f03dde45da703f5f7535baae18ea486), MIT License,
// Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
import {SingleTaskChain} from './singleTaskChain.js';
import {chainConfig,inGame,hasEffect,onFire,TimerGame} from './settings.js';
// (TimerGame is still used for the lava tail timer below.)
import {hasItemName} from './combatPolicy.js';
import {movementTask,EscapeFromLavaTask,EscapeFreezingTask,EscapeSuffocationTask,GetToBlockTask,PutOutFireTask,SafeRandomShimmyTask,ExtinguishWithWaterTask,InteractWithBlockTask,SwimUpTask} from './fallbackTasks.js';
import {inLava as blockInLava} from '../tasks/movement/escape-from-lava-task.js';
export class WorldSurvivalChain extends SingleTaskChain{
 constructor(){
  super('Misc World Survival Chain');
  this._wasInLavaTimer=new TimerGame(()=>Date.now()/1000,1);
  this._portalStuckTimer=new TimerGame(()=>Date.now()/1000,5);
  this._wasAvoidingDrowning=false;
  this._extinguishWaterPosition=null;
  this._portalSince=null;
  this._wallSince=null; // first tick the head was inside a solid block
  this._lavaUntil=0; // recent-lava window: douse on exit even if the fire metadata bit never arrives
  this.now=()=>Date.now()/1000;
 }
 priority(bot,ctx){
  if(!inGame(bot))return -1;
  const cfg=chainConfig(ctx);
  // A finished root must not block the NEXT band: onTick only runs while the chain is
  // selected, and right after a lava exit the escape's priority is already -1 - a stale
  // EscapeFromLavaTask root then suppressed the douse forever (A4, measured 2026-10-13).
  if(this.root&&this.root.isFinished&&!this.root.stopped&&this.root.isFinished(bot,ctx))this.root=null;
  // Drowning: swim up while out of air (side effect, as in the Java getPriority).
  this._handleDrowning(bot,cfg,ctx);
  // Lava escape
  if(this._isInLavaOhShit(bot)){
   this._lavaUntil=this.now()+4; // a lava exit leaves you burning; the flag may not arrive (Via)
   this.root=movementTask(ctx,'EscapeFromLavaTask',()=>new EscapeFromLavaTask());
   return 100;
  }
  // Fire escape
  if(this._isInFire(bot)){
   this.root=movementTask(ctx,'PutOutFireTask',()=>new PutOutFireTask());
   return 100;
  }
  // Head in a wall: dig out once it holds for 0.3 s (a physics frame clipping a corner is not
  // a wall). Runs after a Stop too, like the lava escape: a frozen bot suffocates.
  if(EscapeSuffocationTask.inWall(bot)){
   if(this._wallSince==null)this._wallSince=this.now();
   if(this.now()-this._wallSince>=0.3||this.root?.name==='EscapeSuffocationTask'){
    this.root=movementTask(ctx,'EscapeSuffocationTask',()=>new EscapeSuffocationTask());
    return 100;
   }
  }else this._wallSince=null;
  // Drowning outranks every Mob Defense band (its top is the creeper fuse at 96): round 4
  // drowned at 02:46 while the flee kept steering a submerged bot (the jump side effect alone
  // lost to the run-away's sprint-swim). Latched from air <= 6 until the air is back to 18
  // or the head is out of the water, so the escape is not dropped the tick air ticks up.
  if(this._drowning){
   this.root=movementTask(ctx,'GetOutOfWaterTask',()=>new SwimUpTask());
   if(!this._drownLogged){this._drownLogged=true;const w=ctx&&ctx.worker;if(w&&w.log)try{w.log('WorldSurvival: drowning (air '+airOf(bot)+'), swimming up');}catch{}}
   return 97;
  }
  this._drownLogged=false;
  // Powder snow: get out before the freeze damage starts (normal2 froze to death 2026-10-14).
  if(EscapeFreezingTask.inPowderSnow(bot)){
   if(!this._freezeLogged){this._freezeLogged=true;const w=ctx&&ctx.worker;if(w&&w.log)try{w.log('WorldSurvival: in powder snow (frozen '+EscapeFreezingTask.ticksFrozen(bot)+' ticks), escaping');}catch{}}
   this.root=movementTask(ctx,'EscapeFreezingTask',()=>new EscapeFreezingTask());
   return 100;
  }
  this._freezeLogged=false;
  // Extinguish with water. The recent-lava window covers the 26.3/Via path where the fire
  // metadata bit was not observed in the A4 probe: the burn ran its full clock (hp 20 -> 1)
  // because onFire stayed false and the douse never armed.
  if(cfg.extinguishWithWater!==false){
   const burning=onFire(bot)||this.now()<this._lavaUntil;
   if(this.root?.name!=='EscapeFromLavaTask'&&burning&&!hasEffect(bot,'fire_resistance')){
    if(hasItemName(bot,'water_bucket')){
     if(!this._douseLogged){
      this._douseLogged=true;
      const w=ctx&&ctx.worker;
      if(w&&w.log)try{w.log('WorldSurvival: dousing (onFire '+!!onFire(bot)+', lavaWindow '+(this.now()<this._lavaUntil)+')');}catch{}
     }
     this.root=new ExtinguishWithWaterTask({worker:ctx&&ctx.worker});
     this._extinguishWaterPosition=bot.entity.position.clone?bot.entity.position.clone():bot.entity.position;
     return 90;
    }
    this.root=movementTask(ctx,'GetToBlockTask',()=>new GetToBlockTask('water'));
    return 90;
   }
   if(hasItemName(bot,'bucket')&&!hasItemName(bot,'water_bucket')&&this._extinguishWaterPosition&&this._stillWater(bot,this._extinguishWaterPosition)){
    this.root=new InteractWithBlockTask(this._extinguishWaterPosition,'water_bucket');
    return 60;
   }
   this._extinguishWaterPosition=null;this._douseLogged=false;
  }
  // Portal stuck: after 5s inside a portal, shimmy out (interaction pauses are handled by
  // the main wiring, like Java's setInteractionPaused).
  if(this._isStuckInPortal(bot)){
   if(this._portalSince==null)this._portalSince=this.now();
  }else this._portalSince=null;
  if(this._portalSince!=null&&this.now()-this._portalSince>=5){
   this.root=movementTask(ctx,'SafeRandomShimmyTask',()=>new SafeRandomShimmyTask());
   return 60;
  }
  return -1; // Java NEGATIVE_INFINITY: nothing world-threatening right now
 }
 _handleDrowning(bot,cfg,ctx){
  if(cfg.avoidDrowning===false)return;
  const e=bot.entity||{};
  // ViaVersion: entity.isInWater may never flip and the air metadata only arrives on change
  // (bot.oxygenLevel is the reliable 0-20 field - see worker.js's spawn handler), so also
  // check the block at head height for water.
  // Round 15 (round-14 hard2 drowned at y=53 in a flooded cave): seagrass, kelp, a bubble
  // column or a waterlogged block at the head is water too, and the latch only lets go when
  // the head is in breathable air (not stone pressed against while swimming) or the air is
  // back to 18 - it released within a second and the resumed shelter job dragged the bot down.
  const at=dy=>(bot.blockAt&&e.position&&bot.blockAt(e.position.offset(0,dy,0)))||null;
  const head=at(1.4),feet=at(0.1);
  const wet=bl=>!!bl&&(WET.test(bl.name)||bl.properties?.waterlogged===true||bl.properties?.waterlogged==='true');
  const touchingWater=e.isInWater===true||wet(head)||wet(feet);
  const breathing=!!head&&/^(air|cave_air|void_air)$/.test(head.name)&&e.isInWater!==true;
  const air=airOf(bot);
  const now=Date.now();
  if(wet(head)){if(!this._headWetSince)this._headWetSince=now;}else this._headWetSince=0;
  // Round 24 (round-23 normal3: 9.3 min of `swimming up` at y=-45, the air reading live and
  // moving): the backstop is for a reading that never comes - it fires only when the air value
  // has not changed for HEAD_WET_MS while the head stayed under.
  if(air!==this._lastAir){this._lastAir=air;this._airChanged=now;}
  const stale=now-(this._airChanged||0)>=HEAD_WET_MS;
  const longUnder=!!this._headWetSince&&now-this._headWetSince>=HEAD_WET_MS&&stale;
  // Round 38 (round-37 normal1 drowned at 59,51,37 with no `drowning` line for its last 56 s -
  // the client saw no water at head or feet): health falling with nothing else to explain it
  // (no hostile within 6, no fire or lava, not starving) and the air below full is drowning too.
  const silent=this._silentHurt(bot,air,now);
  if(silent&&!this._drowning){const w=ctx&&ctx.worker;if(w&&w.log)try{w.log('WorldSurvival: losing health with no attacker (air '+air+', head '+(head?.name||'?')+', feet '+(feet?.name||'?')+'); treating it as drowning');}catch{}}
  const lowAir=air<=DROWN_AIR||longUnder||silent; // round 25: 8, was 6 (first line came at air 1) // surface at the old reflex's threshold: below it the test's <10 floor must be reachable
  if((touchingWater||silent)&&lowAir){this._drowning=true;this._drySince=0;}
  // Round 19 (round-18 normal1 drowned: released with the air at 2 while the head bobbed at
  // the surface, then dragged under by the next job): air back to 18, or head and feet dry.
  // Round 33 (round-33 normal drowned after 90 s of 300 ms releases at air 8, 6, 5... - each
  // bob dry for a tick handed the bot back to a craft in the water): dry for DRY_HOLD_MS.
  else if(air>=18)this._drowning=false;
  else if(!touchingWater&&!silent){if(!this._drySince)this._drySince=now;if(now-this._drySince>=DRY_HOLD_MS)this._drowning=false;}
  else this._drySince=0;
  if(this._drowning){const w=ctx&&ctx.worker;if(w)w.lastDrownAt=now;}
  if((touchingWater||silent)&&lowAir){
   try{bot.setControlState('jump',true);}catch{}
   this._wasAvoidingDrowning=true;
  }else if(this._wasAvoidingDrowning){
   this._wasAvoidingDrowning=false;
   try{bot.setControlState('jump',false);}catch{}
  }
 }
 // Round 38: two health drops within SILENT_HURT_MS with the air under 20 and no other cause.
 _silentHurt(bot,air,now){
  const hp=typeof bot.health==='number'?bot.health:null;if(hp==null)return false;
  if(this._hp!=null&&hp<this._hp-0.01)(this._hurts||(this._hurts=[])).push(now);
  this._hp=hp;
  this._hurts=(this._hurts||[]).filter(t=>now-t<=SILENT_HURT_MS);
  if(this._hurts.length<2||!(air<20))return false;
  if(bot.food===0)return false;
  const me=bot.entity&&bot.entity.position;if(!me)return false;
  for(const e of Object.values(bot.entities||{}))if(e&&e!==bot.entity&&e.type==='hostile'&&e.position&&e.position.distanceTo(me)<=6)return false;
  if(onFire(bot)||blockInLava(bot))return false;
  return true;
 }
 _isInLavaOhShit(bot){
  // Block-aware check only: ViaVersion's isInLava sticks true after exiting, which kept
  // this band (and the escape task under it) alive through the whole post-exit burn. The
  // old onFire 1s tail is gone on purpose - every tail second is a full burn second; the
  // block check at feet/-1/+1 already covers lava adjacency, and the fire belongs to the
  // douse the moment the blocks are dry (A4 probe: burn ended ~3.3 s with the tail,
  // douse armed at 3.1; without it the pour lands ~1.5 s earlier).
  return blockInLava(bot)&&!hasEffect(bot,'fire_resistance');
 }
 _isInFire(bot){
  if(!onFire(bot)||hasEffect(bot,'fire_resistance'))return false;
  const p=bot.entity.position;
  for(const[dx,dz]of[[0,0],[1,0],[1,1],[1,-1],[0,1],[0,-1],[-1,1],[-1,-1],[-1,0]]){
   const b=bot.blockAt&&bot.blockAt(p.offset(dx,0,dz));
   if(b&&/fire/.test(b.name))return true;
  }
  return false;
 }
 _stillWater(bot,pos){
  const b=bot.blockAt&&bot.blockAt(pos);
  return !!b&&/water/.test(b.name);
 }
 _isStuckInPortal(bot){
  const b=bot.blockAt&&bot.blockAt(bot.entity.position);
  return !!b&&b.name==='nether_portal';
 }
}
const WET=/^(water|bubble_column|seagrass|tall_seagrass|kelp|kelp_plant)$/,HEAD_WET_MS=8000,DROWN_AIR=8,DRY_HOLD_MS=1500,SILENT_HURT_MS=4000;
// Round 24: a reading above 20 is the raw air supply in ticks (0-300; the round-23 report saw
// 10-400): scaled to the 0-20 bubbles every threshold here uses.
const airOf=bot=>{const a=typeof bot.oxygenLevel==='number'?bot.oxygenLevel:(typeof bot.oxygen==='number'?bot.oxygen:20);return a>20?Math.min(20,a/15):a;};
