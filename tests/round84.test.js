import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,nightMineOverride,NIGHT_MINE_GUARD,MINE_HURT_MS,SHELTER_NOTCH} from '../src/worker.js';
console.error=()=>{};

// Round 84: the round-83 soak on the Nitrous world copy (hard3 shot dead on its night mine).
const k=(x,y,z)=>x+','+y+','+z;
function makeWorld(fill){
 const cells=new Map();
 const set=(x,y,z,name)=>cells.set(k(x,y,z),name);
 fill(set);
 const blockAt=(x,y,z)=>{
  const name=cells.get(k(x,y,z))||'air';
  return {name,position:new Vec3(x,y,z),boundingBox:/^(air|water|lava|.*torch)$/.test(name)?'empty':'block'};
 };
 return {cells,set,blockAt,at:p=>blockAt(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z))};
}
const flat=()=>makeWorld(set=>{for(let x=-8;x<=8;x++)for(let z=-8;z<=8;z++)set(x,-61,z,'grass_block');});
function shelterWorker(world,{items,tod}){
 const logs=[],inv=items.map((i,n)=>({...i,slot:36+n}));
 const bot={
  time:{timeOfDay:tod,day:3},entity:{position:new Vec3(0.5,-60,0.5),height:1.8},entities:{},heldItem:null,health:20,food:20,
  registry:{itemsByName:{},blocksByName:{dirt:{id:1},grass_block:{id:2}}},
  inventory:{items:()=>inv.filter(i=>i.count>0)},
  blockAt:p=>world.at(p),findBlocks:()=>[],canDigBlock:()=>true,tool:{equipForBlock:async()=>{}},
  equip:async item=>{bot.heldItem=item;},
  placeBlock:async(ref,face)=>{
   const t=ref.position.plus(face),item=inv.find(i=>i.name===bot.heldItem?.name&&i.count>0);
   if(!item)throw Error('nothing held');
   world.set(t.x,t.y,t.z,item.name);item.count--;
  },
  lookAt:async()=>{},attack:async()=>{},
  dig:async bl=>{world.set(bl.position.x,bl.position.y,bl.position.z,'air');}
 };
 const w=Object.assign(Object.create(Worker.prototype),{bot,cobbleReserve:0,deadline:Infinity,survivalJob:true,epoch:0,ready:true,config:{limits:{}},
  log:m=>logs.push(m),save(){},update(){},check(){},sweepDrops:async()=>{},walk:async()=>{}});
 return {w,bot,logs};
}

test('round 84: on the night mine, a hostile within 8 or a fresh hit lets Mob Defense through the shelter hold',()=>{
 assert.equal(NIGHT_MINE_GUARD,8);assert.equal(MINE_HURT_MS,3000);
 const shelter={status:'running',spec:{type:'shelter'}};
 const w=Object.assign(Object.create(Worker.prototype),{jobs:[shelter]});
 // sealed in the box: no mining hold, Mob Defense stays off
 w.shelterSealed=true;w.nightMining=true;
 assert.deepEqual(w.survivalHold(),{job:shelter,sealed:true,opening:false,mining:false,respawned:false});
 // round-83 hard3: down the staircase, the box open behind it
 w.shelterSealed=false;
 assert.equal(w.survivalHold().mining,true);
 w.nightMining=false;
 assert.equal(w.survivalHold().mining,false,'a shelter still placing its walls is not a night mine');
 const hold={job:shelter,sealed:false,mining:true};
 assert.equal(nightMineOverride('Mob Defense',hold,'a skeleton within 8'),true);
 assert.equal(nightMineOverride('Mob Defense',hold,null),false);
 assert.equal(nightMineOverride('Food',hold,'a hit'),false);
 assert.equal(nightMineOverride('Mob Defense',{...hold,mining:false},'a hit'),false);
});

test('round 84: the night-mine threat - a hostile within 8, a hit in the last 3 s, nothing farther',()=>{
 const me=new Vec3(855.5,92,-542.5);
 const bot={entity:{position:me},entities:{},health:20};
 const w=Object.assign(Object.create(Worker.prototype),{bot,busy:false,config:{limits:{minHealth:6,minFood:6}}});
 bot.entities[2]={id:2,name:'skeleton',type:'hostile',position:me.offset(12,0,0)};
 assert.equal(w.mineThreat(bot),null,'a skeleton 12 away');
 bot.entities[3]={id:3,name:'zombie',type:'hostile',position:me.offset(0,0,6)};
 assert.equal(w.mineThreat(bot),'a zombie within 8');
 delete bot.entities[3];
 // a hit: the health event marks it
 w.onHealth(bot);bot.health=16.5;w.onHealth(bot);
 assert.equal(w.mineThreat(bot),'a hit');
 const real=Date.now;
 try{const t=real()+MINE_HURT_MS+100;Date.now=()=>t;assert.equal(w.mineThreat(bot),null,'the hit is stale after 3 s');}
 finally{Date.now=real;}
 // healing is not a hit
 w.hurtAt=0;bot.health=18;w.onHealth(bot);assert.equal(w.mineThreat(bot),null);
});

test('round 84: no night mine from a box with an open cell; a sealed box still mines',async()=>{
 for(const gaps of [1,0]){
  const world=flat();
  const {w,bot,logs}=shelterWorker(world,{items:[{name:'cobblestone',count:60},{name:'stone_pickaxe',count:1}],tod:13500});
  w.removeShelter=async()=>{};
  let mined=0,guards=0;
  w.nightMine=async()=>{mined++;return true;};
  w.guardShelter=async function(){this.shelterGaps=gaps;if(++guards>=4)this.bot.time.timeOfDay=1500;};
  const job={spec:{type:'shelter'}};
  await w.shelter(job,0);
  if(gaps){
   assert.equal(mined,0,'the box with a torch in its head ring is held');
   assert.deepEqual(logs.filter(m=>m.startsWith('Night mine: not from')),['Night mine: not from a box with 1 open cell(s); holding the box']);
  }else{
   assert.equal(mined,1,logs.join('\n'));
   assert.equal(logs.some(m=>m.startsWith('Night mine: not from')),false);
  }
  assert.equal(!!w.nightMining,false,'the flag is down after the mine');
  void bot;
 }
});

test('round 84: a torch in a shell cell is dug out and the cell filled',async()=>{
 for(const n of ['torch','wall_torch','soul_torch','soul_wall_torch','redstone_torch','redstone_wall_torch'])assert.ok(SHELTER_NOTCH.test(n),n);
 for(const n of ['stone','cobblestone','air'])assert.equal(SHELTER_NOTCH.test(n),false,n);
 // round-83 hard3: `open cells 857,94,-544=torch`
 const world=flat();world.set(1,-60,0,'cobblestone');world.set(1,-59,0,'torch');
 const {w}=shelterWorker(world,{items:[{name:'cobblestone',count:10}],tod:13000});
 const dug=[];const dig=w.bot.dig;w.bot.dig=async bl=>{dug.push(bl.name);return dig(bl);};
 const job={placed:[]};
 assert.equal(await w.placeShelterBlock(job,{x:1,y:-59,z:0},0),true);
 assert.deepEqual(dug,['torch']);
 assert.equal(world.blockAt(1,-59,0).name,'cobblestone');
 assert.deepEqual(job.placed,[{x:1,y:-59,z:0}]);
});
