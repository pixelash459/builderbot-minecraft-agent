// Cloud round 6, task 3: round-5 normal1 crafted an iron pickaxe at 752 s and ended without
// it (30 raw iron, 0 ingots). The fastest-tool pickers (mineflayer-tool, the pathfinder) wore
// the iron pickaxe on every staircase cell; it has 250 uses and one staircase from the surface
// to the iron band is ~280 cells. Stone tools now take that wear while they can harvest.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {conserveTool,installToolWear,watchToolLoss,usesLeft} from '../src/toolWear.js';
const IDS={wooden_pickaxe:1,stone_pickaxe:2,iron_pickaxe:3,diamond_pickaxe:4,stone_shovel:5,iron_shovel:6,stone_axe:7,iron_axe:8,iron_sword:9};
const MAX={wooden_pickaxe:59,stone_pickaxe:131,iron_pickaxe:250,diamond_pickaxe:1561,stone_shovel:131,iron_shovel:250,stone_axe:131,iron_axe:250,iron_sword:250};
const item=(name,used=0,slot=36)=>({name,type:IDS[name],slot,count:1,durabilityUsed:used,maxDurability:MAX[name]});
// digTime: pickaxes speed up stone and ores, shovels dirt; harvestTools as in minecraft-data.
const SPEED={wooden:2,stone:4,iron:6,diamond:8};
function block(name){
 const kind=/dirt|grass|gravel|sand/.test(name)?'shovel':/log|planks/.test(name)?'axe':'pickaxe';
 const harvest={stone:[1,2,3,4],iron_ore:[2,3,4],coal_ore:[1,2,3,4],diamond_ore:[3,4],deepslate_iron_ore:[2,3,4]}[name];
 return {name,harvestTools:harvest?Object.fromEntries(harvest.map(i=>[i,true])):undefined,
  digTime(type){
   const tool=Object.keys(IDS).find(n=>IDS[n]===type);
   if(!tool)return 5000;
   const [tier,k]=tool.split('_');
   return k===kind?5000/SPEED[tier]:5000;
  }};
}
const bot=items=>({inventory:{items:()=>items},registry:{itemsByName:{}},entity:{effects:{}},heldItem:null});
test('stone and the iron-band ores are dug with the stone pickaxe while an iron one is held',()=>{
 const b=bot([item('iron_pickaxe',10,36),item('stone_pickaxe',40,37),item('wooden_pickaxe',0,38)]);
 for(const name of ['stone','iron_ore','coal_ore','deepslate_iron_ore'])assert.equal(conserveTool(b,block(name))?.name,'stone_pickaxe',name);
 assert.equal(conserveTool(b,block('diamond_ore')),null,'diamond ore needs iron: the default picker');
 assert.equal(conserveTool(b,block('dirt')),null,'not a pickaxe block, and no iron shovel held');
});
test('no higher tier held, or no stone tool: the default (fastest) picker decides',()=>{
 assert.equal(conserveTool(bot([item('stone_pickaxe'),item('wooden_pickaxe')]),block('stone')),null);
 assert.equal(conserveTool(bot([item('iron_pickaxe'),item('wooden_pickaxe')]),block('stone')),null,'the wooden pickaxe is never worn down (the wood step needs it)');
 assert.equal(conserveTool(bot([item('iron_pickaxe'),item('stone_pickaxe',131)]),block('stone')),null,'a broken-out stone pickaxe is not used');
});
test('the most worn stone tool goes first; shovels and axes follow the same rule',()=>{
 const b=bot([item('iron_pickaxe',0,36),item('stone_pickaxe',5,37),item('stone_pickaxe',120,38),item('iron_shovel',0,39),item('stone_shovel',0,40)]);
 assert.equal(conserveTool(b,block('stone')).slot,38);
 assert.equal(conserveTool(b,block('dirt'))?.name,'stone_shovel');
 assert.equal(usesLeft(item('stone_pickaxe',120)),11);
});
test('installToolWear routes equipForBlock and the pathfinder digger through the rule',async()=>{
 const items=[item('iron_pickaxe',0,36),item('stone_pickaxe',0,37)];
 const equipped=[],defaults=[];
 const b={...bot(items),equip:async(i)=>{equipped.push(i.name);b.heldItem=i;},
  tool:{equipForBlock:async bl=>{defaults.push(bl.name);}},
  pathfinder:{bestHarvestTool:()=>items[0]}};
 installToolWear(b);installToolWear(b);
 await b.tool.equipForBlock(block('stone'));
 assert.deepEqual(equipped,['stone_pickaxe']);
 await b.tool.equipForBlock(block('diamond_ore'));
 assert.deepEqual(defaults,['diamond_ore'],'needs iron: the plugin picks');
 assert.equal(b.pathfinder.bestHarvestTool(block('stone')).name,'stone_pickaxe');
 assert.equal(b.pathfinder.bestHarvestTool(block('diamond_ore')).name,'iron_pickaxe');
});
test('a tool leaving the inventory is logged with its uses left; a move or wear is not',()=>{
 const inv=new EventEmitter();let items=[];inv.items=()=>items;
 const b={inventory:inv,health:20,registry:{itemsByName:{}}};
 const logs=[];watchToolLoss(b,m=>logs.push(m),{settleMs:0});
 const pick=item('iron_pickaxe',249,36);
 inv.emit('updateSlot',36,pick,null);
 assert.deepEqual(logs,['Tool left the inventory: iron_pickaxe (1 uses left, broke)']);
 inv.emit('updateSlot',36,item('iron_pickaxe',10),item('iron_pickaxe',11)); // one more use
 items=[item('stone_pickaxe',3,40)];
 inv.emit('updateSlot',37,item('stone_pickaxe',3,37),null); // moved to slot 40
 assert.equal(logs.length,1);
 inv.emit('updateSlot',38,item('iron_sword',20),null);
 assert.equal(logs[1],'Tool left the inventory: iron_sword (230 uses left)');
 b.health=0;inv.emit('updateSlot',39,item('stone_axe'),null);
 assert.equal(logs.length,2,'a death drop is not logged here');
});
