import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import reg from 'prismarine-registry';
import {Worker,farmBlock,farmHarvest,guardDig,farmSafeMoves} from '../src/worker.js';
console.error=()=>{};

// Round 112: the round-111 soak's hard3 climbed out of a night-mine box up through the floor of
// the group's nether wart farm (soul_sand is natural ground to the dig rules) and ended with 5
// nether_wart in its bag. No dig of a crop, farmland or the block a crop grows on.
const registry=reg('1.21.4');
const SOLID=new Set(['stone','dirt','soul_sand','farmland','cobblestone']);
function world(cells){
 return p=>{const x=Math.floor(p.x),y=Math.floor(p.y),z=Math.floor(p.z),name=cells[x+','+y+','+z]||'air',b=registry.blocksByName[name];
  return {name,type:b.id,position:new Vec3(x,y,z),boundingBox:SOLID.has(name)?'block':'empty',diggable:true,hardness:b.hardness,material:b.material,transparent:b.transparent,shapes:SOLID.has(name)?[[0,0,0,1,1,1]]:[]};};
}
// a 3x3 wart farm: soul_sand at y=99, nether_wart on it at y=100, dirt around and under it
function farm(){
 const c={};
 for(let x=910;x<=918;x++)for(let z=-448;z<=-440;z++){c[x+',98,'+z]='dirt';c[x+',99,'+z]='dirt';}
 for(let x=913;x<=915;x++)for(let z=-445;z<=-443;z++){c[x+',99,'+z]='soul_sand';c[x+',100,'+z]='nether_wart';}
 return c;
}

test('round 112: the farm blocks - the crop, farmland, the soul sand under a wart; not bare soul sand',()=>{
 const c=farm();c['920,99,-444']='soul_sand';c['921,99,-444']='farmland';
 const bot={blockAt:world(c)};
 const at=(x,y,z)=>bot.blockAt(new Vec3(x,y,z));
 assert.equal(farmBlock(bot,at(914,99,-444)),'under a nether_wart crop');
 assert.equal(farmBlock(bot,at(914,100,-444)),'a crop');
 assert.equal(farmBlock(bot,at(921,99,-444)),'farmland');
 assert.equal(farmBlock(bot,at(920,99,-444)),null,'bare soul sand is still natural ground');
 assert.equal(farmBlock(bot,at(916,99,-444)),null,'the dirt rim beside the farm');
 // a gather job harvests the crop it names - never a wart, never the ground under a crop
 assert.equal(farmHarvest({name:'wheat'},{type:'gather',block:'wheat'}),true);
 assert.equal(farmHarvest({name:'carrots'},{type:'gather',block:'carrot'}),true);
 assert.equal(farmHarvest({name:'nether_wart'},{type:'gather',block:'nether_wart'}),false);
 assert.equal(farmHarvest({name:'soul_sand'},{type:'gather',block:'soul_sand'}),false);
 assert.equal(farmHarvest({name:'wheat'},{type:'shelter'}),false);
});

test('round 112: bot.dig refuses a farm block once-logged; plain ground and a wheat harvest go through',async()=>{
 const c=farm();c['914,99,-450']='wheat';c['914,98,-450']='farmland';
 const dug=[],logs=[];let spec={type:'shelter'};
 const bot={blockAt:world(c),async dig(b){dug.push(b.name+'@'+b.position);}};
 guardDig(bot,m=>logs.push(m),()=>spec);
 const at=(x,y,z)=>bot.blockAt(new Vec3(x,y,z));
 await assert.rejects(bot.dig(at(914,99,-444)),/Farm guard: soul_sand at \(914, 99, -444\) is under a nether_wart crop/);
 await assert.rejects(bot.dig(at(914,99,-444)),/Farm guard/);
 await assert.rejects(bot.dig(at(914,98,-450)),/is farmland/);
 assert.deepEqual(logs,["Farm guard: not breaking soul_sand at (914, 99, -444) - under a nether_wart crop; a player-made farm (job shelter)",
  "Farm guard: not breaking farmland at (914, 98, -450) - farmland; a player-made farm (job shelter)"],'one line a block');
 await bot.dig(at(916,99,-444));
 spec={type:'gather',block:'wheat'};
 await bot.dig(at(914,99,-450));
 await assert.rejects(bot.dig(at(914,100,-444)),/nether_wart at \(914, 100, -444\) is a crop/);
 assert.deepEqual(dug,['dirt@(916, 99, -444)','wheat@(914, 99, -450)']);
});

test('round 112: the pathfinder never plans a farm dig, and the climb out stops under the farm floor',async()=>{
 const c=farm();
 const bot={registry,version:'1.21.4',blockAt:world(c),world:{getBlock:p=>world(c)(p)},entity:{position:new Vec3(914.5,96,-443.5)}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,log(){},avoidHazards(){},applyMobAvoidance(){}});
 const at=(x,y,z)=>bot.blockAt(new Vec3(x,y,z));
 for(const m of [w.exploreMovements(),w.normalMovements(bot)]){
  m.canDig=true; // the stranded dig turns it on for the normal movements
  assert.equal(m.safeToBreak(at(914,99,-444)),false,'the soul sand under a wart');
  assert.equal(m.safeToBreak(at(916,99,-444)),true,'the dirt rim');
 }
 // a stub movements object: the guard is put in front of whatever the base allows
 const s=farmSafeMoves({safeToBreak:()=>true},bot);
 assert.equal(s.safeToBreak(at(913,99,-445)),false);assert.equal(s.safeToBreak(at(912,99,-445)),true);
 // the sky climb out of a box under the farm: its pillar treats the soul sand as a ceiling
 const pillars=[];
 Object.assign(w,{check(){},strandedTunnel:null,
  navigate:async()=>{bot.entity.position=new Vec3(914.5,97,-443.5);throw Error('No path to the goal!');},
  pillarUp:async(target,token,opts)=>{pillars.push(opts);return false;}});
 bot.health=20;
 await w.ascend({spec:{type:'ascend',y:100,sky:true}},0).catch(()=>{});
 assert.ok(pillars.length>0,'the climb pillars');
 for(const o of pillars){
  assert.equal(o.clear(at(914,99,-444)),false,'no digging the wart farm floor');
  assert.equal(o.clear(at(916,99,-444)),true,'the dirt beside it is fine');
 }
});
