// Reflex controller: always-on safety actions, independent of jobs (autonomy spec Phase 3).
// A reflex never fights a job for the pathfinder: it soft-pauses via worker.stop (no failure
// marking), waits for the interrupted job to finish unwinding (worker.runSettled), then acts
// as the single control owner (worker.controlToken; stale job cleanups skip themselves on
// the epoch) and releases by bumping the epoch before it resumes only the jobs it paused -
// unless the user pressed Stop or the bot died meanwhile. Sleeping or eating bots are never
// interrupted.
import pathfinderPackage from 'mineflayer-pathfinder';
import {Vec3} from 'vec3';
import {eatMeal} from './eating.js';
import {endermanAngry} from './chains/combatPolicy.js';
const {goals}=pathfinderPackage;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const UNSAFE=new Set(['spider_eye','poisonous_potato','pufferfish']);
const TIER={leather:1,golden:2,chainmail:3,iron:4,diamond:5,netherite:6};
const TOOLS={wooden:1,golden:2,stone:3,iron:4,diamond:5,netherite:6};
const KIND={sword:6,axe:5,pickaxe:2,shovel:1};
const NEUTRAL=new Set(['enderman','zombified_piglin','piglin','spider']);
const SLOTS={head:[5,'helmet','head'],chest:[6,'chestplate','torso'],legs:[7,'leggings','legs'],feet:[8,'boots','feet']};
const HAZARDS=['lava','fire','soul_fire'];
const kick=worker=>setTimeout(()=>{try{worker.pump();}catch{}},50);

export function startReflexes(worker){
 let busySince=0;
 const timer=setInterval(()=>{
  // Safety valve: a reflex that never finishes must not block jobs forever.
  if(worker.reflexBusy){
   if(!busySince)busySince=Date.now();
   else if(Date.now()-busySince>60000){worker.reflexBusy=false;busySince=0;worker.log('Reflex: cleared a stuck reflex');kick(worker);}
  }else busySince=0;
  runReflexes(worker).catch(e=>{worker.reflexBusy=false;worker.log('Reflex error: '+e.message);kick(worker);});
 },250);
 timer.unref();
 return ()=>clearInterval(timer);
}
async function runReflexes(worker){
 const b=worker.bot;
 if(!worker.ready||!b||!b.entity)return;
 // Remember what just hurt the bot so neutral mobs that attack get answered.
 if(worker.lastHealth===undefined)worker.lastHealth=b.health;
 if(b.health<worker.lastHealth-0.01){
  const attacker=Object.values(b.entities).filter(e=>e!==b.entity&&e.position&&e.type==='hostile'&&e.position.distanceTo(b.entity.position)<=6).sort((a,c)=>a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position))[0];
  if(attacker){worker.hurtBy=attacker.id;worker.hurtAt=Date.now();}
 }
 worker.lastHealth=b.health;
 if(worker.reflexBusy||!worker.reflexEnabled)return;
 if(b.isSleeping||worker.eating)return;
 const running=worker.jobs.find(j=>j.status==='running');
 if(running&&(running.spec.type==='eat'||running.spec.type==='sleep'))return;
 const threats=Object.values(b.entities).filter(e=>e!==b.entity&&e.position&&e.type==='hostile'&&e.position.distanceTo(b.entity.position)<=6&&Math.abs(e.position.y-b.entity.position.y)<=3&&canSee(b,e.position)&&isRealThreat(worker,b,e)).sort((a,c)=>a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position));
 const creeper=threats.find(e=>e.name==='creeper');
 if(creeper)return moveAway(worker,creeper,8,'creeper within 6 blocks');
 if(threats.length)return respondThreat(worker,threats[0]);
 if(hazard(b))return escapeHazard(worker);
 if((b.oxygenLevel??20)<=6&&b.entity.isInWater)return surface(worker);
 if(b.food<=14)return autoEat(worker);
 autoArmour(worker);
}
export async function withControl(worker,reason,action){
 worker.reflexBusy=true;
 const mine=new Set(worker.jobs.filter(j=>['running','queued'].includes(j.status)).map(j=>j.id));
 try{worker.reflexStopping=true;worker.stop('Reflex: '+reason,'reflex');}finally{worker.reflexStopping=false;}
 // The interrupted job unwinds asynchronously; moving before its late finally blocks ran used
 // to cancel our first navigation ("goal changed before it could be completed"). Wait, bounded
 // - a wedged job must not block a flee (stale cleanups skip themselves on the epoch anyway).
 if(worker.runSettled)await Promise.race([worker.runSettled,new Promise(r=>{setTimeout(r,2000).unref();})]);
 worker.controlToken=worker.epoch;
 try{await action();}catch(e){worker.log('Reflex error: '+e.message);}
 // Release control before resuming: the epoch bump permanently invalidates every stale
 // cleanup captured before or during the reflex; resumed jobs get a fresh token via pump.
 worker.controlToken=null;worker.epoch++;
 let resumed=0;
 if(!worker.userStopped&&!worker.deathResume){
  for(const job of worker.jobs){if(mine.has(job.id)&&job.status==='paused'){try{worker.resume(job.id);resumed++;}catch{}}}
  if(resumed)worker.log('Reflex: resumed '+resumed+' job(s)');
 }else if(worker.userStopped)worker.log('Reflex: jobs left paused (Stop was pressed)');
 worker.reflexBusy=false;kick(worker);
}
export async function gotoPoint(worker,goal,seconds){
 const b=worker.bot,token=worker.controlToken,previous=b.pathfinder.movements;
 b.pathfinder.setMovements(worker.exploreMovements());
 const reached=()=>b.entity.onGround&&goal.isEnd(b.entity.position.floored());
 let timer,monitor;
 try{
  await Promise.race([
   b.pathfinder.goto(goal),
   new Promise(resolve=>{monitor=setInterval(()=>{if(reached())resolve();},200);}),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('reflex navigation timed out')),seconds*1000);})
  ]);
 }finally{
  clearTimeout(timer);clearInterval(monitor);
  // Only the current owner touches the pathfinder: a stop that moved the epoch has already
  // reset goal, controls and movements itself for the new owner.
  if(token===worker.epoch){
   // stop() first, then setGoal(null) clears the sticky stopPathing flag for the next job.
   try{b.pathfinder.stop();b.pathfinder.setGoal(null);}catch{}
   b.clearControlStates();
   b.pathfinder.setMovements(previous||worker.movements);
  }
 }
}
function nearestThreat(b,range){
 return Object.values(b.entities).filter(e=>e!==b.entity&&e.type==='hostile'&&e.position&&e.position.distanceTo(b.entity.position)<=range).sort((a,c)=>a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position))[0];
}
// A mob in a cave below or above must not pre-empt jobs: require similar height and sight.
function canSee(b,at){
 try{
  const from=b.entity.position.offset(0,1.62,0),to=at.offset(0,1,0);
  const dir=to.minus(from),range=dir.norm();
  if(range<0.5)return true;
  return !b.world.raycast(from,dir.scaled(1/range),range);
 }catch{return true;}
}
// Neutral mobs are left alone unless they are on top of the bot or just hurt it.
function isRealThreat(worker,b,e){
 if(!NEUTRAL.has(e.name))return true;
 // Round 113: a calm enderman is never fought, however close (a hit is what provokes it).
 if(e.name==='enderman')return endermanAngry(e);
 if(e.position.distanceTo(b.entity.position)<=2)return true;
 const now=Date.now();
 return worker.hurtBy===e.id&&now-worker.hurtAt<5000;
}
async function respondThreat(worker,threat){
 const b=worker.bot;
 const weapon=b.inventory.items().filter(i=>/^(wooden|golden|stone|iron|diamond|netherite)_(sword|axe)$/.test(i.name)).sort((a,c)=>{
  const rank=n=>{const m=/^(wooden|golden|stone|iron|diamond|netherite)_(sword|axe)$/.exec(n);return (TOOLS[m[1]]||0)*10+(KIND[m[2]]||0);};
  return rank(c.name)-rank(a.name);
 })[0];
 // COMBAT_SPEC 7f: fight only when armed, healthy enough (>=14, >=10 armoured), not
 // outnumbered, and with no creeper inside 5 blocks unless a bow can answer it. Everything
 // else walks away - the unarmed bot never trades hits with a hostile.
 const armoured=b.inventory.items().some(i=>/^(leather|golden|chainmail|iron|diamond|netherite)_(helmet|chestplate|leggings|boots)$/.test(i.name));
 const melee=Object.values(b.entities).filter(e=>e!==b.entity&&e.type==='hostile'&&e.position&&e.position.distanceTo(b.entity.position)<=16&&e.name!=='creeper').length;
 const creeperClose=Object.values(b.entities).some(e=>e.name==='creeper'&&e.position&&e.position.distanceTo(b.entity.position)<=5);
 const bow=b.inventory.items().some(i=>i.name==='bow');
 if(weapon&&b.health>=(armoured?10:14)&&melee<=2&&!(creeperClose&&!bow))return fightOff(worker,threat,weapon);
 return moveAway(worker,threat,16,'hostile '+threat.name+' within 6 blocks; fleeing');
}
async function fightOff(worker,threat,weapon){
 await withControl(worker,'hostile '+threat.name+' within 6 blocks',async()=>{
  const b=worker.bot;
  try{await b.equip(weapon.item,'hand');}catch{}
  const deadline=Date.now()+90000;
  while(Date.now()<deadline){
   // A stop during the fight (user, death, a newer reflex) moved the epoch: we no longer own control.
   if(worker.controlToken!==worker.epoch)break;
   const target=nearestThreat(b,16);
   if(!target)break;
   if(b.health<8)break;
   try{
    if(target.position.distanceTo(b.entity.position)>3)await gotoPoint(worker,new goals.GoalNear(target.position.x,target.position.y,target.position.z,1),4);
    await b.lookAt(target.position.offset(0,1,0));
    // Never swing unless the hand verifies as the weapon (equips can silently fail via Via).
    if(!b.heldItem||b.heldItem.name!==weapon.name){await b.equip(weapon.item,'hand');await sleep(150);}
    if(b.heldItem&&b.heldItem.name===weapon.name)await b.attack(target);
   }catch{}
   // Swings faster than the sword's 1.6s recharge do reduced damage; wait for a full hit.
   await sleep(1250);
  }
 });
}
// Flee: keep re-pathing away until the threat is >= distance blocks off, gone, or - for a
// creeper - its fuse has cancelled (ignited flag flipped back while out of trigger range).
// The gap is then HELD while the threat keeps pursuing: a chasing zombie must not be able
// to walk the distance back down while the reflex stands still. A leg that fails or gains
// <2 blocks tilts the next bearing, so a wall, pond or tree line cannot pin the retreat.
async function moveAway(worker,threat,distance,reason){
 await withControl(worker,reason,async()=>{
  const b=worker.bot,deadline=Date.now()+45000,threatId=threat.id;
  let tilt=0,ignited=false;
  while(Date.now()<deadline){
   // A stop during the flee (user, death) moved the epoch: we no longer own control and must
   // not keep re-pathing the bot against its new owner.
   if(worker.controlToken!==worker.epoch)break;
   // Track by entity id: metadata updates can recreate the entity object, and an identity
   // miss would read as "threat gone", release the bot mid-pursuit and let jobs walk it back.
   const now=Object.values(b.entities).find(e=>e&&e.id===threatId&&e.position);
   if(!now)break;
   const idx=(b.registry.entitiesByName[now.name]?.metadataKeys||[]).indexOf('is_ignited');
   const burning=idx>=0?now.metadata?.[idx]:undefined;
   if(burning)ignited=true;
   if(ignited&&burning===false&&now.position.distanceTo(b.entity.position)>6)break;
   if(now.position.distanceTo(b.entity.position)>=distance){await sleep(500);continue;}
   const before=b.entity.position.clone();
   const dir=before.minus(now.position),flat=new Vec3(dir.x,0,dir.z);
   let heading=Math.abs(flat.x)+Math.abs(flat.z)>0?flat.normalize():new Vec3(1,0,0);
   if(tilt){const a=tilt*Math.PI/3,c=Math.cos(a),s=Math.sin(a);heading=new Vec3(heading.x*c-heading.z*s,0,heading.x*s+heading.z*c);}
   const dest=before.floored().plus(heading.scaled(distance));
   try{await gotoPoint(worker,new goals.GoalXZ(dest.x,dest.z),6);}catch(e){tilt++;worker.log('Reflex: flee leg to '+dest.floored()+' failed: '+e.message+'; tilting');}
   const gained=b.entity.position.minus(before);
   if(Math.hypot(gained.x,gained.z)<2)tilt++;else tilt=0;
  }
 });
}
function hazard(b){
 for(const offset of [new Vec3(0,0,0),new Vec3(0,1,0)]){
  const block=b.blockAt(b.entity.position.floored().plus(offset));
  if(block&&HAZARDS.includes(block.name))return block;
 }
 return null;
}
async function escapeHazard(worker){
 const b=worker.bot,at=hazard(b);
 await withControl(worker,(at?.name||'hazard')+' at the bot',async()=>{
  const b2=worker.bot;
  const dir=b2.entity.position.minus(at?.position||b2.entity.position),flat=new Vec3(dir.x,0,dir.z);
  const step=Math.abs(flat.x)+Math.abs(flat.z)>0?flat.normalize().scaled(8):new Vec3(8,0,0);
  const dest=b2.entity.position.floored().plus(step);
  try{await gotoPoint(worker,new goals.GoalXZ(dest.x,dest.z),15);}catch{}
 });
}
async function surface(worker){
 await withControl(worker,'low oxygen ('+Math.round(worker.bot.oxygenLevel??0)+'/20)',async()=>{
  const b=worker.bot,token=worker.controlToken,deadline=Date.now()+15000;
  b.setControlState('jump',true);
  try{while(Date.now()<deadline&&(b.oxygenLevel??20)<15)await sleep(200);}finally{if(token===worker.epoch)b.clearControlStates();}
 });
}
async function autoEat(worker){
 const b=worker.bot;
 const pick=()=>{
  const options=b.inventory.items().filter(i=>{
   const food=b.registry.foodsByName[i.name];
   if(!food||UNSAFE.has(i.name))return false;
   if(i.name==='rotten_flesh')return b.food<=6;
   return true;
  }).sort((x,y)=>b.registry.foodsByName[y.name].foodPoints-b.registry.foodsByName[x.name].foodPoints);
  return options[0]||null;
 };
 if(!pick())return;
 await withControl(worker,'hunger (food '+Math.round(b.food)+')',async()=>{
  const b2=worker.bot,chosen=pick();
  if(!chosen)return;
  const r=await eatMeal(b2,chosen.item.name,{worker});
  if(r.ok)worker.log('Reflex: ate '+chosen.item.name);
 });
}
function autoArmour(worker){
 const b=worker.bot;
 if(worker.jobs.some(j=>['running','queued'].includes(j.status)))return;
 for(const slot of Object.keys(SLOTS)){
  const [index,suffix,destination]=SLOTS[slot],current=b.inventory.slots[index];
  let best=current?{rank:TIER[current.name.split('_')[0]]||0,item:current,name:current.name}:null;
  for(const i of b.inventory.items()){
   if(!i.name.endsWith('_'+suffix))continue;
   const rank=TIER[i.name.split('_')[0]]||0;
   if(!best||rank>best.rank)best={rank,item:i,name:i.name};
  }
  if(best&&best.item!==current){
   worker.reflexBusy=true;
   const done=()=>{worker.reflexBusy=false;kick(worker);};
   b.equip(best.item,destination).then(()=>worker.log('Reflex: equipped '+best.name)).catch(()=>{}).finally(done);
   setTimeout(done,10000).unref();
   return;
  }
 }
}
