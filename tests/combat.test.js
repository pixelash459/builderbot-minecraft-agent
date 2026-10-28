// Unit tests for src/combat.js (docs/COMBAT_SPEC.md 7b/7c, 7e unit layer): cooldown
// timing, crit/sweep windows, projectile threat with velocity lead, ballistic bow aim
// maths, target priority, per-mob tactic selection, and the CombatController state
// machine with a fake bot and an injected clock. No live server, no services.
// Ballistics use the declared ASSUMPTION constants (gravity 0.05, drag 0.99, speed 3.0)
// - the tests check the maths is self-consistent; live values are a 7e integration job.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {
 cooldownSeconds,attackSpeedOf,VANILLA_ATTACK_SPEED,
 isCritOpportunity,shouldJumpForCrit,hasHeadroom,isSprinting,shouldSweep,
 projectileThreat,bowAimSolution,arrowTrajectory,ARROW_GRAVITY,ARROW_DRAG,ARROW_SPEED,ARROW_LAUNCH_HEIGHT,dragSum,
 hasLineOfSight,pickTarget,pickTactic,readGear,shouldDisengage,shouldRetreat,
 holdsBlockOrFood,CombatController
} from '../src/combat.js';
import {yawToward,pitchToward,headingOf} from '../src/heading.js';
import fs from 'node:fs';

const flush=async n=>{for(let i=0;i<(n||3);i++)await new Promise(r=>setImmediate(r));};
const at=(x,y,z)=>new Vec3(x,y,z);


// The ownership-guarded move adapter the controller receives (the production guard from
// src/tasks/movement/move.js: only the current owner token touches the bot).
function makeMove(bot,worker){
 return {
  setControls:states=>{if(worker&&worker.controlToken!==worker.epoch)return;
   for(const[k,v]of Object.entries(states))bot.setControlState(k,v);},
  releaseControls:names=>{if(worker&&worker.controlToken!==worker.epoch)return;
   for(const n of names)bot.setControlState(n,false);},
  look:(yaw,pitch,force)=>{if(worker&&worker.controlToken!==worker.epoch)return;
   bot.look(yaw,pitch,!!force).catch(()=>{});}
 };
}
function makeBot(opts={}){
 const calls=[];
 const inv=(opts.inventory||[]).map(n=>({name:n,count:(opts.counts&&opts.counts[n])||1}));
 const blocks=opts.blocks||{};
 const entity={
  id:1,position:opts.position?at(...opts.position):at(0,-60,0),
  velocity:opts.velocity?at(...opts.velocity):at(0,0,0),
  onGround:opts.onGround??true,isInWater:!!opts.isInWater,height:1.8,isValid:true};
 const bot={
  version:'1.21.4',health:opts.health??20,food:opts.food??20,
  entity,entities:{},controlState:{},
  registry:{itemsByName:{},blocksByName:{dirt:{id:1},stone:{id:2}},foodsByName:opts.foods||null},
  inventory:{items:()=>inv,slots:(()=>{const s=[];if(opts.offhand)s[45]={name:opts.offhand};return s;})()},
  heldItem:opts.heldItem?{name:opts.heldItem}:null,
  blockAt:p=>{const k=`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;return blocks[k]||null;},
  setControlState:(n,v)=>{bot.controlState[n]=v;calls.push(['control',n,v]);},
  look:async(yaw,pitch,force)=>{bot.entity.yaw=yaw;bot.entity.pitch=pitch;calls.push(['look',+yaw.toFixed(3),+pitch.toFixed(3),!!force]);},
  activateItem:off=>calls.push(['activate',!!off]),
  deactivateItem:()=>calls.push(['deactivate']),
  placeBlock:(s,f)=>{calls.push(['place',s&&s.position,f]);return Promise.resolve();},
  attack:e=>{calls.push(['attack',e.id]);},
  equip:async(item)=>{calls.push(['equip',item&&item.name]);bot.heldItem={name:item.name};}
 };
 (opts.entities||[]).forEach(e=>{bot.entities[e.id]=e;});
 return {bot,calls,inv};
}
const mob=(id,name,position,extra={})=>({
 id,name,type:extra.type||'hostile',position,
 velocity:extra.velocity?at(...extra.velocity):at(0,0,0),
 height:extra.height??1.9,isValid:true,onGround:extra.onGround});
const proj=(id,name,position,velocity,extra={})=>{
 const m=mob(id,name,position,{type:'projectile',...extra});
 m.velocity=velocity;
 return m;
};

// ---- 7b.1 cooldown timing ---------------------------------------------------------------
test('cooldownSeconds: sword 1.0 s (server-measured on 26.3), axe per tier, pickaxe and hand',()=>{
 for(const s of['wooden_sword','stone_sword','iron_sword','diamond_sword','netherite_sword','golden_sword'])
  assert.equal(cooldownSeconds(s),1.0,s);
 assert.equal(cooldownSeconds('wooden_axe'),1.25);
 assert.equal(cooldownSeconds('stone_axe'),1.25);
 assert.ok(Math.abs(cooldownSeconds('iron_axe')-1/0.9)<1e-9);
 assert.equal(cooldownSeconds('diamond_axe'),1.0);
 assert.equal(cooldownSeconds('netherite_axe'),1.0);
 assert.ok(Math.abs(cooldownSeconds('stone_pickaxe')-1/1.2)<1e-9,'pickaxe 1.2 attacks/s');
 assert.equal(cooldownSeconds('trident'),1/VANILLA_ATTACK_SPEED.trident);
 assert.equal(cooldownSeconds('rotten_flesh'),0.25,'unknown item: bare-hand 4.0');
 assert.equal(cooldownSeconds(null),0.25);
});
test('attackSpeedOf prefers a registry attackSpeed when mc-data ever ships it',()=>{
 assert.equal(attackSpeedOf('iron_sword',{itemsByName:{iron_sword:{attackSpeed:2.0}}}),2.0);
 assert.equal(cooldownSeconds('iron_sword',{itemsByName:{iron_sword:{attackSpeed:2.0}}}),0.5);
 assert.equal(attackSpeedOf('iron_sword',{itemsByName:{}}),1.0,'falls back to the server-measured table');
});

// ---- 7b.2 critical hits -------------------------------------------------------------------
test('isCritOpportunity: only while descending, not sprinting, dry, off ladders',()=>{
 const dry={bot:makeBot({velocity:[0,-0.4,0]}).bot};
 dry.bot.entity.onGround=false;
 assert.equal(isCritOpportunity(dry.bot),true,'falling in the open: crit window');
 assert.equal(isCritOpportunity(makeBot({velocity:[0,-0.4,0]}).bot),false,'on the ground');
 assert.equal(isCritOpportunity(makeBot({velocity:[0,0.5,0],onGround:false}).bot),false,'still rising');
 assert.equal(isCritOpportunity(makeBot({velocity:[0,0,0],onGround:false}).bot),false,'apex: no fall yet');
 const sp=makeBot({velocity:[0,-0.4,0],onGround:false}).bot;sp.controlState.sprint=true;
 assert.equal(isCritOpportunity(sp),false,'sprinting');
 const wet=makeBot({velocity:[0,-0.4,0],onGround:false,isInWater:true}).bot;
 assert.equal(isCritOpportunity(wet),false,'in water');
 const ladder=makeBot({velocity:[0,-0.4,0],onGround:false}).bot;
 ladder.entities[1]=ladder.entity;
 ladder.blockAt=()=>({name:'ladder',boundingBox:'block'});
 assert.equal(isCritOpportunity(ladder),false,'on a ladder');
});
test('hasHeadroom: 2 free blocks above the head; a ceiling kills the crit plan',()=>{
 const clear=makeBot({}).bot;
 assert.equal(hasHeadroom(clear,2),true);
 const low=makeBot({blocks:{'0,-58,0':{name:'stone',boundingBox:'block'}}}).bot;
 assert.equal(hasHeadroom(low,2),false,'block at feet+2');
 const low2=makeBot({blocks:{'0,-57,0':{name:'stone',boundingBox:'block'}}}).bot;
 assert.equal(hasHeadroom(low2,2),false,'block at feet+3 still clips a jump');
 assert.equal(shouldJumpForCrit(clear),true,'room to jump');
 assert.equal(shouldJumpForCrit(low),false,'no room: never plan a crit');
});

// ---- 7b.4 sweep ---------------------------------------------------------------------------
test('shouldSweep: sword only, grounded, not sprinting, full charge, no crit',()=>{
 const bot=makeBot({}).bot;
 assert.equal(shouldSweep(bot,'iron_sword'),true);
 assert.equal(shouldSweep(bot,'diamond_axe'),false,'axes do not sweep');
 assert.equal(shouldSweep(bot,'iron_sword',{charge:0.9}),false,'not full charge');
 assert.equal(shouldSweep(bot,'iron_sword',{crit:true}),false,'a crit hit never sweeps');
 const sp=makeBot({}).bot;sp.controlState.sprint=true;
 assert.equal(shouldSweep(sp,'iron_sword'),false,'sprinting');
 const air=makeBot({onGround:false}).bot;
 assert.equal(shouldSweep(air,'iron_sword'),false,'airborne');
 assert.equal(shouldSweep(bot,'iron_sword',{targetOnGround:false}),false,'target airborne');
});

// ---- 7b.5 projectile threat -----------------------------------------------------------------
test('projectileThreat: head-on arrow with eta and miss, strafing lead filters false alarms',()=>{
 const bot=makeBot({}).bot; // stationary at (0,-60,0)
 const headOn=[proj(20,'arrow',at(10,-59.5,0),at(-2,0,0))];
 const t1=projectileThreat(bot,headOn,{horizon:6});
 assert.equal(t1.length,1,'head-on arrow is a threat');
 assert.ok(Math.abs(t1[0].eta-5)<1e-9,'eta = distance/speed');
 assert.ok(Math.abs(t1[0].miss-0.5)<1e-9,'passes 0.5 above the feet');
 const past=[proj(21,'arrow',at(10,-59.5,20),at(-2,0,0))];
 assert.equal(projectileThreat(bot,past,{horizon:6}).length,0,'flies 20 blocks wide');
 // Bot strafing +z at 1 b/t: the arrow is aimed at the OLD position, the lead widens the miss.
 const strafe=makeBot({velocity:[0,0,1]}).bot;
 const stale=[proj(22,'arrow',at(10,-59.5,-1),at(-2,0,0))];
 assert.equal(projectileThreat(strafe,stale,{miss:1.6,horizon:6}).length,0,
  'aimed at the old spot: lead says it misses');
 const noLeadBot=makeBot({}).bot; // same arrow at a stationary bot IS a threat
 assert.equal(projectileThreat(noLeadBot,stale,{miss:1.6,horizon:6}).length,1);
 assert.equal(projectileThreat(bot,[mob(23,'zombie',at(3,-60,0),{velocity:[-2,0,0]})],{horizon:6}).length,0,
  'hostile mobs are not projectiles');
 assert.equal(projectileThreat(bot,[proj(24,'fireball',at(5,-59,0),at(-1,0,0))],{horizon:6}).length,0,
  'ghast fireballs ignored (AltoClef)');
 assert.equal(projectileThreat(bot,[proj(25,'arrow',at(2,-59.5,0),at(-0.1,0,0))],{horizon:6}).length,0,
  'speed floor: near-stationary arrows are not threats');
 const trident=projectileThreat(bot,[proj(26,'thrown_trident',at(8,-59.5,0),at(-2,0,0))],{horizon:6});
 assert.equal(trident.length,1,'tridents count (7b.5)');
});

// ---- 7b.6 ballistic aim -----------------------------------------------------------------
// Min distance from the aim point to the trajectory INCLUDING segment interpolation
// (path samples are ~3 blocks apart at full draw).
const minDistTo=(path,point)=>{
 let best=Infinity;
 const seg=(a,b,t)=>Math.hypot(a.x+(b.x-a.x)*t-point.x,a.y+(b.y-a.y)*t-point.y,a.z+(b.z-a.z)*t-point.z);
 for(const p of path)best=Math.min(best,Math.hypot(p.x-point.x,p.y-point.y,p.z-point.z));
 for(let i=1;i<path.length;i++)for(let s=1;s<8;s++)best=Math.min(best,seg(path[i-1],path[i],s/8));
 return best;
};
test('bowAimSolution: flat 10-block shot lands on the target with the declared constants',()=>{
 const {bot}=makeBot({});
 const target=mob(10,'zombie',at(10,-60,0));
 const sol=bowAimSolution(bot,target);
 assert.ok(sol,'solution exists in range');
 assert.ok(Math.abs(sol.yaw-Math.atan2(-10,0))<1e-9,'yaw faces +x');
 assert.ok(Math.abs(sol.pitch)<0.2,'near-flat shot');
 const path=arrowTrajectory({x:0,y:-60+ARROW_LAUNCH_HEIGHT,z:0},sol.yaw,sol.pitch);
 assert.ok(minDistTo(path,{x:10,y:-59.1,z:0})<0.5,'simulated shot passes through the mob');
 assert.ok(sol.ticks>=3&&sol.ticks<=10,'flight is a few ticks at 3 b/t');
});
test('bowAimSolution: elevated target needs an upward pitch; yaw convention holds',()=>{
 const {bot}=makeBot({});
 const up=bowAimSolution(bot,mob(11,'zombie',at(6,-54,0)));
 assert.ok(up,'elevated target reachable');
 assert.ok(up.pitch>0,'positive pitch aims up (mineflayer convention, src/heading.js)');
 const path=arrowTrajectory({x:0,y:-60+ARROW_LAUNCH_HEIGHT,z:0},up.yaw,up.pitch);
 assert.ok(minDistTo(path,{x:6,y:-53.1,z:0})<0.5);
 const east=bowAimSolution(bot,mob(12,'zombie',at(8,-60,0)));
 assert.ok(Math.abs(east.yaw-(-Math.PI/2))<1e-6,'+x is yaw -PI/2');
 const south=bowAimSolution(bot,mob(13,'zombie',at(0,-60,8)));
 assert.ok(Math.abs(Math.abs(south.yaw)-Math.PI)<1e-6,'+z is yaw +-PI (mineflayer: yaw 0 faces -z)');
 const north=bowAimSolution(bot,mob(17,'zombie',at(0,-60,-8)));
 assert.ok(Math.abs(north.yaw)<1e-6,'-z is yaw 0');
});
test('bowAimSolution: leads a moving target and nulls out of range',()=>{
 const {bot}=makeBot({});
 const runner=mob(14,'zombie',at(12,-60,0),{velocity:[0.3,0,0.2]});
 const sol=bowAimSolution(bot,runner);
 assert.ok(sol,'moving target still solvable');
 const path=arrowTrajectory({x:0,y:-60+ARROW_LAUNCH_HEIGHT,z:0},sol.yaw,sol.pitch);
 const lead={x:12+0.3*sol.ticks,y:-59.05,z:0+0.2*sol.ticks};
 assert.ok(minDistTo(path,lead)<0.7,'shot intercepts the led position, not the current one');
 assert.equal(bowAimSolution(bot,mob(15,'zombie',at(400,-60,0))),null,'out of range');
 const low=bowAimSolution(bot,mob(16,'zombie',at(3,-64,0)));
 assert.ok(low&&low.pitch<0,'dropping shots aim downward (negative pitch)');
});

// ---- 7b.9 target priority -----------------------------------------------------------------
test('pickTarget: creeper close > ranged with LOS > nearest melee',()=>{
 const bot=makeBot({}).bot;
 const z=mob(30,'zombie',at(2,-60,0)),sk=mob(31,'skeleton',at(10,-60,0)),cr=mob(32,'creeper',at(5,-60,0));
 assert.equal(pickTarget([z,sk,cr],bot),cr,'creeper within 6 wins outright');
 const cr2=mob(33,'creeper',at(8,-60,0));
 assert.equal(pickTarget([z,sk,cr2],bot),sk,'far creeper drops: skeleton with LOS next');
 const walled=makeBot({blocks:{'5,-59,0':{name:'stone',boundingBox:'block'}}}).bot;
 assert.equal(pickTarget([z,sk],walled),z,'skeleton without line of sight is ignored');
 assert.equal(pickTarget([z],bot),z,'nearest melee is the floor');
 assert.equal(pickTarget([],bot),null);
 assert.equal(pickTarget([mob(34,'zombie',at(20,-60,0))],bot),null,'outside the 16-block fight range');
 const walledCreeper=makeBot({blocks:{'2,-59,0':{name:'stone',boundingBox:'block'},'3,-59,0':{name:'stone',boundingBox:'block'}}}).bot;
 const creepWalled=mob(35,'creeper',at(4,-60,0));
 assert.equal(pickTarget([z,creepWalled],walledCreeper),z,'creeper behind a wall is not the target');
});
test('hasLineOfSight defaults to visible with no block data (fake bots, unloaded chunks)',()=>{
 const {bot}=makeBot({});
 assert.equal(hasLineOfSight(bot,mob(36,'skeleton',at(12,-60,0))),true);
});

// ---- 7c per-mob tactics -------------------------------------------------------------------
const SWORD={weapon:'sword',weaponName:'iron_sword',shield:true,bow:false,arrows:0};
test('creeper: bow from 8 when arrows exist; melee hit-and-run only without them',()=>{
 // Roofed 12x12: melee detonated 4/4 (LOS never breaks). Wiki cancel is 7 or LOS.
 assert.equal(pickTactic('creeper',{...SWORD,bow:true,arrows:32}).style,'bow');
 const bowT=pickTactic('creeper',{weapon:null,bow:true,arrows:32});
 assert.equal(bowT.style,'bow');
 assert.ok(bowT.minRange>=6,'bow kite range 6+ (73184: min 8 never redrew)');
 const melee=pickTactic('creeper',SWORD);
 assert.equal(melee.style,'melee');
 assert.equal(melee.knockback,true,'sprint-hit for knockback');
 assert.equal(melee.backpedal,true,'immediately back off');
 assert.ok(melee.minRange>=4,'retreat 4+ blocks (review directive: never inside 4 on cooldown)');
 assert.equal(melee.hitRun,true,'strike once, then reopen the gap');
 assert.equal(melee.crit,false,'no standing crit jumps next to a creeper');
 assert.equal(pickTactic('creeper',{weapon:null}).style,'avoid');
});
test('creeper hit-and-run closes into strike range, then reopens past 4',()=>{
 let T=0;
 const target=mob(60,'creeper',at(7.5,-60,0));
 const {bot,calls}=makeBot({inventory:['iron_sword'],heldItem:'iron_sword',offhand:'shield',entities:[target],position:[0,-60,0]});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T});
 c.setTarget(target);
 T=0;c.tick();
 assert.equal(c.state,'approach','7.5 is past the fuse-cancel range: close in');
 assert.equal(bot.controlState.forward,true);
 target.position=at(2.7,-60,0);
 T=0.05;c.tick();
 assert.ok(calls.some(x=>x[0]==='attack'),'one swing inside 2.9');
 T=0.1;c.tick();
 assert.equal(c.state,'spacing','after the hit, reopen the gap');
 assert.equal(bot.controlState.forward,true,'sprint away, do not back into the fuse');
});
test('zombie family: crits + knockback, sweep only with a sword against groups',()=>{
 const solo=pickTactic('zombie',SWORD);
 assert.equal(solo.crit,true);assert.equal(solo.knockback,true);assert.equal(solo.backpedal,true);
 assert.equal(solo.sweep,false,'solo: crits, not sweeps');
 const group=pickTactic('zombie_villager',{...SWORD,weaponName:'iron_sword'},{groupSize:3});
 assert.equal(group.sweep,true,'sword + group: sweep');
 const axeGroup=pickTactic('husk',{...SWORD,weapon:'axe',weaponName:'iron_axe'},{groupSize:3});
 assert.equal(axeGroup.sweep,false,'axes cannot sweep');
 assert.equal(pickTactic('zombie',{weapon:null}).style,'avoid','never fight unarmed');
 assert.equal(pickTactic('zombie',{weapon:null},{cornered:true}).style,'last_resort');
});
test('skeleton/stray/bogged: bow duel or shield-up zig-zag; witch rush or bow',()=>{
 assert.deepEqual([pickTactic('skeleton',SWORD).style,pickTactic('skeleton',SWORD).shield,pickTactic('skeleton',SWORD).zigzag],['melee',true,true]);
 // 26.3 measured: melee+shield is the primary skeleton tactic; the bow only without a melee weapon
 assert.equal(pickTactic('stray',{...SWORD,bow:true,arrows:32}).style,'melee');
 assert.equal(pickTactic('stray',{weapon:null,bow:true,arrows:32}).style,'bow');
 assert.equal(pickTactic('bogged',{weapon:null}).style,'avoid');
 // 26.3 measured + review directive: NEVER rush a witch - it kites and out-potions every
 // rush (no knockback, no crit bonus, uncalibrated arrows); avoid and break line of sight.
 const witch=pickTactic('witch',SWORD);
 assert.equal(witch.style,'avoid');
 assert.equal(pickTactic('witch',{...SWORD,bow:true,arrows:32}).style,'avoid');
 assert.equal(pickTactic('witch',{weapon:null,bow:true,arrows:32}).style,'avoid');
});
test('drowned trident, spiders, slimes, enderman, phantom, vindicator, silverfish',()=>{
 const drow=pickTactic('drowned',SWORD,{holding:'trident'});
 assert.equal(drow.shield,true,'trident drowned: shield up while closing');
 assert.equal(pickTactic('drowned',SWORD).crit,true,'land drowned: plain crits');
 assert.equal(pickTactic('cave_spider',SWORD).crit,true,'cave spider: kill fast (poison)');
 assert.equal(pickTactic('slime',{...SWORD,weaponName:'iron_sword'}).sweep,true,'slimes: sweep');
 assert.equal(pickTactic('slime',SWORD,{size:'small'}).style,'ignore','small slimes are harmless');
 assert.equal(pickTactic('enderman',SWORD).style,'avoid','never provoked');
 const provoked=pickTactic('enderman',SWORD,{provoked:true});
 assert.equal(provoked.roof,true,'2-high roof, hit the legs');
 assert.equal(pickTactic('phantom',{...SWORD,bow:true,arrows:32}).style,'bow');
 assert.equal(pickTactic('phantom',SWORD).shield,true,'shield up, strike the swoop');
 assert.equal(pickTactic('vindicator',SWORD).knockback,true,'knock the vindicator back');
 assert.equal(pickTactic('silverfish',{...SWORD,weaponName:'stone_sword'}).sweep,true,'silverfish: sweep');
 assert.equal(pickTactic('pillager',SWORD).shield,true,'shield against crossbow bolts');
});

// ---- 7b.8 health discipline -----------------------------------------------------------------
test('health gates: disengage at 12, retreat at 8',()=>{
 assert.equal(shouldDisengage({health:12}),true);
 assert.equal(shouldDisengage({health:13}),false);
 assert.equal(shouldRetreat({health:8}),true);
 assert.equal(shouldRetreat({health:9}),false);
});

// ---- CombatController -------------------------------------------------------------------
test('controller: equips and verifies the weapon before the first swing, then crit-hops',async()=>{
 let T=0;
 const target=mob(40,'zombie',at(2,-60,0));
 const {bot,calls}=makeBot({inventory:['iron_sword'],heldItem:'dirt',offhand:'shield',entities:[target]});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T,critJumps:true}); // the hop machinery under test (26.3 default is off)
 c.setTarget(target);
 c.tick();
 assert.deepEqual(calls.filter(x=>x[0]==='attack').length,0,'no swing while holding dirt (7f)');
 assert.ok(calls.some(x=>x[0]==='equip'&&x[1]==='iron_sword'),'sword equipped first');
 await flush();
 c.tick();
 assert.deepEqual(calls.filter(x=>x[0]==='control'&&x[1]==='jump'&&x[2]===true).length,1,'crit hop starts');
 assert.equal(c.state,'crit-jump');
 bot.entity.onGround=false;bot.entity.velocity=at(0,-0.4,0); // falling
 T=0.1;c.tick();
 const hits=calls.filter(x=>x[0]==='attack');
 assert.deepEqual(hits,[[ 'attack',40 ]],'strikes on the way down');
 assert.equal(c.stats.hits,1);assert.equal(c.stats.crits,1,'counted as a crit');
});
test('controller: never swings inside the cooldown; back-pedals with the shield up',()=>{
 let T=0;
 const target=mob(41,'zombie',at(1.5,-60,0));
 const {bot,calls}=makeBot({inventory:['iron_sword'],heldItem:'iron_sword',offhand:'shield',entities:[target]});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T,primitives:{backpedal:true,shield:true}});
 c.setTarget(target);
 bot.entity.onGround=false;bot.entity.velocity=at(0,-0.4,0);
 T=0;c.tick(); // strike immediately (falling, ready)
 assert.equal(c.stats.hits,1);
 T=0.1;c.tick();
 assert.equal(c.stats.hits,1,'inside the 1.0 s cooldown: no second swing');
 assert.ok(calls.some(x=>x[0]==='control'&&x[1]==='back'&&x[2]===true),'back-pedal spacing (7b.3)');
 assert.ok(calls.some(x=>x[0]==='activate'&&x[1]===true),'shield raised while recharging (7b.5)');
 T=1.1;c.tick();
 assert.equal(c.stats.hits,2,'full charge elapsed: second swing');
});
test('controller: sprint reset after a knockback hit, sprint only with food > 6',()=>{
 let T=0;
 const target=mob(42,'zombie',at(2.5,-60,0));
 const {bot,calls}=makeBot({inventory:['iron_axe'],heldItem:'iron_axe',food:20,entities:[target]});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T,primitives:{sprintKnockback:true,crit:true}});
 c.setTarget(target);
 bot.entity.onGround=false;bot.entity.velocity=at(0,-0.4,0); // axe: 1.0 s cooldown, crit route
 T=0;c.tick();
 assert.ok(calls.some(x=>x[0]==='control'&&x[1]==='sprint'&&x[2]===true),'sprint on for the knockback hit');
 assert.ok(calls.some(x=>x[0]==='control'&&x[1]==='sprint'&&x[2]===false),'sprint reset right after (7b.3)');
 const hungry=makeBot({inventory:['iron_axe'],heldItem:'iron_axe',food:5,entities:[target]});
 const c2=new CombatController(bot,makeMove(bot,null),{now:()=>T});
 c2.setTarget(target);
 T=5;c2.tick();
 assert.ok(!hungry.calls.some(x=>x[0]==='control'&&x[1]==='sprint'&&x[2]===true),'no sprint at food 5');
});
test('controller: sweeps groups with a sword instead of crit-jumping',()=>{
 let T=0;
 const target=mob(43,'zombie',at(2,-60,0));
 const {bot,calls}=makeBot({inventory:['iron_sword'],heldItem:'iron_sword',offhand:'shield',
  entities:[target,mob(44,'zombie',at(2.5,-60,1)),mob(45,'zombie',at(3,-60,-1))]});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T});
 c.setTarget(target);
 T=0;c.tick();
 assert.equal(c.stats.hits,1);
 assert.equal(c.stats.sweeps,1,'group -> sweep');
 assert.equal(c.stats.crits,0,'sweep and crit are exclusive');
 assert.ok(!calls.some(x=>x[0]==='control'&&x[1]==='jump'),'no hop: sweep needs the ground');
});
test('controller: raises the shield and holds fire while an arrow is incoming',()=>{
 let T=0;
 const target=mob(46,'slime',at(2,-60,0),{height:1.0});
 const arrow=proj(47,'arrow',at(5,-59.5,0),at(-2,0,0)); // eta 2.5 s: inside the 3 s horizon
 const {bot,calls}=makeBot({inventory:['stone_sword'],heldItem:'stone_sword',offhand:'shield',entities:[target,arrow]});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T,primitives:{shield:true}});
 c.setTarget(target);
 T=0;c.tick();
 assert.ok(calls.some(x=>x[0]==='activate'&&x[1]===true),'shield up: projectile incoming');
 assert.equal(c.stats.hits,0,'no swing through the arrow');
 arrow.isValid=false;T=0.2;c.tick();
 assert.equal(c.stats.hits,1,'threat passed: sweep strikes');
 assert.ok(calls.some(x=>x[0]==='deactivate'),'shield lowered to strike');
});
test('controller: creeper without bow or shield is never fought',()=>{
 let T=0;
 const creeper=mob(48,'creeper',at(4,-60,0));
 const {bot,calls}=makeBot({inventory:[],heldItem:null,entities:[creeper]});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T});
 c.setTarget(creeper);
 c.tick();
 assert.equal(c.tactic.style,'avoid');
 assert.equal(c.stats.hits,0);
 assert.ok(!calls.some(x=>x[0]==='attack'));
});
test('controller: a fusing creeper with cobble places a LOS block (wiki cancel)',async()=>{
 let T=0;
 const creeper=mob(492,'creeper',at(5,-60,0));
 creeper.metadata=[,,,,,,,,,,,,,,,,1];
 const blocks={'2,-61,0':{name:'dirt',boundingBox:'block',position:at(2,-61,0)},
              '1,-61,0':{name:'dirt',boundingBox:'block',position:at(1,-61,0)},
              '2,-61,1':{name:'dirt',boundingBox:'block',position:at(2,-61,1)},
              '2,-61,-1':{name:'dirt',boundingBox:'block',position:at(2,-61,-1)}};
 const cobble=(x,z,y)=>{blocks[x+','+y+','+z]={name:'cobblestone',boundingBox:'block',position:at(x,y,z)};};
 const {bot,calls}=makeBot({
  inventory:['cobblestone','bow','arrow'],counts:{arrow:32,cobblestone:16},heldItem:'bow',
  entities:[creeper],food:20,blocks
 });
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T});
 c.setTarget(creeper);
 c.tick();
 await flush();
 assert.ok(calls.some(x=>x[0]==='equip'&&x[1]==='cobblestone'),'equip cobble for the LOS wall');
 assert.ok(calls.some(x=>x[0]==='place'),'place cobble between the bot and the fuse');
 assert.ok(!calls.some(x=>x[0]==='control'&&x[1]==='sprint'&&x[2]===true),'stand still so placeBlock lands');
 // 73192: eyes see over a 1-high wall; stack a second block and do not re-equip the bow.
 // The fake world's placeBlock never mutates the cache, so each step below lands the
 // block the way the server would, then the controller fires the next click.
 cobble(2,0,-60); // center feet landed
 T=0.2;c.tick();
 await flush();
 assert.ok(calls.filter(x=>x[0]==='place').length>=2,'stack a 2-high pillar');
 assert.ok(!calls.some(x=>x[0]==='equip'&&x[1]==='bow'),'do not re-equip the bow while the pillar is going up');
 cobble(2,0,-59); // center head landed: the center column is complete
 T=0.9;c.tick();
 await flush();
 // Cursor Round 6 next: a 1-WIDE pillar is pathed around in ~2 s (73194, 17.1 dmg) -
 // the flanks one cell each side across the heading go up after the center column.
 cobble(2,1,-60);cobble(2,1,-59); // left flank landed
 T=1.4;c.tick();
 await flush();
 const placedCells=calls.filter(x=>x[0]==='place').map(x=>x[1]&&x[1].x+','+x[1].z);
 assert.ok(placedCells.some(k=>k==='2,1'),'left flank column placed');
 assert.ok(placedCells.some(k=>k==='2,-1'),'right flank column placed');
 cobble(2,-1,-60);cobble(2,-1,-59); // right flank landed: the whole wall is up
 T=2.0;c.tick();
 assert.equal(c.state,'los-break','hold station behind the 2-high cover');
 assert.ok(!calls.some(x=>x[0]==='equip'&&x[1]==='bow'),'do not re-equip the bow once cover is up');
});
test('controller: a swelling creeper is sprinted away from, never closed on',()=>{
 let T=0;
 const creeper=mob(491,'creeper',at(5,-60,0));
 creeper.metadata=[,,,,,,,,,,,,,,,,1];
 const {bot,calls}=makeBot({inventory:['iron_sword'],heldItem:'iron_sword',offhand:'shield',entities:[creeper],food:20});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T}); // shield primitive stays off
 c.setTarget(creeper);
 c.tick();
 assert.equal(c.state,'guard');
 assert.ok(!calls.some(x=>x[0]==='attack'),'no swing while swell_dir is 1');
 assert.ok(calls.some(x=>x[0]==='control'&&x[1]==='sprint'&&x[2]===true),'sprint the open away heading (walk-back hit the lane wall, 73190)');
 assert.ok(calls.some(x=>x[0]==='activate'&&x[1]===true),'fuse raises the shield even when the melee primitive is off');
});
test('controller: hit-and-run strikes once inside reach, then reopens the gap past 4',()=>{
 let T=0;
 const creeper=mob(49,'creeper',at(2.5,-60,0)); // inside 2.9, no swell metadata yet
 const {bot,calls}=makeBot({inventory:['iron_sword'],heldItem:'iron_sword',entities:[creeper],food:20});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T});
 c.setTarget(creeper);
 T=0;c.tick();
 const strikes=calls.filter(x=>x[0]==='attack');
 assert.equal(strikes.length,1,'one hit-and-run strike at <=2.9 with a full cooldown');
 T=0.2;c.tick(); // inside the disengage beat: away + sprint, never a second swing
 assert.equal(calls.filter(x=>x[0]==='attack').length,1,'no second swing during the disengage beat');
 assert.ok(calls.some(x=>x[0]==='control'&&x[1]==='forward'&&x[2]===true),'retreating forward along an away heading');
 assert.ok(calls.some(x=>x[0]==='control'&&x[1]==='sprint'&&x[2]===true),'retreat sprints');
 assert.ok(!calls.some(x=>x[0]==='control'&&x[1]==='back'&&x[2]===true),'never back-pedals toward the fuse');
});
test('controller: on cooldown inside 4 it retreats at an angle, never into a wall',()=>{
 let T=0;
 // Creeper at 3.4 (outside the fuse ring, inside minRange 4); cooldown spent.
 const creeper=mob(50,'creeper',at(3.4,-60,0));
 // Wall directly behind the bot along the straight away heading (-x).
 const {bot,calls}=makeBot({inventory:['iron_sword'],heldItem:'iron_sword',entities:[creeper],food:20,
  blocks:{'-1,-60,0':{name:'stone',boundingBox:'block'},'-1,-59,0':{name:'stone',boundingBox:'block'},
          '-2,-60,0':{name:'stone',boundingBox:'block'},'-2,-59,0':{name:'stone',boundingBox:'block'}}});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T});
 c.setTarget(creeper);
 c._lastStrike=-0.2; // swung 0.2 s ago: iron sword cooldown (1.0 s) not ready
 T=0;c.tick();
 assert.ok(!calls.some(x=>x[0]==='attack'),'no swing while the cooldown recharges');
 assert.equal(c.state,'spacing');
 assert.ok(calls.some(x=>x[0]==='control'&&x[1]==='forward'&&x[2]===true),'retreating (forward), not backing');
 // The straight away heading from a creeper at +x is yaw pi/2 (due -x); the wall must slant it.
 const looks=calls.filter(x=>x[0]==='look').map(x=>x[1]);
 const straight=Math.PI/2;
 assert.ok(looks.length>0,'the controller looked somewhere');
 const lastLook=looks[looks.length-1];
 assert.ok(Math.abs(lastLook-straight)>0.3,'the retreat heading avoids the wall (last look is the away heading)');
});
test('controller: retreat picks the longest open heading, not the first 1.6-passable slant',()=>{
 let T=0;
 const creeper=mob(502,'creeper',at(3.4,-60,0));
 // Straight away (-x) is a 1.6-block alcove; +z is a 3-wide 8-block corridor
 // (combat-arena gate). First-passable used to take the alcove and detonate.
 const blocks={};
 for(const y of [-60,-59]){
  blocks[`-3,${y},0`]={name:'stone',boundingBox:'block'};
  for(const x of [-3,-2,-1])for(const z of [-1,1])
   blocks[`${x},${y},${z}`]={name:'stone',boundingBox:'block'};
  for(const x of [-2,-1,0,1,2])blocks[`${x},${y},-1`]={name:'stone',boundingBox:'block'};
  for(const z of [1,2,3,4,5,6,7]){
   blocks[`-2,${y},${z}`]={name:'stone',boundingBox:'block'};
   blocks[`2,${y},${z}`]={name:'stone',boundingBox:'block'};
  }
 }
 const {bot,calls}=makeBot({inventory:['iron_sword'],heldItem:'iron_sword',entities:[creeper],food:20,blocks});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T});
 c.setTarget(creeper);
 c._lastStrike=-0.2;
 T=0;c.tick();
 const looks=calls.filter(x=>x[0]==='look').map(x=>x[1]);
 assert.ok(looks.length>0);
 const last=looks[looks.length-1];
 // Must increase the gap (never flee through the creeper) and not take the 1.6 alcove.
 const dx=-Math.sin(last),dz=Math.cos(last);
 const gap=Math.hypot(dx*3.2-3.4,dz*3.2);
 assert.ok(gap>3.6,'retreat increases the gap; do not run through the creeper');
});
test('controller: outside 7 with a fresh cooldown it approaches again',()=>{
 let T=2;
 const creeper=mob(51,'creeper',at(7.5,-60,0));
 const {bot,calls}=makeBot({inventory:['iron_sword'],heldItem:'iron_sword',entities:[creeper],food:20});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T});
 c.setTarget(creeper);
 c._lastStrike=-10; // cooldown long ready
 c.tick();
 assert.equal(c.state,'approach');
 assert.ok(calls.some(x=>x[0]==='control'&&x[1]==='forward'&&x[2]===true),'closes in for the next hit');
});
test('controller: after a creeper hit it will not re-close until the gap is past 7',()=>{
 let T=2;
 const creeper=mob(511,'creeper',at(4.5,-60,0));
 const {bot,calls}=makeBot({inventory:['iron_sword'],heldItem:'iron_sword',entities:[creeper],food:20});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T});
 c.setTarget(creeper);
 c._lastStrike=-10;
 c.tick();
 assert.equal(c.state,'spacing','4.5 is inside the fuse-cancel range: keep fleeing, do not walk back in');
 assert.ok(calls.some(x=>x[0]==='control'&&x[1]==='forward'&&x[2]===true));
});
test('controller: draws the bow for a full second, releases, and counts the shot',()=>{
 let T=0;
 const target=mob(50,'skeleton',at(15,-60,0));
 const {bot,calls}=makeBot({inventory:['bow','arrow'],counts:{arrow:32},heldItem:'bow',entities:[target]});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T,primitives:{kite:true}});
 c.setTarget(target);
 T=0;c.tick();
 assert.equal(c.tactic.style,'bow');
 assert.ok(c.callsLooked===undefined&&calls.some(x=>x[0]==='look'),'aims along the solution');
 assert.ok(calls.some(x=>x[0]==='activate'&&x[1]===false),'main-hand draw starts');
 assert.equal(c.state,'draw');
 T=0.9;c.tick();
 assert.equal(c.stats.shots,0,'release only at full draw (~1 s)');
 T=1.0;c.tick();
 assert.equal(c.stats.shots,1);
 assert.ok(calls.some(x=>x[0]==='deactivate'),'release fired');
 T=1.4;c.tick();
 assert.ok(calls.filter(x=>x[0]==='activate'&&x[1]===false).length===2,'re-draws after the gap');
});
test('controller: inside bow min range a creeper is only fled, never drawn-into',()=>{
 let T=0;
 const target=mob(51,'creeper',at(4,-60,0));
 const {bot,calls}=makeBot({inventory:['bow','arrow'],counts:{arrow:32},heldItem:'bow',entities:[target]});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T,primitives:{kite:true}});
 c.setTarget(target);
 T=0;c.tick();
 assert.ok(['kite','guard','spacing'].includes(c.state),'inside 8: backpedal, do not draw');
 assert.ok(calls.some(x=>x[0]==='control'&&x[1]==='back'&&x[2]===true),'face+back: forward walked into the gate (73176-81)');
 assert.ok(!calls.some(x=>x[0]==='control'&&x[1]==='forward'&&x[2]===true));
 assert.ok(!calls.some(x=>x[0]==='activate'),'draw+forward while looking at the creeper walked 8→1.9 (22:59 log)');
 assert.equal(c.stats.shots,0);
});
test('controller: Via-zero velocity still leads a creeper from sampled motion (73189)',()=>{
 let T=0;
 const target=mob(72,'creeper',at(16,-60,4));
 target.velocity=at(0,0,0); // ViaVersion on 26.3
 const {bot,calls}=makeBot({inventory:['bow','arrow'],counts:{arrow:32},heldItem:'bow',entities:[target]});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T});
 c.setTarget(target);
 T=0;c.tick();
 target.position=at(16,-60,6); // walked +z toward the gate, not along the shot line
 T=0.2;c.tick();
 const looks=calls.filter(x=>x[0]==='look');
 assert.ok(looks.length>=2,'drew and re-aimed');
 const raw=yawToward(16,6);
 const led=looks[looks.length-1][1];
 assert.ok(headingOf(led).z>headingOf(raw).z,'yaw leads +z (the sampled walk), not the stale body');
});
test('controller: default now() ignores a bot.time.age jump (73186 released at 0.27s)',()=>{
 const target=mob(70,'creeper',at(16,-60,0));
 const {bot}=makeBot({inventory:['bow','arrow'],counts:{arrow:32},heldItem:'bow',entities:[target]});
 bot.time={age:100};
 const c=new CombatController(bot,makeMove(bot,null));
 const t0=c.now();
 bot.time.age=100+20; // +1 s of game ticks in one packet
 const t1=c.now();
 assert.ok(t1-t0<0.5,'wall clock, not age/20');
 c.setTarget(target);
 c.tick();
 assert.equal(c.state,'draw');
 assert.equal(c.stats.shots,0);
 bot.time.age=100+40;
 c.tick();
 assert.equal(c.stats.shots,0,'an age jump must not release a 1 s draw');
});
test('controller: creeper at 10+ draws on the first tick and holds the shot through 9',()=>{
 let T=0;
 const target=mob(61,'creeper',at(10.6,-60,0));
 const {bot,calls}=makeBot({inventory:['bow','arrow'],counts:{arrow:32},heldItem:'bow',entities:[target]});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T,primitives:{kite:true}});
 c.setTarget(target);
 T=0;c.tick();
 assert.ok(calls.some(x=>x[0]==='activate'),'draw immediately at 10.6 (opening kite walked into the gate)');
 assert.equal(c.state,'draw');
 c.setTarget(target);
 target.position=at(9,-60,0);
 T=0.5;c.tick();
 assert.ok(c._drawing||c.stats.shots>0,'hold the draw through 10→9');
});
test('controller: arena creeper at bow range stands and draws, does not walk the gate',()=>{
 let T=0;
 const target=mob(62,'creeper',at(1504,-60,1504));
 const {bot,calls}=makeBot({position:[1496,-60,1497],inventory:['bow','arrow'],counts:{arrow:32},heldItem:'bow',entities:[target]});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T,primitives:{kite:true}});
 c.setTarget(target);
 T=0;c.tick();
 assert.ok(calls.some(x=>x[0]==='activate'),'draw from 10.6, do not sprint the gate');
 assert.ok(bot.controlState.forward!==true,'forward+look walked into the gate');
});
test('controller: disengages below 12 health and retreats below 8; recovers at 14',()=>{
 let T=0;
 const target=mob(52,'zombie',at(2,-60,0));
 const {bot,calls}=makeBot({inventory:['iron_sword','cooked_beef'],heldItem:'iron_sword',offhand:'shield',health:11,entities:[target],foods:{cooked_beef:{foodPoints:8,saturation:0.8}}});
 const events=[];
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T,onEvent:(t,d)=>events.push(t),primitives:{shield:true}});
 c.setTarget(target);
 T=0;c.tick();
 assert.equal(c.state,'disengage');
 assert.ok(events.includes('disengage'),'driver told to feed the bot (7b.8)');
 assert.ok(calls.some(x=>x[0]==='activate'&&x[1]===true),'shield up while disengaged');
 assert.equal(c.stats.hits,0,'no swings while disengaged');
 bot.health=15;T=3;c.tick();
 assert.ok(events.includes('reengage'),'back to work at health >= 14');
 bot.health=7;T=5;c.tick();
 assert.equal(c.state,'retreat');
 assert.ok(events.includes('critical'));
});
test('controller: stands down when the worker does not own control',()=>{
 let T=0;
 const target=mob(53,'zombie',at(2,-60,0));
 const {bot,calls}=makeBot({inventory:['iron_sword'],heldItem:'iron_sword',entities:[target]});
 const worker={epoch:5,controlToken:4};
 // The controller never reads the token itself: its move helper carries the production
 // guard (src/tasks/movement/move.js) and skips every packet while another owner holds.
 const move={
  setControls:states=>{if(worker.controlToken!==worker.epoch)return;
   for(const[k,v]of Object.entries(states))bot.setControlState(k,v);},
  look:(yaw,pitch)=>{if(worker.controlToken!==worker.epoch)return;
   bot.look(yaw,pitch,false).catch(()=>{});}
 };
 const c=new CombatController(bot,move,{now:()=>T});
 c.setTarget(target);
 T=0;c.tick();
 assert.deepEqual(calls.filter(x=>x[0]!=='attack'),[],'no movement/look packets while another owner holds control');
 worker.controlToken=5;
 T=0.1;c.tick();
 assert.ok(calls.length>0,'acts once control is ours');
});
test('controller: stop releases every control and cancels shield/draw',()=>{
 let T=0;
 const target=mob(54,'skeleton',at(15,-60,0));
 const {bot,calls}=makeBot({inventory:['bow','arrow'],counts:{arrow:32},heldItem:'bow',offhand:'shield',entities:[target]});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T,primitives:{kite:true,shield:true}});
 c.setTarget(target);
 T=0;c.tick(); // drawing now
 c.stop();
 assert.ok(calls.some(x=>x[0]==='deactivate'),'draw cancelled');
 assert.ok(calls.some(x=>x[0]==='control'&&x[1]==='jump'&&x[2]===false),'jump released');
 assert.equal(c.target,null);
 assert.equal(c.state,'idle');
});
test('controller: 600 ticks stay bounded (no control/attack spam, no repeated shield raises)',()=>{
 let T=0;
 const target=mob(55,'zombie',at(2,-60,0));
 const {bot,calls}=makeBot({inventory:['iron_sword'],heldItem:'iron_sword',offhand:'shield',entities:[target]});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T});
 c.setTarget(target);
 for(let i=0;i<600;i++){
  bot.entity.onGround=!(i%4); // alternate grounded / falling like a real crit hop
  bot.entity.velocity=at(0,(i%4)?-0.4:0,0);
  T=i*0.05;
  c.tick();
 }
 const attacks=calls.filter(x=>x[0]==='attack').length;
 const raises=calls.filter(x=>x[0]==='activate'&&x[1]===true).length;
 const lowers=calls.filter(x=>x[0]==='deactivate').length;
 assert.ok(attacks>0&&attacks<=600*0.05/1.0+2,'attacks paced by the cooldown: '+attacks);
 assert.ok(raises<=attacks+5,'a shield raise only follows a real lower or a wait: '+raises+' vs '+attacks);
 assert.ok(lowers>=raises-3,'every raise is eventually lowered: '+lowers+' vs '+raises);
 assert.ok(c.events.length<=50,'event buffer capped');
});
test('holdsBlockOrFood: dirt and food are never swing candidates (7f)',()=>{
 assert.equal(holdsBlockOrFood(makeBot({heldItem:'dirt'}).bot),true);
 assert.equal(holdsBlockOrFood(makeBot({heldItem:'bread'}).bot),true);
 assert.equal(holdsBlockOrFood(makeBot({heldItem:'iron_sword'}).bot),false);
 assert.equal(holdsBlockOrFood(makeBot({}).bot),false);
});
test('readGear: best weapon by tier (sword > axe > pickaxe), off-hand shield, arrows',()=>{
 const g=readGear(makeBot({inventory:['stone_axe','iron_pickaxe','bow','arrow'],counts:{arrow:5},offhand:'shield'}).bot);
 assert.equal(g.weapon,'axe','sword absent: best axe');
 assert.equal(g.tier,'stone');
 assert.equal(g.shield,true);
 assert.equal(g.bow,true);
 assert.equal(g.arrows,5);
 const g2=readGear(makeBot({inventory:['diamond_pickaxe','wooden_sword']}).bot);
 assert.deepEqual([g2.weapon,g2.tier],['sword','wooden'],'wooden sword outranks a diamond pickaxe');
});

// ---- creeper pillar-up (cloud session 2026-10-14) -------------------------------------------
const cell=(blocks,x,y,z,name)=>{blocks[x+','+y+','+z]={name,boundingBox:name==='air'?'empty':'block',position:at(x,y,z)};};
// Loaded flat ground at y=-61 (stand -60) with real air above it, like mineflayer's block cache.
function flatWorld(r=3){
 const blocks={};
 for(let x=-r;x<=r;x++)for(let z=-r;z<=r;z++){cell(blocks,x,-61,z,'dirt');for(let y=-60;y<=-54;y++)cell(blocks,x,y,z,'air');}
 return blocks;
}
const lastControl=(calls,name)=>{for(let i=calls.length-1;i>=0;i--)if(calls[i][0]==='control'&&calls[i][1]===name)return calls[i][2];return undefined;};
// Drive a pillar climb in the fake world: each jump apex fires one place, the block lands,
// the bot stands on it. Returns the reference positions clicked.
function climb(c,bot,calls,blocks,clock){
 const refs=[];
 for(let level=0;level<3;level++){
  bot.entity.position.y=-60+level;clock.T+=0.05;c.tick(); // standing: too low to place
  assert.equal(calls.filter(x=>x[0]==='place').length,refs.length,'no click before the feet clear the cell');
  bot.entity.position.y=-60+level+1.2;clock.T+=0.05;c.tick(); // apex
  const place=calls.filter(x=>x[0]==='place')[refs.length];
  assert.ok(place,'a place at the apex of jump '+(level+1));
  assert.deepEqual([place[2].x,place[2].y,place[2].z],[0,1,0],'placed on the top face');
  refs.push(place[1].y);
  cell(blocks,0,-60+level,0,'cobblestone'); // the server confirms the block
 }
 bot.entity.position.y=-57;clock.T+=0.05;c.tick();
 return refs;
}
test('controller: a closing creeper makes the bot pillar 3 up (jump-place under itself)',()=>{
 const clock={T:0};
 const blocks=flatWorld();
 const creeper=mob(600,'creeper',at(6.5,-60,0.5));
 const {bot,calls}=makeBot({inventory:['cobblestone','iron_sword'],counts:{cobblestone:16},heldItem:'iron_sword',
  position:[0.5,-60,0.5],entities:[creeper],blocks});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>clock.T});
 c.setTarget(creeper);
 c.tick();
 assert.equal(c.state,'pillar-climb');
 assert.ok(calls.some(x=>x[0]==='equip'&&x[1]==='cobblestone'),'hold the pillar block');
 assert.equal(lastControl(calls,'jump'),true,'hold jump: each landing jumps again');
 assert.ok(calls.some(x=>x[0]==='look'&&x[2]===-1.571),'look straight down');
 const refs=climb(c,bot,calls,blocks,clock);
 assert.deepEqual(refs,[-61,-60,-59],'each block goes on the one under the feet');
 assert.equal(c.state!=='pillar-climb',true);
 assert.equal(c._pillar.phase,'perch');
 assert.equal(lastControl(calls,'jump'),false,'stop jumping on the perch');
 assert.ok(!calls.some(x=>x[0]==='control'&&['forward','back','left','right','sprint'].includes(x[1])&&x[2]===true),'no walking while the column goes up');
 assert.equal(c._losCells,null,'no wall while pillaring');
});
test('controller: on the perch it waits out a fuse, then strikes down while the creeper stays',()=>{
 const clock={T:0};
 const blocks=flatWorld();
 const creeper=mob(601,'creeper',at(5.5,-60,0.5));
 const {bot,calls}=makeBot({inventory:['cobblestone','iron_sword'],counts:{cobblestone:16},heldItem:'iron_sword',
  position:[0.5,-60,0.5],entities:[creeper],blocks});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>clock.T});
 c.setTarget(creeper);c.tick();
 climb(c,bot,calls,blocks,clock);
 // The creeper reached the base and its fuse is running (it started before the climb).
 creeper.position=at(1.4,-60,0.5);creeper.metadata=[,,,,,,,,,,,,,,,,1];
 clock.T+=0.05;c.tick();
 assert.equal(c.state,'pillar-hold');
 assert.ok(!calls.some(x=>x[0]==='attack'),'never swing into a running fuse');
 // Fuse cancelled (it cannot reach 3 blocks of the perch); it stays at the base: strike down.
 creeper.metadata=[,,,,,,,,,,,,,,,,-1];
 clock.T+=0.5;c.tick(); // re-equip the sword (the hand held cobble; equips are 0.5 s apart)
 assert.ok(calls.some(x=>x[0]==='equip'&&x[1]==='iron_sword'));
 clock.T+=0.05;c.tick();
 assert.ok(calls.some(x=>x[0]==='attack'&&x[1]===601),'attack from above while it stays');
 const look=calls.filter(x=>x[0]==='look').pop();
 assert.ok(look[2]<0,'looking down at it');
 clock.T+=0.2;c.tick();
 assert.equal(calls.filter(x=>x[0]==='attack').length,1,'cooldown holds between swings');
 assert.equal(c._pillar.phase,'perch');
});
test('controller: the perch comes down once the creeper wanders past 8, stepping away from it',()=>{
 const clock={T:0};
 const blocks=flatWorld();
 const creeper=mob(602,'creeper',at(6.5,-60,0.5));
 const {bot,calls}=makeBot({inventory:['cobblestone','iron_sword'],counts:{cobblestone:16},heldItem:'iron_sword',
  position:[0.5,-60,0.5],entities:[creeper],blocks});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>clock.T});
 c.setTarget(creeper);c.tick();
 climb(c,bot,calls,blocks,clock);
 creeper.position=at(12.5,-60,0.5);
 clock.T+=0.05;c.tick();
 assert.equal(c._pillar.phase,'perch','a moment past the line first');
 clock.T+=1.1;c.tick();
 assert.equal(c._pillar.phase,'descend');
 assert.deepEqual(c._pillar.landing,{x:-1,y:-60,z:0},'a 3-block drop on the side away from the creeper');
 clock.T+=0.05;c.tick();
 assert.equal(lastControl(calls,'forward'),true,'step off the column');
 assert.ok(Math.abs(bot.entity.yaw-Math.PI/2)<0.01,'facing -x');
 bot.entity.position=at(-0.5,-60,0.5);
 clock.T+=0.05;c.tick();
 assert.equal(c._pillar,null,'back on the ground: the pillar is done');
});
test('controller: with no safe step-off the perch digs its own column down',()=>{
 const clock={T:0};
 const blocks=flatWorld();
 const creeper=mob(603,'creeper',at(6.5,-60,0.5));
 const digs=[];
 const {bot,calls}=makeBot({inventory:['cobblestone','iron_sword'],counts:{cobblestone:16},heldItem:'iron_sword',
  position:[0.5,-60,0.5],entities:[creeper],blocks});
 bot.dig=b=>{digs.push(b.position.y);return Promise.resolve();};
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>clock.T});
 c.setTarget(creeper);c.tick();
 climb(c,bot,calls,blocks,clock);
 // Every side of the column turns into lava: no step-off cell.
 for(const [x,z] of [[1,0],[-1,0],[0,1],[0,-1]])cell(blocks,x,-60,z,'lava'),blocks[x+',-60,'+z].boundingBox='empty';
 creeper.position=at(14.5,-60,0.5);
 clock.T+=0.05;c.tick();clock.T+=1.1;c.tick();
 assert.equal(c._pillar.landing,null);
 for(let y=-57;y>-60;y--){
  clock.T+=1.05;c.tick();
  assert.equal(digs[digs.length-1],y-1,'dig the column block under the feet');
  cell(blocks,0,y-1,0,'air');bot.entity.position.y=y-1;
 }
 assert.deepEqual(digs,[-58,-59,-60],'only the bot\'s own three blocks');
 clock.T+=1.05;c.tick();
 assert.equal(c._pillar,null);
 assert.ok(!calls.some(x=>x[0]==='control'&&x[1]==='forward'&&x[2]===true),'never walks into the lava');
});
test('controller: pillar height follows the headroom and the blocks held; else the wall stays',()=>{
 const clock={T:0};
 let blocks=flatWorld();
 cell(blocks,0,-56,0,'stone'); // ceiling: room for 2 up only
 const creeper=mob(604,'creeper',at(5.5,-60,0.5));
 let t=makeBot({inventory:['cobblestone','iron_sword'],counts:{cobblestone:16},heldItem:'iron_sword',position:[0.5,-60,0.5],entities:[creeper],blocks});
 let c=new CombatController(t.bot,makeMove(t.bot,null),{now:()=>clock.T});
 c.setTarget(creeper);c.tick();
 assert.equal(c._pillar.height,2);
 // A 1-block ceiling gap over the whole patch (no cell within a step has room either): no
 // pillar - the existing wall/flee logic runs instead. A ceiling over this cell alone is a
 // pillar step (the roofed-pocket tests below).
 blocks=flatWorld();for(let x=-3;x<=3;x++)for(let z=-3;z<=3;z++)cell(blocks,x,-57,z,'stone');
 creeper.metadata=[,,,,,,,,,,,,,,,,1];
 t=makeBot({inventory:['cobblestone','iron_sword'],counts:{cobblestone:16},heldItem:'iron_sword',position:[0.5,-60,0.5],entities:[creeper],blocks});
 c=new CombatController(t.bot,makeMove(t.bot,null),{now:()=>clock.T});
 c.setTarget(creeper);c.tick();
 assert.equal(c._pillar,null);
 assert.ok(!/^pillar/.test(c.state),'fallback, not a pillar: '+c.state);
 assert.ok(c._losCells&&c._losCells.length,'the wall is the fallback');
 // One block is not a pillar either.
 t=makeBot({inventory:['cobblestone','iron_sword'],counts:{cobblestone:1},heldItem:'iron_sword',position:[0.5,-60,0.5],entities:[creeper],blocks:flatWorld()});
 c=new CombatController(t.bot,makeMove(t.bot,null),{now:()=>clock.T});
 c.setTarget(creeper);c.tick();
 assert.equal(c._pillar,null);
 // Dirt only when nothing sturdier is held: cobble beats it.
 t=makeBot({inventory:['dirt','cobblestone','iron_sword'],counts:{dirt:30,cobblestone:3},heldItem:'iron_sword',position:[0.5,-60,0.5],entities:[creeper],blocks:flatWorld()});
 c=new CombatController(t.bot,makeMove(t.bot,null),{now:()=>clock.T});
 c.setTarget(creeper);c.tick();
 assert.equal(c._pillar.item,'cobblestone');
 // A far creeper (past the trigger, not fusing) does not start a pillar.
 const far=mob(605,'creeper',at(11.5,-60,0.5));
 t=makeBot({inventory:['cobblestone','iron_sword'],counts:{cobblestone:16},heldItem:'iron_sword',position:[0.5,-60,0.5],entities:[far],blocks:flatWorld()});
 c=new CombatController(t.bot,makeMove(t.bot,null),{now:()=>clock.T});
 c.setTarget(far);c.tick();
 assert.equal(c._pillar,null);
});
test('controller: a climb whose blocks never land gives up and falls back to the wall',()=>{
 const clock={T:0};
 const blocks=flatWorld();
 const creeper=mob(606,'creeper',at(4.5,-60,0.5));
 const {bot,calls}=makeBot({inventory:['cobblestone','iron_sword'],counts:{cobblestone:16},heldItem:'iron_sword',
  position:[0.5,-60,0.5],entities:[creeper],blocks});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>clock.T});
 c.setTarget(creeper);c.tick();
 for(let i=0;i<10;i++){bot.entity.position.y=-58.8;clock.T+=0.25;c.tick();bot.entity.position.y=-60;}
 assert.ok(calls.filter(x=>x[0]==='place').length>=2,'the click is retried on later jumps');
 assert.ok(calls.filter(x=>x[0]==='place').length<=6,'at most one click per 0.5 s');
 clock.T=4.2;c.tick();
 assert.equal(c._pillar,null);
 assert.equal(lastControl(calls,'jump'),false);
 assert.ok(!/^pillar/.test(c.state),'the wall/flee logic owns the next tick: '+c.state);
 clock.T+=0.05;c.tick();
 assert.equal(c._pillar,null,'no immediate retry after a failed climb');
});
test('controller: with a bow, a pillar-capable bot skips the 12-block wall and pillars at 8',()=>{
 const clock={T:0};
 const blocks=flatWorld(12);
 const creeper=mob(607,'creeper',at(10.5,-60,0.5));
 const {bot,calls}=makeBot({inventory:['cobblestone','bow','arrow','iron_sword'],counts:{cobblestone:16,arrow:32},heldItem:'bow',
  position:[0.5,-60,0.5],entities:[creeper],blocks});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>clock.T});
 c.setTarget(creeper);
 c.tick();
 assert.equal(c._losCells,null,'no wall at 10');
 assert.ok(!calls.some(x=>x[0]==='place'));
 assert.equal(c.state,'draw','keep shooting while it is still out at 10');
 creeper.position=at(7.5,-60,0.5);
 clock.T+=0.1;c.tick();
 assert.equal(c.state,'pillar-climb');
 assert.ok(calls.some(x=>x[0]==='deactivate'),'the draw is dropped for the climb');
 climb(c,bot,calls,blocks,clock);
 // Perched with a bow: the creeper at the base is shot from above.
 creeper.position=at(2.5,-60,0.5);
 clock.T+=0.6;c.tick();c.tick();
 assert.ok(calls.some(x=>x[0]==='equip'&&x[1]==='bow'));
 clock.T+=0.05;c.tick();
 assert.equal(c.state,'pillar-draw');
 clock.T+=1.05;c.tick();
 assert.equal(c.stats.shots,1);
});
// Round 2 roofed arena (4b_creeper_roofed, 17.1 damage): one arrow landed at ~9.6, then the
// bot logged los-break and built a wall while the gap closed to 2.8 - no pillar line. The
// draw backpedals away from the creeper, and that walked it into the arena's 2-high corner
// pocket (ceiling at y-58), where no pillar fits, so the wall branch won.
function pocketWorld(){
 const blocks=flatWorld(12);
 for(let x=-6;x<=-1;x++)for(let z=-3;z<=3;z++)cell(blocks,x,-58,z,'cobblestone');
 return blocks;
}
test('controller: bow shot, then a creeper closing - the draw never backs into a low pocket; it pillars',()=>{
 const clock={T:0};
 const blocks=pocketWorld();
 const creeper=mob(620,'creeper',at(10.5,-60,0.5));
 const {bot,calls}=makeBot({inventory:['cobblestone','bow','arrow','stone_sword'],counts:{cobblestone:16,arrow:32},heldItem:'bow',
  position:[0.5,-60,0.5],entities:[creeper],blocks});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>clock.T});
 c.setTarget(creeper);
 c.tick();
 assert.equal(c.state,'draw');
 for(let i=0;i<12;i++){clock.T+=0.1;c.tick();}
 assert.equal(c.stats.shots,1,'the arrow was released');
 assert.ok(!calls.some(x=>x[0]==='control'&&x[1]==='back'&&x[2]===true),'no backpedal into the 2-high pocket behind');
 creeper.position=at(9.1,-60,0.5);clock.T+=0.1;c.tick();
 assert.equal(c._losCells,null,'no wall while a pillar fits here');
 creeper.position=at(7.5,-60,0.5);clock.T+=0.1;c.tick();
 assert.equal(c.state,'pillar-climb');
 assert.ok(calls.some(x=>x[0]==='equip'&&x[1]==='cobblestone'),'switches from the bow to the blocks');
 climb(c,bot,calls,blocks,clock);
 assert.equal(c._pillar.phase,'perch');
 assert.equal(c._pillar.height,3);
 assert.ok(!calls.some(x=>x[0]==='place'&&x[1]&&x[1].x!==0),'every place went on the column, none on a wall');
});
test('controller: under a low roof the bot steps out to headroom and pillars instead of walling',()=>{
 const clock={T:0};
 const blocks=pocketWorld();
 // The bot already stands in the pocket (x=-2): no pillar fits, the creeper is at 9.6.
 const creeper=mob(621,'creeper',at(8.1,-60,0.5));
 const {bot,calls}=makeBot({inventory:['cobblestone','bow','arrow','stone_sword'],counts:{cobblestone:16,arrow:32},heldItem:'bow',
  position:[-1.5,-60,0.5],entities:[creeper],blocks});
 const logs=[];
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>clock.T,log:m=>logs.push(m)});
 c.setTarget(creeper);
 c.tick();
 assert.equal(c.state,'pillar-step');
 assert.equal(c._losCells,null,'no wall');
 assert.ok(!calls.some(x=>x[0]==='place'));
 assert.deepEqual([c._pillar.x,c._pillar.z],[0,0],'the nearest cell with headroom');
 assert.equal(lastControl(calls,'forward'),true);
 assert.ok(headingOf(bot.entity.yaw).x>0.9,'walking out toward +x');
 assert.ok(logs.some(l=>/pillar step to 0,-60,0/.test(l)));
 // Out of the pocket; the creeper closed to 7.
 bot.entity.position=at(0.5,-60,0.5);creeper.position=at(7.5,-60,0.5);
 clock.T+=0.4;c.tick();
 assert.equal(c._pillar.phase,'climb');
 clock.T+=0.05;c.tick();
 assert.equal(c.state,'pillar-climb');
 climb(c,bot,calls,blocks,clock);
 assert.equal(c._pillar.phase,'perch');
});
test('controller: a pocket step is never toward a creeper already close, and gives up after 1.5 s',()=>{
 const clock={T:0};
 const blocks=pocketWorld();
 // Creeper 4 away on the open side: every cell with headroom is inside the 4.5 gap.
 const near=mob(622,'creeper',at(2.6,-60,0.5));
 let t=makeBot({inventory:['cobblestone','stone_sword'],counts:{cobblestone:16},heldItem:'stone_sword',position:[-1.5,-60,0.5],entities:[near],blocks});
 let c=new CombatController(t.bot,makeMove(t.bot,null),{now:()=>clock.T});
 c.setTarget(near);c.tick();
 assert.notEqual(c.state,'pillar-step');
 // A step that never arrives ends, and is not retried at once.
 const far=mob(623,'creeper',at(8.1,-60,0.5));
 t=makeBot({inventory:['cobblestone','stone_sword'],counts:{cobblestone:16},heldItem:'stone_sword',position:[-1.5,-60,0.5],entities:[far],blocks});
 c=new CombatController(t.bot,makeMove(t.bot,null),{now:()=>clock.T});
 c.setTarget(far);c.tick();
 assert.equal(c.state,'pillar-step');
 clock.T+=1.6;c.tick();
 assert.equal(c._pillar,null);
 clock.T+=0.05;c.tick();
 assert.notEqual(c.state,'pillar-step');
});
// ---- look convention (cloud session 2026-10-14) ----------------------------------------
// combat.js aimed with the Notchian convention (z=+cos(yaw), positive pitch down) through
// mineflayer's bot.look, which mirrors every z heading and every bow pitch. Pin the helper
// to the installed mineflayer's own view vector and lookAt maths.
test('heading.js matches the installed mineflayer look convention',()=>{
 const ray=fs.readFileSync(new URL('../node_modules/mineflayer/lib/plugins/ray_trace.js',import.meta.url),'utf8');
 assert.ok(ray.includes('new Vec3(-snYaw * csPitch, snPitch, -csYaw * csPitch)'),'mineflayer view vector changed: re-check src/heading.js');
 const phys=fs.readFileSync(new URL('../node_modules/mineflayer/lib/plugins/physics.js',import.meta.url),'utf8');
 assert.ok(phys.includes('const yaw = Math.atan2(-delta.x, -delta.z)')&&phys.includes('const pitch = Math.atan2(delta.y, groundDistance)'),'mineflayer lookAt changed: re-check src/heading.js');
 const view=(yaw,pitch)=>({x:-Math.sin(yaw)*Math.cos(pitch),y:Math.sin(pitch),z:-Math.cos(yaw)*Math.cos(pitch)});
 for(const [dx,dy,dz] of [[3,0,0],[0,0,3],[-2,1,5],[4,-2,-1]]){
  const g=Math.hypot(dx,dz),v=view(yawToward(dx,dz),pitchToward(dy,g)),n=Math.hypot(dx,dy,dz);
  assert.ok(Math.abs(v.x-dx/n)<1e-9&&Math.abs(v.y-dy/n)<1e-9&&Math.abs(v.z-dz/n)<1e-9,'looks along '+[dx,dy,dz]);
  const h=headingOf(yawToward(dx,dz));
  assert.ok(Math.abs(h.x-dx/g)<1e-9&&Math.abs(h.z-dz/g)<1e-9);
 }
});
test('controller: faces and aims at a target on the z axis (not its mirror image)',()=>{
 let T=0;
 const zombie=mob(80,'zombie',at(0,-60,10));
 const {bot,calls}=makeBot({inventory:['bow','arrow'],counts:{arrow:32},heldItem:'bow',entities:[zombie]});
 const sol=bowAimSolution(bot,zombie);
 const v=arrowTrajectory({x:0,y:-60+ARROW_LAUNCH_HEIGHT,z:0},sol.yaw,sol.pitch,{ticks:1})[0];
 assert.ok(v.z>0.5&&Math.abs(v.x)<1e-6,'the arrow flies toward +z where the zombie is');
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>T});
 c.setTarget(zombie);c._faceTarget(zombie);
 const look=calls.filter(x=>x[0]==='look').pop();
 assert.ok(headingOf(look[1]).z>0.99,'faces +z');
});
// ---- drag-aware ballistics (task 3, cloud session 2026-10-14) ------------------------------
// Vanilla AbstractArrow.tick: move by the current velocity, then drag 0.99, then gravity
// 0.05 (minecrafthawkeye / mineflayer-projectile use the same order); launch at eye - 0.1.
test('arrowTrajectory: vanilla tick order - full launch speed on the first tick, then drag and gravity',()=>{
 const p=arrowTrajectory({x:0,y:0,z:0},yawToward(1,0),0,{ticks:3});
 assert.ok(Math.abs(p[0].x-3)<1e-12&&Math.abs(p[0].y)<1e-12,'tick 1 moves the full 3.0, no drop yet');
 assert.ok(Math.abs(p[1].x-(3+2.97))<1e-12,'tick 2: 3*0.99');
 assert.ok(Math.abs(p[1].y-(-0.05))<1e-12,'tick 2: one gravity step');
 assert.ok(Math.abs(p[2].x-(3+2.97+2.9403))<1e-12);
 assert.ok(Math.abs(p[2].y-(-0.05-(0.05*0.99+0.05)))<1e-12,'gravity is dragged too');
 assert.equal(ARROW_LAUNCH_HEIGHT,1.52);
});
test('arrowTrajectory: the shooter\'s motion shifts the flight by u*dragSum(t) (linear)',()=>{
 const u={x:0.12,y:0,z:-0.2};
 const a=arrowTrajectory({x:0,y:0,z:0},0.7,0.1,{ticks:30});
 const b=arrowTrajectory({x:0,y:0,z:0},0.7,0.1,{ticks:30,inherit:u});
 for(let i=0;i<30;i++){
  const k=dragSum(i+1);
  assert.ok(Math.abs(b[i].x-(a[i].x+u.x*k))<1e-9&&Math.abs(b[i].z-(a[i].z+u.z*k))<1e-9&&Math.abs(b[i].y-a[i].y)<1e-9);
 }
 assert.equal(dragSum(1),1);
 assert.ok(Math.abs(dragSum(2)-1.99)<1e-12);
});
test('bowAimSolution: long flat and high shots land with the vanilla integrator',()=>{
 const {bot}=makeBot({});
 for(const [x,y,z] of [[30,-60,0],[0,-60,-22],[15,-52,15],[20,-66,-5]]){
  const target=mob(90,'zombie',at(x,y,z));
  const sol=bowAimSolution(bot,target);
  assert.ok(sol,'solvable '+[x,y,z]);
  const path=arrowTrajectory({x:0,y:-60+ARROW_LAUNCH_HEIGHT,z:0},sol.yaw,sol.pitch);
  assert.ok(minDistTo(path,{x,y:y+0.95,z})<0.15,'hits the body centre at '+[x,y,z]);
 }
});
test('bowAimSolution: a moving shooter compensates for the motion vanilla adds to the arrow',()=>{
 // Backpedalling at sprint speed while a creeper closes (the kite): 0.28 b/t away from it.
 const {bot}=makeBot({velocity:[-0.28,0,0.1]});
 const target=mob(91,'creeper',at(18,-60,4),{velocity:[-0.1,0,0]});
 const sol=bowAimSolution(bot,target);
 const from={x:0,y:-60+ARROW_LAUNCH_HEIGHT,z:0},u={x:-0.28,y:0,z:0.1};
 const real=arrowTrajectory(from,sol.yaw,sol.pitch,{inherit:u});
 const led={x:18-0.1*sol.ticks,y:-60+0.95,z:4};
 assert.ok(minDistTo(real,led)<0.3,'the inherited motion is aimed out');
 const naive=bowAimSolution(bot,target,{inherit:false});
 const miss=arrowTrajectory(from,naive.yaw,naive.pitch,{inherit:u});
 assert.ok(minDistTo(miss,led)>0.6,'ignoring it would miss (the old solver)');
});
// ---- round 6, task 5: the lane creeper (2-high column under the lane roof) -------------------
// Round 5: 'pillar-up 2', then pillar-hold until the blast - 2 up the base is inside the
// 3-block fuse ring (flat 2.24), and the perch only held. shots=0, the midpoint cratered.
function laneWorld(){
 const blocks=flatWorld(9);
 for(let x=-9;x<=9;x++)for(let z=-9;z<=9;z++)cell(blocks,x,-56,z,'dirt'); // the lane roof
 return blocks;
}
function climb2(c,bot,blocks,clock){
 for(let level=0;level<2;level++){
  bot.entity.position.y=-60+level;clock.T+=0.05;c.tick();
  bot.entity.position.y=-60+level+1.15;clock.T+=0.05;c.tick();
  cell(blocks,0,-60+level,0,'cobblestone');
 }
 bot.entity.position.y=-58;clock.T+=0.05;c.tick();
}
test('controller: a 2-high perch knocks the creeper back before it reaches the fuse ring',()=>{
 const clock={T:0};
 const blocks=laneWorld();
 const creeper=mob(640,'creeper',at(0.5,-60,7.6));
 const logs=[];
 const {bot,calls}=makeBot({inventory:['cobblestone','bow','arrow','stone_sword'],counts:{cobblestone:16,arrow:32},heldItem:'bow',
  position:[0.5,-60,0.5],entities:[creeper],blocks});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>clock.T,log:m=>logs.push(m)});
 c.setTarget(creeper);c.tick();
 assert.equal(c._pillar&&c._pillar.height,2,'the roof leaves room for 2');
 climb2(c,bot,blocks,clock);
 assert.equal(c._pillar.phase,'perch');
 // Still well outside the ring: the bow.
 creeper.position=at(0.5,-60,6.0);clock.T+=0.5;c.tick();clock.T+=0.05;c.tick();
 assert.ok(['pillar-draw','pillar-equip-bow','pillar-perch'].includes(c.state),c.state);
 assert.ok(!calls.some(x=>x[0]==='attack'));
 // Closing on the ring (2.24 + 1.6): the sword, and a swing as soon as it is in reach.
 creeper.position=at(0.5,-60,4.1);clock.T+=0.5;c.tick();
 assert.ok(logs.some(l=>/perch 2 up is inside the fuse ring; knocking the creeper back/.test(l)));
 assert.ok(calls.some(x=>x[0]==='equip'&&x[1]==='stone_sword'),'sword in hand');
 bot.heldItem={name:'stone_sword'};
 clock.T+=0.05;c.tick();
 assert.ok(!calls.some(x=>x[0]==='attack'),'4.1 flat is out of reach');
 creeper.position=at(0.5,-60,3.5);clock.T+=0.05;c.tick();
 assert.ok(calls.some(x=>x[0]==='attack'&&x[1]===640),'struck at 3.0 flat, outside the 2.24 ring');
 // Knocked back to 4.5: still within the hysteresis band, the sword stays in hand.
 creeper.position=at(0.5,-60,5.0);clock.T+=0.1;c.tick();
 assert.notEqual(c.state,'pillar-equip-bow');
 // A fuse that started anyway: hold the shield, no swing.
 creeper.position=at(0.5,-60,2.6);creeper.metadata=[,,,,,,,,,,,,,,,,1];
 const swings=calls.filter(x=>x[0]==='attack').length;
 clock.T+=1;c.tick();
 assert.equal(c.state,'pillar-hold');
 assert.equal(calls.filter(x=>x[0]==='attack').length,swings);
});
test('controller: a 3-high perch is outside the fuse ring and keeps the bow on a close creeper',()=>{
 const clock={T:0};
 const blocks=flatWorld();
 const creeper=mob(641,'creeper',at(6.5,-60,0.5));
 const logs=[];
 const {bot,calls}=makeBot({inventory:['cobblestone','bow','arrow','stone_sword'],counts:{cobblestone:16,arrow:32},heldItem:'bow',
  position:[0.5,-60,0.5],entities:[creeper],blocks});
 const c=new CombatController(bot,makeMove(bot,null),{now:()=>clock.T,log:m=>logs.push(m)});
 c.setTarget(creeper);c.tick();
 climb(c,bot,calls,blocks,clock);
 bot.heldItem={name:'bow'};
 creeper.position=at(2.5,-60,0.5);clock.T+=0.5;c.tick();
 assert.ok(!logs.some(l=>/fuse ring/.test(l)));
 assert.ok(!calls.some(x=>x[0]==='equip'&&x[1]==='stone_sword'));
});
test('round 63: a spared pig is fought at health 6; without the spare the controller retreats',()=>{
 for(const spare of [false,true]){
  const target=mob(53,'pig',at(2,-60,0));
  const {bot}=makeBot({inventory:['stone_sword'],heldItem:'stone_sword',health:6,food:0,entities:[target]});
  const c=new CombatController(bot,makeMove(bot,null),{now:()=>0,spareRetreat:spare?t=>t.name==='pig':undefined});
  c.setTarget(target);c.tick();
  if(spare)assert.notEqual(c.state,'retreat','a pig that cannot hit back is no reason to back off');
  else assert.equal(c.state,'retreat');
 }
});
