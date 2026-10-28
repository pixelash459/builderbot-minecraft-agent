// Phase 7b core combat technique (docs/COMBAT_SPEC.md 7b/7c), built on the ported
// AltoClef task architecture (docs/ALTOCLEF_PORT_SPEC.md). New code, not a Java port.
// mineflayer-hawkeye (npm "minecrafthawkeye", latest 1.3.9, 2024-05) declares no
// mineflayer peer range at all and would add new dependencies (detect-collisions, uuid),
// so the ballistic aim is implemented natively per the phase brief.
//
// Every value marked ASSUMPTION below is the standard vanilla 1.21.4 number, NOT measured:
// minecraft-data 3.117.0 does not ship per-item attack speeds or projectile ballistics, so
// these must be verified live on the private server before being trusted (COMBAT_SPEC 7b:
// "measured in game, not assumed").
//
// The CombatController never touches mineflayer-pathfinder: it drives player-level
// controls, look, attack and hand-item packets only, and only while its worker owns the
// control token (same ownership rule as src/tasks/movement/move.js). Pure helpers take
// `bot` explicitly and never await; async calls are fire-and-forget with verified state
// on later ticks (docs/TASK_API.md "Async actions").
import {Vec3} from 'vec3';
import {creeperSwell} from './creeper.js';
import {hitsBot} from './place-support.js';
import {yawToward,pitchToward,headingOf} from './heading.js';
import {ArrowShots} from './arrowShots.js';

const dist=(a,b)=>{
 if(!a||!b)return Infinity;
 const dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z;
 return Math.sqrt(dx*dx+dy*dy+dz*dz);
};

// Pillar blocks by blast resistance: cobble/deepslate first, dirt last (a blast at the
// base tears dirt out from under the bot).
// Group spacing moves relative to the facing yaw (prismarine-physics applyHeading).
const GROUP_MOVES=[[{back:true},Math.PI],[{back:true,left:true},Math.PI*0.75],[{back:true,right:true},-Math.PI*0.75],[{left:true},Math.PI/2],[{right:true},-Math.PI/2]];
const PILLAR_BLOCKS=[/^cobblestone$/,/^cobbled_deepslate$/,/_planks$/,/^netherrack$/,/^dirt$/];

// ---- 7b.1 attack cooldown ---------------------------------------------------------------
const WEAPON_RE=/^(wooden|golden|stone|iron|diamond|netherite)_(sword|axe|pickaxe|shovel|hoe)$/;
export const TIER_RANK={wooden:0,golden:0,stone:1,iron:2,diamond:3,netherite:4};
// ASSUMPTION: vanilla 1.21.4 attack speeds (attacks/second). minecraft-data 3.117.0's
// items table for 1.21.4 carries no attackSpeed field (verified 2026-10-10), so this table
// is the operative source until a live measurement says otherwise.
// SERVER-MEASURED (2026-10-12, private 26.3 test server via ViaVersion): a stone sword's
// landed-damage per swing at a 0.625 s gate calibrated to charge ~0.6, which puts the real
// sword recharge at ~1.0 s (attack speed ~1.0) - NOT vanilla 1.6. Live damage per swing
// doubled after this change (scoreboard damage_dealt calibration, 11 swings -> 30.2 dmg).
export const VANILLA_ATTACK_SPEED={sword:1.0,pickaxe:1.2,shovel:1.0,trident:1.1};
const AXE_SPEED={wooden:0.8,golden:1.0,stone:0.8,iron:0.9,diamond:1.0,netherite:1.0};
const HOE_SPEED={wooden:1.0,golden:1.0,stone:2.0,iron:3.0,diamond:4.0,netherite:4.0};
// registry.itemsByName[x].attackSpeed wins when a future mc-data ships it; else the table.
export function attackSpeedOf(itemName,registry){
 try{
  const speed=registry&&registry.itemsByName&&registry.itemsByName[itemName]&&registry.itemsByName[itemName].attackSpeed;
  if(typeof speed==='number'&&speed>0)return speed;
 }catch{}
 const m=WEAPON_RE.exec(itemName||'');
 if(!m)return itemName==='trident'?VANILLA_ATTACK_SPEED.trident:null;
 const[,tier,kind]=m;
 if(kind==='sword')return VANILLA_ATTACK_SPEED.sword;
 if(kind==='axe')return AXE_SPEED[tier];
 if(kind==='pickaxe')return VANILLA_ATTACK_SPEED.pickaxe;
 if(kind==='shovel')return VANILLA_ATTACK_SPEED.shovel;
 return HOE_SPEED[tier];
}
// Full charge in seconds (vanilla: delay ticks = (1/speed)*20). Hand: 4.0 -> 0.25 s.
export function cooldownSeconds(itemName,registry){
 return 1/(attackSpeedOf(itemName,registry)||4.0);
}

// ---- 7b.2 critical hits -----------------------------------------------------------------
const asVec3=p=>p&&p.offset?p:new Vec3(p.x,p.y,p.z);
const blockAt=(bot,p)=>{try{const b=bot&&bot.blockAt&&bot.blockAt(asVec3(p));return b||null;}catch{return null;}};
const passable=(bot,p)=>{const b=blockAt(bot,p);return !b||b.boundingBox!=='block';};
// 2 blocks of headroom above the head cell so a jump (~1.25 blocks) never clips a ceiling.
export function hasHeadroom(bot,blocks=2){
 const p=bot&&bot.entity&&bot.entity.position;
 if(!p)return false;
 for(let i=0;i<blocks;i++)if(!passable(bot,{x:Math.floor(p.x),y:Math.floor(p.y)+2+i,z:Math.floor(p.z)}))return false;
 return true;
}
const bodyCells=bot=>{
 const e=bot&&bot.entity;
 if(!e||!e.position)return [];
 const p=e.position,out=[];
 for(const dy of[0,1]){
  const b=blockAt(bot,{x:Math.floor(p.x),y:Math.floor(p.y)+dy,z:Math.floor(p.z)});
  if(b)out.push(b.name);
 }
 return out;
};
export const isSprinting=bot=>!!((bot&&bot.controlState&&bot.controlState.sprint)||(bot&&bot.entity&&bot.entity.sprinting));
// Strike-time check: airborne AND falling, not sprinting, not in water/ladder/cobweb.
export function isCritOpportunity(bot){
 const e=bot&&bot.entity;
 if(!e||e.onGround||e.isInWater||isSprinting(bot))return false;
 const v=e.velocity;
 if(!v||!(v.y<-0.05))return false; // still rising: no crit yet
 const names=bodyCells(bot);
 return !names.some(n=>n==='ladder'||n==='vine'||n==='cobweb');
}
// Jump-start check: grounded, dry, on land, with headroom for the hop.
export function shouldJumpForCrit(bot,headroom=2){
 const e=bot&&bot.entity;
 if(!e||!e.onGround||e.isInWater||isSprinting(bot))return false;
 if(bodyCells(bot).some(n=>n==='ladder'||n==='vine'||n==='cobweb'))return false;
 return hasHeadroom(bot,headroom);
}

// ---- 7b.4 sweep attacks -----------------------------------------------------------------
// Sword only, on the ground, not sprinting, full charge, grounded target, not a crit hit.
export function shouldSweep(bot,weaponName,{charge=1,targetOnGround=true,crit=false}={}){
 const e=bot&&bot.entity;
 if(!e||!e.onGround)return false;
 if(!/^(wooden|golden|stone|iron|diamond|netherite)_sword$/.test(weaponName||''))return false;
 if(charge<1||crit||isSprinting(bot))return false;
 return targetOnGround!==false;
}

// ---- 7b.5 incoming projectiles ----------------------------------------------------------
// Arrows and tridents per the spec; ghast fireballs are ignored (AltoClef behaviour).
const PROJECTILE_RE=/^(arrow|spectral_arrow|thrown_trident|trident|wind_charge|snowball|egg|small_fireball)$/;
// projectileThreat(bot,entities,{miss,horizon,speedMin}) -> [{entity,eta,miss}] by eta.
// Closest approach solves the projectile line against the bot's LEAD position (relative
// velocity), so arrows aimed where the bot is going still count and misses do not.
export function projectileThreat(bot,entities,opts={}){
 const out=[];
 const me=bot&&bot.entity;
 if(!me||!me.position)return out;
 const miss=opts.miss??1.6,horizon=opts.horizon??3,speedMin=opts.speedMin??0.3;
 const u=me.velocity||{x:0,y:0,z:0};
 for(const e of entities||[]){
  if(!e||e===me||!e.position||!e.velocity||e.isValid===false)continue;
  if(!PROJECTILE_RE.test(e.name||''))continue;
  const v=e.velocity;
  const speed=Math.sqrt(v.x*v.x+v.y*v.y+v.z*v.z);
  if(speed<speedMin)continue;
  const rx=e.position.x-me.position.x,ry=e.position.y-me.position.y,rz=e.position.z-me.position.z;
  const w={x:v.x-u.x,y:v.y-u.y,z:v.z-u.z};
  const ww=w.x*w.x+w.y*w.y+w.z*w.z;
  if(ww<1e-6)continue;
  const t=Math.max(0,-(rx*w.x+ry*w.y+rz*w.z)/ww);
  const cx=rx+w.x*t,cy=ry+w.y*t,cz=rz+w.z*t;
  const md=Math.sqrt(cx*cx+cy*cy+cz*cz);
  if(md<=miss&&t<=horizon)out.push({entity:e,eta:t,miss:md});
 }
 return out.sort((a,b)=>a.eta-b.eta);
}

// ---- 7b.6 ballistic bow aim --------------------------------------------------------------
// ASSUMPTION: standard mineflayer/vanilla arrow ballistics, to verify live on the server:
// gravity 0.05 blocks/tick^2, drag 0.99 per tick, 3.0 blocks/tick at full draw (1 s).
export const ARROW_GRAVITY=0.05;
export const ARROW_DRAG=0.99;
export const ARROW_SPEED=3.0; // blocks/tick at full draw
export const FULL_DRAW_SECONDS=1.0;
export const ARROW_LAUNCH_HEIGHT=1.52; // vanilla spawns the arrow at the shooter's eye (1.62) - 0.1
// Trajectory in blocks/tick (mineflayer velocity units), one point per tick, in vanilla
// AbstractArrow.tick order (as minecrafthawkeye / mineflayer-projectile model it): pos += vel,
// THEN vel *= drag, THEN vel.y -= gravity. The old drag-and-gravity-first order dropped every
// shot a tick early. Direction is mineflayer's view vector (heading.js). `inherit` is the
// shooter's own motion, which vanilla adds to the launch (x/z always, y only airborne).
export function arrowTrajectory(from,yaw,pitch,{speed=ARROW_SPEED,gravity=ARROW_GRAVITY,drag=ARROW_DRAG,ticks=100,inherit=null}={}){
 const pos={x:from.x,y:from.y,z:from.z},u=inherit||{};
 const c=Math.cos(pitch);
 let vx=-Math.sin(yaw)*c*speed+(u.x||0),vy=Math.sin(pitch)*speed+(u.y||0),vz=-Math.cos(yaw)*c*speed+(u.z||0);
 const path=[];
 for(let t=1;t<=ticks;t++){
  pos.x+=vx;pos.y+=vy;pos.z+=vz;
  path.push({x:pos.x,y:pos.y,z:pos.z,t});
  vx*=drag;vy*=drag;vz*=drag;vy-=gravity;
 }
 return path;
}
// Displacement per unit of launch velocity after n ticks: sum drag^k, k<n. The flight is
// linear in the launch velocity, so the shooter's inherited motion u moves the arrow by
// exactly u*dragSum(n) - the solver aims at (led target - u*dragSum) instead.
export const dragSum=(n,drag=ARROW_DRAG)=>drag===1?n:(1-Math.pow(drag,n))/(1-drag);
const flightDiff=(from,aim,d,yaw,pitch,speed,gravity,drag,maxTicks)=>{
 // Signed height error where the trajectory crosses the aim's vertical plane (-Inf: never).
 const path=arrowTrajectory(from,yaw,pitch,{speed,gravity,drag,ticks:maxTicks});
 let prevH=0,prevY=from.y;
 for(const p of path){
  const h=Math.hypot(p.x-from.x,p.z-from.z);
  if(h>=d){
   const f=h===prevH?0:(d-prevH)/(h-prevH);
   return prevY+(p.y-prevY)*f-aim.y;
  }
  prevH=h;prevY=p.y;
 }
 return -Infinity;
};
const crossingTicks=(from,yaw,pitch,d,speed,gravity,drag,maxTicks)=>{
 const path=arrowTrajectory(from,yaw,pitch,{speed,gravity,drag,ticks:maxTicks});
 let prevH=0;
 for(const p of path){
  const h=Math.hypot(p.x-from.x,p.z-from.z);
  if(h>=d)return p.t;
  prevH=h;
 }
 return maxTicks;
};
// Low-arc pitch (fewest ticks) whose trajectory crosses the aim plane at the aim height.
function solvePitch(from,aim,d,yaw,speed,gravity,drag,maxTicks){
 const N=60,p0=-1.5,step=3.0/N;
 let sols=null,prev=p0,prevD=flightDiff(from,aim,d,yaw,prev,speed,gravity,drag,maxTicks);
 for(let i=1;i<=N;i++){
  const p=p0+i*step,dv=flightDiff(from,aim,d,yaw,p,speed,gravity,drag,maxTicks);
  if(isFinite(prevD)&&isFinite(dv)&&((prevD<0&&dv>=0)||(prevD>0&&dv<=0))){
   let lo=prev,hi=p,dlo=prevD;
   for(let k=0;k<28;k++){
    const mid=(lo+hi)/2,dm=flightDiff(from,aim,d,yaw,mid,speed,gravity,drag,maxTicks);
    if((dlo<0)===(dm<0)){lo=mid;dlo=dm;}else hi=mid;
   }
   const pitch=(lo+hi)/2;
   sols=sols||[];
   sols.push({pitch,ticks:crossingTicks(from,yaw,pitch,d,speed,gravity,drag,maxTicks)});
  }
  prev=p;prevD=dv;
 }
 if(!sols)return null;
 sols.sort((a,b)=>a.ticks-b.ticks);
 return sols[0];
}
// bowAimSolution(bot,target,{speed,gravity,drag,maxTicks,launchHeight,inherit}) -> {yaw,pitch,ticks}|null.
// Leads the target by its velocity over the flight time (mineflayer velocity = blocks/tick)
// and iterates aim <-> flight time until stable. mineflayer look convention (heading.js):
// x = -sin(yaw)*cos(pitch), y = sin(pitch) (positive pitch looks UP), z = -cos(yaw)*cos(pitch).
export function bowAimSolution(bot,target,opts={}){
 const me=bot&&bot.entity;
 if(!me||!me.position||!target||!target.position)return null;
 const speed=opts.speed??ARROW_SPEED,gravity=opts.gravity??ARROW_GRAVITY,drag=opts.drag??ARROW_DRAG;
 const maxTicks=opts.maxTicks??100;
 const from={x:me.position.x,y:me.position.y+(opts.launchHeight??ARROW_LAUNCH_HEIGHT),z:me.position.z};
 const tp=target.position,tv=target.velocity||{};
 const N=n=>typeof n==='number'&&isFinite(n)?n:0;
 // Vanilla adds the shooter's motion to the arrow (y only while airborne).
 const mv=opts.inherit===false?{}:me.velocity||{};
 const u={x:N(mv.x),y:me.onGround===false?N(mv.y):0,z:N(mv.z)};
 const shift=n=>{const k=dragSum(n,drag);return {x:u.x*k,y:u.y*k,z:u.z*k};};
 const midY=()=>tp.y+(target.height?target.height/2:0.9);
 let aim={x:tp.x,y:midY(),z:tp.z};
 let out=null;
 for(let i=0;i<6;i++){
  const dx=aim.x-from.x,dz=aim.z-from.z,d=Math.hypot(dx,dz);
  const yaw=yawToward(dx,dz);
  const sol=d<0.8?{pitch:pitchToward(aim.y-from.y,Math.max(d,0.5)),ticks:1}
   :solvePitch(from,aim,d,yaw,speed,gravity,drag,maxTicks);
  if(!sol)return null; // out of range: no pitch crosses the aim plane in maxTicks
  out={yaw,pitch:sol.pitch,ticks:sol.ticks};
  const sh=shift(sol.ticks);
  const next={x:tp.x+N(tv.x)*sol.ticks-sh.x,y:midY()+N(tv.y)*sol.ticks-sh.y,z:tp.z+N(tv.z)*sol.ticks-sh.z};
  if(Math.abs(next.x-aim.x)<0.05&&Math.abs(next.y-aim.y)<0.05&&Math.abs(next.z-aim.z)<0.05)break;
  aim=next;
 }
 return out;
}

// ---- 7b.9 target priority -----------------------------------------------------------------
export const RANGED_PRIORITY=new Set(['skeleton','stray','bogged','witch']);
// Eye-line raycast, sampled like the ported LookHelper.seesUser (mobDefenseChain): with no
// block data the target counts as visible.
export function hasLineOfSight(bot,target){
 const me=bot&&bot.entity;
 if(!me||!me.position||!target||!target.position)return false;
 try{
  const mine={x:me.position.x,y:me.position.y+1.6,z:me.position.z};
  const eyes={x:target.position.x,y:target.position.y+(target.height?target.height*0.9:1.5),z:target.position.z};
  const steps=Math.max(1,Math.ceil(dist(eyes,mine)*2));
  for(let i=1;i<steps;i++){
   const t=i/steps;
   const b=blockAt(bot,{x:mine.x+(eyes.x-mine.x)*t,y:mine.y+(eyes.y-mine.y)*t,z:mine.z+(eyes.z-mine.z)*t});
   if(b&&b.boundingBox==='block')return false;
  }
 }catch{}
 return true;
}
// creeper close > skeleton/witch with line of sight > nearest melee (7b.9).
export function pickTarget(hostiles,bot,opts={}){
 const me=bot&&bot.entity;
 if(!me||!me.position)return null;
 const maxRange=opts.maxRange??16;
 const inRange=(hostiles||[])
  .filter(e=>e&&e.position&&e.isValid!==false)
  .map(e=>[dist(e.position,me.position),e])
  .filter(([d])=>d<=maxRange)
  .sort((a,b)=>a[0]-b[0])
  .map(([,e])=>e);
 const visible=opts.visible?opts.visible:e=>hasLineOfSight(bot,e);
 const creeper=inRange.find(e=>e.name==='creeper'&&dist(e.position,me.position)<=(opts.creeperRange??6)&&visible(e));
 if(creeper)return creeper;
 const ranged=inRange.find(e=>RANGED_PRIORITY.has(e.name)&&visible(e));
 if(ranged)return ranged;
 return inRange.find(visible)||null;
}

// ---- 7c per-mob tactics --------------------------------------------------------------------
// gear: {weapon:'sword'|'axe'|'pickaxe'|null, weaponName, shield, bow, arrows}.
// opts: {groupSize, cornered, provoked, size ('small'|...), holding (target's held item)}.
// Returns {style:'melee'|'bow'|'avoid'|'ignore'|'last_resort', crit, sweep, shield, knockback,
// backpedal, zigzag, roof, rush, minRange, reason}.
export function pickTactic(mobName,gear,opts={}){
 const g={weapon:null,weaponName:null,shield:false,bow:false,arrows:0,...(gear||{})};
 const bowOk=g.bow&&g.arrows>0;
 const group=opts.groupSize??1;
 const unarmed=()=>{
  if(opts.cornered)return {style:'last_resort',crit:false,sweep:false,shield:g.shield,knockback:false,backpedal:false,
   reason:'cornered: best item, never a block or food (7f)'};
  return {style:'avoid',reason:'never fight unarmed (7f)'};
 };
 if(g.weapon==='pickaxe'&&!opts.cornered&&!bowOk)return {style:'avoid',reason:'pickaxe only when cornered (7f)'};
 const M=(extra,reason)=>({style:'melee',crit:true,sweep:false,shield:g.shield,knockback:false,backpedal:false,
  zigzag:false,roof:false,rush:false,minRange:0,...extra,reason});
 const B=(minRange,reason)=>({style:'bow',crit:false,sweep:false,shield:false,minRange,reason});
 const A=reason=>({style:'avoid',reason});
 switch(mobName){
  case 'creeper':
   // Wiki: fuse starts at 3 / 1.5 s and cancels past 7 or LOS
   // (https://minecraft.wiki/w/Creeper). Melee hit-and-run detonated 4/4 in the
   // roofed 12x12 (LOS never breaks; #3915 drops knockback). AltoClef's defence
   // is RunAwayFromCreepersTask, not a standing melee. Bow from 8 never enters
   // the ring. Melee hit-run is only the no-arrow fallback.
   if(bowOk)return B(6,'bow from 6+: shoot while it closes, flee only inside the fuse start');
   if(!g.weapon)return unarmed();
   return M({crit:false,knockback:true,backpedal:true,minRange:4,hitRun:true,shield:g.shield},
    'hit-and-run only without arrows; keep past 7');
  case 'zombie':case 'husk':case 'zombie_villager':
   if(!g.weapon)return unarmed();
   return M({knockback:true,backpedal:true,sweep:g.weapon==='sword'&&group>1},
    group>1?'sweep the group':'crits + knockback, back-pedal between hits');
  case 'drowned':
   if(opts.holding==='trident'){
    if(bowOk)return B(6,'ranged trident: duel with the bow');
    if(!g.weapon)return unarmed();
    return M({crit:true,shield:true},'shield up, close on the trident');
   }
   if(!g.weapon)return unarmed();
   return M({crit:true},'fight from land with crits');
  case 'skeleton':case 'stray':case 'bogged':
   // Melee-first on 26.3: the bow's ballistic constants cannot be calibrated here (entity
   // velocity arrives as 0 through ViaVersion, so aim lead and drop are unverifiable and
   // measured duels missed every shot), while shield+zigzag closing ends in reliable
   // hold-ground swings. The bow stays the fallback for a no-melee-weapon kit.
   if(!g.weapon&&bowOk)return B(6,'bow duel: no melee weapon ('+mobName+' arrows debuff)');
   if(!g.weapon)return unarmed();
   return M({crit:true,zigzag:true,shield:true},'shield up, zig-zag through the arrows');
  case 'witch':
   // NEVER melee-rush a witch (review directive; measured on 26.3: it kites, its potions
   // out-damage any rush, knockback does not apply and crits add nothing). Avoid and let
   // the chain break line of sight; the bow is not a fix here either (uncalibrated).
   return A('avoid: the witch kites and out-potions the rush - break line of sight (7c/26.3)');
  case 'spider':case 'cave_spider':
   if(!g.weapon)return unarmed();
   return M({crit:true},mobName==='cave_spider'?'kill fast: cave spider poison':'crit the leaping spider');
  case 'enderman':
   if(!opts.provoked)return A('never provoked, never look at its head');
   if(!g.weapon)return unarmed();
   return M({crit:true,roof:true,shield:true},'under a 2-high roof: hit its legs');
  case 'slime':case 'magma_cube':
   if(opts.size==='small')return {style:'ignore',reason:'small slime is harmless'};
   if(!g.weapon)return unarmed();
   return M({sweep:g.weapon==='sword',crit:g.weapon!=='sword'},'sweep attacks');
  case 'phantom':
   if(bowOk)return B(4,'shoot the swooping phantom');
   if(!g.weapon)return unarmed();
   return M({crit:true,shield:true},'shield up, strike when it swoops');
  case 'pillager':
   if(bowOk)return B(6,'out-range the crossbow');
   if(!g.weapon)return unarmed();
   return M({crit:true,shield:true,zigzag:true},'shield against bolts, close in');
  case 'vindicator':
   if(!g.weapon)return unarmed();
   return M({crit:true,knockback:true,backpedal:true},'shield up, knock it back');
  case 'silverfish':
   if(!g.weapon)return unarmed();
   return M({sweep:g.weapon==='sword',crit:g.weapon!=='sword'},'sweep it on solid ground');
  default:
   if(!g.weapon)return unarmed();
   return M({crit:true},'default melee crits');
 }
}

// ---- 7b.8 health discipline (the driver decides; these are the gates) ---------------------
export const shouldDisengage=bot=>typeof (bot&&bot.health)==='number'&&bot.health<=12;
export const shouldRetreat=bot=>typeof (bot&&bot.health)==='number'&&bot.health<=8;

// ---- gear reading ---------------------------------------------------------------------------
const FOODISH=new Set(['apple','bread','cooked_beef','beef','cooked_porkchop','porkchop','cooked_chicken','chicken',
 'cooked_mutton','mutton','carrot','potato','baked_potato','golden_apple','sweet_berries','melon_slice','pumpkin_pie',
 'cookie','rotten_flesh','spider_eye']);
export const holdsBlockOrFood=bot=>{
 const name=bot&&bot.heldItem&&bot.heldItem.name;
 if(!name)return false;
 if(FOODISH.has(name))return true;
 try{return !!(bot.registry&&bot.registry.blocksByName&&bot.registry.blocksByName[name]);}catch{return false;}
};
const weaponRank=n=>{
 const m=WEAPON_RE.exec(n||'');
 if(!m)return -1;
 // 7f weapon preference: sword > axe > pickaxe, then tier (a wooden sword beats a diamond pickaxe).
 return (m[2]==='sword'?200:m[2]==='axe'?100:0)+TIER_RANK[m[1]];
};
export function readGear(bot){
 const items=(bot&&bot.inventory&&bot.inventory.items())||[];
 const slots=(bot&&bot.inventory&&bot.inventory.slots)||[];
 const count=n=>items.filter(i=>i.name===n).reduce((s,i)=>s+(i.count||1),0);
 const best=items.filter(i=>/_(sword|axe|pickaxe)$/.test(i.name)).sort((a,b)=>weaponRank(b.name)-weaponRank(a.name))[0]||null;
 const m=best?WEAPON_RE.exec(best.name):null;
 // Off-hand shield: slot 45 or the equipment map; a shield anywhere is counted optimistically
 // (7a keeps one permanently in the off hand while fighting) - a failed raise is harmless.
 const offhand=slots[45]&&slots[45].name==='shield'||(bot.entity&&bot.entity.equipment&&bot.entity.equipment['off-hand']&&bot.entity.equipment['off-hand'].name==='shield');
 return {
  weapon:m?m[2]:null,tier:m?m[1]:null,weaponName:best?best.name:null,weaponItem:best,
  shield:!!offhand||items.some(i=>i.name==='shield'),
  bow:items.some(i=>i.name==='bow'),arrows:count('arrow')
 };
}
const entityHeld=e=>{try{const h=e.heldItem;return h&&h.name||null;}catch{return null;}};

// ---- the orchestrator -------------------------------------------------------------------------
// Driven by the fight job / MobDefenseChain. tick() is synchronous and never awaits
// (docs/TASK_API.md); async mineflayer calls are fire-and-forget and verified on later ticks.
export class CombatController{
 constructor(bot,move,opts={}){
  this.bot=bot;this.move=move;
  // range 2.85: 26.3 gates attacks by the entity_interaction_range attribute (measured
  // base 3.0) - swings launched at 3.0-3.2 are rejected server-side (live whiff source).
  // critJumps false - SERVER-MEASURED (2026-10-12, 26.3): a hop-crit duel killed in 5 hits
  // / 11.5 s with damage_dealt 200; plain full-charge swings killed in 5 hits / 5.2 s with
  // 199. Jump-crits gain NO damage here and double the exposure. The machinery stays and is
  // unit-tested; opt in with opts.critJumps if a future server honours vanilla crits.
  // range 2.9: the strike must beat melee mobs' own ~3.0 reach BEFORE their knockback
  // throws the bot back out (measured: an unarmoured baseline duel landed 2 swings and
  // ate 26 hp holding at 2.6 - the mob hit from outside our swing circle every cycle).
  // ABLATION (review directive): every combat primitive is a measured toggle, default OFF.
  // The simplest behaviour that wins on this 26.3 server is plain full-charge swings from a
  // held position - each primitive only earns its way back by measurably lowering damage or
  // time-to-kill in the arena ablation (tests/combat_ablation.py):
  //   backpedal       - back off during the swing cooldown (7b.3 spacing)
  //   shield          - raise/lower the off-hand shield (measured: blocks nothing here)
  //   sprintKnockback - sprint-hit knockback + sprint reset (measured: knockback never applies)
  //   kite            - the bow duel (measured: ballistics uncalibratable, arrows mostly miss)
  //   crit            - jump-crit strikes (measured: no damage bonus on 26.3)
  // ABLATION RESULT (2026-10-13, data/combat-ablation.json, 2 runs/cell, arena):
  //   backpedal ON  - skeleton ttk 5.1->4.1 s, creeper kills 1/2->2/2 at 7.1 s (2.1 dmg);
  //                   neutral for the zombie. The only primitive that earned its default.
  //   shield OFF    - hurt everywhere (zombie ttk 6.1->52.7 s: the raise/lower churn
  //                   interrupts swings and blocks nothing on this path).
  //   sprintKnockback OFF - hurt (zombie 14.1 s, creeper 4.4 dmg: knockback never applies).
  //   kite OFF      - no gain (skeleton equal; creeper kills 1/2 - arrows still miss).
  //   crit OFF      - no gain (26.3: jump-crits add no damage).
  this.primitives={backpedal:true,shield:false,sprintKnockback:false,kite:false,crit:false,...(opts.primitives||{})};
  this.opts={range:2.9,backOff:4,approachSprint:6,critHeadroom:2,critJumps:false,
   drawSeconds:FULL_DRAW_SECONDS,shotGap:0.3,bowMin:6,bowMax:24,
   healthDisengage:12,healthRetreat:8,recoverHealth:14,sprintFood:6,
   projectileMiss:1.6,projectileHorizon:3,creeperFuse:3.0,
   groupReach:3.5,pillarTrigger:8,pillarStepTrigger:12,pillarStepGap:4.5,pillarHeight:3,pillarClear:0.1,pillarSeconds:4,pillarDescend:8,pillarDescendSeconds:1,perchReach:3.0,knockBand:1.6,knockReach:3.4,...opts};
  // Wall clock. 73186 released a bow at 0.27 s because bot.time.age/20 jumped
  // (Via/26.x tick skip). Tests inject opts.now; never read age for draw/cooldown.
  this.now=opts.now||(()=>Date.now()/1000);
  this.log=opts.log||(()=>{});
  this.onEvent=opts.onEvent||null;
  this.target=null;this.tactic=null;this.state='idle';this.gear=null;
  this.events=[];
  this.stats={hits:0,crits:0,sweeps:0,shots:0,hitsTaken:0,damageTaken:0,disengages:0};
  this._lastStrike=-1e9;this._lastEquip=-1e9;this._lastHealth=null;this._lastState=null;
  this._shield=false;this._drawing=false;this._drawStart=0;this._nextShot=0;this._resetAt=0;
  this._jumpPulse=false;this._disengaged=false;this._lastEmit=new Map();this._stateLogAt={};
  this._creeperBackUntil=0; // hit-and-run: reopen the gap past 4 after every strike
  this._creeperLastD=null;  // bow: refuse a stand-still draw while it is closing
  this._leadPos=null;this._leadT=null; // ViaVersion zeros entity.velocity; reconstruct from samples
  this._losAt=-1e9;this._losCell=null;this._losCells=null;this._losTried=null;
  this._pillar=null;this._pillarFailUntil=0; // creeper pillar-up state (_pillarTick)
  // Bow shots: released? landed? (src/arrowShots.js). Events when the bot has them; the
  // tick polls the inventory count and the target's health metadata either way.
  this.stats.released=0;this.stats.landed=0;
  this._shots=new ArrowShots(opts.arrowShots);this._shotHooks=null;
  if(bot&&typeof bot.on==='function'){
   const h={
    spawn:e=>this._shotEvents(this._shots.onSpawn(e,this.now())),
    hurt:(e,src)=>this._shotEvents(this._shots.onHurt(e,src,this.now())),
    gone:e=>this._shotEvents(this._shots.onGone(e,this.now())),
    raw:p=>{if(p&&p.objectData)this._shots.noteOwner(p.entityId,p.objectData);}
   };
   try{bot.on('entitySpawn',h.spawn);bot.on('entityHurt',h.hurt);bot.on('entityGone',h.gone);
    if(bot._client&&typeof bot._client.on==='function')bot._client.on('spawn_entity',h.raw);}catch{}
   this._shotHooks=h;
  }
 }
 _unhookShots(){
  const h=this._shotHooks,bot=this.bot;
  if(!h||!bot||typeof bot.removeListener!=='function')return;
  this._shotHooks=null;
  try{bot.removeListener('entitySpawn',h.spawn);bot.removeListener('entityHurt',h.hurt);bot.removeListener('entityGone',h.gone);
   if(bot._client&&bot._client.removeListener)bot._client.removeListener('spawn_entity',h.raw);}catch{}
 }
 _shotEvents(list){
  for(const ev of list||[]){
   const s=ev.shot,tag='arrow '+(s.targetName||'')+' @'+(Math.round((this.now()-s.t)*100)/100)+'s: ';
   if(ev.type==='released')this.stats.released++;
   if(ev.type==='landed'){this.stats.landed++;this.stats.hits++;}
   this.log('Combat: '+tag+ev.type+' ('+ev.detail+')');
   this._emit('arrow-'+ev.type,ev.detail);
  }
 }
 setTarget(e){
  // The attack charge belongs to the player, not the target: a switch keeps _lastStrike.
  // Resetting it let a zombie trio (nearest flipping every few ticks) draw uncharged swings.
  if(e!==this.target){this._drawing=false;this._setState(null);this._creeperLastD=null;this._leadPos=null;this._leadT=null;this._losAt=-1e9;this._losCell=null;this._losCells=null;this._losTried=null;}
  this.target=e;
 }
 // mineflayer velocity is blocks/tick. ViaVersion on 26.3 reports 0, so the bow
 // solver cannot lead (73189: full 1 s draws at d=16–12, arrows 32→25, hits=0).
 // Fall back to the last sampled displacement when the packet velocity is zero.
 _viaVelocity(t,now){
  const p=t.position,pv=t.velocity;
  if(pv&&(pv.x||pv.z)){
   this._leadPos={x:p.x,y:p.y,z:p.z};this._leadT=now;
   return {x:pv.x,y:pv.y||0,z:pv.z};
  }
  const last=this._leadPos,lastT=this._leadT;
  this._leadPos={x:p.x,y:p.y,z:p.z};this._leadT=now;
  if(!last||lastT==null)return {x:0,y:0,z:0};
  const dt=now-lastT;
  if(dt<0.05||dt>1.5)return {x:0,y:0,z:0};
  return {x:(p.x-last.x)/dt/20,y:(p.y-last.y)/dt/20,z:(p.z-last.z)/dt/20};
 }
 // The movement helpers are ownership-guarded by the runner (docs/TASK_API.md): the
 // controller never touches controlToken/epoch itself - the FightTask runs only while its
 // chain owns control, so these calls are no-ops otherwise.
 _controls(states){
  if(this.move&&this.move.setControls)this.move.setControls(states);
 }
 _look(yaw,pitch,force){
  if(this.move&&this.move.look)this.move.look(yaw,pitch,!!force);
 }
 _emit(type,detail){
  const now=this.now(),last=this._lastEmit.get(type)||-1e9;
  if(now-last<2)return; // never spam the driver
  this._lastEmit.set(type,now);
  this.events.push({type,detail,t:now});
  if(this.events.length>50)this.events.shift();
  if(this.onEvent)try{this.onEvent(type,detail);}catch{}
 }
 _setState(s){
  if(s!==this._lastState){
   this._lastState=s;this.state=s||'idle';
   // Rate-limit per state: the strike/spacing flapping flooded the 100-entry event buffer
   // and flushed the fight's own result line out of it.
   const t=this.now();
   if(s&&t-(this._stateLogAt[s]||-9)>=2){
    this._stateLogAt[s]=t;
    this.log('Combat: '+s+(this.target?' '+this.target.name:''));
   }
  }
 }
 _raiseShield(){
  if(!this.primitives.shield)return; // ablated: the shield never blocks on this path
  this._raiseShieldNow();
 }
 // Creeper fuse: raise even when the melee shield primitive is off. Ablation was
 // "raise/lower churn interrupts swings" (zombie ttk 6→53); a swell at 1.4 is not a swing.
 _raiseShieldNow(){
  if(this._shield||!(this.gear&&this.gear.shield))return;
  this._shield=true;
  try{const p=this.bot.activateItem(true);p&&p.catch&&p.catch(()=>{});}catch{}
 }
 _lowerShield(){
  if(!this._shield)return;
  this._shield=false;
  try{const p=this.bot.deactivateItem();p&&p.catch&&p.catch(()=>{});}catch{}
 }
 _trackDamage(){
  const h=this.bot.health;
  if(typeof this._lastHealth==='number'&&h<this._lastHealth){
   this.stats.hitsTaken++;
   this.stats.damageTaken+=this._lastHealth-h;
   this._emit('damage','health '+Math.round(h)+' (-'+Math.round(this._lastHealth-h)+')');
  }
  this._lastHealth=h;
  if(this._disengaged&&h>=this.opts.recoverHealth){this._disengaged=false;this._emit('reengage','health '+Math.round(h));}
 }
 _groupSize(t){
  let n=0;
  for(const e of Object.values(this.bot.entities||{})){
   if(!e||e===this.bot.entity||e.isValid===false||e.type!=='hostile'||!e.position)continue;
   if(dist(e.position,t.position)<=4)n++;
  }
  return Math.max(1,n);
 }
 _faceTarget(t){
  const me=this.bot.entity.position;
  this._look(yawToward(t.position.x-me.x,t.position.z-me.z),0);
 }
 _hasFood(bot){
  try{
   return (bot.inventory.items()||[]).some(i=>{
    const f=bot.registry&&bot.registry.foodsByName&&bot.registry.foodsByName[i.name];
    return !!f&&f.foodPoints>0&&!f.negative;
   });
  }catch{return false;}
 }
 _findItem(bot,name){
  try{return (bot.inventory.items()||[]).find(i=>i.name===name)||null;}catch{return null;}
 }
 _losItem(){
  const bot=this.bot;
  return this._findItem(bot,'cobblestone')||this._findItem(bot,'dirt')||this._findItem(bot,'oak_planks');
 }
 _placeOn(support,item){
  const bot=this.bot,face=new Vec3(0,1,0);
  const go=()=>{try{const q=bot.placeBlock(support,face);q&&q.catch&&q.catch(()=>{});}catch{}};
  try{
   const p=bot.equip(item,'hand');
   if(p&&p.then)p.then(go).catch(()=>{});else go();
  }catch{go();}
 }
 _losSolid(x,y,z){
  try{
   const b=this.bot.blockAt(new Vec3(x,y,z));
   return !!(b&&b.boundingBox==='block');
  }catch{return false;}
 }
 // 73192: a 1-high wall does not break creeper LOS (eyes at +1.62). Hold the
 // cobble until the wall is up; re-equipping the bow aborted the first place.
 _losHold(){
  if(!this._losCells||!this._losCells.length)return false;
  if(this._losCells.every(c=>this._losSolid(c.x,c.y,c.z)&&this._losSolid(c.x,c.y+1,c.z)))return false;
  return this.now()-this._losAt<2.5;
 }
 // 73193: pillar was up at 1498,-60,1508 in 0.36 s, then equip-bow + kite walked
 // around it (d 7.6→2.5) and the creeper detonated for 17.1. Stay behind cover.
 // A 1-WIDE pillar does not stop it either (73194: it pathed around in ~2 s and
 // detonated at 2.8 for 17.1) - cover means ANY complete column still between us.
 _losCovered(t){
  if(!this._losCells||!this._losCells.length)return false;
  const up=c=>this._losSolid(c.x,c.y,c.z)&&this._losSolid(c.x,c.y+1,c.z);
  if(!this._losCells.some(up))return false;
  if(!t||!t.position||!this.bot.entity||!this.bot.entity.position)return true;
  const me=this.bot.entity.position;
  const vx=t.position.x-me.x,vz=t.position.z-me.z,vd=Math.hypot(vx,vz)||1;
  for(const c of this._losCells){
   if(!up(c))continue;
   const wx=c.x+0.5-me.x,wz=c.z+0.5-me.z;
   const den=vd*Math.hypot(wx,wz)||1;
   if((vx*wx+vz*wz)/den>0.2)return true;
  }
  this._losCells=null;this._losCell=null;this._losTried=null;
  return false;
 }
 _losActive(t){return this._losHold()||this._losCovered(t);}
 // Drop a 3-WIDE 2-high cobble/dirt/plank wall across the creeper's heading (Cursor
 // Round 6 next hypothesis: a 1-wide 2-high column is pathed around in ~2 s and the
 // blast still lands at 2.5-2.8 for 17.1). Center column on the heading ray (step 2
 // first: a 1-step cell along -x/-z overlaps the 0.6 hitbox at integer /tp coords,
 // Round 3 0.30001), flanks one block each side ACROSS the heading.
 _placeColumn(bot,c,item){
  // Equip, place the feet block of one wall column, and chain the head block as soon as
  // the feet lands (the server confirms via the block cache).
  const support=bot.blockAt(new Vec3(c.x,c.y-1,c.z));
  if(!support||support.boundingBox!=='block')return false;
  this._losAt=this.now();
  this.log('Combat: los-break column '+c.x+','+c.y+','+c.z);
  const face=new Vec3(0,1,0);
  const go=()=>{
   try{
    const q=bot.placeBlock(support,face);
    if(q&&q.then)q.then(()=>{
     const feet=bot.blockAt(new Vec3(c.x,c.y,c.z));
     if(!feet||feet.boundingBox!=='block')return;
     if(this._losSolid(c.x,c.y+1,c.z))return;
     try{const q2=bot.placeBlock(feet,face);q2&&q2.catch&&q2.catch(()=>{});}catch{}
    }).catch(()=>{});
   }catch{}
  };
  try{
   const p=bot.equip(item,'hand');
   if(p&&p.then)p.then(go).catch(()=>{});else go();
  }catch{go();}
  return true;
 }
 _losBreak(t){
  if(!t)return false;
  const bot=this.bot;
  if(!bot||!bot.blockAt)return false;
  const item=this._losItem();
  if(!item)return false;
  // The pillar replaces the wall wherever it can go up: no blocks or time spent on a wall
  // the creeper flanks anyway (a wall already started is finished).
  if(!this._losCells&&this._pillarSpot())return false;
  const up=c=>this._losSolid(c.x,c.y,c.z)&&this._losSolid(c.x,c.y+1,c.z);
  if(this._losCells){
   const open=this._losCells.find(c=>!up(c));
   if(!open){this._losCell=null;return false;} // wall complete: covered takes over
   const c=this._losCell=open;
   if(!this._losSolid(c.x,c.y,c.z)){
    const key=c.x+','+c.y+','+c.z;
    if(this._losTried&&this._losTried.has(key)){
     if(this.now()-this._losAt<0.8)return true; // give the click time before re-picking
     this._losTried=null;this._losCells=null;this._losCell=null;
     return false; // the column never landed (own cell etc.): re-pick the wall
    }
    (this._losTried||(this._losTried=new Set())).add(key);
    this._placeColumn(bot,c,item);
    return true;
   }
   // Feet solid: stack the head (0.15 s cadence; _placeColumn refreshes _losAt).
   if(this.now()-this._losAt<0.15)return true;
   this._placeColumn(bot,c,item);
   return true;
  }else if(this.now()-this._losAt<0.8)return false;
  const me=bot.entity.position;
  const dx=t.position.x-me.x,dz=t.position.z-me.z,len=Math.hypot(dx,dz)||1;
  const ux=dx/len,uz=dz/len,y=Math.floor(me.y);
  let below=null,x,z;
  for(const step of[2,3,1]){
   x=Math.floor(me.x+ux*step);z=Math.floor(me.z+uz*step);
   if(hitsBot(me,x,y,z))continue;
   if(Math.hypot(x+0.5-me.x,z+0.5-me.z)<1.4)continue; // 73195 own-cell place at 1496,1512
   if(this._losSolid(x,y,z))continue;
   const sup=bot.blockAt(new Vec3(x,y-1,z));
   if(!sup||sup.boundingBox!=='block')continue;
   below=sup;break;
  }
  if(!below)return false;
  // The flanks: one cell each side perpendicular to the heading, when the ground
  // allows. Fewer blocks in the inventory simply build a narrower wall.
  const px=Math.round(-uz),pz=Math.round(ux);
  const cells=[{x,y,z}];
  for(const s of[1,-1]){
   const sx=x+px*s,sz=z+pz*s;
   if(hitsBot(me,sx,y,sz))continue;
   if(this._losSolid(sx,y,sz))continue;
   const sup=bot.blockAt(new Vec3(sx,y-1,sz));
   if(!sup||sup.boundingBox!=='block')continue;
   cells.push({x:sx,y,z:sz});
  }
  this._losAt=this.now();
  this._losCells=cells;
  this._losCell={x,y,z};
  this._losTried=new Set([x+','+y+','+z]);
  this.log('Combat: los-break creeper wall at '+cells.map(c=>c.x+','+c.z).join(' | '));
  this._placeColumn(bot,cells[0],item);
  return true;
 }
 // ---- creeper pillar-up (cloud session 2026-10-14) ----------------------------------------
 // The human answer to a creeper: creepers cannot climb, and the fuse only STARTS inside 3
 // blocks (wiki), so 3 blocks up on a 1x1 column a creeper at the base stays outside the
 // ring (feet-to-feet sqrt(0.5^2+3^2) > 3), and the column under the bot absorbs a blast
 // that was already running. Walls were flanked in ~2 s for ~16 damage on both arena
 // variants (GLM 2026-10-14) and arrows miss on this ViaVersion path. Climb = hold jump,
 // look down, place on the block under the feet at the jump apex; perch = wait out the
 // fuse, attack from above only while it stays; descend = step off (a 3-block drop is 0
 // damage) or dig our own column when every side is a longer drop. The wall stays the
 // fallback (fewer than 2 blocks, no headroom, not on the ground, or a climb that failed).
 _pillarBlocks(){
  const items=(this.bot.inventory&&this.bot.inventory.items())||[];
  for(const re of PILLAR_BLOCKS){
   const list=items.filter(i=>re.test(i.name));
   const count=list.reduce((s,i)=>s+(i.count||1),0);
   if(count>=2)return {item:list[0],count};
  }
  return null;
 }
 // Where a column could go up right now (null: no blocks, no headroom, not standing).
 _pillarSpot(){
  const bot=this.bot,e=bot.entity;
  if(this.now()<(this._pillarFailUntil||0))return null;
  if(!e.onGround||e.isInWater||e.isInLava)return null;
  const blocks=this._pillarBlocks();
  if(!blocks)return null;
  const x=Math.floor(e.position.x),y=Math.floor(e.position.y),z=Math.floor(e.position.z);
  const height=this._pillarFits(x,y,z,Math.min(this.opts.pillarHeight,blocks.count));
  return height>=2?{x,y,z,height,item:blocks.item.name}:null;
 }
 // Pillar height (0..max) a standing cell allows: solid support under the feet, and the
 // cells up to y+h+1 free (head at the jump apex).
 _pillarFits(x,y,z,max){
  const sup=blockAt(this.bot,{x,y:y-1,z});
  if(!sup||sup.boundingBox!=='block')return 0;
  let height=0;
  for(let h=1;h<=max;h++){
   if(!passable(this.bot,{x,y:y+h+1,z}))break;
   height=h;
  }
  return height;
 }
 // Round 2 roofed arena (17.1 damage): the bow draw backpedalled into the arena's 2-high
 // corner pocket, where no pillar fits, and the wall won. A cell 1-2 blocks off where one
 // fits is a step away: walk there first. The creeper must stay pillarStepGap+ away from
 // the new cell (the fuse ring is 3), and the way there must be open and floored.
 _pillarStepCell(t){
  const bot=this.bot,e=bot.entity;
  if(this.now()<(this._pillarFailUntil||0)||this.now()<(this._pillarStepFailUntil||0))return null;
  if(!e.onGround||e.isInWater||e.isInLava)return null;
  const blocks=this._pillarBlocks();
  if(!blocks)return null;
  const max=Math.min(this.opts.pillarHeight,blocks.count);
  const fx=Math.floor(e.position.x),y=Math.floor(e.position.y),fz=Math.floor(e.position.z);
  const open=c=>{const b=blockAt(bot,c);return !b||(b.boundingBox!=='block'&&!/^(lava|water|fire)$/.test(b.name));};
  const floored=c=>{const b=blockAt(bot,{x:c.x,y:c.y-1,z:c.z});return !!b&&b.boundingBox==='block';};
  let best=null;
  for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++){
   if(!dx&&!dz)continue;
   const x=fx+dx,z=fz+dz;
   if(this._pillarFits(x,y,z,max)<2)continue;
   const gap=Math.hypot(t.position.x-(x+0.5),t.position.z-(z+0.5));
   if(gap<this.opts.pillarStepGap)continue;
   let clear=true;
   for(const f of [0.25,0.5,0.75,1]){
    const c={x:Math.floor(e.position.x+(x+0.5-e.position.x)*f),y,z:Math.floor(e.position.z+(z+0.5-e.position.z)*f)};
    if(!open(c)||!open({x:c.x,y:y+1,z:c.z})||!floored(c)){clear=false;break;}
   }
   if(!clear)continue;
   const walk=Math.hypot(x+0.5-e.position.x,z+0.5-e.position.z);
   const score=walk-0.1*gap;
   if(!best||score<best.score)best={x,y,z,score};
  }
  return best;
 }
 // The bow backpedal must not leave a cell where a pillar fits for one where none does.
 _backKeepsPillar(yaw){
  const blocks=this._pillarBlocks();
  if(!blocks)return true;
  const e=this.bot.entity,max=Math.min(this.opts.pillarHeight,blocks.count),y=Math.floor(e.position.y);
  if(this._pillarFits(Math.floor(e.position.x),y,Math.floor(e.position.z),max)<2)return true;
  const {x:dx,z:dz}=headingOf(yaw);
  for(const off of [0.8,1.6])if(this._pillarFits(Math.floor(e.position.x+dx*off),y,Math.floor(e.position.z+dz*off),max)<2)return false;
  return true;
 }
 _pillarStart(t,d,now){
  const trigger=d<=this.opts.pillarTrigger||creeperSwell(t).fusing;
  const spot=this._pillarSpot();
  if(!spot){
   // No pillar fits here (a low ceiling): step out from under it inside the wall's range,
   // so the pillar, not the wall, answers the creeper.
   if(!trigger&&d>=this.opts.pillarStepTrigger)return false;
   const cell=this._pillarStepCell(t);
   if(!cell)return false;
   this._pillar={phase:'step',x:cell.x,z:cell.z,base:cell.y,started:now};
   this._lowerShield();this._cancelDraw();
   this.log('Combat: pillar step to '+cell.x+','+cell.y+','+cell.z+' (no headroom here; creeper at '+d.toFixed(1)+')');
   return true;
  }
  if(!trigger)return false;
  const {x,y,z,height}=spot;
  this._pillar={phase:'climb',x,z,base:y,height,item:spot.item,started:now,clickAt:-1e9,clickY:null,farSince:null,landing:null};
  this._lowerShield();this._cancelDraw();
  this.log('Combat: pillar-up '+height+' at '+x+','+y+','+z+' (creeper at '+d.toFixed(1)+')');
  return true;
 }
 _pillarTop(p){ // solid cells stacked on the base: 0..height
  let n=0;
  while(n<p.height&&this._losSolid(p.x,p.base+n,p.z))n++;
  return n;
 }
 _pillarTick(t,gear,now){
  const bot=this.bot,e=bot.entity,o=this.opts;
  const d=dist(t.position,e.position);
  if(!this._pillar&&!this._pillarStart(t,d,now))return false;
  const p=this._pillar;
  const off=Math.floor(e.position.x)!==p.x||Math.floor(e.position.z)!==p.z;
  if(p.phase==='step'){
   if(!off&&e.onGround){
    // In the cell: climb now when the creeper is in range, else the bow shoots from here.
    this._pillar=null;this._controls({forward:false,sprint:false});
    return this._pillarSpot()?this._pillarStart(t,d,now):false;
   }
   if(now-p.started>1.5){
    this.log('Combat: pillar step failed (did not reach '+p.x+','+p.base+','+p.z+')');
    this._pillar=null;this._pillarStepFailUntil=now+5;
    this._controls({forward:false,sprint:false});
    return false;
   }
   this._setState('pillar-step');
   if(off){
    this._snapYaw(yawToward(p.x+0.5-e.position.x,p.z+0.5-e.position.z));
    this._controls({forward:true,back:false,left:false,right:false,sprint:false,jump:false});
   }else this._controls({forward:false,sprint:false});
   return true;
  }
  if(p.phase==='climb'){
   const top=this._pillarTop(p);
   if(top>=p.height&&e.position.y>=p.base+p.height-0.01){
    p.phase='perch';p.perchAt=now;
    this._controls({jump:false});
    this.log('Combat: pillar perched '+p.height+' up');
   }else if(off||now-p.started>o.pillarSeconds){
    // Knocked off the column or the clicks never landed: the wall/flee logic takes over.
    this.log('Combat: pillar-up failed ('+(off?'left the column':'timed out')+') at '+top+'/'+p.height);
    this._pillar=null;this._pillarFailUntil=now+10;
    this._controls({jump:false});
    return false;
   }else{
    this._setState('pillar-climb');
    this._controls({forward:false,back:false,left:false,right:false,sprint:false,jump:true});
    this._look(e.yaw||0,-Math.PI/2,true);
    if(!bot.heldItem||bot.heldItem.name!==p.item){
     if(now-this._lastEquip>=0.5){this._lastEquip=now;
      const item=this._findItem(bot,p.item);
      if(item)try{const q=bot.equip(item,'hand');q&&q.catch&&q.catch(()=>{});}catch{}}
     return true;
    }
    // Place into the next cell once the feet clear it (apex ~1.25 above the stand).
    const next=p.base+top;
    const again=p.clickY!==next||now-p.clickAt>=0.5;
    if(e.position.y>=next+1+o.pillarClear&&again){
     const ref=blockAt(bot,{x:p.x,y:next-1,z:p.z});
     if(ref&&ref.boundingBox==='block'){
      p.clickAt=now;p.clickY=next;
      try{const q=bot.placeBlock(ref,new Vec3(0,1,0));q&&q.catch&&q.catch(()=>{});}catch{}
     }
    }
    return true;
   }
  }
  if(p.phase==='perch'){
   if(off||e.position.y<p.base+p.height-0.5){this._pillar=null;return false;} // knocked off: fall back
   this._controls({forward:false,back:false,left:false,right:false,sprint:false,jump:false});
   const fusing=creeperSwell(t).fusing;
   const flat=Math.hypot(t.position.x-e.position.x,t.position.z-e.position.z);
   if(fusing){this._setState('pillar-hold');this._cancelDraw();this._raiseShieldNow();return true;}
   this._lowerShield();
   if(flat>o.pillarDescend){
    // Wandered off: come down once it has stayed past the line for a moment.
    if(p.farSince==null)p.farSince=now;
    if(now-p.farSince>=o.pillarDescendSeconds){p.phase='descend';p.descendAt=now;p.landing=this._pillarLanding(p,t);}
    this._setState('pillar-perch');this._cancelDraw();
    return true;
   }
   p.farSince=null;
   // Round 5 lane (4_creeper): under the lane roof the column was 2 high, and 2 up the base
   // is still inside the 3-block fuse ring (flat sqrt(9-h^2) = 2.24; the fuse starts at 3
   // feet-to-feet). The creeper walked to the base and fused, this hold waited for the blast:
   // shots=0, and the lane midpoint glowstone cratered. A short column fights the approach
   // with knockback instead: the melee weapon is in hand once the creeper is within knockBand
   // of the ring (hysteresis: back to the bow past ring+knockBand+1.5), and each swing it can
   // reach pushes it back out before the fuse can start. knockReach 3.4 eye-to-box is inside
   // the server's interaction check (3 + 3 buffer since 1.20.5). At 3 up the ring is 0.
   const ring=Math.sqrt(Math.max(0,9-p.height*p.height));
   if(ring>0&&gear.weaponName&&flat<=ring+o.knockBand+(p.knock?1.5:0)){
    if(!p.knock)this.log('Combat: perch '+p.height+' up is inside the fuse ring; knocking the creeper back (at '+flat.toFixed(1)+')');
    p.knock=true;this._cancelDraw();this._perchStrike(t,gear,now,o.knockReach);
    return true;
   }
   p.knock=false;
   // It stays: attack from above (bow first - a sitting target under the column).
   if(gear.bow&&gear.arrows>0)this._perchShoot(t,now);
   else this._perchStrike(t,gear,now);
   return true;
  }
  // descend
  if(now-p.descendAt>o.pillarSeconds*2){this._pillar=null;this._controls({forward:false,jump:false});return false;}
  if(e.position.y<=(p.landing?p.landing.y:p.base)+0.01&&e.onGround){
   this._pillar=null;this._controls({forward:false,sprint:false,jump:false});
   this.log('Combat: pillar descended');
   return false;
  }
  this._setState('pillar-descend');
  this._cancelDraw();
  if(p.landing){ // keep walking: the box still rests on the column 0.3 past its edge
   const yaw=yawToward(p.landing.x+0.5-e.position.x,p.landing.z+0.5-e.position.z);
   this._snapYaw(yaw);
   this._controls({forward:true,back:false,left:false,right:false,sprint:false,jump:false});
  }else{
   // Every side is a longer drop: dig our own column one block at a time.
   this._controls({forward:false,back:false,left:false,right:false,sprint:false,jump:false});
   const under=blockAt(bot,{x:p.x,y:Math.floor(e.position.y)-1,z:p.z});
   if(under&&under.boundingBox==='block'&&Math.floor(e.position.y)-1>=p.base&&now-p.clickAt>=1&&bot.dig){
    p.clickAt=now;
    try{const q=bot.dig(under,true);q&&q.catch&&q.catch(()=>{});}catch{}
   }
  }
  return true;
 }
 // Step-off cell: a cardinal neighbour of the column whose floor is at most 3 below the
 // perch (0 fall damage), open for the body, never into fluid; away from the creeper first.
 _pillarLanding(p,t){
  const bot=this.bot,top=p.base+p.height;
  const away=t&&t.position?{x:p.x+0.5-t.position.x,z:p.z+0.5-t.position.z}:{x:0,z:0};
  const cells=[[1,0],[-1,0],[0,1],[0,-1]].sort((a,b)=>(b[0]*away.x+b[1]*away.z)-(a[0]*away.x+a[1]*away.z));
  for(const [dx,dz] of cells){
   const x=p.x+dx,z=p.z+dz;
   if(!passable(bot,{x,y:top,z})||!passable(bot,{x,y:top+1,z}))continue;
   for(let y=top-1;y>=top-4;y--){ // floor at top-4 = a 3-block drop
    const b=blockAt(bot,{x,y,z});
    if(!b)break; // unloaded: unknown drop
    if(b.name==='lava'||b.name==='water'||b.name==='fire'||b.name==='powder_snow')break;
    if(b.boundingBox==='block')return {x,y:y+1,z};
   }
  }
  return null;
 }
 _perchShoot(t,now){
  const bot=this.bot;
  if(!bot.heldItem||bot.heldItem.name!=='bow'){
   this._setState('pillar-equip-bow');this._cancelDraw();
   if(now-this._lastEquip>=0.5){this._lastEquip=now;
    const item=this._findItem(bot,'bow');
    if(item)try{const q=bot.equip(item,'hand');q&&q.catch&&q.catch(()=>{});}catch{}}
   return;
  }
  const sol=bowAimSolution(bot,{...t,velocity:this._viaVelocity(t,now)},this.opts.aim);
  if(sol)this._look(sol.yaw,sol.pitch,true);
  if(now<this._nextShot){this._setState('pillar-perch');return;}
  if(!this._drawing){
   this._drawing=true;this._drawStart=now;
   try{const q=bot.activateItem(false);q&&q.catch&&q.catch(()=>{});}catch{}
   this._setState('pillar-draw');
  }else if(now-this._drawStart>=this.opts.drawSeconds){
   this._drawing=false;
   try{const q=bot.deactivateItem();q&&q.catch&&q.catch(()=>{});}catch{}
   this.stats.shots++;this._nextShot=now+this.opts.shotGap;
   this._setState('pillar-shoot');
   this._released(t);
  }
 }
 _perchStrike(t,gear,now,maxReach=this.opts.perchReach){
  const bot=this.bot,e=bot.entity;
  if(!gear.weaponName){this._setState('pillar-perch');return;}
  if(!bot.heldItem||bot.heldItem.name!==gear.weaponName){
   this._setState('pillar-equip');
   if(now-this._lastEquip>=0.5){this._lastEquip=now;
    try{const q=bot.equip(gear.weaponItem||{name:gear.weaponName},'hand');q&&q.catch&&q.catch(()=>{});}catch{}}
   return;
  }
  // Reach is eye to the nearest point of the creeper's box (0.6 x 1.7), not feet to feet.
  const eye={x:e.position.x,y:e.position.y+1.62,z:e.position.z},tp=t.position;
  const near={x:Math.max(tp.x-0.3,Math.min(eye.x,tp.x+0.3)),y:Math.max(tp.y,Math.min(eye.y,tp.y+(t.height||1.7))),z:Math.max(tp.z-0.3,Math.min(eye.z,tp.z+0.3))};
  const reach=dist(eye,near);
  const ready=now-this._lastStrike>=cooldownSeconds(gear.weaponName,bot.registry);
  if(reach>maxReach||!ready){this._setState('pillar-perch');return;}
  const dx=near.x-eye.x,dz=near.z-eye.z;
  this._look(yawToward(dx,dz),pitchToward(near.y-eye.y,Math.hypot(dx,dz)),true);
  try{const q=bot.attack(t);q&&q.catch&&q.catch(()=>{});}catch{}
  this._lastStrike=now;this.stats.hits++;
  this._setState('pillar-strike');
 }
 tick(){
  const bot=this.bot;
  if(!bot||!bot.entity||typeof bot.health!=='number')return this;
  const now=this.now();
  this._trackDamage();
  this._shotEvents(this._shots.poll(bot,now));
  if(this._jumpPulse){this._controls({jump:false});this._jumpPulse=false;}
  const t=this.target;
  if(!t||t.isValid===false||!t.position){
   this._setState('idle');this._lowerShield();this._cancelDraw();
   this._controls({forward:false,back:false,sprint:false});
   return this;
  }
  const gear=this.gear=readGear(bot);
  // style=melee/bow/plain from the fight job: force the style where the mob table allows
  // both. 'plain' is the Phase 3 baseline leg: full-charge swings, no crit hops, no sweeps.
  // Rebind the LOCAL too - _meleeTick/_bowTick receive it, not this.tactic.
  let tactic=this.tactic=pickTactic(t.name,gear,{
   groupSize:this._groupSize(t),provoked:this.opts.provoked,holding:entityHeld(t),cornered:this.opts.cornered});
  if(this.opts.forceStyle==='melee'&&tactic.style==='bow')tactic=this.tactic={...tactic,style:'melee',reason:'style=melee: '+tactic.reason};
  else if(this.opts.forceStyle==='bow'&&tactic.style==='melee'&&gear.bow&&gear.arrows>0)
   tactic=this.tactic={style:'bow',crit:false,sweep:false,shield:false,minRange:6,reason:'style=bow'};
  else if(this.opts.forceStyle==='plain'&&(tactic.crit||tactic.sweep))
   tactic=this.tactic={...tactic,crit:false,sweep:false,reason:'style=plain: '+tactic.reason};
  // Hunting a passive animal: the bare hand is a legal tool (7f hunts) - never while
  // holding a block or food. The FightTask unequips through the same gated equip path.
  // Round 68 (round-67 Nitrous-copy soak, hard run: `Combat: avoid sheep` twice, `Fight timed out;
  // sheep is still standing` and `cow is still standing` three times, then `starved to death` at
  // 862,94,-430 - a pickaxe the only tool, and 7f's `pickaxe only when cornered` applied to the
  // sheep too): the pickaxe rule is about hostiles; a passive animal is fought with what is held.
  if(this.tactic.style==='avoid'&&(tactic.reason==='never fight unarmed (7f)'||tactic.reason==='pickaxe only when cornered (7f)')&&t.type!=='hostile'&&this.opts.allowHand){
   if(holdsBlockOrFood(bot)){
    this._setState('unequip');
    this._lowerShield();
    if(now-this._lastEquip>=0.5){this._lastEquip=now;
     try{const p=bot.unequip('hand');p&&p.catch&&p.catch(()=>{});}catch{}}
    return this;
   }
   this.tactic={style:'melee',crit:true,sweep:false,shield:false,knockback:false,backpedal:false,minRange:0,
    reason:'hunt: hand strikes on a passive animal (7f)'};
  }
  if(this.tactic.style==='avoid'||this.tactic.style==='ignore'){
   this._setState(tactic.style);
   this._lowerShield();this._cancelDraw();
   this._controls({forward:false,back:false,sprint:false});
   this._emit(tactic.style,tactic.reason);
   return this;
  }
  // 7f: verify the weapon is really in hand before any swing. While disengaged or
  // retreating the hand belongs to the driver's eat - no re-equip race with bot.consume.
  // In bow mode (the mob's tactic OR the creeper hybrid) the hand belongs to the bow
  // (_bowTick equips it): re-equipping the sword here ping-pongs the slots forever and no
  // arrow ever flies (measured: an eternal equip-bow loop while the creeper walked in).
  // Creeper pillar-up outranks the weapon check (it holds the blocks), the health gates
  // (the column is the safest place to be) and the wall below (its fallback).
  if(t.name!=='creeper'&&this._pillar){this._pillar=null;this._controls({jump:false});}
  if(t.name==='creeper'&&this._pillarTick(t,gear,now))return this;
  const bowMode=tactic.style==='bow'||(t.name==='creeper'&&gear.bow&&gear.arrows>0);
  // Round 63: prey that cannot hit back (the worker's spareRetreat: a pig, cow, chicken... with no
  // hostile near) is no reason to back off - a starving bot at health 6 must still kill it.
  const spare=!!(this.opts.spareRetreat&&this.opts.spareRetreat(t));
  if(gear.weaponName&&!bowMode&&(bot.heldItem&&bot.heldItem.name)!==gear.weaponName&&!this._disengaged&&(bot.health>this.opts.healthRetreat||spare)){
   this._setState('equip');
   this._lowerShield();
   if(now-this._lastEquip>=0.5){ // re-equip at most every 0.5 s until heldItem verifies
    this._lastEquip=now;
    try{const p=bot.equip(gear.weaponItem||{name:gear.weaponName},'hand');p&&p.catch&&p.catch(()=>{});}catch{}
   }
   return this;
  }
  // 7b.8 health discipline: cover up and back off; the driver eats/retreats.
  if(bot.health<=this.opts.healthRetreat&&!spare){
   this._setState('retreat');this._raiseShield();this._faceTarget(t);this._backOff(t,tactic);
   this._emit('critical','health '+Math.round(bot.health)+' <= '+this.opts.healthRetreat);
   return this;
  }
  if(bot.health<=this.opts.healthDisengage&&!this._disengaged){
   // 7b.8: disengage and eat - but only with food to eat. With an empty stomach the only
   // move that survives a group is fighting on (backpedalling into mobs just loses).
   if(this._hasFood(bot)){
    this._disengaged=true;this.stats.disengages++;
    this._emit('disengage','health '+Math.round(bot.health)+': shield up and eat (7b.8)');
   }else this._emit('nofood','health '+Math.round(bot.health)+' with nothing to eat: fighting on');
  }
  if(this._disengaged){
   this._setState('disengage');this._raiseShield();this._faceTarget(t);this._backOff(t,tactic);
   return this;
  }
  // Creeper + arrows: bow from 8 even when kite is ablated for other mobs. Melee
  // detonated 4/4 in the roofed arena (LOS never breaks). This must run BEFORE the
  // style==='bow' && !kite abort or pickTactic(bow) would stand still and eat the blast.
  if(t.name==='creeper'&&gear.bow&&gear.arrows>0&&this.opts.forceStyle!=='melee'){
   const bowTactic={style:'bow',crit:false,sweep:false,shield:false,minRange:6,
    reason:'creeper: shoot from 6+ (73184 drew at 9.5 then kited at 8 and ate 17.5)'};
   this.tactic=bowTactic;
   const d0=dist(t.position,bot.entity.position);
   this.log('Combat: creeper-bow d='+d0.toFixed(1)+' held='+(bot.heldItem&&bot.heldItem.name||'none')+' arrows='+gear.arrows);
   this._bowTick(t,bowTactic,gear,now);
   return this;
  }
  if(tactic.style==='bow'){
   // Ablated by default (ballistics uncalibratable): a bow-only kit becomes an avoid - the
   // FightTask benches it and the chain breaks line of sight instead of whiffing arrows.
   if(!this.primitives.kite){
    this.tactic={style:'avoid',reason:'kite ablated on 26.3: no reliable ranged option'};
    this._setState('avoid');this._lowerShield();this._cancelDraw();
    this._controls({forward:false,back:false,sprint:false});
    this._emit('avoid',this.tactic.reason);
    return this;
   }
   if(!gear.arrows){this._meleeTick(t,tactic,gear,now);return this;}
   this._bowTick(t,tactic,gear,now);
   return this;
  }
  // Enderman roof tactic (7c, review directive: REALLY step under it): walk into the
  // nearest 2-high pocket (solid ceiling 2 above the feet) and swing at its legs from
  // inside - it cannot teleport into 2-high space and cannot swing its body in.
  if(tactic.roof)return this._roofTick(t,tactic,now);
  // Creeper: MELEE hit-and-run (ablation-measured best: the +backpedal cell killed 2/2
  // in 7.1 s at 2.1 dmg; the kite hybrid killed 1/2 and one detonation cost 16.8 when
  // arrows missed). The fuse-ring strike + sprint-out in _meleeTick is the defence.
  // style:'bow' explicitly still kites (min range 8 so the draw finishes before it closes).
  if(t.name==='creeper'&&this.opts.forceStyle==='bow'&&gear.bow&&gear.arrows>0){
   const bowTactic={style:'bow',crit:false,sweep:false,shield:false,minRange:6,reason:'creeper: shoot from 6+ (style=bow)'};
   this._bowTick(t,bowTactic,gear,now);
   return this;
  }
  this._meleeTick(t,tactic,gear,now);
  return this;
 }
 _backOff(t,tactic){
  this._faceTarget(t);
  const want=dist(t.position,this.bot.entity.position)<Math.max(this.opts.backOff,tactic.minRange||0);
  this._controls({back:want,forward:false,sprint:false});
 }
 _approach(t,tactic,now,d){
  this._faceTarget(t);
  const hold=now<this._resetAt; // sprint reset: one quiet beat after a knockback hit
  // rush: keep the sprint on through the close (the potion clock does not wait for polite spacing)
  const closeSprint=tactic.rush&&d>2.2;
  const states={forward:!hold,sprint:!hold&&(closeSprint||d>this.opts.approachSprint)&&(this.bot.food??20)>this.opts.sprintFood};
  if(tactic.zigzag){
   const side=((now*2)|0)%2?'left':'right'; // strafe-flip every 0.5 s
   states[side]=true;states[side==='left'?'right':'left']=false;
  }
  this._controls(states);
 }
 _fuseFlee(t,d){
  if(!t||t.name!=='creeper')return false;
  const info=creeperSwell(t);
  if(!info.fusing)return false;
  this._cancelDraw();
  this._setState('guard');
  this._raiseShieldNow();
  const placing=this._losBreak(t)||this._losActive(t);
  // 73190: face+walk-back from 1496,1518 hit the west wall in 1 block; the creeper
  // closed 7.5→1.4 and detonated. Fuse cancel is 7 blocks OR LOS (wiki). Sprint
  // the longest heading that INCREASES the gap (lane +z), not look-relative back.
  // 73192: stand still while the 2-high pillar is going up; bow re-equip aborted it.
  // 73194 (best): stand behind the pillar, survive at 3.9 / 17.1 dmg. 73195 awayTick
  // after a failed own-cell place walked 7.8→0.5 and died.
  if(placing)this._controls({forward:false,back:false,sprint:false,left:false,right:false});
  else if(d>info.keep)this._controls({forward:false,back:false,sprint:false});
  else this._awayTick(t,info.keep);
  this._emit('guard','creeper swell '+info.swell+(info.powered?' powered':'')+' at '+d.toFixed(1)+' - sprinting past '+info.keep);
  return true;
 }
 // Wall-aware retreat: face away from the target along the heading with the most open
 // ground (probed at 0.8-step intervals out to 7.2 blocks, feet and head). The first
 // 1.6-passable slant used to walk into a 12-wide arena wall and detonate; the gate
 // into the shooting lane is ~8+ blocks of air and now wins. Wiki fuse cancels past 7
 // or LOS (https://minecraft.wiki/w/Creeper); mineflayer still drops 1.21.11 knockback
 // (PrismarineJS/mineflayer#3915), so distance is the only cancel.
 _openAlong(yaw){
  const me=this.bot.entity.position;
  const {x:dx,z:dz}=headingOf(yaw);
  // The body is 0.6 wide: probe both edges as well as the centre line (a centre-only ray
  // slipped past a wall corner whenever the bot stood on a block edge).
  let n=0;
  for(const off of [0.8,1.6,2.4,3.2,4.0,4.8,5.6,6.4,7.2]){
   let blocked=false;
   for(const side of [0,0.29,-0.29])for(const dy of [0,1]){
    const b=blockAt(this.bot,{x:me.x+dx*off-dz*side,y:me.y+dy,z:me.z+dz*off+dx*side});
    if(b&&b.boundingBox==='block'){blocked=true;break;}
   }
   if(blocked)break;
   n=off;
  }
  return n;
 }
 _bestAway(t){
  const me=this.bot.entity.position;
  const d0=dist(me,t.position);
  const base=yawToward(me.x-t.position.x,me.z-t.position.z);
  const score=yaw=>{
   const room=this._openAlong(yaw);
   const step=Math.min(room||0.8,3.2);
   const {x:dx,z:dz}=headingOf(yaw);
   const gap=Math.hypot(me.x+dx*step-t.position.x,me.z+dz*step-t.position.z);
   return {yaw,room,opens:gap-d0};
  };
  let best=score(base);
  for(const off of [0.4,-0.4,0.8,-0.8,1.2,-1.2,1.57,-1.57,2.0,-2.0,2.5,-2.5,3.14]){
   const s=score(base+off);
   // Never "flee" through the creeper toward a longer corridor (23:05: kite to the
   // arena gate walked 8→2.3 because +z was the longest open heading).
   if(s.opens>0.3&&s.room>best.room)best=s;
   else if(s.opens>0.3&&s.room===best.room&&s.opens>best.opens)best=s;
   else if(best.opens<=0.3&&s.opens>best.opens)best=s;
  }
  return best;
 }
 // Longest open runway from the feet. A creeper strike is refused below 7: the fuse
 // cannot be cancelled if every heading hits a wall first (12-wide arena, grove pits).
 _escapeRoom(t){return this._bestAway(t).room;}
 _snapYaw(yaw){
  try{this.bot.entity.yaw=yaw;this.bot.entity.pitch=0;}catch{}
  this._look(yaw,0,true);
 }
 // Cloud review 2026-10-14: every yaw here used to be z-mirrored (heading.js), which alone
 // turns "away" into "toward" for any creeper off the x axis - re-read the walk-in logs
 // below (73176-81, 22:59) with that in mind before trusting their conclusions.
 // Face the creeper and walk BACK. Forward+sprint is look-relative and walked
 // into the gate whenever yaw had not snapped (73176-81 deaths / 16-18 dmg).
 _creeperBack(t){
  const me=this.bot.entity.position;
  const yaw=yawToward(t.position.x-me.x,t.position.z-me.z);
  this._snapYaw(yaw);
  const back=this._backKeepsPillar(yaw+Math.PI);
  this._controls({forward:false,back,sprint:back&&(this.bot.food??20)>this.opts.sprintFood,left:false,right:false});
 }
 _awayTick(t,keep=4){
  const {yaw}=this._bestAway(t);
  this._snapYaw(yaw);
  this._controls({forward:true,back:false,sprint:(this.bot.food??20)>this.opts.sprintFood});
 }
 _meleeTick(t,tactic,gear,now){
  const bot=this.bot,e=bot.entity;
  const d=dist(t.position,e.position);
  this._faceTarget(t);
  if(this._fuseFlee(t,d))return;
  // Creeper hit-and-run (review directive): strike once inside reach, then REOPEN the gap
  // past 4 at an open angle before the next swing - the fuse starts at 3 and the swell
  // metadata arrives inside ~2.5, so the cooldown must never tick out inside the ring.
  // This branch OWNS every non-fusing creeper range (the old d<3 guard sat ABOVE the
  // 2.9 strike window, so the melee path never swung once - ablation rows all read hits=0).
  if(t.name==='creeper'&&tactic.hitRun){
   // Strike range is 2.9; minRange 4 is the AFTER-HIT reopen, not a hold that never
   // closes. The old `d<minRange -> away` branch bounced at 4 and never entered 2.9
   // (combat suite: hits=0, damage 16-17). Close to reach, hit once, then reopen past 4.
   const ready=now-this._lastStrike>=cooldownSeconds(gear.weaponName,bot.registry);
   const cooling=now<(this._creeperBackUntil||0);
   const inStrike=d<=this.opts.range;
   const room=this._escapeRoom(t);
   if(ready&&inStrike&&!cooling&&room>=7){
    this._lowerShield();
    // 1.5 s is the full fuse; 1.0 s left the bot inside 7 when the arena wall ate the
    // straight sprint (combat suite crater at 1496,-61,1504 after a "kill").
    this._creeperBackUntil=now+1.5;
    this._setState('strike');
    this._strike({act:'strike'});
    this._awayTick(t,7); // start the sprint-out on the same tick
    return;
   }
   // Never re-close until the gap is past 7. A wall bounce at ~4 used to walk back in
   // and detonate at the arena center (1500,-61,1500) on the next swing.
   if(cooling||d<7||!ready||room<7||(d<3.2&&!inStrike)){
    this._setState('spacing');
    this._awayTick(t,7); // wiki: fuse cancels past 7, not 4
    return;
   }
   if(!inStrike){
    this._setState('approach');
    this._approach(t,tactic,now,d);
    return;
   }
   this._setState('spacing');
   this._awayTick(t,7);
   return;
  }
  const threatened=projectileThreat(bot,Object.values(bot.entities||{}),
   {miss:this.opts.projectileMiss,horizon:this.opts.projectileHorizon}).length>0;
  const ready=now-this._lastStrike>=cooldownSeconds(gear.weaponName,bot.registry);
  // Groups (test2_zombie_triple: "Health below 8; retreated"): strike the nearest when the
  // charge is full and it is in reach; between swings, step so that only ONE mob stays in
  // reach instead of holding the cell while all three hit.
  const crowd=this._crowd(t);
  if(!threatened&&crowd.some(c=>c.d<=this.opts.groupReach)&&!(ready&&d<=this.opts.range)){
   this._raiseShield();
   this._setState('group-spacing');
   this._groupStep(t,crowd);
   return;
  }
  if(threatened){ // 7b.5: shield up while an arrow is incoming; do not swing through it
   this._setState('guard');this._raiseShield();
   this._controls({forward:false,sprint:false});
   return;
  }
  if(d>this.opts.range){
   if(tactic.shield||!ready)this._raiseShield();else this._lowerShield();
   this._setState('approach');
   this._approach(t,tactic,now,d);
   return;
  }
  const plan=this._meleePlan(t,tactic,gear,now,ready,d);
  if(plan.act==='wait'){
   this._raiseShield(); // 7b.5: raise while the cooldown recharges
   this._setState('spacing');
   // Back off only when the mob is INSIDE our swing circle - holding ground during the
   // cooldown keeps the duel in one cell; a full-length backpedal per hit migrates the
   // fight (measured: bot and zombie drifted 30+ blocks apart through the arena gate).
   if(this.primitives.backpedal&&tactic.backpedal&&(d<2.0||(tactic.minRange&&d<tactic.minRange)))this._backOff(t,tactic);
   else if(d>this.opts.range)this._approach(t,tactic,now,d);
   else this._controls({forward:false,sprint:false});
   return;
  }
  this._lowerShield(); // lower to strike
  if(plan.act==='jump'){ // 7b.2: start the crit hop; strike on the way down
   this._controls({jump:true});this._jumpPulse=true;
   this._setState('crit-jump');
   return;
  }
  this._strike(plan);
 }
 // Other live hostiles (not the target) within 6 of the bot, with their distances.
 _crowd(t){
  const me=this.bot.entity.position,out=[];
  for(const e of Object.values(this.bot.entities||{})){
   if(!e||e===t||e===this.bot.entity||e.isValid===false||e.type!=='hostile'||!e.position)continue;
   const d=dist(e.position,me);
   if(d<=6)out.push({e,d});
  }
  return out;
 }
 // One spacing step while the charge recharges: keep facing the target (the next swing),
 // move back/sideways along the open heading that puts the most room between the bot and
 // the nearest OTHER hostile, without stepping into the target or out of its reach band.
 // Controls are look-relative: back = heading(yaw+PI), left = +PI/2, right = -PI/2.
 _groupStep(t,crowd){
  const me=this.bot.entity.position;
  const face=yawToward(t.position.x-me.x,t.position.z-me.z);
  this._faceTarget(t);
  const sepAt=p=>Math.min(...crowd.map(c=>Math.hypot(c.e.position.x-p.x,c.e.position.z-p.z)));
  const now=sepAt(me);
  let best=null;
  for(const [ctl,rel] of GROUP_MOVES){
   const h=face+rel,room=this._openAlong(h);
   if(room<0.8)continue;
   const {x:dx,z:dz}=headingOf(h),step=Math.min(room,1.6);
   const p={x:me.x+dx*step,z:me.z+dz*step};
   const sep=sepAt(p),dt=Math.hypot(t.position.x-p.x,t.position.z-p.z);
   const score=sep-(dt<1.5?5:0)-Math.max(0,dt-this.opts.groupReach);
   if(!best||score>best.score)best={ctl,score,sep};
  }
  const stop={forward:false,back:false,left:false,right:false,sprint:false};
  if(!best||best.sep<=now+0.1){this._controls(stop);return null;} // cornered: hold and swing
  this._controls({...stop,...best.ctl});
  return best.ctl;
 }
 _meleePlan(t,tactic,gear,now,ready,d){
  const e=this.bot.entity;
  if(!ready)return {act:'wait'};
  if(tactic.style==='last_resort')return holdsBlockOrFood(this.bot)?{act:'wait'}:{act:'strike'};
  if(tactic.sweep&&e.onGround)return {act:'strike',sweep:true}; // 7b.4 groups
  if(tactic.crit&&(this.primitives.crit||this.opts.critJumps)){
   // Start the hop only when CLOSE: the fall-strike fires ~0.4 s later and a target at
   // the edge of reach walks out of range mid-hop - the swing whiffs (measured live:
   // 24 swings for one zombie when hopping at 3 blocks, 6 when hopping at <= 2.6).
   if(e.onGround)return d<=2.6&&hasHeadroom(this.bot,this.opts.critHeadroom)?{act:'jump'}:{act:'strike'};
   if(isCritOpportunity(this.bot))return {act:'strike',crit:true};
   return {act:'wait'}; // rising, or falling unqualified (sprint/water): hold
  }
  return {act:'strike'};
 }
 _strike(plan){
  const bot=this.bot;
  // Reach at STRIKE time, not plan time: the hop's falling window opens ~0.4 s after the
  // plan, and a moving target is often a block farther by then (live-measured whiff source).
  if(this.target&&this.target.position&&dist(this.target.position,bot.entity.position)>3.0){
   this._setState('spacing');
   this._controls({forward:true,sprint:false});
   return;
  }
  // 7b.3: land knockback hits while sprinting, then reset so the next hit re-applies it.
  // Ablated by default: knockback never applies on this path (measured).
  if(this.primitives.sprintKnockback&&this.tactic&&this.tactic.knockback&&dist(this.target.position,bot.entity.position)>2&&(bot.food??20)>this.opts.sprintFood){
   this._controls({sprint:true});
  }
  try{const p=bot.attack(this.target);p&&p.catch&&p.catch(()=>{});}catch{}
  this._lastStrike=this.now();
  this.stats.hits++;
  if(plan.crit)this.stats.crits++;
  if(plan.sweep)this.stats.sweeps++;
  if(this.primitives.sprintKnockback&&this.tactic&&this.tactic.knockback){
   this._controls({sprint:false,forward:false});
   this._resetAt=this.now()+0.2;
  }
  this._setState('strike');
 }
 // A full-draw release: the ArrowShots tracker decides released / landed / missed from
 // the inventory count, the arrow's spawn near the eye and the target's hurt or health.
 _released(t){
  this._shots.release(this.bot,t,this.now());
 }
 _underRoof(bot){
  const p=bot.entity.position;
  const solid=dy=>{const b=blockAt(bot,{x:Math.floor(p.x),y:Math.floor(p.y)+dy,z:Math.floor(p.z)});return !!b&&b.boundingBox==='block';};
  return solid(2)&&solid(3);
 }
 _findRoofSpot(bot){
  const p=bot.entity.position;
  const ok=(x,y,z)=>{
   // ONE solid block at feet+2 is the whole trick: the enderman's 2.9-tall teleport box
   // overlaps it, so it cannot blink into the column, and its body cannot walk in either.
   if(!passable(bot,{x,y,z})||!passable(bot,{x,y:y+1,z}))return false;
   const c=blockAt(bot,{x,y:y+2,z});
   return !!c&&c.boundingBox==='block';
  };
  for(let r=0;r<=12;r++)for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++){
   if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;
   for(const y of[Math.floor(p.y),Math.floor(p.y)-1,Math.floor(p.y)+1]){
    if(ok(Math.floor(p.x)+dx,y,Math.floor(p.z)+dz))return {x:Math.floor(p.x)+dx,y,z:Math.floor(p.z)+dz};
   }
  }
  return null;
 }
 _roofTick(t,tactic,now){
  const bot=this.bot;
  if(this._underRoof(bot)){
   // In the pocket: hold it, face the enderman, swing at the legs when it closes.
   this._faceTarget(t);
   const d=dist(t.position,bot.entity.position);
   this._controls({forward:false,sprint:false});
   if(d<=this.opts.range+1.5){
    const ready=now-this._lastStrike>=cooldownSeconds(this.gear.weaponName,bot.registry);
    if(ready&&!holdsBlockOrFood(bot)){
     this._setState('strike');
     this._strike({act:'strike'});
    }else this._setState('spacing');
   }else this._setState('roof');
   return this;
  }
  // Find the nearest 2-high pocket and walk into it.
  const me=bot.entity.position;
  if(!this._roofSpot||dist(this._roofSpot,me)<1.2||dist(this._roofSpot,me)>14)this._roofSpot=this._findRoofSpot(bot);
  if(!this._roofSpot)return this._meleeTick(t,tactic,this.gear,now); // no pocket: plain swings
  const spot=this._roofSpot;
  const dx=spot.x+0.5-me.x,dz=spot.z+0.5-me.z,far=Math.hypot(dx,dz);
  // Face the WALK direction: facing the enderman while walking forward just pushes into
  // it - measured 0/20 roof samples with the pocket 5 blocks behind the mob.
  this._look(yawToward(dx,dz),0);
  this._controls({forward:far>0.4,sprint:false});
  this._setState('roof-walk '+(far.toFixed(0)));
  if(far>3&&!this._roofNav&&this.move&&this.move.goals&&this.move.goals.xzGoal&&this.move.goto){
   const g=this.move.goals.xzGoal(spot.x,spot.z);
   if(g&&typeof g.isValid==='function')this._roofNav=this.move.goto(g,{seconds:3}).catch(()=>{}).then(()=>{this._roofNav=null;});
  }
  return this;
 }
 _cancelDraw(){
  if(!this._drawing)return;
  this._drawing=false;
  try{const p=this.bot.deactivateItem();p&&p.catch&&p.catch(()=>{});}catch{}
 }
 _bowTick(t,tactic,gear,now){
  const bot=this.bot;
  const d=dist(t.position,bot.entity.position);
  if(this._losActive(t)){
   this._cancelDraw();
   this._setState('los-break');
   if(this._losHold())this._losBreak(t);
   if(!this._losHold()&&d>=(tactic.minRange||8)&&!creeperSwell(t).fusing){
    // Wall is up and the creeper is circling: keep the blast away from us. 73194 stood
    // still and ate 17.1 at the flank corner; every step back adds blast falloff. This
    // is only safe WITH complete cover (73195 died walking with no wall).
    this._awayTick(t,tactic.minRange||8);
   }else this._controls({forward:false,back:false,sprint:false,left:false,right:false});
   return;
  }
  if(this._fuseFlee(t,d))return;
  // The draw (activateItem) fires whatever is in hand: verify the bow first, like the
  // melee path verifies its weapon (ViaVersion equips can silently fail).
  if(!bot.heldItem||bot.heldItem.name!=='bow'){
   this._setState('equip-bow');
   this._cancelDraw();this._lowerShield();
   if(now-this._lastEquip>=0.5){this._lastEquip=now;
    const item=this._findItem(bot,'bow');
    if(item)try{const p=bot.equip(item,'hand');p&&p.catch&&p.catch(()=>{});}catch{}}
   return;
  }
  const min=Math.max(this.opts.bowMin,tactic.minRange||0);
  if(t.name==='creeper'){
   const fusing=creeperSwell(t).fusing;
   // 73176-81: an opening kite used look-relative FORWARD. After /tp the yaw is
   // still +z (the gate), so "away" walked 1496,1497 → 1498,1501 into the fuse
   // and shots stayed 0. Face the creeper and BACKPEDAL (cannot walk into it),
   // and start the 1 s draw immediately at 8+ (wiki fuse starts at 3).
   if(this._drawing&&d>=4&&!fusing&&d>=8){ /* finish the shot */ }
   else if(d<12){
    // Wall trigger at 12 (GLM 2026-10-14): at 8 the ~1.2 s 3-column build raced the
    // creeper's close and the fuse ran first (lane variance: 0 dmg REPELLED vs 16.2
    // KILLED between two runs). From 12 the wall is up before the 3-block fuse ring.
    this._cancelDraw();
    if(this._losBreak(t)||this._losActive(t)){
     this._setState('los-break');
     this._controls({forward:false,back:false,sprint:false,left:false,right:false});
     return;
    }
    if(fusing||d<6){this._setState('kite');this._creeperBack(t);return;}
   }
  }
  if(d>this.opts.bowMax){
   this._setState('approach');
   this._cancelDraw();
   this._approach(t,tactic,now,d);
   return;
  }
  if(now>=this._nextShot){
   // Lead: prefer the packet velocity; when Via reports 0 (73189), use the heading
   // reconstructed from the last sample so a gate-pathing creeper is not aimed at
   // the spot it already left.
   const v=this._viaVelocity(t,now);
   const sol=this._lastAim=bowAimSolution(bot,{...t,velocity:v},this.opts.aim);
   if(!sol){
    if(t.name==='creeper'){
     // 73178-73180: !sol kited every tick (shots=0) until swell at 2.8. Flat look-at
     // still fires; missing is better than never shooting (wiki fuse starts at 3).
     const me=bot.entity.position;
     this._lastAim={yaw:yawToward(t.position.x-me.x,t.position.z-me.z),pitch:0,ticks:1};
    }else{
     this._cancelDraw();
     this._setState('approach');
     this._approach(t,tactic,now,d);
     return;
    }
   }
  }
  if(d<min&&!(t.name==='creeper'&&this._drawing&&d>=4)){
   // inside the bow's minimum range: kite away WITH the draw held - a moving
   // full-draw release beats an exploding creeper that closed under the line.
   this._setState('kite');
   if(t.name==='creeper'){
    // Measured 22:59: draw+forward while looking at the creeper walked 8 -> 1.9 in
    // 0.8 s (controls are look-relative). Inside 8: ONLY sprint away. Draw only at 8+.
    // A started draw is held through 10→6 (73179 aborted every shot at the 10 line).
    if(this._fuseFlee(t,d))return;
    this._cancelDraw();
    this._creeperBack(t);
    return;
   }
   this._raiseShield();
   this._faceTarget(t);
   this._controls({back:true,sprint:(bot.food??20)>this.opts.sprintFood});
   if(now<this._nextShot)return;
   this._look(this._lastAim.yaw,this._lastAim.pitch);
   if(!this._drawing){
    this._drawing=true;this._drawStart=now;
    try{const p=bot.activateItem(false);p&&p.catch&&p.catch(()=>{});}catch{}
    this._setState('draw');
   }else if(now-this._drawStart>=this.opts.drawSeconds){
    this._drawing=false;
    try{const p=bot.deactivateItem();p&&p.catch&&p.catch(()=>{});}catch{}
    this.stats.shots++;
    this._nextShot=now+this.opts.shotGap;
    this._setState('shoot');
    this._released(t);
   }
   return;
  }
  if(now<this._nextShot){
   // After a shot the creeper is still closing; do not keep leftover forward while
   // looking at it (look-relative controls walked 8→1.9 on 22:59).
   if(t.name==='creeper')this._creeperBack(t);
   return;
  }
  // Creeper: backpedal along the shot line when that heading is open (73190 stand-still
  // let it walk 16→7 in two shots). Forward+look is the walk-in. Force the aim look.
  if(t.name==='creeper'){
   const me=bot.entity.position;
   const face=yawToward(t.position.x-me.x,t.position.z-me.z);
   const room=this._openAlong(face+Math.PI);
   if(room>=2&&this._backKeepsPillar(face+Math.PI))this._controls({forward:false,back:true,sprint:(bot.food??20)>this.opts.sprintFood,left:false,right:false});
   else this._controls({forward:false,back:false,sprint:false,left:false,right:false});
  }else{
   this._controls({forward:false,back:false,sprint:false,left:false,right:false});
  }
  this._look(this._lastAim.yaw,this._lastAim.pitch,true);
  if(!this._drawing){
   this._lowerShield();
   this._drawing=true;this._drawStart=now;
   try{const p=bot.activateItem(false);p&&p.catch&&p.catch(()=>{});}catch{} // draw the bow
   this._setState('draw');
  }else if(now-this._drawStart>=this.opts.drawSeconds){
   this._drawing=false;
   try{const p=bot.deactivateItem();p&&p.catch&&p.catch(()=>{});}catch{} // full draw: release
   this.stats.shots++;
   this._nextShot=now+this.opts.shotGap;
   this._setState('shoot');
   this._released(t);
  }
 }
 stop(){
  this._lowerShield();
  this._cancelDraw();
  this._shotEvents(this._shots.poll(this.bot,this.now()));
  this._unhookShots();
  this._controls({forward:false,back:false,left:false,right:false,jump:false,sprint:false});
  this.target=null;
  this._setState(null);
  return this.stats;
 }
}
