// Autopilot: deterministic survival progression built ONLY from verified job types queued
// through the normal worker queue, so Stop, reflexes and failure handling all keep working.
// The ladder is a pure function of a name->count inventory map so it can be unit tested.
import fs from 'node:fs';
import path from 'node:path';
import {Vec3} from 'vec3';
import {dayTicks} from './daytime.js';
import {shelterDue,nightJobFor,DUSK_PREP,SUNSET} from './night.js';
import {EDIBLE_SKIP} from './observe.js';
import {isExposed} from './digDown.js';

const BED=/(_bed)$/;
const WOOLS=['white_wool','light_gray_wool','gray_wool','black_wool','brown_wool','red_wool','orange_wool','yellow_wool','lime_wool','green_wool','cyan_wool','light_blue_wool','blue_wool','purple_wool','magenta_wool','pink_wool'];
const countFactory=count=>name=>count[name]||0;
// Meals eaten this session: the consume-tracked count or the FoodChain's own (round 9).
const mealsEaten=w=>{const m=w&&w.meals||{};return Math.max(m.eaten||0,m.ok||0);};
// COMBAT_SPEC 7a gear: one sword and one axe per tier, a full armour set, bow and arrows.
const GEAR=/^(diamond|iron|stone|golden|wooden)_(sword|axe|pickaxe|shovel|helmet|chestplate|leggings|boots)$/;
const WORN_LIMIT=0.2; // craft the replacement while a fifth of the durability is left
const REPLACE_COST={sword:2,axe:3,pickaxe:3,shovel:1,helmet:5,chestplate:8,leggings:7,boots:4};
const REPLACE_STICKS={sword:1,axe:2,pickaxe:3,shovel:1};
const REPLACE_ORDER={sword:0,axe:1,helmet:2,chestplate:3,leggings:4,boots:5,pickaxe:6,shovel:7};
// Payable replacement tiers per kind: stone and wood armour do not exist, so armour is only
// ever re-crafted in iron or diamond; leather and chainmail are never crafted by the ladder.
const REPLACE_TIERS={
 weapon:[['diamond','diamond'],['iron','iron_ingot'],['stone','cobblestone'],['wooden',null]],
 armour:[['diamond','diamond'],['iron','iron_ingot']]
};
const ARMOURED=new Set(['helmet','chestplate','leggings','boots']);
const COOKABLE_MEAT=['beef','porkchop','chicken','mutton'];
const ARROWS=32; // COMBAT_SPEC 7a: keep 32+ arrows when possible
const GRAZE=new Set(['plains','sunflower_plains','meadow','savanna','savanna_plateau','forest','flower_forest','birch_forest','old_growth_birch_forest','river','beach']);
const HARSH=new Set(['jagged_peaks','frozen_peaks','stony_peaks','snowy_slopes','grove','ice_spikes','windswept_hills','windswept_gravelly_hills','windswept_forest','snowy_plains','snowy_taiga','frozen_river','stony_shore']);
function biomeName(bot,x,y,z){
 try{
  const column=bot.world&&bot.world.getColumn&&bot.world.getColumn(x>>4,z>>4);
  const id=column&&column.getBiome&&column.getBiome({x:x&15,y:y,z:z&15});
  return id==null?null:(''+(bot.registry&&bot.registry.biomes&&bot.registry.biomes[id]&&bot.registry.biomes[id].name||'')).replace('minecraft:','');
 }catch{return null;}
}
// Pick a cardinal that has graze biome at MULTIPLE distances (GLM soak 6: probing only
// 16/48 walked the bot 200+ blocks into a taiga river valley - the near sample said
// "meadow" and the far terrain was animal-less). A direction scores +2 per graze sample,
// -1 per harsh sample; rivers/beaches only count when close (animals are not on water).
export function grazeDirection(bot){
 const me=bot&&bot.entity&&bot.entity.position;
 if(!me)return 'random';
 const y=Math.floor(me.y);
 let best='random',bestScore=-Infinity;
 for(const [name,dx,dz] of [['north',0,-1],['south',0,1],['east',1,0],['west',-1,0]]){
  let score=0;
  for(const dist of [16,48,96,160]){
   const biome=biomeName(bot,Math.floor(me.x+dx*dist),y,Math.floor(me.z+dz*dist));
   if(!biome)continue; // unloaded: neutral
   if(GRAZE.has(biome))score+=dist>=96?3:2; // far graze matters most: packs are sparse
   else if(HARSH.has(biome))score-=2;
  }
  if(score>bestScore){bestScore=score;best=name;}
 }
 return bestScore>0?best:'random';
}
// M5 (iron): [item, ingots, sticks] crafted first, in this order; then the rest of the kit.
const IRON_CORE=[['iron_pickaxe',3,2],['iron_sword',2,1],['shield',1,0]];
// The food graze may go this far below its anchor (hills, not caves).
const GRAZE_DEPTH=6;
const STONE_KIT=[['stone_pickaxe',3],['stone_sword',2],['stone_axe',3],['stone_shovel',1]];
const KIT_STICKS={stone_pickaxe:2,stone_sword:1,stone_axe:2,stone_shovel:1};
// Cobble the unfinished stone kit still costs (tools not held + the furnace when none is held
// or standing near). The shelter leaves this much cobble alone while the autopilot runs.
export const KIT_SPARE=4;
export function kitCobbleNeed(c,ctx={}){
 if(typeof c!=='function')c=countFactory(c||{});
 const tools=STONE_KIT.filter(([item])=>c(item)<1).reduce((a,[,n])=>a+n,0);
 return tools+((c('furnace')>=1||ctx?.worldFurnace)?0:8);
}
// The stone-kit craft that is affordable right now, or null. Used in the sunset grace (and
// ahead of the bed prep): a craft takes seconds, the night takes the rest of a hard run.
// Round 5 hard1 held 19 cobble and a stone pickaxe and slept without a furnace: the next
// piece in kit order (the sword) lacked a stick, so the furnace (no sticks) was never reached.
// Sticks short: craft them from held planks (or planks from held logs) first; no wood at all:
// the furnace still comes, it needs only 8 cobble.
export function duskKitJob(counts,ctx={}){
 const c=countFactory(counts);
 ctx=woodTotals(counts,{...ctx});
 if(!STEPS[0].done(c,ctx)||STEPS[1].done(c,ctx))return null;
 const left=STONE_KIT.filter(([item])=>c(item)<1),piece=left[0];
 if(piece&&c('cobblestone')>=piece[1]){
  if(c('stick')>=KIT_STICKS[piece[0]])return {type:'craft',item:piece[0],count:1,keepTable:true};
  const sticks=left.reduce((a,[item])=>a+KIT_STICKS[item],0)-c('stick');
  if(ctx.planksTotal>=2)return {type:'craft',item:'stick',count:Math.max(1,sticks)};
  if(ctx.logsTotal>=1)return {type:'craft',item:(ctx.heldLog||'oak_log').replace('_log','_planks'),count:4};
 }
 const furnace=c('furnace')>=1||!!ctx.worldFurnace;
 return !furnace&&c('cobblestone')>=8?{type:'craft',item:'furnace',count:1,keepTable:true,collectTable:!piece}:null;
}
// Dusk with the stone kit unfinished and its next piece short of cobble (round 7: hard1 and
// hard3 sent `gather grass_block x25` at dusk and never held a stone pickaxe): gather that
// piece's cobble first - it is shelter material too - so the craft lands before sunset.
export function duskCobbleJob(counts,ctx={}){
 const c=countFactory(counts);
 ctx=woodTotals(counts,{...ctx});
 if(!STEPS[0].done(c,ctx)||STEPS[1].done(c,ctx))return null;
 const piece=STONE_KIT.find(([item])=>c(item)<1);
 const need=piece?piece[1]:8; // stone step not done with every tool held: the furnace
 if(c('cobblestone')>=need)return null;
 return {type:'gather',block:'stone',count:need-c('cobblestone'),radius:32,searchIfMissing:true};
}
const IRON_REST=[['iron_axe',3],['iron_helmet',5],['iron_chestplate',8],['iron_leggings',7],['iron_boots',4],['bucket',3]];
// Round 8, the rung after the iron core (AltoClef's order: tools, then light, then armour,
// then a bed): coal for torches, TORCHES torches, then the iron helmet and chestplate (the
// legs and boots too while their ingots are held), worn at once, then a bed when wool is cheap.
export const TORCH_COAL=4,TORCHES=16;
// Habit 9: water for the bucket is looked for this far.
export const WATER_NEAR=24;
export const ARMOUR_CORE=[['iron_helmet',5],['iron_chestplate',8]];
const ARMOUR_SET=[...ARMOUR_CORE,['iron_leggings',7],['iron_boots',4]];
const ARMOUR_KINDS=['helmet','chestplate','leggings','boots'];
const PLATE={leather:1,golden:2,chainmail:3,iron:4,diamond:5,netherite:6};
// The armour pieces held but not worn that beat what their slot wears, as a signature
// ('iron_helmet,iron_chestplate'), or null. counts() marks worn pieces _equipped_<name>.
export function armourToWear(c){
 if(typeof c!=='function')c=countFactory(c||{});
 const better=[];
 for(const kind of ARMOUR_KINDS){
  let worn=0,spare=null;
  for(const [tier,rank] of Object.entries(PLATE)){
   const name=tier+'_'+kind;
   if(c('_equipped_'+name)>=1)worn=Math.max(worn,rank);
   if(c(name)-c('_equipped_'+name)>=1&&(!spare||rank>spare.rank))spare={rank,name};
  }
  if(spare&&spare.rank>worn)better.push(spare.name);
 }
 return better.length?better.join(','):null;
}
// Coal for the torches: exposed or nearby coal first (a hillside seam, a cave wall - ctx.coalNear
// from a block scan), the band staircase only when none is in reach.
function coalJob(c,ctx,count){
 // Habit 7: charcoal when coal digs keep failing (ctx.coalOff): smelt held logs (a furnace held
 // or near), keeping 2 for planks; short of logs, gather a few.
 if(ctx.coalOff){
  const logs=ctx.logsTotal||0,furnace=c('furnace')>=1||!!ctx.worldFurnace;
  if(furnace&&logs>=3)return {type:'smelt',item:ctx.heldLog||'oak_log',count:Math.min(count,logs-2,48)};
  if(furnace)return {type:'gather',block:'log',count:Math.max(4,count+2),radius:32,searchIfMissing:true,belowFoots:true};
 }
 if(ctx.coalNear)return {type:'gather',block:'coal_ore',count,radius:32,bandTop:IRON_TOP};
 return {type:'gather',block:'coal_ore',count,radius:32,searchIfMissing:true,targetY:IRON_Y,bandTop:IRON_TOP};
}
const sticksFor=(c,ctx,need)=>{
 if(c('stick')>=need)return null;
 const planks=planksJob(c,ctx,2);if(planks)return planks;
 return {type:'craft',item:'stick',count:need-c('stick')};
};
// The bed when its wool is cheap: 3 wool of one colour held, or a sheep within reach and shears
// (shear) or a sword (hunt), with the 3 planks (7 without a table) payable from what is held.
// ctx: {bedNear, sheepNear, worldTable} and the wood totals. Round 10 (bug B, no bed in any
// round-9 run): with the wool held and no wood left, a short log gather pays the planks; with
// no sheep in reach and ctx.bedSearch set (the rung), a graze leg looks for sheep.
export function bedJob(c,ctx){
 if(typeof c!=='function')c=countFactory(c||{});
 if(ctx.bedNear||WOOLS.some(w=>c(w.replace('_wool','_bed'))>=1))return null;
 const wool=WOOLS.reduce((a,w)=>c(w)>c(a)?w:a,WOOLS[0]);
 const planks=3+(c('crafting_table')>=1||ctx.worldTable?0:4);
 if(c(wool)>=3){
  if(ctx.planksTotal<planks){
   if(ctx.logsTotal>=1)return {type:'craft',item:(ctx.heldLog||'oak_log').replace('_log','_planks'),count:planks-ctx.planksTotal};
   return {type:'gather',block:'log',count:Math.ceil((planks-ctx.planksTotal)/4),radius:32,belowFoots:true};
  }
  return {type:'craft',item:wool.replace('_wool','_bed'),count:1};
 }
 // Round 11 (`no sheep after 3 search legs` in both normal runs): any wool source - 4 string
 // (spiders, cobwebs) craft a white wool.
 if(c('white_wool')+Math.floor(c('string')/4)>=3)return {type:'craft',item:'white_wool',count:3-c('white_wool')};
 if(!ctx.sheepNear){
  if(!ctx.bedSearch)return null;
  // A sheep the bot can see beyond the hunt's reach: head its way; else a graze leg, wider
  // each time (ctx.searchDistance).
  const far=ctx.sheepFar;
  if(far)return {type:'explore',direction:Math.abs(far.dx)>=Math.abs(far.dz)?(far.dx>0?'east':'west'):(far.dz>0?'south':'north'),distance:Math.max(16,Math.min(SHEEP_FAR,Math.round(Math.max(Math.abs(far.dx),Math.abs(far.dz))-WOOL_NEAR/2)))};
  return {type:'explore',direction:ctx.grazeDirection||'random',distance:ctx.searchDistance||32};
 }
 // The dusk prep (needPlanks) has no time for a log trip: only wool it can turn into a bed.
 if(ctx.needPlanks&&ctx.planksTotal+4*ctx.logsTotal<planks)return null;
 if(c('shears')>=1)return {type:'shear'};
 // Shears (2 ingots) before killing: a kill drops 1 wool, a shear 1-3 and the sheep stays for
 // the next one (round 11 killed 2 sheep in two runs and never reached 3 wool of one colour).
 if(c('iron_ingot')>=2)return {type:'craft',item:'shears',count:1};
 if(Object.keys(PLATE).concat(['wooden','stone']).some(t=>c(t+'_sword')>=1))return {type:'hunt',entity:'sheep',count:Math.max(1,Math.min(3-c(wool),ctx.sheepNear))};
 return null;
}
// Round 10 (bug B, habit 5): wool by day whatever the step, once the wood kit is held - a
// sheep within WOOL_NEAR (the hunt's own reach) is a bed tonight and a spawn point. Never
// with a hostile within 16, after sunset, or while the bed is set aside (a failed hunt).
// The rung's sheep search gives the bed BED_SEARCH_LEGS graze legs before it is set aside.
export const WOOL_NEAR=24,BED_SEARCH_LEGS=3;
// Round 11: sheep seen up to SHEEP_FAR away are walked toward; blind legs go BED_SEARCH_DIST.
export const SHEEP_FAR=96,BED_SEARCH_DIST=[64,96,96];
const QUICK_JOBS=new Set(['craft','equip','smelt','eat']);
export function woolJob(counts,ctx){
 const c=countFactory(counts);
 ctx=woodTotals(counts,{...ctx});
 if(!STEPS[0].done(c,ctx)||ctx.bedOff||(ctx.hostileDistance??Infinity)<=16)return null;
 if(ctx.tod!=null&&ctx.tod>=SUNSET)return null;
 return bedJob(c,{...ctx,bedSearch:false});
}
// Round 8, toward diamonds: once the iron kit is worn, 3 diamonds for a diamond pickaxe.
// Round 10, habit 8 (diamonds the safe way): lava lakes sit at -54 and below, so the trip goes
// down by the safe staircase to DIAMOND_Y (-53) and branch-mines there (worker.branchMine: a
// main tunnel, side branches every 3, torches, lava plugged) - diamonds in its walls and floor
// line come out on the way. No ore below -53 is a target. Torches must be held for the trip.
export const DIAMOND_Y=-53,DIAMOND_TOP=-53,DIAMOND_PICK=3,DIAMOND_TORCHES=8;
export const diamondGather=count=>({type:'gather',block:'diamond_ore',count:Math.max(1,count),radius:32,targetY:DIAMOND_Y,bandTop:DIAMOND_TOP,strip:true});
export function diamondPickJob(c,ctx){
 if(typeof c!=='function')c=countFactory(c||{});
 if(c('diamond_pickaxe')>=1||c('iron_pickaxe')<1)return null;
 if(c('diamond')>=DIAMOND_PICK)return sticksFor(c,ctx,2)||{type:'craft',item:'diamond_pickaxe',count:1};
 if(ctx.diamondOff||c('torch')<DIAMOND_TORCHES)return null;
 return diamondGather(DIAMOND_PICK-c('diamond'));
}
export const isDiamondJob=job=>!!job&&((job.type==='gather'&&job.block==='diamond_ore')||(job.type==='craft'&&job.item==='diamond_pickaxe'));
// BED_JOBS: the planks craft or log gather a bed asked for (the rung's failures must not
// count toward blocking the iron step).
const BED_JOBS=new WeakSet();
export const isBedJob=job=>!!job&&(BED_JOBS.has(job)||job.type==='shear'||(job.type==='hunt'&&job.entity==='sheep')||(job.type==='craft'&&/_bed$/.test(job.item||'')));
// The rung after the iron core, or null when it is done (or waits on wool that is not cheap).
export function ironRung(c,ctx){
 if(typeof c!=='function')c=countFactory(c||{});
 // Light: coal for TORCHES, then the torches (1 coal + 1 stick make 4).
 if(c('torch')<TORCHES){
  const coalNeed=Math.ceil((TORCHES-c('torch'))/4);
  if(c('coal')+c('charcoal')<coalNeed)return coalJob(c,ctx,Math.max(TORCH_COAL,coalNeed)-c('coal')-c('charcoal'));
  return sticksFor(c,ctx,coalNeed)||{type:'craft',item:'torch',count:TORCHES-c('torch')};
 }
 // Habit 9: a water bucket (3 ingots) after the light, filled at water in reach and kept - the
 // MLG fall chain and the fire douse use it, and pick the water back up.
 if(c('bucket')+c('water_bucket')<1&&c('iron_ingot')>=3)return {type:'craft',item:'bucket',count:1};
 if(c('water_bucket')<1&&c('bucket')>=1&&ctx.waterAt)return {type:'use',item:'bucket',position:ctx.waterAt};
 // Armour: helmet and chestplate are dug for; legs and boots ride along while affordable.
 const coreLeft=ARMOUR_CORE.filter(([item])=>c(item)<1);
 const ingots=c('iron_ingot');
 if(coreLeft.length){
  if(ingots>=coreLeft[0][1])return {type:'craft',item:coreLeft[0][0],count:1};
  const short=coreLeft.reduce((a,[,n])=>a+n,0)+(c('bucket')+c('water_bucket')<1?3:0)-ingots;
  if(c('raw_iron')>=Math.min(IRON_SMELT_AT,coreLeft[0][1]-ingots))return smeltIron(c,ctx);
  const spare=spareStonePick(c,ctx);if(spare)return spare;
  return ironGather(short-c('raw_iron'));
 }
 const extra=ARMOUR_SET.find(([item,n])=>c(item)<1&&ingots>=n);
 if(extra)return {type:'craft',item:extra[0],count:1};
 // Wear what was crafted (once per new set of pieces: an equip that could not change the
 // slots must not loop).
 const wear=armourToWear(c);
 if(wear&&wear!==ctx.lastEquip)return {type:'equip'};
 // A bed while the wool is cheap; otherwise the ladder moves on (the dusk prep still tries).
 if(!ctx.bedOff){const bed=bedJob(c,{...ctx,bedSearch:ctx.bedSearch??false});if(bed){if(bed.type!=='explore')BED_JOBS.add(bed);return bed;}}
 // Then the diamond pickaxe (set aside for DIAMOND_OFF_MS after a failed trip).
 return diamondPickJob(c,ctx);
}
// Staircase target for ore: the 1.18+ iron band peaks at y=16 (-24..56) and the gather's
// radius-32 block scan (findBlocks sees ore inside stone, deepslate included) from y=32
// covers 0..64, so most digs stop well above the deepslate layer.
const IRON_Y=32;
// Round 7 (iron pickaxe 1/3, normal3 down at y=19, normal1 ending on 30 raw iron): iron is
// mined in the band near the surface - the staircase enters it from the top (bandTop 64)
// in legs and never goes below 16, exposed ore first (worker descentTarget) - in batches of
// IRON_BATCH, and the gather smelts in its tunnel once IRON_SMELT_AT raw iron is held
// (worker kilnTick). Raw iron left over is smelted before the next dig.
export const IRON_FLOOR=16,IRON_TOP=64,IRON_BATCH=6,IRON_SMELT_AT=3;
export const ironGather=count=>({type:'gather',block:'iron_ore',count:Math.max(1,Math.min(IRON_BATCH,count)),radius:32,searchIfMissing:true,targetY:IRON_FLOOR,bandTop:IRON_TOP,smeltAt:IRON_SMELT_AT});
// Two stone pickaxes broke in round 6 (conserveTool wears stone first while iron is held):
// the iron step keeps a spare, from the cobble its staircases bring up, before any dig.
export const STONE_PICKS=2;
function spareStonePick(c,ctx){
 if(c('stone_pickaxe')>=STONE_PICKS||c('cobblestone')<3)return null;
 // A 3x3 craft: a table held or near, or the planks for one (the craft job places it).
 const table=c('crafting_table')>=1||!!ctx.worldTable;
 if(c('stick')>=2)return table||ctx.planksTotal>=4?{type:'craft',item:'stone_pickaxe',count:1}:null;
 if(!table)return null;
 if(ctx.planksTotal>=2)return {type:'craft',item:'stick',count:2};
 if(ctx.logsTotal>=1)return {type:'craft',item:(ctx.heldLog||'oak_log').replace('_log','_planks'),count:4};
 return null; // no wood: not worth a log hunt
}
// Smelt raw iron with coal: a coal item smelts 8, so a short coal dig (coal ore is the most
// common ore around the iron band) beats burning the planks the sticks and shield need.
// Wood still counts (worker.fuelPlan burns planks/logs at 1.5 items each) beyond 8 planks.
function smeltIron(c,ctx){
 const count=Math.min(48,c('raw_iron'));
 const fuel=8*(c('coal')+c('charcoal'))+1.5*(Math.max(0,ctx.planksTotal-8)+ctx.logsTotal);
 if(fuel<count)return {type:'gather',block:'coal_ore',count:Math.ceil((count-fuel)/8),radius:32,searchIfMissing:true,targetY:IRON_Y,bandTop:IRON_TOP};
 return {type:'smelt',item:'raw_iron',count};
}
const DIAMOND_GEAR=[['diamond_sword',2],['diamond_axe',3],['diamond_helmet',5],['diamond_chestplate',8],['diamond_leggings',7],['diamond_boots',4]];
// Ensure planks for a craft: gather a few logs when none are held, else craft from the held species.
const planksJob=(c,ctx,need)=>{
 if(ctx.planksTotal>=need)return null;
 if(ctx.logsTotal<2)return {type:'gather',block:'log',count:4,radius:32,searchIfMissing:true,belowFoots:true,surface:true};
 return {type:'craft',item:(ctx.heldLog||'oak_log').replace('_log','_planks'),count:need-ctx.planksTotal};
};
// COMBAT_SPEC 7a repair-by-replacement: a nearly-broken item with no fresh spare is re-crafted
// in the best tier the inventory can pay for before it breaks mid-fight. The counts map marks
// worn items as _worn_<name> (see Autopilot.counts); one fresh spare stops the crafting.
function replacementJob(c,ctx){
 const worn=[];
 for(const tier of ['diamond','iron','stone','golden','wooden'])for(const kind of Object.keys(REPLACE_ORDER)){
  const name=tier+'_'+kind;
  if(c('_worn_'+name)>=1&&c(name)<=c('_worn_'+name))worn.push({kind,priority:REPLACE_ORDER[kind]});
 }
 if(!worn.length)return null;
 worn.sort((a,b)=>a.priority-b.priority);
 const {kind}=worn[0],cost=REPLACE_COST[kind],sticks=REPLACE_STICKS[kind]||0;
 for(const [tier,material] of REPLACE_TIERS[ARMOURED.has(kind)?'armour':'weapon']){
  const pay=material?c(material):ctx.planksTotal;
  if(pay>=cost&&c('stick')>=sticks)return {type:'craft',item:tier+'_'+kind,count:1};
 }
 return null; // no materials for a spare: keep using the worn item
}

// Round 9: the food step must never hold the ladder. Round-8 normal1 cooked 3 porkchops, ate
// them at a bar of 14 and then sat on [food] for 15 min (27 explore legs, `food failed 3 times`
// x12) under an 8-edible rule its own meals kept breaking - no iron pickaxe in any run.
// Done at FOOD_ENOUGH edible held, or that many held + eaten this run (`_eaten`), unless the
// bot is hungry (bar <= FOOD_HUNGRY) with nothing to eat. A food step that keeps failing is
// set aside (ctx.foodOff, FOOD_OFF_MS) and comes back only on that hunger (ctx.foodDeferred).
export const FOOD_CRITICAL=6,FOOD_ENOUGH=4,FOOD_HUNGRY=14,FOOD_LEGS=6,FOOD_OFF_MS=8*60000,FOOD_BATCH=6;
export function foodDone(c,ctx){
 if(COOKABLE_MEAT.some(m=>c(m)>=1&&c('furnace')>=1))return false; // smelting it takes seconds
 const edible=c('_edible');
 if(edible>=FOOD_ENOUGH)return true;
 const starving=edible<1&&Number.isFinite(ctx?.foodBar)&&ctx.foodBar<=FOOD_HUNGRY;
 // Round 11 normal1: the bar fell to 5 with no food held while the step sat set aside for its
 // 8 minutes. A nearly empty bar always brings the food step back.
 if(edible<1&&Number.isFinite(ctx?.foodBar)&&ctx.foodBar<=FOOD_CRITICAL)return false;
 if(ctx?.foodOff)return true;
 if(starving)return false;
 return edible+c('_eaten')>=FOOD_ENOUGH||!!ctx?.foodDeferred;
}
// Round 10 (efficiency 1): don't stand and stare at a working furnace. A ladder smelt of
// SMELT_LEAVE_AT+ items loads the furnace and ends (smelt leave:true, worker.furnaceRun);
// until the batch is ready the bot does useful work near it (furnaceWork), then the take job
// collects the output. It goes back early at dusk, with a hostile near or when it strayed more
// than FURNACE_LEASH from the furnace (each side job stays within radius FURNACE_WORK_RADIUS of
// the bot, started within the leash), and does at most FURNACE_SIDE_JOBS side jobs per batch.
export const SMELT_LEAVE_AT=2,FURNACE_LEASH=8,FURNACE_WORK_RADIUS=16,FURNACE_SIDE_JOBS=4,FURNACE_DUSK=SUNSET-1200;
export function furnaceWork(run,counts,ctx){
 const c=countFactory(counts);
 ctx=woodTotals(counts,{...ctx});
 const take={type:'smelt',item:run.item,count:run.count,take:true,...(ctx.moreCooking?{keepFurnace:true}:{})};
 if(ctx.now>=run.readyAt)return take;
 if(ctx.tod!=null&&ctx.tod>=FURNACE_DUSK)return take; // never leave a furnace across a night
 if((ctx.hostileDistance??Infinity)<=16||(ctx.furnaceDistance??0)>FURNACE_LEASH)return take;
 if((ctx.sideJobs||0)>=FURNACE_SIDE_JOBS)return null; // wait for it
 const r=FURNACE_WORK_RADIUS,pick=c('stone_pickaxe')+c('iron_pickaxe')+c('diamond_pickaxe')>=1;
 // Coal for torches and the next batch, then iron (stone pickaxe), both in sight of the furnace.
 if(pick&&ctx.coalNear&&c('coal')<16)return {type:'gather',block:'coal_ore',count:Math.min(4,16-c('coal')),radius:r};
 if(pick&&ctx.ironNear&&c('raw_iron')<IRON_BATCH)return {type:'gather',block:'iron_ore',count:2,radius:r};
 // Torches from what is held (1 coal + 1 stick make 4).
 if(c('torch')<TORCHES&&c('coal')+c('charcoal')>=1&&c('stick')>=1)return {type:'craft',item:'torch',count:Math.min(TORCHES-c('torch'),4*Math.min(c('coal')+c('charcoal'),c('stick')))};
 if(ctx.logsTotal<4&&ctx.logNear)return {type:'gather',block:'log',count:2,radius:r,belowFoots:true};
 if(ctx.dropsNear)return {type:'collect',radius:r};
 return null;
}
// Round 10, habit 10: heal before risky work. A deep dig (a gather with a target depth, a
// branch mine) waits while health is under RISKY_HEALTH: with the bar under 18 (natural
// regeneration stops there) and food held, an eat job tops it up first; then it waits for the
// health, at most HEAL_WAIT_MS per episode, and goes ahead.
export const RISKY_HEALTH=16,HEAL_WAIT_MS=90000;
export const riskyJob=job=>!!job&&job.type==='gather'&&(job.targetY!=null||!!job.strip);
export function healFirst({job,health,food,edible,since=0,now=Date.now(),ate=false}){
 if(!riskyJob(job)||!(health<RISKY_HEALTH))return null;
 if(since&&now-since>=HEAL_WAIT_MS)return null;
 if(food<18&&edible>0&&!ate)return {type:'eat'};
 return 'wait';
}
// Round 10, habit 11: food security beyond hunting. A small wheat patch beside home (when water
// is in reach of it): seeds from grass, a wooden hoe, FARM_PLOTS tilled cells within 4 of the
// water, planted, and harvested ripe (bread from 3 wheat is the food step's). Breeding: two of a
// kind within 16 with 2 of their food held (BREED_EVERY_MS per kind). Hay bales (a village)
// craft back into 9 wheat. ctx.farm: {nearHome, water, tillable, farmland, ripe, plots}.
export const FARM_PLOTS=4,FARM_SEEDS=2,BREED_EVERY_MS=5*60000,FARM_OFF_MS=10*60000;
const HOES=['wooden','stone','iron','golden','diamond','netherite'].map(t=>t+'_hoe');
export function farmJob(counts,ctx){
 const c=countFactory(counts);
 ctx=woodTotals(counts,{...ctx});
 const f=ctx.farm;
 if(!f||!f.nearHome||!f.water||ctx.farmOff)return null;
 if(ctx.tod!=null&&ctx.tod>=SUNSET)return null;
 if((ctx.hostileDistance??Infinity)<=16)return null;
 if(f.ripe)return {type:'gather',block:'wheat',count:f.ripe,radius:12};
 if(c('wheat_seeds')>=1&&f.farmland)return {type:'use',item:'wheat_seeds',position:f.farmland};
 if((f.plots||0)>=FARM_PLOTS||!f.tillable)return null;
 if(c('wheat_seeds')<FARM_SEEDS)return f.grass?{type:'gather',block:'short_grass',count:FARM_SEEDS-c('wheat_seeds'),radius:16}:null;
 const hoe=HOES.find(h=>c(h)>=1);
 if(hoe)return {type:'use',item:hoe,position:f.tillable};
 if(c('stick')>=2&&ctx.planksTotal>=2+(c('crafting_table')>=1||ctx.worldTable?0:4))return {type:'craft',item:'wooden_hoe',count:1};
 return null;
}
// Round 10, habit 7: torches as soon as coal and sticks exist (any step after the wood kit),
// keeping one coal for the furnace, up to TORCHES; and TORCHES_HOME torches beside the home bed
// (a lit base: monsters near a bed refuse the sleep), once per home.
export const TORCHES_HOME=2;
export function torchJob(counts,ctx){
 const c=countFactory(counts);
 const fuel=c('coal')+c('charcoal');
 if(c('torch')>=TORCHES||fuel<2||c('stick')<1)return null;
 const n=Math.min(fuel-1,c('stick'),Math.ceil((TORCHES-c('torch'))/4));
 return n>=1?{type:'craft',item:'torch',count:Math.min(TORCHES-c('torch'),4*n)}:null;
}
// Round 10 (efficiency 3): opportunistic pickups between jobs. Exposed coal, iron or diamond
// ore (or a log when wood is low) within PICKUP_RADIUS that the ladder will need soon is mined
// in a short detour (a radius-PICKUP_RADIUS gather, no search), at most once per PICKUP_EVERY_MS,
// never at night or with a hostile within 16. ctx.exposed: {coal,iron,diamond,log} counts.
export const PICKUP_RADIUS=6,PICKUP_EVERY_MS=60000,PICKUP_MAX=4;
export function pickupJob(counts,ctx){
 const c=countFactory(counts);
 ctx=woodTotals(counts,{...ctx});
 const ex=ctx.exposed||{};
 if(ctx.tod!=null&&ctx.tod>=SUNSET)return null;
 if((ctx.hostileDistance??Infinity)<=16)return null;
 if(ctx.sinceLast!=null&&ctx.sinceLast<PICKUP_EVERY_MS)return null;
 const g=(block,n)=>({type:'gather',block,count:Math.max(1,Math.min(PICKUP_MAX,n)),radius:PICKUP_RADIUS});
 const anyPick=['wooden','stone','iron','diamond','golden'].some(t=>c(t+'_pickaxe')>=1);
 const stonePick=['stone','iron','diamond'].some(t=>c(t+'_pickaxe')>=1);
 if(c('iron_pickaxe')+c('diamond_pickaxe')>=1&&ex.diamond&&c('diamond_pickaxe')<1)return g('diamond_ore',ex.diamond);
 if(stonePick&&ex.iron&&c('raw_iron')+c('iron_ingot')<30)return g('iron_ore',ex.iron);
 if(anyPick&&ex.coal&&c('coal')+c('charcoal')<16)return g('coal_ore',ex.coal);
 if(ex.log&&ctx.logsTotal+ctx.planksTotal/4<2)return {...g('log',Math.min(2,ex.log)),belowFoots:true};
 return null;
}
// Round 10, habit 6: home base and inventory management. JUNK_KEEP: how many of an item the
// bot keeps on it (shelter dirt, a stack of cobble, seeds for a wheat patch); the rest is
// surplus. JUNK_DROP: items worth nothing to the ladder, dropped when the inventory is full far
// from base. Over INV_FULL the surplus goes into the home chest (placed beside home, crafted
// when needed) while home is within HOME_DEPOSIT_RANGE; passing within INV_PASS of the chest
// deposits it too; full and far from home, pure junk is dropped.
export const INV_FULL=0.75,INV_PASS=8,INV_PASS_MIN=16,HOME_DEPOSIT_RANGE=48,INV_OFF_MS=5*60000,DROP_LOOP_MS=3*60000;
const SAPLING=/_sapling$/,FLOWER=/^(dandelion|poppy|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|cornflower|lily_of_the_valley|sunflower|lilac|rose_bush|peony|pink_petals|short_grass|tall_grass|fern|dead_bush)$/;
export const JUNK_KEEP={dirt:32,cobblestone:64,cobbled_deepslate:32,netherrack:16,wheat_seeds:16,gravel:0,andesite:0,diorite:0,granite:0,tuff:0,calcite:0,rotten_flesh:0,sand:0,red_sand:0,pointed_dripstone:0,poisonous_potato:0,spider_eye:0};
const JUNK_DROP=new Set(['gravel','andesite','diorite','granite','tuff','calcite','rotten_flesh','poisonous_potato','dirt','cobblestone','cobbled_deepslate','netherrack','wheat_seeds']);
const keepOf=name=>JUNK_KEEP[name]??(SAPLING.test(name)?2:FLOWER.test(name)?0:null);
// Round 11 (`Inventory nearly full; deposit items first` and never a deposit): what the ladder
// still uses - tools, armour, food, fuel, the iron/diamond kit's materials, the bed's - stays on
// the bot. When the inventory is full, everything else is surplus too (copper, redstone, bones,
// leather...), so a full bag always has something to put in the chest.
const LADDER_ITEM=/(_pickaxe|_axe|_shovel|_hoe|_sword|_helmet|_chestplate|_leggings|_boots|_log|_planks|_wool|_bed|_ore)$|^(stick|coal|charcoal|torch|crafting_table|furnace|chest|iron_ingot|raw_iron|iron_nugget|diamond|bucket|water_bucket|shield|bow|arrow|flint|feather|string|shears|wheat|wheat_seeds|hay_block|bone_meal|cobblestone|cobbled_deepslate|dirt|netherrack)$/;
const FOOD_ITEM=/^(cooked_)?(beef|porkchop|chicken|mutton|rabbit|cod|salmon)$|^(bread|apple|golden_apple|carrot|potato|baked_potato|beetroot|melon_slice|sweet_berries|glow_berries|cookie|pumpkin_pie|mushroom_stew|rabbit_stew|beetroot_soup|dried_kelp|golden_carrot|tropical_fish)$/;
// Surplus items, largest first: [{item, extra, keep}]. full: the rest of the bag too.
export function surplus(counts,full=false){
 const out=[];
 for(const [name,n] of Object.entries(counts||{})){
  if(name.startsWith('_'))continue;
  let keep=keepOf(name);
  if(keep==null&&full&&!LADDER_ITEM.test(name)&&!FOOD_ITEM.test(name))keep=0;
  if(keep==null||n<=keep)continue;
  out.push({item:name,extra:n-keep,keep});
 }
 return out.sort((a,b)=>b.extra-a.extra);
}
const droppable=s=>JUNK_DROP.has(s.item)||SAPLING.test(s.item)||FLOWER.test(s.item);
// ctx: {slotsFull, homeDistance, chestAt, chestDistance, chestSpot, worldTable, planksTotal}.
// Round 11: no home chest yet, full: one goes beside home, or where the bot stands when home
// is out of range or unset (ctx.chestSpotHere; it becomes home). A home chest that is far:
// junk is dropped first, and only a bag with nothing droppable gets a new chest here.
export function inventoryJob(counts,ctx){
 const c=countFactory(counts);
 ctx=woodTotals(counts,{...ctx});
 const full=(ctx.slotsFull||0)>INV_FULL;
 const extra=surplus(counts,full);
 if(!extra.length)return null;
 const top=extra[0];
 if(ctx.chestAt&&(ctx.chestDistance??Infinity)<=(full?HOME_DEPOSIT_RANGE:INV_PASS)&&(full||top.extra>=INV_PASS_MIN))return {type:'deposit',position:ctx.chestAt,item:top.item,keep:top.keep};
 if(!full)return null;
 const chestJob=spot=>c('chest')>=1?(spot?{type:'place',block:'chest',position:spot}:null)
  :ctx.planksTotal>=8+(c('crafting_table')>=1||ctx.worldTable?0:4)?{type:'craft',item:'chest',count:1}:null;
 if(!ctx.chestAt){const j=chestJob((ctx.homeDistance??Infinity)<=HOME_DEPOSIT_RANGE?ctx.chestSpot:ctx.chestSpotHere);if(j)return j;}
 const junk=extra.find(droppable);
 if(junk)return {type:'drop',item:junk.item,count:junk.extra};
 return ctx.chestAt?chestJob(ctx.chestSpotHere):null;
}
// The progression ladder. Each entry: name, done(counts) and next(counts, ctx) producing the
// next job spec (ctx: {slotsFull, animalsNearby, huntPhase, home, homeChest, chestSpot,
// heldLog, logsTotal, planksTotal}). Any log species works for the wood step.
export const STEPS=[
 {name:'wood',done:(c,ctx)=>c('wooden_pickaxe')>=1&&(c('crafting_table')>=1||!!ctx?.worldTable)&&c('wooden_sword')>=1&&c('wooden_axe')>=1,next(c,ctx){
  // KIT-FIRST (review directive): the whole wood kit costs 11 planks (table 4 + sticks 2
  // + sword 2 + pickaxe 3) = 3 logs - gather all of it BEFORE crafting, because batches
  // that stop halfway feed the mobs and strand the run between steps. Then craft in
  // survival order: table, sticks, then the pickaxe (unless a hostile is within 16 blocks,
  // in which case the sword still comes first).
  // Search radius stays 32 (MEASURED): radius 96 finds distant trees the pathfinder cannot
  // route to through forest terrain ('No path to the goal' x7, soak 20261013-020850, 0
  // logs in all 3 runs), while radius 32 gathered logs 3-4 in the earlier soaks. Reaching
  // groves beyond 32 blocks needs wood-aware explore, not a longer grab (next session).
  const plank=((ctx.heldLog||'oak_log').replace('_log','_planks'));
  const gather3=()=>({type:'gather',block:'log',count:3,radius:32,searchIfMissing:true,belowFoots:true,surface:true});
  const KIT=11;
  // 0. Planks for the whole kit: convert held logs; when short even after that, gather 3.
  if(ctx.planksTotal<KIT)return ctx.logsTotal>=1?{type:'craft',item:plank,count:Math.min(ctx.logsTotal*4,KIT-ctx.planksTotal)}:gather3();
  // 1. Table (4 planks).
  if(c('crafting_table')<1)return {type:'craft',item:'crafting_table',count:1};
  // 2. Sticks (4 covers the sword and the pickaxe; 2 planks).
  if(c('stick')<4)return {type:'craft',item:'stick',count:4};
  // Pickaxe before the sword when nothing is close: the pickaxe unlocks stone, and sword
  // retries are what burned the normal3 soak. A hostile within 16 blocks still takes the sword first.
  const threatened=(ctx.hostileDistance??Infinity)<=16;
  if(threatened&&c('wooden_sword')<1)return {type:'craft',item:'wooden_sword',count:1,keepTable:true};
  if(c('wooden_pickaxe')<1)return {type:'craft',item:'wooden_pickaxe',count:1,keepTable:true};
  if(c('wooden_sword')<1)return {type:'craft',item:'wooden_sword',count:1,keepTable:true};
  // 5. 7a axe (3 planks + 2 sticks): swords AND axes in every tier it can reach. The axe is
  // the step's last craft, so it collects the table again (end-of-wood-step pickup).
  if(c('wooden_axe')<1){
   if(c('stick')<2)return {type:'craft',item:'stick',count:2,keepTable:true};
   return {type:'craft',item:'wooden_axe',count:1,keepTable:true,collectTable:true};
  }
  // Tools done: top up logs for the stone step in small batches.
  if(ctx.logsTotal<12)return {type:'gather',block:'log',count:4,radius:32,searchIfMissing:true,belowFoots:true,surface:true};
  return null;
 }},
 {name:'stone',done:(c,ctx)=>(c('furnace')>=1||!!ctx?.worldFurnace)&&c('stone_pickaxe')>=1&&c('stone_axe')>=1&&c('stone_sword')>=1&&c('stone_shovel')>=1,next(c,ctx){
  const plank=((ctx.heldLog||'oak_log').replace('_log','_planks'));
  // Planks from held logs are a 2x2 craft (seconds, no table): keep a few for the sticks.
  if(ctx.planksTotal<8&&ctx.logsTotal>=2)return {type:'craft',item:plank,count:8};
  // Each piece is crafted as soon as its cobble is held, in kit order (pickaxe, then the
  // sword - COMBAT_SPEC 7f - axe, shovel, furnace). Round 3 hard1/hard2 held dig-down cobble
  // at 150 s and 241 s but never a stone pickaxe: the 32-cobble gather had to finish first,
  // and on the hard anchor it failed short every time, so the ladder looped on the gather.
  // Round 7 (hard1/hard3 never got a stone pickaxe): sticks are made only for a piece whose
  // cobble is already held - the old 10-sticks-first rule sent a log hunt (planks 0, logs 0
  // after the wood kit; a harvested forest by hard3) before the first stone was ever mined.
  const left=STONE_KIT.filter(([item])=>c(item)<1),piece=left[0];
  if(piece&&c('cobblestone')>=piece[1]){
   if(c('stick')>=KIT_STICKS[piece[0]])return {type:'craft',item:piece[0],count:1,keepTable:true};
   const planks=planksJob(c,ctx,2);if(planks)return planks;
   return {type:'craft',item:'stick',count:Math.max(1,left.reduce((a,[item])=>a+KIT_STICKS[item],0)-c('stick'))};
  }
  if(!piece&&!(c('furnace')>=1||ctx?.worldFurnace)&&c('cobblestone')>=8)return {type:'craft',item:'furnace',count:1,keepTable:true,collectTable:true};
  // Gather what the rest of the kit costs plus a small spare, not a flat 32: round 4 hard2
  // was still filling the 32 (24 held, kit needing 14) when sunset cancelled the gather.
  // Without a stone pickaxe only its 3 first (a short wooden-pickaxe dig that succeeds),
  // then the faster pickaxe digs the rest.
  const want=c('stone_pickaxe')<1?3:Math.min(32,kitCobbleNeed(c,ctx)+KIT_SPARE);
  if(c('cobblestone')<want)return {type:'gather',block:'stone',count:want-c('cobblestone'),radius:32,searchIfMissing:true};
  if(c('stone_pickaxe')<1)return {type:'craft',item:'stone_pickaxe',count:1,keepTable:true};
  // COMBAT_SPEC 7f: the stone sword comes right after the stone pickaxe.
  if(c('stone_sword')<1)return {type:'craft',item:'stone_sword',count:1,keepTable:true};
  if(c('stone_axe')<1)return {type:'craft',item:'stone_axe',count:1,keepTable:true};
  if(c('stone_shovel')<1)return {type:'craft',item:'stone_shovel',count:1,keepTable:true};
  // leave the table standing through the kit; pick it up with the furnace (last stone craft)
  return {type:'craft',item:'furnace',count:1,keepTable:true,collectTable:true};
 }},
 {name:'food',done:foodDone,next(c,ctx){
  // COMBAT_SPEC 7a: keep cooked food - raw meat is smelted through the existing flow
  // whenever a furnace is available, even while enough raw food is already held.
  const meat=COOKABLE_MEAT.find(m=>c(m)>=1);
  // Round 10 (efficiency 2, seen live: kill one, cook it, break the furnace, walk to the next
  // animal right beside it): while animals are still within reach (ctx.animalsClose, 24) and
  // the batch is short of FOOD_BATCH, hunt on; then cook it all in one furnace run.
  const hunting=ctx.animalsNearby&&(ctx.animalsClose||0)>0&&c('_edible')<FOOD_BATCH;
  if(meat&&c('furnace')>=1&&!hunting)return {type:'smelt',item:meat,count:Math.min(48,c(meat))};
  if(c('wheat')>=3)return {type:'craft',item:'bread',count:1};
  if(c('hay_block')>=1)return {type:'craft',item:'wheat',count:9}; // habit 11: a village's hay
  // Habit 11: two of a kind and their food held - a pair bred keeps the herd before the hunt.
  if(ctx.breedable&&c('_edible')>=1)return {type:'breed',entity:ctx.breedable}; // starving: hunt first
  if(ctx.hayNear)return {type:'gather',block:'hay_block',count:Math.min(3,ctx.hayNear),radius:32};
  // COMBAT_SPEC 7a: replace a nearly-broken weapon before hunting.
  const fix=replacementJob(c,ctx);if(fix)return fix;
  if(ctx.animalsNearby)return ctx.huntPhase?{type:'collect',radius:16}:{type:'fight',entity:ctx.animalsNearby,maxSeconds:90};
  // 90 s, not 30: chickens/pigs panic-run when hit and the 30 s window timed out every
  // chase after the first (soak 6 hard3: one kill, then five consecutive timeouts).
  // 32-block legs re-decide every ~20 s and the tick cancels the moment animals come
  // into hunt range. The ceiling is anchored to the WOOD STEP's stand (lastSurfaceY),
  // not the current Y: a standY+8 ceiling per leg ratcheted the bot up a peak +8 per leg
  // (soak 7 normal1: y=156 on frozen_peaks, animal-less terrain).
  // The anchor is fixed for the run (the Autopilot latches the first food stand when no
  // surface gather set one): min(current,anchor) ratcheted DOWN into valleys, and a bare
  // current-Y anchor ratchets up again. A bot already above the cap may not climb further,
  // but its legs must still start (navigation rejects any position above the cap).
  const anchorY=Number.isFinite(ctx.lastSurfaceY)?ctx.lastSurfaceY:ctx.standY;
  let cap=Number.isFinite(anchorY)?anchorY+8:undefined;
  if(cap!=null&&Number.isFinite(ctx.standY)&&ctx.standY>cap)cap=ctx.standY;
  // The floor mirrors the cap: the graze is a surface activity, never a cave walk (round 3
  // normal3 was shot dead at y=41, 90 below its anchor). A bot already under it stays level.
  let floor=Number.isFinite(anchorY)?anchorY-GRAZE_DEPTH:undefined;
  if(floor!=null&&Number.isFinite(ctx.standY)&&ctx.standY<floor)floor=ctx.standY;
  return {type:'explore',distance:32,direction:ctx.grazeDirection||'random',...(cap!=null?{surfaceCeiling:cap}:{}),...(floor!=null?{surfaceFloor:floor}:{})};
 }},
 {name:'iron',done:c=>c('iron_pickaxe')>=1&&c('iron_sword')>=1&&c('iron_axe')>=1&&c('shield')>=1&&c('bow')>=1&&c('arrow')>=ARROWS&&c('iron_helmet')>=1&&c('iron_chestplate')>=1&&c('iron_leggings')>=1&&c('iron_boots')>=1&&c('bucket')+c('water_bucket')>=1&&c('torch')>=TORCHES,next(c,ctx){
  // M5 core FIRST: iron pickaxe, then iron sword, then the shield (COMBAT_SPEC 7a: right after
  // the first ingots) - 6 ingots from one short dig, before the 16-coal / 36-ore expedition
  // that used to stand between the stone kit and any iron tool at all.
  const core=IRON_CORE.filter(([item])=>c(item)<1);
  // Each core piece is crafted as soon as its own ingots are held (the pickaxe at 3), and
  // 3+ raw iron is smelted before the next dig.
  if(core.length){
   const [item,ingots]=core[0];
   if(c('iron_ingot')>=ingots){
    const sticks=core.filter(([,n])=>c('iron_ingot')>=n).reduce((a,[,,n])=>a+n,0);
    if(c('stick')<core[0][2]){
     const planks=planksJob(c,ctx,2);if(planks)return planks;
     return {type:'craft',item:'stick',count:Math.max(1,sticks-c('stick'))};
    }
    if(item==='shield'){const planks=planksJob(c,ctx,6);if(planks)return planks;}
    return {type:'craft',item,count:1};
   }
   const short=core.reduce((a,[,n])=>a+n,0)-c('iron_ingot');
   if(c('raw_iron')>=Math.min(IRON_SMELT_AT,ingots-c('iron_ingot')))return smeltIron(c,ctx);
   const spare=spareStonePick(c,ctx);if(spare)return spare;
   return ironGather(short-c('raw_iron'));
  }
  // Round 8: torches, the iron helmet and chestplate (worn), then a cheap bed - after a
  // nearly-broken weapon's replacement (COMBAT_SPEC 7a).
  const worn=replacementJob(c,ctx);if(worn)return worn;
  const rung=ironRung(c,ctx);if(rung)return rung;
  if(c('coal')<16)return {type:'gather',block:'coal_ore',count:16-c('coal'),radius:32,searchIfMissing:true,targetY:IRON_Y,bandTop:IRON_TOP};
  // The rest of the kit after the core: axe 3, bucket 3 and the armour set 24 = 30 ingots.
  const rest=IRON_REST.filter(([item])=>c(item)+(item==='bucket'?c('water_bucket'):0)<1).reduce((a,[,n])=>a+n,0);
  if(c('raw_iron')>=IRON_SMELT_AT&&c('iron_ingot')<rest)return smeltIron(c,ctx);
  if(c('raw_iron')+c('iron_ingot')<rest){
   const spare=spareStonePick(c,ctx);if(spare)return spare;
   return ironGather(rest-c('raw_iron')-c('iron_ingot'));
  }
  if(c('raw_iron')>=1&&c('iron_ingot')<rest)return smeltIron(c,ctx);
  if(c('iron_ore')>=1)return {type:'smelt',item:'iron_ore',count:Math.min(48,c('iron_ore'))};
  // COMBAT_SPEC 7a: replace a nearly-broken weapon before the spider and chicken hunts.
  const fix=replacementJob(c,ctx);if(fix)return fix;
  // Bow: sticks + string from spiders.
  if(c('bow')<1){
   if(c('string')<3)return {type:'hunt',entity:'spider',count:6,maxSeconds:120};
   if(c('stick')<3){
    const planks=planksJob(c,ctx,2);if(planks)return planks;
    return {type:'craft',item:'stick',count:3-c('stick')};
   }
   return {type:'craft',item:'bow',count:1};
  }
  // Arrows: flint from gravel, feathers from chickens, sticks - crafted, not hunted.
  if(c('arrow')<ARROWS){
   const need=Math.ceil((ARROWS-c('arrow'))/4);
   if(c('flint')<need)return {type:'gather',block:'gravel',count:64,radius:32,searchIfMissing:true,belowFoots:true};
   if(c('feather')<need)return {type:'hunt',entity:'chicken',count:Math.min(16,need*2),maxSeconds:120};
   if(c('stick')<need){
    const planks=planksJob(c,ctx,4);if(planks)return planks;
    return {type:'craft',item:'stick',count:need-c('stick')};
   }
   return {type:'craft',item:'arrow',count:ARROWS-c('arrow')};
  }
  if(c('stick')<5){
   const planks=planksJob(c,ctx,4);if(planks)return planks;
   return {type:'craft',item:'stick',count:5-c('stick')};
  }
  if(c('iron_pickaxe')<1)return {type:'craft',item:'iron_pickaxe',count:1};
  if(c('iron_sword')<1)return {type:'craft',item:'iron_sword',count:1};
  if(c('iron_axe')<1)return {type:'craft',item:'iron_axe',count:1};
  // COMBAT_SPEC 7a: the full armour set right after the iron gear.
  if(c('iron_helmet')<1)return {type:'craft',item:'iron_helmet',count:1};
  if(c('iron_chestplate')<1)return {type:'craft',item:'iron_chestplate',count:1};
  if(c('iron_leggings')<1)return {type:'craft',item:'iron_leggings',count:1};
  if(c('iron_boots')<1)return {type:'craft',item:'iron_boots',count:1};
  if(c('bucket')+c('water_bucket')<1)return {type:'craft',item:'bucket',count:1};
  if(c('stick')<2){
   const planks=planksJob(c,ctx,2);if(planks)return planks;
   return {type:'craft',item:'stick',count:2-c('stick')};
  }
  if(c('torch')<TORCHES)return {type:'craft',item:'torch',count:TORCHES-c('torch')};
  return null;
 }},
 {name:'bed',done:c=>WOOLS.some(w=>c(w.replace('_wool','_bed'))>=1),next(c,ctx){
  // COMBAT_SPEC 7a: replace worn combat gear before hunting sheep.
  const fix=replacementJob(c,ctx);if(fix)return fix;
  const wool=WOOLS.find(w=>c(w)>=3);
  if(!wool)return ctx.huntPhase?{type:'collect',radius:16}:{type:'fight',entity:'sheep',maxSeconds:30};
  return {type:'craft',item:wool.replace('_wool','_bed'),count:1};
 }},
 {name:'home',done:()=>false,next(c,ctx){
  if(ctx.slotsFull>0.8&&ctx.homeChest)return {type:'deposit',position:ctx.home};
  if(ctx.slotsFull>0.8&&c('chest')>=1&&ctx.chestSpot)return {type:'place',block:'chest',position:ctx.chestSpot};
  if(ctx.slotsFull>0.8)return {type:'craft',item:'chest',count:1};
  return {type:'explore',distance:96};
 }},
 // COMBAT_SPEC 7a: diamond sword, axe and the full armour set, cheapest piece first.
 {name:'diamonds',done:c=>DIAMOND_GEAR.every(([name])=>c(name)>=1),next(c){
  const remaining=DIAMOND_GEAR.filter(([name])=>c(name)<1);
  if(!remaining.length)return null;
  const [item,cost]=remaining[0];
  if(c('diamond')>=cost)return {type:'craft',item,count:1};
  return diamondGather(remaining.reduce((a,[,need])=>a+need,0)-c('diamond'));
 }},
];

// Pure step selection for tests and the tick: first unmet step and its next job. Logs and
// planks are counted across all species; planks are crafted from whichever log is held.
const woodTotals=(counts,ctx)=>{
 ctx.logsTotal=ctx.logsTotal??Object.keys(counts).filter(n=>/_log$/.test(n)).reduce((a,n)=>a+counts[n],0);
 ctx.planksTotal=ctx.planksTotal??Object.keys(counts).filter(n=>/_planks$/.test(n)).reduce((a,n)=>a+counts[n],0);
 ctx.heldLog=ctx.heldLog??(Object.keys(counts).filter(n=>/_log$/.test(n)).sort((a,b)=>counts[b]-counts[a])[0]||null);
 return ctx;
};
// Bed before dusk (soak 2026-10-14: every night was a shelter, no bed). Only when wool is
// cheap: a sheep within 32 and shears (shear: 1-3 wool, the sheep lives) or a sword (hunt:
// one wool each). From BED_PREP_FROM until dusk: wool of one colour, 3 planks from logs
// held, then the bed. Null otherwise - the dusk dirt and the night shelter stay the plan.
// ctx: {tod, bedNear, sheepNear, worldTable} plus the counts' wood totals. The bed is a 3x3
// recipe: without a table held or standing near, the craft makes one first (4 more planks).
export const BED_PREP_FROM=9000,BED_PREP_JOBS=5;
// Habit 5: the home bed is walked back to for the night from this far (a sleep job's walk).
export const HOME_BED_RANGE=64;
// After a low-health stop the ladder waits (up to RECOVER_MS) for the health to come back
// instead of submitting jobs the worker's check() refuses at once - three of those would
// count as three failures and block the step. Natural regen needs a food bar of 18+.
export const RECOVER_MS=60000;
// Extra night jobs per night after the first one failed or was cancelled while still dark.
export const NIGHT_RETRIES=3;
// Sunset grace for affordable stone-kit crafts (ticks after SUNSET; spawns start ~12970).
export const KIT_GRACE=600,KIT_HOSTILE=8;
// Dusk cobble gathers per day, and how long before sunset they stop (the dirt's minute).
export const DUSK_COBBLE_JOBS=3,DUSK_COBBLE_STOP=1200;
// A failed rung bed job (the sheep ran off, no wool) sets the bed aside for this long.
export const BED_OFF_MS=10*60000;
// A failed diamond trip (lava in the way, nothing in the strip) waits this long before the next.
export const DIAMOND_OFF_MS=20*60000;
// Habit 7: after two failed coal digs, coal comes from smelting logs this long.
export const COAL_OFF_MS=10*60000;
// A respawn counts as 'just died' for this long (the death screen plus a slow respawn).
const RESPAWN_FRESH_MS=60000;
export function bedPrepJob(counts,ctx){
 const c=countFactory(counts);
 ctx=woodTotals(counts,{...ctx});
 if(ctx.bedNear||ctx.tod==null||ctx.tod<BED_PREP_FROM||ctx.tod>=SUNSET)return null; // the shelter starts at sunset
 return bedJob(c,{...ctx,needPlanks:true});
}
export function plan(counts,ctx={}){
 const c=countFactory(counts);
 ctx=woodTotals(counts,{...ctx});
 for(const entry of STEPS){
  if(ctx.blocked===entry.name)continue;
  if(entry.done(c,ctx))continue;
  return {step:entry.name,job:entry.next(c,ctx)};
 }
 return {step:null,job:null};
}

export class Autopilot{
 constructor(worker,root){
  this.worker=worker;this.root=root;
  this.enabled=false;this.goal=null;this.state='idle';this.current=null;this.currentStep=null;
  this.failures={};this.lastNightKey=null;this.lastDuskKey=null;this.lastHomeScan=0;this.huntPhase=false;
  this.lastSurfaceY=null; // the stand-Y of the last surface gather (unblock-explore cap)
  this.foodAnchorY=null;  // the food-graze anchor when no surface gather set lastSurfaceY
  this.file=path.join(root,'data/autopilot.json');
  this.home=null;this.homeChest=false;this.homeChestAt=null;
  try{const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));if(saved&&saved.home){this.home=saved.home;this.homeChest=!!saved.homeChest;this.homeChestAt=saved.homeChestAt||null;}}catch{}
 }
 save(){try{fs.writeFileSync(this.file,JSON.stringify({home:this.home,homeChest:this.homeChest,homeChestAt:this.homeChestAt},null,2));}catch{}
 }
  start(goal){
   this.enabled=true;this.goal=goal||null;this.state='starting';this.current=null;this.currentStep=null;
   this.failures={};this.coolUntil=0;this.lastSurfaceY=null;this.foodAnchorY=null;this.huntPhase=false;
   this.lastNightKey=null;this.lastDuskKey=null;
   this.food={mark:mealsEaten(this.worker),legs:0,best:0,offUntil:0,deferred:false};
   this.worker.userStopped=false;this.worker.deathResume=false;
   this.log('Autopilot started'+(this.goal?' (goal: '+this.goal+')':''));this.save();
  }
  stop(){this.worker.cobbleReserve=0;if(this.enabled||this.state!=='idle'){this.enabled=false;this.state='idle';this.current=null;this.coolUntil=0;this.log('Autopilot stopped');this.save();}}
  log(message){this.worker.log(message);}
  status(){return {enabled:this.enabled,state:this.state,step:this.currentStep,goal:this.goal,home:this.home};}
  tick(){
   if(!this.enabled)return;
   const w=this.worker,b=w.bot;
   if(!w.ready||!b){this.state='waiting: not connected';return;}
   if(this.coolUntil&&Date.now()<this.coolUntil){
    // Back off after failures so a step that cannot succeed right now does not storm the
    // queue with one job per second.
    this.state='backing off ('+Math.ceil((this.coolUntil-Date.now())/1000)+'s): '+String(this.currentStep||'retry');
    return;
   }
   // Respawned in the dark: shelter at the spawn point before anything else, even while
   // the death holds the ladder (round 4 hard3 respawned at night and was shot again).
   if(!w.userStopped&&this.respawnNight(b))return;
   // A world threat (drowning, lava, fire, a wall, a fall) owns the bot: submitting the next
   // ladder job meanwhile pulled a drowning bot back into its gather (round 11 normal2:
   // swim-up at 08:22:32, a fresh coal gather a second later, drowned 14 s after).
   const rs=w.taskRunner&&w.taskRunner.status&&w.taskRunner.status();
   if(rs&&/World Survival|MLG/i.test(rs.chain||'')){this.state='waiting: '+rs.chain;return;}
   if(w.deathResume){this.state='paused: died - resume to continue';return;}
  if(w.userStopped){this.enabled=false;this.state='idle';this.current=null;w.cobbleReserve=0;this.log('Autopilot stopped (Stop all)');return;}
  const active=w.jobs.find(j=>['running','queued'].includes(j.status));
  if(active){
   this.state=active.status==='running'?'working: '+active.spec.type:'queued: '+active.spec.type;
   if(this.current&&active.id===this.current.id){
    if(active.status==='paused'&&String(active.message).startsWith('Reflex:'))this.state='reflex handling: '+active.message;
    if(['complete','failed'].includes(active.status))this.settle(active);
   }
   // The food explore must not walk PAST animals (soak 6 normal1/2: the bot wandered
   // 200+ blocks with 0 food while animals could have been behind it): a running food-step
   // explore is cancelled the moment animals come into hunt range, and the next decide()
   // submits the fight. Job-after-job ordering would wait out the whole 64-block leg.
   if(active.status==='running'&&active.spec.type==='explore'&&this.currentStep==='food'&&this.animalsNearby(b)){
    // 'autopilot' source: a user-sourced cancel set userStopped and the next tick switched
    // the ladder off as if Stop all was pressed (soak normal3 idled twice this way).
    try{this.worker.cancel(active.id,'autopilot');this.log('Autopilot: food explore cancelled - animals in range');}
    catch(e){this.state='cancel failed: '+e.message;}
   }
   // Night prep OUTRANKS the ladder's day jobs (first-night milestone): the night branch
   // used to sit behind this active-job return, and a continuously busy ladder never
   // reached it - soak 6's hard runs tanked the whole night with no shelter attempt.
   // A running fight/eat or night job is never cut off: the idle branch below submits the
   // night job the moment it settles (the key is only spent when the job goes out).
   // The shelter goes up at SUNSET (12000), before the first spawns; a bed waits for 12541.
   // A running craft takes seconds and is never cut (round 4: the kit stopped at sunset).
   // A queued craft is a kit craft about to start (seconds): the shelter waits for it too,
   // or the survival pump would run the shelter first and the kit never.
   const busy=(active.status==='running'&&['fight','eat','sleep','shelter','craft'].includes(active.spec?.type))||(active.status==='queued'&&active.spec?.type==='craft');
   const nightJob=!busy&&nightJobFor(dayTicks(b),this.bedForNight(b));
   // Round 5 hard1: a bed-prep sheep hunt ran into sunset, this branch sent the shelter
   // straight away and the grace kit (idle branch only) never ran - no furnace, 19 cobble.
   const kit=active.status==='running'&&nightJob&&nightJob.type==='shelter'&&this.lastNightKey!==String(b.time?.day)&&this.sunsetKit(b,dayTicks(b)??0);
   if(kit){
    try{this.worker.cancel(active.id,'autopilot');}catch(e){this.state='cancel failed: '+e.message;return;}
    this.log('Autopilot: sunset - finishing the stone kit first ('+kit.item+')');this.submit('stone',kit);
    return;
   }
   const night=nightJob&&this.nightKeyFree(b)&&nightJob;
   if(night){
    this.lastNightKey=String(b.time?.day); // once per day even if the submit loses the race
    if(active.status==='running'){try{this.worker.cancel(active.id,'autopilot');}catch(e){this.state='cancel failed: '+e.message;return;}}
    this.submit('night',this.nightSpec(b,night));
    return;
   }
   return;
  }
  if(this.current)this.settle(w.jobs.find(j=>j.id===this.current.id)||{status:'complete',id:this.current.id});
  this.publishReserve(b);
  if(!shelterDue(dayTicks(b))&&this.recovering(b))return; // the night job (shelter or sleep) still goes out
  this.rememberHome(b);
  // Dusk prep: without a bed the night shelter needs 25 dirt/cobble in the inventory, so
  // gather the dirt while there is still daylight (once per day). Grass blocks drop dirt.
  const bedNear=b.inventory.items().some(i=>BED.test(i.name))||b.findBlock({matching:Object.values(b.registry.blocksByName).filter(bl=>BED.test(bl.name)).map(bl=>bl.id),maxDistance:16});
  const todNow=dayTicks(b)??0;
  // Bed before dusk when wool is cheap (bedPrepJob); a failed prep job ends it for the day.
  const day=String(b.time?.day);
  if(this.bedPrep?.day!==day)this.bedPrep={day,jobs:0,off:false};
  // A kit craft affordable right now outranks the bed prep (both are dusk work; the craft
  // takes seconds and the furnace is what a hard night ends up missing).
  if(todNow>=BED_PREP_FROM&&todNow<SUNSET){
   const kit=this.sunsetKit(b,todNow,true);
   if(kit){this.log('Autopilot: dusk - finishing the stone kit first ('+kit.item+')');this.submit('stone',kit);return;}
  }
  if(!this.bedPrep.off&&this.bedPrep.jobs<BED_PREP_JOBS){
   const worldTable=!!b.findBlock({matching:b.registry.blocksByName.crafting_table?.id,maxDistance:4});
   const job=bedPrepJob(this.counts(),{tod:dayTicks(b),bedNear:!!bedNear,sheepNear:this.sheepNear(b),worldTable});
   if(job){this.bedPrep.jobs++;this.submit('bed-prep',job);return;}
  }
  // The kit piece's cobble before the shelter dirt (duskCobbleJob), up to DUSK_COBBLE_JOBS
  // per day and not in the last minute before sunset; a failed one ends it for the day.
  if(todNow>=BED_PREP_FROM&&todNow<SUNSET-DUSK_COBBLE_STOP&&!bedNear&&this.hostileDistance(b)>KIT_HOSTILE){
   if(this.duskCobble?.day!==day)this.duskCobble={day,jobs:0,off:false};
   const worldFurnace=!!b.findBlock({matching:b.registry.blocksByName.furnace?.id,maxDistance:16});
   const job=!this.duskCobble.off&&this.duskCobble.jobs<DUSK_COBBLE_JOBS&&duskCobbleJob(this.counts(),{worldFurnace});
   if(job){this.duskCobble.jobs++;this.log('Autopilot: dusk - cobble for the stone kit first ('+job.count+')');this.submit('dusk-cobble',job);return;}
  }
  const dusk=todNow>=DUSK_PREP&&todNow<SUNSET; // the dirt must be in hand when the shelter starts
  if(dusk&&this.lastDuskKey!==String(b.time.day)&&!bedNear&&b.inventory.items().some(i=>/_pickaxe$/.test(i.name))){
   const dirt=b.inventory.items().filter(i=>i.name==='dirt'||i.name==='cobblestone').reduce((a,i)=>a+i.count,0)-(this.worker.cobbleReserve||0);
   if(dirt<25){
    this.lastDuskKey=String(b.time.day);
    this.submit('dusk-dirt',{type:'gather',block:'grass_block',count:25,radius:32});
    return;
   }
  }
  const nightJob=nightJobFor(todNow,this.bedForNight(b));
  // Sunset grace (KIT_GRACE ticks, ~30 s, still before the first spawns): finish any stone-kit
  // craft that is affordable right now before sealing in for the night.
  if(nightJob&&nightJob.type==='shelter'&&this.lastNightKey!==String(b.time?.day)){
   const kit=this.sunsetKit(b,todNow);
   if(kit){this.log('Autopilot: sunset - finishing the stone kit first ('+kit.item+')');this.submit('stone',kit);return;}
  }
  const night=nightJob&&this.nightKeyFree(b)&&nightJob;
  if(night){
   this.lastNightKey=String(b.time.day);
   this.submit('night',this.nightSpec(b,night));return;
  }
  // Every shelter tonight failed: no day work in the dark (gathers and explores walk into the
  // spawns); stand and let Mob Defense answer (pillar, fight, flee) until morning.
  if(nightJob&&nightJob.type==='shelter'&&this.nightJob&&this.nightJob.day===String(b.time.day)&&this.nightJob.retries>=NIGHT_RETRIES){
   this.state='night: no shelter; holding for morning';return;
  }
  this.decide(b);
 }
 // The kit craft for the sunset grace (KIT_GRACE ticks after SUNSET, before the first spawns)
 // or, with dusk=true, for the dusk window: affordable now and no hostile within 8 (a craft
 // takes seconds; Mob Defense still answers anything that closes in).
 sunsetKit(b,tod,dusk=false){
  if(!dusk&&!(tod>=SUNSET&&tod<SUNSET+KIT_GRACE))return null;
  if(this.hostileDistance(b)<=KIT_HOSTILE)return null;
  if((this.failures.stone||0)>=2)return null; // a craft that keeps failing must not storm the dusk
  if(this.current&&this.current.step==='stone'&&this.worker.jobs.some(j=>j.id===this.current.id&&['queued','running'].includes(j.status)))return null;
  const left=this.leftTable(b);
  return duskKitJob(this.counts(),{worldTable:!!left&&left.distance<=32,worldFurnace:!!b.findBlock({matching:b.registry.blocksByName.furnace?.id,maxDistance:16})});
 }
 // The cobble the unfinished stone kit still costs: the shelter builds with dirt first and
 // leaves this much cobble alone (round 4 hard runs: the box took the furnace's cobble).
 publishReserve(b){
  try{
   const counts=this.counts(),c=countFactory(counts);
   const worldFurnace=!!b.findBlock({matching:b.registry.blocksByName.furnace?.id,maxDistance:16});
   this.worker.cobbleReserve=STEPS[1].done(c,{worldFurnace})?0:Math.min(c('cobblestone'),kitCobbleNeed(c,{worldFurnace}));
  }catch{this.worker.cobbleReserve=0;}
 }
 bedNear(b){return b.inventory.items().some(i=>BED.test(i.name))||!!b.findBlock({matching:Object.values(b.registry.blocksByName).filter(bl=>BED.test(bl.name)).map(bl=>bl.id),maxDistance:16});}
 // Tonight's night job: a bed held or standing near means sleep (round 8: preferred to the
 // shelter), unless a sleep already failed tonight - then the shelter (sleepFailedTonight).
 bedForNight(b){return (this.bedNear(b)||!!this.homeBed(b))&&!this.sleepFailedTonight(b);}
 // Habit 5: the home bed (the spawn point), standing within HOME_BED_RANGE and loaded.
 homeBed(b){
  const h=this.home,me=b&&b.entity&&b.entity.position;
  if(!h||!me)return null;
  const block=b.blockAt(new Vec3(h.x,h.y,h.z));
  if(!block||!BED.test(block.name||''))return null;
  const distance=me.distanceTo(new Vec3(h.x+0.5,h.y,h.z+0.5));
  return distance<=HOME_BED_RANGE?{position:{x:h.x,y:h.y,z:h.z},distance}:null;
 }
 // The night's sleep goes to the home bed when it is beyond the sleep job's own 16-block scan
 // and no other bed is near or held (that one would be closer to hand).
 nightSpec(b,job){
  if(!job||job.type!=='sleep'||job.position)return job;
  const home=this.homeBed(b);
  return home&&home.distance>12&&!this.bedNear(b)?{...job,position:home.position}:job;
 }
 sleepFailedTonight(b){
  const n=this.nightJob;
  if(!n||n.day!==String(b.time?.day))return false;
  const job=this.worker.jobs.find(j=>j.id===n.id);
  return !!job&&job.spec?.type==='sleep'&&['failed','cancelled'].includes(job.status);
 }
 // One night job per day, plus up to NIGHT_RETRIES more when the night job failed while
 // it is still dark (an unsealable spot, a lost race) - caught outside is the deadly case.
 nightKeyFree(b){
  const day=String(b.time?.day);
  if(this.lastNightKey!==day)return true;
  const job=this.nightJob&&this.worker.jobs.find(j=>j.id===this.nightJob.id);
  if(!job||!['failed','cancelled'].includes(job.status)||!shelterDue(dayTicks(b)))return false;
  if(this.nightJob.day!==day){this.nightJob.day=day;this.nightJob.retries=0;}
  // Short of blocks (worker.shelterFallback): a retry digs the same empty ground again and,
  // queued, gates off the night pillar that took over. Hold for morning instead.
  if(this.worker.nightPillarWanted?.(b)){
   if(this.nightJob.retries<NIGHT_RETRIES)this.log('Autopilot: the night job '+job.status+' ('+String(job.message).slice(0,80)+'); night pillar until morning');
   this.nightJob.retries=NIGHT_RETRIES;return false;
  }
  if(this.nightJob.retries>=NIGHT_RETRIES)return false;
  this.nightJob.retries++;
  this.log('Autopilot: the night job '+job.status+' ('+String(job.message).slice(0,80)+'); sheltering again');
  return true;
 }
 respawnNight(b){
  const w=this.worker,death=w.lastDeath;
  if(!death||this.respawnHandled===death.t||!(b.health>0)||Date.now()-death.t>RESPAWN_FRESH_MS)return false;
  this.respawnHandled=death.t;
  const tod=dayTicks(b);
  if(!shelterDue(tod))return false;
  if(w.jobs.some(j=>['running','queued'].includes(j.status)&&['shelter','sleep'].includes(j.spec?.type)))return false;
  const job=nightJobFor(tod,this.bedForNight(b))||{type:'shelter'};
  this.lastNightKey=String(b.time?.day);
  this.log('Autopilot: respawned at night; '+job.type+' at the spawn point first');
  this.submit('night',job,{keepHolds:true});
  return true;
 }
 recovering(b){
  const min=this.worker.config?.limits?.minHealth??10;
  if(!(b.health<min)){this.lowSince=0;this.recoverAte=false;return false;}
  if(!this.lowSince)this.lowSince=Date.now();
  if(Date.now()-this.lowSince>=RECOVER_MS)return false;
  if(b.food<18&&!this.recoverAte&&this.counts()._edible>0){this.recoverAte=true;this.submit('recover',{type:'eat'});return true;}
  this.state='recovering: health '+Math.round(b.health);
  return true;
 }
 settle(job){
  if(!this.current)return;
  if(job&&job.status==='failed'){
   const step=this.current.step;
   this.failures[step]=(this.failures[step]||0)+1;
   this.coolUntil=Date.now()+8000; // give the world (and reflexes) time before retrying
   if(step==='bed-prep'&&this.bedPrep)this.bedPrep.off=true; // shelter tonight
   if(step==='dusk-cobble'&&this.duskCobble)this.duskCobble.off=true; // the dirt now
   if(step==='bed-rung')this.bedOffUntil=Date.now()+BED_OFF_MS; // the ladder moves on
   if(step==='diamond-rung')this.diamondOffUntil=Date.now()+DIAMOND_OFF_MS;
   if(step==='inventory')this.invOffUntil=Date.now()+INV_OFF_MS; // a full chest, no spot: later
   if(step==='farm')this.farmOffUntil=Date.now()+FARM_OFF_MS;
   // A water source the bucket could not fill from (out of reach on a cliff, ray blocked) is
   // skipped for 10 min, so the next try picks another source (round 11: the same out-of-reach
   // source was retried 3 jobs in a row).
   if(job.spec?.type==='use'&&job.spec.item==='bucket'&&job.spec.position){const q=job.spec.position;(this.badWater||(this.badWater=new Map())).set(q.x+','+q.y+','+q.z,Date.now()+600000);}
   // Habit 7: a coal dig that failed twice: charcoal from logs for COAL_OFF_MS instead.
   if(this.current.spec?.type==='gather'&&this.current.spec.block==='coal_ore'&&(this.coalFails=(this.coalFails||0)+1)>=2){this.coalFails=0;this.coalOffUntil=Date.now()+COAL_OFF_MS;this.log('Autopilot: no coal found twice; charcoal from logs for '+COAL_OFF_MS/60000+' min');}
   // Round 9: a food step that failed 3 times is set aside, not blocked - the blocked
   // state's explore-and-retry looped [food] for the rest of round-8 normal1.
   if(step==='food'&&this.failures.food>=3){this.failures.food=0;this.deferFood('failed 3 times');}
   // Only ladder steps block (and explore to unblock): a night job that keeps failing must
   // never turn into an explore in the dark - nightKeyFree caps its retries instead.
   else if(this.failures[step]>=3&&STEPS.some(st=>st.name===step)){this.state='blocked: '+step+' (exploring elsewhere)';this.log('Autopilot: '+step+' failed '+this.failures[step]+' times; exploring before retry');}
   else this.state='retry: '+step+' ('+this.failures[step]+'/3)';
  }else{
   if(this.current.spec?.type==='gather'&&this.current.spec.block==='coal_ore')this.coalFails=0;
   // Round 11: the inventory step's placed chest is the home chest (and home, when none is set).
   const sp=this.current.spec;
   if(this.current.step==='inventory'&&sp?.type==='place'&&sp.block==='chest'&&sp.position){
    this.homeChestAt={x:sp.position.x,y:sp.position.y,z:sp.position.z};this.homeChest=true;
    if(!this.home)this.home={...this.homeChestAt};
    this.save();this.log('Autopilot: home chest placed at '+sp.position.x+','+sp.position.y+','+sp.position.z);
   }
   // Round 13: the same item dropped twice inside DROP_LOOP_MS means the junk keeps coming back
   // (picked up again, or mined again as fast as it goes): set the inventory step aside.
   if(this.current.step==='inventory'&&sp?.type==='drop'){
    const now=Date.now(),last=(this.recentDrops||(this.recentDrops=new Map())).get(sp.item);this.recentDrops.set(sp.item,now);
    if(last&&now-last<DROP_LOOP_MS){this.recentDrops.clear();this.invOffUntil=now+INV_OFF_MS;this.log('Autopilot: '+sp.item+' dropped twice in '+DROP_LOOP_MS/60000+' min; inventory step set aside for '+INV_OFF_MS/60000+' min');}
   }
   this.failures[this.currentStep]=0;
   this.coolUntil=0;
   this.state='step done: '+this.currentStep;
  }
  this.current=null;this.currentStep=null;
 }
 counts(){
  const map={};
  const registry=this.worker.bot.registry;
  // Round 8: worn armour (slots 5-8) and the off hand (45) are held too - inventory.items()
  // skips them, so an equipped chestplate or shield read as missing and was crafted again.
  const slots=this.worker.bot.inventory.slots||[];
  const worn=[5,6,7,8,45].map(i=>slots[i]).filter(Boolean);
  for(const item of worn)map['_equipped_'+item.name]=(map['_equipped_'+item.name]||0)+1;
  for(const item of [...this.worker.bot.inventory.items(),...worn]){
   map[item.name]=(map[item.name]||0)+item.count;
   // COMBAT_SPEC 7a: mark nearly-broken gear so the ladder can craft a replacement
   // before it breaks mid-fight (repair-by-replacement).
   if(GEAR.test(item.name)){
    const max=registry.itemsByName?.[item.name]?.maxDurability,used=item.durabilityUsed||0;
    if(max&&1-used/max<=WORN_LIMIT)map['_worn_'+item.name]=(map['_worn_'+item.name]||0)+1;
   }
  }
  map._edible=Object.keys(map).filter(n=>registry.foodsByName[n]&&!EDIBLE_SKIP.has(n)).reduce((a,n)=>a+map[n],0);
  map._wool_total=Object.keys(map).filter(n=>/_wool$/.test(n)).reduce((a,n)=>a+map[n],0);
  map._eaten=Math.max(0,mealsEaten(this.worker)-(this.food?.mark||0)); // meals since start()
  return map;
 }
 // The food step's legs and its deferral (FOOD_LEGS, FOOD_OFF_MS). Progress is a new high of
 // edible held + eaten this run; FOOD_LEGS food jobs without one set the step aside.
 foodTrack(counts,job){
  const f=this.food||(this.food={mark:mealsEaten(this.worker),legs:0,best:0,offUntil:0,deferred:false});
  const got=(counts._edible||0)+(counts._eaten||0);
  if(got>f.best){f.best=got;f.legs=0;}
  if(job&&job.type==='explore'&&++f.legs>=FOOD_LEGS){this.deferFood(f.legs+' explore legs without food');return true;}
  return false;
 }
 deferFood(why){
  const f=this.food||(this.food={mark:mealsEaten(this.worker),legs:0,best:0,offUntil:0,deferred:false});
  f.offUntil=Date.now()+FOOD_OFF_MS;f.deferred=true;f.legs=0;
  this.state='food deferred: '+why;
  this.log('Autopilot: food step set aside for '+FOOD_OFF_MS/60000+' min ('+why+'); moving on, back to food when hungry with none held');
 }
 rememberHome(b){
  const now=Date.now();
  if(now-this.lastHomeScan<15000)return;
  this.lastHomeScan=now;
  if(this.home&&this.homeChest&&this.homeChestAt)return;
  const registry=b.registry;
  if(!this.home){
   const bed=b.findBlock({matching:Object.values(b.registry.blocksByName).filter(bl=>BED.test(bl.name)).map(bl=>bl.id),maxDistance:16});
   if(bed){this.home={x:bed.position.x,y:bed.position.y,z:bed.position.z};this.save();this.log('Autopilot: home set to the bed at '+bed.position.floored());}
   // Habit 6: no bed yet - the first table the bot left standing is the base (a bed found
   // later does not move it; the first bed slept in sets home only when none is set).
   else{const t=this.worker.leftTable;if(t){this.home={x:t.x,y:t.y,z:t.z};this.save();this.log('Autopilot: home set to the table at '+t.x+','+t.y+','+t.z);}}
  }
  if(this.home&&!this.homeChest){
   const id=b.registry.blocksByName.chest?.id;
   const h=this.home,near=b.entity?.position&&b.entity.position.distanceTo(new Vec3(h.x,h.y,h.z))<=16;
   const chest=near&&id!=null&&b.findBlock({matching:[id],maxDistance:16});
   if(chest){this.homeChest=true;this.homeChestAt={x:chest.position.x,y:chest.position.y,z:chest.position.z};this.save();this.log('Autopilot: home chest found at '+chest.position.floored());}
  }
 }
 hostileDistance(b){
  let best=Infinity;
  const me=b.entity&&b.entity.position;
  if(!me)return best;
  for(const e of Object.values(b.entities||{})){
   if(!e||e===b.entity||e.type!=='hostile'||!e.position)continue;
   const d=e.position.distanceTo(me);
   if(d<best)best=d;
  }
  return best;
 }
 // The nearest sheep within SHEEP_FAR beyond the hunt's reach: its offset from the bot.
 sheepFar(b){
  const me=b.entity?.position;if(!me)return null;
  let best=null;
  for(const e of Object.values(b.entities||{})){
   if(!e||e===b.entity||e.name!=='sheep'||!e.position)continue;
   const d=e.position.distanceTo(me);
   if(d>WOOL_NEAR&&d<=SHEEP_FAR&&(!best||d<best.d))best={d,dx:e.position.x-me.x,dz:e.position.z-me.z};
  }
  return best&&{dx:Math.round(best.dx),dz:Math.round(best.dz),distance:Math.round(best.d)};
 }
 sheepNear(b,radius=WOOL_NEAR){
  let n=0;
  for(const e of Object.values(b.entities||{}))if(e&&e!==b.entity&&e.name==='sheep'&&e.position&&b.entity?.position&&e.position.distanceTo(b.entity.position)<=radius)n++;
  return n;
 }
 animalsNearby(b){
  const counts={};
  for(const e of Object.values(b.entities)){
   if(e===b.entity||!e.position)continue;
   if(['cow','pig','sheep','chicken'].includes(e.name)&&e.position.distanceTo(b.entity.position)<=48)counts[e.name]=(counts[e.name]||0)+1;
  }
  const best=Object.keys(counts).sort((a,c)=>counts[c]-counts[a])[0];
  if(!best)return null;
  const close=Object.values(b.entities).filter(e=>e!==b.entity&&e.name===best&&e.position&&e.position.distanceTo(b.entity.position)<=WOOL_NEAR).length;
  return {type:best,near:counts[best],close};
 }
 chestSpotNear(b){
  const origin=b.entity.position.floored();
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[2,0],[-2,0],[0,2],[0,-2]]){
   const point=origin.offset(dx,0,dz);
   const top=b.blockAt(point),ground=b.blockAt(point.offset(0,-1,0));
   if(top?.boundingBox==='empty'&&!/water|lava/.test(top.name||'')&&ground?.boundingBox==='block')return {x:point.x,y:point.y,z:point.z};
  }
  return null;
 }
 // The table a keepTable craft left standing (worker.leftTable). It counts as the wood step's
 // table while it stands within 32, so a reflex flee or a night shelter mid-kit no longer
 // regresses the ladder into crafting (and abandoning) a second table.
 leftTable(b){
  const t=this.worker.leftTable;
  if(!t||!b.entity||!b.entity.position)return null;
  const block=b.blockAt(new Vec3(t.x,t.y,t.z));
  if(!block)return null; // unloaded: keep the memory, but it is not usable from here
  if(block.name!=='crafting_table'){this.worker.leftTable=null;return null;} // picked up or broken
  return {position:{x:t.x,y:t.y,z:t.z},distance:b.entity.position.distanceTo(new Vec3(t.x+0.5,t.y,t.z+0.5))};
 }
 // While a left furnace works: a side job near it, the take job when the batch is ready (or
 // dusk, a hostile, the leash), else wait. True when the furnace owns this tick.
 furnaceTick(b,counts){
  const run=this.worker.furnaceRun;
  if(!run)return false;
  if(this.furnace?.key!==run.started)this.furnace={key:run.started,side:0,takes:0};
  const me=b.entity&&b.entity.position;
  const furnaceDistance=me?me.distanceTo(new Vec3(run.x+0.5,run.y,run.z+0.5)):0;
  const meat=COOKABLE_MEAT.some(m=>counts[m]>=1);
  const job=furnaceWork(run,counts,{now:Date.now(),tod:dayTicks(b),hostileDistance:this.hostileDistance(b),furnaceDistance,sideJobs:this.furnace.side,
   coalNear:this.oreNear(b,['coal_ore','deepslate_coal_ore'],FURNACE_WORK_RADIUS),ironNear:this.oreNear(b,['iron_ore','deepslate_iron_ore'],FURNACE_WORK_RADIUS),
   logNear:this.oreNear(b,Object.keys(b.registry.blocksByName||{}).filter(n=>/_log$/.test(n)),FURNACE_WORK_RADIUS),
   dropsNear:Object.values(b.entities||{}).some(e=>e&&e.name==='item'&&e.position&&me&&e.position.distanceTo(me)<=FURNACE_WORK_RADIUS),
   moreCooking:meat||(this.animalsNearby(b)&&this.currentStep==='food')});
  if(!job){this.state='furnace: working ('+Math.max(0,Math.ceil((run.readyAt-Date.now())/1000))+' s left)';return true;}
  if(job.take){
   // Round 11: two takes that did not clear the run no longer drop it (normal2 then placed a
   // new furnace three times with the batch still in the old one): the ladder goes on and the
   // next smelt job walks back and collects it first (worker.smelt).
   if(this.furnace.takes>=2){
    if(!this.furnace.parked){this.furnace.parked=true;this.log('Autopilot: two takes at the furnace '+run.x+','+run.y+','+run.z+' did not collect it; the next smelt collects it first');}
    return false;
   }
   this.furnace.takes++;
  }else this.furnace.side++;
  this.submit('furnace',job);
  return true;
 }
 decide(b){
  const counts=this.counts();
  if(this.furnaceTick(b,counts))return;
  const animals=this.animalsNearby(b);
  const items=b.inventory.items().length;
  const left=this.leftTable(b);
  const worldTable=!!b.findBlock({matching:b.registry.blocksByName.crafting_table?.id,maxDistance:8})||!!(left&&left.distance<=32);
  const worldFurnace=!!b.findBlock({matching:b.registry.blocksByName.furnace?.id,maxDistance:16});
  const standY=b.entity&&b.entity.position?Math.floor(b.entity.position.y):null;
  const ctx={slotsFull:items/36,animalsNearby:animals?animals.type:null,animalsClose:animals?animals.close:0,huntPhase:this.huntPhase,homeChest:this.homeChest,home:this.home,chestSpot:this.home?this.chestSpotNear(b):null,hostileDistance:this.hostileDistance(b),worldTable,worldFurnace,grazeDirection:grazeDirection(b),standY,lastSurfaceY:this.lastSurfaceY??this.foodAnchorY,
   // Round 8 rung: coal in reach, the bed's wool, the last equip (no equip loops).
   coalNear:this.oreNear(b,['coal_ore','deepslate_coal_ore'],32),waterAt:this.waterSource(b),sheepNear:this.sheepNear(b),bedNear:this.bedNear(b),lastEquip:this.lastEquip||null,coalOff:Date.now()<(this.coalOffUntil||0),bedOff:Date.now()<(this.bedOffUntil||0),bedSearch:(this.bedSearch?.legs||0)<BED_SEARCH_LEGS,sheepFar:this.sheepFar(b),searchDistance:BED_SEARCH_DIST[Math.min(this.bedSearch?.legs||0,BED_SEARCH_DIST.length-1)],diamondOff:Date.now()<(this.diamondOffUntil||0),
   breedable:this.breedable(b,counts),hayNear:this.hayNear(b),
   foodBar:typeof b.food==='number'?b.food:null,foodOff:Date.now()<(this.food?.offUntil||0),foodDeferred:!!this.food?.deferred};
  const choice=plan(counts,{...ctx,blocked:this.state.startsWith('blocked: ')?this.state.slice(9).split(' ')[0]:null});
  if(!choice.step){this.state='all steps satisfied';return;}
  // A batch for the furnace: load it and move on (efficiency 1).
  if(choice.job&&choice.job.type==='smelt'&&!choice.job.take&&choice.job.count>=SMELT_LEAVE_AT&&!this.worker.furnaceRun)choice.job={...choice.job,leave:true};
  // While ANY step is blocked the ladder must not run later steps' jobs on top of the gap
  // (a stone-step craft with no planks only burns failures); explore, then UNBLOCK and
  // retry the step from the new position. The unblock is the whole point of the explore -
  // without it the step stayed blocked forever and the ladder explored in circles
  // (measured: soak 20261012-020850, 13+ 'No path' failures, wood never retried).
  if(this.state.startsWith('blocked: ')){
   const step=this.state.slice(9).split(' ')[0];
   this.currentStep=step;
   // Wood only: the stand-Y cap. Stone gathers sit in a pit 20-40 below the grove; applying
   // the wood surfaceY there makes every path fail "left the surface" and the step retries
   // in place forever (soak 20261014-0239 normal3, 3 min backing off at y=86).
   const surface=(step==='wood'&&this.lastSurfaceY!=null)?{surface:true,surfaceY:this.lastSurfaceY}:{};
   this.submit(step,{type:'explore',direction:'random',distance:step==='wood'?48:64,...surface});
   this.failures[step]=0;
   this.state='retry: '+step; // unblocked: the explore was the cooldown
   return;
  }
  // Habit 6: surplus into the home chest (or junk dropped far from home) before more gathering.
  if(Date.now()>=(this.invOffUntil||0)){
   const inv=inventoryJob(counts,{...ctx,slotsFull:this.worker.slotsFull?this.worker.slotsFull():ctx.slotsFull,...this.homeCtx(b)});
   if(inv&&!(inv.type==='craft'&&choice.job?.type==='craft')){this.submit('inventory',inv);return;}
  }
  // Habit 7: light. Torches from held coal and sticks; a lit base.
  if(choice.step!=='wood'&&!QUICK_JOBS.has(choice.job?.type)){
   const torch=torchJob(counts,ctx);
   if(torch&&!(choice.job?.type==='craft'&&choice.job.item==='torch')){this.submit('light',torch);return;}
   const lamp=this.homeLightJob(b,counts);
   if(lamp){this.submit('light',lamp);return;}
  }
  // Habit 11: tend the wheat patch while at home.
  if(choice.step!=='wood'&&!QUICK_JOBS.has(choice.job?.type)){
   const farm=farmJob(counts,{...ctx,tod:dayTicks(b),farm:this.farmScan(b),farmOff:Date.now()<(this.farmOffUntil||0)});
   if(farm){this.submit('farm',farm);return;}
  }
  // Wool by day whatever the step (bug B): the wood kit's sword is enough for a sheep. A
  // quick local job (a craft, an equip, a smelt, a meal) goes first: it takes seconds.
  if(choice.step!=='wood'&&!QUICK_JOBS.has(choice.job?.type)){
   const wool=woolJob(counts,{...ctx,tod:dayTicks(b)});
   if(wool){this.submit('bed-rung',wool);return;}
  }
  // Pickups in arm's reach between jobs (efficiency 3), unless the step's own job is that gather.
  if(choice.step!=='wood'&&!QUICK_JOBS.has(choice.job?.type)){
   const exposed=this.exposedNear(b);
   const pick=exposed&&pickupJob(counts,{...ctx,tod:dayTicks(b),exposed,sinceLast:this.lastPickup?Date.now()-this.lastPickup:null});
   if(pick&&!(choice.job?.type==='gather'&&choice.job.block===pick.block)){this.lastPickup=Date.now();this.submit('pickup',pick);return;}
  }
  // Habit 10: heal before a deep dig.
  {
   const hurt=b.health<RISKY_HEALTH&&riskyJob(choice.job);
   if(!hurt)this.heal=null;
   else{
    if(!this.heal)this.heal={since:Date.now(),ate:false};
    const h=healFirst({job:choice.job,health:b.health,food:b.food,edible:counts._edible||0,since:this.heal.since,ate:this.heal.ate});
    if(h==='wait'){this.state='healing before '+choice.step+' (health '+Math.round(b.health)+')';return;}
    if(h){this.heal.ate=true;this.submit('heal',h);return;}
   }
  }
  if(choice.step==='food'&&this.foodTrack(counts,choice.job))return; // set aside: next tick moves on
  if(choice.step==='food'&&choice.job?.type==='explore'&&this.lastSurfaceY==null&&this.foodAnchorY==null)this.foodAnchorY=standY;
  // A food-step explore is a survival trip: it must run with the bar low (worker.check refuses
  // other jobs below minFood, so round 11 normal1 starved in a 'Health or food is low' loop).
  if(choice.step==='food'&&choice.job?.type==='explore')choice.job={...choice.job,forFood:true};
  if(choice.step==='food'||choice.step==='bed')this.huntPhase=!this.huntPhase;
  this.currentStep=choice.step;
  if(!choice.job){this.state=choice.step+': satisfied';return;}
  // A step-kit craft with its table standing out of the craft's 6-block reach: walk back to
  // it rather than craft and place a second one (4 planks, and the first is abandoned).
  // Two trips that do not get the bot near it forget the table.
  const tableCraft=choice.job.type==='craft'&&(choice.job.keepTable||choice.job.collectTable);
  if(tableCraft&&left&&left.distance>5&&left.distance<=32&&!b.findBlock({matching:b.registry.blocksByName.crafting_table?.id,maxDistance:6})){
   const key=left.position.x+','+left.position.y+','+left.position.z;
   this.tableTrips=this.tableTrips&&this.tableTrips.key===key?this.tableTrips:{key,n:0};
   if(++this.tableTrips.n<=2){this.submit(choice.step,{type:'goto',position:left.position});return;}
   this.worker.leftTable=null;
  }else if(left&&left.distance<=5)this.tableTrips=null; // reached: the trips worked
  // The iron rung's bed jobs run under their own name: a sheep that runs off must not count
  // toward blocking the iron step (a failure sets the bed aside for BED_OFF_MS instead).
  if(choice.job.type==='breed')(this.bredAt||(this.bredAt={}))[choice.job.entity]=Date.now();
  if(choice.step==='iron'&&isBedJob(choice.job)){this.submit('bed-rung',choice.job);return;}
  // The rung's only explore is the bed's sheep search: BED_SEARCH_LEGS of them, then the bed
  // is set aside for BED_OFF_MS (and the legs start over after that).
  if(choice.step==='iron'&&choice.job.type==='explore'){
   const s=this.bedSearch||(this.bedSearch={legs:0});
   if(++s.legs>=BED_SEARCH_LEGS){s.legs=0;this.bedOffUntil=Date.now()+BED_OFF_MS;this.log('Autopilot: no sheep after '+BED_SEARCH_LEGS+' search legs; bed set aside for '+BED_OFF_MS/60000+' min');}
   this.submit('bed-rung',choice.job);return;
  }
  if(choice.step==='iron'&&isDiamondJob(choice.job)){this.submit('diamond-rung',choice.job);return;}
  if(choice.job.type==='equip')this.lastEquip=armourToWear(counts);
  this.submit(choice.step,choice.job);
 }
 // Habit 7: TORCHES_HOME torches on the ground beside the home bed while the bot is there.
 homeLightJob(b,counts){
  const h=this.home,me=b.entity&&b.entity.position;
  if(!h||!me||(counts.torch||0)<4||me.distanceTo(new Vec3(h.x+0.5,h.y,h.z+0.5))>6)return null;
  const key=h.x+','+h.y+','+h.z;
  if(!this.homeLit||this.homeLit.key!==key)this.homeLit={key,n:0,tries:0};
  if(this.homeLit.n>=TORCHES_HOME||this.homeLit.tries>=TORCHES_HOME+2)return null;
  const home=b.blockAt(new Vec3(h.x,h.y,h.z));
  if(!home||!BED.test(home.name||''))return null;
  let lit=0;
  for(const [dx,dz] of [[2,0],[-2,0],[0,2],[0,-2],[2,2],[-2,-2],[2,-2],[-2,2]]){
   const p=new Vec3(h.x+dx,h.y,h.z+dz),top=b.blockAt(p),ground=b.blockAt(p.offset(0,-1,0));
   if(top&&/torch/.test(top.name||'')){lit++;continue;}
   if(lit>=TORCHES_HOME)break;
   if(top&&top.boundingBox==='empty'&&top.name!=='water'&&ground?.boundingBox==='block'&&!(this.homeLit.bad||[]).includes(p.x+','+p.z)){
    this.homeLit.tries++;(this.homeLit.bad||(this.homeLit.bad=[])).push(p.x+','+p.z);
    return {type:'place',block:'torch',position:{x:p.x,y:p.y,z:p.z}};
   }
  }
  this.homeLit.n=lit;
  return null;
 }
 // Home distances and the chest's spot for inventoryJob. A remembered chest that is gone
 // (broken, or the soak reset the world) is forgotten when its cell is loaded and not a chest.
 homeCtx(b){
  const me=b.entity&&b.entity.position,h=this.home;
  if(!me)return {};
  if(!h)return {chestSpotHere:this.chestSpotNear(b)};
  const out={homeDistance:me.distanceTo(new Vec3(h.x+0.5,h.y,h.z+0.5)),chestSpotHere:this.chestSpotNear(b)};
  const at=this.homeChestAt;
  if(at){
   const block=b.blockAt(new Vec3(at.x,at.y,at.z));
   if(block&&!/chest|barrel/.test(block.name||'')){this.homeChestAt=null;this.homeChest=false;this.save();}
   else{out.chestAt=at;out.chestDistance=me.distanceTo(new Vec3(at.x+0.5,at.y,at.z+0.5));}
  }
  if(!this.homeChestAt)out.chestSpot=this.chestSpotNearHome(b);
  return out;
 }
 // An empty cell with solid ground beside the home block (a chest goes next to the bed/table).
 chestSpotNearHome(b){
  const h=this.home;if(!h)return null;
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1],[2,0],[-2,0],[0,2],[0,-2]]){
   const p=new Vec3(h.x+dx,h.y,h.z+dz),top=b.blockAt(p),ground=b.blockAt(p.offset(0,-1,0));
   if(top&&top.boundingBox==='empty'&&!/water|lava/.test(top.name||'')&&ground?.boundingBox==='block')return {x:p.x,y:p.y,z:p.z};
  }
  return null;
 }
 // Habit 11: a kind with two animals within 16 and 2 of its breeding food held, not bred in
 // the last BREED_EVERY_MS.
 breedable(b,counts){
  const me=b.entity&&b.entity.position;if(!me)return null;
  const FOOD={cow:'wheat',sheep:'wheat',pig:'carrot',chicken:'wheat_seeds'};
  const n={};
  for(const e of Object.values(b.entities||{}))if(e&&e!==b.entity&&FOOD[e.name]&&e.position&&e.position.distanceTo(me)<=16)n[e.name]=(n[e.name]||0)+1;
  for(const [kind,food] of Object.entries(FOOD))if((n[kind]||0)>=2&&(counts[food]||0)>=2&&Date.now()-((this.bredAt||{})[kind]||0)>=BREED_EVERY_MS)return kind;
  return null;
 }
 hayNear(b){
  try{const id=b.registry.blocksByName.hay_block?.id;return id!=null&&typeof b.findBlocks==='function'?b.findBlocks({matching:id,maxDistance:32,count:3}).length:0;}catch{return 0;}
 }
 // Habit 11: the wheat patch beside home - water within 8 of it, tillable ground (grass or dirt
 // under air) within 4 of that water, empty farmland, ripe wheat, and grass for seeds.
 farmScan(b){
  const h=this.home,me=b.entity&&b.entity.position;
  if(!h||!me||me.distanceTo(new Vec3(h.x+0.5,h.y,h.z+0.5))>16)return null;
  try{
   const reg=b.registry.blocksByName,at=p=>b.blockAt(p),centre=new Vec3(h.x,h.y,h.z);
   const near=(name,r=8,n=32)=>reg[name]?.id==null||typeof b.findBlocks!=='function'?[]:b.findBlocks({matching:reg[name].id,point:centre,maxDistance:r,count:n});
   const water=near('water').filter(p=>Math.abs(p.y-(h.y-1))<=1);
   const out={nearHome:true,water:water.length>0,plots:0,ripe:0,farmland:null,tillable:null,grass:near('short_grass',16,1).length>0};
   for(const p of near('wheat')){out.plots++;const bl=at(p);try{const a=(bl.getProperties?.()||bl.properties||{}).age;if(Number(a)>=7)out.ripe++;}catch{}}
   for(const p of near('farmland')){if(at(p.offset(0,1,0))?.boundingBox==='empty'&&!near('wheat').some(w=>w.equals(p.offset(0,1,0)))){out.farmland=out.farmland||{x:p.x,y:p.y,z:p.z};out.plots++;}}
   if(out.water&&!out.tillable){
    for(const w of water){
     for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[2,0],[-2,0],[0,2],[0,-2],[1,1],[-1,-1],[1,-1],[-1,1]]){
      const p=w.offset(dx,0,dz),bl=at(p),up=at(p.offset(0,1,0));
      if(bl&&/^(grass_block|dirt)$/.test(bl.name)&&up&&up.boundingBox==='empty'&&!/water/.test(up.name||'')){out.tillable={x:p.x,y:p.y,z:p.z};break;}
     }
     if(out.tillable)break;
    }
   }
   return out;
  }catch{return null;}
 }
 // Habit 9: a still water source within WATER_NEAR with open air above (a bucket fills from
 // the top), for the rung's bucket. Only looked for while an empty bucket is held.
 waterSource(b){
  try{
   if(!b.inventory.items().some(i=>i.name==='bucket')||b.inventory.items().some(i=>i.name==='water_bucket'))return null;
   const id=b.registry.blocksByName.water?.id;
   if(id==null||typeof b.findBlocks!=='function')return null;
   // Sources near the bot's own height first (a source 15 up a cliff is "near" but out of
   // reach), skipping ones the bucket already failed at.
   const me=b.entity?.position,now=Date.now(),bad=this.badWater||new Map();
   const ok=b.findBlocks({matching:id,maxDistance:WATER_NEAR,count:64}).filter(p=>{
    const bl=b.blockAt(p),up=b.blockAt(p.offset(0,1,0));
    return bl&&(bl.metadata??0)===0&&up&&up.boundingBox==='empty'&&up.name!=='water'&&!((bad.get(p.x+','+p.y+','+p.z)||0)>now);
   });
   if(me)ok.sort((a,c)=>(Math.abs(a.y-me.y)>4)-(Math.abs(c.y-me.y)>4)||a.distanceTo(me)-c.distanceTo(me));
   if(ok.length)return {x:ok[0].x,y:ok[0].y,z:ok[0].z};
  }catch{}
  return null;
 }
 // Exposed ore and logs within PICKUP_RADIUS (pickupJob), skipping blocks a gather refused.
 exposedNear(b){
  try{
   const reg=b.registry.blocksByName||{},at3=(x,y,z)=>b.blockAt(new Vec3(x,y,z));
   const kinds={coal:['coal_ore','deepslate_coal_ore'],iron:['iron_ore','deepslate_iron_ore'],diamond:['diamond_ore','deepslate_diamond_ore'],log:Object.keys(reg).filter(n=>/_log$/.test(n))};
   const out={};let any=false;
   const me=b.entity.position,bl=this.worker.blacklist;
   for(const [kind,names] of Object.entries(kinds)){
    const ids=names.map(n=>reg[n]&&reg[n].id).filter(id=>id!=null);
    if(!ids.length||typeof b.findBlocks!=='function')continue;
    const found=b.findBlocks({matching:ids,maxDistance:PICKUP_RADIUS,count:8}).filter(p=>isExposed(at3,p)&&!(bl&&bl.blockRecently&&bl.blockRecently(p))&&(kind!=='log'||Math.abs(p.y-me.y)<=3));
    if(found.length){out[kind]=found.length;any=true;}
   }
   return any?out:null;
  }catch{return null;}
 }
 // A block of one of `names` within `radius` (any exposure; the gather prefers exposed ones).
 oreNear(b,names,radius){
  try{
   const ids=names.map(n=>b.registry.blocksByName[n]&&b.registry.blocksByName[n].id).filter(id=>id!=null);
   return ids.length?!!b.findBlock({matching:ids,maxDistance:radius}):false;
  }catch{return false;}
 }
 submit(step,spec,opts){
  try{
   // Remember where surface gathers started: the step's unblock explores cap themselves
   // to that stand-Y (explore legs used to walk the bot off the grove).
   if(spec.type==='gather'&&spec.surface&&this.worker.bot){
    try{this.lastSurfaceY=Math.floor(this.worker.bot.entity.position.y);}catch{}
   }
   const job=opts?this.worker.submit(spec,opts):this.worker.submit(spec);
   this.current={id:job.id,step,spec};this.currentStep=step;this.state=step+': '+spec.type;
   if(step==='night')this.nightJob={id:job.id,day:String(this.worker.bot?.time?.day),retries:this.nightJob&&this.nightJob.day===String(this.worker.bot?.time?.day)?this.nightJob.retries:0};
   this.log('Autopilot ['+step+'] '+JSON.stringify(spec));
  }catch(e){this.state='submit failed: '+e.message;this.log('Autopilot submit failed: '+e.message);}
 }
}
