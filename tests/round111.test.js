import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';
import {pourSpot,POUR_REACH} from '../src/tasks/movement/escape-from-lava-task.js';
console.error=()=>{};

// Round 111: the round-110 normal3 lava death - `burned to death` holding a water bucket, both
// pours refused with `No ground below to pour against` (the block under the feet was lava).
// The pour now aims at the pool floor through the lava, or at the rim beside it.
const SOLID=new Set(['stone','dirt','netherrack']);
function world(cells,{at=new Vec3(0.5,64,0.5)}={}){
 const inv=[{name:'water_bucket',count:1}],logs=[],looks=[];
 const block=p=>{const k=Math.floor(p.x)+','+Math.floor(p.y)+','+Math.floor(p.z),name=cells[k]||'air';
  return {name,position:new Vec3(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)),boundingBox:SOLID.has(name)?'block':'empty'};};
 const bot={entity:{position:at,metadata:[]},inventory:{items:()=>inv},heldItem:null,blockAt:block,
  async equip(item){bot.heldItem={name:item.name};},
  async lookAt(p){looks.push(p);},
  activateItem(){
   if(bot.heldItem?.name!=='water_bucket')return;
   inv[0]={name:'bucket',count:1};bot.heldItem={name:'bucket'};
   const s=pourSpot(bot);if(s)cells[s.cell.x+','+s.cell.y+','+s.cell.z]='water';
  },
  setControlState(){},clearControlStates(){}};
 const worker={bot,epoch:3,controlToken:3,log:m=>logs.push(m),
  count:n=>inv.filter(i=>i.name===n).reduce((a,i)=>a+i.count,0),async settleBlockChange(){}};
 return {bot,worker,logs,looks,cells,douse:()=>Worker.prototype.douseFire.call(worker)};
}
// a lava pool: lava from x -3..3, z -3..3 at y 63 (and deeper when `depth`), stone under it
function pool(depth=1,{rimAt=null}={}){
 const c={};
 for(let x=-6;x<=6;x++)for(let z=-6;z<=6;z++){
  const inside=Math.abs(x)<=3&&Math.abs(z)<=3;
  for(let y=63-depth+1;y<=63;y++)c[x+','+y+','+z]=inside?'lava':'stone';
  c[x+','+(63-depth)+','+z]='stone';
 }
 if(rimAt)for(const k of rimAt)c[k]='stone';
 return c;
}

test('round 111: standing on a lava pool, the bucket pours into the lava under the feet against the floor',async()=>{
 assert.equal(POUR_REACH,4.5);
 // the death's shape: feet air, the block under the feet lava, stone under that
 const w=world(pool(1));
 const s=pourSpot(w.bot);
 assert.deepEqual([s.cell.x,s.cell.y,s.cell.z],[0,63,0]);
 assert.equal(s.block.name,'stone');assert.equal(s.side,'top');assert.equal(s.floor,false);
 await w.douse();
 assert.equal(w.cells['0,63,0'],'water','the lava under the feet is water now');
 assert.deepEqual(w.logs,['Douse: no ground under the feet; pouring into (0, 63, 0) against the stone top']);
 assert.equal(w.looks[0].y,63,'aimed at the top face of the pool floor');
 assert.ok(!w.logs.some(l=>/No ground below/.test(l)));
});

test('round 111: in a deep pool it pours against the rim; with ground under the feet it is the old pour',async()=>{
 // lava 4 deep under the bot, floor out of reach; a stone rim beside the bot one below the feet
 const w=world(pool(4,{rimAt:['1,63,0']}));
 const s=pourSpot(w.bot);
 assert.ok(s,'a spot');assert.equal(s.block.name,'stone');
 assert.deepEqual([s.block.position.x,s.block.position.y,s.block.position.z],[1,63,0]);
 assert.equal(s.side,'west side');
 assert.ok(w.bot.entity.position.offset(0,1.62,0).distanceTo(s.aim)<=POUR_REACH);
 // the plain case: solid ground under the feet - the feet cell, the top of the ground, no log line
 const g=world({'0,63,0':'dirt','1,64,0':'lava'});
 const t=pourSpot(g.bot);
 assert.deepEqual([t.cell.x,t.cell.y,t.cell.z],[0,64,0]);assert.equal(t.side,'top');assert.equal(t.floor,true);
 await g.douse();
 assert.equal(g.cells['0,64,0'],'water');assert.equal(g.logs.length,0);
});

test('round 111: no solid block in reach is refused honestly',async()=>{
 // lava 8 deep everywhere near: nothing to pour against
 const c={};for(let x=-8;x<=8;x++)for(let z=-8;z<=8;z++)for(let y=56;y<=63;y++)c[x+','+y+','+z]='lava';
 const w=world(c);
 assert.equal(pourSpot(w.bot),null);
 await assert.rejects(w.douse(),/No solid block within 4\.5 to pour against/);
 assert.equal(w.cells['0,63,0'],'lava');
});
