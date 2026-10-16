import mineflayer from 'mineflayer';
import pathfinderPackage from 'mineflayer-pathfinder';
import toolPackage from 'mineflayer-tool';
import {Vec3} from 'vec3';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {jobSchema,validateBlueprint} from './schema.js';
import {installMovementFix,installWeatherFix} from './compat.js';
import {eatMeal,guardEquip,afterInject} from './eating.js';
import {creeperSwell} from './creeper.js';
import {yawToward} from './heading.js';
import {craftConfirmedRetry as craftConfirmed} from './crafting.js';
import {survey} from './observe.js';
import {dayTicks,isNight} from './daytime.js';
import {Autopilot} from './autopilot.js';
import {SMELTING} from './smelting.js';
import {buildChain,BREED_FOOD} from './howto.js';
import * as combat from './combat.js';
import {TaskRunner} from './tasks/runner.js';
import {defaultChains} from './chains/index.js';
import {FightTask} from './chains/fightTask.js';
import {createTrackers} from './trackers/index.js';
import {createMoveApi,setDefaultMoveContext} from './tasks/movement/move.js';
import {forceFieldTick} from './forcefield.js';
import {avoidanceActive,pickOpenStand,stepCost,trackProgress,coverCell,SHOOTERS} from './move-safety.js';
import {stonePlan,stoneBeside,isExposed,STONE_DIG_DOWNS,STONE_DIG_MIN,NATURAL_DIG,isGravity,isFluid,stepFooting,turnOrder,wallOre} from './digDown.js';
import {solidSupport,placementCells,softBreakCell,hitsBot,HARD_BREAK} from './place-support.js';
import {createMoveTasks} from './tasks/movement/factories.js';
import {createLoopWatch} from './loop-watch.js';
import {installToolWear,watchToolLoss} from './toolWear.js';
import {darkNow,stillNight,leaveRefuge,shelterShell,shellGaps,holdableShell,placementPlan,shelterTarget,deepWaterCost,fleeHeading,nightMineWanted,tunnelBreach,SUNSET,NIGHT_MINE_MS,NIGHT_MINE_STOP,NIGHT_MINE_DEPTH,NIGHT_MINE_STRIP} from './night.js';
import {bestWeapon,attackCooldown,leaveAlone} from './chains/combatPolicy.js';
const {pathfinder,Movements,goals}=pathfinderPackage;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pos=p=>new Vec3(p.x,p.y,p.z);
const empty=b=>b && ['air','cave_air','void_air'].includes(b.name);
// Diagonal steps past a solid corner wedge the bot on 26.3 (it stops moving); require both sides clear.
function guardDiagonals(movement){
 const diagonal=movement.getMoveDiagonal.bind(movement);
 movement.getMoveDiagonal=(node,dir,neighbors)=>{for(const [x,z]of [[dir.x,0],[0,dir.z]])for(let dy=0;dy<=2;dy++)if(movement.getBlock(node,x,dy,z).physical)return;diagonal(node,dir,neighbors);};
 return movement;
}
// Blocks a gather job may descend for: they live underground when no exposure is in range.
const UNDERGROUND=/(_ore$|^deepslate|^stone$|^cobblestone$|^tuff$)/;
// Round 7 (normal3 staircased to y=19 and was returned by the operator): an ore gather with a
// band (targetY = the band's floor, bandTop = its top) enters the band from the top in legs:
// the first staircase stops at bandTop (or DESCENT_LEG below the bot, if that is higher in
// the band), then DESCENT_LEG at a time, never below the floor. Each stop rescans radius 32.
export const DESCENT_LEG=32;
export function descentTarget(spec,y){
 if(spec.bandTop==null)return spec.targetY;
 return Math.max(spec.targetY,Math.min(spec.bandTop,Math.floor(y)-DESCENT_LEG));
}
// Kiln: smelting inside an ore gather. KILN_WAIT_MS caps the final wait for the last batch.
export const KILN_ITEM_MS=10000,KILN_WAIT_MS=45000;
// A band gather walks up to this much further for ore it can swing at without digging to it.
export const BURIED_ORE_PENALTY=8;
// Stone-family gathers without a depth: exposed blocks near the bot first, else dig down.
const STONE_FAMILY=/^(stone|cobblestone|deepslate|cobbled_deepslate|tuff|andesite|granite|diorite)$/;
// Terrain a surface dig-down may cut through: never a log (a tree, or a player's build).
const naturalTerrain=bl=>NATURAL_DIG.has(bl.name)||/_leaves$|_ore$/.test(bl.name);
// Minimum gap between two scans that collected nothing: a reach failure blacklists a block
// in a few ms, and the hard runs burned through dozens of buried stones a second.
export const GATHER_RESCAN_MS=1000;
// Gather failures that mean THIS block cannot be taken from anywhere the bot can get to:
// the reach fallbacks (reachUp, descendToReach, canopyDrop) already ran before the throw.
const UNREACHABLE_BLOCK=/Cannot reach or harvest|Walked onto the target|Fluid (beside|under) target/;
export const GATHER_BLACKLIST_SECONDS=600;
// Round 10 (bug D): a search leg aims at the nearest match seen within SEARCH_SCAN beyond the
// worked area; a searchable gather leaves a grove after SEARCH_REFUSALS [columns, blocks].
export const SEARCH_SCAN=96,SEARCH_REFUSALS=[5,10];
export function searchHeading(from,points){
 let best=null,bd=Infinity;
 for(const p of points){const d=Math.hypot(p.x+0.5-from.x,p.z+0.5-from.z);if(d<bd){bd=d;best=p;}}
 if(!best)return null;
 const dx=best.x+0.5-from.x,dz=best.z+0.5-from.z;
 const direction=Math.abs(dx)>=Math.abs(dz)?(dx>0?'east':'west'):(dz>0?'south':'north');
 return {direction,distance:Math.round(bd),target:best.x+','+best.y+','+best.z};
}
// Tunnel settle: rounds of re-digging a step while sand/gravel keeps falling into it, and the
// wait for a falling block to land before the cells are read again.
export const TUNNEL_SETTLE_ROUNDS=12;export const TUNNEL_FALL_MS=450;export const TUNNEL_WALK_MS=2500;export const TRUNK_PILLAR=4;export const SHELTER_AWAY_MS=3000;
// A tunnel opens a block with no harvest tool when a bare hand breaks it this fast (hardness
// 0.5: 2.5 s by hand). The passage needs no drop: snow blocks (0.2) stopped a normal-anchor
// dig-down at 16:42Z, round 3, with 'needs a suitable tool'.
export const HAND_CLEAR_HARDNESS=0.5;
// The smelt job takes its output every this many items.
export const SMELT_TAKE=8;
// Habit 6: junk the bot dropped is left lying for this long (no sweep walks back to it).
export const JUNK_IGNORE_MS=10*60000;
// A take job waits at most this long past the batch's ready time (a slow or cold furnace).
export const SMELT_TAKE_GRACE=15000;
// Round 11 (normal2: three loads never collected, `take queued twice`, then the next smelt
// placed a new furnace): a left batch is collected before any new smelt starts, and only
// FURNACE_TAKE_TRIES failed walks back to it give it up.
export const FURNACE_TAKE_TRIES=3;
// Jobs that climb out of a stranded tunnel before they start (surface work).
const STRANDED_CLIMB=new Set(['goto','explore','hunt','collect','shear','breed','deposit','build','place']);
// Stops that are not the user's: they pause the queue but leave the autopilot running. A
// 'user' stop sets userStopped, and the autopilot reads that as Stop all and switches off -
// which is how its own food-explore cancel and the job watchdog idled normal3 twice. Round 3
// soak: the low-health stop (and the death and connection-end stops) still used the default
// 'user' source, so every hard hit mid-job printed 'Autopilot stopped (Stop all)' (normal2
// twice, hard1, hard2) and froze the ladder. Only the API's stop/cancel and an explicit
// disconnect are the user's; every internal caller names its source.
export const LADDER_SAFE_STOPS=new Set(['reflex','autopilot','timeout','health','death','connection']);
// Neutral mobs trail the bot without attacking; searches and explores ignore them unless
// they crowd the bot (the reflexes answer real aggression).
const NEUTRAL=new Set(['enderman','zombified_piglin','piglin','spider']);
const canSeeTarget=(b,e)=>{
 try{const from=b.entity.position.offset(0,1.62,0),to=e.position.offset(0,1,0);const dir=to.minus(from),range=dir.norm();if(range<0.5)return true;return !b.world.raycast(from,dir.scaled(1/range),range);}catch{return true;}
};
// Jobs that answer a survival need themselves: the survival chains stand down for them, and
// the pump runs a queued one before any other queued job (a reflex-paused day job resumed
// at night sat ahead of the night shelter in the array and ran first - round 4).
export const SURVIVAL_JOBS=new Set(['sleep','eat','shelter']);
// Worn armour and the off hand (round 8: inventory.items() skips these slots, so the soak
// could not see a worn chestplate).
const EQUIP_SLOTS={5:'head',6:'chest',7:'legs',8:'feet',45:'off-hand'};
export const equipment=b=>{const slots=b?.inventory?.slots||[];return Object.entries(EQUIP_SLOTS).filter(([i])=>slots[i]).map(([i,slot])=>({slot,name:slots[i].name,count:slots[i].count}));};
// Distance to a creeper close enough to override a survival hold: within 6, or fusing within 10.
export function creeperThreat(bot){
 const me=bot&&bot.entity&&bot.entity.position;if(!me)return null;
 let best=null;
 for(const e of Object.values(bot.entities||{})){
  if(!e||e.name!=='creeper'||!e.position||e.isValid===false)continue;
  const d=e.position.distanceTo?e.position.distanceTo(me):Math.hypot(e.position.x-me.x,e.position.y-me.y,e.position.z-me.z);
  if((d<=6||(d<=10&&creeperSwell(e).fusing))&&(best==null||d<best))best=d;
 }
 return best;
}
const WORLD_CHAIN='Misc World Survival Chain';
// Round 11: the bucket's eye ray from `from` to `to` (the fluid surface): the first solid
// block it passes through (blocked) or the first water source it meets (fluid). Fine steps.
export const BUCKET_TRIES=3,BUCKET_REACH=4.4;
export function rayToFluid(blockAt,from,to){
 const d=to.minus(from),len=d.norm(),n=Math.ceil(len/0.05),seen=new Set();
 for(let i=1;i<=n;i++){
  const p=from.plus(d.scaled(i/n)),x=Math.floor(p.x),y=Math.floor(p.y),z=Math.floor(p.z),k=x+','+y+','+z;
  if(seen.has(k))continue;seen.add(k);
  const bl=blockAt(x,y,z);
  if(!bl)continue;
  if(bl.name==='water'&&(bl.metadata??0)===0)return {fluid:bl};
  if(bl.boundingBox==='block')return {blocked:bl};
 }
 return {};
}
// Round 11: a level tunnel that starts at a staircase's foot carries on the stairs' heading.
// A hashed heading could turn it back under the stairs (the strip's head cell is the stair's
// floor), leaving each stair a 2-high climb the way home.
export function tunnelHeading(tunnel){
 const n=(tunnel||[]).length;if(n<2)return null;
 const a=tunnel[n-2],c=tunnel[n-1],dx=Math.sign(c.x-a.x),dz=Math.sign(c.z-a.z);
 return dx&&!dz||dz&&!dx?new Vec3(dx,0,dz):null;
}
// Shelter materials (placement order when no kit cobble is reserved). The job needs one per
// open shell cell where it stands (26 on flat ground, a few in a stone tunnel), digs dirt for
// at most SHELTER_DIG_MS when short and seals within SHELTER_SEAL_MS, else it fails with the
// reason and the night pillar takes over (round 5 hard1/hard2: 11 min re-walking one
// unreachable dirt block, cancelled by the soak bell, never sealed).
const SHELTER_ITEMS=['cobblestone','dirt','cobbled_deepslate','netherrack'];
export const SHELTER_DIG_MS=45000,SHELTER_SEAL_MS=30000,NIGHT_PILLAR_MS=13*60000,SHELTER_EXIT_MARGIN_MS=60000;
// Natural plants that fill a shell cell but are not replaceable: a placement into them is
// refused, so the seal digs them out first (a dark-forest floor is full of mushrooms).
export const SHELTER_NOTCH=/^(.*_mushroom|.*_sapling|.*_fungus|.*_roots|dandelion|poppy|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|torchflower|pink_petals|wildflowers|leaf_litter|sweet_berry_bush|sugar_cane|bush|firefly_bush|short_dry_grass|tall_dry_grass|moss_carpet|cocoa|lily_pad)$/;
const reflexPaused=j=>j.status==='paused'&&/^(Preempted by|Reflex:)/.test(String(j.message));
// Round 10 (bug A): a tunnel step is planned before it is dug. stepFooting looks two cells
// under the next step; a shallow hole there is filled with a held block, a deep opening (a
// cave, a ravine), lava under the floor or a loose floor over a hollow turns the tunnel to a
// side (STAIR_TURNS per job). No safe way on: the tunnel stops - it never walks onto air.
export const STAIR_TURNS=12;
// Round 11: bridged openings per job (digDown BRIDGE_WIDTH), sidesteps per descent leg when no
// direction is safe (SIDESTEP_LEN level cells, then a new staircase), and descent legs per
// ore gather (a stopped leg costs one; normal1 ran out of legs at y=-16 on the way to -53).
export const BRIDGES=8,SIDESTEPS=3,SIDESTEP_LEN=3,DESCENT_LEGS=6;
// Efficiency 3: ore worth a swing from the tunnel (coal and iron for the ladder, diamonds), and
// how many such wall digs one job may make.
const WALL_ORE=/^(deepslate_)?(coal|iron|diamond|copper|gold|redstone|lapis|emerald)_ore$/;
export const WALL_PICKUPS=16;
// Habit 7: tunnel torch spacing, and where the torch goes: the right-hand wall at feet height
// (right of dir: x=-dir.z, z=dir.x), else the floor under the feet.
export const TORCH_EVERY=7;
export function torchSpot(blockAt,feet,dir){
 const solid=bl=>!!bl&&bl.boundingBox==='block';
 if(dir){
  const r={x:-(dir.z||0)||0,z:(dir.x||0)||0},wall={x:feet.x+r.x,y:feet.y,z:feet.z+r.z};
  if(solid(blockAt(wall.x,wall.y,wall.z)))return {against:wall,face:{x:-r.x||0,y:0,z:-r.z||0},side:'right'};
 }
 const ground={x:feet.x,y:feet.y-1,z:feet.z};
 return solid(blockAt(ground.x,ground.y,ground.z))?{against:ground,face:{x:0,y:1,z:0},side:'floor'}:null;
}
const FILL_ITEMS=['cobblestone','cobbled_deepslate','dirt','netherrack','stone','deepslate','andesite','diorite','granite','tuff'];
export function planTunnelStep(b,job,dir,dy,noTurn=false){
 const here=b.entity.position.floored(),at3=(x,y,z)=>b.blockAt(new Vec3(x,y,z));
 const filler=FILL_ITEMS.find(n=>b.inventory.items().some(i=>i.name===n))||null;
 const why=[];
 for(const d of noTurn?[{x:dir.x,z:dir.z}]:turnOrder(dir)){
  const turned=d.x!==dir.x||d.z!==dir.z;
  if(turned&&(job.stairTurns||0)>=STAIR_TURNS){why.push('turn limit');break;}
  const next=here.offset(d.x,dy,d.z);
  let foot=stepFooting(at3,next,d);
  if(foot.bridge&&(job.bridges||0)>=BRIDGES)foot=stepFooting(at3,next);
  if(foot.fill&&!filler){why.push((foot.bridge?'a gap':'a hole')+' under '+next+' and no block to fill it');continue;}
  if(foot.turn){why.push(foot.turn);continue;}
  if(turned)job.stairTurns=(job.stairTurns||0)+1;
  if(foot.bridge)job.bridges=(job.bridges||0)+1;
  return {dir:new Vec3(d.x,0,d.z),next,foot,filler,turned,why};
 }
 return {why};
}
// An ore gather's descent leg. A leg the footing check stopped (a cave or ravine with no
// safe way around) ends where the bot stands: the gather scans from there (and the next leg,
// if one is left, tries again) instead of failing the trip on a safe stop. Lava still fails.
// Round 11: a leg with no safe way on (every direction opens onto a cave) first moves
// sideways - SIDESTEP_LEN level tunnel cells to a side, checked like any step - and starts a
// new staircase there, up to SIDESTEPS times, before it hands back to the gather.
const DESCENT_STOP=/^Tunnel stopped: (cave opening|a hole|hole|a gap|loose|lava two below|unloaded|turn limit|dropped|water)/;
export async function descendLeg(w,job,token,targetY){
 let dir=null;
 for(let side=0;;side++){
  try{await w.staircase(job,token,targetY,dir?{dir}:{});return;}
  catch(e){
   w.check(token);
   if(!DESCENT_STOP.test(e.message))throw e;
   if(side<SIDESTEPS&&/no safe way on/.test(e.message)&&w.bot.entity.position.y>targetY){
    dir=await sidestep(w,job,token);
    if(dir)continue;
   }
   w.log('Gather: descent stopped at y='+w.bot.entity.position.floored().y+' ('+e.message+'); searching from here');
   return;
  }
 }
}
// Level tunnel cells to the side of the stopped staircase (then straight on); never back the
// way it came. The heading of the first side that gives SIDESTEP_LEN-1+ cells, else null.
export async function sidestep(w,job,token){
 const b=w.bot,head=tunnelHeading(job.tunnel);
 const all=[new Vec3(1,0,0),new Vec3(0,0,1),new Vec3(-1,0,0),new Vec3(0,0,-1)];
 const dirs=head?[new Vec3(head.z,0,-head.x),new Vec3(-head.z,0,head.x),head]:all;
 if(!job.tunnel)job.tunnel=[];
 for(const d of dirs){
  let n=0;
  for(;n<SIDESTEP_LEN;n++){
   w.check(token);
   try{const st=await w.tunnelStep(job,token,d,0,false,undefined,true);job.tunnel.push({x:st.next.x,y:st.next.y,z:st.next.z});w.strandedTunnel={points:job.tunnel,job:job.id};}
   catch(e){w.check(token);if(/^Tunnel stopped/.test(e.message))break;throw e;}
  }
  if(n>=SIDESTEP_LEN-1){w.log('Tunnel: no safe way down; moved '+n+' '+heading(d)+' to start a new staircase at '+b.entity.position.floored());w.save();return d;}
 }
 return null;
}
const heading=d=>d.x?(d.x>0?'east':'west'):(d.z>0?'south':'north');
// Efficiency 3: mine wanted ore in the tunnel's side walls (digDown.wallOre) as the tunnel
// passes, with the right tool held, up to WALL_PICKUPS per job and never with a hostile
// within 8. Its drop lands in the next cell, inside the pickup reach.
export async function wallPickups(w,job,token,feet,dir){
 const b=w.bot;
 if((job.wallPickups||0)>=WALL_PICKUPS||typeof b.dig!=='function')return;
 if(Object.values(b.entities||{}).some(e=>e&&e.type==='hostile'&&e.position&&e.position.distanceTo(b.entity.position)<8))return;
 const wanted=bl=>WALL_ORE.test(bl.name||'');
 for(const p of wallOre((x,y,z)=>b.blockAt(new Vec3(x,y,z)),feet,dir,wanted)){
  if((job.wallPickups||0)>=WALL_PICKUPS)return;
  w.check(token);
  const block=b.blockAt(new Vec3(p.x,p.y,p.z));
  if(!block||!wanted(block))continue;
  if(block.harvestTools&&!Object.keys(block.harvestTools).some(id=>b.inventory.items().some(i=>i.type===+id)))continue;
  try{
   await b.tool.equipForBlock(block);w.check(token);
   if(block.material==='incorrect_for_wooden_tool')block.material='mineable/pickaxe';
   await b.dig(block);await sleep(250);
   job.wallPickups=(job.wallPickups||0)+1;(job.mined||(job.mined=[])).push(p.x+','+p.y+','+p.z);
   w.log('Tunnel: mined '+p.name+' in the wall at '+p.x+','+p.y+','+p.z);
  }catch(e){w.check(token);}
 }
}
// Habit 11: what a crop or grass gather counts (minecraft-data lists only seeds for wheat and
// nothing for grass), and the age a crop is ripe at.
export const CROP_DROP={wheat:'wheat',carrots:'carrot',potatoes:'potato',beetroots:'beetroot',short_grass:'wheat_seeds',tall_grass:'wheat_seeds'};
export const CROP_RIPE={wheat:7,carrots:7,potatoes:7,beetroots:3};
export const PLANTS={wheat_seeds:'wheat',carrot:'carrots',potato:'potatoes',beetroot_seeds:'beetroots'};
export const blockAge=bl=>{try{const p=(typeof bl.getProperties==='function'?bl.getProperties():null)||bl.properties||{};return Number(p.age??-1);}catch{return -1;}};
// Habit 8: lava beside the cells the bot stands in (it can flow in when a dig freed it) is
// plugged with a held block placed into the lava cell, against any solid neighbour of it.
export const BRANCH_MAIN=24,BRANCH_LEN=6,BRANCH_EVERY=3;
export async function plugLava(w,token,feet){
 const b=w.bot,at=p=>b.blockAt(p);
 for(const cell of [feet,feet.offset(0,1,0)])for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0],[0,-1,0]]){
  const p=cell.offset(dx,dy,dz);
  if(p.equals(feet)||p.equals(feet.offset(0,1,0)))continue;
  if(at(p)?.name!=='lava')continue;
  const filler=FILL_ITEMS.find(n=>b.inventory.items().some(i=>i.name===n));
  if(!filler){w.log('Tunnel: lava at '+p+' and nothing to plug it with');throw Error('Tunnel stopped: lava at '+p+' (no block to plug it)');}
  let ref=null,face=null;
  for(const [fx,fy,fz] of [[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]]){
   const n=p.offset(fx,fy,fz),bl=at(n);
   if(bl&&bl.boundingBox==='block'){ref=bl;face=new Vec3(-fx,-fy,-fz);break;}
  }
  if(!ref)throw Error('Tunnel stopped: lava at '+p+' with nothing to plug against');
  await b.equip(b.inventory.items().find(i=>i.name===filler),'hand');w.check(token);
  try{await b.placeBlock(ref,face);}catch{}
  w.log('Tunnel: plugged lava at '+p.x+','+p.y+','+p.z+' with '+filler);
 }
}
async function fillFooting(w,token,foot,filler){
 const b=w.bot,item=b.inventory.items().find(i=>i.name===filler);
 if(!item)throw Error('Tunnel stopped: no '+filler+' left to fill the hole at '+foot.fill.x+','+foot.fill.y+','+foot.fill.z);
 await b.equip(item,'hand');w.check(token);
 await w.placeBlocks(b.blockAt(new Vec3(foot.support.x,foot.support.y,foot.support.z)),new Vec3(foot.face.x,foot.face.y,foot.face.z),new Vec3(foot.fill.x,foot.fill.y,foot.fill.z),filler,token);
}
export class Worker extends EventEmitter {
 constructor(root,config){
  super();this.root=root;this.config=config;this.bot=null;this.ready=false;this.busy=false;this.epoch=0;this.events=[];
  this.reflexEnabled=config.reflexes!==false;this.reflexBusy=false;this.reflexStopping=false;this.userStopped=false;this.deathResume=false;this.eating=false;
  this.runSettled=null;this.controlToken=null;this.lastDeath=null;this.combat=combat; // reflex-side ownership token (see reflexes.js)
  this.meals={eaten:0,points:0,cooked:0,items:{},due:0,attempts:0,failed:0,deferred:0,noFood:0,lastError:null,lastDeferred:null}; // food accounting for the soak (trackMeals, smelt, FoodChain due/failed)
  this.autopilot=new Autopilot(this,root);
  this.loopWatch=createLoopWatch({log:m=>this.log(m)}); // LOOP_SLOW / LOOP_STALL lines (round 5)
  // Phase 7A: the AltoClef task runner owns survival behaviour (mob defense, food, world
  // survival, respawn) while the verified job queue keeps executing jobs. reflexes.js is
  // retired - its threat policy lives in the ported chains now (COMBAT_SPEC 7f thresholds).
  const trackers=createTrackers({getBot:()=>this.bot,config:this.config});
  this.trackers=trackers.api;this.trackersRaw=trackers;this.blacklist=trackers.blacklist;
  const ctxBase={worker:this,config:this.config,trackers:this.trackers,blacklist:this.blacklist,get bot(){return this.worker.bot;}};
  this.move={...createMoveApi(ctxBase),...createMoveTasks(ctxBase)};
  setDefaultMoveContext({...ctxBase,move:this.move});
  const self=this;
  const gate=chain=>{ // the reflexes toggle gates survival chains; user tasks always run
   let wasActive=false;
   return {
   name:chain.name,
   userService:chain.userService, // the runner's no-preempt contract must survive the wrap
   priority:(bot,ctx)=>{
    // The reflexes toggle gates the SURVIVAL chains only: UserTaskChain is the jobs' own
    // execution vehicle (fight/hunt run through it), so it stays live with reflexes off.
    if(!self.reflexEnabled&&chain.name!=='User Tasks'){wasActive=false;return -1;}
    // The old reflex courtesy rule: never interrupt (or race) jobs that already handle the
    // same survival need - sleep/eat/shelter. Queued counts, and so does a preemption-paused
    // one: the chain must stand down so the paused job gets its turn (otherwise the chain
    // holds the night and the job never resumes). World threats (lava, fire, a wall, powder
    // snow, drowning) still win: a shelter is no place to drown. The Food chain still eats
    // (its eat is a side effect; its collect band stays off) - round 4 hard3 sat in its
    // shelter at 8.3 hp and never ate. Round 8: under every hold, not just a sealed shelter:
    // a queued shelter or sleep job holds for the whole gather ahead of it, and that switched
    // eating off for the run. A shelter still placing its walls is the one exception (dusk
    // is short); the chain itself defers while asleep or while the eat job eats.
    const hold=chain.name!=='User Tasks'&&self.survivalHold();
    // Round 8: a creeper within 6 (or fusing within 10) always gets Mob Defense, even over an
    // eat job, a bed walk or a shelter still placing its walls - only a sealed box or a bed
    // the bot is already in keeps the hold (the walls are the answer there).
    const creeper=hold&&chain.name==='Mob Defense'&&!hold.sealed&&!bot.isSleeping?creeperThreat(bot)!=null:false;
    if(creeper&&!wasActive)self.log('Reflex: creeper at '+creeperThreat(bot).toFixed(1)+' overrides the '+hold.job.spec.type+' hold');
    if(hold&&chain.name!==WORLD_CHAIN&&!creeper){
     const building=hold.job.status==='running'&&hold.job.spec.type==='shelter'&&!hold.sealed;
     if(chain.name==='Food'&&!building)try{chain.priority(bot,ctx);}catch{}
     wasActive=false;return -1;
    }
    const p=chain.priority(bot,ctx);
    // Observability contract (the suite and the dashboard watch for 'Reflex:'): log each
    // survival chain engagement, exactly like the retired reflex loop announced itself.
    const activeNow=p>=0;
    if(activeNow&&!wasActive)self.log('Reflex: '+chain.name+' engaging');
    wasActive=activeNow;
    return p;
   },
   onTick:(bot,ctx)=>chain.onTick(bot,ctx),
   onStartup:(bot,ctx)=>chain.onStartup&&chain.onStartup(bot,ctx),
   onStopped:(bot,ctx)=>chain.onStopped&&chain.onStopped(bot,ctx)
   };
  };
  const chains=defaultChains();
  this.userChain=chains.find(c=>c.name==='User Tasks')||null; // the real chain: the runner holds gate-wrapped ones
  this.taskRunner=new TaskRunner(this,chains.map(gate));
  this.file=path.join(root,'data/jobs.json');fs.mkdirSync(path.dirname(this.file),{recursive:true});
  this.jobs=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):[];
  for(const job of this.jobs)if(['running','queued'].includes(job.status)){job.status='paused';job.message='Paused after restart; resume when ready';}
  // Preemption pauses are only meaningful within the session that made them (the chain that
  // paused the job is gone after a restart): strip the markers so the resume bridge ignores them.
  for(const job of this.jobs)if(job.status==='paused'&&/^(Preempted by|Job interrupted|Reflex:)/.test(String(job.message)))job.message='Paused after restart; resume when ready';
  this.save();
 }
 // The survival job the chains must stand down for: the running job when it is one, else
 // (nothing else running) a queued or reflex-paused one anywhere in the queue. sealed: the
 // running shelter has closed its box.
 survivalHold(){
  const running=this.jobs.find(j=>j.status==='running');
  if(running)return SURVIVAL_JOBS.has((running.spec||{}).type)?{job:running,sealed:running.spec.type==='shelter'&&!!this.shelterSealed}:null;
  const waiting=this.jobs.find(j=>SURVIVAL_JOBS.has((j.spec||{}).type)&&(j.status==='queued'||reflexPaused(j)));
  return waiting?{job:waiting,sealed:false}:null;
 }
 // jobs.json holds the active jobs (running/queued/paused/failed, with the resume state
 // they need) plus the most recent 200 terminal jobs stripped to their skeleton; everything
 // older moves to the append-only jobs-archive.jsonl. Failed jobs count toward the cap, so
 // a retry storm cannot grow the rewrite-on-every-update file without bound. Prune and
 // strip IN PLACE: the pump, the jobs and the dashboard share these object references, so
 // replacing them with copies would freeze their reported progress.
 save(){
  const terminal=this.jobs.filter(j=>j.status==='complete'||j.status==='cancelled'||j.status==='failed');
  const keepIds=new Set(terminal.slice(-200).map(j=>j.id));
  const archive=[];
  for(let i=this.jobs.length-1;i>=0;i--){
   const job=this.jobs[i];
   const isTerminal=job.status==='complete'||job.status==='cancelled'||job.status==='failed';
   if(isTerminal&&!keepIds.has(job.id)){archive.unshift(job);this.jobs.splice(i,1);continue;}
   if(isTerminal&&job.status!=='failed'){
    for(const key of Object.keys(job))if(!['id','status','spec','created','progress','message','finished'].includes(key))delete job[key];
    continue;
   }
   if(Array.isArray(job.tunnel)&&job.tunnel.length>20)job.tunnel=job.tunnel.slice(-20); // enough to climb the recent shaft
  }
  if(archive.length)fs.appendFileSync(path.join(this.root,'data/jobs-archive.jsonl'),archive.map(j=>JSON.stringify(j)).join('\n')+'\n');
  const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.jobs));
  // Windows: the API's concurrent reads hold jobs.json open and renameSync can EPERM -
  // retry, then fall back to a direct (non-atomic) write rather than crash the process.
  let replaced=false;
  for(let i=0;i<4&&!replaced;i++){try{fs.renameSync(tmp,this.file);replaced=true;}catch{}}
  if(!replaced){try{fs.writeFileSync(this.file,JSON.stringify(this.jobs));replaced=true;}catch{}}
 }
 log(message){this.events.unshift({time:new Date().toISOString(),message});this.events=this.events.slice(0,100);this.emit('event',message);}
 state(){const b=this.bot;return {connected:this.ready,connecting:!!b&&!this.ready,server:this.config.server,position:b?.entity?.position,health:b?.health,food:b?.food,inventory:b?.inventory?.items().map(i=>({name:i.name,count:i.count}))||[],equipment:equipment(b),jobs:this.jobs.slice(-100).reverse(),events:this.events,model:this.config.model,reflexes:this.reflexEnabled,busy:this.busy,reflexBusy:this.reflexBusy,autopilot:this.autopilot.status(),runner:this.taskRunner?this.taskRunner.status():null,meals:this.meals,deaths:this.deaths||0,deathLog:this.deathLog||[]};}
 setReflexes(enabled){this.reflexEnabled=!!enabled;this.log(enabled?'Reflexes enabled':'Reflexes disabled');}
 // Idle-time armour upkeep, kept from the retired reflex loop (COMBAT_SPEC 7f armour gates).
 autoArmour(){
  const b=this.bot;
  if(!b||this.armourBusy)return;
  const TIER={leather:1,golden:2,chainmail:3,iron:4,diamond:5,netherite:6};
  const SLOTS={head:[5,'helmet','head'],chest:[6,'chestplate','torso'],legs:[7,'leggings','legs'],feet:[8,'boots','feet']};
  for(const slot of Object.keys(SLOTS)){
   const [index,suffix,destination]=SLOTS[slot],current=b.inventory.slots[index];
   let best=current?{rank:TIER[current.name.split('_')[0]]||0,item:current,name:current.name}:null;
   for(const i of b.inventory.items()){
    if(!i.name.endsWith('_'+suffix))continue;
    const rank=TIER[i.name.split('_')[0]]||0;
    if(!best||rank>best.rank)best={rank,item:i,name:i.name};
   }
   if(best&&best.item!==current){
    this.armourBusy=true;
    b.equip(best.item,destination).then(()=>this.log('Chains: equipped '+best.name)).catch(()=>{}).finally(()=>{this.armourBusy=false;});
    setTimeout(()=>{this.armourBusy=false;},10000).unref();
    return;
   }
  }
 }
 observe(){
  const running=this.jobs.find(j=>['running','queued'].includes(j.status));
  const summary={connected:this.ready,job:running?{type:running.spec.type,status:running.status,progress:running.progress,message:running.message}:null,autopilot:this.autopilot.status(),
   events:this.events.slice(0,10).map(e=>({time:e.time.slice(11,19),message:e.message.slice(0,80)}))};
  return this.ready&&this.bot?{...summary,...survey(this.bot)}:summary;
 }
 connect(){
  if(this.bot)return;
  const bot=this.bot=mineflayer.createBot({...this.config.server,hideErrors:true});
  installMovementFix(bot);installWeatherFix(bot);this.trackMeals(bot);guardEquip(bot);
  bot.loadPlugin(pathfinder);bot.loadPlugin(toolPackage.plugin);
  bot.once('spawn',()=>{this.ready=true;installToolWear(bot);if(!bot.inventory._lossWatch){bot.inventory._lossWatch=true;watchToolLoss(bot,m=>this.log(m));}const movement=this.movements=this.normalMovements(bot);bot.pathfinder.setMovements(movement);bot.pathfinder.searchRadius=128;// in blocks: bounds searches for unreachable goals; legit paths may still cost up to goal distance + 128
  if(!this.trackersTimer){ // tracker refresh + preemption resume + idle armour, port of the reflex cadence
   this.loopWatch.start();
   this.trackersTimer=setInterval(()=>this.loopWatch.timeTick('cadence',()=>{
    // Preemption resume first and in its own guard: a chain that yielded must hand control
    // back to the paused job immediately, whatever the trackers are doing.
    try{
     if(this.taskRunner.status().task===null&&!this.userStopped&&!this.deathResume){
      for(const j of this.jobs)if(j.status==='paused'&&/^(Preempted by|Job interrupted|Reflex:)/.test(String(j.message))){this.log('Reflex: resumed the '+j.spec.type+' job');this.resume(j.id);}
      // A job queued behind a tree that has now ended: pump is event-driven (submit/finish),
      // so without this re-pump it would starve until the next submit.
      if(this.jobs.some(j=>j.status==='queued'))this.pump();
     }
    }catch{}
    try{
     const b=this.bot;if(!b)return;
     this.trackersRaw.blocks.tick(b);this.trackersRaw.storage.onTick(b);
     // Legit force field (AltoClef MobDefenseChain.doForceField port): swing at hostiles
     // already within reach while jobs run - research 3. Gated on reflexes + not eating.
     if(this.reflexEnabled)try{forceFieldTick(b,this);}catch{}
    }catch{}
    try{if(!this.jobs.some(j=>['running','queued'].includes(j.status)))this.autoArmour();}catch{}
   }),250);
   if(this.trackersTimer.unref)this.trackersTimer.unref();
  }
  this.taskRunner.start();
  if(!this.autopilotTimer)this.autopilotTimer=setInterval(()=>{try{this.loopWatch.timeTick('autopilot',()=>this.autopilot.tick(),()=>'state '+this.autopilot.state);}catch{}},1000);this.log('Connected to Minecraft');this.pump();});
  // Servers send air metadata only when it changes; mineflayer never sees the initial value, which is always full at spawn.
  bot.on('spawn',()=>{bot.oxygenLevel=20;});
  // Closing a container copies ITS copy of the player slots back over bot.inventory
  // (mineflayer copyInventory). Anything that changed the real inventory while the window
  // was open and was not echoed into that window (console /clear, a death, a plugin) is
  // then resurrected client-side as a ghost: soak 20261014-0239 normal2 closed a furnace
  // after the run's /clear and the ladder saw a stone kit it did not have for 4.5 minutes.
  // One no-op click with an impossible stateId makes the server send window 0 in full.
  bot.on('windowClose',()=>{setTimeout(()=>{if(bot._syncWindow&&bot.inventory&&!bot.currentWindow)bot._syncWindow(bot.inventory).catch(()=>{});},150);});
  // Every server-side position packet is a teleport the client must confirm (an operator
  // tp, a "moved too quickly/wrongly" snap-back, or a silent collision correction). Count
  // and log them, rate limited, so a client/server desync shows up next to its symptoms.
  this.teleports=0;let lastTeleportLog=0;
  bot.on('forcedMove',()=>{
   this.teleports++;const now=Date.now();
   if(now-lastTeleportLog>2000){lastTeleportLog=now;const p=bot.entity.position;this.log('Server set position to '+p.floored()+' (teleport #'+this.teleports+')');}
  });
  bot.on('error',e=>this.log('Connection error: '+e.message));
  bot.on('kicked',reason=>this.log('Server rejected connection: '+JSON.stringify(reason)));
  bot.on('end',()=>this.onEnd(bot));
  bot.on('death',()=>this.onDeath(bot));
  bot.on('health',()=>this.onHealth(bot));
  bot.on('messagestr',message=>this.log(message.slice(0,500)));
 }
 onEnd(bot){if(this.bot!==bot)return;this.stop('Connection ended','connection');this.bot=null;this.ready=false;this.log('Disconnected. Connect again to retry.');}
 // deathResume (not userStopped) holds the ladder after a death: 'paused: died' until a resume.
 onDeath(bot){
  const at=bot.entity?.position;
  const killer=at?Object.values(bot.entities).filter(e=>e!==bot.entity&&e.type==='hostile'&&e.position&&e.position.distanceTo(at)<=8).sort((x,y)=>x.position.distanceTo(at)-y.position.distanceTo(at))[0]:null;
  this.log('Bot died at '+(at?Math.floor(at.x)+', '+Math.floor(at.y)+', '+Math.floor(at.z):'an unknown position')+(killer?' (killed by '+killer.name+')':''));
  this.lastDeath={pos:at?{x:at.x,y:at.y,z:at.z}:null,t:Date.now()};
  // Monotonic, session-wide: the soak counts a run's deaths as this counter's rise (the
  // 100-entry event window scrolls a 'Bot died at' line out within one 30 s sample under a
  // flee storm - round 4 recorded 1 death of 4).
  this.deaths=(this.deaths||0)+1;
  this.deathLog=[...(this.deathLog||[]).slice(-19),{t:new Date().toISOString(),pos:this.lastDeath.pos,killer:killer?killer.name:null,job:(this.jobs.find(j=>j.status==='running')||{}).spec?.type||null}];
  this.deathResume=true;
  this.stop('Bot died; inspect the world before resuming','death');
  setTimeout(()=>{try{bot.respawn();}catch{}},500);
 }
 onHealth(bot){if(this.busy&&!this.survivalJob&&(bot.health<this.config.limits.minHealth||bot.food<this.config.limits.minFood))this.stop('Health or food is low','health');}
 disconnect(){this.stop('Disconnected by user','user');this.bot?.quit();this.bot=null;this.ready=false;}
 // keepHolds: a survival job the autopilot sends while a death holds the ladder (the
 // respawn-at-night shelter) runs without lifting that hold.
 submit(input,{keepHolds=false}={}){const spec=jobSchema.parse(input);const job={id:crypto.randomUUID(),spec,status:'queued',created:new Date().toISOString(),progress:0,message:'Waiting'};this.jobs.push(job);if(!keepHolds){this.userStopped=false;this.deathResume=false;}this.save();this.pump();return job;}
 stop(message='Stopped by user',source='user'){
  if(!LADDER_SAFE_STOPS.has(source))this.userStopped=true;
  this.epoch++;
  // pathfinder.stop() leaves a sticky flag that rejects the next goto; setGoal(null) clears it.
  // The control taker cleans up: whoever stops the job owns the pathfinder reset, so the
  // interrupted job's finally blocks (token!==epoch now) can skip theirs entirely. After the
  // socket ends the pathfinder throws on these calls, so guard them: a disconnect must never
  // take the dashboard process down.
  try{this.bot?.pathfinder.stop();this.bot?.pathfinder.setGoal?.(null);if(this.movements)this.bot?.pathfinder.setMovements?.(this.movements);this.bot?.clearControlStates();try{this.bot?.stopDigging()?.catch?.(()=>{});}catch{}}catch{}
  this.interruptReject?.(new Error(message));this.interruptReject=null;
  for(const job of this.jobs)if(['running','queued'].includes(job.status)){job.status='paused';job.message=message;this.log('Pause trace: '+job.spec.type+' -> '+message);}
  this.save();this.log(message);
 }
 resume(id){const job=this.jobs.find(j=>j.id===id);if(!job)throw Error('Unknown job');if(!['paused','failed'].includes(job.status))throw Error('Only paused or failed jobs can resume');
  // Death-recovery: a job paused by death returns to its work site only when the death is
  // close and fresh (dropped items despawn after 5 minutes); otherwise it is cancelled and
  // the ladder restarts near the respawn point.
  if(String(job.message).startsWith('Bot died')&&this.lastDeath){
   const fresh=Date.now()-this.lastDeath.t<5*60*1000;
   const p=this.lastDeath.pos;
   const near=!p||!this.bot||Math.hypot(this.bot.entity.position.x-p.x,this.bot.entity.position.z-p.z)<64;
   if(!fresh||!near){job.status='cancelled';job.message='Drop site far or stale; the ladder restarts near spawn';this.save();this.pump();return job;}
  }
  job.status='queued';job.message='Resuming';this.userStopped=false;this.deathResume=false;this.save();this.pump();return job;}
 cancel(id,source='user'){const job=this.jobs.find(j=>j.id===id);if(!job)throw Error('Unknown job');if(job.status==='running')this.stop('Current job cancelled',source);job.status='cancelled';this.save();}
 check(token){if(token!==this.epoch){this.log('Check: token '+token+' epoch '+this.epoch+' busy '+this.busy);throw Error('Job interrupted');}if(!this.ready)throw Error('Job interrupted');if(Date.now()>this.deadline)throw Error('Time limit reached; resume after inspecting progress');if(!this.survivalJob&&(this.bot.health<this.config.limits.minHealth||this.bot.food<this.config.limits.minFood))throw Error('Health or food is low');}
 async pump(){
  if(this.busy||this.reflexBusy||!this.ready)return;
  // A live task tree owns the bot (survival chain): jobs wait behind it, exactly like the
  // retired reflex loop's reflexBusy gate. Starting a job under the tree's epoch would let
  // its navigation and cleanups fight the tree for the same controls (the A4 lava lesson:
  // the escape lost its controls to a queued gather's walk and the bot burned).
  if(this.taskRunner&&this.taskRunner.status().task)return;
  const job=this.jobs.find(j=>j.status==='queued'&&SURVIVAL_JOBS.has((j.spec||{}).type))||this.jobs.find(j=>j.status==='queued');if(!job)return;
  this.busy=true;job.status='running';job.message='Working';this.save();const token=this.epoch;
  const minutes=['sleep','shelter'].includes(job.spec.type)?this.config.limits.nightMinutes??13:this.config.limits.jobMinutes;
  this.deadline=Date.now()+minutes*60000;this.survivalJob=['eat','equip','smelt','sleep','shelter','fight','hunt','collect'].includes(job.spec.type)||!!job.spec.forFood; // getting food must run on an empty bar
  const watchdog=setInterval(()=>{if(Date.now()>this.deadline)this.stop('Job time limit reached','timeout');},1000);
  // runSettled resolves only once run(job) has FULLY unwound (every inner finally). A stop
  // resolves the race below while run is still unwinding; reflexes await runSettled before
  // moving, and every job-side cleanup checks the epoch so a late unwind cannot cancel them.
  const interrupted=new Promise((_,reject)=>{this.interruptReject=reject;});
  const run=this.run(job,token);this.runSettled=run.catch(()=>{});
  try{await Promise.race([run,interrupted]);this.check(token);job.status='complete';
   // A combatTask summary ('Fought: ... hits=N crits=M') rides the job message - keep it.
   if(!/^Fought:/.test(job.message))job.message='Completed and verified';
   else job.message='Completed and verified; '+job.message;
   this.log(`Completed ${job.spec.type}`);}
  catch(e){if(job.status==='running'){job.status='failed';job.message=e.message;for(const next of this.jobs)if(next.status==='queued'){next.status='paused';next.message='Paused because an earlier job failed';}}this.log('Job: '+e.message);if(e.stack)console.error(e.stack);}
  finally{this.interruptReject=null;clearInterval(watchdog);this.survivalJob=false;if(token===this.epoch)this.bot?.clearControlStates();this.save();this.busy=false;setTimeout(()=>this.pump(),100);}
 }
 update(job,progress,message){job.progress=progress;job.message=message;this.save();}
 count(name){return this.bot.inventory.items().filter(i=>i.name===name).reduce((a,i)=>a+i.count,0);}
 async navigate(goal,token,seconds=45){
  this.check(token);const bot=this.bot;
  const reached=()=>bot.entity?.onGround&&goal.isEnd(bot.entity.position.floored());
  if(reached())return;
  try{this.applyMobAvoidance(bot.pathfinder.movements,bot);}catch{}
  let timer,monitor,last='none';
  const onPath=r=>{last=`${r.status}, ${r.path.length} steps, ${r.visitedNodes} nodes`;};bot.on('path_update',onPath);
  let track=trackProgress(bot.entity.position,Date.now());
  try{await Promise.race([bot.pathfinder.goto(goal),new Promise((resolve,reject)=>{monitor=setInterval(()=>{
   if(reached()){resolve();return;}
   // A dig holds the bot still on purpose; a path that never moves and never digs is the silent hang.
   if(this.surfaceFloor!=null&&bot.entity.position.y<this.surfaceFloor){reject(new Error('Navigation left the surface at '+bot.entity.position.floored()));return;}
   if(this.surfaceCeil!=null&&bot.entity.position.y>this.surfaceCeil){reject(new Error('Navigation climbed above the graze cap at '+bot.entity.position.floored()));return;}
   if(bot.targetDigBlock){track=trackProgress(bot.entity.position,Date.now());return;}
   track=trackProgress(bot.entity.position,Date.now(),track);
   if(track.stuck)reject(new Error('Navigation made no progress at '+bot.entity.position.floored()+' (last path: '+last+')'));
  },250);}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Navigation timed out at ${bot.entity.position.floored()} (onGround ${bot.entity.onGround}, last path: ${last})`)),seconds*1000);})]);this.check(token);}
  finally{bot.off('path_update',onPath);clearTimeout(timer);clearInterval(monitor);if(token===this.epoch){bot.pathfinder.setGoal(null);bot.clearControlStates();}}
 }
 async walk(target,token,range=2,seconds=45){await this.navigate(new goals.GoalNear(target.x,target.y,target.z,range),token,seconds);}
 // Research 4: pathfinder mob avoidance while unarmed or low - creepers are hard-avoided
 // (entitiesToAvoid), and an exclusionAreasStep hook adds path cost inside ~8 blocks of any
 // known hostile so routes bend around mobs. Feature-checked: older pathfinder builds
 // silently skip. Refreshed on each build (replans re-read the movements object).
 applyMobAvoidance(movement,bot){
  try{
   if(!movement||!bot)return movement;
   const armed=(this.count('_sword')+this.count('_axe'))>0;
   const active=avoidanceActive(armed,bot.health);
   if(movement.entitiesToAvoid&&typeof movement.entitiesToAvoid.add==='function'){
    if(active)movement.entitiesToAvoid.add('creeper');
    else movement.entitiesToAvoid.delete('creeper');
   }
   if(Array.isArray(movement.exclusionAreasStep)){
    movement.exclusionAreasStep=movement.exclusionAreasStep.filter(fn=>fn!==movement._mobAvoidHook);
    if(active){
     const hook=block=>{
      const hostiles=Object.values(bot.entities||{}).filter(e=>e&&e.type==='hostile'&&e.position&&e.isValid!==false&&!NEUTRAL.has(e.name));
      return stepCost(block,hostiles,bot.entity&&bot.entity.position);
     };
     movement._mobAvoidHook=hook;
     movement.exclusionAreasStep.push(hook);
    }else movement._mobAvoidHook=null;
   }
  }catch{}
  return movement;
 }
 // Blocks the pathfinder treats as passable but that hurt or trap a walking bot. Powder snow
 // is the one that killed soak normal2 (2026-10-14, "froze to death" on a snowy slope).
 avoidHazards(movement,bot){
  if(!movement.blocksToAvoid||typeof movement.blocksToAvoid.add!=='function')return movement;
  for(const name of ['powder_snow','sweet_berry_bush','wither_rose','cactus','magma_block','campfire','soul_campfire','pointed_dripstone']){
   const id=bot.registry.blocksByName[name]?.id;if(id!==undefined)movement.blocksToAvoid.add(id);
  }
  // Deep water (no footing): banned after dark, costly by day (night.js deepWaterCost) - the
  // round-4 night drowned the bot. A bot already in the water must still path out of it.
  if(Array.isArray(movement.exclusionAreasStep)&&!movement._deepWaterHook){
   const hook=block=>{
    if(!block||!block.position||!/water|bubble_column/.test(block.name||''))return 0;
    const e=bot.entity;
    if(!e||e.isInWater||/water/.test(bot.blockAt(e.position.offset(0,1.4,0))?.name||''))return 0;
    return deepWaterCost((x,y,z)=>bot.blockAt(new Vec3(x,y,z)),block.position,darkNow(dayTicks(bot)));
   };
   movement._deepWaterHook=hook;movement.exclusionAreasStep.push(hook);
  }
  return movement;
 }
 normalMovements(bot){
  const movement=new Movements(bot);movement.canDig=false;movement.allow1by1towers=false;movement.allowParkour=false;movement.allowSprinting=false;movement.canOpenDoors=false;movement.maxDropDown=3;
  this.applyMobAvoidance(movement,bot);this.avoidHazards(movement,bot);
  return guardDiagonals(movement);
 }
 exploreMovements(){
  if(this.exploreMoves)return this.exploreMoves;
  const b=this.bot,m=new Movements(b);
  m.canDig=true;m.allowSprinting=true;m.allow1by1towers=true;m.allowParkour=false;m.canOpenDoors=false;m.maxDropDown=3;
  this.avoidHazards(m,b);
  m.scafoldingBlocks=[b.registry.blocksByName.dirt.id,b.registry.blocksByName.cobblestone.id,b.registry.blocksByName.netherrack?.id].filter(id=>id!==undefined);
  const natural=new Set([...NATURAL_DIG].map(n=>b.registry.blocksByName[n]?.id).filter(id=>id!==undefined));
  // Leaves are natural and passable by digging; logs stay protected because they may be part of builds.
  for(const block of Object.values(b.registry.blocksByName))if(block.name.endsWith('_leaves'))natural.add(block.id);
  const base=m.safeToBreak.bind(m);
  m.safeToBreak=block=>{
   if(!natural.has(block.type))return false;
   // The library already refuses digs beside or above fluids; also refuse digging above a fluid.
   const below=b.blockAt(block.position.offset(0,-1,0));
   if(below&&(below.name==='lava'||below.name==='water'))return false;
   return base(block);
  };
  const down=m.getMoveDown.bind(m);
  m.getMoveDown=(node,neighbors)=>{
   const floor=m.getBlock(node,0,-1,0),before=neighbors.length;
   down(node,neighbors);
   if(!floor)return;
   for(let i=neighbors.length-1;i>=before;i--){const move=neighbors[i];if(move.toBreak.some(p=>p.x===floor.position.x&&p.y===floor.position.y&&p.z===floor.position.z))neighbors.splice(i,1);}
  };
  return this.exploreMoves=guardDiagonals(m);
 }
 async exploreLeg(token,spec){
  const b=this.bot,dirs={north:[0,-1],south:[0,1],east:[1,0],west:[-1,0]};
  const direction=dirs[spec.direction]?spec.direction:['north','south','east','west'][Math.floor(Math.random()*4)];
  const start=b.entity.position.floored(),goalX=start.x+dirs[direction][0]*spec.distance,goalZ=start.z+dirs[direction][1]*spec.distance;
  const previous=this.movements;b.pathfinder.setMovements(this.exploreMovements());
  let watch,lastHealth=b.health,shooters=null;const threatened=new Promise((_,reject)=>{watch=setInterval(()=>{
   try{this.check(token);}catch(e){clearInterval(watch);reject(e);return;}
   // Shot at with no shield (round 3 normal3 died 'shot by Skeleton' while the food explore
   // walked on): stop the leg and break line of sight below.
   const hurt=b.health<lastHealth;lastHealth=b.health;
   if(hurt&&b.inventory.slots?.[45]?.name!=='shield'){
    const seen=Object.values(b.entities).filter(e=>e&&e.type==='hostile'&&SHOOTERS.test(e.name||'')&&e.position&&e.position.distanceTo(b.entity.position)<=24&&canSeeTarget(b,e));
    if(seen.length){shooters=seen;clearInterval(watch);reject(new Error('Shot at by '+seen[0].name+' with no shield; explore stopped to break line of sight'));return;}
   }
   // Neutral mobs (endermen trail the bot for minutes) must not abort every search; the
   // reflexes answer them when they actually attack or crowd the bot.
   const threat=Object.values(b.entities).find(e=>e&&e.type==='hostile'&&e.position&&e.position.distanceTo(b.entity.position)<6&&!NEUTRAL.has(e.name)&&canSeeTarget(b,e));
   if(threat){clearInterval(watch);reject(new Error('Hostile '+(threat.name||'mob')+' is close; explore stopped early'));}
  },250);});
  try{await Promise.race([this.navigate(new goals.GoalXZ(goalX,goalZ),token,spec.seconds??60+spec.distance*2),threatened]);}
  catch(e){if(shooters&&token===this.epoch){try{b.pathfinder.setGoal(null);}catch{}await this.takeCover(token,shooters);}throw e;}
  finally{clearInterval(watch);if(token===this.epoch){try{b.pathfinder.setGoal(null);b.pathfinder.stop();}catch{}b.clearControlStates();b.pathfinder.setMovements(previous);}}
  this.check(token);
  const end=b.entity.position.floored();
  // 60% of the requested distance still counts: the food step scans in 32-block legs and
  // obstacles routinely stop a leg at 24+ blocks - the old distance-1 gate failed the leg
  // (and the step's failure budget) for a perfectly useful scan.
  if(Math.hypot(end.x-start.x,end.z-start.z)<Math.min(spec.distance-1,spec.distance*0.6))throw Error('Explore stopped early at '+end);
  return direction;
 }
 // Walk (no digging) to the nearest cell within 5 that no shooter can see.
 async takeCover(token,shooters){
  const b=this.bot;
  const cell=coverCell((x,y,z)=>b.blockAt(new Vec3(x,y,z)),b.entity.position,shooters.map(e=>e.position));
  if(!cell){this.log('Explore: shot at by '+shooters[0].name+'; no cover within 5 blocks');return false;}
  this.log('Explore: shot at by '+shooters.map(e=>e.name).join(',')+'; taking cover at '+cell.x+','+cell.y+','+cell.z);
  b.pathfinder.setMovements(this.movements);
  try{await this.walk(new Vec3(cell.x,cell.y,cell.z),token,0,8);}catch(e){this.check(token);this.log('Explore: cover walk failed: '+e.message);}
  return true;
 }
 async explore(job,token){
  const b=this.bot;
  if(!job.direction)job.direction=job.spec.direction??'random';
  if(job.direction==='random')job.direction=['north','south','east','west'][Math.floor(Math.random()*4)];
  this.save();
  // surface (wood step): an explore leg honours the same stand-Y cap the gather navigates
  // under - the soak legs walked the bot off the grove and into the ravine while the step
  // was only blocked, not finished (surfaceY comes from the ladder's gather start).
  if(job.spec.surface){
   if(job.surfaceY===undefined)job.surfaceY=job.spec.surfaceY!=null?job.spec.surfaceY:Math.floor(b.entity.position.y);
   this.surfaceFloor=job.surfaceY-4;
  }
  // Food-step graze: abort before a 64-block GoalXZ walks up a peak (soak 5 normal1
  // fell from y=173 at 07:21; soak 4 hard2 fell at y=82). Floor still optional.
  if(job.spec.surfaceCeiling!=null)this.surfaceCeil=job.spec.surfaceCeiling;
  // Food-step graze floor: the graze is a surface activity. Round 3 normal3 followed the
  // terrain from the y=131 anchor down into a cave and was shot dead at y=41. Paths below
  // the floor cost extra, and the leg aborts once the bot is under it.
  const moves=this.exploreMovements(),floor=job.spec.surfaceFloor,deep=block=>block.position.y<floor?100:0;
  if(floor!=null){this.surfaceFloor=floor;moves.exclusionAreasStep.push(deep);}
  try{await this.exploreLeg(token,{direction:job.direction,distance:job.spec.distance});}
  finally{
   if(job.spec.surface||floor!=null)this.surfaceFloor=null;if(job.spec.surfaceCeiling!=null)this.surfaceCeil=null;
   if(floor!=null)moves.exclusionAreasStep=moves.exclusionAreasStep.filter(fn=>fn!==deep);
  }
 }
 async place(job,token){
  const b=this.bot,s=job.spec,target=pos(s.position);
  if(!b.registry.blocksByName[s.block])throw Error('Unknown block '+s.block);
  if(!b.registry.itemsByName[s.block])throw Error('Unknown building block '+s.block);
  await this.walk(target,token,3);
  const existing=b.blockAt(target);
  if(existing?.name===s.block)return;
  if(!empty(existing))throw Error('Cannot place at '+target+': occupied by '+(existing?.name||'unloaded block'));
  const avoid=block=>block.position.x===target.x&&block.position.z===target.z?100:0;
  this.movements.exclusionAreasStep.push(avoid);b.pathfinder.setMovements(this.movements);
  try{
   let support=null,face=null;
   for(const direction of [new Vec3(0,1,0),new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1),new Vec3(0,-1,0)]){const neighbor=b.blockAt(target.minus(direction));if(neighbor?.boundingBox==='block'){support=neighbor;face=direction;break;}}
   if(!support)throw Error('No support for block at '+target);
   const standing=[];
   for(const [dx,dz] of [[-2,0],[2,0],[0,-2],[0,2],[-2,-2],[2,2],[2,-2],[-2,2],[0,-4],[0,4],[-4,0],[4,0]])for(let dy=0;dy>=-3;dy--){const point=target.offset(dx,dy,dz);if(empty(b.blockAt(point))&&empty(b.blockAt(point.offset(0,1,0)))&&b.blockAt(point.offset(0,-1,0))?.boundingBox==='block')standing.push(point);}
   standing.sort((a,c)=>a.distanceTo(b.entity.position)-c.distanceTo(b.entity.position));
   let approached=false,last='';
   for(const point of standing){try{await this.navigate(new goals.GoalBlock(point.x,point.y,point.z),token,15);if(b.entity.position.offset(0,1.62,0).distanceTo(support.position.offset(.5,.5,.5))>4.4){last='too far from support after navigating';continue;}approached=true;break;}catch(error){this.check(token);last=(error.name&&error.name!=='Error'?error.name+': ':'')+error.message;}}
   if(!approached){this.log('Place: standing candidates were '+JSON.stringify(standing.map(p=>p.floored()))+' and '+last);throw Error('No safe reachable standing spot beside '+target+': '+last);}
   const item=b.inventory.items().find(i=>i.name===s.block);if(!item)throw Error('Need '+s.block+' in the inventory');
   await b.equip(item,'hand');this.check(token);await this.placeBlocks(support,face,target,s.block,token);
  }finally{this.movements.exclusionAreasStep=this.movements.exclusionAreasStep.filter(fn=>fn!==avoid);if(token===this.epoch)b.pathfinder.setMovements(this.movements);}
 }
 async eat(job,token){
  const b=this.bot;
  this.check(token);
  if(b.food>=20)throw Error('Food is already full');
  const unsafe=new Set(['rotten_flesh','spider_eye','poisonous_potato','pufferfish','chicken']);
  const foods=b.inventory.items().map(i=>({item:i,food:b.registry.foodsByName[i.name]})).filter(f=>f.food&&!unsafe.has(f.item.name));
  if(!foods.length)throw Error('No edible food in the inventory');
  foods.sort((x,y)=>y.food.foodPoints-x.food.foodPoints);
  const r=await eatMeal(b,foods[0].item.name,{worker:this,check:()=>this.check(token)});
  if(!r.ok)throw Error('Eating did not increase food: '+r.reason);
 }
 async equip(job,token){
  const b=this.bot,tier={wooden:1,golden:2,stone:3,iron:4,diamond:5,netherite:6},kind={pickaxe:4,axe:3,shovel:2,sword:1},plate={leather:1,golden:2,chainmail:3,iron:4,diamond:5,netherite:6};
  let tool=null;
  for(const i of b.inventory.items()){
   const m=/^(wooden|golden|stone|iron|diamond|netherite)_(pickaxe|axe|shovel|sword)$/.exec(i.name);
   if(m&&(!tool||tier[m[1]]*10+kind[m[2]]>tool.rank))tool={rank:tier[m[1]]*10+kind[m[2]],item:i,name:i.name};
  }
  if(tool){await b.equip(tool.item,'hand');this.check(token);}
  const slots={head:[5,'helmet','head'],chest:[6,'chestplate','torso'],legs:[7,'leggings','legs'],feet:[8,'boots','feet']},expected={};
  for(const slot of Object.keys(slots)){
   const [index,suffix,destination]=slots[slot],current=b.inventory.slots[index];
   let best=current?{rank:plate[current.name.split('_')[0]]||0,item:current,name:current.name}:null;
   for(const i of b.inventory.items()){
    if(!i.name.endsWith('_'+suffix))continue;
    const rank=plate[i.name.split('_')[0]]||0;
    if(!best||rank>best.rank)best={rank,item:i,name:i.name};
   }
   if(best&&best.item!==current){await b.equip(best.item,destination);this.check(token);}
   expected[index]=best?best.name:null;
  }
  if(tool&&b.heldItem?.name!==tool.name)throw Error('Failed to equip '+tool.name);
  for(const [index,name] of Object.entries(expected))if((b.inventory.slots[index]?.name||null)!==name)throw Error('Failed to equip the best armour for slot '+index);
  const shield=b.inventory.items().find(i=>i.name==='shield');
  if(shield){await b.equip(shield,'off-hand');this.check(token);if(b.inventory.slots[45]?.name!=='shield')throw Error('Failed to equip the shield');}
 }
 async collect(job,token){
  const b=this.bot,radius=job.spec.radius??16;
  const before=b.inventory.items().reduce((a,i)=>a+i.count,0);
  const targets=Object.values(b.entities).filter(e=>e.name==='item'&&e.position&&e.position.distanceTo(b.entity.position)<=radius&&!this.isDroppedJunk?.(e));
  this.update(job,0,`Collecting ${targets.length} drops`);
  for(const drop of targets){
   for(let tries=0;tries<3&&Object.values(b.entities).includes(drop);tries++){
    this.check(token);
    // Range 1, not 0: the item drifts on the ground and an exact-cell goal fails the leg
    // without ever entering the pickup radius (flaky suite failure at (-2,-60,6)).
    try{await this.navigate(new goals.GoalNear(drop.position.x,drop.position.y,drop.position.z,1),token,10);}catch(e){this.check(token);}
    await sleep(400);
   }
   if(Object.values(b.entities).includes(drop))throw Error('Could not reach a dropped item at '+drop.position.floored());
  }
  if(targets.length&&b.inventory.items().reduce((a,i)=>a+i.count,0)-before<targets.length)throw Error('Drops were seen but not picked up');
 }
 async sweepDrops(token,radius=8){
  const b=this.bot,deadline=Date.now()+10000;
  while(Date.now()<deadline){
   this.check(token);
   const drop=Object.values(b.entities).filter(e=>e.name==='item'&&e.position&&e.position.distanceTo(b.entity.position)<=radius&&!this.isDroppedJunk?.(e)).sort((a,c)=>a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position))[0];
   if(!drop)return;
   try{await this.navigate(new goals.GoalNear(drop.position.x,drop.position.y,drop.position.z,0),token,8);}catch(e){this.check(token);}
   await sleep(400);
  }
 }
 async fuelPlan(count,preferred){
  const b=this.bot;
  const value=n=>n==='coal'||n==='charcoal'?8:(n.endsWith('_planks')||n.endsWith('_log')?1.5:0);
  if(preferred&&!value(preferred))throw Error(preferred+' is not usable fuel');
  const names=preferred?[preferred]:['coal','charcoal',...b.inventory.items().filter(i=>i.name.endsWith('_planks')).map(i=>i.name),...b.inventory.items().filter(i=>i.name.endsWith('_log')).map(i=>i.name)];
  const seen=new Set();let remaining=count;
  for(const n of names){
   if(seen.has(n))continue;seen.add(n);
   const capacity=value(n);if(!capacity)continue;
   const have=this.count(n);if(have<1)continue;
   const use=Math.min(have,Math.ceil(remaining/capacity));
   remaining-=use*capacity;
   if(remaining<=0)return {id:b.registry.itemsByName[n].id,count:use};
  }
  throw Error('Not enough fuel to smelt '+count+' items; needs coal, charcoal, planks or logs');
 }
 async smelt(job,token){
  const b=this.bot,s=job.spec;
  if(s.take)return this.takeSmelt(job,token);
  // Round 11: the batch left in a furnace comes first - walk back, collect it, and keep that
  // furnace standing for this batch (the nearest furnace below is the one just emptied).
  const run=this.furnaceRun;
  if(run){
   this.log('Smelt: collecting the '+run.output+' at '+run.x+','+run.y+','+run.z+' before a new batch');
   try{await this.takeSmelt({spec:{type:'smelt',item:run.item,count:run.count,take:true,keepFurnace:true}},token);}
   catch(e){
    this.check(token);
    if(this.furnaceRun===run)throw Error('The batch at '+run.x+','+run.y+','+run.z+' is not collected yet: '+e.message);
    this.log('Smelt: '+e.message+'; smelting a new batch');
   }
  }
  const input=b.registry.itemsByName[s.item];if(!input)throw Error('Unknown item '+s.item);
  const outputName=SMELTING[s.item]||(s.item.endsWith('_log')?'charcoal':null);
  if(!outputName)throw Error('Unknown smelting output for '+s.item);
  const output=b.registry.itemsByName[outputName];
  if(!output)throw Error('Unknown output item '+outputName);
  // A kept furnace may still hold fuel (efficiency 2): no fuel held is only fatal when no
  // furnace stands near or its fuel slot does not cover the batch (checked once it is open).
  let fuel=null,fuelErr=null;
  try{fuel=await this.fuelPlan(s.count,s.fuel);}catch(e){fuelErr=e;if(!b.findBlock({matching:b.registry.blocksByName.furnace.id,maxDistance:16}))throw e;}
  const before=this.count(outputName);
  let block=null,placedAt=null,placedFurnace=null,left=false,kept=null;
  try{
   block=b.findBlock({matching:b.registry.blocksByName.furnace.id,maxDistance:16});
   if(!block){
    if(!this.count('furnace')){
     const provisioned=await this.ensureTable(token);
     placedAt=provisioned.created;
     const recipe=b.recipesFor(b.registry.itemsByName.furnace.id,null,1,provisioned.block)[0];
     if(!recipe)throw Error('Missing ingredients: need a furnace, or 8 cobblestone to make one');
     const furnaces=this.count('furnace');
     await craftConfirmed(b,recipe,provisioned.block,()=>this.check(token));
     if(this.count('furnace')<=furnaces)throw Error('Crafting a furnace produced no confirmed item');
    }
    block=b.blockAt(placedFurnace=await this.placeBlockNear(token,'furnace'));
   }
   // A furnace the bot placed for an earlier batch and kept standing: this batch picks it up.
   if(!placedFurnace&&this.ownFurnaces?.has(block.position.x+','+block.position.y+','+block.position.z))kept=block.position;
   await this.walk(block.position,token,2);
   this.check(token);
   const furnace=await b.openFurnace(block);
   // The output is taken as it comes (every SMELT_TAKE items) and, when the job ends early
   // (a stop, a reflex, the time limit, a soak bell), whatever is done plus the unsmelted
   // input come back before the window closes: round 3 normal1 ended its iron step with 30
   // raw iron in the furnace and 0 ingots held. The furnace this job placed is picked up
   // below, and breaking it would have spilled them on the ground.
   let taken=0,done=false;
   const out=()=>furnace.outputItem()?.count||0;
   const take=async()=>{const n=out();if(n){await furnace.takeOutput();taken+=n;}};
   try{
    const slot=furnace.fuelItem&&furnace.fuelItem();
    const fuelValue=n=>n==='coal'||n==='charcoal'?8:(/_planks$|_log$/.test(n||'')?1.5:0);
    const covered=slot?Math.floor((slot.count||0)*fuelValue(slot.name)):0;
    if(covered<s.count&&fuelErr)throw fuelErr;
    await furnace.putInput(input.id,null,s.count);
    if(covered<s.count){
     if(slot&&slot.type!==undefined&&slot.type!==fuel.id){try{await furnace.takeFuel();}catch{}} // a mixed slot refuses
     await furnace.putFuel(fuel.id,null,fuel.count);
    }
    if(s.leave){
     // Round 10 (efficiency 1): a furnace works on its own. Loaded, the job ends and the bot
     // does other work nearby; the ladder's take job (furnaceRun) collects the output.
     if(furnace.inputItem&&!furnace.inputItem())throw Error('The furnace did not take the '+s.item);
     const p=block.position;
     // A furnace this bot placed stays its own across runs (a kept furnace reused for the next
     // batch is still picked up by the last take, efficiency 2).
     const own=!!placedFurnace||!!this.ownFurnaces?.has(p.x+','+p.y+','+p.z);
     if(placedFurnace)(this.ownFurnaces||(this.ownFurnaces=new Set())).add(p.x+','+p.y+','+p.z);
     this.furnaceRun={x:p.x,y:p.y,z:p.z,item:s.item,output:outputName,count:s.count,readyAt:Date.now()+s.count*KILN_ITEM_MS+1000,placed:own,started:Date.now()};
     this.log('Smelt: furnace at '+p.x+','+p.y+','+p.z+' loaded with '+s.count+' '+s.item+'; back for the '+outputName+' in ~'+Math.round(s.count*KILN_ITEM_MS/1000)+' s');
     done=true;left=true;
    }
    const deadline=Date.now()+s.count*10000+30000;
    while(!left&&taken+out()<s.count){
     if(Date.now()>deadline)throw Error('Smelting timed out waiting for the output');
     await sleep(1000);this.check(token);
     if(out()>=SMELT_TAKE)await take();
    }
    if(!left){await take();done=true;await sleep(300);}
   }finally{
    if(!done){
     try{await take();}catch{}
     try{if(furnace.inputItem&&furnace.inputItem())await furnace.takeInput();}catch{}
     if(taken)this.log('Smelt ended early: took '+taken+' '+outputName+' and the unsmelted input back');
    }
    try{await b.closeWindow(furnace);}catch{}
   }
  }finally{
   if(placedAt){try{await this.pickUp(placedAt,'crafting_table',token);}catch(e){this.log('Left the crafting table at '+placedAt);}}
   // A furnace this job placed goes back into the inventory like the table: left standing,
   // the ladder's stone step (furnace held or within 16) regressed as soon as the bot
   // walked on, and re-mined 8 cobblestone for a new one.
   if(kept&&!left&&b.inventory.items().some(i=>/_pickaxe$/.test(i.name))){
    try{await this.pickUp(kept,'furnace',token);this.ownFurnaces.delete(kept.x+','+kept.y+','+kept.z);}catch(e){this.log('Left the furnace at '+kept+': '+e.message);}
   }
   if(placedFurnace&&!left){
    // A bare hand breaks a furnace so slowly the drop never lands in the inventory
    // (integration smelt, no pickaxe: block gone, furnace count 0, 2026-10-14).
    // Leave it in the world in that case. With a pickaxe (the ladder, after stone)
    // pick it up so a furnace left within 16 is not treated as already owned.
    const hasPick=b.inventory.items().some(i=>/_pickaxe$/.test(i.name));
    if(hasPick){try{await this.pickUp(placedFurnace,'furnace',token);}catch(e){this.log('Left the furnace at '+placedFurnace+': '+e.message);}}
   }
  }
  if(left)return;
  if(this.count(outputName)<before+s.count)throw Error(`Smelting did not produce ${s.count} ${outputName}`);
  if(b.registry.foodsByName&&b.registry.foodsByName[outputName])this.meals.cooked+=s.count;
 }
 // The take side of a left furnace (smelt take:true): walk back, wait out what is left of the
 // batch (SMELT_TAKE_GRACE past its ready time at most), take the output and any unsmelted
 // input, and pick up a furnace this run placed unless keepFurnace (more cooking ahead).
 async takeSmelt(job,token){
  const b=this.bot,run=this.furnaceRun;
  if(!run)throw Error('No furnace run to collect');
  const at=new Vec3(run.x,run.y,run.z);
  await this.walkToFurnace(run,token);
  const block=b.blockAt(at);
  if(block?.name!=='furnace'){this.furnaceRun=null;throw Error('The furnace at '+at+' is gone');}
  const before=this.count(run.output);
  const furnace=await b.openFurnace(block);
  let taken=0;
  try{
   const until=Math.max(Date.now(),run.readyAt)+SMELT_TAKE_GRACE;
   while(furnace.inputItem&&furnace.inputItem()&&Date.now()<until){await sleep(1000);this.check(token);}
   const n=furnace.outputItem()?.count||0;if(n){await furnace.takeOutput();taken=n;}
   try{if(furnace.inputItem&&furnace.inputItem())await furnace.takeInput();}catch{}
   if(!job.spec.keepFurnace){try{if(furnace.fuelItem&&furnace.fuelItem())await furnace.takeFuel();}catch{}}
  }finally{try{await b.closeWindow(furnace);}catch{}}
  this.furnaceRun=null;
  this.log('Smelt: took '+taken+' '+run.output+' from the furnace at '+at.x+','+at.y+','+at.z+(job.spec.keepFurnace?' (left standing)':''));
  if(run.placed&&!job.spec.keepFurnace&&b.inventory.items().some(i=>/_pickaxe$/.test(i.name))){
   try{await this.pickUp(at,'furnace',token);this.ownFurnaces?.delete(run.x+','+run.y+','+run.z);}catch(e){this.log('Left the furnace at '+at+': '+e.message);}
  }
  if(this.count(run.output)<=before)throw Error('The furnace gave no '+run.output);
  if(b.registry.foodsByName&&b.registry.foodsByName[run.output])this.meals.cooked+=taken;
 }
 // Back to a loaded furnace: the plain walk, then the explore movements (a side job may have
 // left the bot in a pit or up a slope), then anywhere within reach of it. A run whose walks
 // failed FURNACE_TAKE_TRIES times is given up (the batch stays in the world).
 async walkToFurnace(run,token){
  const b=this.bot,at=new Vec3(run.x,run.y,run.z);
  try{await this.walk(at,token,2);this.check(token);return;}
  catch(e){this.check(token);this.log('Smelt: walk back to the furnace at '+run.x+','+run.y+','+run.z+' failed ('+String(e.message).slice(0,60)+'); trying the explore moves');}
  const prev=b.pathfinder?.movements;
  try{
   if(typeof this.exploreMovements==='function')b.pathfinder.setMovements(this.exploreMovements());
   await this.navigate(new goals.GoalNear(at.x,at.y,at.z,3),token,45);this.check(token);return;
  }catch(e){
   this.check(token);
   run.fails=(run.fails||0)+1;
   if(run.fails>=FURNACE_TAKE_TRIES&&this.furnaceRun===run){this.furnaceRun=null;this.log('Smelt: gave up on the batch at '+run.x+','+run.y+','+run.z+' after '+run.fails+' failed walks');}
   throw Error('Could not get back to the furnace at '+run.x+','+run.y+','+run.z+': '+e.message);
  }finally{if(prev&&token===this.epoch)b.pathfinder.setMovements(prev);}
 }
 async sleep(job,token){
  const b=this.bot;
  this.check(token);
  const tod=dayTicks(b)??0;
  if(tod<12541){
   // A survival chain may already have slept this night (dusk preparation): the goal was
   // morning, and early morning (dawn to ~09:00) means the night was handled. Noon-plus
   // submissions are still refused.
   if(tod<=1200)return this.update(job,1,'Night already slept through');
   throw Error('It is daytime; sleep is only possible at night');
  }
  let bed=job.spec.position?b.blockAt(pos(job.spec.position)):null;
  if(bed&&!/_bed$/.test(bed.name))throw Error('No bed at that position');
  if(!bed)bed=b.findBlock({matching:Object.values(b.registry.blocksByName).filter(bl=>/_bed$/.test(bl.name)).map(bl=>bl.id),maxDistance:16});
  let placedBed=null;
  if(!bed){
   const bedItem=b.inventory.items().find(i=>/_bed$/.test(i.name));
   if(!bedItem)throw Error('No bed nearby and none in the inventory');
   bed=b.blockAt(placedBed=await this.placeBlockNear(token,bedItem.name));
  }
  await this.walk(bed.position,token,2);
  try{await b.sleep(bed);}catch(e){
   // A survival chain may already have walked the bot into this bed (its own night rule);
   // the job's goal is morning either way, so being in bed already is not a failure.
   if(!b.isSleeping)throw Error('Server refused sleep: '+e.message);
  }
  this.update(job,1,'Sleeping until morning');
  while(b.isSleeping){await sleep(1000);this.check(token);}
  if(isNight(b))throw Error('Woke up before morning');
  await this.afterSleep(bed,placedBed,token);
 }
 // Habit 5 (round 10): the first bed the bot places becomes its home - the spawn point it just
 // set by sleeping, and the base the ladder comes back to. A bed placed anywhere else is picked
 // up again in the morning, so it travels with the bot for the next night.
 async afterSleep(bed,placedBed,token){
  const ap=this.autopilot,p=bed&&bed.position;
  if(!p)return;
  const home=ap&&ap.home,atHome=home&&home.x===p.x&&home.y===p.y&&home.z===p.z;
  if(ap&&!home){ap.home={x:p.x,y:p.y,z:p.z};ap.save?.();this.log('Home set to the bed at '+p.x+','+p.y+','+p.z+' (spawn point)');return;}
  if(atHome){this.log('Slept at home ('+p.x+','+p.y+','+p.z+'); spawn point there');return;}
  if(placedBed){
   try{await this.pickUp(new Vec3(placedBed.x,placedBed.y,placedBed.z),bed.name,token);this.log('Picked the bed back up at '+placedBed.x+','+placedBed.y+','+placedBed.z+' (home is elsewhere)');}
   catch(e){this.check(token);this.log('Left the bed at '+placedBed.x+','+placedBed.y+','+placedBed.z+': '+e.message);}
  }
 }
 // A meal is a food-bar rise within 5 s of a consume. Every eat path (eat job, reflex,
 // FoodChain, the fight's disengage-eat) goes through bot.consume; a respawn's full bar or
 // an effect is not a meal. The soak diffs these counters per run (M4 food, measured).
 trackMeals(bot){
  // Round 9: bot.consume exists only after mineflayer's 'inject_allowed' (afterInject); the
  // wrap used to run before it and counted no meal live (eaten 0 on every soak run).
  afterInject(bot,'consume',()=>{
   if(bot.consume.__tracked)return;
   const consume=bot.consume.bind(bot);
   bot.consume=(...args)=>{this._consumeAt=Date.now();this._consumeItem=bot.heldItem&&bot.heldItem.name||null;return consume(...args);};
   bot.consume.__tracked=true;
  });
  let last=null;
  bot.on('health',()=>{
   const food=bot.food;
   if(typeof food!=='number')return;
   if(last!=null&&food>last&&Date.now()-(this._consumeAt||0)<5000){
    this.meals.eaten++;this.meals.points+=food-last;
    const item=this._consumeItem||'unknown';this.meals.items[item]=(this.meals.items[item]||0)+1;
    this._consumeAt=0;
   }
   last=bot.health>0?food:null;
  });
  bot.on('death',()=>{last=null;});
 }
 async retreatSprint(token,target,seconds=3){
  // Plain sprint away from the threat; no pathfinder goal means nothing left running can
  // fight the flee for control. A reflex or user stop that moved the epoch owns the
  // pathfinder now: leave its navigation alone and just return.
  const b=this.bot;
  if(token!==this.epoch)return;
  b.pathfinder.stop();b.pathfinder.setGoal(null);b.clearControlStates();
  await sleep(60);
  // Away from the target and every other hostile near, never into water, lava or a deep
  // drop (night.js fleeHeading; round 4 drowned fleeing). Every heading wet: stand.
  const me=b.entity.position;
  const near=Object.values(b.entities||{}).filter(e=>e&&e!==b.entity&&e.type==='hostile'&&e.position&&e.position.distanceTo(me)<=16);
  if(target&&target.position&&!near.includes(target))near.push(target);
  const h=near.length?fleeHeading((x,y,z)=>b.blockAt(new Vec3(x,y,z)),me,near,{inWater:!!b.entity.isInWater}):{x:1,z:0,blocked:false};
  try{await b.look(Math.atan2(-h.x,-h.z),0,false);}catch{}
  if(h.blocked)return;
  b.setControlState('sprint',true);b.setControlState('forward',true);
  const fleeEnd=Date.now()+seconds*1000;
  try{while(Date.now()<fleeEnd&&b.health>0){await sleep(100);this.check(token);}}finally{b.clearControlStates();}
 }
 // Run one combat step through the task tree: the FightTask is returned as a child of the
 // UserTaskChain, whose runner owns the pathfinder and controls (the single-owner rule).
 // The bridge enforces the JOB contract on the side (token, deadline, health < 8 retreat)
 // while the tree drives the CombatController one step per tick. Preemption works like any
 // reflex: a survival chain pauses the job through worker.stop, the runner stops the tree
 // (FightTask.onStop lowers the shield and clears the controls), and the cadence bridge
 // resumes the job when the chain yields.
 async combatTask(job,token,mk,{timeoutMs=0,timeoutMessage='Fight timed out'}={}){
  const b=this.bot;
  const chain=this.userChain||((this.taskRunner&&this.taskRunner.chains||[]).find(c=>c.name==='User Tasks'));
  if(!chain||typeof chain.runTask!=='function')throw Error('User task chain unavailable');
  if(chain.root)try{chain.cancel(b);}catch{} // a superseded task: its stale bridge settles as cancelled
  const task=mk();
  this.update(job,job.progress||0,'Fighting via the task tree');
  const settled=new Promise((resolve,reject)=>{
   chain.runTask(task,result=>{result&&result.cancelled?reject(new Error('Combat task interrupted')):resolve(result);});
  });
  const deadline=timeoutMs>0?Date.now()+timeoutMs:0;
  let timer=null;
  const guard=new Promise((_,reject)=>{
   timer=setInterval(()=>{
    try{
     if(deadline&&Date.now()>deadline){if(timer)clearInterval(timer);timer=null;const err=Error(timeoutMessage);err.code='COMBAT_TIMEOUT';reject(err);return;}
     this.check(token);
    }catch(e){if(timer){clearInterval(timer);timer=null;}reject(e);return;}
    if(b.health<8){if(timer)clearInterval(timer);timer=null;const err=Error('low health');err.code='HEALTH_RETREAT';reject(err);}
   },250);
  });
  if(timer&&timer.unref)timer.unref();
  try{
   await Promise.race([settled,guard]);
  }catch(e){
   if(e.code==='HEALTH_RETREAT'){
    await this.retreatSprint(token,task.controller&&task.controller.target||null);
    throw Error('Health below 8; retreated from '+(task.controller&&task.controller.target&&task.controller.target.name||'the fight'));
   }
   throw e;
  }finally{
   clearInterval(timer);
   // Settled paths leave the tree in place (SingleTaskChain pops a finished root on the
   // runner's next tick); on OUR failure paths nothing owns the fight any more - stop it.
   try{if(chain.root===task)chain.cancel(b);}catch{}
  }
  this.check(token);
  const ctl=task.controller;
  if(ctl){ // the fight summary rides on the job message: event-buffer flushes cannot lose it
   const st=ctl.stats,t=ctl.target;
   this.update(job,100,'Fought: '+(t&&t.name||'no target')+' tactic='+(ctl.tactic&&ctl.tactic.style||'none')
    +' hits='+st.hits+' crits='+st.crits+' sweeps='+st.sweeps+' shots='+st.shots+' released='+(st.released||0)+' landed='+(st.landed||0)
    +' damage taken='+Math.round(st.damageTaken*10)/10);
  }
  return ctl?ctl.stats:null;
 }
 async fight(job,token){
  const b=this.bot,s=job.spec;
  const tier={wooden:1,golden:2,stone:3,iron:4,diamond:5,netherite:6},kind={sword:4,axe:3,pickaxe:2,shovel:1};
  const weaponOf=name=>{const m=/^(wooden|golden|stone|iron|diamond|netherite)_(sword|axe|pickaxe|shovel)$/.exec(name);return m?tier[m[1]]*10+kind[m[2]]:null;};
  let weapon=null;
  for(const i of b.inventory.items()){
   const rank=weaponOf(i.name);
   if(rank&&(!weapon||rank>weapon.rank))weapon={rank,item:i,name:i.name};
  }
  const shield=b.inventory.items().find(i=>i.name==='shield');
  if(shield){const p=b.equip(shield,'off-hand');p&&p.catch&&p.catch(()=>{});}
  this.check(token);
  // A named passive entity is a HUNT: only that entity type is targeted and hostiles are
  // left to the threat reflex. Without a name (or for a named hostile) it is a FIGHT and
  // COMBAT_SPEC 7f applies: a real weapon is required - the bot never swings holding a
  // block, food or its fist - and an unarmed fight retreats and hands control to the
  // threat policy (flee / shelter / get armed).
  const namedHostile=s.entity&&b.registry.entitiesByName[s.entity]?.type==='hostile';
  const hostileTargets=!s.entity||namedHostile;
  if(hostileTargets&&!weapon){
   await this.retreatSprint(token,null);
   throw Error('Unarmed; retreated from the fight - threat policy takes over (flee/shelter/get armed)');
  }
  // Passive hunts scan far (48): the food step sees animals through animalsNearby at 48,
  // so a 16-block engagement window starved the hunt (the ladder saw a cow, the fight job
  // found nothing inside 16 and timed out - M4 food 0/6 in soaks 4-5).
  const huntRange=hostileTargets?16:48;
  const threats=()=>Object.values(b.entities).filter(e=>e!==b.entity&&e.position&&e.position.distanceTo(b.entity.position)<=huntRange&&(hostileTargets?e.type==='hostile':e.name===s.entity)).sort((a,c)=>a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position));
  // Every style runs through the runner-owned FightTask now: the legacy in-job attack loop
  // is retired (parity proven - the full integration suite's fight tests and the measured
  // combat acceptance both ran on this path). style 'plain' = full-charge swings without
  // the crit rhythm; auto/melee/bow pick tactics per docs/COMBAT_SPEC.md 7c.
  const style=s.style||'auto';
  try{
   await this.combatTask(job,token,()=>new FightTask({
    move:this.move,
    log:m=>{try{this.log(m);}catch{}},
    // A hunt kills exactly the nearest animal (lockFirst): "clear every chicken within
    // 48" timed out on any flock, and a timed-out hunt used to throw before the sweep.
    opts:{entityFilter:s.entity||null,range:huntRange,lockFirst:!hostileTargets||undefined,forceStyle:style!=='auto'?style:null,
     // A named enderman fight is provoked by definition (7c: never provoked by looking).
     provoked:s.entity==='enderman'||undefined,
     // The ablation harness toggles primitives per fight (tests/combat_ablation.py).
     primitives:s.primitives||undefined}}),
   {timeoutMs:Math.min(s.maxSeconds??30,120)*1000});
  }catch(e){
   // A passive hunt sweeps its own kills even when the chase timed out (earlier kills of
   // the same job still lie on the ground); a stop or preemption skips the sweep.
   if(!hostileTargets&&e.code==='COMBAT_TIMEOUT')await this.huntSweep(token);
   if(e.code==='COMBAT_TIMEOUT'){
    const left=threats();
    throw Error('Fight timed out; '+(left[0]&&(left[0].name||'a hostile')||'a hostile')+' is still standing');
   }
   throw e;
  }
  // A passive hunt sweeps its own kills: the next collect job queues behind whatever
  // survival tree is still active (soak 7 hard1: the collect sat queued for 150 s while
  // night mobs kept Mob Defense alive and the drops despawned - food stayed 0/6).
  if(!hostileTargets)return this.huntSweep(token);
  const left=threats();
  if(left.length)throw Error('Fight timed out; '+(left[0].name||'a hostile')+' is still standing');
 }
 async huntSweep(token){try{await this.sweepDrops(token,16);}catch(e){this.check(token);}}
 // Night shelter (cloud round 5). Starts at sunset (night.js SUNSET), digs dirt when short,
 // then seals a 3x3x3 box around the bot's 2-high cell: feet ring, head ring, the full roof
 // and an open floor (night.js shelterShell). Placement runs in passes, so cells anchor on
 // cells placed earlier; a mob standing in a cell is hit, never built into. Once sealed the
 // bot never leaves: the survival gate keeps Mob Defense off (world threats still win), the
 // Food chain may eat, and this loop hits only a mob inside or at a gap, then re-seals.
 // Round 4: 'Pause trace: shelter -> Reflex: preempted by Mob Defense', then shot twice.
 async shelter(job,token){
  const b=this.bot;
  this.check(token);
  if(!darkNow(dayTicks(b))){
   // Resumed after dawn with a box still standing: take it down once the morning is safe
   // (the night was survived); before that, re-seal and hold it.
   if(!(job.placed&&job.placed.length))return;
   if(this.shelterExitSafe()){await this.removeShelter(job,token);return;}
  }
  // Every shelter block counts (a mix of cobble and dirt is fine); cobble the autopilot's
  // unfinished stone kit still needs (cobbleReserve) is spent only as the last resort.
  const here=()=>b.entity.position.floored();
  if(this.shelterStock()<this.shelterNeed(here()))await this.digShelterDirt(job,token,()=>this.shelterNeed(here()));
  const origin=here(),at=(x,y,z)=>b.blockAt(new Vec3(x,y,z));
  const need=this.shelterNeed(origin),held=this.shelterStock(true);
  // Round 9: short for the box, a 1x1 pod (shelterShell pod) before the night pillar.
  job.pod=false;
  if(held<need){
   const pod=this.shelterNeed(origin,true);
   if(held<pod){this.log('Shelter: a 1x1 pod would need '+pod+' here');this.shelterFallback(job,'Short of shelter blocks: '+held+' held, '+need+' needed at '+origin);}
   job.pod=true;this.log('Shelter: '+held+' blocks held, '+need+' for the box; sealing a 1x1 pod ('+pod+') at '+origin);
  }
  // A world-survival escape (water, fire) may resume the job somewhere else: the old box
  // stays where it stands and a new one goes up here.
  if(job.origin&&!origin.equals(pos(job.origin))){
   this.log('Shelter: moved from '+job.origin.x+','+job.origin.y+','+job.origin.z+' to '+origin+'; building a new box here');
   job.abandoned=(job.abandoned||[]).concat(job.placed||[]);job.shell=null;job.placed=[];
  }
  job.origin={x:origin.x,y:origin.y,z:origin.z};
  const {required,support}=shelterShell(origin,job.pod);
  // The SHELL is recorded, not just this run's placements: a resumed run skips cells that
  // are already filled (by an interrupted earlier attempt), and the cleanup must dig those too.
  // Only cells that were open on the first attempt belong to it: a hillside's natural blocks
  // are never dug at dawn (the job removes only what it placed).
  if(!job.shell)job.shell=required.concat(support).filter(c=>at(c.x,c.y,c.z)?.boundingBox!=='block');
  if(!job.placed)job.placed=[];
  this.update(job,0,'Sealing the shelter at '+origin);
  await this.centreInCell(origin,token);
  try{await this.sealShelter(job,token,origin,Date.now()+SHELTER_SEAL_MS);}
  catch(e){
   this.check(token);
   const gaps=/^Could not seal/.test(e.message)?shellGaps(at,required):null;
   if(!gaps||!holdableShell(origin,gaps))this.shelterFallback(job,e.message);
   this.log('Shelter: '+gaps.length+' open cell(s) left at '+gaps.map(g=>g.x+','+g.y+','+g.z).join(' ')+' under a closed roof; holding the box and re-sealing');
  }
  this.save();this.update(job,required.length,'Waiting for morning (sealed)');
  this.log('Shelter: sealed at '+origin+' ('+job.placed.length+' blocks placed)');
  this.shelterSealed=true;this.shelterSpot={x:origin.x,y:origin.y,z:origin.z};this.nightPillar=null;
  // Round 11: the box only shelters a bot inside it. Out of the cell (a night mine that could
  // not climb home, a world-survival move) for SHELTER_AWAY_MS, it seals where it stands.
  let away=null,outSince=null;
  try{
   while(!this.shelterExitSafe()){
    await sleep(250);this.check(token);
    if(!here().equals(origin)){if(outSince==null)outSince=Date.now();if(Date.now()-outSince>=SHELTER_AWAY_MS){away='the bot left the cell';break;}continue;}
    outSince=null;
    await this.guardShelter(job,token,origin);
    const tod=dayTicks(b);
    // Habit 4: use the night - a staircase mine under the box, back before dawn.
    if(!job.nightMined&&nightMineWanted({tod,pod:job.pod,pickaxe:b.inventory.items().some(i=>/^(stone|iron|diamond|netherite)_pickaxe$/.test(i.name)),blocks:this.shelterStock(true),enabled:this.config?.nightMine!==false,health:b.health})){
     job.nightMined=true;this.save();
     let r=null;
     try{r=await this.nightMine(job,token,origin);}catch(e){this.check(token);this.log('Night mine: '+e.message);}
     finally{this.shelterSealed=true;}
     if(r==='away'){away='the night mine could not climb home';break;}
    }
    if(!darkNow(tod)&&!job.dawnLogged){job.dawnLogged=true;this.update(job,required.length,'Dawn: waiting for a safe morning (sealed)');this.log('Shelter: dawn (tod '+tod+'); staying sealed until the morning is light and clear');}
   }
  }finally{this.shelterSealed=false;}
  if(away){
   this.log('Shelter: not in the box at '+origin+' ('+away+'; bot at '+here()+'); sealing where it stands');
   this.shelterSpot=null;this.save();
   return this.shelter(job,token);
  }
  this.log('Shelter: morning (tod '+dayTicks(b)+', nearest hostile '+(Number.isFinite(this.nearestHostile())?this.nearestHostile().toFixed(1):'none')+'); opening up');
  this.shelterSpot=null;
  await this.removeShelter(job,token);
 }
 // Habit 4: a night mine from inside the sealed box. The box's interior is the bot's own 1x2
 // column, so a staircase from the feet would cut its walls: the bot first sinks a 2-deep sump
 // through the floor (each dig checked like a tunnel step: solid ground two below, no fluid
 // beside it, natural or its own blocks only), then staircases from the sump's bottom (that
 // first step cuts only the support row under the walls - the box stays sealed above), mines
 // the walls on the way and a strip at the bottom, and turns back on the time budget, at
 // NIGHT_MINE_STOP, under 14 health or when the tunnel opens onto a cave (tunnelBreach). Home
 // is the tunnel, then the pathfinder's own 1x1 tower back into the shelter cell (it refills
 // the floor). Mob Defense answers anything in the tunnel meanwhile (shelterSealed off).
 async nightMine(job,token,origin){
  const b=this.bot,at3=(x,y,z)=>b.blockAt(new Vec3(x,y,z)),k=p=>p.x+','+p.y+','+p.z;
  const start=Date.now(),f1=origin.offset(0,-1,0),f2=origin.offset(0,-2,0);
  const ours=new Set((job.placed||[]).map(k));
  for(const cell of [f1,f2]){
   const foot=stepFooting(at3,cell);
   if(!foot.ok){this.log('Night mine: not from here ('+(foot.turn||'no floor under '+cell)+')');return false;}
   for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]])if(isFluid(at3(cell.x+dx,cell.y,cell.z+dz))){this.log('Night mine: not from here (fluid beside '+cell+')');return false;}
   const bl=at3(cell.x,cell.y,cell.z);
   if(bl&&bl.boundingBox==='block'){
    if(!naturalTerrain(bl)&&!ours.has(k(cell))){this.log('Night mine: not from here ('+bl.name+' under the shelter is not natural)');return false;}
    if(bl.harvestTools&&!(bl.hardness<=HAND_CLEAR_HARDNESS)&&!Object.keys(bl.harvestTools).some(id=>b.inventory.items().some(i=>i.type===+id))){this.log('Night mine: no tool for '+bl.name);return false;}
    if(cell===f1){this.shelterSealed=false;this.log('Night mine: down from the shelter at '+origin+' (tod '+dayTicks(b)+')');}
    await b.tool.equipForBlock(bl);this.check(token);
    if(bl.material==='incorrect_for_wooden_tool')bl.material='mineable/pickaxe';
    await b.dig(bl);
   }
   const until=Date.now()+2000;
   while(b.entity.position.floored().y>cell.y&&Date.now()<until){await sleep(100);this.check(token);}
   if(b.entity.position.floored().y!==cell.y)throw Error('did not drop into '+cell);
  }
  this.shelterSealed=false;
  const mine={id:job.id+':night',tunnel:[{x:f2.x,y:f2.y,z:f2.z}],mined:[]};
  const known=()=>{
   const set=new Set([origin,origin.offset(0,1,0),f1,f2].map(k));
   for(const p of mine.tunnel)for(let dy=0;dy<=2;dy++)set.add(p.x+','+(p.y+dy)+','+p.z);
   for(const m of mine.mined)set.add(m);
   return set;
  };
  let why=null;
  const stop=()=>{
   if(Date.now()-start>=NIGHT_MINE_MS)return why='time budget';
   const tod=dayTicks(b);if(tod!=null&&(tod>=NIGHT_MINE_STOP||tod<SUNSET))return why='dawn coming';
   if(b.health<14)return why='health '+Math.round(b.health);
   const breach=tunnelBreach(at3,b.entity.position.floored(),known());
   if(breach)return why='opened onto a cave at '+k(breach);
   return null;
  };
  const ores=()=>['coal','raw_iron','diamond','raw_copper','raw_gold'].reduce((a,n)=>a+this.count(n),0);
  const before=ores();
  try{
   await this.staircase(mine,token,f2.y-NIGHT_MINE_DEPTH,{stopWhen:stop});
   if(!why)await this.stripMine(mine,token,NIGHT_MINE_STRIP,{stopWhen:stop});
  }catch(e){this.check(token);why=why||e.message;}
  const home=await this.nightMineReturn(mine,token,origin);
  const tally=mine.tunnel.length+' steps, '+(ores()-before)+' ore items, '+(mine.wallPickups||0)+' wall digs';
  if(!home){this.log('Night mine: not back in the shelter ('+(why||'done')+'; '+tally+'); bot at '+b.entity.position.floored()+', the box is at '+origin);return 'away';}
  this.log('Night mine: back in the shelter ('+(why||'done')+'; '+tally+')');
  return true;
 }
 // Round 11 (hard1: `could not climb back into (163,121,34): No path to the goal!`, then `back
 // in the shelter` in the same second while the bot stood 16 blocks away and the re-seal
 // found the sump open for 7 min). Home is checked, never assumed: the recorded tunnel by the
 // pathfinder, the pathfinder's tower into the cell, the tunnel again cell by cell by hand
 // (jumping each stair), then a jump-placed pillar up the sump. True only with the bot's feet
 // in the shelter cell; the caller seals where the bot stands otherwise.
 async nightMineReturn(mine,token,origin){
  const b=this.bot,feet=()=>b.entity.position.floored();
  const home=()=>feet().equals(origin);
  try{await this.climbTunnel(mine,token);if(this.strandedTunnel?.job===mine.id)this.strandedTunnel=null;}
  catch(e){this.check(token);this.log('Night mine: climb back failed: '+e.message);}
  if(home())return true;
  const prev=b.pathfinder.movements;b.pathfinder.setMovements(this.exploreMovements());
  try{await this.navigate(new goals.GoalBlock(origin.x,origin.y,origin.z),token,20);}
  catch(e){this.check(token);this.log('Night mine: could not climb back into '+origin+': '+e.message);}
  finally{if(token===this.epoch)b.pathfinder.setMovements(prev);}
  if(home())return true;
  const inSump=()=>{const p=feet();return p.x===origin.x&&p.z===origin.z&&p.y<origin.y&&p.y>=origin.y-3;};
  if(!inSump()){
   this.log('Night mine: walking the tunnel back by hand from '+feet());
   await this.walkTunnelBack(mine.tunnel,token);
  }
  if(inSump()){
   this.log('Night mine: pillaring up the sump from y='+feet().y);
   await this.pillarUp(origin.y,token);
  }
  return home();
 }
 // The recorded tunnel walked cell by cell without the pathfinder: from the tunnel point
 // nearest the bot back to the first, forward plus a jump on each stair up. Stops at a cell
 // it cannot reach in TUNNEL_WALK_MS.
 async walkTunnelBack(tunnel,token){
  const b=this.bot,pts=(tunnel||[]).map(p=>new Vec3(p.x,p.y,p.z));
  const here=b.entity.position.floored();
  let i=-1,best=Infinity;
  pts.forEach((p,j)=>{const d=p.distanceTo(here);if(d<=best){best=d;i=j;}});
  if(i<0||best>2)return false;
  for(;i>=0;i--){
   this.check(token);
   const p=pts[i];
   if(b.entity.position.floored().equals(p))continue;
   const up=p.y>b.entity.position.floored().y,dx=p.x+0.5-b.entity.position.x,dz=p.z+0.5-b.entity.position.z;
   try{await b.look(Math.atan2(-dx,-dz),0);}catch{}
   if(up)b.setControlState('jump',true);b.setControlState('forward',true);
   const deadline=Date.now()+TUNNEL_WALK_MS;
   try{while(Date.now()<deadline&&!b.entity.position.floored().equals(p)){await sleep(80);this.check(token);}}
   finally{if(token===this.epoch)b.clearControlStates();}
   await sleep(150);
   if(!b.entity.position.floored().equals(p))return false;
  }
  return true;
 }
 // Stand under (or beside) a log out of reach overhead and pillar up until it is 3 above the
 // feet (in reach from the column or the one beside it). Leaves over the head are dug.
 async pillarToLog(job,token,log){
  const b=this.bot,under=()=>{const f=b.entity.position.floored();return Math.abs(f.x-log.x)<=1&&Math.abs(f.z-log.z)<=1;};
  const goUnder=async()=>{try{await this.walk(new Vec3(log.x,Math.floor(b.entity.position.y),log.z),token,1,20);}catch(e){this.check(token);}};
  await goUnder();
  if(!under()){this.log('Gather: could not stand under the canopy log at '+log);return false;}
  const rise=()=>log.y-3-b.entity.position.floored().y;
  if(rise()<=0)return true;
  if(rise()>TRUNK_PILLAR)return false;
  if(this.shelterStock(true)<rise()){
   const need=rise();
   await this.digShelterDirt(job,token,()=>need,'Digging dirt to pillar up to the canopy');
   if(this.shelterStock(true)<need){this.log('Gather: no blocks to pillar up to the canopy log at '+log);return false;}
   await goUnder();if(!under())return false;
  }
  this.log('Gather: pillaring '+rise()+' up to the canopy log at '+log);
  return this.pillarUp(log.y-3,token,{clear:bl=>/_leaves$/.test(bl.name)});
 }
 // Jump-place held blocks under the feet until the feet stand at targetY: hold jump, place on
 // the block under the old feet cell at the apex, land. Never into a ceiling (the cell above
 // the head must be open, or a block `clear` accepts, which is dug); three tries per level.
 async pillarUp(targetY,token,{clear=null}={}){
  const b=this.bot;
  let digs=0;
  for(let tries=0;b.entity.position.floored().y<targetY&&tries<3;){
   this.check(token);
   const f=b.entity.position.floored(),y0=f.y;
   const roof=b.blockAt(f.offset(0,2,0));
   if(roof?.boundingBox==='block'){
    if(!clear||!clear(roof)||++digs>TRUNK_PILLAR){this.log('Pillar: ceiling at '+f.offset(0,2,0));return false;}
    await b.dig(roof);this.check(token);continue;
   }
   const item=b.inventory.items().find(i=>SHELTER_ITEMS.includes(i.name));
   const ref=b.blockAt(f.offset(0,-1,0));
   if(!item||ref?.boundingBox!=='block')return false;
   await b.equip(item,'hand');this.check(token);
   try{if(b.pathfinder?.goal)b.pathfinder.setGoal(null);}catch{} // a stale goal clears the controls every tick
   b.setControlState('jump',true);
   const deadline=Date.now()+1000;
   while(b.entity.position.y<y0+1&&Date.now()<deadline){await sleep(30);this.check(token);}
   try{if(b.entity.position.y>=y0+1)await b.placeBlock(ref,new Vec3(0,1,0));}catch{}
   if(token===this.epoch)b.clearControlStates();
   await sleep(400);
   if(b.entity.position.floored().y>y0)tries=0;else tries++;
  }
  return b.entity.position.floored().y>=targetY;
 }
 // The sealed box opens once the morning is light and clear (night.js leaveRefuge), or when
 // the job's own deadline is SHELTER_EXIT_MARGIN_MS away (a timed-out job leaves the box up).
 shelterExitSafe(){
  if(Number.isFinite(this.deadline)&&this.deadline-Date.now()<SHELTER_EXIT_MARGIN_MS)return true;
  return leaveRefuge(dayTicks(this.bot),this.nearestHostile());
 }
 nearestHostile(){
  const b=this.bot,me=b.entity&&b.entity.position;
  if(!me)return Infinity;
  let best=Infinity;
  for(const e of Object.values(b.entities||{}))if(e&&e!==b.entity&&e.type==='hostile'&&e.position&&e.isValid!==false)best=Math.min(best,e.position.distanceTo(me));
  return best;
 }
 // Shelter blocks held beyond the stone kit's cobble reserve (all of them with reserve=true).
 shelterStock(reserve=false){return SHELTER_ITEMS.reduce((a,n)=>a+this.count(n),0)-(reserve?0:Math.min(this.count('cobblestone'),this.cobbleReserve||0));}
 // Blocks the box needs where the bot stands: the open shell cells, plus a support cell under
 // each feet-ring cell nothing can anchor (a pillar top, a ledge).
 shelterNeed(origin,pod=false){
  const b=this.bot,at=(x,y,z)=>b.blockAt(new Vec3(x,y,z));
  const {required,support}=shelterShell(origin,pod);
  const gaps=shellGaps(at,required),{stuck}=placementPlan(at,gaps);
  return gaps.length+support.filter(c=>stuck.some(g=>g.x===c.x&&g.z===c.z&&g.y===c.y+1)&&at(c.x,c.y,c.z)?.boundingBox!=='block').length;
 }
 // Short of blocks: dig dirt/grass within 24 for at most SHELTER_DIG_MS. Every tried spot is
 // spent (walk failed, undiggable, water above, or dug), so one unreachable block can no
 // longer hold the job all night.
 async digShelterDirt(job,token,need,label='Digging dirt for the shelter'){
  const b=this.bot,until=Date.now()+SHELTER_DIG_MS,tried=new Set();
  const ids=[b.registry.blocksByName.dirt?.id,b.registry.blocksByName.grass_block?.id].filter(x=>x!==undefined);
  this.update(job,0,label);
  while(this.shelterStock()<need()&&Date.now()<until){
   this.check(token);
   const spot=(b.findBlocks({matching:ids,maxDistance:24,count:64})||[]).map(p=>b.blockAt(p))
    .find(bl=>bl&&!tried.has(bl.position.toString())&&!['lava','water'].includes(b.blockAt(bl.position.offset(0,1,0))?.name));
   if(!spot)break;
   tried.add(spot.position.toString());
   try{
    await this.walk(spot.position,token,2,Math.max(1,Math.min(15,(until-Date.now())/1000)));
    await b.tool.equipForBlock(spot);this.check(token);
    if(!b.canDigBlock(spot))continue;
    await b.dig(spot);await sleep(400);await this.sweepDrops(token);
   }catch(e){this.check(token);}
  }
 }
 // The shelter cannot go up: fail with the reason and leave tonight to the night pillar
 // (Mob Defense climbs 3 and holds until morning; nightPillarWanted).
 shelterFallback(job,reason){
  this.nightPillar={t:Date.now(),reason};
  this.log('Shelter: '+reason+'; night pillar instead');
  throw Error(reason+'; night pillar instead');
 }
 // Tonight's shelter failed (shelterFallback): Mob Defense pillars without waiting for a crowd.
 nightPillarWanted(bot=this.bot){return !!this.nightPillar&&Date.now()-this.nightPillar.t<NIGHT_PILLAR_MS&&darkNow(dayTicks(bot));}
 // Dirt first while the kit still needs cobble; reserved cobble only as the last resort (a
 // sealed box outranks the furnace).
 shelterItem(){
  const items=this.bot.inventory.items(),spare=this.count('cobblestone')-(this.cobbleReserve||0);
  const order=spare>0?SHELTER_ITEMS:[...SHELTER_ITEMS.filter(n=>n!=='cobblestone'),'cobblestone'];
  for(const n of order){const i=items.find(x=>x.name===n&&x.count>0);if(i)return i;}
  return null;
 }
 // Entities whose box overlaps a cell block a placement there (items and arrows do not).
 cellOccupant(cell){
  const b=this.bot;
  return Object.values(b.entities||{}).find(e=>e&&e!==b.entity&&e.position&&e.isValid!==false&&!/^(item|experience_orb|arrow|spectral_arrow|trident)$/.test(e.name||'')
   &&Math.abs(e.position.x-(cell.x+0.5))<0.5+(e.width||0.6)/2&&Math.abs(e.position.z-(cell.z+0.5))<0.5+(e.width||0.6)/2
   &&e.position.y<cell.y+1&&e.position.y+(e.height||1.8)>cell.y)||null;
 }
 async sealShelter(job,token,origin,deadline=Infinity){
  const b=this.bot,at=(x,y,z)=>b.blockAt(new Vec3(x,y,z));
  const {required,support}=shelterShell(origin,job.pod);
  for(let pass=0;pass<8&&Date.now()<deadline;pass++){
   this.check(token);
   const gaps=shellGaps(at,required);
   if(!gaps.length)return;
   let {plan,stuck}=placementPlan(at,gaps);
   if(!plan.length){
    // Nothing anchors the rest (a pillar top, a ledge): support under the stuck feet-ring cells.
    plan=placementPlan(at,support.filter(c=>stuck.some(g=>g.x===c.x&&g.z===c.z&&g.y===c.y+1))).plan;
    if(!plan.length)break;
   }
   for(const {cell} of plan){
    this.check(token);
    if(Date.now()>=deadline)break;
    if(at(cell.x,cell.y,cell.z)?.boundingBox==='block')continue;
    const occupant=this.cellOccupant(cell);
    if(occupant){if(occupant.type==='hostile')await this.shelterStrike(occupant,token);continue;}
    // Round 7 hard2: `2 open cells, first at 158,154,-8` - a feet/head pair on one side. A
    // bot off its cell centre overlaps the neighbour column and the server refuses those
    // placements: step back to the centre first.
    if(hitsBot(b.entity.position,cell.x,cell.y,cell.z)&&!(await this.centreInCell(origin,token)))continue;
    await this.placeShelterBlock(job,cell,token);
   }
   if(pass)await sleep(250);
  }
  const left=shellGaps(at,required);
  if(left.length)this.log('Shelter: open cells '+left.map(c=>c.x+','+c.y+','+c.z+'='+(at(c.x,c.y,c.z)?.name||'unloaded')).join(' ').slice(0,200)+' (bot at '+b.entity.position.x.toFixed(2)+','+b.entity.position.z.toFixed(2)+')');
  if(left.length)throw Error('Could not seal the shelter'+(Date.now()>=deadline?' in '+Math.round(SHELTER_SEAL_MS/1000)+' s':'')+': '+left.length+' open cells, first at '+left[0].x+','+left[0].y+','+left[0].z);
 }
 async placeShelterBlock(job,cell,token){
  const b=this.bot,point=new Vec3(cell.x,cell.y,cell.z);
  // Dig a notch: a mushroom or flower in the cell refuses the placement.
  const inCell=b.blockAt(point);
  if(inCell&&SHELTER_NOTCH.test(inCell.name||'')){
   try{if(!b.canDigBlock||b.canDigBlock(inCell)){await b.dig(inCell);await sleep(80);}}catch(e){this.check(token);}
  }
  for(const direction of [new Vec3(0,-1,0),new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1),new Vec3(0,1,0)]){
   const neighbor=b.blockAt(point.minus(direction));
   if(neighbor?.boundingBox!=='block')continue;
   const item=this.shelterItem();
   if(!item)throw Error('Ran out of shelter blocks');
   if(b.heldItem?.name!==item.name)await b.equip(item,'hand');
   try{await b.placeBlock(neighbor,direction);await sleep(120);}catch(e){this.check(token);continue;}
   if(b.blockAt(point)?.boundingBox==='block'){job.placed.push({x:cell.x,y:cell.y,z:cell.z});return true;}
  }
  return false;
 }
 // Sneak back to the middle of `origin`'s cell (the box's feet and head ring must not
 // overlap the bot). True when within 0.2 of the centre.
 async centreInCell(origin,token,ms=1500){
  const b=this.bot,cx=origin.x+0.5,cz=origin.z+0.5;
  const off=()=>Math.hypot(b.entity.position.x-cx,b.entity.position.z-cz);
  if(off()<=0.2)return true;
  if(typeof b.setControlState!=='function')return false;
  const end=Date.now()+ms;
  try{
   b.setControlState('sneak',true);
   while(off()>0.12&&Date.now()<end){
    this.check(token);
    const p=b.entity.position;
    try{await b.look(yawToward(cx-p.x,cz-p.z),0,true);}catch{}
    b.setControlState('forward',true);
    await sleep(50);
   }
  }finally{try{b.setControlState('forward',false);b.setControlState('sneak',false);}catch{}}
  return off()<=0.2;
 }
 // One swing at a mob inside the box or at a gap: best weapon, full charge, no movement.
 async shelterStrike(entity,token){
  const b=this.bot,now=Date.now();
  const weapon=bestWeapon(b,{allowPickaxe:true});
  if(now-(this.shelterSwingAt||0)<attackCooldown(weapon&&weapon.name)*1000)return;
  if(weapon&&b.heldItem?.name!==weapon.name){await b.equip(weapon,'hand');this.check(token);}
  this.shelterSwingAt=Date.now();
  try{await b.lookAt(entity.position.offset(0,(entity.height||1.8)*0.8,0),true);}catch{}
  try{await b.attack(entity);}catch{}
 }
 async guardShelter(job,token,origin){
  const b=this.bot,at=(x,y,z)=>b.blockAt(new Vec3(x,y,z));
  const gaps=shellGaps(at,shelterShell(origin,job.pod).required);
  const me=b.entity.position;
  const hostiles=Object.values(b.entities||{}).filter(e=>e&&e!==b.entity&&e.type==='hostile'&&e.position&&e.isValid!==false&&e.position.distanceTo(me)<=6&&!leaveAlone(e,b));
  const target=shelterTarget(hostiles,origin,gaps);
  if(target){
   if(Date.now()-(this.shelterGuardLog||0)>5000){this.shelterGuardLog=Date.now();this.log('Shelter: hitting '+target.entity.name+(target.inside?' inside the box':' at a gap'));}
   await this.shelterStrike(target.entity,token);
   return;
  }
  if(!gaps.length)return;
  if(Date.now()-(this.shelterGuardLog||0)>5000){this.shelterGuardLog=Date.now();this.log('Shelter: re-sealing '+gaps.length+' open cell(s)');}
  try{await this.sealShelter(job,token,origin);}catch(e){this.check(token);}
 }
 async removeShelter(job,token){
  const b=this.bot;
  this.update(job,0,'Removing the shelter');
  const seen=new Set(),cells=[];
  for(const c of [...(Array.isArray(job.shell)?job.shell:[]),...(job.placed||[])]){const k=c.x+','+c.y+','+c.z;if(!seen.has(k)){seen.add(k);cells.push(c);}}
  for(const key of [...cells].reverse()){
   this.check(token);
   const block=b.blockAt(new Vec3(key.x,key.y,key.z));
   // The right tool, or cobble drops nothing: round 4's dawn cleanup dug the box by hand and
   // the 25 cobble the furnace needed never came back (and each block took ~7 s).
   if(block?.boundingBox==='block'){try{await b.tool.equipForBlock(block);}catch{}this.check(token);await b.dig(block);}
   await sleep(80);
  }
  await this.sweepDrops(token);
  for(const key of cells){
   if(b.blockAt(new Vec3(key.x,key.y,key.z))?.boundingBox==='block')throw Error('Shelter block remained at '+key.x+','+key.y+','+key.z);
  }
  job.placed=[];
 }
 // Phase 6b: obtain - plan the full chain with the howto tree, then run it as ordinary
 // verified jobs. The step list and index are persisted, so a restart resumes mid-chain.
 async obtain(job,token){
  const b=this.bot,s=job.spec,key=s.item+'x'+s.count;
  if(!job.chain||job.chainKey!==key){
   const have={};for(const item of b.inventory.items())have[item.name]=(have[item.name]||0)+item.count;
   const chain=buildChain(b,s.item,s.count,have);
   if(/(_shield|_planks|_log)/.test(s.item))this.log('Obtain plan have-tally: '+JSON.stringify(have).slice(0,220));
   job.chainKey=key;job.chain=chain.steps;job.index=0;this.save();
   this.log(`Obtain ${s.count} ${s.item}: `+(chain.steps.map(st=>st.op+' '+(st.block||st.item||st.entity)).join(' -> ')||'nothing to do'));
  }
  while(this.count(s.item)<s.count&&job.index<job.chain.length){
   this.check(token);
   if(this.slotsFull()>0.8)await this.depositSurplus(job,token);
   const step=job.chain[job.index];
   if(step.op==='gather'){
    const drop=this.blockDrop(step.block);
    if(!drop)throw Error('Cannot plan a gather of '+step.block);
    while(this.count(drop)<step.want){
     this.check(token);
     const before=this.count(drop);
     await this.gather({spec:{type:'gather',block:step.block,count:Math.min(128,step.want-before),searchIfMissing:true,targetY:step.targetY}},token);
     if(this.count(drop)<=before)throw Error('Gathering '+step.block+' made no progress toward '+step.want+' '+drop);
    }
   }else if(step.op==='smelt'){
    while(this.count(step.output)<step.want){
     this.check(token);
     const before=this.count(step.output);
     if(this.count(step.item)<1)throw Error('Ran out of '+step.item+' to smelt');
     await this.smelt({spec:{type:'smelt',item:step.item,count:Math.min(48,step.want-before,this.count(step.item))}},token);
     if(this.count(step.output)<=before)throw Error('Smelting '+step.item+' made no progress toward '+step.want+' '+step.output);
    }
   }else if(step.op==='craft'){
    while(this.count(step.item)<step.want){
     this.check(token);
     const before=this.count(step.item);
     await this.craft({spec:{type:'craft',item:step.item,count:Math.min(128,step.want-before)}},token);
     if(this.count(step.item)<=before)throw Error('Crafting '+step.item+' made no progress toward '+step.want);
    }
   }else if(step.op==='hunt'){
    while(this.count(step.item)<step.want){
     this.check(token);
     const before=this.count(step.item);
     await this.hunt({spec:{type:'hunt',entity:step.entity,count:1,maxSeconds:60}},token);
     if(this.count(step.item)<=before)throw Error('Hunting '+step.entity+' produced no '+step.item);
    }
   }else throw Error('Unknown obtain step '+step.op);
   job.index++;this.save();
   this.update(job,job.index,`Obtain step ${job.index}/${job.chain.length} done`);
  }
  if(this.count(s.item)<s.count)throw Error(`Obtain finished its plan with only ${this.count(s.item)}/${s.count} ${s.item}`);
 }
 // Park surplus in the deposit chest (or the autopilot home chest), keeping tools, armour,
 // food and everything the remaining obtain steps still need.
 async depositSurplus(job,token){
  const b=this.bot,at=job.spec.deposit||this.autopilot.home;
  if(!at)throw Error('Inventory nearly full and there is no deposit position: pass deposit or let the autopilot remember a home');
  const needed=new Set();
  for(const step of job.chain.slice(job.index))for(const key of ['item','block'])if(step[key])needed.add(step[key]);
  if(job.chain.slice(job.index).some(step=>step.op==='smelt'))for(const item of b.inventory.items())if(item.name==='coal'||item.name==='charcoal'||item.name.endsWith('_log')||item.name.endsWith('_planks'))needed.add(item.name);
  await this.walk(pos(at),token,2);
  const block=b.blockAt(pos(at));
  if(!block||!['chest','trapped_chest','barrel'].includes(block.name))throw Error('No chest or barrel at the deposit position '+JSON.stringify(at));
  const chest=await b.openContainer(block);
  try{
   for(const item of b.inventory.items()){
    this.check(token);
    if(/(_pickaxe|_axe|_shovel|_sword|_helmet|_chestplate|_leggings|_boots)$/.test(item.name))continue;
    if(b.registry.foodsByName[item.name])continue;
    if(needed.has(item.name))continue;
    await chest.deposit(item.type,item.metadata,item.count);
   }
   await sleep(150);await b._syncWindow(chest);await sleep(150);
  }finally{await chest.close();}
  await sleep(150);await b._syncWindow(b.inventory);
  this.log('Deposited surplus at '+at.x+', '+at.y+', '+at.z);
 }
 // The 26.3 server applies use-item block changes lazily - sometimes for tens of seconds
 // while the bot stands perfectly still. Real movement forces client tick boundaries, so
 // hop in place until the world reflects the change (the caller verifies it afterwards).
 async settleBlockChange(target,expect,token){
  const b=this.bot;
  for(let tries=0;tries<12;tries++){
   const block=b.blockAt(target);
   if(!block||block.name!==expect)return;
   this.check(token);
   b.clearControlStates();b.setControlState('jump',true);
   await sleep(350);
   if(token===this.epoch)b.clearControlStates(); // a reflex may have taken control during the hop
   await sleep(300);
  }
 }
 // Phase 6c: use a held item on a block or entity, verified by the resulting change.
 // The 26.3 server applies use-item block changes lazily until the next client tick
 // boundary; flushTick sends the ground-only update packet (compat appends tick_end to it)
 // so verifications see the change promptly. Safe while standing still, unlike raw position.
 async flushTick(){
  const b=this.bot;
  try{b._client.write('flying',{onGround:b.entity.onGround,flags:{onGround:b.entity.onGround,hasHorizontalCollision:false}});}catch{}
  await sleep(250);
 }
 // The WorldSurvivalChain's douse: pour the held water bucket at the bot's own feet, using
 // the exact sequence the verified use() path equips/confirms/aims with. The chain's task
 // ticks proved too cramped for this (equip never settled, pours fired on a stale rotation
 // and the A4 probe burned to death twice on 2026-10-13).
 async douseFire(){
  const b=this.bot;
  // Deliberately NO global check() here: the douse runs exactly when health is collapsing
  // (the health<10 gate would refuse it every attempt and the bot burned to death - A4
  // probe 2026-10-13). Ownership is checked LIVE at each step: a captured token goes stale
  // because the runner legitimately churns the epoch while the tree owns control.
  const owned=()=>this.controlToken===this.epoch;
  // The tasks call this from onTick, i.e. inside runner.tick() BEFORE the runner claims
  // control for a tree that just started (the claim follows tickChain). Checking at once
  // threw on the first tick of every fresh lava escape (integration A4, 2026-10-14
  // 13:04:32Z) and lost one of its two bucket attempts. Wait out that claim, bounded.
  for(let i=0;i<5&&!owned();i++)await sleep(i?50:0);
  if(!owned())throw Error('Douse interrupted: control changed hands');
  const bucketItem=b.inventory.items().find(i=>i.name==='water_bucket');
  if(!bucketItem)throw Error('No water bucket to douse with');
  if(b.heldItem?.name!=='water_bucket'){
   await b.equip(bucketItem,'hand');
   for(let tries=0;tries<10&&b.heldItem?.name!=='water_bucket';tries++){
    if(!owned())throw Error('Douse interrupted: control changed hands');
    await sleep(150);
   }
   if(b.heldItem?.name!=='water_bucket')throw Error('The water bucket could not be equipped');
  }
  const feet=b.entity.position.floored();
  const here=b.blockAt(feet);
  if(here&&here.name==='water')return; // standing in water already: doused
  const support=b.blockAt(feet.offset(0,-1,0));
  if(!support||support.boundingBox!=='block')throw Error('No ground below to pour against');
  const aim=support.position.offset(0.5,1.0,0.5);
  await b.lookAt(aim,true).catch(()=>{});
  await sleep(250);
  if(!owned())throw Error('Douse interrupted: control changed hands');
  b.activateItem();
  for(let tries=0;tries<10&&this.count('bucket')<1;tries++)await sleep(200);
  if(this.count('bucket')<1)throw Error('The water bucket did not empty');
  await this.settleBlockChange(feet,'water',this.epoch);
  // Into-LAVA pours are a success too: the source turns to obsidian/cobble under the bot
  // (that is the point) - only a dry feet cell means the pour missed.
  const after=b.blockAt(feet)?.name;
  if(after!=='water'&&after!=='obsidian'&&after!=='cobblestone'&&after!=='lava')this.log('Douse: the water did not register at '+feet.floored());
 }
 async use(job,token){
  const b=this.bot,s=job.spec;
  if(!s.position&&!s.entity)throw Error('use needs a block position or an entity type');
  if(!b.registry.itemsByName[s.item])throw Error('Unknown item '+s.item);
  const hold=async name=>{
   if(b.heldItem?.name===name)return; // already in hand; re-equipping would empty the slot mid-race
   const item=b.inventory.items().find(i=>i.name===name);
   if(!item)throw Error('Need '+name+' in the inventory');
   await b.equip(item,'hand');
   for(let tries=0;tries<8&&b.heldItem?.name!==name;tries++)await sleep(250);
   if(b.heldItem?.name!==name)throw Error('The '+name+' could not be equipped');
  };
  if(s.entity)return this.useOnEntity(job,token,s.entity,s.item);
  const target=pos(s.position);
  await this.walk(target,token,3);this.check(token);
  const before=b.blockAt(target);
  if(!before)throw Error('No loaded block at '+target);
  if(s.item==='shears'&&/_leaves$/.test(before.name)){
   await hold('shears');
   await b.dig(before);this.check(token);await this.flushTick();
   // The resulting change is the leaves being gone; the leaf item drop depends on the
   // server's held-item view, which Via translation can differ on.
   for(let tries=0;tries<3&&b.blockAt(target)?.boundingBox==='block';tries++){
    await sleep(400);await this.sweepDrops(token);
   }
   if(b.blockAt(target)?.boundingBox==='block')throw Error('Shearing the leaves at '+target+' failed to remove them');
   return;
  }
  if(s.item==='bucket'){
   if(before.name!=='water')throw Error('Aim the bucket at a water block (never lava); '+before.name+' is not water');
   await hold('bucket');
   return this.fillBucket(target,token);
  }
  if(s.item==='water_bucket'){
   if(before.boundingBox!=='empty')throw Error(target+' is occupied by '+before.name+'; aim at the air cell to fill');
   let support=null,face=null;
   for(const direction of [new Vec3(0,-1,0),new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1),new Vec3(0,1,0)]){
    const neighbor=b.blockAt(target.minus(direction));
    if(neighbor?.boundingBox==='block'){support=neighbor;face=direction;break;}
   }
   if(!support)throw Error('No solid block beside '+target+' to pour against');
   const beforeItem=this.count('water_bucket');
   await hold('water_bucket');
   // A filled bucket pours where the eye ray lands, like a player aiming into the hole:
   // aim at the support block's face inside the target cell and use the item in the air.
   const aim=support.position.plus(new Vec3(face.x?face.x*0.5+0.5:0.5,face.y?face.y*0.5+0.5:0.5,face.z?face.z*0.5+0.5:0.5));
   await b.lookAt(aim,true).catch(()=>{});
   await sleep(400);this.check(token);
   b.activateItem();
   for(let tries=0;tries<8&&this.count('bucket')<1;tries++){await sleep(300);this.check(token);}
   await this.settleBlockChange(target,'water',token);
   if(b.blockAt(target)?.name!=='water')throw Error('Emptying the bucket did not place water at '+target);
   if(this.count('water_bucket')>=beforeItem&&this.count('bucket')<1)throw Error('The bucket did not empty');
   return;
  }
  // Habit 11: seeds (or a carrot/potato) on farmland plant the crop in the cell above; the
  // farmland itself does not change.
  if(PLANTS[s.item]&&before.name==='farmland'){
   const above=target.offset(0,1,0);
   if(b.blockAt(above)?.boundingBox!=='empty')throw Error('Something sits on the farmland at '+target);
   await hold(s.item);
   await b.activateBlock(before,new Vec3(0,1,0),new Vec3(.5,1,.5));
   await this.flushTick();this.check(token);
   for(let tries=0;tries<12;tries++){if(b.blockAt(above)?.name===PLANTS[s.item])return;await sleep(300);this.check(token);}
   throw Error('Planting '+s.item+' at '+target+' grew nothing');
  }
  const beforeName=before.name,beforeAge=before.properties?.age;
  await hold(s.item);
  const boneBefore=this.count(s.item);
  await b.activateBlock(before,new Vec3(0,1,0),new Vec3(.5,.5,.5));
  await this.flushTick();this.check(token);
  // Block updates can trail the action for a few seconds on this protocol; poll until the
  // expected change shows up (or fail honestly).
  const verify=async predicate=>{
   let after=b.blockAt(target);
   for(let tries=0;tries<12;tries++){
    if(predicate(after))return after;
    this.check(token);after=b.blockAt(target);await sleep(300);
   }
   return null;
  };
  let after=null;
  if(/_axe$/.test(s.item)){
   after=await verify(bl=>bl?.name.startsWith('stripped_'));
   if(!after)throw Error('The axe did not strip the log at '+target);
  }else if(/_hoe$/.test(s.item)){
   after=await verify(bl=>bl?.name==='farmland');
   if(!after)throw Error('The hoe did not till '+beforeName+' at '+target);
  }else if(s.item==='bone_meal'){
   after=await verify(bl=>bl?.properties?.age!==undefined&&bl.properties.age>beforeAge);
   if(!after){
    if(beforeAge===undefined&&this.count(s.item)<boneBefore)return; // client never shows crop age here; the consumed item and the suite's server-side age check are the evidence
    throw Error('Bone meal did not advance the crop at '+target);
   }
  }else{
   after=await verify(bl=>bl?.name!==beforeName||bl?.properties?.age!==beforeAge);
   if(!after)throw Error('Using '+s.item+' on '+beforeName+' changed nothing');
  }
 }
 // Round 11 (6x `use bucket ... produced no water bucket`): a bucket fills only from a water
 // SOURCE (level 0) that the server's eye ray reaches within reach. The fill is an air-use
 // the 26.3 server applies at the next client tick boundary, so the use is flushed (like the
 // hoe and seed uses) and the bot hops while it waits. Each try aims at the source's surface
 // from a stance whose ray meets no solid block first (else it walks closer: 3, 2, 1).
 async fillBucket(target,token){
  const b=this.bot,at=p=>b.blockAt(p);
  const isSource=bl=>!!bl&&bl.name==='water'&&(bl.metadata??0)===0;
  let src=at(target);
  if(!isSource(src)){
   // flowing water: the nearest source within 2 of it, open above
   const near=[];
   for(let dx=-2;dx<=2;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-2;dz<=2;dz++){const bl=at(target.offset(dx,dy,dz));if(isSource(bl)&&at(bl.position.offset(0,1,0))?.boundingBox==='empty')near.push(bl);}
   near.sort((a,c)=>a.position.distanceTo(target)-c.position.distanceTo(target));
   if(!near.length)throw Error('The water at '+target+' is flowing (level '+(src?.metadata??'?')+') and no source is beside it');
   this.log('Bucket: '+target+' is flowing water; filling at the source '+near[0].position);
   src=near[0];
  }
  const buckets=this.count('water_bucket');
  let why='';
  for(let attempt=0;attempt<BUCKET_TRIES;attempt++){
   this.check(token);
   const aim=src.position.offset(.5,.9,.5),eye=()=>b.entity.position.offset(0,b.entity.eyeHeight||1.62,0);
   const ray=()=>rayToFluid((x,y,z)=>b.blockAt(new Vec3(x,y,z)),eye(),aim);
   if(attempt||eye().distanceTo(aim)>BUCKET_REACH||ray().blocked){
    try{await this.walk(src.position,token,Math.max(1,3-attempt));}catch(e){this.check(token);}
   }
   const r=ray();
   if(eye().distanceTo(aim)>BUCKET_REACH){why='out of reach ('+eye().distanceTo(aim).toFixed(1)+')';continue;}
   if(r.blocked){why=r.blocked.name+' at '+r.blocked.position+' in the way';continue;}
   await b.lookAt(aim,true).catch(()=>{});
   await sleep(250);this.check(token);
   b.activateItem();
   await this.flushTick();
   for(let tries=0;tries<10&&this.count('water_bucket')<=buckets;tries++){
    this.check(token);
    if(tries%3===2){b.setControlState('jump',true);await sleep(350);if(token===this.epoch)b.clearControlStates();}
    await sleep(300);
   }
   if(this.count('water_bucket')>buckets){await this.settleBlockChange(src.position,'water',token);return;}
   why='no change after the use';
  }
  throw Error('Filling the bucket at '+src.position+' produced no water bucket ('+BUCKET_TRIES+' tries; '+why+')');
 }
 // mineflayer's useOn omits the hand field the 1.21.4 interact packet needs, so write the
 // entity interaction directly: INTERACT_AT with a hit point on the hitbox, then INTERACT.
 useEntityInteract(b,target){
  const y=Math.round(target.height*0.6*100)/100;
  b._client.write('use_entity',{target:target.id,mouse:2,x:0,y,z:0,hand:0,sneaking:false});
  b._client.write('use_entity',{target:target.id,mouse:0,hand:0,sneaking:false});
 }
 async useOnEntity(job,token,type,itemName){
  const b=this.bot,wools=Object.keys(b.registry.itemsByName).filter(n=>/_wool$/.test(n));
  const woolCount=()=>wools.reduce((a,n)=>a+this.count(n),0);
  const target=Object.values(b.entities).filter(e=>e.name===type&&e.position&&e.position.distanceTo(b.entity.position)<=24).sort((a,c)=>a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position))[0];
  if(!target)throw Error('No '+type+' within 24 blocks');
  const item=b.inventory.items().find(i=>i.name===itemName);
  if(!item)throw Error('Need '+itemName+' in the inventory');
  await this.walk(target.position,token,1.5);
  await b.equip(item,'hand');this.check(token);
  await b.lookAt(target.position.offset(0,target.height*.6,0));
  const woolBefore=woolCount();
  this.useEntityInteract(b,target);
  await sleep(900);
  if(itemName==='shears'){
   await this.sweepDrops(token);
   if(woolCount()<=woolBefore)throw Error('Shearing the '+type+' produced no wool');
  }
 }
 async shear(job,token){
  const b=this.bot;
  const wools=Object.keys(b.registry.itemsByName).filter(n=>/_wool$/.test(n));
  const held=b.inventory.items().find(i=>i.name==='shears');
  const before=wools.reduce((a,n)=>a+this.count(n),0);
  const deadline=Date.now()+(job.spec.maxSeconds??45)*1000;
  while(wools.reduce((a,n)=>a+this.count(n),0)<=before&&Date.now()<deadline){
   this.check(token);
   const sheep=Object.values(b.entities).filter(e=>e.name==='sheep'&&e.position&&e.position.distanceTo(b.entity.position)<=24).sort((a,c)=>a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position))[0];
   if(!sheep)throw Error('No sheep within 24 blocks to shear');
   if(!held)throw Error('Need shears in the inventory');
   await this.walk(sheep.position,token,1.5);
   await b.equip(held,'hand');
   for(let tries=0;tries<8&&b.heldItem?.name!=='shears';tries++)await sleep(250);this.check(token);
   if(b.heldItem?.name!=='shears')throw Error('The shears could not be equipped');
   await b.lookAt(sheep.position.offset(0,sheep.height*.6,0));
   this.useEntityInteract(b,sheep);
   await sleep(900);
   await this.sweepDrops(token);
  }
  if(wools.reduce((a,n)=>a+this.count(n),0)<=before)throw Error('Shearing produced no wool (all nearby sheep may already be shorn)');
 }
 async breed(job,token){
  const b=this.bot,s=job.spec,food=BREED_FOOD[s.entity];
  const foods=Array.isArray(food)?food:[food];
  if(!foods.length)throw Error('No known breeding food for '+s.entity);
  const feed=foods.map(f=>({name:f,have:this.count(f)})).find(x=>x.have>=2);
  if(!feed)throw Error('Need 2 '+foods.join('/')+' to breed '+s.entity);
  const nearby=()=>Object.values(b.entities).filter(e=>e.name===s.entity&&e.position&&e.position.distanceTo(b.entity.position)<=24);
  const item=b.inventory.items().find(i=>i.name===feed.name);
  const deadline=Date.now()+(s.maxSeconds??90)*1000;
  const start=nearby().length;
  while(nearby().length<=start&&Date.now()<deadline){
   this.check(token);
   const pair=nearby().sort((a,c)=>a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position)).slice(0,2);
   if(pair.length<2)throw Error('Need two '+s.entity+' within 24 blocks to breed');
   for(const animal of pair){
    this.check(token);
    await this.walk(animal.position,token,1.5);
    await b.equip(item,'hand');
    await b.lookAt(animal.position.offset(0,animal.height*.6,0));
    this.useEntityInteract(b,animal);
    await sleep(700);
   }
   for(let i=0;i<15&&nearby().length<=start;i++)await sleep(1000);
  }
  if(nearby().length<=start)throw Error('Feeding did not produce a baby '+s.entity);
 }
 async hunt(job,token){
  const b=this.bot,s=job.spec;
  const loot=Object.values(b.registry.entityLoot||{}).find(l=>l.entity===s.entity)?.drops.map(d=>d.item).filter(Boolean)||[];
  if(!loot.length)throw Error('No drop data for '+s.entity);
  const gained=()=>loot.reduce((a,n)=>a+this.count(n),0);
  const before=gained();
  const deadline=Date.now()+(s.maxSeconds??90)*1000;
  while(gained()-before<s.count&&Date.now()<deadline){
   this.check(token);
   const target=Object.values(b.entities).filter(e=>e.name===s.entity&&e.position&&e.position.distanceTo(b.entity.position)<=24).sort((a,c)=>a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position))[0];
   if(!target)throw Error('No '+s.entity+' within 24 blocks to hunt');
   // One animal per task (lockFirst): kill, sweep the drops, repeat - the FightTask
   // equips the best weapon (or the bare hand on a passive animal, never a block/food).
   await this.combatTask(job,token,()=>new FightTask({
    move:this.move,
    log:m=>{try{this.log(m);}catch{}},
    opts:{entityFilter:s.entity,range:24,lockFirst:true,allowHand:true}}),
   {timeoutMs:Math.max(1000,deadline-Date.now()),timeoutMessage:'Hunt timed out fighting '+s.entity});
   await this.sweepDrops(token);
  }
  if(gained()-before<s.count)throw Error(`Hunting collected only ${gained()-before}/${s.count} drops from ${s.entity}`);
 }
 // The tunnel an interrupted gather left the bot in, if the bot is still at its bottom. Set
 // on every staircase step (so no unwind race can lose it), cleared once a climb succeeds; the
 // job that dug it keeps it (its own job.tunnel climbs).
 takeStrandedTunnel(jobId){
  const t=this.strandedTunnel;if(t&&t.job===jobId)return null;this.strandedTunnel=null;
  const p=this.bot?.entity?.position,last=t?.points?.[t.points.length-1];
  if(!p||!last||p.distanceTo(new Vec3(last.x+0.5,last.y,last.z+0.5))>2.5)return null;
  return t.points;
 }
 async run(job,token){const spec=job.spec;
  // Surface work never starts down a tunnel another job was stopped in: climb it first.
  if(STRANDED_CLIMB.has(spec.type)){
   const points=this.takeStrandedTunnel();
   if(points){this.log('Climbing out of the tunnel an interrupted gather left ('+points.length+' steps)');try{await this.climbTunnel({tunnel:points},token);}catch(e){this.check(token);this.log('Could not climb back up the tunnel: '+e.message);}}
  }
  if(spec.type==='goto'){await this.walk(pos(spec.position),token,1);return;}
  if(spec.type==='gather')return this.gather(job,token);
  if(spec.type==='craft')return this.craft(job,token);
  if(spec.type==='deposit')return this.deposit(job,token);
  if(spec.type==='build')return this.build(job,token);
  if(spec.type==='explore')return this.explore(job,token);
  if(spec.type==='place')return this.place(job,token);
  if(spec.type==='eat')return this.eat(job,token);
  if(spec.type==='equip')return this.equip(job,token);
  if(spec.type==='collect')return this.collect(job,token);
  if(spec.type==='smelt')return this.smelt(job,token);
  if(spec.type==='sleep')return this.sleep(job,token);
  if(spec.type==='fight')return this.fight(job,token);
  if(spec.type==='shelter')return this.shelter(job,token);
  if(spec.type==='obtain')return this.obtain(job,token);
  if(spec.type==='use')return this.use(job,token);
  if(spec.type==='shear')return this.shear(job,token);
  if(spec.type==='breed')return this.breed(job,token);
  if(spec.type==='hunt')return this.hunt(job,token);
  if(spec.type==='drop')return this.drop(job,token);
 }
 blockDrop(name){
  const b=this.bot,id=b.registry.blocksByName[name]?.id;
  if(id===undefined)return null;
  const drops=b.registry.blocks[id]?.drops||[];
  const single=drops.length===1?b.registry.items[drops[0]]?.name:null;
  return name==='stone'?'cobblestone':single;
 }
 slotsFull(){
  const used=this.bot.inventory.items().reduce((a,i)=>a+Math.ceil(i.count/i.stackSize),0);
  return used/36;
 }
 async gather(job,token){
  const b=this.bot,s=job.spec;
  // block:'log' matches every log species: a species pinned at job creation would send the
  // bot hunting oak through a dark-oak forest for the whole session.
  const anyLog=s.block==='log';
  const id=anyLog?undefined:b.registry.blocksByName[s.block]?.id;if(!anyLog&&id===undefined)throw Error('Unknown block '+s.block);
  const denied=/^(bedrock|.*chest|.*shulker_box|.*door|.*bed|.*furnace|.*barrel|.*torch|.*sign|.*portal|.*spawner|.*command_block|water|lava|.*planks|glass.*|.*bricks)$/;
  if(denied.test(s.block))throw Error('Gathering this block is disabled to protect structures');
  // A gather stopped down its tunnel (a stop, timeout or ladder cancel) left the bot there:
  // this one climbs that tunnel when it ends, like its own.
  const stranded=this.takeStrandedTunnel(job.id);if(stranded&&!job.tunnel?.length)job.tunnel=stranded;
  if(!job.anchor)job.anchor=b.entity.position.floored();if(job.startCount===undefined)job.startCount=this.count(s.block);
  const logSum=()=>b.inventory.items().filter(i=>i.name.endsWith('_log')).reduce((a,i)=>a+i.count,0);
  if(anyLog)job.dropName='log';
  else if(CROP_DROP[s.block])job.dropName=CROP_DROP[s.block]; // habit 11: crops and grass
  else{
   // Ore jobs are rejected unless the ore drops the named item; avoid false completion.
   const drops=b.registry.blocks[id]?.drops||[];
   const dropName=drops.length===1?b.registry.items[drops[0]]?.name:null;
   if(!dropName)throw Error('Unsupported drop type; use logs, stone/cobblestone, or simple ores');
   if(s.block==='stone')job.dropName='cobblestone';else job.dropName=dropName;
  }
  // Raw ore loaded into this gather's kiln still counts as gathered (kilnIn).
  const count_=job.dropName==='log'?logSum:()=>this.count(job.dropName)+(job.kilnIn||0);
  if(job.startDrop===undefined)job.startDrop=count_();this.save();
  let failures=0;
  if(job.searches===undefined)job.searches=0;
  if(job.descents===undefined)job.descents=0;
  const radius=s.radius??this.config.limits.radius;
  const previous=b.pathfinder.movements;
  // Natural targets may sit behind dirt or inside a cliff: path with the explore rules.
  b.pathfinder.setMovements(this.exploreMovements());
  try{
   // An ore job takes both strata: iron_ore also matches deepslate_iron_ore (same drop), so
   // the scan from the iron step's staircase does not skip the ore below y=0.
   const deep=!anyLog&&/_ore$/.test(s.block)&&!s.block.startsWith('deepslate_')?b.registry.blocksByName['deepslate_'+s.block]?.id:undefined;
   const match=anyLog?Object.values(b.registry.blocksByName).filter(bl=>/_log$/.test(bl.name)).map(bl=>bl.id):deep!==undefined?[id,deep]:id;
   const isMatch=bl=>Array.isArray(match)?match.includes(bl.type):bl.type===match;
   const at3=(x,y,z)=>b.blockAt(new Vec3(x,y,z));
   // One searchIfMissing leg (3 per job). belowFoots (soak ladder jobs): short search hops -
   // a 48+ block wander is how the bot lost the clearing in the baseline soaks. A new area
   // forgets the old one's refused columns and climbs.
   const searchLeg=async()=>{
    job.searches++;this.update(job,Math.max(0,this.count(job.dropName)-job.startDrop),`Searching further afield (${job.searches}/3)`);
    let leg=s.belowFoots?24:Math.max(48,radius),direction=['east','north','west','south'][job.searches-1];
    // Round 10 (bug D, hard1 wood at 543 s): head for the nearest match the bot can see beyond
    // the area it already worked (within SEARCH_SCAN), not a fixed east/north/west/south.
    try{
     const me=b.entity.position,seen=b.findBlocks({matching:match,point:me,maxDistance:SEARCH_SCAN,count:256})
      .filter(p=>p.distanceTo(pos(job.anchor))>radius&&!this.gatherBlacklisted(job,p)&&(!s.belowFoots||Math.abs(p.y-me.y)<=8));
     const head=searchHeading(me,seen);
     if(head){direction=head.direction;leg=Math.max(leg,Math.min(64,head.distance-8));this.log('Gather: search leg '+job.searches+' '+direction+' toward '+(anyLog?'logs':s.block)+' at '+head.target);}
    }catch(e){this.check(token);}
    await this.exploreLeg(token,{direction,distance:leg,seconds:90+leg*2});
    job.anchor=b.entity.position.floored();job.badColumns=[];job.climbs=0;this.save();
   };
   let lastScan=0,lastCount=null;
   while(count_()-job.startDrop<s.count){
    this.check(token);if(b.inventory.emptySlotCount()<2)throw Error('Inventory nearly full; deposit items first');
    if(s.smeltAt)await this.kilnTick(job,token);
    // One rescan per second at most while nothing is being collected.
    const have=count_();
    if(have===lastCount){const wait=lastScan+GATHER_RESCAN_MS-Date.now();if(wait>0){await sleep(wait);this.check(token);}}
    lastScan=Date.now();lastCount=have;
    // Wood step: do not follow a trunk down into a ravine. The floor is the Y where the
    // gather started, not wherever a failed path has since dropped the bot.
    if(s.surface){
     if(job.surfaceY===undefined)job.surfaceY=Math.floor(b.entity.position.y);
     this.surfaceFloor=job.surfaceY-4;
    }
    // Prefer same-level trunks: on a canopy spawn the nearest log is often far above or below.
    // Open-sky preference (review directive): wood jobs can ASK for forest-edge work with
    // "openSky":true - a trunk whose column above is clear means daylight and fewer night
    // ambushes. MUST be opt-in: under a dark oak canopy every trunk has leaves above, so
    // an always-on filter emptied the candidate list and starved the hard-anchor gathers
    // (measured: 'No matching blocks' loops, soak 20261013).
    const wantOpen=!!s.openSky;
    const skyOpen=p=>{for(let dy=2;dy<=10;dy++){const bl=b.blockAt(p.offset(0,dy,0));if(bl&&bl.boundingBox==='block'&&bl.name!=='log')return false;}return true;};
    let targets=b.findBlocks({matching:match,point:pos(job.anchor),maxDistance:radius,count:64}).map(p=>b.blockAt(p)).filter(block=>block&&block.position.distanceTo(pos(job.anchor))<=radius);
    // Blocks that failed for good (this job, or a recent job: the ladder resubmits the same
    // gather) are skipped. hard1/hard2 sat for minutes re-trying the same canopy logs.
    targets=targets.filter(t=>!this.gatherBlacklisted(job,t.position));
    // Habit 11: a crop is harvested only ripe (age 7; beetroots 3), never pulled green.
    if(CROP_RIPE[s.block]!=null)targets=targets.filter(t=>blockAge(t)>=CROP_RIPE[s.block]);
    // openSky RANKS open trunks first but never empties the list: the dark-canopy hard
    // anchor has no open-sky trunks at all, and a filtered gather starved there (measured).
    if((anyLog||wantOpen) && job.skyKey!==job.anchor.x+','+job.anchor.z){
     job.skyKey=job.anchor.x+','+job.anchor.z;
     const stand=pickOpenStand((x,y,z)=>b.blockAt(new Vec3(x,y,z)),targets.map(t=>t.position),b.entity.position);
     if(stand){
      this.update(job,Math.max(0,count_()-job.startDrop),'Moving to open sky');
      try{await this.walk(new Vec3(stand.x,stand.y,stand.z),token,1,25);}catch(e){this.check(token);}
     }
    }
    if(wantOpen){
     const openFirst=(a,c)=>(skyOpen(c.position)?1:0)-(skyOpen(a.position)?1:0);
     targets.sort((a,c)=>openFirst(a,c)||(a.position.distanceTo(b.entity.position)+Math.abs(a.position.y-b.entity.position.y)*2)-(c.position.distanceTo(b.entity.position)+Math.abs(c.position.y-b.entity.position.y)*2));
    }else{
     targets.sort((a,c)=>(a.position.distanceTo(b.entity.position)+Math.abs(a.position.y-b.entity.position.y)*2)-(c.position.distanceTo(b.entity.position)+Math.abs(c.position.y-b.entity.position.y)*2));
    }
    if(s.surface&&job.surfaceY!==undefined)targets=targets.filter(t=>t.position.y>=job.surfaceY-4);
    // A band gather: nothing below the band's floor; exposed ore (a cave wall, the tunnel)
    // first - each buried block costs a dig path (round 7: prefer the nearest exposed ore).
    // (the exposure bonus is in the column choice below).
    if(s.bandTop!=null&&s.targetY!=null)targets=targets.filter(t=>t.position.y>=s.targetY);
    // Stone step (hard runs: dirt hill under a canopy): exposed stone near the bot, else dig
    // down where it stands by the safe staircase instead of walking at buried stone.
    if(!anyLog&&s.targetY==null&&STONE_FAMILY.test(s.block)&&targets.length){
     const plan=stonePlan({targets,botPos:b.entity.position,blockAt:at3,isNatural:naturalTerrain,isTarget:isMatch,digDowns:job.digDowns||0});
     if(plan.action==='dig-down'){
      job.digDowns=(job.digDowns||0)+1;
      const startY=Math.floor(b.entity.position.y),note=`No exposed ${s.block} within reach; digging down to y=${plan.targetY}`;
      this.log('Gather: '+note+' (staircase '+plan.dir+')');this.update(job,Math.max(0,count_()-job.startDrop),note);
      try{
       await this.staircase(job,token,plan.targetY,{dir:plan.dir,natural:naturalTerrain,
        stopWhen:()=>startY-Math.floor(b.entity.position.y)>=STONE_DIG_MIN&&stoneBeside(at3,b.entity.position.floored(),isMatch)});
      }catch(e){this.check(token);this.log('Gather: dig-down stopped: '+e.message);job.digDowns=STONE_DIG_DOWNS;}
      job.anchor=b.entity.position.floored();this.save();continue;
     }
     targets=plan.targets;
    }
    if(!targets.length){
     // An ore job that names its depth (the ladder's iron/coal/diamond jobs) goes down first:
     // three 48-block surface legs could never see ore that sits at y=32.
     const deepFirst=s.targetY!=null&&UNDERGROUND.test(s.block)&&b.entity.position.y>s.targetY&&job.descents<DESCENT_LEGS;
     if(s.searchIfMissing&&job.searches<3&&!deepFirst){await searchLeg();continue;}
     const targetY=s.targetY??(s.block.includes('diamond')?-58:48);
     if(UNDERGROUND.test(s.block)&&b.entity.position.y>targetY&&job.descents<DESCENT_LEGS){
      const legY=s.targetY!=null?descentTarget(s,b.entity.position.y):targetY;
      job.descents++;this.update(job,Math.max(0,this.count(job.dropName)-job.startDrop),`Digging a staircase down to y=${legY}`);
      await descendLeg(this,job,token,legY);
      job.anchor=b.entity.position.floored();this.save();continue;
     }
     if(s.strip&&b.entity.position.y<=targetY&&!job.stripped){
      job.stripped=true;this.update(job,Math.max(0,this.count(job.dropName)-job.startDrop),'Digging a branch mine');
      await this.branchMine(job,token,{stopWhen:()=>count_()-job.startDrop>=s.count});
      job.anchor=b.entity.position.floored();this.save();continue;
     }
     throw Error('No matching blocks within the allowed radius');
    }
    // Player-style trunk strip: group the targets into columns (same x,z), pick the nearest
    // column, and strip it from the highest reachable log DOWN - a player chops the band
    // they can stand beside, then walks to the next trunk. Reach band: with belowFoots (soak
    // ladder jobs) the strip is limited to feet+4 (a jump or one pillar reaches it);
    // other callers may take the whole column. The block under the feet stays allowed when
    // it is itself natural or a log (the dig-and-drop branch), refused for anything else.
    const underBot=b.entity.position.floored().offset(0,-1,0);
    const naturalUnder=t=>NATURAL_DIG.has(t.name)||/_leaves$/.test(t.name)||/_log$/.test(t.name);
    const maxY=s.belowFoots?b.entity.position.y+4:Infinity;
    const columns=new Map();
    for(const t of targets){
     if(t.position.y>maxY)continue;
     const k=t.position.x+','+t.position.z;
     if(!columns.has(k))columns.set(k,[]);
     columns.get(k).push(t);
    }
    if(!job.badColumns)job.badColumns=[];
    let bestCol=null,bestDist=Infinity;
    for(const col of columns.values()){
     const ck=col[0].position.x+','+col[0].position.z;
     if(job.badColumns.includes(ck))continue; // one unreachable trunk must not abort the whole job
     const d=Math.min(...col.map(t=>t.position.distanceTo(b.entity.position)));
     const base=Math.min(...col.map(t=>t.position.y));
     const penalty=(s.surface&&job.surfaceY!==undefined&&base<job.surfaceY-1)?6:0
      +(s.bandTop!=null&&!col.some(t=>isExposed(at3,t.position))?BURIED_ORE_PENALTY:0);
     if(d+penalty<bestDist){bestDist=d+penalty;bestCol=col;}
    }
    if(!bestCol){
     if(job.badColumns.length){
      // Every column in range was refused. An ore job that still has a depth to reach
      // goes down anyway: one undiggable surface match must not skip the staircase.
      // Iron (soak normal2, 2026-10-14 10:53Z) died on an empty column and explored
      // at y=159 instead of digging to targetY.
      if(s.targetY!=null&&UNDERGROUND.test(s.block)&&b.entity.position.y>s.targetY&&job.descents<DESCENT_LEGS){
       job.descents++;
       const legY=descentTarget(s,b.entity.position.y);
       this.update(job,Math.max(0,this.count(job.dropName)-job.startDrop),`Digging a staircase down to y=${legY}`);
       await descendLeg(this,job,token,legY);
       job.anchor=b.entity.position.floored();this.save();continue;
      }
      // Round 9 hard2 (never a log in 20 min): the hard runs share one anchor, so run 2 starts
      // among run 1's leftovers - trunk stubs and canopy logs it could not reach. They are
      // "in range", so searchIfMissing never fired. Only refused columns left: search too.
      if(s.searchIfMissing&&job.searches<3){
       this.log('Gather: only refused '+(anyLog?'logs':s.block)+' within '+radius+' ('+job.badColumns.length+' columns); searching further afield');
       await searchLeg();continue;
      }
      throw Error('Cannot gather safely: nearby trunks could not be reached');
     }
     // belowFoots hides trunks above feet+3. After a drop into a ravine every log is
     // "above", and reporting an empty floor made the wood step dig in the hole (soak
     // normal1: bot at y=108, logs still at y=131, 0 collected).
     const above=targets.filter(t=>t.position.y>b.entity.position.y+3);
     if(above.length&&(job.climbs||0)<2){
      job.climbs=(job.climbs||0)+1;
      above.sort((a,c)=>a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position));
      this.update(job,Math.max(0,count_()-job.startDrop),'Climbing back up to the trunks');
      try{await this.walk(above[0].position,token,3,25);}catch(e){this.check(token);}
      continue;
     }
     // Round 11 hard2 (`no diggable target left` at a 131 stand with the logs at 136-137: a
     // tall dark-oak canopy over cut trunks): stand under the lowest canopy log and pillar up
     // until it is in reach - TRUNK_PILLAR blocks at most, dirt dug for it when none is held.
     if(anyLog&&above.length&&(job.pillars||0)<2){
      job.pillars=(job.pillars||0)+1;
      const feetY=Math.floor(b.entity.position.y);
      const low=above.filter(t=>t.position.y-3-feetY<=TRUNK_PILLAR).sort((a,c)=>a.position.y-c.position.y||a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position))[0];
      if(low){
       this.update(job,Math.max(0,count_()-job.startDrop),'Pillaring up to the canopy logs');
       try{if(await this.pillarToLog(job,token,low.position))continue;}catch(e){this.check(token);this.log('Gather: pillar to the canopy failed: '+e.message);}
      }
     }
     this.log('Gather: no diggable target left; bot at '+b.entity.position.floored()+' and remaining targets at '+JSON.stringify(targets.map(t=>t.position.floored())));
     if(s.searchIfMissing&&job.searches<3&&(job.climbs||0)>=2){await searchLeg();continue;} // out of reach here: look elsewhere
     throw Error('Only the block under the bot is in reach; gathering would dig its own floor');
    }
    // Top-down within the trunk: the highest reachable log first, then descend.
    bestCol.sort((a,b)=>b.position.y-a.position.y);
    const diggable=bestCol.filter(t=>!t.position.equals(underBot)||naturalUnder(t));
    if(!diggable.length){
     // Indexing an empty list is undefined, and the catch below then crashes on
     // target.name (iron gather, 2026-10-14 10:53:51Z, three times in 8s).
     const ck=bestCol[0].position.x+','+bestCol[0].position.z;
     if(!job.badColumns.includes(ck))job.badColumns.push(ck);
     this.log('Gather: column '+ck+' has nothing that can be dug without taking the floor');
     continue;
    }
    const target=diggable[((job.colFails||{})[bestCol[0].position.x+','+bestCol[0].position.z]||0)%diggable.length];
    try{
     if(target.position.equals(b.entity.position.floored().offset(0,-1,0))){
      // The last target sits directly under the feet and its cover is natural: dig the floor
      // block and drop onto it (the fluid and fall guards below still apply to the target).
      for(const delta of [new Vec3(0,-1,0),new Vec3(1,-1,0),new Vec3(-1,-1,0),new Vec3(0,-1,1),new Vec3(0,-1,-1)])if(['lava','water'].includes(b.blockAt(target.position.plus(delta))?.name))throw Error('Fluid under target');
      await b.tool.equipForBlock(target);
      await b.dig(target);this.check(token);await sleep(700);failures=0;
      this.update(job,Math.max(0,count_()-job.startDrop),`Collected ${Math.max(0,count_()-job.startDrop)}/${s.count} ${job.dropName}`);
      continue;
     }
      try{await this.walk(target.position,token,2,20);}catch(e){this.check(token);}
      const underFoot=b.blockAt(b.entity.position.floored().offset(0,-1,0));
      if(underFoot&&/_log$/.test(underFoot.name)&&count_()-job.startDrop<s.count){
       // The walk reached a trunk column and the bot now stands ON it: mine the logs under
       // the feet downward - dark oak trunks are tall, so this is the common canopy harvest.
       await this.mineColumnUnder(token);
      }else{
       await b.tool.equipForBlock(target);this.check(token);
       if(!b.canDigBlock(target)){
        if(target.position.y>b.entity.position.y)await this.reachUp(token,target);
        else{
         // Out of reach (canopy spawns put the trunks below the leaf surface): dig down toward it.
         await this.descendToReach(target,token);
         // Standing on the leaf canopy itself (heightmap tps land there): pathfinding cannot
         // route through it, so dig the natural column under the feet and drop to the floor.
         if(!b.canDigBlock(target))await this.canopyDrop(token,target);
        }
       }
       if(!b.canDigBlock(target))throw Error('Cannot reach or harvest this block');
       const harvest=b.registry.blocks[target.type]?.harvestTools;if(harvest&&!harvest[b.heldItem?.type])throw Error('A suitable harvesting tool is required');
       if(target.position.equals(b.entity.position.floored().offset(0,-1,0)))throw Error('Walked onto the target; it is under the bot now');
       for(const delta of [new Vec3(0,1,0),new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1)])if(['lava','water'].includes(b.blockAt(target.position.plus(delta))?.name))throw Error('Fluid beside target');
       if(target.material==='incorrect_for_wooden_tool')target.material='mineable/pickaxe';
       await b.dig(target);this.check(token);await sleep(600);
       // The walk to the freshly dropped log is best effort on canopy shelves: the dig itself
       // already counts, unreachable drops stay for a later sweep from better footing.
       try{await this.walk(target.position,token,0.8);}catch(e){this.check(token);}
       await this.sweepDrops(token);
       const nowUnder=b.blockAt(b.entity.position.floored().offset(0,-1,0));
       if(nowUnder&&/_log$/.test(nowUnder.name)&&count_()-job.startDrop<s.count)await this.mineColumnUnder(token);
      }
      failures=0;
     }catch(e){this.check(token);failures++;const where=target?target.name+' at '+target.position.floored():'an empty column';this.log('Gather: attempt '+failures+' on '+where+' failed: '+e.message);if(target&&this.gatherFailed(job,target,e)==='search')await searchLeg();}
    this.update(job,Math.max(0,count_()-job.startDrop),`Collected ${Math.max(0,count_()-job.startDrop)}/${s.count} ${job.dropName}`);
   }
   await this.sweepDrops(token);
  }finally{
   // A reflex or user stop owns the pathfinder now: skip the tunnel climb and the restore,
   // so they cannot fight the new owner's navigation. The resumed job climbs after gathering.
   if(token===this.epoch){
    // The kiln comes back (with its ingots) before the climb, also when the gather failed.
    if(job.kiln){try{await this.kilnTick(job,token,true);}catch(e){this.log('Gather: kiln at '+job.kiln.x+','+job.kiln.y+','+job.kiln.z+' not collected: '+e.message);}}
    if(job.tunnel?.length){try{await this.climbTunnel(job,token);if(this.strandedTunnel?.job===job.id)this.strandedTunnel=null;}catch(e){this.log('Could not climb back up the tunnel: '+e.message);}}
    b.pathfinder.setMovements(previous);
   }
   this.surfaceFloor=null;
  }
 }
 // Round 7 kiln (normal1 ended with 30 raw iron unsmelted: the ladder smelted only after the
 // whole 30-ore gather). An ore gather with smeltAt places the held furnace in its tunnel once
 // that much raw ore is held, loads it and keeps mining. When the batch should be done and
 // the bot is within 16, the output is taken and the furnace reloaded; at the end of the
 // gather (final) the last batch is waited for (KILN_WAIT_MS at most), the leftovers come
 // back and so does the furnace. A kiln that cannot start (no furnace, no fuel, no spot) is
 // off for this job - the ladder's smelt job is still there.
 async kilnTick(job,token,final=false){
  const b=this.bot,s=job.spec,raw=s.block==='gold_ore'?'raw_gold':s.block==='copper_ore'?'raw_copper':'raw_iron';
  const k=job.kiln;
  if(!k){
   if(final||job.kilnOff||this.count(raw)<s.smeltAt)return;
   const off=reason=>{job.kilnOff=reason;this.log('Gather: no kiln ('+reason+'); smelting after the gather');};
   if(!this.count('furnace'))return off('no furnace held');
   try{await this.fuelPlan(this.count(raw));}catch(e){return off(e.message);}
   let at;
   try{at=await this.placeBlockNear(token,'furnace');}catch(e){this.check(token);return off('could not place the furnace: '+e.message);}
   job.kiln={x:at.x,y:at.y,z:at.z,loaded:0,readyAt:0,taken:0};this.save();
   this.log('Gather: kiln at '+at.x+','+at.y+','+at.z+'; smelting '+raw+' while mining');
  }
  const kiln=job.kiln,at=new Vec3(kiln.x,kiln.y,kiln.z);
  if(!final&&kiln.loaded&&(Date.now()<kiln.readyAt||b.entity.position.distanceTo(at)>16))return;
  if(!final&&!kiln.loaded&&this.count(raw)<s.smeltAt)return;
  await this.walk(at,token,2);this.check(token);
  const block=b.blockAt(at);
  if(block?.name!=='furnace'){job.kiln=null;throw Error('the furnace is gone');}
  const furnace=await b.openFurnace(block);
  try{
   const out=()=>furnace.outputItem()?.count||0;
   if(final&&kiln.loaded){
    const until=Date.now()+Math.min(KILN_WAIT_MS,Math.max(0,kiln.readyAt-Date.now())+2000);
    while(furnace.inputItem&&furnace.inputItem()&&Date.now()<until){await sleep(1000);this.check(token);}
   }
   const n=out();if(n){await furnace.takeOutput();kiln.taken+=n;}
   if(final||!this.count(raw)){
    try{const left=furnace.inputItem&&furnace.inputItem();if(left){await furnace.takeInput();job.kilnIn=Math.max(0,(job.kilnIn||0)-(left.count||0));}}catch{}
    try{if(furnace.fuelItem&&furnace.fuelItem())await furnace.takeFuel();}catch{}
    kiln.loaded=0;
   }else if(!(furnace.inputItem&&furnace.inputItem())){
    // Empty: a fresh batch with fresh fuel (old fuel out first: a mixed slot refuses).
    try{if(furnace.fuelItem&&furnace.fuelItem())await furnace.takeFuel();}catch{}
    const count=Math.min(64,this.count(raw)),fuel=await this.fuelPlan(count);
    await furnace.putInput(b.registry.itemsByName[raw].id,null,count);
    job.kilnIn=(job.kilnIn||0)+count;
    await furnace.putFuel(fuel.id,null,fuel.count);
    kiln.loaded=count;kiln.readyAt=Date.now()+count*KILN_ITEM_MS+1000;
    this.log('Gather: kiln loaded with '+count+' '+raw+' ('+kiln.taken+' ingots taken so far)');
   }
  }finally{try{await b.closeWindow(furnace);}catch{}}
  this.save();
  if(final){
   job.kiln=null;
   try{await this.pickUp(at,'furnace',token);}catch(e){this.log('Left the furnace at '+at+': '+e.message);}
  }
 }
 // Failure bookkeeping for one gather target, counted per block and per column. The old
 // single counter blacklisted only the column of every THIRD failure, so attempts that
 // alternated between two trunks never blacklisted either, and the job-local list died with
 // the job (the ladder resubmits the same gather). A block that cannot be reached is
 // blacklisted at once (job + the shared blacklist, so the next job skips it too); any other
 // error twice on the same block also blacklists it; three failures in a column drop it.
 gatherFailed(job,target,e){
  const msg=String(e&&e.message||e);
  // Every block of this type needs the same tool: no other target can succeed either.
  if(/suitable harvesting tool/.test(msg))throw e;
  const p=target.position,bk=p.x+','+p.y+','+p.z,ck=p.x+','+p.z;
  job.blockFails=job.blockFails||{};job.colFails=job.colFails||{};job.badBlocks=job.badBlocks||[];
  if(!job.badColumns)job.badColumns=[];
  const n=job.blockFails[bk]=(job.blockFails[bk]||0)+1;
  const c=job.colFails[ck]=(job.colFails[ck]||0)+1;
  if((UNREACHABLE_BLOCK.test(msg)||n>=2)&&!job.badBlocks.includes(bk)){
   job.badBlocks.push(bk);if(job.badBlocks.length>64)job.badBlocks.shift();
   try{this.blacklist&&this.blacklist.block&&this.blacklist.block(p,GATHER_BLACKLIST_SECONDS);}catch{}
   this.log('Gather: skipping '+target.name+' at '+bk+' ('+msg+')');
  }
  if(c>=3&&!job.badColumns.includes(ck))job.badColumns.push(ck);
  this.save();
  // Round 10 (bug D): a gather that may search gives up on a grove sooner (SEARCH_REFUSALS):
  // round-9 hard1 spent ~7 min refusing 24 canopy blocks before its first search leg.
  const searchable=job.spec&&job.spec.searchIfMissing&&(job.searches||0)<3;
  const [cols,blocks]=searchable?SEARCH_REFUSALS:[8,24];
  if(job.badColumns.length>=cols||job.badBlocks.length>=blocks){
   // Round 9: a harvested grove (run 1's leftovers) is exhausted, not unsafe - look elsewhere.
   if(searchable){this.log('Gather: '+job.badColumns.length+' columns / '+job.badBlocks.length+' blocks refused here; searching further afield');job.badBlocks=[];job.colFails={};job.blockFails={};return 'search';}
   throw Error('Cannot gather safely: '+msg);
  }
 }
 gatherBlacklisted(job,p){
  if(job.badBlocks&&job.badBlocks.includes(p.x+','+p.y+','+p.z))return true;
  try{return !!(this.blacklist&&this.blacklist.blockRecently&&this.blacklist.blockRecently(p));}catch{return false;}
 }
 // Safe staircase: a 2-high 45-degree descending tunnel, dug by hand so every block is
 // checked. Stops (and fails honestly) at fluids and bedrock; records the tunnel so the
 // bot can walk back up the way it came. A stall guard turns a stuck descent into a clear
 // failure instead of looping.
 // opts (the stone dig-down): dir picked by pickStairDir, natural = only cut natural terrain
 // on solid floors, stopWhen = stop early once the tunnel has reached what the job wants.
 async staircase(job,token,targetY,opts={}){
  const b=this.bot;
  if(!job.tunnel)job.tunnel=[];
  const start=b.entity.position.floored();
  let dir=opts.dir||[new Vec3(1,0,0),new Vec3(0,0,1),new Vec3(-1,0,0),new Vec3(0,0,-1)][Math.abs(start.x*3+start.z)%4];
 let lastY=start.y,stalls=0;
 for(let steps=0;b.entity.position.floored().y>targetY&&steps<200;steps++){
  this.check(token);
  const step=await this.tunnelStep(job,token,dir,-1,true,opts.natural);
  dir=step.dir;const next=step.next;
  job.tunnel.push({x:next.x,y:next.y,z:next.z});this.strandedTunnel={points:job.tunnel,job:job.id};
  if(steps%TORCH_EVERY===TORCH_EVERY-1)await this.placeTorch(token,dir);
  const nowY=b.entity.position.floored().y;
  if(nowY>=lastY){if(++stalls>=2)throw Error('Staircase stalled at '+b.entity.position.floored());}
  else{stalls=0;lastY=nowY;}
  this.save();
  if(opts.stopWhen&&opts.stopWhen())break;
  }
 }
 // One tunnel step along dir (dy -1: a staircase step, 0: a strip-mine step): plan the
 // footing (a turn when the way on is unsafe), dig the cells, fill a shallow hole, walk in,
 // then free the bot's own head and feet (a late fall can still land on it). A bot that
 // ends up below the step dropped somewhere: the tunnel stops there.
 async tunnelStep(job,token,dir,dy,corner,natural,noTurn=false){
  const b=this.bot;
  const plan=planTunnelStep(b,job,dir,dy,noTurn);
  if(!plan.next)throw Error('Tunnel stopped: '+(plan.why.join('; ')||'no safe step')+'; no safe way on');
  const next=plan.next;
  const before=job.tunnel[job.tunnel.length-1];
  if(before&&before.x===next.x&&before.y===next.y&&before.z===next.z)throw Error((dy<0?'Staircase':'Strip mine')+' stalled at '+next);
  if(plan.turned)this.log('Tunnel: '+plan.why[0]+'; turning '+(plan.dir.x?(plan.dir.x>0?'east':'west'):(plan.dir.z>0?'south':'north')));
  await this.digTunnelStep(job,token,next,corner,natural,!!plan.foot.fill);
  if(plan.foot.fill){
   await fillFooting(this,token,plan.foot,plan.filler);
   this.log('Tunnel: '+(plan.foot.bridge?'bridged a gap':'filled a hole')+' under '+next+' with '+plan.filler);
  }
  const foot=stepFooting((x,y,z)=>b.blockAt(new Vec3(x,y,z)),next);
  if(!foot.ok)throw Error('Tunnel stopped: '+(foot.turn||'a hole under '+next)+' after the dig');
  await this.stepInto(next,plan.dir,token);
  const here=b.entity.position.floored();
  if(here.y<next.y)throw Error('Tunnel stopped: dropped to y='+here.y+' below the step at '+next);
  await this.clearCells(token,[here.offset(0,1,0),here],natural,false);
  await plugLava(this,token,here);
  await wallPickups(this,job,token,here,plan.dir);
  return {dir:plan.dir,next};
 }
 // Habit 8: diamonds the safe way - a branch mine at the trip's level (y -53, above the lava
 // lakes at -54): a main 1x2 tunnel (it may turn round a cave like any tunnel step) with a side
 // branch to the left and right every BRANCH_EVERY blocks. A branch ends at anything unsafe
 // (it never turns) and the bot walks back to the main tunnel; torches go every TORCH_EVERY
 // steps, lava beside the bot is plugged, wall ore is mined on the way, and stopWhen (the
 // gather has its count) ends it. job.tunnel holds only the main tunnel, for the climb back.
 async branchMine(job,token,{main=BRANCH_MAIN,branch=BRANCH_LEN,every=BRANCH_EVERY,stopWhen=null}={}){
  const b=this.bot;
  if(!job.tunnel)job.tunnel=[];
  const start=b.entity.position.floored();
  let dir=tunnelHeading(job.tunnel)||[new Vec3(1,0,0),new Vec3(0,0,1),new Vec3(-1,0,0),new Vec3(0,0,-1)][Math.abs(start.x+start.z*5)%4];
  for(let i=1;i<=main;i++){
   this.check(token);
   let step;
   try{step=await this.tunnelStep(job,token,dir,0,false,undefined);}
   catch(e){this.check(token);if(/^Tunnel stopped/.test(e.message)){this.log('Branch mine: main tunnel ended ('+e.message+')');break;}throw e;}
   dir=step.dir;
   job.tunnel.push({x:step.next.x,y:step.next.y,z:step.next.z});this.strandedTunnel={points:job.tunnel,job:job.id};
   if(i%TORCH_EVERY===0)await this.placeTorch(token,dir);
   this.save();
   if(stopWhen&&stopWhen())return;
   if(i%every)continue;
   const hub=b.entity.position.floored();
   for(const side of [new Vec3(-dir.z||0,0,dir.x||0),new Vec3(dir.z||0,0,-dir.x||0)]){
    const arm={id:job.id,tunnel:[{x:hub.x,y:hub.y,z:hub.z}],wallPickups:job.wallPickups,mined:job.mined};
    for(let j=1;j<=branch;j++){
     this.check(token);
     try{const st=await this.tunnelStep(arm,token,side,0,false,undefined,true);arm.tunnel.push({x:st.next.x,y:st.next.y,z:st.next.z});}
     catch(e){this.check(token);if(/^Tunnel stopped/.test(e.message))break;throw e;}
     if(stopWhen&&stopWhen())break;
    }
    job.wallPickups=arm.wallPickups;
    if(arm.tunnel.length>1){try{await this.climbTunnel(arm,token);}catch(e){this.check(token);this.log('Branch mine: walk back failed: '+e.message);}}
    if(stopWhen&&stopWhen())return;
   }
  }
 }
 // Move one cell along dir: try the pathfinder first, then walk straight in. The pathfinder
 // sometimes refuses (or fakes) the single step down a dug staircase.
 async stepInto(next,dir,token){
  const b=this.bot;
  const at=()=>b.entity.position.floored().equals(next);
  if(at())return;
  try{await this.navigate(new goals.GoalBlock(next.x,next.y,next.z),token,8);}catch(e){this.check(token);}
  if(at())return;
  await sleep(200);
  try{await b.look(Math.atan2(-dir.x,-dir.z),0);}catch{}
  b.setControlState('forward',true);
  const deadline=Date.now()+2500;
  try{while(Date.now()<deadline&&!at()){await sleep(80);this.check(token);}}finally{if(token===this.epoch)b.clearControlStates();}
 }
 // A 1x2 horizontal strip mine at the current level, used after descending for diamonds.
 async stripMine(job,token,length,opts={}){
  const b=this.bot;
  if(!job.tunnel)job.tunnel=[];
  const start=b.entity.position.floored();
  let dir=tunnelHeading(job.tunnel)||[new Vec3(1,0,0),new Vec3(0,0,1),new Vec3(-1,0,0),new Vec3(0,0,-1)][Math.abs(start.x+start.z*5)%4];
  let last=start.floored(),stalls=0;
  for(let steps=0;steps<length;steps++){
   this.check(token);
   const step=await this.tunnelStep(job,token,dir,0,false,undefined);
   dir=step.dir;const next=step.next;
   job.tunnel.push({x:next.x,y:next.y,z:next.z});this.strandedTunnel={points:job.tunnel,job:job.id};
   if(steps%TORCH_EVERY===TORCH_EVERY-1)await this.placeTorch(token,dir);
   const now=b.entity.position.floored();
   if(now.x===last.x&&now.z===last.z){if(++stalls>=2)throw Error('Strip mine stalled at '+now);}
   else{stalls=0;last=now;}
   this.save();
   if(opts.stopWhen&&opts.stopWhen())break;
  }
 }
 // A canopy or ledge can leave the target in sight but out of reach. Dig straight down
 // through natural blocks (leaves, dirt) until the target comes within reach - never into
 // fluids, never more than a few blocks.
 // Standing on a trunk column: mine the logs under the feet downward. Each dig drops the bot
 // one log lower and its drops are swept where the bot lands. Dark oak trunks are 2x2 and
 // tall, so one walked-on column usually yields several logs without any pathfinding.
 async mineColumnUnder(token){
  const b=this.bot;
  for(let i=0;i<12;i++){
   this.check(token);
   const feet=b.entity.position.floored(),below=b.blockAt(feet.offset(0,-1,0));
   if(!below||!/_log$/.test(below.name))return;
   for(const delta of [new Vec3(0,-2,0),new Vec3(1,-2,0),new Vec3(-1,-2,0),new Vec3(0,-2,1),new Vec3(0,-2,-1)])if(['lava','water'].includes(b.blockAt(feet.plus(delta))?.name))return;
   await b.tool.equipForBlock(below);
   await b.dig(below);this.check(token);await sleep(700); // fall through and land on the next log
  }
 }
 // The bot is standing on the leaf canopy of a dark forest (heightmap teleports land there):
 // trunks stand below, surrounded by leaves the pathfinder refuses to route through. Dig the
 // natural column directly under the feet and drop, one layer at a time - no pathfinding -
 // until real ground (not leaves/logs) is under the feet. A column whose next landing is a
 // deep hollow is left alone and a neighbouring leaf column with a shallow one is used
 // instead, so the descent costs no fall damage.
 async canopyDrop(token,target,depth=16){
  const b=this.bot;
  for(let i=0;i<depth;i++){
   this.check(token);
   if(target&&b.canDigBlock(target))return;
   const feet=b.entity.position.floored();
   const below=b.blockAt(feet.offset(0,-1,0));
   if(!below||below.boundingBox!=='block')return;
   if(!/_leaves$/.test(below.name)&&!/_log$/.test(below.name))return;
   for(const delta of [new Vec3(0,-2,0),new Vec3(1,-2,0),new Vec3(-1,-2,0),new Vec3(0,-2,1),new Vec3(0,-2,-1)])if(['lava','water'].includes(b.blockAt(feet.plus(delta))?.name))return;
   let air=0,probe=feet.offset(0,-2,0);
   while(air<4&&b.blockAt(probe)?.boundingBox!=='block'){air++;probe=probe.offset(0,-1,0);}
   if(air>=4){
    let moved=false;
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
     const side=feet.offset(dx,0,dz),sideBlock=b.blockAt(side);
     if(!sideBlock||sideBlock.boundingBox!=='block'||!/_leaves$/.test(sideBlock.name))continue;
     let a2=0,p2=side.offset(0,-1,0);
     while(a2<4&&b.blockAt(p2)?.boundingBox!=='block'){a2++;p2=p2.offset(0,-1,0);}
     if(a2>=4)continue;
     await b.tool.equipForBlock(sideBlock);
     await b.dig(sideBlock);await sleep(300);
     await this.walk(side,token,0.4,6).catch(()=>{});
     moved=true;break;
    }
    if(!moved)return; // hemmed in by deep hollows: try another target
    continue;
   }
   await b.tool.equipForBlock(below);
   await b.dig(below);await sleep(700); // fall through the dug layer and land
  }
 }
 async descendToReach(target,token){
  const b=this.bot;
  for(let descended=0;descended<8&&!b.canDigBlock(target);descended++){
   this.check(token);
   const feet=b.entity.position.floored();
   if(feet.y<=target.position.y+1)return; // at or below the target: descending cannot help
   if(Math.hypot(target.position.x-feet.x,target.position.z-feet.z)>4)return; // not overhead: descending moves away from it
   const below=b.blockAt(feet.offset(0,-1,0));
   if(!below||below.boundingBox!=='block'||!NATURAL_DIG.has(below.name)&&!/_leaves$/.test(below.name))return;
   for(const delta of [new Vec3(0,-1,0),new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1)])if(['lava','water'].includes(b.blockAt(feet.offset(0,-2,0).plus(delta))?.name))return;
   // The dig must not open a long fall: count the air below and refuse deep drops.
   let air=0;let probe=feet.offset(0,-2,0);
   // (round 10: this read `!x?.boundingBox==='block'`, always false - deep drops were never refused)
   while(air<2&&b.blockAt(probe)&&b.blockAt(probe).boundingBox!=='block'&&probe.y>-64){air++;probe=probe.offset(0,-1,0);}
   if(air>=2)return; // the dug block plus 2 open cells is a 3-block drop: refuse
   await b.tool.equipForBlock(below);
   await b.dig(below);await sleep(250);
   await sleep(400); // let the bot land
  }
 }
 async digTunnelStep(job,token,next,corner,natural,fillPlanned=false){
  const b=this.bot;
  const fluidAt=p=>['lava','water'].includes(b.blockAt(p)?.name);
  const feetBlock=b.blockAt(next),head=b.blockAt(next.offset(0,1,0)),floor=b.blockAt(next.offset(0,-1,0));
  const targets=[feetBlock,head,corner?b.blockAt(next.offset(0,2,0)):null].filter(bl=>bl&&bl.boundingBox==='block');
  // Surface dig-down: natural terrain only, and a solid floor under the step (no cave drop).
  if(natural){
   const foreign=targets.find(bl=>!natural(bl));
   if(foreign)throw Error('Tunnel stopped: '+foreign.name+' at '+foreign.position+' is not natural terrain');
   if(floor?.boundingBox!=='block'&&!fillPlanned)throw Error('Tunnel stopped: no floor under '+next);
  }
  for(const spot of [next,next.offset(0,1,0),...(corner?[next.offset(0,2,0)]:[])])for(const delta of [new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1),new Vec3(0,1,0)]){
   const p=spot.plus(delta);
   if(fluidAt(p))throw Error('Tunnel stopped: '+(b.blockAt(p)?.name||'fluid')+' at '+p.floored());
  }
  if(floor&&fluidAt(floor.position))throw Error('Tunnel stopped: '+floor.name+' at '+floor.position.floored());
  if(feetBlock?.name==='bedrock'||head?.name==='bedrock')throw Error('Tunnel stopped: bedrock at '+next);
  // Top-down (corner, head, feet): sand in the head cell must never drop into an open feet
  // cell. The bot stands in the previous column meanwhile, so whatever falls lands in the
  // step, never on the bot.
  await this.clearCells(token,[...(corner?[next.offset(0,2,0)]:[]),next.offset(0,1,0),next],natural);
 }
 // Dig `cells` (top first) until every one is air and nothing that falls sits on the top one:
 // a gravel stack above is dug block by block as it comes down. Throws after
 // TUNNEL_SETTLE_ROUNDS rather than step into a cell that is still filling.
 // watchAbove=false (the bot stands in these cells): only free them, never pull more down.
 async clearCells(token,cells,natural,watchAbove=true){
  const b=this.bot,top=cells[0];
  for(let round=0;;round++){
   this.check(token);
   const solidNow=cells.map(p=>b.blockAt(p)).filter(bl=>bl&&bl.boundingBox==='block');
   const above=b.blockAt(top.offset(0,1,0)),loose=watchAbove&&isGravity(above);
   // A falling block is an entity until it lands: the cells read air while it drops.
   const falling=Object.values(b.entities||{}).some(e=>e&&e.name==='falling_block'&&e.position&&Math.abs(e.position.x-top.x-0.5)<1&&Math.abs(e.position.z-top.z-0.5)<1&&e.position.y>=cells[cells.length-1].y-0.5);
   if(!solidNow.length&&!loose&&!falling)return round;
   if(round>=TUNNEL_SETTLE_ROUNDS)throw Error('Tunnel stopped: '+(loose?above.name:solidNow[0].name)+' keeps falling into '+cells[cells.length-1]);
   if(!solidNow.length&&!loose){await sleep(TUNNEL_FALL_MS);continue;}
   for(const block of solidNow.length?solidNow:[above]){
    this.check(token);
    if(natural&&!natural(block))throw Error('Tunnel stopped: '+block.name+' at '+block.position+' is not natural terrain');
    // Digging without the required tool destroys the block for nothing; refuse instead.
    if(block.harvestTools&&!(block.hardness<=HAND_CLEAR_HARDNESS)&&!Object.keys(block.harvestTools).some(id=>b.inventory.items().some(i=>i.type===+id)))throw Error('Tunnel needs a suitable tool in the inventory for '+block.name);
    await b.tool.equipForBlock(block);
    if(block.material==='incorrect_for_wooden_tool')block.material='mineable/pickaxe';
    await b.dig(block);await sleep(80);
   }
   // Something above can fall: wait for it to land before the cells are read again.
   if(loose||(watchAbove&&isGravity(b.blockAt(top.offset(0,1,0))))||solidNow.some(isGravity))await sleep(TUNNEL_FALL_MS);
  }
 }
 // Habit 7: a torch every TORCH_EVERY tunnel steps, on the right-hand wall of the way in (so
 // the torches are on the left on the way back - the way out is known); the floor when that
 // wall is open.
 async placeTorch(token,dir=null){
  const b=this.bot;
  if(!this.count('torch'))return;
  try{
   const feet=b.entity.position.floored(),plan=torchSpot((x,y,z)=>b.blockAt(new Vec3(x,y,z)),feet,dir);
   if(!plan)return;
   await b.equip(b.inventory.items().find(i=>i.name==='torch'),'hand');
   await b.placeBlock(b.blockAt(new Vec3(plan.against.x,plan.against.y,plan.against.z)),new Vec3(plan.face.x,plan.face.y,plan.face.z));
  }catch{}
 }
 // Walk back up a recorded tunnel; every point is clear air by construction.
 async climbTunnel(job,token){
  const b=this.bot,tunnel=job.tunnel||[];
  const previous=b.pathfinder.movements;
  b.pathfinder.setMovements(this.movements);
  try{
   for(let i=tunnel.length-1;i>=0;i--){
    this.check(token);
    const point=tunnel[i],goal=new goals.GoalBlock(point.x,point.y,point.z);
    // A diagonal 1-up step is 1.41 away, so the skip threshold must stay below that.
    if(b.entity.position.floored().distanceTo(new Vec3(point.x,point.y,point.z))<=0.9)continue;
    try{await this.navigate(goal,token,10);}
    catch(e){
     this.check(token);
     // Round 5 (144,124,53): 'No path to the goal!' / 'Navigation timed out' on the way up.
     // A step that gravel, sand or a placed block refilled cannot be walked with digging off.
     // Retry it with the explore movements (natural blocks only, dirt/cobble scaffold);
     // a step that still fails is skipped for the next one up - only the top must hold.
     this.log('Tunnel climb: step '+point.x+','+point.y+','+point.z+' failed ('+String(e.message).slice(0,60)+'); digging through natural fill');
     b.pathfinder.setMovements(this.exploreMovements());
     try{await this.navigate(goal,token,10);}
     catch(e2){this.check(token);if(i===0)throw e2;}
     finally{if(token===this.epoch)b.pathfinder.setMovements(this.movements);}
    }
   }
  }finally{if(token===this.epoch)b.pathfinder.setMovements(previous);}
 }
 // Pick the first recipe variant whose ingredients the inventory actually satisfies, and
 // rewrite planks-family ingredients to the held species: minecraft-data lists one variant
 // PER SPECIES (sticks: oak, dark_oak, birch, ...), recipesFor(...)[0] is just the first,
 // and craftConfirmed places ingredients by exact id - a dark-oak kit with an oak-first
 // variant threw 'Missing ingredient' forever (measured: soak sticks stayed 0 in all runs).
 usableRecipe(b,variants,table){
  const plankIds=new Set(Object.values(b.registry.itemsByName).filter(i=>/_planks$/.test(i.name)).map(i=>i.id));
  const count=id=>this.count(b.registry.items[id]?.name);
  for(const recipe of variants){
   const cells=recipe.inShape?recipe.inShape.flat().filter(x=>x&&x.id!==-1):(recipe.ingredients||[]);
   const tally={};
   for(const x of cells){const id=typeof x==='number'?x:x.id;tally[id]=(tally[id]||0)+1;}
   const subst={};let ok=true;
   for(const [id,need] of Object.entries(tally)){
    let have=count(Number(id));
    if(have<need&&plankIds.has(Number(id))){
     const held=(b.inventory.items()||[]).find(i=>plankIds.has(i.type)&&this.count(i.name)>=need);
     if(held){subst[Number(id)]=b.registry.itemsByName[held.name].id;have=this.count(held.name);}
    }
    if(have<need){ok=false;break;}
   }
   if(ok)return {recipe,subst};
  }
  return null;
 }
 withSubstitutions(recipe,subst){
  if(!Object.keys(subst).length)return recipe;
  const clone=Object.assign(Object.create(Object.getPrototypeOf(recipe)),recipe);
  if(clone.inShape)clone.inShape=clone.inShape.map(row=>row.map(x=>(x&&subst[x.id]!==undefined)?{...x,id:subst[x.id]}:x));
  if(clone.ingredients)clone.ingredients=clone.ingredients.map(x=>(subst[x.id]!==undefined)?{...x,id:subst[x.id]}:x);
  return clone;
 }
 async craft(job,token){
  const b=this.bot,s=job.spec,item=b.registry.itemsByName[s.item];if(!item)throw Error('Unknown item');
  if(job.targetCount===undefined)job.targetCount=this.count(s.item)+s.count;this.save();
  let placedAt=null,usedTable=null;
  try{
   while(this.count(s.item)<job.targetCount){
    this.check(token);
    // A table already in the world is REUSED, not re-placed (the soak's sword craft kept
    // failing placement while its table stood 5 blocks away): find it within 6 and walk to it.
    let table=b.findBlock({matching:b.registry.blocksByName.crafting_table.id,maxDistance:6});
    if(table&&b.entity.position.distanceTo(table.position)>3){
     try{await this.walk(table.position,token,2,15);}catch(e){this.check(token);}
     table=b.findBlock({matching:b.registry.blocksByName.crafting_table.id,maxDistance:6});
    }
    let picked=this.usableRecipe(b,b.recipesFor(item.id,null,1,table),table);
    if(!picked&&!table){
     const provisioned=await this.ensureTable(token);
     table=provisioned.block;placedAt=provisioned.created||placedAt;
     picked=this.usableRecipe(b,b.recipesFor(item.id,null,1,table),table);
    }
    if(table)usedTable=table;
    if(!picked)throw Error('Missing ingredients or a nearby crafting table');
    const before=this.count(s.item);
    await craftConfirmed(b,this.withSubstitutions(picked.recipe,picked.subst),table,()=>this.check(token));this.check(token);
    if(this.count(s.item)<=before)throw Error('Crafting produced no confirmed items');
    this.update(job,this.count(s.item),`Crafted ${s.item}`);
   }
  }finally{
   // keepTable (wood-step ladder jobs): leave the placed table standing for the next craft;
   // collectTable (the step's last craft): pick the used table back up even if this job only
   // reused it. Plain crafts keep the old contract: what they placed, they take back.
   // collectTable wins over keepTable: the ladder's last crafts (wooden axe, furnace) carry
   // both, and `!keepTable` alone left every step's table in the world (soak hard2 ended
   // its stone step with no table held).
   const collectAt=placedAt||(s.collectTable&&usedTable?usedTable.position:null);
   const standing=(s.keepTable&&!s.collectTable)?(placedAt||(usedTable&&usedTable.position)):null;
   if(standing)this.leftTable={x:standing.x,y:standing.y,z:standing.z};
   if(collectAt&&(s.collectTable||!s.keepTable)){
    try{await this.pickUp(collectAt,'crafting_table',token);if(this.leftTable&&pos(this.leftTable).equals(collectAt))this.leftTable=null;}
    catch(e){this.log('Left the crafting table at '+collectAt);this.leftTable={x:collectAt.x,y:collectAt.y,z:collectAt.z};}
   }
  }
 }
 async placeBlocks(support,face,target,name,token){
  const b=this.bot;
  for(let tries=0;tries<2;tries++){
   this.check(token);
   try{await b.placeBlock(support,face);}catch(e){await sleep(300);} // the client chunk can lag the server; retry once
   await sleep(120);
   if(b.blockAt(target)?.name===name)return;
  }
  throw Error('Placement was not verified at '+target);
 }
 async ensureTable(token){
  const b=this.bot;
  // One table within 6 blocks serves every craft (the soak's normal1 placed one and then
  // burned 15 jobs re-placing): walk to it instead of placing a second one.
  let existing=b.findBlock({matching:b.registry.blocksByName.crafting_table.id,maxDistance:6});
  if(existing){
   if(b.entity.position.distanceTo(existing.position)>3){
    try{await this.walk(existing.position,token,2,15);}catch(e){this.check(token);}
    existing=b.findBlock({matching:b.registry.blocksByName.crafting_table.id,maxDistance:6})||existing;
   }
   return {block:existing,created:null};
  }
  if(!this.count('crafting_table')){
   const picked=this.usableRecipe(b,b.recipesFor(b.registry.itemsByName.crafting_table.id,null,1,null),null);
   if(!picked)throw Error('Missing ingredients: need a crafting table, or 4 planks to make one');
   const before=this.count('crafting_table');
   await craftConfirmed(b,this.withSubstitutions(picked.recipe,picked.subst),null,()=>this.check(token));
   if(this.count('crafting_table')<=before)throw Error('Crafting a table produced no confirmed item');
  }
  const placedAt=await this.placeBlockNear(token,'crafting_table');
  return {block:b.blockAt(placedAt),created:placedAt};
 }
 async reachUp(token,target){
  const b=this.bot;
  const dx=target.position.x+0.5-b.entity.position.x,dz=target.position.z+0.5-b.entity.position.z;
  if(Math.hypot(dx,dz)>1.8)return;
  if(target.position.y>b.entity.position.y+4||target.position.y<=b.entity.position.y)return;
  b.setControlState('jump',true);await sleep(350);b.setControlState('jump',false);await sleep(150);
  if(b.canDigBlock(target))return;
  const mat=b.inventory.items().find(i=>i.name==='dirt'||/_planks$/.test(i.name)||i.name==='cobblestone');
  const below=b.blockAt(b.entity.position.floored().offset(0,-1,0));
  if(!mat||!solidSupport(below))return;
  await b.equip(mat,'hand');this.check(token);
  b.setControlState('jump',true);await sleep(200);
  try{await b.placeBlock(below,new Vec3(0,1,0));}catch{}
  await sleep(250);b.setControlState('jump',false);
 }
 async placeBlockNear(token,name){
  const b=this.bot;
  const id=b.registry.blocksByName[name]?.id;
  const seen=new Set((id?b.findBlocks({matching:id,maxDistance:6,count:16}):[]).map(p=>p.x+','+p.y+','+p.z));
  const foundNew=()=>{
   if(!id)return null;
   const spots=b.findBlocks({matching:id,maxDistance:4,count:8});
   for(const p of spots)if(!seen.has(p.x+','+p.y+','+p.z)&&b.blockAt(p)?.name===name)return p;
   return null;
  };
  const eyeReach=cell=>b.entity.position.offset(0,1.62,0).distanceTo(new Vec3(cell.x+0.5,cell.y+0.5,cell.z+0.5));
  // Voyager/ADAM placeItem: one click per candidate - the cell only needs to be air (or a
  // replaceable plant the server swaps out), the bot must not stand in it, and ANY solid
  // non-replaceable neighbour works as the reference face. The dark-oak floor failed the old
  // 12-fixed-cells top-face-only scan ("No clear spot" x15 per run) because trunks, ferns and
  // mushrooms filled every top-face slot.
  const tryCell=async(cell,support,face)=>{
   this.check(token);
   const item=b.inventory.items().find(i=>i.name===name);
   if(!item)throw Error('Ran out of '+name);
   await b.equip(item,'hand');
   // Diagnostic: what the server sent back during this click. A block_changed_ack without a
   // block update means the server received the click and rejected it (reach/hit check);
   // nothing at all means the packet never got through.
   const seenPackets={};const onPacket=(data,meta)=>{if(/^(block_change|multi_block_change|acknowledge_player_digging|block_changed_ack|position|entity_status|open_window)$/.test(meta.name))seenPackets[meta.name]=(seenPackets[meta.name]||0)+1;};
   b._client.on('packet',onPacket);
   try{await b.placeBlock(b.blockAt(new Vec3(support.x,support.y,support.z))||support,face);}catch(e){
    const p=b.entity.position;
    this.log('place '+name+' on '+(b.blockAt(new Vec3(support.x,support.y,support.z))?.name||support.name||'support')+' threw '+e.message+' | bot '+p.floored()+' held '+(b.heldItem?.name||'none')+' reach '+eyeReach(cell).toFixed(2)+' onGround '+b.entity.onGround+' packets '+JSON.stringify(seenPackets));
   }finally{b._client.removeListener('packet',onPacket);}
   await sleep(200);
   const point=new Vec3(cell.x,cell.y,cell.z);
   if(b.blockAt(point)?.name===name)return point;
   const scan=foundNew();if(scan)return scan;
   this.log('place '+name+' failed at '+point.floored()+' (support '+(b.blockAt(new Vec3(support.x,support.y,support.z))?.name||'?')+' face '+JSON.stringify(face)+'); cell is '+(b.blockAt(point)?.name||'missing'));
   return null;
  };
  // A table or furnace placed in the tunnel (a stone-step craft at the bottom of the dig-down)
  // would block the climb back out: its feet, head and corner cells stay open.
  const avoid=new Set();for(const p of (this.strandedTunnel?.points||[]))for(const dy of [0,1,2])avoid.add(p.x+','+(p.y+dy)+','+p.z);
  const plan=()=>placementCells((x,y,z)=>b.blockAt(new Vec3(x,y,z)),b.entity.position.floored(),
   {eye:b.entity.position.offset(0,1.62,0),maxReach:4.4,botPos:b.entity.position,avoid});
  const attempt=async()=>{
   let cells=plan();
   // In reach first.
   let failed=0;
   for(const c of cells.filter(c=>c.inReach)){
    if(failed>=3)break;
    const got=await tryCell(c.cell,c.support,c.face);
    if(got)return got;
    failed++;
   }
   // Only far cells left: walk to the nearest and rescan once - placement needs reach.
   if(failed===0&&cells.length){
    const far=cells[0];
    try{await this.navigate(new goals.GoalNear(far.cell.x,far.cell.y,far.cell.z,2),token,12);}catch(e){this.check(token);}
    for(const c of plan().filter(c=>c.inReach)){
     if(failed>=3)break;
     const got=await tryCell(c.cell,c.support,c.face);
     if(got)return got;
     failed++;
    }
   }
   // Nothing fits: break one natural soft block beside the bot (leaves, grass, fern, dirt)
   // and place into the opened cell - the cluttered dark-oak floor's last honest resort.
   const soft=softBreakCell((x,y,z)=>b.blockAt(new Vec3(x,y,z)),b.entity.position.floored(),{radius:3,minY:-1,maxY:1});
   // Boxed in by stone (a gather pit): with a pickaxe, open the wall right beside the feet
   // instead - a player does exactly that - as long as no fluid sits behind the wall.
   const fluidBehind=p=>[[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0],[0,-1,0]].some(([dx,dy,dz])=>['water','lava'].includes(b.blockAt(new Vec3(p.x+dx,p.y+dy,p.z+dz))?.name));
   const hasPick=b.inventory.items().some(i=>/_pickaxe$/.test(i.name));
   const hard=!soft&&hasPick?softBreakCell((x,y,z)=>{const bl=b.blockAt(new Vec3(x,y,z));return bl&&!fluidBehind({x,y,z})?bl:null;},b.entity.position.floored(),{radius:1,minY:0,maxY:1,matcher:HARD_BREAK}):null;
   const open=soft||hard;
   if(open){
    const block=b.blockAt(new Vec3(open.x,open.y,open.z));
    if(block&&eyeReach(open)<=4.4){
     this.check(token);
     this.log('place '+name+': breaking a '+open.name+' at '+new Vec3(open.x,open.y,open.z).floored()+' for room'+(hard?' (boxed in)':''));
     try{if(hard)await b.tool.equipForBlock(block);await b.dig(block);}catch(e){this.log('soft-break threw '+e.message);}
     await sleep(300);
     for(const c of plan().filter(c=>c.inReach&&c.cell.x===open.x&&c.cell.y===open.y&&c.cell.z===open.z)){
      const got=await tryCell(c.cell,c.support,c.face);if(got)return got;
     }
    }
   }
   // Still nothing: lay one dirt/plank on real ground and put the block on that pad.
   const mat=b.inventory.items().find(i=>i.name==='dirt'||/_planks$/.test(i.name));
   if(!mat)throw Error('No clear spot to place a '+name);
   const feet=b.entity.position.floored();
   for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[2,0],[-2,0],[0,2],[0,-2]]){
    const point=feet.offset(dx,0,dz),ground=b.blockAt(point.offset(0,-1,0)),above=point.offset(0,1,0);
    if(point.equals(feet)||point.equals(feet.offset(0,1,0))||avoid.has(point.x+','+point.y+','+point.z)||avoid.has(above.x+','+above.y+','+above.z))continue;
    if(hitsBot(b.entity.position,point.x,point.y,point.z)||hitsBot(b.entity.position,above.x,above.y,above.z))continue;
    if(!solidSupport(ground)||!empty(b.blockAt(point))||!empty(b.blockAt(above)))continue;
    if(eyeReach(point)>4.4)continue;
    this.check(token);
    const padItem=b.inventory.items().find(i=>i.name==='dirt'||/_planks$/.test(i.name));
    if(!padItem)break;
    await b.equip(padItem,'hand');
    try{await b.placeBlock(ground,new Vec3(0,1,0));}catch(e){this.log('pad on '+ground.name+' threw '+e.message);}
    await sleep(200);
    const pad=b.blockAt(point);
    if(!pad||pad.name!==padItem.name)continue;
    const got=await tryCell({x:above.x,y:above.y,z:above.z},{x:point.x,y:point.y,z:point.z,name:pad.name},{x:0,y:1,z:0});
    if(got)return got;
    break;
   }
   throw Error('No clear spot to place a '+name);
  };
  try{return await attempt();}
  catch(e){
   this.check(token);
   if(String(e.message).startsWith('Ran out'))throw e;
   // Harvested canopies decay under the candidate cells (the client's view goes stale);
   // move a few blocks over and scan a fresh patch once.
   const feet=b.entity.position.floored();
   try{await this.navigate(new goals.GoalNear(feet.x+3,feet.y,feet.z+1,1),token,12);}catch(err){this.check(token);}
   return await attempt();
  }
 }
 async pickUp(point,name,token){
  const b=this.bot,before=this.count(name);
  await this.walk(point,token,1);
  const block=b.blockAt(point);if(block?.name!==name)return;
  // A furnace drops nothing to a bare hand: take the right tool first (an axe for a table).
  try{await b.tool.equipForBlock(block,{});}catch{}this.check(token);
  await b.dig(block);this.check(token);await sleep(600);await this.walk(point,token,0.8);await sleep(400);await this.sweepDrops(token);
  if(b.blockAt(point)?.name===name)throw Error('Could not pick up the '+name);
  if(this.count(name)<=before)throw Error('The '+name+' drop was not collected');
 }
 async deposit(job,token){
  const b=this.bot,p=pos(job.spec.position);await this.walk(p,token,2);const block=b.blockAt(p);
  if(!block||!['chest','trapped_chest','barrel'].includes(block.name))throw Error('No chest or barrel at that position');
  const chest=await b.openContainer(block);
  // keep: deposit all but that many of the named item (the stacks are walked in order).
  let toGo=job.spec.item&&job.spec.keep!=null?Math.max(0,this.count(job.spec.item)-job.spec.keep):Infinity;
  try{for(const item of b.inventory.items()){this.check(token);if(job.spec.item&&item.name!==job.spec.item)continue;if(!job.spec.item&&/(_pickaxe|_axe|_shovel|_sword|_helmet|_chestplate|_leggings|_boots)$/.test(item.name))continue;const n=Math.min(item.count,toGo);if(n<=0)break;await chest.deposit(item.type,item.metadata,n);toGo-=n;}await sleep(150);await b._syncWindow(chest);await sleep(150);}finally{await chest.close();}
  await sleep(150);await b._syncWindow(b.inventory);this.check(token);
  if(job.spec.item&&this.count(job.spec.item)>(job.spec.keep??0))throw Error('Some items were not deposited');
 }
 // Habit 6: toss junk. Tossed items are remembered for JUNK_IGNORE_MS so the drop sweeps and
 // the collect job do not walk back and pick them up again.
 async drop(job,token){
  const b=this.bot,s=job.spec,have=this.count(s.item);
  if(!have)throw Error('No '+s.item+' to drop');
  const n=Math.min(have,s.count??have);
  let left=n;
  for(const it of b.inventory.items().filter(i=>i.name===s.item)){
   if(left<=0)break;
   const k=Math.min(left,it.count);
   this.check(token);await b.toss(it.type,null,k);left-=k;
  }
  (this.droppedJunk||(this.droppedJunk=new Map())).set(s.item,Date.now());
  await sleep(300);
  if(this.count(s.item)>have-n)throw Error('Dropping '+s.item+' did not lower the count');
  this.log('Dropped '+n+' '+s.item);
 }
 // A dropped item entity the bot tossed as junk a moment ago (drop job): not worth a walk.
 isDroppedJunk(e){
  try{
   if(!this.droppedJunk||!this.droppedJunk.size)return false;
   const it=typeof e.getDroppedItem==='function'?e.getDroppedItem():null,t=it&&this.droppedJunk.get(it.name);
   return !!t&&Date.now()-t<JUNK_IGNORE_MS;
  }catch{return false;}
 }
 async build(job,token){
  const b=this.bot,s=job.spec,blueprint=validateBlueprint(JSON.parse(fs.readFileSync(path.join(this.root,'blueprints',s.blueprint+'.json'),'utf8')));
  const entries=blueprint.blocks.map(block=>({...block,target:pos(s.origin).offset(block.x,block.y,block.z)})).sort((a,c)=>a.y-c.y);
  const footprint=new Set(entries.map(entry=>`${entry.target.x},${entry.target.z}`));
  const bounds={minX:Math.min(...entries.map(e=>e.target.x)),maxX:Math.max(...entries.map(e=>e.target.x)),minZ:Math.min(...entries.map(e=>e.target.z)),maxZ:Math.max(...entries.map(e=>e.target.z))};
  const around=async(point)=>{
   let start=b.entity.position.floored();const via=async(x,z)=>{await this.navigate(new goals.GoalBlock(x,point.y,z),token,15);start=b.entity.position.floored();};
   const xOutside=x=>x<bounds.minX||x>bounds.maxX,zOutside=z=>z<bounds.minZ||z>bounds.maxZ;
   // Use clear orthogonal lanes; diagonal corner cuts can collide with a placed block.
   if(zOutside(point.z)){
    if(!xOutside(start.x)&&((start.z<bounds.minZ)!==(point.z<bounds.minZ))){await via(bounds.minX-2,start.z);}
    await via(start.x,point.z);await via(point.x,point.z);
   }else if(xOutside(point.x)){
    if(!zOutside(start.z)&&((start.x<bounds.minX)!==(point.x<bounds.minX))){await via(start.x,bounds.minZ-2);}
    await via(point.x,start.z);await via(point.x,point.z);
   }else throw Error('Standing position intersects the build');
  };
  const avoidBuild=block=>footprint.has(`${block.position.x},${block.position.z}`)?100:0;
  this.movements.exclusionAreasStep.push(avoidBuild);b.pathfinder.setMovements(this.movements);
  try{
  if(!job.plan)job.plan=entries.map(({target,name})=>({position:target,name}));
  if(JSON.stringify(job.plan)!==JSON.stringify(entries.map(({target,name})=>({position:target,name}))))throw Error('Blueprint changed since job started; create a new job');this.save();
  // Preflight every mismatch and supply before changing any block.
  const need={};for(const e of entries){this.check(token);await this.walk(e.target,token,3);const existing=b.blockAt(e.target);if(existing?.name===e.name)continue;if(!empty(existing))throw Error('Build blocked by existing '+(existing?.name||'unloaded block')+' at '+e.target);need[e.name]=(need[e.name]||0)+1;}
  for(const [name,count]of Object.entries(need)){if(!b.registry.itemsByName[name])throw Error('Unknown building block '+name);if(this.count(name)<count)throw Error(`Need ${count} ${name}; inventory has ${this.count(name)}`);}
  const directions=[new Vec3(0,1,0),new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1),new Vec3(0,-1,0)];
  let complete=0;for(const e of entries){this.check(token);await this.walk(e.target,token,3);let current=b.blockAt(e.target);
   if(current?.name!==e.name){if(!empty(current))throw Error('Another block appeared at '+e.target);let support=null,face=null;
    for(const direction of directions){const neighbor=b.blockAt(e.target.minus(direction));if(neighbor?.boundingBox==='block'){support=neighbor;face=direction;break;}}
    if(!support)throw Error('No support for block at '+e.target);
    const occupied=new Set(entries.map(entry=>entry.target.toString()));const standing=[];
    // Farther columns are tried too: fixture clutter can occupy every near one. The reach
    // check below (4.4 blocks to the support face) still filters anything too distant.
    for(const [dx,dz]of [[-2,0],[2,0],[0,-2],[0,2],[-2,-2],[2,2],[2,-2],[-2,2],[0,-4],[0,4],[-4,0],[4,0]])for(let dy=0;dy>=-3;dy--){const point=e.target.offset(dx,dy,dz);if(footprint.has(`${point.x},${point.z}`)||occupied.has(point.toString())||occupied.has(point.offset(0,1,0).toString()))continue;if(empty(b.blockAt(point))&&empty(b.blockAt(point.offset(0,1,0)))&&b.blockAt(point.offset(0,-1,0))?.boundingBox==='block')standing.push(point);}
    standing.sort((a,c)=>a.distanceTo(b.entity.position)-c.distanceTo(b.entity.position));let approached=false;
    let lastApproachError='';for(const point of standing){try{await around(point);if(b.entity.position.offset(0,1.62,0).distanceTo(support.position.offset(.5,.5,.5))>4.4)continue;approached=true;break;}catch(error){this.check(token);lastApproachError=error.message;}}
    if(!approached)throw Error('No safe reachable standing spot beside '+e.target+': '+lastApproachError);
    const item=b.inventory.items().find(i=>i.name===e.name);if(!item)throw Error('Ran out of '+e.name);
    await b.equip(item,'hand');this.check(token);await this.placeBlocks(support,face,e.target,e.name,token);current=b.blockAt(e.target);if(current?.name!==e.name)throw Error('Placement was not verified at '+e.target);
   }this.update(job,++complete,`Verified ${complete}/${entries.length} blocks`);
  }
  }finally{this.movements.exclusionAreasStep=this.movements.exclusionAreasStep.filter(fn=>fn!==avoidBuild);if(token===this.epoch)b.pathfinder.setMovements(this.movements);}
 }
}
