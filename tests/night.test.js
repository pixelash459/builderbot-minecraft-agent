// Cloud round 5, task 1: night survival in the dark forest (round-4 soak: 'Pause trace:
// shelter -> Reflex: preempted by Mob Defense', dozens of hostiles fled at once, shot by
// skeletons twice during the shelter). One test per decision: the sunset start, the sealed
// box, staying in it, the gate, the night crowd pillar, and the respawn-at-night shelter.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {Vec3} from 'vec3';
import {SUNSET,DUSK_PREP,shelterDue,nightJobFor,shelterShell,shellGaps,placementPlan,shelterTarget,insideShelter,nightRefuge,pillarRoom,fleeHeading,deepWaterCost} from '../src/night.js';
import {Worker} from '../src/worker.js';
import {Autopilot,NIGHT_RETRIES} from '../src/autopilot.js';
import {MobDefenseChain} from '../src/chains/mobDefenseChain.js';
import {FoodChain} from '../src/chains/foodChain.js';
import {NightPillarTask,RunAwayFromHostilesTask} from '../src/chains/fallbackTasks.js';
import {headingOf} from '../src/heading.js';
console.error=()=>{};
const k=(x,y,z)=>x+','+y+','+z;
// A block world: ground at y=-61 over x,z in [-6,6] unless told otherwise; air elsewhere.
function makeWorld({ground=true,extra={}}={}){
 const cells=new Map();
 const set=(x,y,z,name)=>cells.set(k(x,y,z),name);
 if(ground)for(let x=-6;x<=6;x++)for(let z=-6;z<=6;z++)set(x,-61,z,'grass_block');
 for(const [key,name] of Object.entries(extra))cells.set(key,name);
 const blockAt=(x,y,z)=>{
  const name=cells.get(k(x,y,z))||'air';
  return {name,position:new Vec3(x,y,z),boundingBox:/^(air|water|lava|short_grass)$/.test(name)?'empty':'block'};
 };
 return {cells,set,blockAt,at:p=>blockAt(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z))};
}
// ---- the clock ----------------------------------------------------------------------------
test('the shelter is due at sunset (12000); a bed waits for 12541; dusk dirt starts at 10000',()=>{
 assert.equal(SUNSET,12000);assert.equal(DUSK_PREP,10000);
 assert.equal(shelterDue(11999),false);
 assert.equal(shelterDue(12000),true);
 assert.equal(shelterDue(23000),true);
 assert.equal(shelterDue(500),false);
 assert.deepEqual(nightJobFor(12000,false),{type:'shelter'});
 assert.equal(nightJobFor(12000,true),null,'a bed cannot be used before 12541');
 assert.deepEqual(nightJobFor(12541,true),{type:'sleep'});
 assert.equal(nightJobFor(6000,false),null);
});
// ---- the shell ------------------------------------------------------------------------------
test('the shell encloses the bot: feet ring, head ring, full roof and the floor',()=>{
 const {required,support}=shelterShell({x:0,y:-60,z:0});
 assert.equal(required.length,26,'8 feet + 8 head + 9 roof + floor');
 const has=(x,y,z)=>required.some(c=>c.x===x&&c.y===y&&c.z===z);
 for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){
  assert.ok(has(dx,-60,dz)&&has(dx,-59,dz),'feet and head ring at '+dx+','+dz);
 }
 for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)assert.ok(has(dx,-58,dz),'roof '+dx+','+dz);
 assert.ok(has(0,-61,0),'floor under the feet');
 assert.ok(!has(0,-60,0)&&!has(0,-59,0),'the bot cells stay open');
 assert.equal(support.length,8);
});
test('placement passes anchor every cell on flat ground; a pillar top needs the support ring',()=>{
 const flat=makeWorld();
 const {required,support}=shelterShell({x:0,y:-60,z:0});
 const {plan,stuck}=placementPlan(flat.blockAt,required);
 assert.equal(stuck.length,0);assert.equal(plan.length,25,'the floor is already solid');
 // Roof centre anchors on a roof edge placed earlier in the same pass.
 const roof=plan.findIndex(p=>p.cell.x===0&&p.cell.y===-58&&p.cell.z===0);
 assert.ok(roof>0&&plan.slice(0,roof).some(p=>p.cell.y===-58),'roof centre after a roof edge');
 // Pillar top: only the column under the bot exists.
 const col=makeWorld({ground:false,extra:{[k(0,-61,0)]:'cobblestone',[k(0,-62,0)]:'cobblestone'}});
 const top=placementPlan(col.blockAt,required);
 assert.equal(top.plan.length,0,'nothing anchors the box on a pillar top');
 const sup=placementPlan(col.blockAt,support.filter(c=>top.stuck.some(g=>g.x===c.x&&g.z===c.z&&g.y===c.y+1)));
 assert.ok(sup.plan.length>=4,'the support ring grows off the column');
});
// A shelter-capable fake worker over a block world.
function shelterWorker(world,{entities={},items=[{name:'cobblestone',count:40}],tod=12100}={}){
 const placed=[],attacks=[],logs=[];
 const inv=items.map((i,n)=>({...i,slot:36+n}));
 const bot={
  time:{timeOfDay:tod,day:3},entity:{position:new Vec3(0.5,-60,0.5),height:1.8},entities,heldItem:null,
  registry:{itemsByName:{cobblestone:{},dirt:{},cobbled_deepslate:{},netherrack:{}},blocksByName:{dirt:{id:1},grass_block:{id:2}}},
  inventory:{items:()=>inv.filter(i=>i.count>0)},
  blockAt:p=>world.at(p),
  equip:async item=>{bot.heldItem=item;},
  placeBlock:async(ref,face)=>{
   const t=ref.position.plus(face);
   const item=inv.find(i=>i.name===bot.heldItem?.name&&i.count>0);
   if(!item)throw Error('nothing held');
   world.set(t.x,t.y,t.z,item.name);item.count--;placed.push(k(t.x,t.y,t.z));
  },
  lookAt:async()=>{},
  attack:async e=>{attacks.push(e.name);if(e.dies)delete entities[e.id];},
  dig:async bl=>{world.set(bl.position.x,bl.position.y,bl.position.z,'air');}
 };
 const w=Object.assign(Object.create(Worker.prototype),{bot,check(){},log:m=>logs.push(m),save(){},update(){}});
 return {w,bot,placed,attacks,logs,inv};
}
const zombieAt=(id,x,y,z,extra={})=>({id,name:'zombie',type:'hostile',position:new Vec3(x,y,z),height:1.95,width:0.6,isValid:true,...extra});
test('the box is sealed on flat ground: every required cell solid, nothing built at the bot',async()=>{
 const world=makeWorld();
 const {w,placed}=shelterWorker(world);
 const job={spec:{type:'shelter'},placed:[]};
 await w.sealShelter(job,0,new Vec3(0,-60,0));
 assert.equal(shellGaps(world.blockAt,shelterShell({x:0,y:-60,z:0}).required).length,0);
 assert.equal(placed.length,25);
 assert.ok(!placed.includes(k(0,-60,0))&&!placed.includes(k(0,-59,0)));
 assert.equal(job.placed.length,25,'every placement is recorded for the dawn cleanup');
});
test('a zombie standing in a ring cell is hit, never built into; the cell closes once it is gone',async()=>{
 const world=makeWorld();
 const entities={};
 entities[7]=zombieAt(7,1.5,-60,0.5,{dies:true});
 const {w,placed,attacks}=shelterWorker(world,{entities});
 await w.sealShelter({placed:[]},0,new Vec3(0,-60,0));
 assert.deepEqual(attacks,['zombie']);
 assert.ok(placed.includes(k(1,-60,0)),'placed after the zombie died');
 assert.equal(shellGaps(world.blockAt,shelterShell({x:0,y:-60,z:0}).required).length,0);
});
test('a box that cannot close fails with the open cell instead of waiting in a hole',async()=>{
 const world=makeWorld();
 // A cow (1.4 high) fills the feet and the head cell of the ring.
 const entities={7:{id:7,name:'cow',type:'passive',position:new Vec3(1.5,-60,0.5),height:1.4,width:0.9}};
 const {w}=shelterWorker(world,{entities});
 await assert.rejects(w.sealShelter({placed:[]},0,new Vec3(0,-60,0)),/Could not seal the shelter: 2 open cells, first at 1,-60,0/);
});
test('sealed: only a mob inside or at a gap is hit; a mob outside a closed wall is left alone',()=>{
 const o={x:0,y:-60,z:0};
 const outside=zombieAt(1,2.5,-60,0.5);
 assert.equal(shelterTarget([outside],o,[]),null,'no gap, no swing, no flee');
 const gap=[{x:1,y:-59,z:0}];
 const t=shelterTarget([outside],o,gap);
 assert.ok(t&&t.entity===outside&&!t.inside,'a zombie at the head-height gap');
 const inside=zombieAt(2,0.6,-60,0.4);
 assert.equal(insideShelter(inside.position,o),true);
 assert.equal(shelterTarget([outside,inside],o,gap).entity,inside,'the one inside comes first');
 const far=zombieAt(3,6.5,-60,0.5);
 assert.equal(shelterTarget([far],o,[{x:1,y:-60,z:0}]),null,'out of reach');
});
test('the guard re-seals a gap, and strikes a mob standing at it first',async()=>{
 const world=makeWorld();
 const entities={};
 const {w,attacks,placed}=shelterWorker(world,{entities});
 const job={placed:[]};
 await w.sealShelter(job,0,new Vec3(0,-60,0));
 world.set(1,-59,0,'air'); // a creeper blast took a head-height block
 entities[9]=zombieAt(9,2.5,-60,0.5);
 await w.guardShelter(job,0,new Vec3(0,-60,0));
 assert.deepEqual(attacks,['zombie'],'hit through the gap first');
 delete entities[9];
 const before=placed.length;
 await w.guardShelter(job,0,new Vec3(0,-60,0));
 assert.equal(placed.length,before+1,'then re-sealed');
 assert.equal(world.blockAt(1,-59,0).boundingBox,'block');
});
// ---- the survival gate ------------------------------------------------------------------------
function gateBot(){
 const bot=new EventEmitter();
 Object.assign(bot,{entities:{},health:20,food:20,time:{timeOfDay:14000,day:3},
  clearControlStates(){},setControlState(){},entity:{onGround:true,position:new Vec3(0,-60,0),metadata:[0],height:1.8},
  pathfinder:{movements:null,setGoal(){},stop(){},setMovements(m){this.movements=m;},goto(){return new Promise(()=>{});}},
  registry:{blocksByName:{},foodsByName:{bread:{foodPoints:5,saturation:6}},itemsByName:{}},inventory:{items(){return [];},emptySlotCount(){return 36;},slots:[]},
  blockAt(){return null;},findBlock(){return null;},findBlocks(){return [];},stopDigging(){return {catch(){}};},respawn(){}});
 return bot;
}
async function withWorker(fn){
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'night-'));
 const worker=new Worker(root,{limits:{minHealth:10,minFood:6,jobMinutes:5}});
 const bot=gateBot();worker.ready=true;worker.bot=bot;worker.movements={id:'normal'};worker.log=()=>{};
 try{await fn({worker,bot,root});}finally{fs.rmSync(root,{recursive:true,force:true});}
}
const gated=(worker,name)=>worker.taskRunner.chains.find(c=>c.name===name);
test('a running shelter keeps Mob Defense off whatever stands outside; world threats still win',async()=>{
 await withWorker(async({worker,bot})=>{
  for(let i=0;i<8;i++)bot.entities[10+i]={id:10+i,name:i%2?'skeleton':'zombie',type:'hostile',position:new Vec3(3+i,-60,1),isValid:true,height:1.9};
  const ctx=worker.taskRunner.ctx;
  assert.ok(gated(worker,'Mob Defense').priority(bot,ctx)>=0,'no shelter: Mob Defense answers the crowd');
  worker.jobs.push({id:'s',spec:{type:'shelter'},status:'running',message:'Working'});
  worker.shelterSealed=true;
  assert.equal(gated(worker,'Mob Defense').priority(bot,ctx),-1,'sealed: no flee, no fight');
  // Drowning in the shelter (a flooded box): the world chain still answers.
  bot.entity.isInWater=true;bot.oxygenLevel=4;
  assert.equal(gated(worker,'Misc World Survival Chain').priority(bot,ctx),97);
 });
});
test('the gate holds for a shelter queued behind a reflex-paused day job (array order no longer decides)',async()=>{
 await withWorker(async({worker,bot})=>{
  bot.entities[10]={id:10,name:'zombie',type:'hostile',position:new Vec3(3,-60,0),isValid:true,height:1.9};
  worker.jobs.push({id:'g',spec:{type:'gather',block:'log',count:3},status:'queued',message:'Resuming'});
  worker.jobs.push({id:'s',spec:{type:'shelter'},status:'queued',message:'Waiting'});
  assert.equal(gated(worker,'Mob Defense').priority(bot,worker.taskRunner.ctx),-1);
  assert.equal(worker.survivalHold().job.id,'s');
  // The pump runs the shelter first even though the gather sits earlier in the queue.
  const started=[];worker.run=async job=>{started.push(job.spec.type);};
  await worker.pump();
  worker.ready=false; // no re-pump after the test
  assert.equal(started[0],'shelter');
 });
});
test('a sealed shelter lets the Food chain eat (the real inventory stack is equipped)',async()=>{
 await withWorker(async({worker,bot})=>{
  const bread={name:'bread',count:4,slot:37};
  bot.inventory.items=()=>[bread];bot.food=8;bot.health=8;
  const equipped=[];let ate=0;
  bot.equip=async item=>{equipped.push(item);};bot.consume=async()=>{ate++;};
  worker.jobs.push({id:'s',spec:{type:'shelter'},status:'running',message:'Waiting for morning'});
  const food=gated(worker,'Food');
  worker.shelterSealed=false;
  assert.equal(food.priority(bot,worker.taskRunner.ctx),-1);
  await new Promise(r=>setImmediate(r));
  assert.equal(ate,0,'still building: no eating');
  worker.shelterSealed=true;
  assert.equal(food.priority(bot,worker.taskRunner.ctx),-1,'eating is a side effect, never a band');
  for(let i=0;i<3;i++)await new Promise(r=>setImmediate(r));
  assert.equal(ate,1);
  assert.equal(equipped[0],bread,'the stack itself: a bare {name} made mineflayer equip throw');
 });
});
// ---- caught outside ---------------------------------------------------------------------------
const crowd=n=>Array.from({length:n},(_,i)=>({name:'zombie',position:{x:4+i,y:-60,z:2-i}}));
test('caught outside after dark in a crowd: pillar up 3, not a sprint through the pack',()=>{
 const me={x:0.5,y:-60,z:0.5};
 assert.deepEqual(nightRefuge({tod:14000,me,hostiles:crowd(4),blocks:10,room:3}),{action:'pillar',height:3,crowd:4});
 assert.equal(nightRefuge({tod:6000,me,hostiles:crowd(4),blocks:10,room:3}),null,'daytime: they burn');
 assert.equal(nightRefuge({tod:14000,me,hostiles:crowd(4),blocks:2,room:3}),null,'2 blocks are not a 3-pillar');
 assert.equal(nightRefuge({tod:14000,me,hostiles:crowd(4),blocks:10,room:1}),null,'a low ceiling');
 assert.equal(nightRefuge({tod:14000,me,hostiles:crowd(4),blocks:10,room:3,inFluid:true}),null);
 assert.equal(nightRefuge({tod:14000,me,hostiles:crowd(2),blocks:10,room:3,fightAllowed:true}),null,'two zombies and a fight allowed: fight');
 assert.ok(nightRefuge({tod:14000,me,hostiles:crowd(1),blocks:10,room:3,fightAllowed:false}),'a lone mob the policy refuses');
 assert.equal(nightRefuge({tod:14000,me,hostiles:[{name:'spider',position:{x:0.9,y:-60,z:0.5}},...crowd(3)],blocks:10,room:3}),null,'a mob on the column climbs with us');
});
test('pillarRoom needs a floor and three open cells above the head',()=>{
 const w=makeWorld();
 assert.equal(pillarRoom(w.blockAt,0,-60,0,3),3);
 w.set(0,-57,0,'oak_leaves');
 assert.equal(pillarRoom(w.blockAt,0,-60,0,3),1);
 assert.equal(pillarRoom(makeWorld({ground:false}).blockAt,0,-60,0,3),0,'no floor');
});
function nightBot(world,{hostiles=[],items=[{name:'cobblestone',count:12}],tod=14000,shield=false}={}){
 const inv=items.map((i,n)=>({...i,slot:36+n}));
 const calls=[];
 const bot={
  health:20,food:20,time:{timeOfDay:tod,day:3},
  entity:{id:1,position:new Vec3(0.5,-60,0.5),onGround:true,yaw:0,height:1.8,metadata:[0]},
  entities:{},heldItem:null,
  inventory:{items:()=>inv,slots:shield?Object.assign([],{45:{name:'shield'}}):[]},
  registry:{blocksByName:{dirt:{id:1}},itemsByName:{},foodsByName:{}},
  blockAt:p=>world.at(p),
  setControlState:(n,v)=>calls.push(['control',n,v]),
  look:async(y,p)=>calls.push(['look',y,p]),
  equip:async item=>{calls.push(['equip',item.name]);bot.heldItem=item;},
  placeBlock:async(ref,face)=>{calls.push(['place',k(ref.position.x,ref.position.y,ref.position.z)]);const t=ref.position.plus(face);world.set(t.x,t.y,t.z,'cobblestone');},
  activateItem:()=>calls.push(['shield-up']),deactivateItem:()=>calls.push(['shield-down']),
  attack:e=>calls.push(['attack',e.name])
 };
 hostiles.forEach((h,i)=>{bot.entities[10+i]={id:10+i,type:'hostile',isValid:true,height:1.9,...h,position:new Vec3(...h.position)};});
 return {bot,calls};
}
test('Mob Defense pillars at night in a crowd and holds the perch above the fuse flee',()=>{
 const world=makeWorld();
 const {bot}=nightBot(world,{hostiles:[{name:'zombie',position:[4,-60,0]},{name:'zombie',position:[-4,-60,1]},{name:'skeleton',position:[0,-60,7]}]});
 const m=new MobDefenseChain();
 const ctx={config:{chains:{}},move:{},trackers:{},blacklist:{}};
 assert.equal(m.priority(bot,ctx),72);
 assert.ok(m.root instanceof NightPillarTask);
 // Daytime, same crowd: the ordinary ladder (no pillar).
 const day=new MobDefenseChain();
 bot.time.timeOfDay=3000;
 day.priority(bot,ctx);
 assert.ok(!(day.root instanceof NightPillarTask));
 // Perched: a creeper fusing at the base does not pull the bot down.
 bot.time.timeOfDay=14000;
 m.root.phase='perch';m.root.base={x:0,y:-60,z:0};bot.entity.position=new Vec3(0.5,-57,0.5);
 bot.entities[20]={id:20,name:'creeper',type:'hostile',isValid:true,height:1.7,position:new Vec3(1.5,-60,0.5),metadata:{16:1}};
 assert.equal(m.priority(bot,ctx),72);
 assert.ok(m.root instanceof NightPillarTask);
});
test('NightPillarTask climbs by placing under the feet at the apex, then shields toward an archer',()=>{
 const world=makeWorld();
 const {bot,calls}=nightBot(world,{hostiles:[{name:'skeleton',position:[0,-60,9]}],shield:true});
 const t=new NightPillarTask(3);
 t.onTick(bot);
 assert.ok(calls.some(c=>c[0]==='control'&&c[1]==='jump'&&c[2]===true),'jumping');
 assert.ok(calls.some(c=>c[0]==='equip'&&c[1]==='cobblestone'));
 for(let i=0;i<3;i++){
  bot.entity.position=new Vec3(0.5,-60+i+1.2,0.5);
  t.clickAt=-1e9;t.onTick(bot);
 }
 assert.deepEqual(calls.filter(c=>c[0]==='place').map(c=>c[1]),[k(0,-61,0),k(0,-60,0),k(0,-59,0)]);
 bot.entity.position=new Vec3(0.5,-57,0.5);
 t.onTick(bot);
 assert.equal(t.phase,'perch');
 // Round 7: the overhang ring goes down first (4 sides against the top, then 4 corners).
 for(let i=0;i<12&&!calls.some(c=>c[0]==='shield-up');i++){t.ringAt=-1e9;t.onTick(bot);}
 assert.equal(calls.filter(c=>c[0]==='place').length,3+8,'column + ring');
 for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]])assert.equal(world.blockAt(dx,-58,dz).name,'cobblestone',dx+','+dz);
 assert.ok(calls.some(c=>c[0]==='shield-up'),'shield toward the skeleton');
 assert.equal(t.isFinished(bot),false);
 // Round 7: the wrap to 0 is not morning - the skeleton (9 away) is still standing.
 bot.time.timeOfDay=500;
 assert.equal(t.isFinished(bot),false,'dawn: not light yet');
 bot.time.timeOfDay=1500;
 assert.equal(t.isFinished(bot),false,'light, but a skeleton within 16');
 bot.time.timeOfDay=3500;
 assert.equal(t.isFinished(bot),true,'late morning: a skeleton 9 away (shaded) no longer holds the perch');
 delete bot.entities[10];bot.time.timeOfDay=1500;
 assert.equal(t.isFinished(bot),true,'light and clear ends the perch');
});
test('round 7: the perched bot keeps its 3x3 deck, sneaks back to the middle, and falls only off the deck',()=>{
 const world=makeWorld();
 for(let y=-60;y<=-58;y++)world.set(0,y,0,'cobblestone');
 const {bot,calls}=nightBot(world,{});
 const t=new NightPillarTask(3,{hold:true});t.phase='perch';t.base={x:0,y:-60,z:0};
 bot.entity.position=new Vec3(0.5,-57,0.5);
 for(let i=0;i<12;i++){t.ringAt=-1e9;t.onTick(bot);}
 assert.ok(calls.some(c=>c[0]==='control'&&c[1]==='sneak'&&c[2]===true),'sneaking on the deck');
 assert.equal(world.blockAt(1,-58,1).name,'cobblestone','corners anchor on the sides');
 // Knocked onto the ring: still perched, walking back to the centre.
 calls.length=0;bot.entity.position=new Vec3(1.6,-57,0.5);
 t.onTick(bot);
 assert.equal(t.failed,false);
 assert.ok(calls.some(c=>c[0]==='control'&&c[1]==='forward'&&c[2]===true));
 const look=calls.find(c=>c[0]==='look');assert.ok(Math.abs(look[1]-Math.PI/2)<0.2,'facing -x, back to the middle');
 // Off the deck (two cells out): knocked off.
 bot.entity.position=new Vec3(2.5,-57,0.5);
 t.onTick(bot);
 assert.equal(t.failed,true);
});
test('round 7: a ring cell that refuses three clicks is skipped; the spider at the top is still hit',()=>{
 const world=makeWorld();
 for(let y=-60;y<=-58;y++)world.set(0,y,0,'cobblestone');
 const {bot,calls}=nightBot(world,{hostiles:[{name:'spider',position:[1.2,-57.2,0.5]}]});
 bot.placeBlock=async(ref,face)=>{calls.push(['place',k(ref.position.x,ref.position.y,ref.position.z)]);};
 const t=new NightPillarTask(3,{hold:true});t.phase='perch';t.base={x:0,y:-60,z:0};
 bot.entity.position=new Vec3(0.5,-57,0.5);
 bot.inventory.items().push({name:'stone_sword',count:1,slot:40});
 t.onTick(bot);
 assert.ok(calls.some(c=>c[0]==='equip'&&c[1]==='stone_sword'),'the climber comes first');
 delete bot.entities[10];
 for(let i=0;i<40;i++){t.ringAt=-1e9;t._equipAt=-1e9;t.onTick(bot);}
 assert.equal(calls.filter(c=>c[0]==='place').length,4*3,'4 sides x 3 tries; corners have no anchor');
 assert.ok(Object.values(t.ringTries).every(n=>n<=3));
});
test('the flee heading leaves the crowd, skirts water and never sprints into a lake',()=>{
 const me={x:0.5,y:-60,z:0.5};
 const world=makeWorld();
 // Zombies to the east: straight away is west (-x).
 let h=fleeHeading(world.blockAt,me,[{position:{x:5,y:-60,z:0.5}}]);
 assert.ok(h.x<-0.99&&!h.blocked);
 // A lake to the west: the heading turns away from the water.
 for(let x=-5;x<=-2;x++)for(let z=-1;z<=1;z++){world.set(x,-61,z,'water');world.set(x,-60,z,'water');}
 h=fleeHeading(world.blockAt,me,[{position:{x:5,y:-60,z:0.5}}]);
 assert.ok(!h.blocked);
 for(let s=1;s<=4;s++){const c=world.blockAt(Math.floor(me.x+h.x*s),-60,Math.floor(me.z+h.z*s));assert.notEqual(c.name,'water','step '+s);}
 // Surrounded by water: stand still rather than swim.
 const pond=makeWorld();
 for(let x=-6;x<=6;x++)for(let z=-6;z<=6;z++)if(Math.abs(x)>=1||Math.abs(z)>=1){pond.set(x,-60,z,'water');pond.set(x,-61,z,'water');}
 h=fleeHeading(pond.blockAt,me,[{position:{x:5,y:-60,z:0.5}}]);
 assert.equal(h.blocked,true);
 // Two packs east and north-east: the heading is away from both, not just the nearest.
 h=fleeHeading(makeWorld().blockAt,me,[{position:{x:4,y:-60,z:0.5}},{position:{x:3,y:-60,z:-3}},{position:{x:3.5,y:-60,z:-2.5}}]);
 assert.ok(h.x<0&&h.z>0,'south-west');
});
test('RunAwayFromHostilesTask holds still at the water line instead of walking in',async()=>{
 const pond=makeWorld();
 for(let x=-6;x<=6;x++)for(let z=-6;z<=6;z++)if(Math.abs(x)>=1||Math.abs(z)>=1){pond.set(x,-60,z,'water');pond.set(x,-61,z,'water');}
 const {bot,calls}=nightBot(pond,{hostiles:[{name:'zombie',position:[3,-60,0]}]});
 new RunAwayFromHostilesTask(30,true).onTick(bot,{});
 assert.ok(calls.some(c=>c[0]==='control'&&c[1]==='forward'&&c[2]===false));
 assert.ok(!calls.some(c=>c[0]==='control'&&c[1]==='forward'&&c[2]===true));
});
test('deep water is banned from paths after dark and costly by day; shallow water is free',()=>{
 const w=makeWorld();
 w.set(2,-60,0,'water');w.set(2,-61,0,'water');
 w.set(4,-60,0,'water');
 assert.equal(deepWaterCost(w.blockAt,{x:2,y:-60,z:0},true),100);
 assert.equal(deepWaterCost(w.blockAt,{x:2,y:-60,z:0},false),12);
 assert.equal(deepWaterCost(w.blockAt,{x:4,y:-60,z:0},true),0,'one deep: footing');
 assert.equal(deepWaterCost(w.blockAt,{x:1,y:-60,z:0},true),0);
});
// ---- the autopilot ----------------------------------------------------------------------------
function ladder({tod,items=[],jobs=[],health=20}){
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'night-ap-'));
 const submitted=[],cancelled=[],opts=[];
 const worker={
  ready:true,userStopped:false,deathResume:false,jobs,lastDeath:null,log(){},
  submit(spec,o){submitted.push(spec);opts.push(o||null);if(!(o&&o.keepHolds)){this.deathResume=false;}const job={id:'j'+submitted.length,status:'queued',spec};jobs.push(job);return job;},
  cancel(id){cancelled.push(id);const j=jobs.find(x=>x.id===id);if(j)j.status='cancelled';},
  bot:{health,food:20,time:{timeOfDay:tod,day:3},inventory:{items(){return items;}},entities:{},
   registry:{blocksByName:{},foodsByName:{},itemsByName:{}},findBlock(){return null;},blockAt(){return null;},
   entity:{position:{y:-60,floored(){return {x:0,y:-60,z:0,offset(){return this;}};}}}}
 };
 const ap=new Autopilot(worker,root);ap.start();
 return {ap,worker,submitted,cancelled,opts,done(){fs.rmSync(root,{recursive:true,force:true});}};
}
test('the ladder sends the shelter at sunset, cutting a running day job; not at 11999',()=>{
 let t=ladder({tod:11999,items:[{name:'cobblestone',count:30},{name:'wooden_pickaxe',count:1}]});
 try{t.ap.tick();assert.ok(!t.submitted.some(s=>s.type==='shelter'));}finally{t.done();}
 const day={id:'d1',status:'running',spec:{type:'gather',block:'stone'}};
 t=ladder({tod:SUNSET,jobs:[day]});
 try{t.ap.tick();assert.deepEqual(t.cancelled,['d1']);assert.deepEqual(t.submitted,[{type:'shelter'}]);}finally{t.done();}
});
test('a failed night shelter is sent again while it is dark, at most NIGHT_RETRIES times',()=>{
 const t=ladder({tod:14000});
 try{
  t.ap.tick();assert.deepEqual(t.submitted,[{type:'shelter'}]);
  for(let i=1;i<=NIGHT_RETRIES+2;i++){
   t.worker.jobs.find(j=>j.id==='j'+t.submitted.length).status='failed';
   t.ap.coolUntil=0;t.ap.tick();
  }
  assert.equal(t.submitted.filter(s=>s.type==='shelter').length,1+NIGHT_RETRIES);
  assert.ok(!t.ap.state.startsWith('blocked'),'night failures never block the ladder into an explore');
  assert.ok(!t.submitted.some(s=>s.type==='explore'));
  t.ap.coolUntil=0;t.ap.tick();
  assert.equal(t.submitted.length,1+NIGHT_RETRIES,'no day job in the dark after the last failure');
  assert.match(t.ap.state,/holding for morning/);
 }finally{t.done();}
});
test('respawned at night: shelter at the spawn point first, without lifting the death hold',()=>{
 const t=ladder({tod:15000});
 try{
  t.worker.deathResume=true;t.worker.lastDeath={pos:{x:5,y:-60,z:5},t:Date.now()-2000};
  t.ap.lastNightKey='3'; // the night's first shelter was already spent before the death
  t.worker.bot.health=0;t.ap.tick();
  assert.deepEqual(t.submitted,[],'still on the death screen');
  t.worker.bot.health=20;t.ap.tick();
  assert.deepEqual(t.submitted,[{type:'shelter'}]);
  assert.deepEqual(t.opts[0],{keepHolds:true});
  assert.equal(t.worker.deathResume,true,'the ladder stays paused: died');
  t.ap.tick();t.ap.tick();
  assert.equal(t.submitted.length,1,'once per death');
 }finally{t.done();}
 const stopped=ladder({tod:15000});
 try{stopped.worker.userStopped=true;stopped.worker.lastDeath={t:Date.now()-2000};stopped.ap.tick();assert.deepEqual(stopped.submitted,[],'Stop all wins');}
 finally{stopped.done();}
 const stale=ladder({tod:15000});
 try{stale.worker.deathResume=true;stale.worker.lastDeath={t:Date.now()-10*60000};stale.ap.tick();assert.deepEqual(stale.submitted,[],'an old death is not a respawn');}
 finally{stale.done();}
 const day=ladder({tod:3000});
 try{day.worker.deathResume=true;day.worker.lastDeath={t:Date.now()-2000};day.ap.tick();assert.deepEqual(day.submitted,[]);assert.match(day.ap.state,/paused: died/);}
 finally{day.done();}
});
test('the shelter job itself waits for dusk and reads the same clock',async()=>{
 const updates=[];
 const fake=tod=>({bot:{time:{timeOfDay:tod},blockAt(){throw Error('must not build');}},check(){},update(j,p,m){updates.push(m);},count(){return 0;}});
 // Round 37: dusk (DUSK_PREP) is when a crowd may send it; before that it does nothing.
 assert.equal(await Worker.prototype.shelter.call(fake(DUSK_PREP-1),{spec:{}},0),undefined);
 assert.deepEqual(updates,[]);
});
test('round 37: a crowd at dusk makes the shelter due early; stillNight holds from dusk',async()=>{
 const {stillNight,DUSK_CROWD}=await import('../src/night.js');
 assert.equal(nightJobFor(11000,false,0),null,'dusk alone: not yet');
 assert.deepEqual(nightJobFor(11000,false,DUSK_CROWD),{type:'shelter'},'dusk and a crowd: now');
 assert.equal(nightJobFor(9000,false,10),null,'a day crowd is a fight, not a night');
 assert.deepEqual(nightJobFor(SUNSET,false,0),{type:'shelter'},'sunset as before');
 assert.equal(stillNight(11000),true,'an early refuge holds');
 assert.equal(stillNight(5000),false);
});
test('round 40: a big crowd by day (dark-forest canopy) pillars too; a small one does not',async()=>{
 const {nightRefuge,DAY_CROWD}=await import('../src/night.js');
 const me={x:0,y:64,z:0};const mob=(x,z)=>({position:{x,y:64,z}});
 const crowd=n=>Array.from({length:n},(_,i)=>mob(5+i,5));
 const base={tod:3000,me,blocks:8,room:3,onGround:true};
 assert.equal(nightRefuge({...base,hostiles:crowd(3)}),null,'3 by day: fight or flee as before');
 const r=nightRefuge({...base,hostiles:crowd(DAY_CROWD)});
 assert.equal(r?.action,'pillar');assert.equal(r.hold,undefined,'not a hold-till-morning pillar');assert.equal(r.day,true);
 assert.equal(nightRefuge({...base,tod:13000,hostiles:crowd(3)})?.action,'pillar','night as before');
});
test('round 40: a day pillar is not ended by daylight, only by a quiet perch',async()=>{
 const {NightPillarTask}=await import('../src/chains/fallbackTasks.js');
 const bot={time:{timeOfDay:3000},entity:{position:{x:0,y:64,z:0}},entities:{}};
 const night=new NightPillarTask(3);night.phase='climb';
 assert.equal(night.isFinished(bot,{}),true,'a night pillar ends by day, as before');
 const day=new NightPillarTask(3,{day:true});day.phase='climb';
 assert.equal(day.isFinished(bot,{}),false,'a day pillar keeps climbing');
 day.phase='perch';day.quietSince=day.now()-16;
 assert.equal(day.isFinished(bot,{}),true,'down once quiet for 15 s');
 assert.equal(day.resumeCopy().day,true);
});
