// Adapted for BuilderBot from AltoClef's WorldSurvivalChain.handleDrowning
// (MIT License, Copyright (c) 2020 Adris Jautakas): AltoClef held jump as a reflex while
// drowning; as a task we pick the nearest walk-out spot (solid ground, two air above, no
// fluid) and path there, jumping to keep our air up while submerged.
import {Vec3} from 'vec3';
import {Task} from '../task.js';
import {blockGoal} from './goals.js';
import * as move from './move.js';

export function inWater(bot){
 if(bot.entity?.isInWater)return true;
 try{const p=bot.entity.position.floored();return ['water','seagrass','tall_seagrass','kelp','kelp_plant'].includes(bot.blockAt(p)?.name)||['water'].includes(bot.blockAt(new Vec3(p.x,p.y+1,p.z))?.name);}catch{return false;}
}
export function findNearestLand(bot,from,radius=24){
 for(let r=0;r<=radius;r++){
  for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++){
   if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;
   for(let dy=3;dy>=-3;dy--){
    const p=new Vec3(Math.floor(from.x)+dx,Math.floor(from.y)+dy,Math.floor(from.z)+dz);
    const body=bot.blockAt(p);
    if(!body||!['air','cave_air','void_air'].includes(body.name))continue;
    if(!['air','cave_air','void_air'].includes(bot.blockAt(new Vec3(p.x,p.y+1,p.z))?.name))continue;
    const ground=bot.blockAt(new Vec3(p.x,p.y-1,p.z));
    if(!ground||ground.boundingBox!=='block'||['water','lava'].includes(ground.name))continue;
    return p;
   }
  }
 }
 return null;
}

// Round 55 (round-54 soak: three drownings - normal2 at (13, 47, -8) went from air 8 to 0 in 20 s
// on 'swimming up' while the land search pathed sideways under water): from the head cell up,
// how far the water goes. {open: n} - air n cells above the head; {roof: block, dy} - a solid
// block dy cells above the head; null - deeper than max.
// The air on the 0-20 scale whether the server sends it in ticks (0-300) or bubbles (0-20).
// Round 78 (round-77 normal2 drowned at (844, 100, -440): `head block cherry_slab at eye y 102.3,
// in water`, 21 s after `drowning (air 8), swimming up` - a waterlogged top slab in a build, the
// eye in the water under its upper half; the head checks matched the block's name only, so no
// straight-up, pocket or roof branch ever ran, and mineflayer exposes the state as
// isWaterlogged / getProperties(), not the `properties` the older checks read).
export function waterlogged(bl){
 if(!bl)return false;
 const v=bl.isWaterlogged??bl.properties?.waterlogged??(typeof bl.getProperties==='function'?bl.getProperties()?.waterlogged:undefined);
 return v===true||v==='true';
}
export const airOf=bot=>{const a=typeof bot.oxygenLevel==='number'?bot.oxygenLevel:(typeof bot.oxygen==='number'?bot.oxygen:20);return a>20?Math.min(20,a/15):a;};
const AIRISH=n=>['air','cave_air','void_air'].includes(n);
export function waterAbove(bot,max=24){
 const p=bot.entity?.position;if(!p||!bot.blockAt)return null;
 const head=new Vec3(Math.floor(p.x),Math.floor(p.y+1.6),Math.floor(p.z));
 for(let dy=0;dy<=max;dy++){
  const b=bot.blockAt(head.offset(0,dy,0));
  if(!b)return null;
  if(AIRISH(b.name))return {open:dy};
  if(/water|seagrass|kelp|bubble_column/.test(b.name)||(waterlogged(b)&&b.boundingBox!=='block'))continue;
  if(b.boundingBox==='block')return {roof:b,dy};
 }
 return null;
}
// Round 64 (round-63 soak, 04:03-04:04Z: drowned twice in a flooded cave at -155,46,98 - each time
// `roof over the water ... digging it`, and a stone roof dug by a bot floating in water takes 25x
// as long (5x under water, 5x off the ground): 14 s the first time, the air ran out at the second):
// the nearest cell of open air reachable through the water, at most POCKET_MAX cells away -
// up and sideways only, with room for the body under each sideways step. {cell, path, steps} or
// null. A pocket beats a roof dig: a few swum cells take a second or two.
export const POCKET_MAX=8;
const WATERY=/^(water|bubble_column|seagrass|tall_seagrass|kelp|kelp_plant)$/;
// Round 74: `stuck` - the head cell's column the bot could not rise in; its way up is not taken.
export function airPocket(bot,max=POCKET_MAX,stuck=null){
 const p=bot.entity?.position;if(!p||!bot.blockAt)return null;
 const start=new Vec3(Math.floor(p.x),Math.floor(p.y+1.6),Math.floor(p.z));
 const key=v=>v.x+','+v.y+','+v.z,seen=new Set([key(start)]);
 let frontier=[[start]];
 for(let d=0;d<max&&frontier.length;d++){
  const next=[];
  for(const path of frontier){
   const c=path[path.length-1];
   // Round 78: a waterlogged slab or stair is swum under sideways, never risen through.
   const cur=bot.blockAt(c),capped=waterlogged(cur)&&cur.boundingBox==='block';
   for(const[dx,dy,dz]of[[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]){
    const n=c.offset(dx,dy,dz),k=key(n);
    if(dy===1&&(capped||(stuck&&n.x===stuck.x&&n.z===stuck.z)))continue;
    if(seen.has(k))continue;seen.add(k);
    const bl=bot.blockAt(n);if(!bl)continue;
    if(dy===0){const body=bot.blockAt(n.offset(0,-1,0));if(!body||body.boundingBox==='block'||/lava/.test(body.name))continue;}
    if(AIRISH(bl.name))return {cell:n,path:path.concat([n]),steps:path.length};
    if(WATERY.test(bl.name)||(dy===0&&waterlogged(bl)))next.push(path.concat([n]));
   }
  }
  frontier=next;
 }
 return null;
}
// Round 74 (round-73 normal1: `open water 2 up (air 6); swimming straight up` at (710, 60, -420),
// then 21 s holding jump at the same y and drowned - a pit beside its crafting table): straight up
// that has not lifted the bot NO_RISE_BLOCKS in NO_RISE_MS is given up for that column; the
// pocket search then swims round it.
export const NO_RISE_MS=3000,NO_RISE_BLOCKS=0.5;
// Round 87 (round-86 hard3 drowned at (789, 61, -610): 23 s holding jump at (788, 60, -610) with no
// rise, then `open water 1 up (air 5); swimming straight up` and 11 s more at the same height, the
// floored position flipping between x 788/789 and z -609/-610 - the body, 0.6 wide, stood on a cell
// corner under the roof of a neighbouring column, and every flip restarted the no-rise clock): when
// the body overlaps a column with a solid block where the head rises next, the centre of an
// overlapped column that is open there (the floored one first). null when nothing overlapped is
// blocked, or when no overlapped column is open (the pocket search swims round that).
export const BODY_HALF=0.3;
export function riseBlockedCentre(bot){
 const p=bot.entity?.position;if(!p||!bot.blockAt)return null;
 const y0=Math.floor(p.y+1.8-0.01),ys=[y0,y0+1];
 const span=v=>[...new Set([Math.floor(v-BODY_HALF),Math.floor(v+BODY_HALF-1e-6)])];
 const own={x:Math.floor(p.x),z:Math.floor(p.z)};
 const cols=[];for(const x of span(p.x))for(const z of span(p.z))cols.push({x,z});
 cols.sort((a,b)=>(b.x===own.x&&b.z===own.z)-(a.x===own.x&&a.z===own.z));
 const blocked=c=>ys.some(y=>{const b=bot.blockAt(new Vec3(c.x,y,c.z));return !!b&&b.boundingBox==='block';});
 const shut=cols.filter(blocked);
 if(!shut.length)return null;
 const open=cols.find(c=>!blocked(c));
 return open?new Vec3(open.x+0.5,p.y,open.z+0.5):null;
}
// Round 79 (round-78 normal3 drowned at (837, 100, -446): `roof over the water at (837, 102, -446)
// (air 8, cherry_slab); digging it`, then 23 s with no dig or fail line - a slab dug by hand while
// floating under water takes 25x as long, and mineflayer's digTime counts the water only when the
// eye block is named water, so under a waterlogged slab it sent the finish 5x early and waited for
// a break the server never made): the dig is timed first, with that factor put back, against the
// air left (AIR_UNIT_MS a unit) plus DIG_AIR_MARGIN_MS. A roof too slow to dig is not dug; the
// air search then reaches POCKET_FAR cells. A dig still going after DIG_WATCH_X its estimate (and
// DIG_WATCH_PAD_MS) is stopped and that roof given up.
export const AIR_UNIT_MS=750,DIG_AIR_MARGIN_MS=4000,POCKET_FAR=16,DIG_WATCH_X=1.5,DIG_WATCH_PAD_MS=1500;
export function roofDigMs(bot,bl){
 if(typeof bot.digTime!=='function')return 0;
 let t;try{t=bot.digTime(bl);}catch{return Infinity;}
 if(!Number.isFinite(t))return Infinity;
 const p=bot.entity?.position,eye=p&&bot.blockAt(new Vec3(Math.floor(p.x),Math.floor(p.y+1.62),Math.floor(p.z)));
 if(eye&&!/water/.test(eye.name)&&waterlogged(eye))t*=5;
 return t;
}
export const airMs=bot=>airOf(bot)*AIR_UNIT_MS;
export const headUnderWater=bot=>{const p=bot.entity?.position;if(!p||!bot.blockAt)return false;const h=bot.blockAt(new Vec3(Math.floor(p.x),Math.floor(p.y+1.6),Math.floor(p.z)));return !!h&&(/water|bubble_column/.test(h.name)||waterlogged(h));};
export class GetOutOfWaterTask extends Task {
 constructor({maxSeconds=30,radius=16,ctx=null}={}){
  super('GetOutOfWaterTask');
  this.ctx=ctx;
  this.maxSeconds=maxSeconds*1000;
  this.radius=radius;
  this.startedAt=null;
  this.navPromise=null;
 }
 onStart(bot,ctx){this.startedAt=Date.now();this.navPromise=null;}
 onTick(bot,ctx){
  ctx=move.pickCtx(this,ctx);
  if(!this.startedAt)this.startedAt=Date.now();
  // Swim up while our air runs low (the ported drowning reflex).
  const air=airOf(bot);
  if(air<20)move.setControls(ctx,{jump:true});
  else move.releaseControls(ctx,['jump']);
  // Round 55: the head under water - straight up when the water above opens to air, no sideways
  // leg; a solid roof right over the head is dug (not lava-capped).
  // Round 56 (round-55 soak: no straight-up line all soak - bot.oxygenLevel is in ticks (0-300) on
  // this server, so 'air 8' read 120 here and the <=12 gate never opened; and normal1 drowned with
  // the reading stale at 17.8): the air no longer gates it, it is only logged.
  if(headUnderWater(bot)){
   if(!this.upAt||Date.now()-this.upAt>=250){this.up=waterAbove(bot,24);this.upAt=Date.now();} // 4 scans a second at most
   const up=this.up,me=bot.entity.position,col={x:Math.floor(me.x),z:Math.floor(me.z)};
   const stuckHere=this.stuck&&this.stuck.x===col.x&&this.stuck.z===col.z;
   if(up&&up.open!=null&&!stuckHere){
    const r=this.rise;
    // Round 87: restarted by a rise or a real move, not by the floored column flipping on a corner.
    if(!r||Math.hypot(me.x-r.px,me.z-r.pz)>=1||me.y>=r.y+NO_RISE_BLOCKS)this.rise={x:col.x,z:col.z,px:me.x,pz:me.z,y:me.y,at:Date.now()};
    else if(Date.now()-r.at>=NO_RISE_MS){
     this.stuck=col;this.pocketAt=0;this.pocketLogged=false;
     const w=ctx?.worker;try{w?.log?.('WorldSurvival: no rise in '+(NO_RISE_MS/1000)+' s swimming up at '+me.floored()+' (air '+air+'); swimming round it');}catch{}
    }
   }
   if(up&&up.open!=null&&!(this.stuck&&this.stuck.x===col.x&&this.stuck.z===col.z)){
    if(this.navPromise){move.cancel(ctx);this.navPromise=null;}
    const ctr=riseBlockedCentre(bot);
    if(ctr){
     try{const r=bot.lookAt?.(new Vec3(ctr.x,me.y+1.62,ctr.z),true);r&&r.catch&&r.catch(()=>{});}catch{}
     if(!this.centreLogged){this.centreLogged=true;const w=ctx?.worker;try{w?.log?.('WorldSurvival: the body at '+me.floored()+' is under a roof beside the column; centring to ('+Math.floor(ctr.x)+', '+Math.floor(ctr.z)+') to swim up');}catch{}}
    }
    move.setControls(ctx,{jump:true,forward:!!ctr,sprint:false});
    if(!this.upLogged){this.upLogged=true;const w=ctx?.worker;try{w?.log?.('WorldSurvival: open water '+up.open+' up (air '+air+'); swimming straight up');}catch{}}
    return null;
   }
   if(!this.pocketAt||Date.now()-this.pocketAt>=250){this.pocket=airPocket(bot,this.slowRoofs?.size?POCKET_FAR:POCKET_MAX,this.stuck);this.pocketAt=Date.now();}
   const pk=this.pocket;
   if(pk&&!this.digging){
    if(this.navPromise){move.cancel(ctx);this.navPromise=null;}
    const to=pk.path[1]||pk.cell;
    try{const r=bot.lookAt?.(new Vec3(to.x+0.5,to.y+0.5,to.z+0.5),true);r&&r.catch&&r.catch(()=>{});}catch{}
    move.setControls(ctx,{forward:true,jump:true,sprint:false});
    if(!this.pocketLogged){this.pocketLogged=true;const w=ctx?.worker;try{w?.log?.('WorldSurvival: air at '+pk.cell+', '+pk.steps+' cell(s) through the water (air '+air+'); swimming to it instead of digging');}catch{}}
    return null;
   }
   const roofKey=up&&up.roof&&String(up.roof.position);
   if(up&&up.roof&&up.dy<=1&&!this.digging&&!this.slowRoofs?.has(roofKey)&&!/bedrock|barrier|obsidian|spawner/.test(up.roof.name)){
    const lavaNear=[[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]].some(([dx,dy,dz])=>/lava/.test(bot.blockAt(up.roof.position.offset(dx,dy,dz))?.name||''));
    if(!lavaNear&&typeof bot.dig==='function'){
     if(this.navPromise){move.cancel(ctx);this.navPromise=null;}
     this.digging=true;const w=ctx?.worker,roof=up.roof,log=m=>{try{w?.log?.(m);}catch{}};
     const giveUp=why=>{(this.slowRoofs||(this.slowRoofs=new Set())).add(roofKey);this.pocketAt=0;this.pocketLogged=false;log(why);};
     // Round 61: the roof is dug with the best tool held, not whatever is in hand.
     // Round 70 (round-69 normal3 drowned under a roof at 837,102,-446 dug four times, in a build at
     // y=100): the block's name above, and a dig that fails says why.
     Promise.resolve(bot.tool?.equipForBlock?.(roof)).catch(()=>{}).then(()=>{
      const est=roofDigMs(bot,roof),left=airMs(bot);
      if(est>left+DIG_AIR_MARGIN_MS){giveUp('WorldSurvival: the roof at '+roof.position+' ('+roof.name+', held '+(bot.heldItem?.name||'hand')+') would take '+(est/1000).toFixed(1)+' s to dig under water (air '+airOf(bot)+'); swimming for air up to '+POCKET_FAR+' cells off');return;}
      log('WorldSurvival: roof over the water at '+roof.position+' (air '+air+', '+roof.name+', '+(est/1000).toFixed(1)+' s); digging it');
      let done=false;
      const watch=setTimeout(()=>{if(done)return;try{bot.stopDigging?.();}catch{}giveUp('WorldSurvival: the roof dig at '+roof.position+' did not finish in '+((est*DIG_WATCH_X+DIG_WATCH_PAD_MS)/1000).toFixed(1)+' s; giving it up');this.digging=false;},est*DIG_WATCH_X+DIG_WATCH_PAD_MS);
      watch.unref?.();
      return Promise.resolve(bot.dig(roof,true)).catch(e=>{log('WorldSurvival: the roof dig at '+roof.position+' failed ('+roof.name+', held '+(bot.heldItem?.name||'hand')+'): '+String(e?.message||e).slice(0,120));}).finally(()=>{done=true;clearTimeout(watch);});
     }).finally(()=>{this.digging=false;});
     return null;
    }
   }
  }
  // One land search a second at most: with no reachable shore the leg resolves at once and
  // the old code rescanned (up to ~17k blockAt calls at radius 24) on every 50 ms tick, in
  // the middle of a drowning (round 5 loop-watch review).
  if(!this.navPromise&&!this.isFinished(bot,ctx)&&Date.now()-(this.searchedAt||0)>=1000){
   this.searchedAt=Date.now();
   const land=findNearestLand(bot,bot.entity.position.floored(),this.radius);
   // Round 82 (round-81 normal3: `would take 14.1 s to dig under water ...; swimming for air up to
   // 16 cells off`, then 20 s with nothing logged and drowned): the far air search coming up empty
   // is said once, with the land leg taken instead.
   if(this.slowRoofs?.size&&!this.pocket&&headUnderWater(bot)&&!this.noAirLogged){
    this.noAirLogged=true;const w=ctx?.worker;
    try{w?.log?.('WorldSurvival: no air within '+POCKET_FAR+' cells through the water (air '+airOf(bot)+'); '+(land?'heading for land at '+land:'no land within '+this.radius+' either'));}catch{}
   }
   if(land){
    const leg=move.goto(ctx,blockGoal(land.x,land.y,land.z),{seconds:8});
    this.navPromise=leg.finally(()=>{this.navPromise=null;});
   }
  }
  return null;
 }
 isFinished(bot,ctx){
  if(!inWater(bot)&&bot.entity.onGround)return true;
  return this.startedAt!=null&&Date.now()-this.startedAt>this.maxSeconds; // give up; the chain re-decides
 }
 onStop(bot,ctx,interrupt){
  move.releaseControls(ctx,['jump']);
  this.navPromise=null;
 }
 isEqual(other){return other instanceof GetOutOfWaterTask;}
}
