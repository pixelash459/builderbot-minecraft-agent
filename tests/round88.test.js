import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,deathContext,DEATH_TRAIL_MS,ASCEND_PILLAR} from '../src/worker.js';

// Round 88: the round-87 soak on the Nitrous world copy (hard2's cave morning at (816, 85, -540):
// the climb out ended at y=88 under the cave roof, the surface 90, and a skeleton shot it 9 s later).
function cave({skyAfter=0,to=88}={}){
 const logs=[],pillars=[];let sky=0;
 const bot={entity:{position:new Vec3(816.5,85,-539.5)},blockAt:()=>({name:'stone',boundingBox:'block',skyLight:sky})};
 const w=Object.assign(Object.create(Worker.prototype),{bot,log:m=>logs.push(m),check(){},strandedTunnel:null,
  navigate:async()=>{bot.entity.position=new Vec3(819.5,to,-539.5);sky=skyAfter;},
  pillarUp:async(target,token,opts)=>{pillars.push({target,opts});bot.entity.position=new Vec3(819.5,90,-539.5);sky=15;assert.equal(opts.until(),true);return true;}});
 return {w,bot,logs,pillars};
}

test('round 88: a cave climb out that ends under the roof pillars on to the sky',async()=>{
 const {w,logs,pillars}=cave();
 await w.ascend({spec:{type:'ascend',y:90,sky:true}},0);
 assert.equal(pillars.length,1);
 assert.equal(pillars[0].target,88+ASCEND_PILLAR);assert.equal(pillars[0].opts.maxDigs,ASCEND_PILLAR);
 assert.equal(typeof pillars[0].opts.clear,'function');
 assert.deepEqual(logs,['Ascend: no sky at y=88 after the climb (surface 90); pillaring to the sky','Ascend: y=85 -> 90 (surface 90)']);
});

test('round 88: the sky pillar stays out of a climb that reached the sky, a canopy over the anchor and a plain ascend',async()=>{
 const open=cave({skyAfter:15});
 await open.w.ascend({spec:{type:'ascend',y:90,sky:true}},0);
 assert.equal(open.pillars.length,0);assert.deepEqual(open.logs,['Ascend: y=85 -> 88 (surface 90)']);
 // at the anchor height under leaves: no pillar through the canopy
 const canopy=cave({to:90});
 await canopy.w.ascend({spec:{type:'ascend',y:90,sky:true}},0);
 assert.equal(canopy.pillars.length,0);
 // an escape ascend (no sky wanted) is as before: it rose 3, done
 const plain=cave();
 await plain.w.ascend({spec:{type:'ascend',y:90}},0);
 assert.equal(plain.pillars.length,0);assert.deepEqual(plain.logs,['Ascend: y=85 -> 88 (surface 90)']);
 // a food ascend is a sky climb too
 const food=cave();
 await food.w.ascend({spec:{type:'ascend',y:90,forFood:true}},0);
 assert.equal(food.pillars.length,1);
});

test('round 88: pillarUp stops as soon as its until() holds',async()=>{
 const placed=[],logs=[];
 const bot={entity:{position:new Vec3(0.5,88,0.5)},heldItem:null,
  blockAt:p=>{const s=Math.floor(p.y)<Math.floor(bot.entity.position.y);return {name:s?'stone':'air',boundingBox:s?'block':'empty',position:new Vec3(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z))};},
  inventory:{items:()=>[{name:'cobblestone',count:20}]},equip:async()=>{},clearControlStates(){},
  setControlState(k,v){if(k==='jump'&&v)bot.entity.position=bot.entity.position.offset(0,1.2,0);},
  placeBlock:async ref=>{placed.push(ref.position.y);bot.entity.position=new Vec3(0.5,ref.position.y+2,0.5);}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,log:m=>logs.push(m),check(){},epoch:0});
 await w.pillarUp(100,0,{until:()=>true});
 assert.equal(placed.length,0,'already there');
 await w.pillarUp(100,0,{until:()=>bot.entity.position.y>=90});
 assert.deepEqual(placed,[87,88],'two jump-places, then it stops at y=90');
 assert.equal(Math.floor(bot.entity.position.y),90);
});

test('round 88: the death line says the health trail, the armour, the held item and what was near',()=>{
 const at=new Vec3(845.3,102,-471.7);
 const mob=(id,name,dx,type='hostile')=>({id,name,type,isValid:true,position:at.offset(dx,0,0)});
 const bot={entity:{position:at},heldItem:{name:'stone_sword'},inventory:{slots:[]},
  entities:{1:mob(1,'zombie',1.5),2:mob(2,'zombie',0.8),3:mob(3,'skeleton',7.5),4:mob(4,'creeper',12),5:mob(5,'cow',1,'passive')}};
 const now=1_000_000,trail=[{t:now-DEATH_TRAIL_MS-1,hp:20},{t:now-9000,hp:20},{t:now-4000,hp:15.5},{t:now-4000,hp:15.5},{t:now-2000,hp:11},{t:now-1000,hp:6.5},{t:now,hp:0}];
 assert.equal(deathContext(bot,trail,now),'Death: health 20 -> 15.5 -> 11 -> 6.5 -> 0 in the last 10 s; armour 0; held stone_sword; 3 hostile(s) within 8: zombie 0.8, zombie 1.5, skeleton 7.5');
 bot.inventory.slots[6]={name:'iron_chestplate'};bot.heldItem=null;bot.entities={};
 assert.equal(deathContext(bot,[],now),'Death: health unknown in the last 10 s; armour 6; held nothing; 0 hostile(s) within 8');
});

test('round 88: onDeath logs the context line after the death line and clears the trail',()=>{
 const logs=[];
 const bot={entity:{position:new Vec3(0,64,0)},entities:{},health:0,inventory:{slots:[]},heldItem:null,respawn(){}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,log:m=>logs.push(m),jobs:[],stop(){},hpTrail:[{t:Date.now(),hp:4}]});
 w.onDeath(bot);
 assert.equal(logs[0],'Bot died at 0, 64, 0');
 assert.match(logs[1],/^Death: health 4 in the last 10 s; armour 0; held nothing; 0 hostile\(s\) within 8$/);
 assert.deepEqual(w.hpTrail,[]);
});
