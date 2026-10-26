// A support you can click the top of. Snow layers and other replaceable plants report
// boundingBox 'block' on some states, and placeBlock then waits in the ground cell.
const REPLACEABLE=/^(snow|powder_snow|.*carpet|short_grass|tall_grass|fern|large_fern|.*sapling|vine|.*_vine|dead_bush|.*flower|dandelion|poppy|blue_orchid|allium|azure_bluet|.*tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|.*_pressure_plate|.*_button|.*_sign|.*_banner|.*_torch|rail|.*_rail|redstone_wire|tripwire|.*_mushroom|seagrass|tall_seagrass|kelp|kelp_plant|hanging_roots|pink_petals|fire|soul_fire|sweet_berry_bush|cave_vines|cave_vines_plant)$/;
export function solidSupport(block){
 if(!block||block.boundingBox!=='block')return false;
 if(block.replaceable)return false;
 if(REPLACEABLE.test(block.name||''))return false;
 return true;
}
// Natural soft blocks a player clears by hand to make room. _leaves first so
// longer suffix branches can never shadow it.
export const SOFT_BREAK=/^(.*_leaves|short_grass|tall_grass|fern|large_fern|dead_bush|dirt|grass_block|snow|powder_snow|.*_sapling|.*_mushroom|pink_petals|wildflowers|leaf_litter|dandelion|poppy|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|cornflower|lily_of_the_valley)$/;
// Round 52 (round-52 soak: `place crafting_table failed ... cell is pink_petals` on every try,
// the shield craft re-submitted for minutes): plants and fixtures that are not a support yet
// are NOT replaced by a placement - the server refuses the click. Only grass, ferns, dead bushes,
// vines, snow layers, seagrass and fire are replaceable.
export const PLACE_BLOCKER=/^(.*_sapling|.*_mushroom|.*_fungus|.*flower|lilac|rose_bush|peony|pitcher_plant|dandelion|poppy|blue_orchid|allium|azure_bluet|.*tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|torchflower|pink_petals|wildflowers|leaf_litter|sweet_berry_bush|sugar_cane|bamboo.*|cactus|.*_pressure_plate|.*_button|.*_sign|.*_banner|torch|.*_torch|wall_torch|rail|.*_rail|redstone_wire|tripwire|kelp|kelp_plant|cave_vines|cave_vines_plant|.*_carpet|carpet)$/;
const AIR_NAME=/^(air|cave_air|void_air)$/;
const CRAFTING_TABLE=/crafting_table$/;
// Support face preference: below, then +x,-x,+z,-z, then above.
const SUPPORT_DIRS=[[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]];
// A placement into this cell succeeds server-side: real air or replaceable
// (snow layers / plants report boundingBox 'block' yet are replaceable).
function placeableInto(block){
 if(!block)return false; // null = unknown chunk, never a candidate
 if(AIR_NAME.test(block.name||''))return true;
 if(PLACE_BLOCKER.test(block.name||''))return false;
 if(block.replaceable)return true;
 if(REPLACEABLE.test(block.name||''))return true;
 return block.boundingBox==='empty';
}
function sortKey(dx,dz,dy){return Math.hypot(dx,dz)*2+Math.abs(dy)*3;} // near and same-level first
function ownCell(feet,dx,dy,dz){return dx===0&&dz===0;} // the whole feet column: feet, head AND the block we stand on
// The server refuses a placement whose block would overlap the player's own hitbox
// (0.6 wide, 1.8 tall). A bot standing near a cell edge overlaps the next cell over,
// so those cells are skipped up front instead of burning a 5 s round trip each.
export function hitsBot(botPos,x,y,z,margin=0.05){
 if(!botPos)return false;
 const hw=0.3+margin;
 return x<botPos.x+hw&&x+1>botPos.x-hw&&z<botPos.z+hw&&z+1>botPos.z-hw&&y<botPos.y+1.8+margin&&y+1>botPos.y; // no margin below: the bot stands on blocks
}
// avoid: 'x,y,z' keys never to fill (the open tunnel the bot climbs back out through).
export function placementCells(blockAt,feet,{radius=3,minY=-1,maxY=1,eye=null,maxReach=null,botPos=null,avoid=null}={}){
 const measure=!!(eye&&maxReach!=null);
 const out=[];
 for(let dy=minY;dy<=maxY;dy++)for(let dx=-radius;dx<=radius;dx++)for(let dz=-radius;dz<=radius;dz++){
  if(ownCell(feet,dx,dy,dz))continue;
  const x=feet.x+dx,y=feet.y+dy,z=feet.z+dz;
  if(avoid&&avoid.has(x+','+y+','+z))continue;
  if(hitsBot(botPos,x,y,z))continue;
  if(!placeableInto(blockAt(x,y,z)))continue;
  let support=null;
  for(const[ox,oy,oz]of SUPPORT_DIRS){
   const n=blockAt(x+ox,y+oy,z+oz);
   if(solidSupport(n)&&!CRAFTING_TABLE.test(n.name||'')){ // never stack on a table
    const p=n.position||{x:x+ox,y:y+oy,z:z+oz};
    support={x:p.x,y:p.y,z:p.z,name:n.name};
    break;
   }
  }
  if(!support)continue;
  const reach=measure?Math.hypot(eye.x-x-0.5,eye.y-y-0.5,eye.z-z-0.5):null;
  out.push({cell:{x,y,z},support,face:{x:x-support.x,y:y-support.y,z:z-support.z},
   reach,inReach:measure?reach<=maxReach:true,key:sortKey(dx,dz,dy)});
 }
 out.sort((a,b)=>a.key-b.key);
 return out.map(({key,...e})=>e);
}
// Natural stone a player with a pickaxe breaks to make room when boxed in (a stone-gather
// pit has nothing but these around it; measured soak 20261014-0239 normal3: "No clear spot"
// x20 from one pit, the run ended there).
export const HARD_BREAK=/^(stone|cobblestone|andesite|diorite|granite|tuff|deepslate|cobbled_deepslate|calcite|dripstone_block|gravel|sand|red_sand|sandstone|red_sandstone|terracotta|.*_terracotta|packed_ice|snow_block|netherrack|basalt|blackstone|end_stone|mossy_cobblestone|clay|mud|packed_mud|coarse_dirt|rooted_dirt|podzol|mycelium)$/;
export function softBreakCell(blockAt,feet,{radius=2,minY=-1,maxY=1,matcher=SOFT_BREAK}={}){
 const hits=[];
 for(let dy=minY;dy<=maxY;dy++)for(let dx=-radius;dx<=radius;dx++)for(let dz=-radius;dz<=radius;dz++){
  if(ownCell(feet,dx,dy,dz))continue; // never mine the column the bot occupies
  const x=feet.x+dx,y=feet.y+dy,z=feet.z+dz;
  const b=blockAt(x,y,z);
  if(!b||!matcher.test(b.name||''))continue;
  hits.push({x,y,z,name:b.name||'',key:sortKey(dx,dz,dy)});
 }
 hits.sort((a,b)=>a.key-b.key);
 if(!hits.length)return null;
 const{key,...best}=hits[0];
 return best;
}
