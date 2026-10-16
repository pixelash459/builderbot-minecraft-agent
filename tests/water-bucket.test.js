// Round 10, habit 9: a water bucket after the iron core and the light - crafted from 3 ingots,
// filled at a still source in reach, and kept (the MLG fall chain and the fire douse use it).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Vec3} from 'vec3';
import {Autopilot,ironRung,plan,TORCHES,WATER_NEAR} from '../src/autopilot.js';
import {jobSchema} from '../src/schema.js';
const c=map=>n=>map[n]||0;
const base={iron_pickaxe:1,iron_sword:1,shield:1,stone_sword:1,stick:8,oak_planks:8,crafting_table:1,cobblestone:20,stone_pickaxe:2,torch:TORCHES};
const wood={planksTotal:8,logsTotal:0,heldLog:null};
test('the rung crafts the bucket from 3 ingots, fills it, and digs for it with the armour',()=>{
 assert.deepEqual(ironRung(c({...base,iron_ingot:3}),wood),{type:'craft',item:'bucket',count:1});
 const fill=ironRung(c({...base,bucket:1}),{...wood,waterAt:{x:2,y:63,z:5}});
 assert.deepEqual(fill,{type:'use',item:'bucket',position:{x:2,y:63,z:5}});
 assert.ok(jobSchema.safeParse(fill).success);
 // no water in reach: the empty bucket waits, the armour goes on
 assert.equal(ironRung(c({...base,bucket:1}),wood).block,'iron_ore');
 // the armour dig carries the bucket's 3 ingots: 5 + 8 + 3
 assert.equal(ironRung(c(base),wood).count,6);
 const j=ironRung(c({...base,raw_iron:0,iron_ingot:0}),wood);assert.equal(j.type,'gather');
 // a water bucket held is the bucket: no second one
 assert.equal(ironRung(c({...base,water_bucket:1,iron_ingot:5}),wood).item,'iron_helmet');
});
test('the iron step counts a water bucket as its bucket',()=>{
 const FULL={oak_planks:8,stick:10,crafting_table:1,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,cobblestone:32,stone_pickaxe:2,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1,_edible:8,
  iron_pickaxe:1,iron_sword:1,iron_axe:1,shield:1,bow:1,arrow:32,iron_helmet:1,iron_chestplate:1,iron_leggings:1,iron_boots:1,torch:16,coal:16,diamond_pickaxe:1,water_bucket:1,
  _equipped_iron_helmet:1,_equipped_iron_chestplate:1,_equipped_iron_leggings:1,_equipped_iron_boots:1};
 assert.equal(plan(FULL).step,'bed');
});
test('waterSource: a still source with air above, only while an empty bucket is held',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'water-'));
 try{
  const items=[{name:'bucket',count:1}];
  const blocks={'3,63,0':{name:'water',metadata:3},'4,63,0':{name:'water',metadata:0},'4,64,0':{name:'air',boundingBox:'empty'},'3,64,0':{name:'air',boundingBox:'empty'},
   '5,62,0':{name:'water',metadata:0},'5,63,0':{name:'water',metadata:0}};
  const bot={registry:{blocksByName:{water:{id:26}}},inventory:{items:()=>items},
   findBlocks(o){assert.equal(o.maxDistance,WATER_NEAR);return [new Vec3(3,63,0),new Vec3(5,62,0),new Vec3(4,63,0)];},
   blockAt(p){return blocks[p.x+','+p.y+','+p.z]||{name:'stone',boundingBox:'block'};}};
  const ap=new Autopilot({log(){},bot},root);
  assert.deepEqual(ap.waterSource(bot),{x:4,y:63,z:0},'flowing water and a submerged source are skipped');
  items.push({name:'water_bucket',count:1});
  assert.equal(ap.waterSource(bot),null,'already filled');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
// ---- round 11: 6x `use bucket ... produced no water bucket` at two ponds -----------------------
import {Worker,rayToFluid} from '../src/worker.js';
// A pond: a source at (4,63,0) with grass all round at y=63 and air above; the bot on the shore.
// The fake server applies a use only at the next client tick boundary (the 'flying' packet),
// and fills the bucket when the bot looks at a water source in reach with nothing solid first.
function pond(edit={}){
 const cells=new Map(Object.entries(edit));
 const blockAt=(x,y,z)=>{const k=x+','+y+','+z;let name=cells.has(k)?cells.get(k):(y<63?'stone':y===63?(x===4&&z===0?'water':'grass_block'):'air');
  const meta=typeof name==='object'?name.metadata:0;if(typeof name==='object')name=name.name;
  return {name,metadata:meta,position:new Vec3(x,y,z),boundingBox:/^(air|water|lava|short_grass)$/.test(name)?'empty':'block'};};
 return {blockAt,cells};
}
function bucketBot(w,{start=new Vec3(1.5,64,0.5),walkTo=null}={}){
 const inv={bucket:1,water_bucket:0},logs=[],walks=[];let pending=false,look=null;
 const bot={entity:{position:start.clone(),eyeHeight:1.62},heldItem:{name:'bucket'},registry:{itemsByName:{bucket:{id:1},water_bucket:{id:2}}},
  blockAt:p=>w.blockAt(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)),
  inventory:{items:()=>Object.entries(inv).filter(([,n])=>n>0).map(([name,count])=>({name,count}))},
  async equip(){},async lookAt(p){look=p;},activateItem(){pending=true;},setControlState(){},clearControlStates(){},
  _client:{write(name){if(name!=='flying'||!pending)return;pending=false;
   const eye=bot.entity.position.offset(0,1.62,0),r=rayToFluid(w.blockAt,eye,look);
   if(r.fluid&&eye.distanceTo(look)<=4.5){inv.bucket--;inv.water_bucket++;}}}};
 const worker=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,logs,check(){},log(m){logs.push(m);},
  count(n){return inv[n]||0;},async settleBlockChange(){},
  async walk(p,token,range){walks.push(range);if(walkTo)bot.entity.position=walkTo(range).clone();}});
 return {bot,worker,inv,logs,walks,pending:()=>pending};
}
test('the fill is flushed to the server: a use that waits for a tick boundary still fills',async()=>{
 const w=pond();
 const t=bucketBot(w);
 await t.worker.use({spec:{type:'use',item:'bucket',position:{x:4,y:63,z:0}}},0);
 assert.equal(t.inv.water_bucket,1);
 assert.equal(t.pending(),false);
});
test('a ray that meets a solid block first walks closer, then fills',async()=>{
 // a fence-high wall on the shore between the bot and the pond
 const w=pond({'3,64,0':'oak_fence','3,65,0':'oak_fence'});
 const t=bucketBot(w,{start:new Vec3(1.5,64,0.5),walkTo:r=>r<=2?new Vec3(4.5,64,1.5):new Vec3(1.5,64,0.5)});
 await t.worker.use({spec:{type:'use',item:'bucket',position:{x:4,y:63,z:0}}},0);
 assert.equal(t.inv.water_bucket,1);
 assert.ok(t.walks.some(r=>r<=2),'walked closer: '+t.walks);
});
test('flowing water is not a source: the bucket goes to the source beside it',async()=>{
 const w=pond({'5,63,0':{name:'water',metadata:1},'4,63,0':'water'});
 const t=bucketBot(w,{start:new Vec3(5.5,64,1.5)});
 await t.worker.use({spec:{type:'use',item:'bucket',position:{x:5,y:63,z:0}}},0);
 assert.equal(t.inv.water_bucket,1);
 assert.ok(t.logs.some(l=>/\(5, 63, 0\) is flowing water; filling at the source \(4, 63, 0\)/.test(l)),t.logs.join('\n'));
});
test('no source anywhere near: a clear error, never a silent use',async()=>{
 const w=pond({'4,63,0':{name:'water',metadata:3}});
 const t=bucketBot(w);
 await assert.rejects(t.worker.use({spec:{type:'use',item:'bucket',position:{x:4,y:63,z:0}}},0),/is flowing \(level 3\) and no source is beside it/);
 assert.equal(t.pending(),false);
});
test('a server that never applies the use: three tries with the reason, then a failure',async()=>{
 const w=pond();
 const t=bucketBot(w);t.bot._client.write=()=>{};
 await assert.rejects(t.worker.use({spec:{type:'use',item:'bucket',position:{x:4,y:63,z:0}}},0),/produced no water bucket \(3 tries; no change after the use\)/);
});
test('rayToFluid: the first solid block or water source on the eye ray',()=>{
 const w=pond({'3,64,0':'stone'});
 assert.equal(rayToFluid(w.blockAt,new Vec3(1.5,65.62,0.5),new Vec3(4.5,63.9,0.5)).blocked.name,'stone');
 assert.equal(rayToFluid(pond().blockAt,new Vec3(1.5,65.62,0.5),new Vec3(4.5,63.9,0.5)).fluid.name,'water');
});
