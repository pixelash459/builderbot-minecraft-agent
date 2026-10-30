// Port of adris/altoclef chains/FoodChain.java. Eating stays asynchronous to the chain
// system: priority() runs on every chain every tick, so the eat action (equip + consume,
// the mineflayer equivalent of force-equipping and holding right click) fires from here
// even while another chain owns the task tree. Collection (CollectFoodTask) keeps
// AltoClef's priority 55. Config values are FoodChainConfig.java's defaults.
// Original AltoClef (https://github.com/gaucho-matrero/altoclef,
// commit af22e3bc2f03dde45da703f5f7535baae18ea486), MIT License,
// Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
import {SingleTaskChain} from './singleTaskChain.js';
import {chainConfig,inGame,hasEffect} from './settings.js';
import {inventoryItems,armorValue} from './combatPolicy.js';
import {CollectFoodTask} from './fallbackTasks.js';
import {eatMeal} from '../eating.js';
export const EAT_RETRY_MS=5000; // a failed meal waits this long before the next try
// Round 8: a meal still in flight after this is abandoned (counted as failed) so a wedged
// equip can never hold `_eating` for the rest of the session - round 7 read `due 1, failed 0`
// with 8-10 cooked food held: no attempt at all after the meal became due.
export const MEAL_WATCHDOG_MS=12000;
const UNSAFE=new Set(['spider_eye','poisonous_potato','pufferfish']);
export const UNSAFE_FOOD=UNSAFE;
export class FoodChain extends SingleTaskChain{
 constructor({mobDefense=null,mlg=null}={}){
  super('Food');
  this.mobDefense=mobDefense;this.mlg=mlg;
  this._isTryingToEat=false;
  this._needsFood=false;
  this._eating=false;
  this.cachedFoodScore=0;
  this.cachedPerfectFood=null;
  this.watchdogMs=MEAL_WATCHDOG_MS;this.mealOpts={}; // tests shrink these
 }
 priority(bot,ctx){
  const cfg=chainConfig(ctx);
  if(!inGame(bot)||cfg.autoEat===false){this.stopEat();return -1;}
  // do NOT eat while escaping lava (FoodChain.java's lava guard)
  if(bot.entity.isInLava){this.stopEat();return -1;}
  if(bot.isSleeping){this.stopEat();return -1;}
  // in danger or falling: don't eat now
  if((this.mobDefense&&this.mobDefense.isDoingAcrobatics&&this.mobDefense.isDoingAcrobatics())
   ||(this.mlg&&this.mlg.isFallingOhNo&&this.mlg.isFallingOhNo(bot))){this.stopEat();return -1;}
  const {total,best,items}=this.calculateFood(bot,cfg.food);
  this.cachedFoodScore=total;this.cachedPerfectFood=best;this.cachedFoodItems=items;
  const hasFood=total>0;
  // Round 9: no fill-up after a meal. AltoClef keeps eating to 20 once a meal started
  // (_requestFillup); with the 14 threshold that ate a second porkchop at 15-19 and took the
  // food step's last cooked items (round-8 normal1 looped on [food] for the rest of the run).
  // Below 14 health needsToEat still says yes at every bar < 20: that is the eat-to-full.
  const want=hasFood&&this.needsToEat(bot,cfg.food)&&!!best;
  // Soak accounting (round 6): 'due' counts each episode a meal was wanted with food held,
  // so 'eaten 0' reads as never hungry (due 0) or a broken eat path (due > 0, failed > 0).
  const meals=ctx&&ctx.worker&&ctx.worker.meals;
  if(want&&!this._wanted&&meals)meals.due=(meals.due||0)+1;
  this._wanted=want;this._meals=meals||null;this._worker=ctx&&ctx.worker||null;
  // Round 7: normal2's bar fell to 5 with `due 1, failed 0` and nothing to eat. A hungry
  // episode with no food held is counted apart, so the verdict reads "no food held".
  const starving=!hasFood&&(bot.food|0)<=cfg.food.alwaysEatWhenBelowHunger;
  if(starving&&!this._starving&&meals)meals.noFood=(meals.noFood||0)+1;
  this._starving=starving;
  if(want){
   // Round 8: eat between job steps, never mid-fight or with a window open (a crafting
   // table's click waits for the result slot with no timeout in mineflayer, so an equip
   // there can hang the meal). A deferred meal is recorded with its reason.
   const why=this.deferReason(bot,ctx);
   if(why){this._isTryingToEat=false;this.noteDefer(why);}
   else{this._deferred=null;this.startEat(bot,best);}
  }else{this._deferred=null;this.stopEat();}
  if(this._needsFood||total<cfg.minimumFoodAllowed){
   this._needsFood=total<cfg.foodUnitsToCollect;
   if(total<cfg.foodUnitsToCollect){
    this.root=new CollectFoodTask(cfg.foodUnitsToCollect);
    return 55;
   }
  }
  // eating is handled asynchronously (FoodChain.java returns NEGATIVE_INFINITY here)
  return -1;
 }
 // Why a wanted meal waits: null when it can start now. A critical meal (needsToEatCritical)
 // goes ahead through a fight, exactly like MobDefense yields to it.
 deferReason(bot,ctx){
  if(bot.currentWindow)return 'a window is open';
  const w=ctx&&ctx.worker;
  const running=w&&Array.isArray(w.jobs)&&w.jobs.find(j=>j.status==='running');
  if(running&&running.spec&&running.spec.type==='eat')return 'the eat job is eating';
  if(this.needsToEatCritical(bot))return null;
  const md=this.mobDefense;
  if(md&&md.isActive&&md.isActive())return 'mid-fight (Mob Defense active)';
  if(running&&running.spec&&running.spec.type==='fight')return 'mid-fight (fight job)';
  return null;
 }
 // One count per deferral episode and reason, not one per 50 ms tick.
 noteDefer(why){
  if(this._deferred===why)return;
  this._deferred=why;
  const m=this._meals;
  if(m){m.deferred=(m.deferred||0)+1;m.lastDeferred=why;}
 }
 // FoodChain.needsToEat: ported with FoodChainConfig defaults (14-health/10-hunger rules).
 // Round 8: plus `eatAtHunger` (14) - with food held the bot eats at a bar of 14 or less,
 // the threshold AGENTS.md documents; AltoClef's 10 let the bar sit at 11-14 all run.
 needsToEat(bot,f){
  f=f||chainConfig(null).food;
  const foodLevel=bot.food|0,health=bot.health;
  if(foodLevel>=20)return false;
  if(foodLevel<=(f.eatAtHunger??0))return true;
  // Round 10 (bug C: 3 of 7 round-9 meals started above 14 - a 19 -> 20 fill-up, 16 -> 20 at
  // 12 hp): above the 14 threshold only the critical-health path eats. That is health under
  // the low-health stop (criticalHealth, 10) with the bar under regenHunger (18: natural
  // regeneration needs 18+, so a bar of 18 or 19 heals on its own and a meal there is a
  // fill-up), or health under 6 at any bar. Never the last edible item unless under 6.
  if(f.eatAtHunger!=null&&foodLevel>f.eatAtHunger){
   if(health<f.alwaysEatWhenWitherOrFireAndHealthBelow)return true;
   if(this.cachedFoodItems!=null&&this.cachedFoodItems<=1)return false;
   if(health<(f.criticalHealth??10)&&foodLevel<(f.regenHunger??18))return true;
   // Habit 10: hurt (under 14) with the bar under 18, regeneration has stopped - top it up,
   // but only with food that fits (no points wasted over 20): small food, never a fill-up.
   const fit=this.cachedPerfectFood&&foodLevel+(this.cachedPerfectFood.fills||99)<=20;
   return health<f.alwaysEatWhenBelowHealth&&foodLevel<(f.regenHunger??18)&&!!fit;
  }
  if(onFireOrWither(bot)||health<f.alwaysEatWhenWitherOrFireAndHealthBelow)return true;
  if(foodLevel>f.alwaysEatWhenBelowHunger){
   if(health<f.alwaysEatWhenBelowHealth)return true; // 7f: eat to full, return at health >= 14
  }else return true; // half hunger or worse
  if(foodLevel<f.alwaysEatWhenBelowHungerAndPerfectFit&&this.cachedPerfectFood){
   const need=20-foodLevel;
   const fills=this.cachedPerfectFood.fills;
   return fills===need;
  }
  return false;
 }
 // FoodChain.needsToEatCritical: RUN NOT EAT vs tank-hits-and-eat.
 needsToEatCritical(bot){
  const f=chainConfig(null).food;
  const foodLevel=bot.food|0,health=bot.health;
  const armor=armorValue(bot);
  if(health<f.runDontEatMaxHealth&&foodLevel<f.runDontEatMaxHunger)return false;
  return armor>=f.canTankHitsAndEatArmor&&foodLevel<f.canTankHitsAndEatMaxHunger;
 }
 isTryingToEat(){return this._isTryingToEat;}
 startEat(bot,food){
  this._isTryingToEat=true;
  if(this._eating||Date.now()<(this._retryAt||0))return;
  this._eating=true;
  const m=this._meals,w=this._worker;
  if(m)m.attempts=(m.attempts||0)+1;
  let watchdog;
  (async()=>{
   // Round 4: equip the real stack (the picked {name,fills} has no slot). Round 7: the meal
   // is judged by the bar/stack, not by consume's promise (src/eating.js). Round 8: the
   // whole meal is bounded by the watchdog.
   try{
    const stuck=new Promise((_,rej)=>{watchdog=setTimeout(()=>rej(Error('meal stuck '+this.watchdogMs/1000+' s (equip or consume never settled)')),this.watchdogMs);if(watchdog.unref)watchdog.unref();});
    const bar0=bot.food|0;
    const r=await Promise.race([eatMeal(bot,food.name,{worker:w,...this.mealOpts}),stuck]);
    if(!r.ok&&r.reason!=='Food is already full')throw Error(r.reason);
    // Round 9: the bar before and after - round 8's `ate cooked_porkchop (bar 20)` printed
    // only the bar after the meal and read as a meal eaten at a full bar.
    if(r.ok&&m)m.ok=(m.ok||0)+1;
    if(r.ok&&w&&w.log)try{w.log('Food: ate '+food.name+' (bar '+bar0+' -> '+(bot.food|0)+')');}catch{}
   }
   catch(e){
    this._retryAt=Date.now()+EAT_RETRY_MS;
    const msg=String(e&&e.message||e).slice(0,120);
    if(m){m.failed=(m.failed||0)+1;m.lastError=msg;}
    if(w&&w.log)try{w.log('Food: meal failed - '+msg);}catch{}
    if(/^meal stuck/.test(msg)){if(w)w.eating=false;bot.__meal=null;}
   }
   finally{clearTimeout(watchdog);this._eating=false;}
  })();
 }
 stopEat(){
  // mineflayer's consume is one-shot, so there is no input hold to release (Java releases
  // right click and unpauses interaction here).
  this._isTryingToEat=false;
 }
 // FoodChain.calculateFood: pick the best-fitting food and total the food units available.
 calculateFood(bot,f){
  f=f||chainConfig(null).food;
  const foods=bot.registry&&bot.registry.foodsByName;
  let bestFood=null,bestScore=-Infinity,total=0,items=0;
  const health=bot.health??20,hunger=bot.food|0,saturation=bot.saturation??20;
  for(const stack of inventoryItems(bot)){
   const meta=foods&&foods[stack.name];
   if(!meta||!meta.foodPoints)continue;
   if(UNSAFE.has(stack.name))continue;
   const count=stack.count||1;
   const hungerVal=meta.foodPoints;
   const saturationModifier=meta.saturation??0;
   const hungerIfEaten=Math.min(hunger+hungerVal,20);
   const saturationIfEaten=Math.min(hungerIfEaten,saturation+saturationModifier);
   const gainedSaturation=saturationIfEaten-saturation;
   const gainedHunger=hungerIfEaten-hunger;
   const hungerNotFilled=20-hungerIfEaten;
   const saturationWasted=saturationModifier-gainedSaturation;
   const hungerWasted=hungerVal-gainedHunger;
   const prioritizeSaturation=health<f.prioritizeSaturationWhenBelowHealth;
   const saturationGoodScore=prioritizeSaturation?gainedSaturation*f.foodPickPrioritizeSaturationSaturationMultiplier:gainedSaturation;
   const saturationLossPenalty=prioritizeSaturation?0:saturationWasted*f.foodPickSaturationWastePenaltyMultiplier;
   const hungerLossPenalty=hungerWasted*f.foodPickHungerWastePenaltyMultiplier;
   const hungerNotFilledPenalty=hungerNotFilled*f.foodPickHungerNotFilledPenaltyMultiplier;
   let score=saturationGoodScore-saturationLossPenalty-hungerLossPenalty-hungerNotFilledPenalty;
   if(stack.name==='rotten_flesh')score-=f.foodPickRottenFleshPenalty;
   if(score>bestScore){bestScore=score;bestFood={name:stack.name,fills:hungerVal};}
   total+=hungerVal*count;items+=count;
  }
  return {total,best:bestFood,items};
 }
}
const onFireOrWither=bot=>{
 if(bot.entity&&typeof bot.entity.isOnFire==='boolean')return bot.entity.isOnFire;
 if(bot.entity&&bot.entity.metadata&&bot.entity.metadata[0]&&(bot.entity.metadata[0]&1))return true;
 return hasEffect(bot,'wither');
};
