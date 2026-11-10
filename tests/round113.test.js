import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Vec3} from 'vec3';
import {MobDefenseChain} from '../src/chains/mobDefenseChain.js';
import {leaveAlone,getHostiles,endermanAngry} from '../src/chains/combatPolicy.js';
import {forceFieldTick} from '../src/forcefield.js';
import {installEndermanWatch,lookOffEyes,ENDER_EYE} from '../src/provoked.js';
console.error=()=>{};

// Round 113: the round-112 soak's hard2 - a calm enderman 1.8-2.0 from the bot for 6 s while its
// health rose 9 -> 14; the 2-block rule made it a threat, `cornered - fighting back` hit it, and it
// answered 14 -> 3.5 -> 0 (`slain by Enderman`). An enderman attacks only a player who stares at
// its eyes or hits it first: a calm one is left alone at any distance.
const mob=(id,name,x,z=0.5,meta)=>({id,name,type:'hostile',position:new Vec3(x,71,z),isValid:true,height:name==='enderman'?2.9:1.95,metadata:meta||[]});
const ANGRY=()=>{const m=[];m[17]=true;return m;};
function pinnedBot(entities,health=12.9){
 return {entity:{position:new Vec3(0.5,71,0.5),onGround:true},entities,health,food:16,
  inventory:{items:()=>[{name:'stone_sword',count:1,slot:36}],slots:[]},
  registry:{foodsByName:{}},time:{timeOfDay:18000},heldItem:{name:'stone_sword'},
  blockAt:p=>({name:'air',boundingBox:'empty',position:p.floored(),skyLight:0})};
}
const chainCtx=logs=>({config:{chains:{}},move:{},trackers:{},blacklist:{},worker:{log:m=>{if(!/^Speed: /.test(m))logs.push(m);}}});

test('round 113: a calm enderman beside a pinned, chased flee is never the cornered or stand target',()=>{
 assert.equal(endermanAngry(mob(1,'enderman',2)),false);assert.equal(endermanAngry(mob(1,'enderman',2,0.5,ANGRY())),true);
 // the death-2 shape: a zombie 6 away keeps the flee on, a calm enderman 2.0 then 0.4 from the bot
 const ender=mob(9,'enderman',2.5),bot=pinnedBot({7:mob(7,'zombie',-5.5),9:ender}),logs=[],m=new MobDefenseChain(),ctx=chainCtx(logs);
 assert.equal(leaveAlone(ender,bot),true);
 assert.deepEqual(getHostiles(bot,ctx).map(e=>e.name),['zombie'],'not a threat at 2.0');
 let t=1000;m.now=()=>t;
 for(let i=0;i<12;i++){
  const p=m.priority(bot,ctx);
  assert.notEqual(p,85,'never the cornered fight: '+logs.join(' | '));
  assert.notEqual(m.root?.name,'KillEntitiesTask');
  t+=0.25;bot.entities[9]=mob(9,'enderman',bot.entity.position.x+(i<6?2.0:0.4));
 }
 assert.ok(!logs.some(l=>/cornered|standing to fight/.test(l)),logs.join('\n'));
 // the same enderman screaming: it is coming - the cornered fight answers it
 const b2=pinnedBot({9:mob(9,'enderman',2.5,0.5,ANGRY())}),l2=[],m2=new MobDefenseChain(),c2=chainCtx(l2);
 let u=1000;m2.now=()=>u;
 for(let i=0;i<14&&!l2.some(l=>/cornered|standing to fight/.test(l));i++){m2.priority(b2,c2);u+=0.25;}
 assert.ok(l2.some(l=>/enderman 2\.0 away .*(cornered - fighting back|standing to fight)/.test(l)),l2.join('\n'));
});

test('round 113: the force field never swings at a calm enderman, even one carrying a block',()=>{
 const swings=[];
 const mk=meta=>{
  const e=mob(9,'enderman',2.5,0.5,meta);
  return {entity:{position:new Vec3(0.5,71,0.5),height:1.8},entities:{9:e},heldItem:{name:'stone_sword'},
   inventory:{items:()=>[{name:'stone_sword',count:1,slot:36,type:1}],slots:[]},registry:{itemsByName:{}},
   world:{raycast:()=>null},blockAt:()=>({name:'air',boundingBox:'empty'}),
   lookAt:async()=>{},equip:async()=>{},attack:t=>{swings.push(t.id);}};
 };
 const worker={ready:true,reflexEnabled:true,taskRunner:{status:()=>({task:null,chain:null})}};
 const carrying=[];carrying[16]=1; // metadata 16 is the carried block - state id 1 read as provoked before
 forceFieldTick(mk(carrying),worker);
 forceFieldTick(mk([]),worker);
 assert.deepEqual(swings,[],'calm: no swing');
 forceFieldTick(mk(ANGRY()),worker);
 assert.deepEqual(swings,[9],'angry: the force field answers it');
});

test('round 113: the moment an enderman turns angry is logged once, with the look and the last swing',()=>{
 assert.equal(ENDER_EYE,2.55);
 const logs=[],bot=new EventEmitter();
 bot.entity={position:new Vec3(0.5,64,0.5),yaw:0,pitch:0};
 bot.attack=t=>t.id;
 installEndermanWatch(bot,m=>logs.push(m));
 // 20 blocks north (-z), level with the bot: a level look straight at it is a stare (cos 0.9989 > 1 - 0.025/20)
 const e=mob(9,'enderman',0.5,-19.5);e.position=new Vec3(0.5,64,-19.5);
 const o=lookOffEyes(bot,e);
 assert.ok(o.stare&&o.deg<3,JSON.stringify(o));
 bot.emit('entityUpdate',e);assert.equal(logs.length,0,'calm: nothing');
 e.metadata=ANGRY();bot.emit('entityUpdate',e);bot.emit('entityUpdate',e);
 assert.equal(logs.length,1);
 assert.match(logs[0],/^Enderman: the one at \(0, 64, -20\) \(20\.\d away\) turned angry; the bot's look was \d\.\d deg off its eyes \(a stare\); last swung at it never$/);
 // calm again, then hit and angry: the swing is named; looking away is not a stare
 e.metadata=[];bot.emit('entityUpdate',e);
 bot.entity.yaw=Math.PI;bot.attack(e);
 e.metadata=ANGRY();bot.emit('entityUpdate',e);
 assert.equal(logs.length,2);
 assert.match(logs[1],/look was 1\d\d\.\d deg off its eyes; last swung at it 0\.\d s ago$/);
 assert.equal(lookOffEyes(bot,e).stare,false);
});
