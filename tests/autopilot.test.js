import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {plan,STEPS,Autopilot,grazeDirection} from '../src/autopilot.js';
import {jobSchema} from '../src/schema.js';
const counts=map=>({__proto__:null,...map});
test('the unblock explore after a surface gather passes the job schema',()=>{
 // soak 20261014-0239: the ladder's explore carried surface/surfaceY, the strict schema
 // rejected it ("Autopilot submit failed"), and a blocked step retried in place forever.
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'autopilot-test-'));
 try{
  const submitted=[];
  const worker={
   ready:true,userStopped:false,deathResume:false,jobs:[],log(){},
   submit(spec){jobSchema.parse(spec);submitted.push(spec);return {id:'j'+submitted.length};},
   bot:{time:{timeOfDay:100,day:1},inventory:{items(){return [];}},entities:{},registry:{blocksByName:{},foodsByName:{},itemsByName:{}},findBlock(){return null;},blockAt(p){return p&&p.sky?{name:'air',boundingBox:'empty',skyLight:15}:null;},entity:{position:{y:131.5,offset(){return {sky:true};},floored(){return {x:0,y:131,z:0,offset(){return this;}};}}}}
  };
  const ap=new Autopilot(worker,root);
  ap.start();
  for(let i=0;i<3;i++){ap.tick();ap.settle({status:'failed',message:'No path to the goal!'});ap.coolUntil=Date.now()-1;}
  ap.tick();
  const explore=submitted[submitted.length-1];
  assert.equal(explore.type,'explore');
  assert.equal(explore.surface,true);assert.equal(explore.surfaceY,131);
  assert.ok(ap.state.startsWith('retry: wood'),'the explore went out: '+ap.state);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
const WOOD={oak_log:16,oak_planks:16,stick:4,crafting_table:1,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1};
const STONE={...WOOD,stick:10,oak_planks:8,cobblestone:32,stone_pickaxe:1,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1};
// COMBAT_SPEC 7a: full iron tier - one sword, one axe, shield, bow, 32 arrows and full armour.
const IRON={...STONE,_edible:8,iron_pickaxe:1,iron_sword:1,iron_axe:1,iron_helmet:1,iron_chestplate:1,iron_leggings:1,iron_boots:1,bucket:1,shield:1,bow:1,arrow:32,torch:16};
const FULL={...IRON,chest:1,red_wool:3,red_bed:1};
test('an empty inventory starts the ladder with a small log gather',()=>{
 const {step,job}=plan(counts({}));
 assert.equal(step,'wood');
 assert.equal(job.type,'gather');assert.equal(job.block,'log');assert.equal(job.count,3);assert.equal(job.searchIfMissing,true);assert.equal(job.belowFoots,true);assert.equal(job.surface,true);
});
test('step 1 is KIT-FIRST: 11 planks (3 logs) before crafting, then table -> sticks -> pickaxe -> sword',()=>{
 let r=plan(counts({oak_log:3}));
 assert.equal(r.job.type,'craft');assert.equal(r.job.item,'oak_planks'); // never hold uncrafted logs
 r=plan(counts({oak_planks:11,crafting_table:1,stick:4,wooden_sword:1,wooden_pickaxe:1,wooden_axe:1}));
 r=plan(counts({oak_planks:12}));
 assert.equal(r.job.item,'crafting_table');
 r=plan(counts({oak_planks:12,crafting_table:1}));
 assert.equal(r.job.item,'stick');
 // No hostile nearby: the pickaxe comes before the sword (it unlocks stone).
 r=plan(counts({oak_planks:12,crafting_table:1,stick:4}));
 assert.equal(r.job.item,'wooden_pickaxe');
 r=plan(counts({oak_planks:12,crafting_table:1,stick:4}),{hostileDistance:10});
 assert.equal(r.job.item,'wooden_sword');
 r=plan(counts({oak_planks:12,crafting_table:1,stick:4,wooden_pickaxe:1}));
 assert.equal(r.job.item,'wooden_sword');
 // COMBAT_SPEC 7a: swords AND axes in every tier - the axe completes the wood kit.
 r=plan(counts({oak_planks:12,crafting_table:1,stick:4,wooden_sword:1,wooden_pickaxe:1}));
 assert.equal(r.job.item,'wooden_axe');
 // The axe needs sticks: two more are crafted from the held planks first.
 r=plan(counts({oak_planks:12,crafting_table:1,stick:1,wooden_sword:1,wooden_pickaxe:1}));
 assert.equal(r.job.item,'stick');
 // Short kit: with fewer than 11 planks and logs in hand, convert the logs first.
 r=plan(counts({oak_planks:8,oak_log:2,crafting_table:1,stick:4,wooden_sword:1,wooden_pickaxe:1}));
 assert.equal(r.job.item,'oak_planks');
 // Short kit with no logs: gather 3 more (radius 32 is the measured-pathable search).
 r=plan(counts({oak_planks:8,crafting_table:1,stick:4,wooden_sword:1,wooden_pickaxe:1}));
 assert.equal(r.job.type,'gather');assert.equal(r.job.radius,32);
 r=plan(counts(WOOD));assert.equal(r.step,'stone');
});
test('any log species satisfies the wood step, matching its planks',()=>{
 let r=plan(counts({birch_log:3}));
 assert.equal(r.job.item,'birch_planks');
 r=plan(counts({spruce_log:13}));
 assert.equal(r.job.item,'spruce_planks');
 r=plan(counts({oak_log:3,spruce_log:13}));
 assert.equal(r.job.item,'spruce_planks'); // the most abundant held log wins
 r=plan(counts({spruce_log:13,spruce_planks:13,crafting_table:1,stick:4,wooden_pickaxe:1}));
 assert.equal(r.job.item,'wooden_sword');
 r=plan(counts({spruce_log:13,spruce_planks:13,crafting_table:1,stick:4,wooden_pickaxe:1,wooden_sword:1}));
 assert.equal(r.job.item,'wooden_axe');
 // Short on planks mid-sequence: gather 3 more rather than wandering.
 r=plan(counts({oak_planks:2,crafting_table:1,stick:4}));
 assert.equal(r.job.type,'gather');assert.equal(r.job.count,3);
});
test('the stone step gathers cobblestone and then builds the stone kit and furnace',()=>{
 let r=plan(counts({...WOOD,stick:10,cobblestone:0}));
 assert.equal(r.step,'stone');assert.equal(r.job.type,'gather');assert.equal(r.job.block,'stone');
 assert.equal(r.job.count,3,'round 7: the stone pickaxe\'s 3 first (a short wooden-pickaxe dig)');
 r=plan(counts({...WOOD,stick:10,cobblestone:0,stone_pickaxe:1}));
 assert.equal(r.job.count,18,'then the rest of the kit (2+3+1 tools + 8 furnace = 14) plus a 4 spare, not a flat 32 (round 5)');
 const have={...WOOD,stick:10,cobblestone:32};
 for(const item of ['stone_pickaxe','stone_sword','stone_axe','stone_shovel','furnace']){
  r=plan(counts(have));
  assert.equal(r.step,'stone');assert.equal(r.job.item,item,item);
  assert.equal(r.job.keepTable,true,item+' keeps the table standing');
  if(item==='furnace')assert.equal(r.job.collectTable,true);
  have[item]=1;
 }
 r=plan(counts(have));assert.equal(r.step,'food');
});
test('the stone step crafts planks from the species it actually holds',()=>{
 const r=plan(counts({birch_log:16,stick:10,cobblestone:0,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,crafting_table:1}));
 assert.equal(r.step,'stone');assert.equal(r.job.item,'birch_planks');
});
test('the food step hunts, collects and prefers cooking raw meat',()=>{
 let r=plan(counts({...STONE,_edible:0}),{animalsNearby:'cow',huntPhase:false});
 assert.equal(r.step,'food');assert.equal(r.job.type,'fight');assert.equal(r.job.entity,'cow');
 r=plan(counts({...STONE,_edible:0}),{animalsNearby:'cow',huntPhase:true});
 assert.equal(r.job.type,'collect');
 r=plan(counts({...STONE,_edible:0,beef:3}),{huntPhase:true});
 assert.equal(r.job.type,'smelt');assert.equal(r.job.item,'beef');
 // COMBAT_SPEC 7a: raw meat is cooked through the existing smelt flow even while enough
 // food is already held, so the combat stock stays cooked.
 r=plan(counts({...STONE,_edible:8,beef:3}));
 assert.equal(r.step,'food');assert.equal(r.job.type,'smelt');assert.equal(r.job.item,'beef');
 r=plan(counts({...STONE,_edible:8,cooked_beef:8}));assert.equal(r.step,'iron');
 r=plan(counts({...STONE,_edible:0}));
 assert.equal(r.job.type,'explore');assert.equal(r.job.direction,'random');
 r=plan(counts({...STONE,_edible:0}),{grazeDirection:'east'});
 // 32-block legs: decide() re-evaluates every ~20 s and the tick cancels the leg the
 // moment animals come into hunt range (soak 6: 64-block legs walked 200+ blocks past).
 assert.equal(r.job.direction,'east');assert.equal(r.job.distance,32);
 r=plan(counts({...STONE,_edible:0}),{grazeDirection:'east',standY:139});
 assert.equal(r.job.surfaceCeiling,147,'food explore aborts before a y=173 peak walk');
 // The ceiling is anchored to the wood step's stand: a leg that ends higher must not
 // ratchet the cap upward (soak 7 normal1: +8 per leg walked the bot to y=156 on a peak).
 r=plan(counts({...STONE,_edible:0}),{grazeDirection:'east',standY:139,lastSurfaceY:131});
 assert.equal(r.job.surfaceCeiling,139,'the cap anchors to the lower wood-stand Y');
 assert.equal(jobSchema.safeParse(r.job).success,true);
 // Cloud review: min(current,anchor) ratcheted DOWN - a bot in a valley got a valley+8 cap
 // and could never climb out to graze; the run's anchor holds instead.
 r=plan(counts({...STONE,_edible:0}),{grazeDirection:'east',standY:120,lastSurfaceY:131});
 assert.equal(r.job.surfaceCeiling,139,'a valley does not lower the anchor');
 // Round 18: far below the anchor (a cave, a mine) the food step climbs back up first.
 r=plan(counts({...STONE,_edible:0}),{grazeDirection:'east',standY:100,lastSurfaceY:131});
 assert.deepEqual(r.job,{type:'ascend',y:131,forFood:true});
 assert.equal(jobSchema.safeParse(r.job).success,true);
 // Round 31 (round-30 normal2 fell 34 climbing a mountainside to its anchor): under open sky
 // the bot is on the surface already - it grazes from there.
 r=plan(counts({...STONE,_edible:0}),{grazeDirection:'east',standY:100,lastSurfaceY:131,underSky:true});
 assert.equal(r.job.type,'explore');
 assert.equal(r.job.surfaceFloor<=100,true,'the graze floor lets it stay level');
 // A bot already above the cap may not climb further, but its leg must start: navigation
 // rejects every position above the cap, so a cap below the bot failed each leg at once.
 r=plan(counts({...STONE,_edible:0}),{grazeDirection:'east',standY:150,lastSurfaceY:131});
 assert.equal(r.job.surfaceCeiling,150);
});
test('without a surface gather the food anchor is latched once per run (no +8 per leg)',()=>{
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'autopilot-test-'));
 try{
  const submitted=[];
  const items=Object.entries(STONE).map(([name,count])=>({name,count}));
  const position={y:139,floored(){return {x:0,y:Math.floor(this.y),z:0,offset(){return this;}};}};
  const worker={
   ready:true,userStopped:false,deathResume:false,jobs:[],log(){},
   submit(spec){submitted.push(spec);return {id:'j'+submitted.length};},
   bot:{time:{timeOfDay:1000,day:1},inventory:{items(){return items;}},entities:{},registry:{blocksByName:{},foodsByName:{},itemsByName:{}},findBlock(){return null;},blockAt(){return null;},entity:{position}}
  };
  const ap=new Autopilot(worker,root);
  ap.start();
  ap.tick();
  assert.equal(submitted[0].type,'explore');assert.equal(submitted[0].surfaceCeiling,147);
  ap.settle({status:'complete'});position.y=146; // the leg ended 7 higher
  ap.tick();
  assert.equal(submitted.length,2);assert.equal(submitted[1].surfaceCeiling,147,'the cap did not ratchet to 154');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('grazeDirection prefers a loaded plains column over peaks',()=>{
 const columns={
  '0,3':{getBiome:()=>1},   // south +48 -> plains
  '0,-1':{getBiome:()=>2}   // north +16 fallback unused
 };
 const bot={
  entity:{position:{x:0,y:80,z:0}},
  world:{getColumn:(cx,cz)=>columns[cx+','+cz]||null},
  registry:{biomes:{1:{name:'plains'},2:{name:'jagged_peaks'}}}
 };
 assert.equal(grazeDirection(bot),'south');
});
test('M5: the iron step digs 6 ore, smelts, crafts pickaxe -> sword -> shield before the rest',()=>{
 const valid=r=>{assert.equal(jobSchema.safeParse(r.job).success,true,JSON.stringify(r.job));return r;};
 // Round 7: a spare stone pickaxe first (cobble and sticks held), so the dig never wears the
 // last one out.
 let r=valid(plan(counts({...STONE,_edible:8})));
 assert.equal(r.step,'iron');assert.deepEqual([r.job.type,r.job.item],['craft','stone_pickaxe']);
 // Stone kit done, fed, spare held: a short ore dig (pickaxe 3 + sword 2 + shield 1) in the
 // band near the surface (enter at 64, never below 16), smelting in the tunnel from 3 raw.
 const fed={...STONE,_edible:8,stone_pickaxe:2};
 r=valid(plan(counts(fed)));
 assert.equal(r.job.type,'gather');assert.equal(r.job.block,'iron_ore');
 assert.equal(r.job.count,6);assert.equal(r.job.targetY,16);assert.equal(r.job.bandTop,64);assert.equal(r.job.smeltAt,3);assert.equal(r.job.searchIfMissing,true);
 r=valid(plan(counts({...fed,raw_iron:2})));
 assert.equal(r.job.block,'iron_ore');assert.equal(r.job.count,4,'only the missing ore');
 // 3+ raw iron in hand (the kiln could not run): smelt it before the next dig.
 r=valid(plan(counts({...fed,raw_iron:4})));
 assert.deepEqual([r.job.type,r.job.item,r.job.count],['smelt','raw_iron',4]);
 r=valid(plan(counts({...fed,raw_iron:6})));
 assert.equal(r.job.type,'smelt');assert.equal(r.job.item,'raw_iron');assert.equal(r.job.count,6);
 // The pickaxe as soon as its 3 ingots are held, before the sword's ore is even dug.
 r=valid(plan(counts({...fed,iron_ingot:3})));
 assert.deepEqual([r.job.type,r.job.item],['craft','iron_pickaxe']);
 r=valid(plan(counts({...fed,iron_ingot:1,iron_pickaxe:1})));
 assert.deepEqual([r.job.type,r.job.block,r.job.count],['gather','iron_ore',2],'the sword\'s 2 + the shield\'s 1, less the ingot held');
 // No wood to spare and no coal: one coal ore smelts 8 (entering the band from the top too).
 r=valid(plan(counts({...fed,oak_log:0,oak_planks:8,raw_iron:6})));
 assert.equal(r.job.type,'gather');assert.equal(r.job.block,'coal_ore');assert.equal(r.job.count,1);assert.equal(r.job.targetY,32);assert.equal(r.job.bandTop,64);
 r=valid(plan(counts({...fed,oak_log:0,oak_planks:8,raw_iron:6,coal:1})));
 assert.equal(r.job.type,'smelt');
 // Ingots: iron pickaxe first, then the sword, then the shield.
 let have={...STONE,_edible:8,iron_ingot:6};
 for(const item of ['iron_pickaxe','iron_sword','shield']){
  r=valid(plan(counts(have)));
  assert.equal(r.step,'iron');assert.equal(r.job.type,'craft');assert.equal(r.job.item,item,item);
  have={...have,[item]:1,iron_ingot:have.iron_ingot-{iron_pickaxe:3,iron_sword:2,shield:1}[item]};
 }
 // Sticks short (pickaxe 2 + sword 1): crafted from planks first.
 r=valid(plan(counts({...STONE,_edible:8,iron_ingot:6,stick:1})));
 assert.equal(r.job.item,'stick');assert.equal(r.job.count,2);
 // Shield short on planks: crafted from the held logs; no logs: a short log gather.
 const shieldNext={...STONE,_edible:8,iron_ingot:1,iron_pickaxe:1,iron_sword:1};
 r=valid(plan(counts({...shieldNext,oak_planks:0})));
 assert.equal(r.job.type,'craft');assert.equal(r.job.item,'oak_planks');
 r=valid(plan(counts({...shieldNext,oak_planks:0,oak_log:0})));
 assert.equal(r.job.type,'gather');assert.equal(r.job.block,'log');
 // Round 8 - core done: coal for the torches (the band staircase only with no coal in reach),
 // then 16 torches.
 assert.equal(have.iron_ingot,0);
 r=valid(plan(counts(have)));
 assert.deepEqual([r.job.type,r.job.block,r.job.count,r.job.targetY,r.job.bandTop],['gather','coal_ore',4,32,64]);
 r=valid(plan(counts(have),{coalNear:true}));
 assert.deepEqual([r.job.type,r.job.block,r.job.count,r.job.targetY,r.job.bandTop],['gather','coal_ore',4,undefined,64],'exposed/near coal first: no staircase');
 r=valid(plan(counts({...have,coal:4,stick:2})));
 assert.deepEqual([r.job.type,r.job.item,r.job.count],['craft','stick',2],'a stick per 4 torches');
 r=valid(plan(counts({...have,coal:4})));
 assert.deepEqual([r.job.type,r.job.item,r.job.count],['craft','torch',16]);
 have={...have,torch:16};
 // Round 10, habit 9: a water bucket after the light (3 ingots), filled at water in reach.
 r=valid(plan(counts({...have,iron_ingot:5})));
 assert.deepEqual([r.job.type,r.job.item],['craft','bucket']);
 r=valid(plan(counts({...have,bucket:1}),{waterAt:{x:4,y:63,z:0}}));
 assert.deepEqual(r.job,{type:'use',item:'bucket',position:{x:4,y:63,z:0}});
 have={...have,water_bucket:1};
 // The iron helmet and chestplate: 13 ingots, dug (spare stone pickaxe first) and smelted.
 r=valid(plan(counts(have)));
 assert.deepEqual([r.job.type,r.job.item],['craft','stone_pickaxe'],'one stone pickaxe: the spare comes first');
 have={...have,stone_pickaxe:2};
 r=valid(plan(counts(have)));
 assert.deepEqual([r.job.type,r.job.block,r.job.count,r.job.targetY],['gather','iron_ore',6,16],'13 ore for the core armour, in batches of 6');
 r=valid(plan(counts({...have,raw_iron:3})));
 assert.deepEqual([r.job.type,r.job.item,r.job.count],['smelt','raw_iron',3]);
 r=valid(plan(counts({...have,iron_ingot:5})));
 assert.deepEqual([r.job.type,r.job.item],['craft','iron_helmet']);
 r=valid(plan(counts({...have,iron_ingot:5,iron_helmet:1})));
 assert.deepEqual([r.job.type,r.job.block,r.job.count],['gather','iron_ore',3],'the chestplate\'s 8, less the 5 held');
 r=valid(plan(counts({...have,iron_ingot:8,iron_helmet:1})));
 assert.deepEqual([r.job.type,r.job.item],['craft','iron_chestplate']);
 // The full set when affordable: legs and boots ride along while their ingots are held.
 r=valid(plan(counts({...have,iron_ingot:11,iron_helmet:1,iron_chestplate:1})));
 assert.deepEqual([r.job.type,r.job.item],['craft','iron_leggings']);
 r=valid(plan(counts({...have,iron_ingot:4,iron_helmet:1,iron_chestplate:1,iron_leggings:1})));
 assert.deepEqual([r.job.type,r.job.item],['craft','iron_boots']);
 // ...and is worn at once; an equip that changed nothing is not repeated.
 const armoured={...have,iron_helmet:1,iron_chestplate:1};
 r=valid(plan(counts(armoured)));
 assert.deepEqual(r.job,{type:'equip'});
 r=plan(counts(armoured),{lastEquip:'iron_helmet,iron_chestplate'});
 assert.notEqual(r.job.type,'equip');
 r=plan(counts({...armoured,_equipped_iron_helmet:1,_equipped_iron_chestplate:1}));
 assert.notEqual(r.job.type,'equip','worn already');
 have={...armoured,_equipped_iron_helmet:1,_equipped_iron_chestplate:1};
 // A bed while its wool is cheap: a sheep near and a sword (hunt) or shears (shear).
 r=valid(plan(counts(have),{sheepNear:2}));
 assert.deepEqual(r.job,{type:'hunt',entity:'sheep',count:2});
 r=valid(plan(counts({...have,shears:1}),{sheepNear:2}));
 assert.deepEqual(r.job,{type:'shear'});
 r=valid(plan(counts({...have,white_wool:3}),{sheepNear:2}));
 assert.deepEqual(r.job,{type:'craft',item:'white_bed',count:1});
 r=plan(counts({...have,white_wool:3}),{bedNear:true});
 assert.notEqual(r.job.item,'white_bed','a bed placed nearby is enough');
 r=plan(counts(have),{sheepNear:2,bedOff:true});
 assert.notEqual(r.job.type,'hunt','a failed bed job sets the bed aside');
 // No sheep: the rung waits on nothing - the diamond pickaxe trip (round 8, task 4): the
 // band from -54 down to -58, strip-mined there, torches held.
 r=valid(plan(counts(have)));
 assert.deepEqual(r.job,{type:'gather',block:'diamond_ore',count:3,radius:32,targetY:-53,bandTop:-53,strip:true});
 r=valid(plan(counts({...have,diamond:3})));
 assert.deepEqual(r.job,{type:'craft',item:'diamond_pickaxe',count:1});
 r=plan(counts(have),{diamondOff:true});
 assert.notEqual(r.job.block,'diamond_ore','a failed trip waits');
 have={...have,diamond_pickaxe:1};
 // Then coal for smelting, then the remaining ore.
 r=valid(plan(counts(have)));
 assert.equal(r.job.type,'gather');assert.equal(r.job.block,'coal_ore');assert.equal(r.job.count,16);
 have={...have,coal:16};
 r=valid(plan(counts(have)));
 assert.equal(r.job.block,'iron_ore');assert.equal(r.job.count,6,'the remaining 17 ore in batches of 6');assert.equal(r.job.targetY,16);
 r=valid(plan(counts({...have,raw_iron:17})));
 assert.equal(r.job.type,'smelt');assert.equal(r.job.count,17);
 have={...have,iron_ingot:17};
 // The ingots for the legs and boots are held now: crafted and worn before the bow.
 r=valid(plan(counts(have)));assert.equal(r.job.item,'iron_leggings');
 have={...have,iron_leggings:1,iron_ingot:10};
 r=valid(plan(counts(have)));assert.equal(r.job.item,'iron_boots');
 have={...have,iron_boots:1,iron_ingot:6};
 r=valid(plan(counts(have)));assert.deepEqual(r.job,{type:'equip'});
 have={...have,_equipped_iron_leggings:1,_equipped_iron_boots:1};
 // Bow: string from spiders is hunted first.
 r=valid(plan(counts(have)));
 assert.equal(r.job.type,'hunt');assert.equal(r.job.entity,'spider');
 have={...have,string:6};
 r=valid(plan(counts(have)));
 assert.equal(r.job.item,'bow');
 have={...have,bow:1};
 // Arrows: flint from gravel, then feathers from chickens, then the craft.
 r=valid(plan(counts(have)));
 assert.equal(r.job.type,'gather');assert.equal(r.job.block,'gravel');
 have={...have,flint:8};
 r=valid(plan(counts(have)));
 assert.equal(r.job.type,'hunt');assert.equal(r.job.entity,'chicken');
 have={...have,feather:8};
 r=valid(plan(counts(have)));
 assert.equal(r.job.item,'arrow');assert.equal(r.job.count,32);
 have={...have,arrow:32};
 // COMBAT_SPEC 7a: the axe (the bucket came with the light, habit 9).
 for(const item of ['iron_axe']){
  r=valid(plan(counts(have)));
  assert.equal(r.step,'iron');assert.equal(r.job.item,item,item);
  have[item]=1;
 }
 r=plan(counts(have));assert.equal(r.step,'bed');
});
test('a worn weapon is replaced before the iron step hunts spiders (COMBAT_SPEC 7a)',()=>{
 const armour={iron_helmet:1,iron_chestplate:1,iron_leggings:1,iron_boots:1,_equipped_iron_helmet:1,_equipped_iron_chestplate:1,_equipped_iron_leggings:1,_equipped_iron_boots:1};
 const have={...STONE,_edible:8,coal:16,torch:16,iron_ingot:36,iron_pickaxe:1,shield:1,diamond_pickaxe:1,water_bucket:1,...armour};
 // Nearly-broken iron sword, no fresh spare: replaced in the best payable tier - iron here.
 let r=plan(counts({...have,iron_sword:1,_worn_iron_sword:1}));
 assert.equal(r.step,'iron');assert.equal(r.job.type,'craft');assert.equal(r.job.item,'iron_sword');
 // With a fresh spare the spider hunt for bow string proceeds.
 r=plan(counts({...have,iron_sword:2,_worn_iron_sword:1}));
 assert.equal(r.job.type,'hunt');assert.equal(r.job.entity,'spider');
});
test('worn combat gear is replaced before the food and bed hunts (COMBAT_SPEC 7a)',()=>{
 // The food step replaces a nearly-broken sword before hunting cows.
 let r=plan(counts({...STONE,_edible:0,_worn_stone_sword:1}),{animalsNearby:'cow',huntPhase:false});
 assert.equal(r.step,'food');assert.equal(r.job.type,'craft');assert.equal(r.job.item,'stone_sword');
 // With a fresh spare the hunt proceeds.
 r=plan(counts({...STONE,_edible:0,stone_sword:2,_worn_stone_sword:1}),{animalsNearby:'cow',huntPhase:false});
 assert.equal(r.job.type,'fight');assert.equal(r.job.entity,'cow');
 // The bed step repairs worn armour before hunting sheep, in the best payable tier.
 r=plan(counts({...IRON,iron_chestplate:1,_worn_iron_chestplate:1,iron_ingot:8}));
 assert.equal(r.step,'bed');assert.equal(r.job.type,'craft');assert.equal(r.job.item,'iron_chestplate');
 // Without iron ingots a worn chestplate is not replaced (the item keeps being used).
 r=plan(counts({...IRON,iron_chestplate:1,_worn_iron_chestplate:1}),{huntPhase:false});
 assert.equal(r.job.type,'fight');assert.equal(r.job.entity,'sheep');
});
test('the bed step hunts sheep for wool and crafts a matching bed',()=>{
 let r=plan(counts({...IRON}),{huntPhase:false});
 assert.equal(r.step,'bed');assert.equal(r.job.type,'fight');assert.equal(r.job.entity,'sheep');
 r=plan(counts({...IRON,_edible:8,red_wool:2}),{huntPhase:true});
 assert.equal(r.job.type,'collect');
 r=plan(counts({...IRON,red_wool:3}));
 assert.equal(r.job.type,'craft');assert.equal(r.job.item,'red_bed');
 r=plan(counts({...IRON,red_wool:3,red_bed:1}));assert.equal(r.step,'home');
});
test('a full inventory deposits at the home chest and the diamond step builds the diamond kit',()=>{
 let r=plan(counts(FULL),{slotsFull:0.9,homeChest:true,home:{x:1,y:-60,z:1}});
 assert.equal(r.step,'home');assert.equal(r.job.type,'deposit');assert.deepEqual(r.job.position,{x:1,y:-60,z:1});
 r=plan(counts(FULL),{slotsFull:0.9,homeChest:false,home:{x:1,y:-60,z:1},chestSpot:{x:2,y:-60,z:1}});
 assert.equal(r.job.type,'place');
 r=plan(counts(FULL),{slotsFull:0.9,homeChest:false,home:null,chestSpot:null});
 assert.equal(r.job.type,'craft');assert.equal(r.job.item,'chest');
 for(const step of STEPS)if(step.name!=='diamonds'&&step.name!=='home')assert.equal(step.done(n=>counts(FULL)[n]||0),true,step.name+' should be done');
 const diamonds=STEPS.find(s=>s.name==='diamonds');
 assert.equal(diamonds.done(n=>counts(FULL)[n]||0),false);
 // COMBAT_SPEC 7a: diamond sword, axe and full armour need 29 diamonds in total.
 assert.deepEqual(diamonds.next(n=>counts({...FULL,diamond:0})[n]||0),{type:'gather',block:'diamond_ore',count:29,radius:32,targetY:-53,bandTop:-53,strip:true});
 // Diamonds on hand are spent piece by piece, cheapest first.
 assert.deepEqual(diamonds.next(n=>counts({...FULL,diamond:2})[n]||0),{type:'craft',item:'diamond_sword',count:1});
 let gear={...FULL,diamond:29};
 for(const item of ['diamond_sword','diamond_axe','diamond_helmet','diamond_chestplate','diamond_leggings','diamond_boots']){
  const job=diamonds.next(n=>counts(gear)[n]||0);
  assert.equal(job.type,'craft');assert.equal(job.item,item,item);
  gear[item]=1;
 }
 assert.equal(diamonds.done(n=>counts(gear)[n]||0),true);
});
test('counts() marks nearly-broken gear so the ladder can replace it before it breaks',()=>{
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'autopilot-test-'));
 try{
  const items=[
   {name:'iron_sword',count:1,durabilityUsed:200},  // 250 max: 20% left -> worn
   {name:'iron_pickaxe',count:1,durabilityUsed:10}, // fresh
   {name:'stone_axe',count:1,durabilityUsed:131}    // broken edge -> worn
  ];
  const worker={
   ready:true,userStopped:false,deathResume:false,jobs:[],log(){},submit(){},
   bot:{time:{timeOfDay:100,day:1},inventory:{items(){return items;}},entities:{},
    registry:{blocksByName:{},foodsByName:{},itemsByName:{iron_sword:{maxDurability:250},iron_pickaxe:{maxDurability:250},stone_axe:{maxDurability:131}}},
    findBlock(){return null;},blockAt(){return null;},entity:{position:{floored(){return {x:0,y:0,z:0,offset(){return this;}};}}}}
  };
  const ap=new Autopilot(worker,root);
  const c=ap.counts();
  assert.equal(c.iron_sword,1);
  assert.equal(c._worn_iron_sword,1);
  assert.equal(c._worn_iron_pickaxe,undefined);
  assert.equal(c._worn_stone_axe,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('the autopilot backs off after a failure instead of storming the queue',()=>{
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'autopilot-test-'));
 try{
  const submitted=[];
  const worker={
   ready:true,userStopped:false,deathResume:false,jobs:[],log(){},
   submit(spec){submitted.push(spec);return {id:'j'+submitted.length};},
   bot:{time:{timeOfDay:100,day:1},inventory:{items(){return [];}},entities:{},registry:{blocksByName:{},foodsByName:{},itemsByName:{}},findBlock(){return null;},blockAt(){return null;},entity:{position:{floored(){return {x:0,y:0,z:0,offset(){return this;}};}}}}
  };
  const ap=new Autopilot(worker,root);
  ap.start();
  ap.tick(); // empty inventory: the ladder submits the wood gather
  assert.equal(submitted.length,1);
  assert.equal(submitted[0].type,'gather');
  ap.settle({status:'failed',message:'Cannot gather safely'});
  assert.ok(ap.state.startsWith('retry: wood'));
  ap.tick();
  assert.equal(submitted.length,1,'no new job while backing off');
  assert.ok(ap.state.startsWith('backing off'),ap.state);
  ap.coolUntil=Date.now()-1; // cooldown elapsed: the ladder retries
  ap.tick();
  assert.equal(submitted.length,2);
  assert.equal(submitted[1].type,'gather');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('a world table or furnace counts as the kit piece so the ladder does not re-craft it',()=>{
 const wood=plan(counts({oak_planks:12,stick:4,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1}),{worldTable:true});
 assert.equal(wood.step,'stone','table already standing finishes wood');
 const stone=plan(counts({...WOOD,stick:10,cobblestone:32,stone_pickaxe:1,stone_sword:1,stone_axe:1,stone_shovel:1}),{worldFurnace:true});
 assert.equal(stone.step,'food','placed furnace finishes stone');
});
test('a stone-step unblock explore does not inherit the wood surface cap',()=>{
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'autopilot-test-'));
 try{
  const submitted=[];
  const worker={
   ready:true,userStopped:false,deathResume:false,jobs:[],log(){},
   submit(spec){jobSchema.parse(spec);submitted.push(spec);return {id:'j'+submitted.length};},
   bot:{time:{timeOfDay:100,day:1},inventory:{items(){return [
    {name:'wooden_pickaxe',count:1},{name:'wooden_sword',count:1},{name:'wooden_axe',count:1},
    {name:'crafting_table',count:1},{name:'oak_planks',count:8},{name:'stick',count:10},{name:'cobblestone',count:32}
   ];}},entities:{},registry:{blocksByName:{crafting_table:{id:1},furnace:{id:2}},foodsByName:{},itemsByName:{}},
    findBlock(){return null;},blockAt(){return null;},entity:{position:{y:86,floored(){return {x:0,y:86,z:0,offset(){return this;}};}}}}
  };
  const ap=new Autopilot(worker,root);
  ap.start();
  ap.lastSurfaceY=131; // leftover from the wood stand
  for(let i=0;i<3;i++){ap.tick();ap.settle({status:'failed',message:'No clear spot to place a crafting_table'});ap.coolUntil=Date.now()-1;}
  ap.tick();
  const explore=submitted[submitted.length-1];
  assert.equal(explore.type,'explore');
  assert.equal(explore.surface,undefined,'stone must not carry the wood surfaceY');
  assert.equal(explore.surfaceY,undefined);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('three failures unblock after the explore leg: the step retries from a new position',()=>{
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'autopilot-test-'));
 try{
  const submitted=[];
  const worker={
   ready:true,userStopped:false,deathResume:false,jobs:[],log(){},
   submit(spec){submitted.push(spec);return {id:'j'+submitted.length};},
   bot:{time:{timeOfDay:100,day:1},inventory:{items(){return [];}},entities:{},registry:{blocksByName:{},foodsByName:{},itemsByName:{}},findBlock(){return null;},blockAt(){return null;},entity:{position:{floored(){return {x:0,y:0,z:0,offset(){return this;}};}}}}
  };
  const ap=new Autopilot(worker,root);
  ap.start();
  for(let i=0;i<3;i++){
   ap.tick();
   ap.settle({status:'failed',message:'No path to the goal!'});
   ap.coolUntil=Date.now()-1;
  }
  // 3rd failure: the wood step is blocked; the next decision explores (not the same gather)
  ap.tick();
  assert.ok(ap.state.startsWith('retry: wood'),'unblocked after the explore was submitted: '+ap.state);
  const kinds=submitted.map(x=>x.type);
  assert.ok(kinds.includes('explore'),'an explore leg was submitted: '+JSON.stringify(kinds));
  assert.equal(submitted[submitted.length-1].type,'explore');
  // The explore completes: the ladder retries the wood gather from the new position
  // (regression: the blocked state used to stick forever -> explore circles, wood never
  // retried - measured in soak 20261012-020850 run 1: 13+ path failures, no retry).
  ap.settle({status:'complete',message:'ok'});
  ap.tick();
  assert.equal(submitted[submitted.length-1].type,'gather','wood retried after the explore');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('round 32: a worn shovel replacement needs 2 sticks, and a craft that failed 3 times is skipped',()=>{
 const armour={iron_helmet:1,iron_chestplate:1,iron_leggings:1,iron_boots:1,_equipped_iron_helmet:1,_equipped_iron_chestplate:1,_equipped_iron_leggings:1,_equipped_iron_boots:1};
 const have={...STONE,_edible:8,coal:16,torch:16,iron_ingot:0,cobblestone:0,iron_pickaxe:1,iron_sword:2,shield:1,diamond_pickaxe:1,water_bucket:1,...armour,stone_shovel:1,_worn_stone_shovel:1,diamond:1};
 // Round-32 normal1: 1 diamond, 1 stick - `diamond_shovel` was submitted 42 times.
 let r=plan(counts({...have,stick:1}));
 assert.notEqual(r.job?.item,'diamond_shovel','1 stick cannot make a shovel');
 r=plan(counts({...have,stick:2}));
 assert.equal(r.job.item,'diamond_shovel','2 sticks can');
 r=plan(counts({...have,stick:2}),{kitSkip:{diamond_shovel:Date.now()+60000}});
 assert.notEqual(r.job?.item,'diamond_shovel','set aside after 3 failed crafts');
});
import {tableFirst} from '../src/autopilot.js';
test('round 33: a table craft with no table and no planks fetches planks first',()=>{
 const c=n=>({oak_log:0}[n]||0);
 const craft={type:'craft',item:'iron_leggings',count:1};
 assert.equal(tableFirst(c,{planksTotal:0,logsTotal:0},craft).type,'gather','no logs: gather logs');
 assert.deepEqual(tableFirst(c,{planksTotal:0,logsTotal:3,heldLog:'oak_log'},craft),{type:'craft',item:'oak_planks',count:4});
 assert.equal(tableFirst(c,{planksTotal:4,logsTotal:0},craft),craft,'4 planks make the table');
 assert.equal(tableFirst(c,{planksTotal:0,logsTotal:0,worldTable:true},craft),craft,'a table in the world');
 assert.equal(tableFirst(n=>n==='crafting_table'?1:0,{planksTotal:0,logsTotal:0},craft),craft,'a table held');
 assert.equal(tableFirst(c,{planksTotal:0,logsTotal:0},{type:'craft',item:'stick',count:1}).item,'stick','hand crafts need no table');
});
import {gearFor} from '../src/autopilot.js';
test('round 34: the bow and arrows are optional once their supply runs failed 3 times',()=>{
 const have={...IRON,coal:16,iron_ingot:36,_equipped_iron_helmet:1,_equipped_iron_chestplate:1,_equipped_iron_leggings:1,_equipped_iron_boots:1,diamond_pickaxe:1,bow:0,arrow:0,string:0};
 let r=plan(counts(have));
 assert.equal(r.step,'iron');assert.deepEqual([r.job.type,r.job.entity],['hunt','spider'],JSON.stringify(r.job));
 const later=Date.now()+60000;
 r=plan(counts(have),{kitSkip:{bow:later}});
 assert.notEqual(r.job?.entity,'spider','the bow is set aside');
 r=plan(counts(have),{kitSkip:{bow:later,arrow:later}});
 assert.notEqual(r.step,'iron','with both set aside the iron step is done');
 assert.equal(gearFor({type:'hunt',entity:'spider'}),'bow');
 assert.equal(gearFor({type:'gather',block:'gravel'}),'arrow');
 assert.equal(gearFor({type:'hunt',entity:'chicken'}),'arrow');
 assert.equal(gearFor({type:'craft',item:'iron_sword'}),null);
});
import {Autopilot as AP35} from '../src/autopilot.js';
test('round 35: the second deep-underground failure round climbs to the surface',()=>{
 const ap=Object.create(AP35.prototype);const logs=[],subs=[];
 Object.assign(ap,{failures:{},state:'',lastSurfaceY:131,log:m=>logs.push(m),submit:(s,spec)=>subs.push(spec),deepUnderground:()=>true,
  worker:{log(){},jobs:[],bot:null},current:null});
 const fail=()=>{ap.current={step:'iron',spec:{type:'craft',item:'shield',count:1}};ap.settle({status:'failed',message:'Missing ingredients or a nearby crafting table'});};
 for(let i=0;i<3;i++)fail();
 assert.equal(subs.length,0,'the first round only cools down');
 assert.ok(logs.some(l=>/retrying in 20 s/.test(l)));
 for(let i=0;i<3;i++)fail();
 assert.deepEqual(subs,[{type:'ascend',y:131}],'the second climbs out');
 assert.ok(logs.some(l=>/climbing to the surface/.test(l)));
});
test('round 36: a smelt with no fuel held fetches logs first',()=>{
 const none=()=>0;
 const smelt={type:'smelt',item:'chicken',count:1};
 assert.equal(tableFirst(none,{planksTotal:0,logsTotal:0},smelt).block,'log');
 assert.equal(tableFirst(n=>n==='coal'?1:0,{planksTotal:0,logsTotal:0},smelt),smelt,'coal is fuel');
 assert.equal(tableFirst(none,{planksTotal:2,logsTotal:0},smelt),smelt,'planks are fuel');
 assert.equal(tableFirst(none,{planksTotal:0,logsTotal:1},smelt),smelt,'a log is fuel');
 const take={type:'smelt',item:'raw_iron',count:3,take:true};
 assert.equal(tableFirst(none,{planksTotal:0,logsTotal:0},take),take,'collecting needs no fuel');
});
test('round 37: a skipped stone pickaxe is not re-submitted as the iron step spare',()=>{
 const have={...STONE,_edible:8,stone_pickaxe:1,cobblestone:20,stick:4,crafting_table:1,furnace:1,coal:4};
 let r=plan(counts(have));
 assert.deepEqual([r.step,r.job.type,r.job.item],['iron','craft','stone_pickaxe'],'the spare: '+JSON.stringify(r.job));
 r=plan(counts(have),{kitSkip:{stone_pickaxe:Date.now()+60000}});
 assert.notEqual(r.job?.item,'stone_pickaxe');
});
import {Autopilot as AP38,HOME_FAR} from '../src/autopilot.js';
import {Vec3 as V38} from 'vec3';
test('round 38: a saved home over HOME_FAR away (another world) is forgotten',()=>{
 const ap=Object.create(AP38.prototype);const logs=[];let saved=0;
 Object.assign(ap,{home:{x:1,y:-60,z:0},homeChest:true,homeChestAt:{x:306,y:119,z:11},log:m=>logs.push(m),save:()=>{saved++;},worker:{}});
 const b={entity:{position:new V38(310,131,30)}};
 ap.forgetFar(b);
 assert.equal(ap.home,null);assert.equal(ap.homeChest,false);assert.equal(saved,1);
 assert.ok(logs.some(l=>/forgot the home at 1,-60,0/.test(l)));
 // A home nearby stays.
 Object.assign(ap,{home:{x:300,y:120,z:20},homeChest:true,homeChestAt:{x:300,y:120,z:20}});
 ap.forgetFar(b);assert.deepEqual(ap.home,{x:300,y:120,z:20});
 assert.ok(HOME_FAR>=128);
});
import {duskKitJob,escapeY} from '../src/autopilot.js';
test('round 39: the sunset grace turns held ingots into an iron pick; escape climbs never aim below sea level',()=>{
 const have={...STONE,iron_ingot:4,stick:2};
 assert.deepEqual(duskKitJob(counts(have),{worldFurnace:true}),{type:'craft',item:'iron_pickaxe',count:1,keepTable:true});
 assert.deepEqual(duskKitJob(counts({...have,stick:0}),{worldFurnace:true}).item,'stick','sticks first');
 assert.equal(duskKitJob(counts({...have,iron_pickaxe:1}),{worldFurnace:true}),null,'already held');
 assert.equal(escapeY(-38),62);assert.equal(escapeY(131),131);assert.equal(escapeY(null),64);
});
test('round 41: a timed-out chicken fight leaves chickens alone for a while',()=>{
 const ap=Object.create(AP38.prototype);const logs=[];
 Object.assign(ap,{failures:{},state:'',log:m=>logs.push(m),deepUnderground:()=>false,worker:{log(){},jobs:[]},current:{step:'food',spec:{type:'fight',entity:'chicken'}}});
 ap.settle({status:'failed',message:'Fight timed out; chicken is still standing'});
 assert.ok(ap.huntOff.chicken>Date.now());
 assert.ok(logs.some(l=>/chicken hunt timed out; leaving chickens alone/.test(l)));
 const me={position:new V38(0,64,0)};
 const b={entity:me,entities:{1:me,2:{name:'chicken',position:new V38(5,64,0)},3:{name:'chicken',position:new V38(6,64,0)},4:{name:'cow',position:new V38(20,64,0)}}};
 assert.equal(ap.animalsNearby(b).type,'cow','chickens skipped, the cow is the target');
 ap.huntOff.chicken=Date.now()-1;
 assert.equal(ap.animalsNearby(b).type,'chicken','back after the window');
});
test('round 47: the fuel held must cover the smelt count',()=>{
 const none=()=>0;const smelt2={type:'smelt',item:'porkchop',count:2,leave:true};
 assert.equal(tableFirst(none,{planksTotal:0,logsTotal:1},smelt2).block,'log','one log burns 1.5: short of 2');
 assert.equal(tableFirst(none,{planksTotal:1,logsTotal:1},smelt2),smelt2,'a log and a plank burn 3');
 assert.equal(tableFirst(n=>n==='coal'?1:0,{planksTotal:0,logsTotal:0},{type:'smelt',item:'raw_iron',count:8}).type,'smelt','one coal smelts 8');
 assert.equal(tableFirst(n=>n==='coal'?1:0,{planksTotal:0,logsTotal:0},{type:'smelt',item:'raw_iron',count:9}).block,'log','9 is past one coal');
});
test('round 49: with a warden near, climbing out is the only job and a paused ascend is not superseded',()=>{
 const ap=Object.create(AP38.prototype);const subs=[],logs=[];
 const warden={name:'warden',position:new V38(10,3,0)};
 Object.assign(ap,{log:m=>logs.push(m),submit:(st,spec)=>subs.push(spec),state:'',lastSurfaceY:131,counts:()=>({}),forgetFar(){},worker:{jobs:[]}});
 const b={entity:{position:new V38(0,3,0)},entities:{1:warden}};
 ap.decide(b);
 assert.deepEqual(subs,[{type:'ascend',y:131}]);assert.ok(logs.some(l=>/a warden 10 away; climbing out/.test(l)));
 ap.worker.jobs=[{status:'paused',spec:{type:'ascend',y:131}}];subs.length=0;
 ap.decide(b);
 assert.deepEqual(subs,[],'the paused ascend is left to resume - no drop, no gather');
 assert.equal(ap.state,'warden near: climbing out');
});
import {inventoryJob,surplus,obsoleteTool} from '../src/autopilot.js';
test('round 50: wooden tools beside better ones are junk, so a full bag of kit can drop them',()=>{
 const counts={stone_pickaxe:2,iron_pickaxe:1,wooden_pickaxe:1,wooden_sword:1,stone_sword:1,wooden_axe:1,furnace:1,brown_wool:1,white_wool:1,flint:1};
 assert.equal(obsoleteTool('wooden_axe',counts),false,'no better axe held');
 assert.equal(obsoleteTool('wooden_pickaxe',counts),true);
 const j=inventoryJob(counts,{slotsFull:35/36,planksTotal:0,noCraft:true});
 assert.equal(j.type,'drop');assert.match(j.item,/^wooden_(pickaxe|sword)$/);
 assert.ok(!surplus({wooden_pickaxe:1},true).some(s=>s.item==='wooden_pickaxe'),'the only pickaxe is kept');
});
test('round 50: the wood step stays done after its wooden tools are replaced and dropped',()=>{
 const later={oak_log:16,oak_planks:8,stick:6,crafting_table:1,stone_pickaxe:1,stone_sword:1,stone_axe:1,cobblestone:20,furnace:1,stone_shovel:1};
 const r=plan(counts(later));
 assert.notEqual(r.step,'wood','no wooden tools held, stone ones are: the wood step is done');
 assert.notEqual(r.job?.item,'wooden_pickaxe');
});
