import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,pillarSource,PILLAR_HARVEST_TRIES} from '../src/worker.js';
console.error=()=>{};

// Round-121 hard3, death 1: a box pinned 30 s past dawn climbed out through its roof with no
// blocks left (`Pillar: stopped at y=89 (no blocks held)` twice, one level short of the rise the
// climb needed), went back to `holding the box` with the roof open and burned to death beside a
// zombie 30 s later. A pillar that may dig takes its block from the wall beside it.
const AIR={name:'air',boundingBox:'empty'};
// A 1-wide shaft in `rock` over the floor at y=63; the jump lifts the bot, a placed block holds it there.
function shaft({rock='stone',inv={stone_pickaxe:1},fluidAt=null,dropDelay=0,wallAt=()=>true}={}){
 const w=Object.create(Worker.prototype),calls=[],dug=new Set(),placed=new Set();
 const key=p=>p.x+','+p.y+','+p.z;
 const bot={entity:{position:new Vec3(0.5,64,0.5),onGround:true},heldItem:null,pathfinder:null,
  inventory:{items:()=>Object.entries(inv).filter(([,n])=>n>0).map(([name,count])=>({name,count}))},
  tool:{equipForBlock:async()=>{}},
  blockAt(p){
   p=p.floored();
   if(fluidAt&&fluidAt(p))return {name:'lava',boundingBox:'empty',position:p};
   if(placed.has(key(p)))return {name:'cobblestone',boundingBox:'block',position:p};
   if(dug.has(key(p)))return {...AIR,position:p};
   if(p.x===0&&p.z===0)return p.y<=63?{name:rock,boundingBox:'block',position:p}:{...AIR,position:p};
   return wallAt(p)?{name:rock,boundingBox:'block',position:p}:{...AIR,position:p};
  },
  dig:async bl=>{calls.push('dig '+key(bl.position));dug.add(key(bl.position));const drop=bl.name==='stone'?'cobblestone':bl.name==='grass_block'?'dirt':bl.name;
   const give=()=>{inv[drop]=(inv[drop]||0)+1;};if(dropDelay)setTimeout(give,dropDelay).unref();else give();},
  equip:async()=>{},
  setControlState(c,on){if(c==='jump'&&on)bot.entity.position.y+=1.1;},
  clearControlStates(){},
  placeBlock:async ref=>{const at=ref.position.offset(0,1,0);placed.add(key(at));const n=Object.keys(inv).find(k=>/^(cobblestone|dirt)$/.test(k)&&inv[k]>0);inv[n]--;bot.entity.position.y=at.y+1;calls.push('place '+key(at));}};
 Object.assign(w,{bot,logs:[],log(m){this.logs.push(m);},check(){},epoch:1});
 return {w,bot,calls,inv};
}
const safe=()=>true;
test('pillarSource: dirt by hand, stone and its kin only with a pickaxe, nothing else',()=>{
 assert.equal(pillarSource('dirt',false),true);assert.equal(pillarSource('grass_block',false),true);
 assert.equal(pillarSource('stone',false),false);assert.equal(pillarSource('stone',true),true);
 assert.equal(pillarSource('deepslate',true),true);assert.equal(pillarSource('cobblestone',true),true);
 for(const n of ['oak_leaves','gravel','sand','iron_ore','chest','obsidian',undefined])assert.equal(pillarSource(n,true),false,String(n));
});
test('a digging pillar with no blocks takes one from the wall beside the head, level after level',async()=>{
 const t=shaft();
 const ok=await t.w.pillarUp(66,1,{clear:safe,maxDigs:8});
 assert.equal(ok,true,t.w.logs.join(' | '));
 assert.equal(Math.floor(t.bot.entity.position.y),66);
 assert.deepEqual(t.calls.slice(0,2),['dig 1,65,0','place 0,64,0'],'the wall block beside the head, then the pillar block');
 assert.equal(t.calls.filter(c=>c.startsWith('place')).length,2);
 assert.ok(t.w.logs.some(m=>/^Pillar: no blocks held at y=64; dug the stone beside the head for one$/.test(m)),t.w.logs.join(' | '));
 assert.ok(!t.w.logs.some(m=>/stopped at/.test(m)));
});
test('no pickaxe in stone, a pillar that may not dig, or lava behind the wall: it stops as before',async()=>{
 let t=shaft({inv:{}});
 assert.equal(await t.w.pillarUp(66,1,{clear:safe,maxDigs:8}),false);
 assert.deepEqual(t.calls,[]);
 assert.ok(t.w.logs.some(m=>/^Pillar: stopped at y=64 \(no blocks held\)$/.test(m)));
 t=shaft();
 assert.equal(await t.w.pillarUp(66,1),false);
 assert.deepEqual(t.calls,[],'no clear: the canopy and box pillars never dig a wall');
 t=shaft();
 assert.equal(await t.w.pillarUp(66,1,{clear:bl=>/_leaves$/.test(bl.name)}),false);
 assert.deepEqual(t.calls,[]);
 t=shaft({fluidAt:p=>Math.abs(p.x)>=2||Math.abs(p.z)>=2||(Math.abs(p.x)===1&&Math.abs(p.z)===1)});
 assert.equal(await t.w.pillarUp(66,1,{clear:safe,maxDigs:8}),false);
 assert.deepEqual(t.calls,[],'every wall block has lava on a side');
});
test('dirt comes out by hand, and the feet-level wall is used when the head-level one is open',async()=>{
 const t=shaft({rock:'dirt',inv:{},wallAt:p=>p.y<=64});
 assert.equal(await t.w.pillarUp(65,1,{clear:safe,maxDigs:8}),true,t.w.logs.join(' | '));
 assert.equal(t.calls[0],'dig 1,64,0');
 assert.ok(t.w.logs.some(m=>/dug the dirt beside the feet for one/.test(m)));
});
test('a drop that never reaches the bag: at most PILLAR_HARVEST_TRIES wall blocks, then the stop line',async()=>{
 const t=shaft({dropDelay:600000});
 const t0=Date.now();
 assert.equal(await t.w.pillarUp(66,1,{clear:safe,maxDigs:1}),false);
 assert.equal(t.calls.filter(c=>c.startsWith('dig')).length,PILLAR_HARVEST_TRIES);
 assert.ok(Date.now()-t0<6000);
 assert.ok(t.w.logs.some(m=>/stopped at y=64 \(no blocks held\)/.test(m)));
});
