import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {newSpeed,speedTick,GAME_SPRINT,GAME_WALK,SPEED_LOG_MS,SPEED_SETTLE} from '../src/worker.js';
import {MobDefenseChain,GAME_SPRINT as CHAIN_SPRINT,FLEE_METER_MIN} from '../src/chains/mobDefenseChain.js';
console.error=()=>{};

// Round 108: the speed meter. The game's figures (the wiki's Sprinting and Walking pages): sprinting
// 5.612 blocks/s, walking 4.317 - 0.2806 and 0.21585 blocks a 50-ms tick.
const keysBot=()=>{const keys={forward:true,sprint:true,jump:false};
 return {keys,entity:{position:new Vec3(0.5,64,0.5),onGround:true,isInWater:false},getControlState:k=>!!keys[k]};};

test('round 108: the 5-minute speed line measures sprinting, the flat stretch and walking against the game',()=>{
 assert.equal(GAME_SPRINT,5.612);assert.equal(GAME_WALK,4.317);assert.equal(CHAIN_SPRINT,GAME_SPRINT);
 const bot=keysBot(),st=newSpeed();let t=0;
 const step=(dx)=>{t+=50;bot.entity.position=bot.entity.position.offset(dx,0,0);return speedTick(bot,st,t);};
 assert.equal(speedTick(bot,st,t),null);
 // 10 s of flat sprinting at the game's speed
 for(let i=0;i<200;i++)assert.equal(step(GAME_SPRINT/20),null);
 // a 2-tick lag spike and a 30-block teleport are not steps
 t+=500;bot.entity.position=bot.entity.position.offset(1,0,0);speedTick(bot,st,t);
 step(30);
 // 5 s of walking
 bot.keys.sprint=false;
 for(let i=0;i<100;i++)step(GAME_WALK/20);
 // standing still with no forward key: not counted
 bot.keys.forward=false;for(let i=0;i<40;i++)step(0);
 const line=speedTick(bot,st,SPEED_LOG_MS+1);
 assert.match(line,/^Speed: sprinting 5\.61 blocks\/s over 10 s \(100% of the game sprint 5\.612\), on the flat 5\.61 over (9|10) s \(100%\), best 1 s 5\.61 \(100%\); walking 4\.32 over 5 s \(the game walk 4\.317\)$/);
 assert.equal(st.sprint.s,0,'reset');
 assert.ok(st.last,'the last position carries over');
});

test('round 108: a slow sprint shows up against the game figure; jumps and slopes stay off the flat',()=>{
 const bot=keysBot(),st=newSpeed();let t=0;speedTick(bot,st,t);
 // sprint key down but only 3.0 blocks/s (blocked, pushing into a mob)
 for(let i=0;i<100;i++){t+=50;bot.entity.position=bot.entity.position.offset(0.15,0,0);speedTick(bot,st,t);}
 // a sprint-jump stretch: y changing, jump key down - sprinting, not the flat
 bot.keys.jump=true;
 for(let i=0;i<40;i++){t+=50;bot.entity.position=bot.entity.position.offset(0.356,i%2?0.4:-0.4,0);speedTick(bot,st,t);}
 const line=speedTick(bot,st,SPEED_LOG_MS+1);
 assert.match(line,/^Speed: sprinting [34]\.\d\d blocks\/s over 7 s \(\d+% of the game sprint 5\.612\), on the flat 3\.00 over 4 s \(53%\), best 1 s 3\.00 \(53%\); walking 0\.00 over 0 s/);
 assert.ok(SPEED_SETTLE>0);
 // in water: nothing counted
 const w=keysBot(),s2=newSpeed();w.entity.isInWater=true;let u=0;speedTick(w,s2,u);
 for(let i=0;i<40;i++){u+=50;w.entity.position=w.entity.position.offset(0.1,0,0);speedTick(w,s2,u);}
 assert.equal(speedTick(w,s2,SPEED_LOG_MS+1),null,'no land movement: no line');
});

const mob=(id,name,x,z=0.5)=>({id,name,type:'hostile',position:new Vec3(x,71,z),isValid:true,height:1.95});
function fleeBot(entities){
 const keys={forward:true,sprint:true};
 return {keys,entity:{position:new Vec3(0.5,71,0.5),onGround:true},entities,health:6,food:16,
  inventory:{items:()=>[{name:'stone_sword',count:1,slot:36}],slots:[]},registry:{foodsByName:{}},time:{timeOfDay:6000},heldItem:{name:'stone_sword'},
  getControlState:k=>!!keys[k],
  blockAt:p=>({name:'air',boundingBox:'empty',position:p.floored(),skyLight:15})};
}
test('round 108: every flee of a second or more logs how far and how fast it ran, against the game sprint',()=>{
 assert.equal(FLEE_METER_MIN,1);
 const bot=fleeBot({7:mob(7,'zombie',-5.5)}),logs=[],m=new MobDefenseChain();
 const ctx={config:{chains:{}},move:{},trackers:{},blacklist:{},worker:{log:x=>logs.push(x)}};
 let t=100;m.now=()=>t;
 assert.equal(m.priority(bot,ctx),70,'health 6: the vulnerable flee');
 // 2 s of running east at 2.8 blocks/s, the sprint key down half the ticks
 for(let i=1;i<=8;i++){t+=0.25;bot.keys.sprint=i%2===0;bot.entity.position=bot.entity.position.offset(0.7,0,0);bot.entities[7]=mob(7,'zombie',bot.entity.position.x-6-i*0.2);m.priority(bot,ctx);}
 assert.ok(!logs.some(l=>/^Speed:/.test(l)),'no line while the flee runs');
 // the zombie is gone: the flee ends and the meter logs it
 delete bot.entities[7];t+=0.25;bot.entity.position=bot.entity.position.offset(0.7,0,0);
 assert.equal(m.priority(bot,ctx),-1);
 const line=logs.find(l=>/^Speed:/.test(l));
 assert.equal(line,'Speed: the RunAwayFromHostilesTask ran 6.3 blocks (straight 6.3) in 2.3 s = 2.80 blocks/s, 50% of the game sprint 5.612 (walk 4.317); sprint key 50% and forward 100% of 8 ticks, food 16; nearest hostile zombie 6.0 -> none');
 // a flee under FLEE_METER_MIN logs nothing
 const b2=fleeBot({7:mob(7,'zombie',-5.5)}),l2=[],m2=new MobDefenseChain();let u=0;m2.now=()=>u;
 const c2={...ctx,worker:{log:x=>l2.push(x)}};
 m2.priority(b2,c2);u+=0.5;m2.priority(b2,c2);delete b2.entities[7];u+=0.25;m2.priority(b2,c2);
 assert.ok(!l2.some(l=>/^Speed:/.test(l)));
});

test('round 108: a flee that turns into the stand logs its speed - the stand line first',()=>{
 // the round-106 hard3 shape: the spider stays 1.5 behind a flee that barely moves
 const bot=fleeBot({5:mob(5,'spider',2.0)}),logs=[],m=new MobDefenseChain();
 bot.health=17;
 const ctx={config:{chains:{}},move:{},trackers:{},blacklist:{},worker:{log:x=>logs.push(x)}};
 let t=0;m.now=()=>t;
 for(let i=0;i<4;i++){m.priority(bot,ctx);t+=0.5;bot.entity.position=bot.entity.position.offset(0.2,0,0);bot.entities[5]=mob(5,'spider',bot.entity.position.x+1.5);}
 const i=logs.findIndex(l=>/standing to fight$/.test(l)),j=logs.findIndex(l=>/^Speed:/.test(l));
 assert.ok(i>=0&&j>i,logs.join('\n'));
 assert.match(logs[j],/^Speed: the RunAwayFromHostilesTask ran 0\.\d blocks \(straight 0\.\d\) in 1\.\d s = 0\.\d\d blocks\/s, \d+% of the game sprint 5\.612/);
});
