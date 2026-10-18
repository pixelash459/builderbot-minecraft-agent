// Research items 2 and 4: stand in open sky before cutting wood, and make the
// pathfinder pay to walk through mobs while the bot cannot win a fight.
// Pure helpers so the worker stays a thin caller and the tests need no server.
export const OPEN_SKY=12;
const RANGED=/^(skeleton|stray|bogged)$/;

export function avoidanceActive(armed,health){return !armed||(health??20)<10;}

// A place to stand beside a log where undead burn: feet and head clear, a solid
// floor, sky light >= 12. Already standing in that light means there is nothing
// to walk to. No such cell (dark-oak canopy) returns null so gathering continues.
export function pickOpenStand(blockAt,logs,origin){
 const ox=Math.floor(origin.x),oy=Math.floor(origin.y),oz=Math.floor(origin.z);
 const here=blockAt(ox,oy,oz);
 if(here&&(here.skyLight||0)>=OPEN_SKY&&here.boundingBox!=='block')return null;
 let best=null,bestD=Infinity;
 for(const log of (logs||[]).slice(0,16)){
  const lx=Math.floor(log.x),ly=Math.floor(log.y),lz=Math.floor(log.z);
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[2,0],[-2,0],[0,2],[0,-2]]){
   const x=lx+dx,y=ly,z=lz+dz;
   const feet=blockAt(x,y,z),head=blockAt(x,y+1,z),floor=blockAt(x,y-1,z);
   if(!feet||feet.boundingBox==='block')continue;
   if(!head||head.boundingBox==='block')continue;
   if(!floor||floor.boundingBox!=='block')continue;
   if((feet.skyLight||0)<OPEN_SKY)continue;
   const d=Math.hypot(x-ox,z-oz)+Math.abs(y-oy);
   if(d<bestD){bestD=d;best={x,y,z};}
  }
 }
 return best;
}

// True when (px,pz) sits on the xz segment from a shooter to the bot.
export function onShotLine(px,pz,from,to){
 const abx=to.x-from.x,abz=to.z-from.z,len2=abx*abx+abz*abz;
 if(len2<0.25)return false;
 const t=((px-from.x)*abx+(pz-from.z)*abz)/len2;
 if(t<0||t>1)return false;
 const qx=from.x+abx*t,qz=from.z+abz*t;
 return Math.hypot(px-qx,pz-qz)<=1.25;
}

// Path cost for one step. Grows inside 8 blocks of a hostile, and again on a
// skeleton's shot line, so a replan bends around both.
export function stepCost(block,hostiles,botPos){
 if(!block||!botPos)return 0;
 const p=block.position||block;
 let cost=0;
 for(const e of hostiles||[]){
  if(!e||!e.position)continue;
  const d=Math.hypot(p.x-e.position.x,p.z-e.position.z);
  if(d<8)cost+=(8-d)*6;
  if(RANGED.test(e.name||'')&&d<16&&onShotLine(p.x+0.5,p.z+0.5,e.position,botPos))cost+=40;
 }
 return Math.min(cost,STEP_COST_CAP); // round 22: shape paths, never price out every step
}
export const STEP_COST_CAP=40;

// No-progress watchdog for a pathfinder that hangs without an event (issues
// #222 and #273). A real step resets it; digging does not count as a stall.
export function trackProgress(pos,now,prev,limitMs=12000){
 if(!prev||pos.distanceTo(prev.pos)>0.35)return {pos:pos.clone(),since:now,stuck:false};
 return {pos:prev.pos,since:prev.since,stuck:now-prev.since>limitMs};
}

// Round 3 normal3 died 'shot by Skeleton' at y=41 while the food explore kept walking. An
// unshielded bot under fire breaks line of sight instead: the nearest standable cell within
// `radius` (feet and head open, solid floor, no fluid) whose eye line to every shooter's eye
// passes through a solid block. Sampled every 0.25 blocks; null when nothing near is covered.
export const SHOOTERS=RANGED;
export function lineBlocked(blockAt,from,to){
 const dx=to.x-from.x,dy=to.y-from.y,dz=to.z-from.z,len=Math.hypot(dx,dy,dz),steps=Math.ceil(len/0.25);
 const fx=Math.floor(from.x),fy=Math.floor(from.y),fz=Math.floor(from.z),tx=Math.floor(to.x),ty=Math.floor(to.y),tz=Math.floor(to.z);
 for(let i=1;i<steps;i++){
  const x=Math.floor(from.x+dx*i/steps),y=Math.floor(from.y+dy*i/steps),z=Math.floor(from.z+dz*i/steps);
  if((x===fx&&y===fy&&z===fz)||(x===tx&&y===ty&&z===tz))continue;
  const bl=blockAt(x,y,z);
  if(bl&&bl.boundingBox==='block')return true;
 }
 return false;
}
export function coverCell(blockAt,origin,shooters,{radius=5}={}){
 const ox=Math.floor(origin.x),oy=Math.floor(origin.y),oz=Math.floor(origin.z);
 const eyes=(shooters||[]).map(p=>({x:p.x,y:p.y+1.62,z:p.z}));
 if(!eyes.length)return null;
 let best=null,bestD=Infinity;
 for(let dy=-1;dy<=1;dy++)for(let dx=-radius;dx<=radius;dx++)for(let dz=-radius;dz<=radius;dz++){
  const x=ox+dx,y=oy+dy,z=oz+dz,d=Math.hypot(dx,dz)+Math.abs(dy);
  if(d>radius||d>=bestD)continue;
  const feet=blockAt(x,y,z),head=blockAt(x,y+1,z),floor=blockAt(x,y-1,z);
  if(!feet||!head||!floor||feet.boundingBox==='block'||head.boundingBox==='block'||floor.boundingBox!=='block')continue;
  if([feet,head,floor].some(bl=>/water|lava/.test(bl.name||'')))continue;
  const eye={x:x+0.5,y:y+1.62,z:z+0.5};
  if(eyes.every(s=>lineBlocked(blockAt,s,eye))){best={x,y,z};bestD=d;}
 }
 return best;
}
