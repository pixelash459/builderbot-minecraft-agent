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
export const airOf=bot=>{const a=typeof bot.oxygenLevel==='number'?bot.oxygenLevel:(typeof bot.oxygen==='number'?bot.oxygen:20);return a>20?Math.min(20,a/15):a;};
const AIRISH=n=>['air','cave_air','void_air'].includes(n);
export function waterAbove(bot,max=24){
 const p=bot.entity?.position;if(!p||!bot.blockAt)return null;
 const head=new Vec3(Math.floor(p.x),Math.floor(p.y+1.6),Math.floor(p.z));
 for(let dy=0;dy<=max;dy++){
  const b=bot.blockAt(head.offset(0,dy,0));
  if(!b)return null;
  if(AIRISH(b.name))return {open:dy};
  if(/water|seagrass|kelp|bubble_column/.test(b.name))continue;
  if(b.boundingBox==='block')return {roof:b,dy};
 }
 return null;
}
export const headUnderWater=bot=>{const p=bot.entity?.position;if(!p||!bot.blockAt)return false;const h=bot.blockAt(new Vec3(Math.floor(p.x),Math.floor(p.y+1.6),Math.floor(p.z)));return !!h&&/water|bubble_column/.test(h.name);};
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
   const up=this.up;
   if(up&&up.open!=null){
    if(this.navPromise){move.cancel(ctx);this.navPromise=null;}
    move.setControls(ctx,{jump:true,forward:false,sprint:false});
    if(!this.upLogged){this.upLogged=true;const w=ctx?.worker;try{w?.log?.('WorldSurvival: open water '+up.open+' up (air '+air+'); swimming straight up');}catch{}}
    return null;
   }
   if(up&&up.roof&&up.dy<=1&&!this.digging&&!/bedrock|barrier|obsidian|spawner/.test(up.roof.name)){
    const lavaNear=[[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]].some(([dx,dy,dz])=>/lava/.test(bot.blockAt(up.roof.position.offset(dx,dy,dz))?.name||''));
    if(!lavaNear&&typeof bot.dig==='function'){
     if(this.navPromise){move.cancel(ctx);this.navPromise=null;}
     this.digging=true;const w=ctx?.worker;try{w?.log?.('WorldSurvival: roof over the water at '+up.roof.position+' (air '+air+'); digging it');}catch{}
     Promise.resolve(bot.dig(up.roof,true)).catch(()=>{}).finally(()=>{this.digging=false;});
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
