import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';
import {MobDefenseChain,canHeal,FLEE_STALL_S,FLEE_STALL_OFF} from '../src/chains/mobDefenseChain.js';
import {watchToolLoss} from '../src/toolWear.js';

// Round 75: the round-74 soak on the Nitrous world copy.
const zombie=(x)=>({id:7,name:'zombie',type:'hostile',position:new Vec3(x,64,0),isValid:true});
function hurtBot({food=6,items=[]}={}){
 return {entity:{position:new Vec3(0,64,0)},entities:{7:zombie(12)},health:6,food,
  inventory:{items:()=>items,slots:[]},registry:{foodsByName:{bread:{foodPoints:5},spider_eye:{foodPoints:2}}},
  time:{timeOfDay:6000},heldItem:null,blockAt:()=>null};
}
const chainCtx=logs=>({config:{chains:{}},move:{},trackers:{},blacklist:{},worker:{log:m=>logs.push(m)}});
test('round 75: the recovering hold is only for a bot that can heal',()=>{
 assert.equal(canHeal(hurtBot()),false,'bar 6, nothing to eat');
 assert.equal(canHeal(hurtBot({items:[{name:'spider_eye',count:3}]})),false,'unsafe food does not count');
 assert.equal(canHeal(hurtBot({items:[{name:'bread',count:2}]})),true);
 assert.equal(canHeal(hurtBot({food:18})),true,'a bar of 18 regenerates');
 // round-74 hard1: 6.3 health, food 6, no food, a hostile 12 away - no hold, the paused job runs
 const logs=[],m=new MobDefenseChain();
 assert.equal(m.priority(hurtBot(),chainCtx(logs)),-1);
 assert.ok(!logs.some(l=>/still recovering/.test(l)));
 const fed=new MobDefenseChain(),fl=[];
 assert.equal(fed.priority(hurtBot({items:[{name:'bread',count:2}]}),chainCtx(fl)),60,'with bread it holds back to recover');
 assert.match(fl[0],/still recovering/);
});

test('round 75: a flee hold that has not moved the bot in 20 s stands down',()=>{
 const bot=hurtBot({items:[{name:'bread',count:2}]}),logs=[],m=new MobDefenseChain(),ctx=chainCtx(logs);
 let t=1000;m.now=()=>t;
 assert.equal(m.priority(bot,ctx),60);
 for(let i=0;i<19;i++){t+=1;assert.equal(m.priority(bot,ctx),60,'not yet 20 s');}
 t+=1.5;assert.equal(m.priority(bot,ctx),-1);
 assert.equal(logs.at(-1),'Reflex: the KeepDistanceTask held '+FLEE_STALL_S+' s without moving the bot (health 6, food 6, nothing within 8 in sight); standing down for '+FLEE_STALL_OFF+' s');
 t+=30;assert.equal(m.priority(bot,ctx),-1,'still standing down');
 // a zombie within 8 in sight ends the stand-down at once
 bot.entities[7]=zombie(6);
 assert.equal(m.priority(bot,ctx),70);
 bot.entities[7]=zombie(12);
 t+=1;assert.equal(m.priority(bot,ctx),60,'the hold is back');
 // a bot that keeps moving is never stood down
 const run=hurtBot({items:[{name:'bread',count:2}]}),rm=new MobDefenseChain(),rl=[];let rt=0;rm.now=()=>rt;
 for(let i=0;i<40;i++){rt+=1;run.entity.position=new Vec3((i%2)*4,64,0);run.entities[7]=zombie(run.entity.position.x+12);assert.ok(rm.priority(run,chainCtx(rl))>=0);}
 assert.ok(!rl.some(l=>/standing down/.test(l)));
 // the round-74 hard2 shape: the vulnerable run-away cached on, nothing near any more
 const v=hurtBot(),vm=new MobDefenseChain(),vl=[];let vt=0;vm.now=()=>vt;v.health=17;
 v.entities[7]=zombie(6);assert.equal(vm.priority(v,chainCtx(vl)),70);
 v.entities[7]=zombie(20);
 for(let i=0;i<20;i++){vt+=1;vm.priority(v,chainCtx(vl));}
 vt+=1.5;assert.equal(vm.priority(v,chainCtx(vl)),-1);
 assert.match(vl.at(-1),/^Reflex: the RunAwayFromHostilesTask held 20 s without moving the bot \(health 17, food 6/);
});

function sumpWorker(start,origin,{blocks=()=>({name:'air',boundingBox:'empty'})}={}){
 const logs=[],pillars=[],walks=[];
 const bot={entity:{position:start.clone(),onGround:true},pathfinder:{movements:{},setMovements(){}},look:async()=>{},clearControlStates(){},
  blockAt:p=>blocks(p),setControlState(){}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,log:m=>logs.push(m),check(){},exploreMovements:()=>({}),
  climbTunnel:async()=>{},navigate:async()=>{throw Error('Took to long to decide path to goal!');},
  pillarUp:async y=>{pillars.push({from:bot.entity.position.floored().y,onGround:bot.entity.onGround});bot.entity.position=new Vec3(origin.x+0.5,y,origin.z+0.5);return true;}});
 return {w,bot,logs,pillars,walks};
}
test('round 75: the step into the box drops down the open sump; the bot lands, then pillars up',async()=>{
 const origin=new Vec3(814,81,-580);
 const {w,bot,logs,pillars}=sumpWorker(new Vec3(815.5,81,-579.5),origin);
 // forward carries it over the open floor: in the cell for a moment, then falling, landing at y=79
 bot.setControlState=(n,v)=>{if(n==='forward'&&v){bot.entity.position=new Vec3(814.5,81,-579.5);bot.entity.onGround=false;
  setTimeout(()=>{bot.entity.position=new Vec3(814.5,80.4,-579.5);},200);
  setTimeout(()=>{bot.entity.position=new Vec3(814.5,79,-579.5);bot.entity.onGround=true;},400);}};
 assert.equal(await w.nightMineReturn({id:'n',tunnel:[]},0,origin),true);
 assert.equal(logs[1],'Night mine: one step from the shelter at (815, 81, -580); stepping in');
 assert.equal(logs.at(-1),'Night mine: pillaring up the sump from y=79');
 assert.deepEqual(pillars,[{from:79,onGround:true}],'from the bottom, on the ground - not mid-fall');
});
test('round 75: from the corner beside the box, the bot steps in through an open side cell',async()=>{
 const origin=new Vec3(816,100,-468),side=new Vec3(816,100,-469);
 const open=p=>p.x===side.x&&p.z===side.z&&(p.y===100||p.y===101);
 const {w,bot,logs}=sumpWorker(new Vec3(817.5,100,-468.5),origin,{blocks:p=>open(p)?{name:'air',boundingBox:'empty'}:{name:'stone',boundingBox:'block'}});
 const walked=[];
 w.walkTunnelBack=async path=>{walked.push(path.map(String));bot.entity.position=new Vec3(816.5,100,-467.5);return true;};
 assert.equal(await w.nightMineReturn({id:'n',tunnel:[]},0,origin),true);
 assert.equal(logs[1],'Night mine: one step from the shelter at (817, 100, -469) (through (816, 100, -469)); stepping in');
 assert.deepEqual(walked,[[String(origin),String(side)]]);
 // both side cells are box wall: no step through them
 const shut=sumpWorker(new Vec3(817.5,100,-468.5),origin,{blocks:()=>({name:'stone',boundingBox:'block'})});
 shut.w.walkTunnelBack=async()=>false;
 assert.equal(await shut.w.nightMineReturn({id:'n',tunnel:[]},0,origin),false);
 assert.ok(!shut.logs.some(l=>/stepping in/.test(l)));
});

test('round 75: an equip moving a tool between slots is not a tool loss',async()=>{
 const inv=new EventEmitter();let items=[];inv.items=()=>items;
 const b={inventory:inv,health:20,registry:{itemsByName:{stone_sword:{maxDurability:131}}}};
 const logs=[];watchToolLoss(b,m=>logs.push(m),{settleMs:40});
 const sword={name:'stone_sword',slot:36,durabilityUsed:6};
 inv.emit('updateSlot',36,sword,null); // the old slot empties first
 items=[{...sword,slot:37}]; // then the hand slot fills
 await new Promise(r=>setTimeout(r,80));
 assert.deepEqual(logs,[]);
 items=[];inv.emit('updateSlot',37,{...sword,slot:37},null);
 await new Promise(r=>setTimeout(r,80));
 assert.equal(logs.length,1);assert.match(logs[0],/^Tool left the inventory: stone_sword/);
});
