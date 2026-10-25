// Tool wear (cloud round 6). Round 5 normal1 crafted its iron pickaxe at 752 s and ended the
// run without it: mineflayer-tool and the pathfinder both equip the FASTEST tool, so every
// staircase step down to the iron band (~90 steps x 3 cells from the surface, per gather job)
// and every stone cell of the 16-coal / 30-ore gathers wore the iron pickaxe (250 uses).
// conserveTool: when a stone tool of the block's kind can harvest it and a higher tier of the
// same kind is held, dig with the stone one (131 uses, 3 cobble to replace; the ladder's stone
// step re-crafts it as soon as it breaks) and keep the iron tool for what needs it.
// watchToolLoss: any tool leaving the inventory is logged with its uses left, so a break
// (0-1 left) tells itself apart from a death, a toss or a deposit.
const TOOL=/^(wooden|golden|stone|iron|diamond|netherite)_(pickaxe|axe|shovel|hoe|sword)$/;
const ABOVE_STONE=new Set(['iron','diamond','netherite']);
export function usesLeft(item,registry){
 if(!item)return 0;
 const max=item.maxDurability??registry?.itemsByName?.[item.name]?.maxDurability;
 return max?max-(item.durabilityUsed||0):Infinity;
}
// Round 50 (the user saw the bot dig dirt with an axe): with no tool faster than a bare hand
// for a block, mineflayer-tool and the pathfinder both take the FIRST item at the hand's speed -
// often the axe, which then wears for nothing. handItem is an item with no durability to hold
// instead (dirt, cobble, food...); null when the bag has only tools.
export function handItem(bot){
 const items=bot?.inventory?.items?.()||[];
 return items.find(i=>!TOOL.test(i.name)&&!(usesLeft(i,bot.registry)<Infinity))||null;
}
// True when `tool` digs `block` faster than a bare hand.
export function beatsHand(bot,block,tool){
 if(!tool||!block)return false;
 try{return block.digTime(tool.type,false,false,false,[],bot.entity?.effects||{})<block.digTime(null,false,false,false,[],bot.entity?.effects||{});}catch{return true;}
}
export function conserveTool(bot,block){
 if(!block||!bot?.inventory)return null;
 const items=bot.inventory.items();
 const digTime=t=>{try{return block.digTime(t,false,false,false,[],bot.entity?.effects||{});}catch{return Infinity;}};
 const hand=digTime(null);
 for(const kind of ['pickaxe','axe','shovel','hoe']){
  if(!items.some(i=>{const m=TOOL.exec(i.name);return m&&m[2]===kind&&ABOVE_STONE.has(m[1]);}))continue;
  // The most worn stone tool first: one breaks, the next is fresh.
  const stone=items.filter(i=>i.name==='stone_'+kind&&usesLeft(i,bot.registry)>=1).sort((a,b)=>usesLeft(a,bot.registry)-usesLeft(b,bot.registry))[0];
  if(!stone)continue;
  if(block.harvestTools&&!block.harvestTools[stone.type])continue; // needs iron or better
  if(!(digTime(stone.type)<hand))continue; // not this block's tool
  return stone;
 }
 return null;
}
// Route both tool pickers through conserveTool: the jobs' equipForBlock and the pathfinder's
// own digging (bestHarvestTool), which would otherwise pick the iron pickaxe for every cell.
export function installToolWear(bot){
 if(bot.tool&&!bot.tool._conserve){
  const equip=bot.tool.equipForBlock.bind(bot.tool);
  bot.tool.equipForBlock=async(block,options={},cb)=>{
   const keep=conserveTool(bot,block);
   if(!keep){
    // No tool beats the hand here: hold something that does not wear (round 50).
    const tools=(bot.inventory.items()||[]).filter(i=>TOOL.test(i.name));
    if(!tools.some(t=>beatsHand(bot,block,t))&&!(options&&options.requireHarvest)){
     const plain=handItem(bot);
     if(plain&&(bot.heldItem?.name!==plain.name))await bot.equip(plain,'hand');
     else if(!plain&&bot.heldItem&&TOOL.test(bot.heldItem.name))try{await bot.unequip('hand');}catch{}
     if(cb)cb();return;
    }
    return equip(block,options,cb);
   }
   if(bot.heldItem?.slot!==keep.slot||bot.heldItem?.name!==keep.name)await bot.equip(keep,'hand');
   if(cb)cb();
  };
  bot.tool._conserve=true;
 }
 if(bot.pathfinder&&!bot.pathfinder._conserve){
  const best=bot.pathfinder.bestHarvestTool;
  // Round 20 (round-19 soak: 5 of 6 runs never made a wooden pick): the pathfinder sets its
  // `digging` flag and THEN asks for the tool; a block in an unloaded chunk (null) threw here,
  // the flag stayed set forever and every later path was ignored (`made no progress`, last
  // path none) for 2.5 hours. No block: no tool, and the dig fails and resets the flag.
  // Round 50: a pick that does not beat the hand is swapped for an item that does not wear.
  bot.pathfinder.bestHarvestTool=block=>{if(!block)return null;try{const t=conserveTool(bot,block)||best(block);if(t&&TOOL.test(t.name)&&!beatsHand(bot,block,t))return handItem(bot)||t;return t;}catch{return null;}};
  bot.pathfinder._conserve=true;
 }
}
export function watchToolLoss(bot,log){
 const inv=bot.inventory;
 if(!inv||typeof inv.on!=='function')return;
 inv.on('updateSlot',(slot,oldItem,newItem)=>{
  if(!oldItem||!TOOL.test(oldItem.name||''))return;
  if(newItem&&newItem.name===oldItem.name)return; // wear, a move within the slot
  if(!(bot.health>0))return; // the death drop is logged as a death
  // A move to another slot (equip, sort) is not a loss: the stack is still held somewhere.
  if(inv.items().some(i=>i.name===oldItem.name&&i.slot!==slot&&(i.durabilityUsed||0)===(oldItem.durabilityUsed||0)))return;
  const left=usesLeft(oldItem,bot.registry);
  log('Tool left the inventory: '+oldItem.name+' ('+(left===Infinity?'?':left)+' uses left'+(left<=1?', broke':'')+')');
 });
}
