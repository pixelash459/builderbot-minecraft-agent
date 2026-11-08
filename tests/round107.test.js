import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {MobDefenseChain,CHASE_NEAR,CHASE_S,CHASE_MAX_MELEE,OUTRUNS} from '../src/chains/mobDefenseChain.js';
import {leaveAlone} from '../src/chains/combatPolicy.js';
import {markProvoked,provoked} from '../src/provoked.js';
console.error=()=>{};

// Round 107: the round-106 soak. hard3 opened its box with a stone sword at health 17, struck a
// spider once, then fled it `(vulnerable)` and was bitten to death from behind in 7 s; hard2 fled
// one zombie the same way. A melee mob that stays on the bot through a flee is now fought.
const mob=(id,name,x,z=0.5)=>({id,name,type:'hostile',position:new Vec3(x,71,z),isValid:true,height:name==='spider'?0.9:1.95});
function armedBot({health=17,entities={},solid=()=>false,sword=true,tod=5760,sky=14}={}){
 const items=[{name:'cobblestone',count:40,slot:37}];if(sword)items.unshift({name:'stone_sword',count:1,slot:36});
 return {entity:{position:new Vec3(0.5,71,0.5),onGround:true},entities,health,food:18,
  inventory:{items:()=>items,slots:[]},registry:{foodsByName:{}},time:{timeOfDay:tod},heldItem:sword?{name:'stone_sword'}:null,
  blockAt:p=>{const s=solid(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z));return {name:s?'stone':'air',boundingBox:s?'block':'empty',position:p.floored(),skyLight:sky};}};
}
const chainCtx=logs=>({config:{chains:{}},move:{},trackers:{},blacklist:{},worker:{log:m=>logs.push(m)}});
// the bot runs east 1.5 blocks a tick and the mob keeps `gap` behind it
function chaseTicks(m,bot,ctx,id,name,gap,n,clock){
 const out=[];
 for(let i=0;i<n;i++){
  bot.entity.position=new Vec3(0.5+i*1.5,71,0.5);
  bot.entities[id]=mob(id,name,bot.entity.position.x-gap);
  out.push(m.priority(bot,ctx));clock.t+=0.5;
 }
 return out;
}

test('round 107: a spider on the bot through a vulnerable flee is fought at once (round-106 hard3)',()=>{
 assert.equal(CHASE_NEAR,3);assert.equal(CHASE_S,1);assert.equal(CHASE_MAX_MELEE,2);assert.ok(OUTRUNS.has('spider'));
 const bot=armedBot({entities:{5:mob(5,'spider',2.0)}}),logs=[],m=new MobDefenseChain(),ctx=chainCtx(logs);
 let t=1000;m.now=()=>t;
 assert.equal(m.priority(bot,ctx),70,'health 17, armour 0: the vulnerable flee first');
 assert.match(logs.at(-1),/\(vulnerable\)$/);
 t+=0.25;assert.equal(m.priority(bot,ctx),85,'the spider is still on it: stand and fight');
 assert.equal(m.root.name,'KillEntitiesTask');assert.equal(m.root.lastResort,true);
 assert.equal(logs.at(-1),'Reflex: spider 1.5 away outruns the RunAwayFromHostilesTask (health 17, held stone_sword, 1 melee within 8); standing to fight');
 assert.ok(!logs.some(l=>/cornered/.test(l)),'not the 2-s pinned line');
 // the spider bit the bot (entityHurt marks it): hopping back to 3.5 by day keeps the fight on
 assert.equal(markProvoked(bot,bot.entities[5]),true);
 bot.entities[5]=mob(5,'spider',4.0);
 t+=0.25;assert.equal(m.priority(bot,ctx),85,'inside PINNED_KEEP: the fight keeps on');
 assert.deepEqual(m.root.currentTargets(bot,ctx).map(e=>e.name),['spider']);
 assert.equal(logs.filter(l=>/standing to fight/.test(l)).length,1,'logged once');
});

test('round 107: a zombie that keeps up with the flee for CHASE_S is fought; a flee that gains is not',()=>{
 {const bot=armedBot({health:6}),logs=[],m=new MobDefenseChain(),ctx=chainCtx(logs),c={t:0};m.now=()=>c.t;
  const p=chaseTicks(m,bot,ctx,7,'zombie',1.2,4,c);
  assert.deepEqual(p.slice(0,3),[70,70,70],'fleeing, the zombie on its heels for under 1 s');
  assert.equal(p[3],85);
  assert.equal(logs.at(-1),'Reflex: zombie 1.2 away has kept up with the RunAwayFromHostilesTask for 1.0 s (health 6, held stone_sword, 1 melee within 8); standing to fight');}
 // the flee opens the gap past CHASE_NEAR: it keeps running
 {const bot=armedBot({health:6}),logs=[],m=new MobDefenseChain(),ctx=chainCtx(logs),c={t:0};m.now=()=>c.t;
  for(let i=0;i<8;i++){bot.entity.position=new Vec3(0.5+i*1.5,71,0.5);bot.entities[7]=mob(7,'zombie',bot.entity.position.x-1.2-i);assert.notEqual(m.priority(bot,ctx),85);c.t+=0.5;}
  assert.ok(!logs.some(l=>/standing to fight/.test(l)));}
 // a gap of more than 1 s with nothing in reach starts the clock over
 {const bot=armedBot({health:6}),logs=[],m=new MobDefenseChain(),ctx=chainCtx(logs),c={t:0};m.now=()=>c.t;
  chaseTicks(m,bot,ctx,7,'zombie',1.2,2,c);
  const step=()=>{bot.entity.position=bot.entity.position.offset(1.5,0,0);};
  step();bot.entities[7]=mob(7,'zombie',bot.entity.position.x-6);c.t+=1.5;m.priority(bot,ctx);
  step();c.t+=0.5;bot.entities[7]=mob(7,'zombie',bot.entity.position.x-1.2);assert.equal(m.priority(bot,ctx),70,'the clock started over');
  assert.ok(!logs.some(l=>/standing to fight/.test(l)));}
});

test('round 107: no stand unarmed, in a crowd, through a wall, or from a creeper keep-away',()=>{
 const none=(bot,id,name,gap,n=6)=>{const logs=[],m=new MobDefenseChain(),ctx=chainCtx(logs),c={t:0};m.now=()=>c.t;chaseTicks(m,bot,ctx,id,name,gap,n,c);return logs;};
 // unarmed: the stand needs a real weapon (the 2-s pinned last resort is still there for it)
 assert.ok(!none(armedBot({health:6,sword:false}),7,'zombie',1.2).some(l=>/standing to fight/.test(l)));
 // three melee mobs within 8: still a flee
 {const bot=armedBot({health:6});bot.entities[8]=mob(8,'zombie',-4);bot.entities[9]=mob(9,'husk',-5,3);
  const logs=[],m=new MobDefenseChain(),ctx=chainCtx(logs),c={t:0};m.now=()=>c.t;
  for(let i=0;i<5;i++){bot.entities[7]=mob(7,'zombie',1.7);assert.ok(m.priority(bot,ctx)<85||/cornered/.test(logs.at(-1)));c.t+=0.5;}
  assert.ok(!logs.some(l=>/standing to fight/.test(l)));}
 // through a wall (the night box): not in sight
 {const bot=armedBot({health:6,entities:{7:mob(7,'zombie',2.2)},solid:(x,y)=>x===1&&(y===71||y===72)});
  const logs=[],m=new MobDefenseChain(),ctx=chainCtx(logs);let t=0;m.now=()=>t;
  for(let i=0;i<6;i++){m.priority(bot,ctx);t+=0.25;}
  assert.ok(!logs.some(l=>/standing to fight/.test(l)));}
 // a creeper is never stood against
 assert.ok(!none(armedBot({health:20}),9,'creeper',2).some(l=>/standing to fight/.test(l)));
 // a skeleton is ranged: not a chasing melee mob
 assert.ok(!none(armedBot({health:6}),8,'skeleton',2).some(l=>/standing to fight/.test(l)));
});

test('round 107: a spider that bit the bot is no longer left alone by day; other hostiles are not marked',()=>{
 const bot=armedBot({health:20}),spider=mob(5,'spider',6.5);
 assert.equal(leaveAlone(spider,bot),true,'a calm spider at sky 14 by day');
 assert.equal(markProvoked(bot,spider),true);
 assert.equal(provoked(bot,spider),true);
 assert.equal(leaveAlone(spider,bot),false,'it bit: a threat for PROVOKED_MS');
 assert.equal(markProvoked(bot,mob(6,'zombie',3)),false,'a zombie is hostile anyway');
 assert.equal(markProvoked(bot,mob(7,'cave_spider',3)),false);
});
