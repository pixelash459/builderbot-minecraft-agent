// Round 14 (round-13 soak): diamond trips stopped on water beside the staircase, a full bag
// looped `No room for crafting result`, tosses were refused in cramped tunnels, the shear
// job retried a shorn sheep, and the bucket retried the same unreachable pool.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Vec3} from 'vec3';
import {planTunnelStep,fluidBeside,openStandNear,pickSheep,sheepWool} from '../src/worker.js';
import {Autopilot,NO_ROOM_MS} from '../src/autopilot.js';
import {jobSchema} from '../src/schema.js';
const air={name:'air',boundingBox:'empty'},stone={name:'stone',boundingBox:'block'},water={name:'water',boundingBox:'empty'};
// Solid stone below y=64, air above, plus overrides.
function world(over={}){return (x,y,z)=>over[x+','+y+','+z]||(y>=64?air:stone);}
test('fluidBeside: water touching a cell the step digs',()=>{
 const at=world({'2,63,1':water});
 assert.deepEqual(fluidBeside(at,{x:1,y:63,z:1},true),{name:'water'});
 assert.equal(fluidBeside(world(),{x:1,y:63,z:1},true),null);
});
test('planTunnelStep turns away from water beside the next staircase step',()=>{
 const at=world({'2,62,0':water}); // beside the step east of the bot (1,62,0)
 const b={entity:{position:new Vec3(0.5,63,0.5)},blockAt:p=>at(p.x,p.y,p.z),inventory:{items:()=>[{name:'cobblestone',count:10}]}};
 const plan=planTunnelStep(b,{},new Vec3(1,0,0),-1);
 assert.ok(plan.next,'a way on: '+plan.why);
 assert.ok(plan.turned,'turned');
 assert.match(plan.why[0],/water beside/);
 assert.notEqual(plan.dir.x,1);
});
test('openStandNear: the nearest stand with room to toss',()=>{
 // a 1-wide pocket at the bot, and a 6-long corridor 3 blocks north at y=-34
 const open=new Set(['0,-34,0','0,-33,0']);
 for(let x=0;x<6;x++){open.add(x+',-34,-3');open.add(x+',-33,-3');}
 for(let z=-2;z<0;z++){open.add('0,-34,'+z);open.add('0,-33,'+z);}
 const b={entity:{position:new Vec3(0.5,-34,0.5)},blockAt:p=>open.has(p.x+','+p.y+','+p.z)?air:stone};
 assert.deepEqual(openStandNear(b),{x:0,y:-34,z:-3});
 const shut={entity:{position:new Vec3(0.5,-34,0.5)},blockAt:p=>p.x===0&&p.z===0&&(p.y===-34||p.y===-33)?air:stone};
 assert.equal(openStandNear(shut,4),null);
});
test('sheep: shorn ones are skipped, the wanted colour comes first',()=>{
 const me=new Vec3(0,64,0);
 const sh=(id,x,wool)=>({id,name:'sheep',position:new Vec3(x,64,0),metadata:{17:wool}});
 assert.deepEqual(sheepWool(sh(1,0,0x10|12)),{sheared:true,color:'brown'});
 assert.equal(sheepWool({metadata:{}}),null);
 const list=[sh(1,2,0x10),sh(2,3,12),sh(3,6,0)];
 assert.equal(pickSheep(list,me,new Set(),'white_wool').id,3,'the white one, past a nearer brown one');
 assert.equal(pickSheep(list,me,new Set(),'brown_wool').id,2);
 assert.equal(pickSheep(list,me,new Set([2,3]),'white_wool'),null,'all shorn');
});
function autopilot(items){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r14-'));
 const submitted=[],jobs=[];
 const inv=()=>Object.entries(items).filter(([,n])=>n>0).map(([name,count])=>({name,count}));
 const worker={ready:true,userStopped:false,deathResume:false,jobs,log(){},slotsFull:()=>inv().length/36,
  submit(spec){jobSchema.parse(spec);submitted.push(spec);const job={id:'j'+submitted.length,status:'running',spec};jobs.push(job);return job;},cancel(){},
  bot:{time:{timeOfDay:3000,day:3},inventory:{items:inv,slots:[]},entities:{},
   registry:{blocksByName:{},foodsByName:{cooked_beef:{}},itemsByName:{}},findBlock(){return null;},blockAt(){return null;},
   entity:{position:new Vec3(0.5,64,0.5)}}};
 const ap=new Autopilot(worker,root);
 return {ap,jobs,submitted,done(){fs.rmSync(root,{recursive:true,force:true});}};
}
test('autopilot: `No room for crafting result` stops crafting for a while and clears junk first',()=>{
 const t=autopilot({oak_planks:8,stick:10,crafting_table:1,wooden_pickaxe:1});
 try{
  t.ap.start();t.ap.tick();
  const first=t.jobs.at(-1);assert.ok(first,'a job');
  first.status='failed';first.message='No room for crafting result';t.ap.invOffUntil=Date.now()+60000;t.ap.tick();
  assert.ok(t.ap.noRoomUntil>Date.now()+NO_ROOM_MS-1000);
  assert.equal(t.ap.invOffUntil,0,'the inventory step is due again');
  const n=t.submitted.length;
  t.ap.worker.slotsFull=()=>1; // every slot taken
  t.ap.submit('light',{type:'craft',item:'torch',count:4});
  assert.equal(t.submitted.length,n,'no craft while the bag is full');
  assert.match(t.ap.state,/bag full/);
  // Round 15: a slot frees up - crafting is back on at once.
  t.ap.worker.slotsFull=()=>35/36;
  t.ap.submit('light',{type:'craft',item:'torch',count:4});
  assert.equal(t.submitted.length,n+1,'a free slot: the craft goes out');
  assert.equal(t.ap.noRoomUntil,0);
 }finally{t.done();}
});
test('autopilot: a failed bucket source rules out the pool around it',()=>{
 const t=autopilot({bucket:1});
 try{
  const src=[new Vec3(316,114,15),new Vec3(330,64,0)];
  Object.assign(t.ap.worker.bot,{registry:{...t.ap.worker.bot.registry,blocksByName:{water:{id:9}}},
   findBlocks:()=>src,blockAt:p=>p.y===115||p.y===65?air:{name:'water',metadata:0,boundingBox:'empty'}});
  t.ap.worker.bot.entity.position=new Vec3(316,130,15);
  assert.deepEqual(t.ap.waterSource(t.ap.worker.bot),{x:316,y:114,z:15});
  t.ap.badWater=new Map([['317,113,18',Date.now()+600000]]);
  assert.deepEqual(t.ap.waterSource(t.ap.worker.bot),{x:330,y:64,z:0},'the pool 3 blocks from the failed source is skipped');
 }finally{t.done();}
});
