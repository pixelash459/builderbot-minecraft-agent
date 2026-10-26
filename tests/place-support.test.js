import test from 'node:test';
import assert from 'node:assert/strict';
import {solidSupport,SOFT_BREAK,HARD_BREAK,placementCells,softBreakCell,hitsBot} from '../src/place-support.js';

const solid=(name,x,y,z)=>({name,boundingBox:'block',position:{x,y,z}});
const air=(x,y,z)=>({name:'air',boundingBox:'empty',position:{x,y,z}});
const plant=(name,x,y,z)=>({name,boundingBox:'block',replaceable:true,position:{x,y,z}});
function world(){
 const map=new Map();
 const put=(x,y,z,b)=>map.set(x+','+y+','+z,b);
 const blockAt=(x,y,z)=>map.get(x+','+y+','+z)||null;
 return{map,put,blockAt};
}
function flatFloor(w,y=9,r=5){
 for(let x=-r;x<=r;x++)for(let z=-r;z<=r;z++){
  w.put(x,y,z,solid('grass_block',x,y,z));
  w.put(x,y+1,z,air(x,y+1,z));
  w.put(x,y+2,z,air(x,y+2,z));
 }
}
const cellOf=(list,x,y,z)=>list.find(e=>e.cell.x===x&&e.cell.y===y&&e.cell.z===z);
const cellKey=e=>e.cell.x+','+e.cell.y+','+e.cell.z;
const FEET={x:0,y:10,z:0};

test('snow-layer ground is not a crafting support even when its box is a block',()=>{
 assert.equal(solidSupport({name:'snow',boundingBox:'block'}),false);
 assert.equal(solidSupport({name:'powder_snow',boundingBox:'block',replaceable:true}),false);
 assert.equal(solidSupport({name:'moss_carpet',boundingBox:'block'}),false);
 assert.equal(solidSupport({name:'dirt',boundingBox:'block'}),true);
 assert.equal(solidSupport({name:'grass_block',boundingBox:'block'}),true);
 assert.equal(solidSupport({name:'air',boundingBox:'empty'}),false);
 assert.equal(solidSupport(null),false);
});

test('SOFT_BREAK matches hand-breakable natural blocks only',()=>{
 for(const name of ['oak_leaves','dark_oak_leaves','short_grass','fern','dirt','grass_block','snow','spruce_sapling','red_mushroom'])
  assert.ok(SOFT_BREAK.test(name),name+' should match');
 for(const name of ['oak_planks','oak_log','crafting_table','stone','cobblestone','water','lava'])
  assert.ok(!SOFT_BREAK.test(name),name+' should not match');
});

test('flat floor: candidates sit on the floor, feet/head excluded, nearest first',()=>{
 const w=world();flatFloor(w);
 const list=placementCells(w.blockAt,FEET);
 assert.ok(list.length>0);
 // only the y=10 layer is placeable and supported here
 assert.ok(list.every(e=>e.cell.y===10),JSON.stringify(list.map(cellKey)));
 // every support is the floor below, face points up
 for(const e of list){
  assert.equal(e.support.name,'grass_block');
  assert.deepEqual(e.support,{x:e.cell.x,y:9,z:e.cell.z,name:'grass_block'});
  assert.deepEqual(e.face,{x:0,y:1,z:0});
  assert.equal(e.reach,null);
  assert.equal(e.inReach,true);
 }
 // own feet and head cells never proposed
 assert.equal(cellOf(list,0,10,0),undefined);
 assert.equal(cellOf(list,0,11,0),undefined);
 // nearest-first: the four orthogonal neighbours precede anything farther
 const first4=new Set(list.slice(0,4).map(cellKey));
 assert.deepEqual([...first4].sort(),['-1,10,0','0,10,-1','0,10,1','1,10,0']);
 assert.ok(list.findIndex(e=>cellKey(e)==='2,10,0')>3);
});

test('cluttered dark-oak floor: plants and air stay placeable, logs never proposed',()=>{
 const w=world();
 for(let x=-3;x<=3;x++)for(let z=-3;z<=3;z++){
  w.put(x,9,z,solid('dirt',x,9,z));
  w.put(x,10,z,air(x,10,z));
  w.put(x,11,z,air(x,11,z));
 }
 w.put(1,10,0,plant('short_grass',1,10,0));
 w.put(-1,10,0,plant('fern',-1,10,0));
 w.put(0,10,1,plant('snow',0,10,1));
 for(const[x,z,y] of [[2,0,10],[2,1,10],[2,0,11],[2,1,11]])w.put(x,y,z,solid('dark_oak_log',x,y,z));
 const list=placementCells(w.blockAt,FEET);
 for(const e of list){
  const b=w.blockAt(e.cell.x,e.cell.y,e.cell.z);
  assert.ok(!b||b.replaceable||b.name==='air','solid cell proposed: '+cellKey(e));
  assert.ok(!/crafting_table$/.test(e.support.name));
 }
 // replaceable plants are placeable-into and keep the dirt floor as support
 const grass=cellOf(list,1,10,0),fern=cellOf(list,-1,10,0),snow=cellOf(list,0,10,1);
 assert.ok(grass&&fern&&snow);
 assert.equal(grass.support.name,'dirt');
 assert.deepEqual(fern.face,{x:0,y:1,z:0});
 assert.equal(snow.support.name,'dirt');
 // log column cells are never candidates
 for(const[x,y,z] of [[2,10,0],[2,10,1],[2,11,0],[2,11,1]])assert.equal(cellOf(list,x,y,z),undefined);
});

test('no candidates when everything is solid, unsupported, or unknown',()=>{
 const allSolid=()=>solid('stone',0,0,0);
 assert.deepEqual(placementCells(allSolid,FEET),[]);
 const allAir=(x,y,z)=>air(x,y,z); // placeable but nothing solid to click
 assert.deepEqual(placementCells(allAir,FEET),[]);
 const unknown=()=>null; // unloaded chunks are not candidates
 assert.deepEqual(placementCells(unknown,FEET),[]);
});

test('never stacks on an existing crafting_table',()=>{
 // table on the floor: the cell above loses its only support and drops out
 const w=world();flatFloor(w);
 w.put(2,9,0,solid('crafting_table',2,9,0));
 const list=placementCells(w.blockAt,FEET);
 assert.equal(cellOf(list,2,10,0),undefined);
 assert.equal(cellOf(list,2,11,0),undefined);
 assert.ok(list.every(e=>!/crafting_table$/.test(e.support.name)));
 assert.ok(cellOf(list,1,10,0)); // normal floor cells unaffected
 // lone table surrounded by air: every adjacent cell would need the table
 const w2=world();
 for(let x=-3;x<=3;x++)for(let z=-3;z<=3;z++)for(let y=9;y<=11;y++)w2.put(x,y,z,air(x,y,z));
 w2.put(2,10,0,solid('crafting_table',2,10,0));
 assert.deepEqual(placementCells(w2.blockAt,FEET),[]);
});

test('reach annotation from eye and maxReach',()=>{
 const w=world();flatFloor(w);
 const eye={x:0.5,y:11.6,z:0.5};
 const near=placementCells(w.blockAt,FEET,{eye,maxReach:4.4});
 const e=cellOf(near,3,10,0);
 assert.ok(e,'cell (3,10,0) within radius 3 must be listed');
 assert.equal(e.inReach,true);
 assert.ok(Math.abs(e.reach-Math.hypot(3,1.1))<1e-9,'reach '+e.reach);
 assert.equal(cellOf(near,0,10,1).inReach,true);
 const short=placementCells(w.blockAt,FEET,{eye,maxReach:3});
 const f=cellOf(short,3,10,0);
 assert.equal(f.inReach,false);
 assert.ok(f.reach>3);
});

test('cells overlapping the bot hitbox are skipped (the server refuses those placements)',()=>{
 // bot centred in its cell: no neighbour overlaps the 0.6 wide box
 assert.equal(hitsBot({x:0.5,y:10,z:0.5},1,10,0),false);
 assert.equal(hitsBot({x:0.5,y:10,z:0.5},0,10,0),true);  // own feet cell
 assert.equal(hitsBot({x:0.5,y:10,z:0.5},0,11,0),true);  // own head cell
 assert.equal(hitsBot({x:0.5,y:10,z:0.5},0,12,0),false); // above the head is free
 // bot standing on the east edge of its cell: the +x neighbour overlaps at feet and head height
 assert.equal(hitsBot({x:0.8,y:10,z:0.5},1,10,0),true);
 assert.equal(hitsBot({x:0.8,y:10,z:0.5},1,11,0),true);
 assert.equal(hitsBot({x:0.8,y:10,z:0.5},1,9,0),false);  // the floor cell beside is not touched
 assert.equal(hitsBot({x:0.8,y:10,z:0.5},-1,10,0),false);
 const w=world();flatFloor(w);
 const list=placementCells(w.blockAt,FEET,{botPos:{x:0.8,y:10,z:0.5}});
 assert.equal(cellOf(list,1,10,0),undefined,'overlapping neighbour must not be proposed');
 assert.ok(cellOf(list,-1,10,0),'the far-side neighbour stays');
 assert.ok(cellOf(list,2,10,0),'two blocks over is clear of the hitbox');
 // without botPos the old behaviour is unchanged
 assert.ok(cellOf(placementCells(w.blockAt,FEET),1,10,0));
});

test('softBreakCell: nearest soft block, feet/head skipped, null on clean floor',()=>{
 // stone floor: stone is not hand-breakable, so only placed plants can match
 function stoneFloor(w,y=9,r=5){
  for(let x=-r;x<=r;x++)for(let z=-r;z<=r;z++){
   w.put(x,y,z,solid('stone',x,y,z));
   w.put(x,y+1,z,air(x,y+1,z));
   w.put(x,y+2,z,air(x,y+2,z));
  }
 }
 const w=world();stoneFloor(w);
 w.put(1,10,0,plant('short_grass',1,10,0));
 w.put(-2,10,0,plant('fern',-2,10,0));
 assert.deepEqual(softBreakCell(w.blockAt,FEET),{x:1,y:10,z:0,name:'short_grass'});
 // clean floor: nothing to break
 const clean=world();stoneFloor(clean);
 assert.equal(softBreakCell(clean.blockAt,FEET),null);
 // bot standing inside tall grass: feet and head cells are never proposed
 const grass=world();stoneFloor(grass);
 grass.put(0,10,0,plant('tall_grass',0,10,0));
 grass.put(0,11,0,plant('tall_grass',0,11,0));
 assert.equal(softBreakCell(grass.blockAt,FEET),null);
 // but the same tall grass one cell over is returned
 grass.put(1,10,0,plant('tall_grass',1,10,0));
 assert.deepEqual(softBreakCell(grass.blockAt,FEET),{x:1,y:10,z:0,name:'tall_grass'});
 // the block UNDER the feet is never proposed: digging it drops the bot into the hole.
 // A soft block BESIDE the bot one level down is fair game - the bot does not stand on it.
 const turf=world();
 for(let x=-3;x<=3;x++)for(let z=-3;z<=3;z++){
  turf.put(x,9,z,{name:'grass_block',boundingBox:'block',position:{x,y:9,z}});
  turf.put(x,10,z,air(x,10,z));
  turf.put(x,11,z,air(x,11,z));
 }
 const below=softBreakCell(turf.blockAt,FEET);
 assert.ok(below,'a turf floor still offers a beside cell');
 assert.ok(!(below.x===FEET.x&&below.z===FEET.z),'must not mine its own floor column');
 // ...and a dirt patch beside the bot on the same level wins (nearer, same-level first)
 turf.put(2,10,0,{name:'dirt',boundingBox:'block',position:{x:2,y:10,z:0}});
 assert.deepEqual(softBreakCell(turf.blockAt,FEET),{x:2,y:10,z:0,name:'dirt'});
});

test('boxed in by stone: no placement cell, no soft block, but a wall block beside the feet to open',()=>{
 // A 1x1 stone-gather pit: solid stone all round the feet and head, nothing soft anywhere.
 const pit=world();
 for(let x=-3;x<=3;x++)for(let y=8;y<=13;y++)for(let z=-3;z<=3;z++)pit.put(x,y,z,solid('stone',x,y,z));
 pit.put(0,10,0,air(0,10,0));pit.put(0,11,0,air(0,11,0));
 assert.deepEqual(placementCells(pit.blockAt,FEET,{radius:3,minY:-1,maxY:1}),[]);
 assert.equal(softBreakCell(pit.blockAt,FEET,{radius:3,minY:-1,maxY:1}),null);
 const wall=softBreakCell(pit.blockAt,FEET,{radius:1,minY:0,maxY:1,matcher:HARD_BREAK});
 assert.ok(wall,'a stone wall block is offered when the hard matcher is allowed');
 assert.equal(wall.y,10,'same level as the feet first');
 assert.ok(Math.abs(wall.x)+Math.abs(wall.z)===1,'directly beside the feet: '+JSON.stringify(wall));
 // Opening it yields a cell with the pit floor as its support.
 pit.put(wall.x,wall.y,wall.z,air(wall.x,wall.y,wall.z));
 const cells=placementCells(pit.blockAt,FEET,{radius:3,minY:-1,maxY:1,botPos:{x:0.5,y:10,z:0.5}});
 assert.ok(cellOf(cells,wall.x,wall.y,wall.z),'the opened wall cell is now a placement candidate');
 assert.equal(cellOf(cells,wall.x,wall.y,wall.z).support.y,9);
 // Ore and man-made blocks are never "room to make".
 assert.equal(HARD_BREAK.test('iron_ore'),false);assert.equal(HARD_BREAK.test('crafting_table'),false);assert.equal(HARD_BREAK.test('furnace'),false);
 assert.equal(HARD_BREAK.test('stone'),true);assert.equal(HARD_BREAK.test('deepslate'),true);
});

test('round 52: flowers and petals are not placement cells; grass is',()=>{
 const w=world();flatFloor(w);
 w.put(1,10,0,{name:'pink_petals',boundingBox:'empty',position:{x:1,y:10,z:0}});
 w.put(-1,10,0,{name:'poppy',boundingBox:'empty',position:{x:-1,y:10,z:0}});
 w.put(0,10,1,{name:'short_grass',boundingBox:'empty',position:{x:0,y:10,z:1}});
 w.put(0,10,-1,{name:'lilac',boundingBox:'empty',position:{x:0,y:10,z:-1}});
 const list=placementCells(w.blockAt,FEET);
 assert.equal(cellOf(list,1,10,0),undefined,'pink petals refuse the click');
 assert.equal(cellOf(list,-1,10,0),undefined);
 assert.equal(cellOf(list,0,10,-1),undefined,'lilac (round 53) refuses too');
 assert.ok(cellOf(list,0,10,1),'short grass is replaced');
 assert.ok(SOFT_BREAK.test('pink_petals'),'the petals can be cleared by hand instead');
});
