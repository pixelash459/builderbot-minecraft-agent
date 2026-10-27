// Port of the fight/no-fight decision logic from adris/altoclef chains/MobDefenseChain.java
// (weapon detection, armor/damage math), adapted to docs/COMBAT_SPEC.md section 7f:
// never fight unarmed, health >= 14 (>= 10 armoured), at most 2 melee mobs, no creeper
// within 5 blocks without a bow, daylight (or armoured at night), hunt only the named
// animal and abort the hunt when a hostile comes within 8 blocks.
// Original AltoClef (https://github.com/gaucho-matrero/altoclef,
// commit af22e3bc2f03dde45da703f5f7535baae18ea486), MIT License,
// Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
import {provoked} from '../provoked.js';
import {dist} from './settings.js';
import {dayTicks} from '../daytime.js';
const WEAPON_RE=/^(wooden|golden|stone|iron|diamond|netherite)_(sword|axe|pickaxe)$/;
export const TIER_RANK={wooden:0,golden:0,stone:1,iron:2,diamond:3,netherite:4};
// Total attack damage of the weapon (AltoClef: 1 + material attack damage).
export const WEAPON_DAMAGE={wooden_sword:4,golden_sword:4,stone_sword:5,iron_sword:6,diamond_sword:7,netherite_sword:8,
 wooden_axe:7,golden_axe:7,stone_axe:9,iron_axe:9,diamond_axe:9,netherite_axe:10,
 wooden_pickaxe:2,golden_pickaxe:2,stone_pickaxe:3,iron_pickaxe:4,diamond_pickaxe:5,netherite_pickaxe:6};
// Full attack charge per 7b/7f: sword ~0.625s, axe ~1.0s (attack speed 1.6 / 1.0 / 1.2).
const ATTACK_SPEED={sword:1.0,axe:1,pickaxe:1.2}; // sword server-measured on 26.3 (see src/combat.js)
export const attackCooldown=item=>{
 const m=WEAPON_RE.exec(item||'');
 return m?1/(ATTACK_SPEED[m[2]]||1.2):0.5;
};
export const RANGED_MOBS=new Set(['skeleton','stray','bogged','witch','pillager']);
export const isMeleeMob=name=>!RANGED_MOBS.has(name);
// Undead that burn in sunlight (7f: daytime threats burn). Drowned do not burn.
export const BURNS_IN_SUNLIGHT=new Set(['zombie','husk','zombie_villager','skeleton','stray','bogged','phantom']);
export const ARMOR_POINTS={
 leather_helmet:1,leather_chestplate:3,leather_leggings:2,leather_boots:1,
 golden_helmet:2,golden_chestplate:5,golden_leggings:3,golden_boots:1,
 chainmail_helmet:2,chainmail_chestplate:5,chainmail_leggings:4,chainmail_boots:1,
 iron_helmet:2,iron_chestplate:6,iron_leggings:5,iron_boots:2,
 diamond_helmet:3,diamond_chestplate:8,diamond_leggings:6,diamond_boots:3,
 netherite_helmet:3,netherite_chestplate:8,netherite_leggings:6,netherite_boots:3};
export const withinRange=(e,bot,range)=>!!(e&&e.position&&bot.entity&&dist(e.position,bot.entity.position)<=range);
export const distanceTo=(e,bot)=>e&&e.position&&bot.entity?dist(e.position,bot.entity.position):Infinity;
// Round 10, habit 12: mobs a player leaves alone. An enderman is neutral until provoked (looked
// at or hit): left alone unless it is screaming (metadata 17, angry) or on top of the bot. A
// spider is neutral in bright light: left alone by day where the sky light at it is 12+ (a cave
// spider, or a spider in a cave or at night, is not), unless it is on top of the bot. Creepers
// (never melee - the flee branch) and witches (backed away from) keep their own rules.
export const LEAVE_ALONE_CLOSE=2;
export function leaveAlone(e,bot){
 if(!e||!e.position)return false;
 if(distanceTo(e,bot)<=LEAVE_ALONE_CLOSE)return false;
 if(e.name==='enderman'){const m=e.metadata||[];return !(m[17]===true||m[17]===1);}
 if(e.name==='spider'){
  const tod=dayTicks(bot);
  if(tod==null||tod>=12000)return false;
  let sky=null;
  try{const bl=bot.blockAt&&bot.blockAt(e.position.floored?e.position.floored():e.position);sky=bl&&typeof bl.skyLight==='number'?bl.skyLight:null;}catch{}
  return sky==null||sky>=12;
 }
 return false;
}
// Trackers (P4) are the preferred source; scanning bot.entities keeps chains working until they land.
export const getHostiles=(bot,ctx)=>{
 if(ctx&&ctx.trackers&&typeof ctx.trackers.getHostiles==='function'){
  try{return (ctx.trackers.getHostiles()||[]).filter(Boolean).filter(e=>!leaveAlone(e,bot));}catch{}
 }
 return Object.values((bot&&bot.entities)||{})
  .filter(e=>e&&e!==bot.entity&&(e.type==='hostile'||provoked(bot,e))&&e.position&&e.isValid!==false&&!leaveAlone(e,bot));
};
export const nearestDistance=(hostiles,bot)=>hostiles.reduce((m,e)=>Math.min(m,distanceTo(e,bot)),Infinity);
export const meleeCount=(hostiles,bot,range=8)=>hostiles.filter(e=>isMeleeMob(e.name)&&withinRange(e,bot,range)).length;
export const creeperWithin=(hostiles,bot,range)=>hostiles.some(e=>e.name==='creeper'&&withinRange(e,bot,range));
export const hasBow=(bot,items)=>{
 items=items||inventoryItems(bot);
 return items.some(i=>i.name==='bow')&&items.some(i=>i.name==='arrow');
};
export const inventoryItems=bot=>(bot&&bot.inventory&&bot.inventory.items())||[];
export const hasItemName=(bot,name)=>inventoryItems(bot).some(i=>i.name===name);
export const weaponScore=name=>{const m=WEAPON_RE.exec(name||'');return m?(TIER_RANK[m[1]]||0)*10+(m[2]==='sword'?1:0):-1;};
// Best real weapon (7f: sword or axe; a pickaxe only as a last resort when cornered).
export function bestWeapon(bot,{allowPickaxe=false}={}){
 const items=inventoryItems(bot).filter(i=>WEAPON_RE.test(i.name));
 const pick=want=>items.filter(i=>i.name.endsWith('_'+want)).sort((a,b)=>weaponScore(b.name)-weaponScore(a.name))[0]||null;
 return pick('sword')||pick('axe')||(allowPickaxe?pick('pickaxe'):null);
}
export function armorValue(bot){
 const slots=(bot&&bot.inventory&&bot.inventory.slots)||[];
 let sum=0;
 for(let i=5;i<=8;i++){const it=slots[i];if(it&&ARMOR_POINTS[it.name])sum+=ARMOR_POINTS[it.name];}
 return sum;
}
// Daylight per 7f (dusk prep at ~12000; the tail of the night just before sunrise counts as light).
export const isDaylight=bot=>{
 const t=dayTicks(bot);
 if(t==null)return true; // unknown clock: do not block a fight on it
 return t<12000||t>23950;
};
export const nightish=bot=>{
 const t=dayTicks(bot);
 return t!=null&&t>=11500&&t<23400;
};
// 7f gate, in the order the spec lists the conditions. Armoured means real armour pieces
// (>= 8 points, a full leather set); 7f allows health >= 10 when armoured.
export function evaluateFight(bot,hostiles){
 const weapon=bestWeapon(bot);
 const health=typeof bot.health==='number'?bot.health:20;
 const armor=armorValue(bot);
 const armoured=armor>=8;
 const melee=meleeCount(hostiles,bot);
 const creeperClose=creeperWithin(hostiles,bot,5);
 const bow=hasBow(bot,inventoryItems(bot));
 const daylight=isDaylight(bot);
 const checks=[
  ['weapon',!!weapon,'no real weapon (sword/axe)'],
  ['health',health>=14||(armoured&&health>=10),'health '+Math.round(health)+' below '+(armoured?10:14)],
  ['melee',melee<=2,melee+' melee mobs (max 2)'],
  ['creeper',!(creeperClose&&!bow),'creeper within 5 blocks without a bow'],
  ['daylight',daylight||armoured,'night in the open without armour']];
 const failed=checks.find(c=>!c[1]);
 return {allowed:!failed,reason:failed?failed[2]:'ok',weapon,health,armor,armoured,melee,creeperClose,bow,daylight};
}
// AltoClef MobDefenseChain: canDealWith = ceil(armor*3.6/20 + damage*0.8); caller adds 1.
export const canDealWithCount=policy=>{
 const damage=policy.weapon?(WEAPON_DAMAGE[policy.weapon.name]||1):0;
 return Math.ceil(policy.armor*3.6/20.0+damage*0.8);
};
// 7f cornered approximation: a hostile within melee range leaves no escape path worth more
// than fighting back with the best item (axe > pickaxe > fist; never a block).
export const isCornered=(hostiles,bot)=>nearestDistance(hostiles,bot)<=3.5;
// 7f hunting: abort the hunt and hand control to the threat policy when a hostile is within 8 blocks.
export const huntBlocked=(hostiles,bot)=>hostiles.some(e=>withinRange(e,bot,8));
// 7f ladder step 1: a wooden sword is craftable when the materials exist - 2 planks make
// the sticks, 2 planks + 1 stick make the sword (review directive: craft the sword the
// moment a hostile approaches and materials exist). The full self-contained path (sticks
// + a placed table) needs 6 planks; a log covers everything.
export const canCraftWoodenSword=bot=>{
 const items=inventoryItems(bot);
 const count=n=>items.filter(i=>n.test(i.name)).reduce((s,i)=>s+(i.count||1),0);
 const planks=count(/_planks$/),sticks=count(/^stick$/);
 if(count(/_log$/)>=1)return true;
 if(hasItemName(bot,'crafting_table'))return planks>=2;
 return planks>=6||(planks>=2&&sticks>=1);
};
