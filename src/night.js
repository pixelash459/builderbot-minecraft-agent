// Night survival decisions (cloud round 5, after the round-4 dark-forest soak: 3 skeleton
// deaths and a drowning in one night). Pure helpers over a blockAt(x,y,z) lookup and plain
// positions, so the shelter job, the survival gate, Mob Defense and the autopilot share one
// tested rulebook:
// - the shelter starts at SUNSET (12000), ~50 s before the first spawns, not at bed time;
// - the shell is fully enclosed (feet ring, head ring, roof, open floor) and re-sealed;
// - a sealed shelter is never left for a flee: only a mob inside or next to a gap is hit;
// - caught outside in a crowd, pillar up 3 instead of sprinting through it;
// - flee headings and paths keep out of deep water after dark.
import {NIGHT_START,NIGHT_END} from './daytime.js';
export const SUNSET=12000,DUSK_PREP=10000;
// Night job window: the shelter goes up from sunset; a bed only works from NIGHT_START.
export const shelterDue=tod=>tod!=null&&tod>=SUNSET&&tod<=NIGHT_END;
export const darkNow=tod=>tod!=null&&tod>=SUNSET; // night jobs and new pillars: from sunset until the clock wraps to 0
// Round 7 hard3: sealed at sunset, the box came down the moment the clock wrapped to 0 and a
// skeleton shot the bot 3 blocks away during the next gather. At 0 the sun is barely up, the
// night's mobs are all still standing, and under a dark-forest canopy they never burn. A
// refuge (sealed shelter, holding pillar) is left only once the morning is light
// (MORNING_SAFE) and nothing hostile is within REFUGE_CLEAR; from MORNING_LATE a hostile
// beyond REFUGE_WALL no longer holds it (a shaded skeleton can stand there all day).
export const MORNING_SAFE=1000,MORNING_LATE=3000,REFUGE_CLEAR=16,REFUGE_WALL=6;
// Round 37: a refuge taken at dusk (an early shelter) holds from DUSK_PREP.
export const stillNight=tod=>tod!=null&&(tod>=DUSK_PREP||tod<MORNING_SAFE);
// Round 72 (round-71 hard2: opened at tod 3000 with the nearest hostile 10.9 away - the late
// rule let it go - and a creeper reached the bot 20 s later, blown up): a creeper does not burn
// by day, so one within REFUGE_CLEAR holds the refuge until CREEPER_LATE, then within REFUGE_WALL.
export const CREEPER_LATE=6000;
export function leaveRefuge(tod,nearest=Infinity,creeper=Infinity){
 if(tod==null)return true; // no clock: nothing to wait for
 if(stillNight(tod))return false;
 if(creeper<=(tod<CREEPER_LATE?REFUGE_CLEAR:REFUGE_WALL))return false;
 return nearest>(tod<MORNING_LATE?REFUGE_CLEAR:REFUGE_WALL);
}
// Round 37 (round-36 hard3: shot by a skeleton at tod ~11200 in a crowd of ~20, the iron gather
// and a smelt still going out): from DUSK_PREP a crowd of DUSK_CROWD+ hostiles within 16 makes
// the night's shelter due now.
export const DUSK_CROWD=3;
export const nightJobFor=(tod,bedNear,crowd=0)=>bedNear?(tod!=null&&tod>=NIGHT_START&&tod<=NIGHT_END?{type:'sleep'}:null):(shelterDue(tod)||(crowd>=DUSK_CROWD&&tod!=null&&tod>=DUSK_PREP&&tod<SUNSET)?{type:'shelter'}:null);
const solid=b=>!!b&&b.boundingBox==='block';
const fluid=b=>!!b&&/^(water|lava|bubble_column)$/.test(b.name||'');
const key=p=>p.x+','+p.y+','+p.z;
// The 3x3x3 box around the bot's 2-high cell. required: every cell that must be solid for
// no line of sight (feet ring, head ring, the full roof, and the floor under the feet when it
// is open). support: the ring under the feet ring, placed only to anchor the feet ring where
// nothing else can (a pillar top, a ledge).
// pod (round 9, hard2 was `Short of shelter blocks: 10 held, 14 needed` and spent the night
// failing a pillar): the 1x1 pod - the four feet faces, the full head ring, the roof cell
// over the bot and one roof cell beside it (the roof's only face to place against). No mob
// fits the feet diagonals under a solid head ring (a 2-high mob cannot stand there, a spider
// is too wide), so they stay open: 14 cells instead of 25.
export function shelterShell(origin,pod=false){
 const o={x:origin.x|0,y:origin.y|0,z:origin.z|0},required=[],support=[];
 for(let dy=0;dy<=2;dy++)for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
  if(!dx&&!dz&&dy<2)continue; // the bot's feet and head cells
  if(pod&&((dy===0&&dx&&dz)||(dy===2&&(dz||dx<0))))continue; // feet diagonals, the outer roof but x+1
  required.push({x:o.x+dx,y:o.y+dy,z:o.z+dz});
 }
 required.unshift({x:o.x,y:o.y-1,z:o.z}); // floor first: a bot over a hole is not enclosed
 for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)if((dx||dz)&&!(pod&&dx&&dz))support.push({x:o.x+dx,y:o.y-1,z:o.z+dz});
 return {origin:o,required,support,pod:!!pod};
}
// Round 11 (hard3: `1 open cells` and the box was given up for a night pillar that never rose):
// a box whose seal ran out of time with at most HOLD_GAPS open cells is still a refuge when
// the floor and the roof over the bot are solid and no side opening is two high (nothing
// walks in; a mob at a gap is hit by the guard, which keeps re-sealing).
export const HOLD_GAPS=2;
export function holdableShell(origin,gaps){
 const o={x:origin.x|0,y:origin.y|0,z:origin.z|0};
 if(!gaps.length)return true;
 if(gaps.length>HOLD_GAPS)return false;
 const at=(dx,dy,dz)=>gaps.some(g=>g.x===o.x+dx&&g.y===o.y+dy&&g.z===o.z+dz);
 if(at(0,-1,0)||at(0,2,0))return false;
 return !gaps.some(g=>g.y===o.y&&at(g.x-o.x,1,g.z-o.z));
}
// Cells of `cells` that are not solid (a gap a mob can see or walk through). Unloaded cells
// (null) count as gaps: the job can only vouch for what it sees.
export const shellGaps=(blockAt,cells)=>cells.filter(c=>!solid(blockAt(c.x,c.y,c.z)));
// Placement order for one pass: a cell is placeable when a face neighbour is solid (or will
// be, earlier in the same pass). Returns [{cell, against}] for the cells that can go now.
const FACES=[[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]];
export function placementPlan(blockAt,cells){
 const done=new Set(),out=[];
 const isSolid=p=>done.has(key(p))||solid(blockAt(p.x,p.y,p.z));
 let progress=true;
 const left=cells.filter(c=>!solid(blockAt(c.x,c.y,c.z)));
 while(progress&&left.length){
  progress=false;
  for(let i=0;i<left.length;i++){
   const c=left[i];
   const f=FACES.find(([dx,dy,dz])=>isSolid({x:c.x-dx,y:c.y-dy,z:c.z-dz}));
   if(!f)continue;
   out.push({cell:c,against:{x:c.x-f[0],y:c.y-f[1],z:c.z-f[2]},face:{x:f[0],y:f[1],z:f[2]}});
   done.add(key(c));left.splice(i,1);i--;progress=true;
  }
 }
 return {plan:out,stuck:left};
}
// A hostile inside the box: its feet within the bot's column (the 1x2 interior).
export function insideShelter(pos,origin){
 return Math.abs(pos.x-(origin.x+0.5))<1&&Math.abs(pos.z-(origin.z+0.5))<1&&pos.y>=origin.y-0.5&&pos.y<origin.y+2;
}
// What a sealed shelter may hit: a hostile inside, or one standing at a gap (its feet or
// eyes within 1.6 of an open cell's centre) and in reach (3.0 from the bot's eyes).
export function shelterTarget(hostiles,origin,gaps,reach=3){
 const eye={x:origin.x+0.5,y:origin.y+1.62,z:origin.z+0.5};
 let best=null,bestD=Infinity;
 for(const h of hostiles||[]){
  if(!h||!h.position)continue;
  const p=h.position;
  const inside=insideShelter(p,origin);
  const d=Math.hypot(p.x-eye.x,(p.y+1)-eye.y,p.z-eye.z);
  if(!inside){
   if(d>reach+0.5)continue;
   const atGap=gaps.some(g=>Math.hypot(p.x-(g.x+0.5),p.z-(g.z+0.5))<=1.6&&g.y>=Math.floor(p.y)-1&&g.y<=Math.floor(p.y)+2);
   if(!atGap)continue;
  }
  const score=inside?d-100:d;
  if(score<bestD){bestD=score;best={entity:h,inside,distance:d};}
 }
 return best;
}
// Pillar height (0..max) the standing cell allows: solid support, cells up to y+h+1 open.
export function pillarRoom(blockAt,x,y,z,max=3){
 if(!solid(blockAt(x,y-1,z)))return 0;
 let h=0;
 for(let i=1;i<=max;i++){
  const b=blockAt(x,y+i+1,z);
  if(solid(b)||fluid(b))break;
  h=i;
 }
 return h;
}
// Caught outside after dark: a crowd (3+ hostiles within 16), or any hostile within 8 that
// the fight policy refuses. Sprinting away from the nearest one ran the round-4 bot through
// the rest of the pack, into a lake, and under skeleton fire. The answer is a 3-block
// pillar (zombies cannot reach, creepers cannot fuse from the base) when 3+ blocks are held
// and the column fits; null leaves the ordinary ladder (fight / flee) in charge.
// forced: tonight's shelter failed (worker.shelterFallback) - climb before any mob arrives
// and hold the column until morning (hold), not just until the crowd thins out.
export const DAY_CROWD=6;
export function nightRefuge({tod,me,hostiles,blocks=0,room=0,onGround=true,inFluid=false,fightAllowed=false,forced=false}){
 if(!me)return null;
 const near=(hostiles||[]).filter(h=>h&&h.position&&Math.hypot(h.position.x-me.x,h.position.y-me.y,h.position.z-me.z)<=16);
 // Round 40 (round-39 hard run: slain by a zombie 3 min in, by day, fleeing ~20 mobs under the
 // dark-forest canopy with planks in the bag): a crowd of DAY_CROWD+ climbs by day too.
 if(!darkNow(tod)&&!(near.length>=DAY_CROWD))return null;
 if(!near.length&&!forced)return null;
 const close=near.filter(h=>Math.hypot(h.position.x-me.x,h.position.z-me.z)<=8);
 const crowd=near.length>=3||(!fightAllowed&&close.length>0);
 if(!crowd&&!forced)return null;
 // Round 42 (round-41 hard run: slain by day fleeing ~20 mobs, no pillar line - under a dark-oak
 // canopy the leaves leave 2 cells of headroom): a day pillar may be 2 high.
 const day=!darkNow(tod),need=day?2:3;
 if(inFluid||!onGround||blocks<need||room<need)return null;
 // A mob already touching the column climbs with us (spiders) or blocks the jump: fight/flee.
 if(near.some(h=>Math.hypot(h.position.x-me.x,h.position.z-me.z)<1.2))return null;
 if(day)return {action:'pillar',height:Math.min(3,room),crowd:near.length,day:true};
 return forced?{action:'pillar',height:3,crowd:near.length,hold:true}:{action:'pillar',height:3,crowd:near.length};
}
// Deep water: a water cell with water above or below it (no footing). The step cost bans
// it after dark (cost 100 is the pathfinder's "cannot move"), and makes it expensive by day.
export function deepWaterCost(blockAt,pos,dark){
 const here=blockAt(pos.x,pos.y,pos.z);
 if(!here||!/^(water|bubble_column)$/.test(here.name||''))return 0;
 const below=blockAt(pos.x,pos.y-1,pos.z),above=blockAt(pos.x,pos.y+1,pos.z);
 const deep=[below,above].some(b=>b&&/^(water|bubble_column)$/.test(b.name||''));
 if(!deep)return 0;
 return dark?100:12;
}
// Flee heading for a blind sprint (RunAwayTask holds forward): away from the crowd's
// weighted centre, not just the nearest mob, and never into water, lava or a drop deeper
// than 3 within 4 blocks, nor through a hostile. Unknown (null) blocks are not hazards.
// Returns a unit heading {x,z,cost,blocked}, or null with no hostiles.
// inWater: the bot is already swimming - water ahead costs per cell (the heading with the
// least water leads to the shore) instead of ruling the heading out; lava still does.
export function fleeHeading(blockAt,me,hostiles,{shelter=null,inWater=false}={}){
 const list=(hostiles||[]).filter(h=>h&&h.position);
 if(!list.length)return null;
 let ax=0,az=0;
 for(const h of list){
  const dx=me.x-h.position.x,dz=me.z-h.position.z,d=Math.max(0.5,Math.hypot(dx,dz));
  ax+=dx/(d*d);az+=dz/(d*d);
 }
 if(Math.hypot(ax,az)<1e-6){ax=1;az=0;}
 const base=Math.atan2(az,ax);
 const fx=Math.floor(me.x),fy=Math.floor(me.y),fz=Math.floor(me.z);
 const lava=b=>!!b&&b.name==='lava';
 const hazard=(hx,hz)=>{
  let wet=0;
  for(let s=1;s<=4;s++){
   const x=Math.floor(me.x+hx*s),z=Math.floor(me.z+hz*s);
   if(x===fx&&z===fz)continue;
   // The walk climbs one block or drops up to three: find the footing near the bot's level.
   const feet=blockAt(x,fy,z),head=blockAt(x,fy+1,z);
   if(inWater&&(fluid(feet)||fluid(head))&&!lava(feet)&&!lava(head)){wet+=10;continue;}
   if(fluid(feet)||fluid(head))return 100;
   if(feet==null)continue; // unloaded / unknown
   if(solid(feet)){const up=blockAt(x,fy+1,z),up2=blockAt(x,fy+2,z);if(solid(up)||solid(up2))return 20;continue;} // a wall: slows, not deadly
   let drop=0;
   for(let dy=1;dy<=4;dy++){const b=blockAt(x,fy-dy,z);if(b==null){drop=0;break;}if(fluid(b))return 100;if(solid(b))break;drop=dy;}
   if(drop>3)return 60;
  }
  return wet;
 };
 const through=(hx,hz)=>{
  let pen=0;
  for(const h of list){
   const rx=h.position.x-me.x,rz=h.position.z-me.z,t=rx*hx+rz*hz;
   if(t<=0||t>8)continue;
   const off=Math.abs(rx*hz-rz*hx);
   if(off<2.5)pen+=40*(1-off/2.5)+10;
  }
  return pen;
 };
 let best=null;
 for(const turn of [0,0.39,-0.39,0.79,-0.79,1.18,-1.18,1.57,-1.57,2.36,-2.36,Math.PI]){
  const a=base+turn,hx=Math.cos(a),hz=Math.sin(a);
  const hz2=hazard(hx,hz);
  let cost=Math.abs(turn)*8+hz2+through(hx,hz);
  if(shelter){
   const sx=shelter.x+0.5-me.x,sz=shelter.z+0.5-me.z,sd=Math.hypot(sx,sz);
   if(sd>1&&sd<=24)cost-=6*Math.max(0,(sx*hx+sz*hz)/sd);
  }
  if(!best||cost<best.cost)best={x:hx,z:hz,cost,turn,hazard:hz2};
 }
 // blocked: even the best heading walks into a fluid - better to stand than to swim.
 return {x:best.x,z:best.z,cost:best.cost,blocked:best.hazard>=100};
}
// Round 10, habit 4 (use the night instead of idling): experienced players spend the first
// nights in a staircase mine under their shelter. A sealed box (not a pod) with a stone or
// better pickaxe and NIGHT_MINE_BLOCKS blocks held mines from NIGHT_MINE_FROM (the first
// spawns are past) for at most NIGHT_MINE_MS, and is back in the box by NIGHT_MINE_STOP.
export const NIGHT_MINE_FROM=SUNSET+600,NIGHT_MINE_STOP=21500,NIGHT_MINE_MS=6*60000,NIGHT_MINE_BLOCKS=4,NIGHT_MINE_DEPTH=10,NIGHT_MINE_STRIP=16; // round 17: deeper and longer (hard runs sat sealed and idle until dawn, no furnace)
export function nightMineWanted({tod,pod=false,pickaxe=false,blocks=0,done=false,enabled=true,health=20}){
 if(!enabled||done||pod||!pickaxe||blocks<NIGHT_MINE_BLOCKS)return false;
 if(health<16)return false; // habit 10: heal in the box before risky work
 return tod!=null&&tod>=NIGHT_MINE_FROM&&tod<NIGHT_MINE_STOP;
}
// A tunnel cell the bot stands in that opens onto space it did not dig (a cave): mobs can walk
// in, so the night mine turns back. `known` holds 'x,y,z' keys of the cells it dug itself.
export function tunnelBreach(blockAt,feet,known){
 const cells=[[0,0,1],[0,0,-1],[1,0,0],[-1,0,0],[0,1,1],[0,1,-1],[1,1,0],[-1,1,0],[0,2,0]];
 for(const [dx,dy,dz] of cells){
  const p={x:feet.x+dx,y:feet.y+dy,z:feet.z+dz};
  if(known.has(key(p)))continue;
  const bl=blockAt(p.x,p.y,p.z);
  if(bl&&!solid(bl)&&!fluid(bl))return p;
 }
 return null;
}
