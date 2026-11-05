// Round 95 (round-94 hard3: out of a cave-morning climb at y=89 beside a creeper, health 20 and a
// stone sword; `keeping 20 away` 3 s after `fleeing creeper`, then the fuse at 2.9 with the flee
// not moving the bot, and blown up 10.2 s after the shelter completed): a chased creeper that
// comes within CREEPER_CLOSING_NEAR through the keep-away is fought from a pillar at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {MobDefenseChain,CREEPER_CHASE_S,CREEPER_CHASED_KEEP,CREEPER_PERSIST,CREEPER_CLOSING_NEAR} from '../src/chains/mobDefenseChain.js';

const creeperAt=(x,id=9)=>({id,name:'creeper',type:'hostile',position:new Vec3(x,64,0),isValid:true,metadata:{}});
const zombieAt=x=>({id:7,name:'zombie',type:'hostile',position:new Vec3(0,64,x),isValid:true,metadata:{}});
function walker(items=[{name:'stone_sword',count:1},{name:'cobblestone',count:49}]){
 return {entity:{position:new Vec3(0,64,0)},entities:{},health:20,food:20,
  inventory:{items:()=>items,slots:[]},registry:{foodsByName:{}},time:{timeOfDay:1500},heldItem:null,blockAt:()=>null};
}
const setup=bot=>{const logs=[],m=new MobDefenseChain(),ctx={config:{chains:{}},move:{},trackers:{},blacklist:{},worker:{log:x=>logs.push(x)}};return {m,ctx,logs};};

test('round 95: a chased creeper that closes to 6 through the keep-away is fought from a pillar at once',()=>{
 assert.equal(CREEPER_CLOSING_NEAR,6);assert.ok(CREEPER_CHASE_S<CREEPER_PERSIST);
 const bot=walker(),{m,ctx,logs}=setup(bot);
 let t=100;m.now=()=>t;
 // round-94 hard3: the creeper beside the climb's top
 bot.entities[9]=creeperAt(4);
 assert.ok(m.priority(bot,ctx)>=50);
 assert.equal(logs.at(-1),'Reflex: fleeing creeper (never melee a creeper)');
 t+=CREEPER_CHASE_S;bot.entities[9]=creeperAt(8);
 m.priority(bot,ctx);
 assert.equal(logs.at(-1),'Reflex: a creeper has followed for 3 s; keeping '+CREEPER_CHASED_KEEP+' away');
 assert.equal(m.root.distance,CREEPER_CHASED_KEEP);
 // the keep-away does not keep it off: 5.2 away 2 s later
 t+=2;bot.entities[9]=creeperAt(5.2);
 assert.equal(m.priority(bot,ctx),66);
 assert.equal(logs.at(-1),'Reflex: a creeper has followed for 5 s and closed to 5.2 through the keep-away; fighting it from a pillar');
 assert.equal(m.root.constructor.name,'FightTask');
 // the same chase stays a pillar fight when it backs off, with one line, until it is lost
 const n=logs.length;
 for(const d of [7,9.5,12,4.5]){t+=0.5;bot.entities[9]=creeperAt(d);assert.equal(m.priority(bot,ctx),66,'at '+d);}
 assert.equal(logs.length,n,'logged once');
 t+=0.5;bot.entities[9]=creeperAt(21);assert.ok(m.priority(bot,ctx)<50,'past 20 it is not fled');
 // lost for 5 s: a new chase starts over with the plain flee
 t+=6;bot.entities[9]=creeperAt(5);m.priority(bot,ctx);
 assert.equal(logs.at(-1),'Reflex: fleeing creeper (never melee a creeper)');
});

test('round 95: a creeper the keep-away holds off past 6 is still fled until CREEPER_PERSIST',()=>{
 const bot=walker(),{m,ctx,logs}=setup(bot);
 let t=100;m.now=()=>t;
 bot.entities[9]=creeperAt(9);m.priority(bot,ctx);
 for(const d of [8,7,6.5,9,12,7.5]){t+=CREEPER_CHASE_S;bot.entities[9]=creeperAt(d);if(t-100<CREEPER_PERSIST)assert.ok(m.priority(bot,ctx)>=55&&m.root.constructor.name==='RunAwayFromCreepersTask','at '+d);}
 assert.ok(!logs.some(l=>/closed to/.test(l)));
 // within 6 only in the first CREEPER_CHASE_S (not yet a chase) is the plain flee
 const b2=walker(),s2=setup(b2);let u=100;s2.m.now=()=>u;
 b2.entities[9]=creeperAt(3);s2.m.priority(b2,s2.ctx);u+=1;b2.entities[9]=creeperAt(5);s2.m.priority(b2,s2.ctx);
 assert.equal(s2.m.root.constructor.name,'RunAwayFromCreepersTask');
 assert.ok(!s2.logs.some(l=>/pillar/.test(l)));
});

test('round 95: the closing pillar needs a weapon, health, blocks and a lone creeper; the creeper-within-5 check does not block it',()=>{
 const run=(bot,last=4)=>{const {m,ctx,logs}=setup(bot);let t=100;m.now=()=>t;
  bot.entities[9]=creeperAt(8);m.priority(bot,ctx);t+=CREEPER_CHASE_S;bot.entities[9]=creeperAt(last);const p=m.priority(bot,ctx);return {p,logs,root:m.root};};
 // within 5 with no bow: the 7f fight policy refuses, the pillar does not
 const ok=run(walker());assert.equal(ok.p,66);assert.match(ok.logs.at(-1),/closed to 4\.0 through the keep-away; fighting it from a pillar$/);
 const noSword=run(walker([{name:'cobblestone',count:49}]));assert.equal(noSword.root.constructor.name,'RunAwayFromCreepersTask');
 const noBlocks=run(walker([{name:'stone_sword',count:1},{name:'cobblestone',count:1}]));assert.equal(noBlocks.root.constructor.name,'RunAwayFromCreepersTask');
 const hurt=walker();hurt.health=11;assert.equal(run(hurt).root.constructor.name,'RunAwayFromCreepersTask');
 const night=walker();night.time.timeOfDay=15000;assert.equal(run(night).root.constructor.name,'RunAwayFromCreepersTask');
 const crowd=walker();crowd.entities[7]=zombieAt(4);assert.ok(!run(crowd).logs.some(l=>/closed to/.test(l)),'not with a zombie within 6');
 const pair=walker();pair.entities[8]=creeperAt(-9,8);assert.ok(!run(pair).logs.some(l=>/closed to/.test(l)),'not with a second creeper within 10');
});
