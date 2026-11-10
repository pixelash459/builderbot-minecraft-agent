// Port of AltoClef MobDefenseChain.doForceField() in a legit form (research 3).
// Runs on the worker's 250 ms cadence INDEPENDENT of jobs and task trees: when a hostile
// that can see the bot is within melee reach and the attack cooldown is full, glance at it
// and swing the best weapon. Gathering continues while zombies are dealt with - exactly
// what AltoClef does every tick. Guarded like autoArmour:
//   - never while eating/placing/digging (worker.eating / an active dig is respected);
//   - never neutral mobs, players, or anything not a Monster;
//   - never unarmed-with-a-better-option logic: sword > axe > pickaxe > empty hand,
//     but NEVER swing while holding a block or food (switch to the best weapon first);
//   - the glance overrides the current look for one packet - human-normal, not aimbot:
//     it swings only what is already within reach.
// Swing rate is the vanilla cooldown of the held weapon (server-authoritative anyway).
import {readGear,cooldownSeconds,hasLineOfSight} from './combat.js';
import {endermanAngry} from './chains/combatPolicy.js';
const dist=(a,b)=>{if(!a||!b)return Infinity;const dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z;return Math.sqrt(dx*dx+dy*dy+dz*dz);};

const state={lastSwing:-Infinity,lastGlance:-Infinity};

export function forceFieldTick(bot,worker){
 if(!bot||!worker||!worker.ready||!worker.reflexEnabled)return;
 if(worker.eating)return;
 const me=bot.entity;
 if(!me||!me.position)return;
 // Skip while a FightTask owns the duel (User Tasks during a fight job, or Mob
 // Defense). A second swing here fights the controller's cooldown bookkeeping.
 try{
  const st=worker.taskRunner&&worker.taskRunner.status();
  if(st&&(st.task==='FightTask'||st.chain==='Mob Defense'))return;
 }catch{}
 const gear=readGear(bot);
 const now=Date.now()/1000;
 if(now-state.lastSwing<cooldownSeconds(gear.weaponName,bot.registry)-0.05)return;
 // A hostile within reach that can see us (eye-line raycast through the world).
 let target=null,targetDist=Infinity;
 for(const e of Object.values(bot.entities||{})){
  if(!e||e===me||!e.position||e.isValid===false)continue;
  if(e.kind!=='hostile'&&e.type!=='hostile')continue;
  if(e.username)continue; // never players
  const META_HOSTILE=e.metadata&&(e.metadata[0]||0);
  void META_HOSTILE;
  // Round 113: metadata 16 is the block an enderman carries, not its anger - one carrying a
  // block with an odd state id read as provoked. Screaming (17) is the angry flag.
  if(e.name==='enderman'&&!endermanAngry(e))continue; // neutral unless provoked
  const d=dist(e.position,me.position);
  if(d>3.1||d>=targetDist)continue;
  if(!hasLineOfSight(bot,e))continue;
  target=e;targetDist=d;
 }
 if(!target)return;
 // Glance at it (upper body), then swing - the attack packet is what counts.
 try{
  if(now-state.lastGlance>0.25){state.lastGlance=now;
   const p=bot.lookAt(target.position.offset(0,(target.height||1.6)*0.6,0));p&&p.catch&&p.catch(()=>{});}
 }catch{}
 // Hold the best weapon: switch first if the hand holds a block/food or a worse tool.
 const held=bot.heldItem?bot.heldItem.name:null;
 const want=gear.weaponItem;
 if(want&&held!==gear.weaponName){try{const p=bot.equip(want,'hand');p&&p.catch&&p.catch(()=>{});}catch{}return;} // swing next tick
 if(!held||held!==gear.weaponName)return; // nothing verified in hand: no swing
 try{
  const p=bot.attack(target);p&&p.catch&&p.catch(()=>{});
  state.lastSwing=now;
 }catch{}
}
