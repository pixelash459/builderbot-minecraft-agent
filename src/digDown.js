// Stone step on surface-less terrain (soak hard runs, 2026-10-14): on a dirt hill under a
// dark-oak canopy findBlocks returns stone BURIED under the dirt, every walk to it fails with
// "Cannot reach or harvest", and the bot skipped dozens of blocks a second without collecting
// any. A player digs down where they stand instead. These are the pure decisions: mine
// exposed stone near the bot, else staircase down into the ground under it.
import {Vec3} from 'vec3';
const SIDES=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const DIRS=[[1,0],[0,1],[-1,0],[0,-1]];
export const STONE_NEAR=16,STONE_DIG_DOWNS=3,STONE_DIG_DEPTH=6,STONE_DIG_MIN=3;
export const isFluid=bl=>!!bl&&(bl.name==='water'||bl.name==='lava'||bl.name==='bubble_column');
// Terrain the bot may dig through on its own (tunnels, explore, a suffocation escape).
export const NATURAL_DIG=new Set(['dirt','grass_block','coarse_dirt','rooted_dirt','podzol','mycelium','mud','moss_block','sand','red_sand','gravel','clay','stone','cobblestone','deepslate','cobbled_deepslate','andesite','granite','diorite','tuff','calcite','dripstone_block','sandstone','netherrack','soul_sand','soul_soil','end_stone','snow','snow_block','packed_mud','terracotta']);
// Blocks that fall when the block under them is dug out. A sand or gravel stack over a
// tunnel step falls into the step, and onto the bot if it has already walked in (soak hard1
// and hard2, 2026-10-14: 'suffocated in a wall' twice during the stone dig-down).
export const isGravity=bl=>!!bl&&/^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|.*_concrete_powder|anvil|chipped_anvil|damaged_anvil)$/.test(bl.name);
const solid=bl=>!!bl&&bl.boundingBox==='block';
// A face touches open, non-fluid space (air, a cave, a dug tunnel): the bot can stand there
// and swing at it. Unloaded neighbours (null) do not count as open.
export function isExposed(blockAt,p){
 for(const [dx,dy,dz]of SIDES){const bl=blockAt(p.x+dx,p.y+dy,p.z+dz);if(bl&&!solid(bl)&&!isFluid(bl))return true;}
 return false;
}
// A target block in a side wall of the feet or head cell: the staircase has cut into stone
// that the bot can mine sideways (the floor does not count: no digging straight down).
export function stoneBeside(blockAt,feet,isTarget){
 for(const y of [feet.y,feet.y+1])for(const [dx,dz]of DIRS){const bl=blockAt(feet.x+dx,y,feet.z+dz);if(bl&&isTarget(bl))return true;}
 return false;
}
// Simulates the staircase (2-high, 45 degrees, corner cut: the cells feet/head/head+1 of each
// step) in each of the four directions from `start`, and returns the direction that goes
// deepest, then the one through the most target blocks. A step is refused when a cell is
// bedrock or not natural terrain (never a player-made block), when a fluid touches a cell,
// when sand or gravel sits on top of the step (it would fall into the tunnel), or when its floor is not solid (no drop into a cave or out from under a canopy). Null when
// no direction clears `min` steps. It never digs straight down: every step moves sideways.
export function pickStairDir(blockAt,start,{isNatural,isTarget=()=>false,steps=STONE_DIG_DEPTH,min=STONE_DIG_MIN}={}){
 let best=null;
 for(const [dx,dz]of DIRS){
  let clear=0,hits=0;
  for(let k=1;k<=steps;k++){
   const x=start.x+dx*k,y=start.y-k,z=start.z+dz*k;
   let ok=true;
   for(const cy of [y,y+1,y+2]){
    const bl=blockAt(x,cy,z);
    if(!bl||bl.name==='bedrock'||isFluid(bl)||(solid(bl)&&!isNatural(bl))){ok=false;break;}
    for(const [sx,sy,sz]of SIDES){if(sy<0)continue;if(isFluid(blockAt(x+sx,cy+sy,z+sz))){ok=false;break;}}
    if(!ok)break;
    if(isTarget(bl))hits++;
   }
   const floor=blockAt(x,y-1,z);
   if(!ok||!solid(floor)||isFluid(floor)||isGravity(blockAt(x,y+3,z)))break;
   clear=k;
  }
  if(clear>=min&&(!best||clear>best.steps||(clear===best.steps&&hits>best.stone)))best={dir:new Vec3(dx,0,dz),steps:clear,stone:hits};
 }
 return best;
}
// The stone-step decision for one scan. `targets` are the matching blocks in range.
// 1. exposed targets within `near` of the bot: mine those;
// 2. otherwise, when the scan saw the stone under the bot (within 12 below, `near` across)
//    and dig-downs are left: dig down (a staircase of 3-6 steps);
// 3. otherwise: exposed targets anywhere, then every target (the old behaviour).
// The block under the feet is never a stone target: taking it again and again is a shaft.
export function stonePlan({targets,botPos,blockAt,isNatural,isTarget,digDowns=0,near=STONE_NEAR,maxDigDowns=STONE_DIG_DOWNS}){
 const feet={x:Math.floor(botPos.x),y:Math.floor(botPos.y),z:Math.floor(botPos.z)};
 targets=targets.filter(t=>!(t.position.x===feet.x&&t.position.y===feet.y-1&&t.position.z===feet.z));
 const exposed=targets.filter(t=>isExposed(blockAt,t.position));
 const close=exposed.filter(t=>t.position.distanceTo(botPos)<=near);
 if(close.length)return {action:'mine',targets:close};
 const below=targets.some(t=>t.position.y<feet.y&&feet.y-t.position.y<=12&&Math.hypot(t.position.x-feet.x,t.position.z-feet.z)<=near);
 if(below&&digDowns<maxDigDowns){
  const stair=pickStairDir(blockAt,feet,{isNatural,isTarget});
  if(stair)return {action:'dig-down',dir:stair.dir,targetY:feet.y-stair.steps};
 }
 return {action:'mine',targets:exposed.length?exposed:targets};
}
// Round 10 (round-9 normal2 'fell from a high place' at y=13, normal3 18.4 -> 3.5 hp on the
// diamond staircase): the ore staircase and the strip mine never looked under the next step,
// so a cave or ravine opening under it dropped the bot. The footing of a step at `next`
// (its feet cell), checked two cells down before the bot walks in:
// - {ok:true}: a solid, non-fluid floor (sand/gravel only with something solid under it);
// - {fill,support,face}: the floor cell is a shallow hole (FILL_DEPTH cells or less of open
//   space): place one block into it from `support` (face = fill - support), then walk in;
// - {turn:reason}: a deep opening (a ravine, a cave), lava under the floor, a loose floor
//   over a hollow, or a hole with nothing to place against: take another direction.
// The bot never steps onto a cell it could drop more than one block from.
export const FILL_DEPTH=2;
// Round 11 (normal1 stopped at y=-16 and normal3 at y=84, `three openings, no safe way on`):
// a deep opening only BRIDGE_WIDTH cells wide along the tunnel's heading (solid ground again
// at the floor level or one below within that many cells ahead) is bridged like a hole: one
// block placed against a side of the floor cell, as a player bridges a crack. Pass `dir`.
export const BRIDGE_WIDTH=2;
export function stepFooting(blockAt,next,dir=null){
 const floor=blockAt(next.x,next.y-1,next.z),under=blockAt(next.x,next.y-2,next.z);
 if(!floor)return {turn:'unloaded floor under '+fmt(next)};
 if(isFluid(floor))return {turn:floor.name+' under '+fmt(next)};
 if(solid(floor)){
  if(isFluid(under)&&under.name==='lava')return {turn:'lava two below '+fmt(next)};
  if(isGravity(floor)&&!solid(under))return {turn:'loose '+floor.name+' over a hollow under '+fmt(next)};
  return {ok:true};
 }
 // Open floor: how deep does it go?
 let depth=1;
 while(depth<=FILL_DEPTH){const bl=blockAt(next.x,next.y-1-depth,next.z);if(!bl||solid(bl)||isFluid(bl))break;depth++;}
 const fill={x:next.x,y:next.y-1,z:next.z};
 const deep=depth>FILL_DEPTH;
 if(deep&&!narrowGap(blockAt,fill,dir))return {turn:'cave opening under '+fmt(next)+' ('+depth+'+ deep)'};
 for(const [dx,dy,dz] of [[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]){
  const p={x:fill.x+dx,y:fill.y+dy,z:fill.z+dz};
  const bl=blockAt(p.x,p.y,p.z);
  if(solid(bl)&&!isGravity(bl))return {fill,support:p,face:{x:-dx||0,y:-dy||0,z:-dz||0},...(deep?{bridge:true}:{})};
 }
 if(deep)return {turn:'cave opening under '+fmt(next)+' ('+depth+'+ deep) with nothing to bridge from'};
 return {turn:'hole under '+fmt(next)+' with nothing to build on'};
}
// The opening under `fill` ends within BRIDGE_WIDTH cells ahead: solid, non-fluid ground at
// the fill level or one below (a staircase's next floor) in one of the cells along dir.
function narrowGap(blockAt,fill,dir){
 if(!dir||!(dir.x||dir.z))return false;
 for(let k=1;k<=BRIDGE_WIDTH;k++)for(const dy of [0,-1]){
  const bl=blockAt(fill.x+dir.x*k,fill.y+dy,fill.z+dir.z*k);
  if(solid(bl)&&!isFluid(bl)&&!isGravity(bl))return true;
 }
 return false;
}
const fmt=p=>p.x+','+p.y+','+p.z;
// The directions a blocked staircase may turn to: straight on first, then the two sides;
// never back into its own tunnel.
export function turnOrder(dir){
 const side=[{x:dir.z||0,z:-dir.x||0},{x:-dir.z||0,z:dir.x||0}];
 return [{x:dir.x,z:dir.z},...side];
}
// Round 10 (efficiency 3): ore in the side walls of a tunnel cell the bot stands in is in arm's
// reach - a player mines it on the way. Side walls only (perpendicular to the tunnel: the cells
// ahead are dug anyway, behind is the tunnel): never the floor (no digging down) and never the
// ceiling (what sits on it would fall onto the bot), never a block a fluid touches.
export function wallOre(blockAt,feet,dir,isWanted){
 const out=[];
 const sides=[{x:dir.z||0,z:-dir.x||0},{x:-dir.z||0,z:dir.x||0}];
 for(const y of [feet.y,feet.y+1])for(const s of sides){
  const x=feet.x+s.x,z=feet.z+s.z,bl=blockAt(x,y,z);
  if(!bl||!isWanted(bl))continue;
  let wet=false;
  for(const [dx,dy,dz] of SIDES)if(isFluid(blockAt(x+dx,y+dy,z+dz))){wet=true;break;}
  if(!wet)out.push({x,y,z,name:bl.name});
 }
 return out;
}
