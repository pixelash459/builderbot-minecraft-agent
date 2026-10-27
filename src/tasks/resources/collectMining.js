// Ported from AltoClef tasks/resources/CollectCobblestoneTask.java,
// CollectCobbledDeepslateTask.java, CollectFlintTask.java, CollectSandstoneTask.java,
// CollectRedSandstoneTask.java and CollectCoarseDirtTask.java.
// MIT License, Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
import {countOf,workerOf,runStep,stepPending,tokenOf,nearestBlock,nearestBlocks,taskCtx,adopt} from './util.js';
import {ResourceTask} from './ResourceTask.js';
import {MineAndCollectTask} from './MineAndCollectTask.js';
import {getItemTask} from '../catalogue.js';

export class CollectCobblestoneTask extends ResourceTask {
 constructor(count=1){super({matches:['cobblestone'],count});}
 onResourceTick(bot,ctx){return adopt(this,new MineAndCollectTask(this.targets,['stone','cobblestone'],'wood'));}
 isEqualResource(other){return other instanceof CollectCobblestoneTask&&other.targets[0].count===this.targets[0].count;}
 toString(){return 'Collect Cobblestone';}
}

export class CollectCobbledDeepslateTask extends ResourceTask {
 constructor(count=1){super({matches:['cobbled_deepslate'],count});}
 onResourceTick(bot,ctx){return adopt(this,new MineAndCollectTask(this.targets,['deepslate','cobbled_deepslate'],'wood'));}
 toString(){return 'Collect Cobbled Deepslate';}
}

export class CollectFlintTask extends ResourceTask {
 static CLOSE_ENOUGH_FLINT=10;
 constructor(count=1){super({matches:['flint'],count});}
 onResourceTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(stepPending(this))return null;
  const gravel=nearestBlock(bot,['gravel'],CollectFlintTask.CLOSE_ENOUGH_FLINT);
  if(gravel)return new MineAndCollectTask({matches:['flint'],count:999999},['gravel'],'hand');
  if(countOf(bot,'gravel')>0){
   // Place the gravel and break it again: flint only drops from dug gravel.
   const worker=workerOf(ctx);
   return runStep(this,bot,ctx,async(b,c)=>{
    const at=await worker.placeBlockNear(tokenOf(c),'gravel');
    const block=b.blockAt(at);
    if(!block||block.name!=='gravel')throw Error('Placed gravel was not verified');
    const before=countOf(b,'flint'),gravelBefore=countOf(b,'gravel');
    await worker.digWith(block,tokenOf(c));
    await worker.sweepDrops(tokenOf(c));
    if(countOf(b,'flint')<=before&&countOf(b,'gravel')<=gravelBefore)throw Error('Breaking placed gravel produced no flint or gravel');
   });
  }
  return getItemTask(bot,'gravel',1,ctx);
 }
 isEqualResource(other){return other instanceof CollectFlintTask&&other.targets[0].count===this.targets[0].count;}
 toString(){return `Collect ${this.targets[0].count} flint`;}
}

export class CollectSandstoneTask extends ResourceTask {
 constructor(count=1,red=false){
  super({matches:[red?'red_sandstone':'sandstone'],count});
  this.red=red;
 }
 onResourceTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(stepPending(this))return null;
  const sand=this.red?'red_sand':'sand',sandstone=this.red?'red_sandstone':'sandstone';
  if(countOf(bot,sand)>=4){
   const needed=Math.max(1,this.targets[0].count-countOf(bot,sandstone));
   const worker=workerOf(ctx);
   return runStep(this,bot,ctx,(b,c)=>c.worker.craft({spec:{type:'craft',item:sandstone,count:needed}},tokenOf(c)));
  }
  return adopt(this,new MineAndCollectTask({matches:[sandstone,sand],count:this.targets[0].count},[sandstone,sand],'wood'));
 }
 toString(){return `Collecting ${this.targets[0].count} ${this.targets[0].matches[0]}.`;}
}
export class CollectRedSandstoneTask extends CollectSandstoneTask {
 constructor(count=1){super(count,true);}
}

export class CollectCoarseDirtTask extends ResourceTask {
 constructor(count=1){super({matches:['coarse_dirt'],count});}
 onResourceTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  if(stepPending(this))return null;
  const have=countOf(bot,'coarse_dirt');
  const c=Math.ceil((this.targets[0].count-have)/4)*2; // dirt+gravel per craft batch, like Java
  if(countOf(bot,'dirt')>=c&&countOf(bot,'gravel')>=c){
   const worker=workerOf(ctx);
   return runStep(this,bot,ctx,cx=>cx.worker.craft({spec:{type:'craft',item:'coarse_dirt',count:Math.max(1,this.targets[0].count-have)}},tokenOf(cx)));
  }
  if(nearestBlocks(bot,['coarse_dirt'],32).length)return adopt(this,new MineAndCollectTask(this.targets,['coarse_dirt'],'hand'));
  // Java lets the recipe collector fetch dirt+gravel; our howto-driven obtain plans the same.
  return getItemTask(bot,'coarse_dirt',this.targets[0].count,ctx);
 }
 toString(){return `Collecting ${this.targets[0].count} coarse dirt.`;}
}
