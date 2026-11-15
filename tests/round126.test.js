import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {MobDefenseChain,CREEPER_STALL_S,CREEPER_PIT_NEAR,CREEPER_STALL_NEAR} from '../src/chains/mobDefenseChain.js';

// Round 126: the round-125 soak on the Nitrous world copy. hard1a1 came out of its dawn box into
// a pocket under the cherry canopy at (815, 87, -530) with a creeper 3.2-6 away that never reached
// it; the keep-away ran in place for 1001 s at health 20 and the night shelter job never ran.
const creeperAt=(x,z=0)=>({id:9,name:'creeper',type:'hostile',position:new Vec3(x,64,z),isValid:true,metadata:{}});
function walker(){
 return {entity:{position:new Vec3(0.5,64,0.5)},entities:{},health:20,food:20,
  inventory:{items:()=>[],slots:[]},registry:{foodsByName:{}},time:{timeOfDay:1500},heldItem:null,blockAt:()=>null};
}
const setup=()=>{const bot=walker(),logs=[],m=new MobDefenseChain(),ctx={config:{chains:{}},move:{},trackers:{},blacklist:{},worker:{log:x=>logs.push(x)}};return {bot,logs,m,ctx};};
// the round-125 creeper: in from 9, then 3.2-6 off and never nearer
const hover=[9,8,7,5.9,4.6,5.2,4.1,5.8,4.4,5.5,4.9,5.1];
const pitLine=/^Reflex: the creeper [\d.]+ away has not come nearer than [\d.]+ in \d+ s and the bot has not moved off \(0, 64, 0\) in \d+ s \(health 20, no hit\); it cannot reach the bot - back to the job \(fleeing it again inside 3\)$/;

test('round 126: a creeper hovering inside 6 that cannot reach a pinned, unhurt bot is left for the job, and fled again inside 3',()=>{
 const {bot,logs,m,ctx}=setup();
 let t=100;m.now=()=>t;
 let p,i=0;
 for(;t<100+3*CREEPER_STALL_S;i++,t+=1){
  bot.entities[9]=creeperAt(0.5+hover[Math.min(i,hover.length-1-(i%2))]);p=m.priority(bot,ctx);
  if(logs.some(l=>pitLine.test(l)))break;
  assert.ok(p>=50,'kept away at t='+t);
 }
 const line=logs.find(l=>pitLine.test(l));
 assert.ok(line,'the pit line: '+logs.join(' | '));
 assert.ok(t-100>=CREEPER_STALL_S&&t-100<=CREEPER_STALL_S+12,'after the stall window, t='+t);
 assert.ok(p<50,'below the job');
 // between 3 and 6 it stays left (the round-79 rule would flee it again here)
 t+=1;bot.entities[9]=creeperAt(0.5+4.2);assert.ok(m.priority(bot,ctx)<50);
 t+=1;bot.entities[9]=creeperAt(0.5+CREEPER_STALL_NEAR-0.5);assert.ok(m.priority(bot,ctx)<50);
 // inside its fuse range it is fled again, from the start
 t+=1;bot.entities[9]=creeperAt(0.5+CREEPER_PIT_NEAR-0.5);
 assert.ok(m.priority(bot,ctx)>=50);
 assert.equal(logs.at(-1),'Reflex: fleeing creeper (never melee a creeper)');
 assert.equal(m._creeperChase.stalled,undefined);
});

test('round 126: a hit or a flee that moves the bot keeps the creeper fled',()=>{
 // hurt every 10 s: something reaches the bot, so the creeper is not left inside 6
 {const {bot,logs,m,ctx}=setup();let t=100;m.now=()=>t;
  for(let i=0;i<3*CREEPER_STALL_S;i++,t+=1){
   if(i%10===9)bot.health-=1;
   bot.entities[9]=creeperAt(0.5+hover[Math.min(i,hover.length-1-(i%2))]);
   assert.ok(m.priority(bot,ctx)>=50,'hurt, t='+t);
  }
  assert.ok(!logs.some(l=>/cannot reach the bot|has not come nearer/.test(l)));}
 // the flee is moving the bot 4 blocks every 6 s, the creeper following at 4-6
 {const {bot,logs,m,ctx}=setup();let t=100;m.now=()=>t;
  for(let i=0;i<3*CREEPER_STALL_S;i++,t+=1){
   if(i%6===5)bot.entity.position=bot.entity.position.offset(0,0,4);
   const z=bot.entity.position.z;
   bot.entities[9]=creeperAt(0.5+hover[Math.min(i,hover.length-1-(i%2))],z);
   assert.ok(m.priority(bot,ctx)>=50,'moving, t='+t);
  }
  assert.ok(!logs.some(l=>/cannot reach the bot|has not come nearer/.test(l)));}
});
