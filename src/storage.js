// Storage (round 51): the bot keeps what it earns in categorised chests at its base.
// - categoryOf: which chest an item belongs in.
// - Ledger: what the bot EARNED (picked up, crafted, smelted) - items a server command handed
//   over (/give, the soak harness's steak) never enter it, so they are never stored.
// - storePlan: what to put away now - earned items above the working set the bot keeps on it.
// - StorageIndex: every storage chest, its category and last-read contents (data/storage.json).
import fs from 'node:fs';
import path from 'node:path';

export const CATEGORIES=['wood','stone','metal','food','drops','tools','misc'];
const RULES=[
 ['wood',/(_log|_wood|_planks|_stem|_hyphae|_sapling)$|^(stick|bamboo|stripped_.*)$/],
 ['stone',/^(cobblestone|cobbled_deepslate|stone|deepslate|andesite|diorite|granite|tuff|calcite|dirt|coarse_dirt|gravel|sand|red_sand|clay_ball|clay|flint|netherrack|sandstone|red_sandstone|mud|dripstone_block|pointed_dripstone)$/],
 ['metal',/^(raw_|iron_ingot|iron_nugget|gold_ingot|gold_nugget|copper_ingot|coal|charcoal|diamond|emerald|redstone|lapis_lazuli|amethyst_shard|quartz)|_ore$/],
 ['food',/^(cooked_)?(beef|porkchop|chicken|mutton|rabbit|cod|salmon)$|^(bread|apple|carrot|potato|baked_potato|beetroot|melon_slice|sweet_berries|glow_berries|wheat|wheat_seeds|pumpkin|melon|egg|sugar_cane|cocoa_beans|beetroot_seeds|pumpkin_seeds|melon_seeds|dried_kelp)$/],
 ['drops',/^(string|bone|bone_meal|feather|gunpowder|leather|spider_eye|rotten_flesh|slime_ball|ender_pearl|arrow|ink_sac|.*_wool)$/],
];
export function categoryOf(name){
 for(const [cat,re] of RULES)if(re.test(name))return cat;
 return 'misc';
}
// Never stored: tools, weapons, armour, the shield, the bed, storage and work blocks the bot uses.
export const NEVER_STORE=/(_pickaxe|_axe|_shovel|_hoe|_sword|_helmet|_chestplate|_leggings|_boots|_bed)$|^(shield|bow|crossbow|bucket|water_bucket|lava_bucket|shears|flint_and_steel|crafting_table|furnace|chest|torch)$/;
// The working set kept on the bot whatever the ledger says (fuel, blocks for a shelter, planks).
// Round 56 (round-55 normal3 put 3 iron ingots and 8 coal in the metal chest mid-ladder): the
// progression materials stay on the bot up to the iron and diamond kits' needs (iron: pick 3,
// sword 2, axe 3, shield 1, armour 24, bucket 3, shears 2 = 38).
export const KEEP={cobblestone:32,dirt:16,coal:16,charcoal:16,stick:8,arrow:32,iron_ingot:40,raw_iron:40,diamond:24,gold_ingot:8,raw_gold:8};
const PLANKS_KEEP=8,FOOD_KEEP=8;

export class Ledger{
 constructor(data){this.earned={...(data||{})};}
 add(name,n=1){if(!name||!(n>0))return;this.earned[name]=(this.earned[name]||0)+n;}
 take(name,n){if(!this.earned[name])return;this.earned[name]=Math.max(0,this.earned[name]-n);if(!this.earned[name])delete this.earned[name];}
 // The ledger never claims more than the bag holds (a /clear or a death empties it).
 clamp(held){for(const name of Object.keys(this.earned)){const h=held[name]||0;if(this.earned[name]>h)this.earned[name]=h;if(!this.earned[name])delete this.earned[name];}}
 of(name){return this.earned[name]||0;}
 toJSON(){return this.earned;}
}

// held: {name: count}; earned: a Ledger; keep: extra {name: count} the ladder still needs.
// Returns [{item, count, category}] - earned items above the working set, largest first.
// A wooden or golden tool with a better tier of the same tool held: spare, stored whole (round
// 50's bags carried wooden kits beside stone and iron ones to the end of the run).
const LOW_TOOL=/^(wooden|golden)_(sword|axe|pickaxe|shovel|hoe)$/;
export const spareTool=(name,held)=>{const m=LOW_TOOL.exec(name);return !!m&&['stone','iron','diamond','netherite'].some(t=>(held?.[t+'_'+m[2]]||0)>=1);};
export function storePlan(held,earned,keep={}){
 const out=[];
 let food=0;
 for(const [name,n] of Object.entries(held||{})){
  if(spareTool(name,held)){out.push({item:name,count:n,category:'tools'});continue;}
  if(name.startsWith('_')||NEVER_STORE.test(name))continue;
  const cat=categoryOf(name);
  let keepN=Math.max(KEEP[name]||0,keep[name]||0,/_planks$/.test(name)?PLANKS_KEEP:0);
  if(cat==='food'&&!/seeds$/.test(name)){const k=Math.max(0,FOOD_KEEP-food);food+=Math.min(n,k);keepN=Math.max(keepN,k);}
  const count=Math.min(n-keepN,earned?earned.of(name):n);
  if(count>0)out.push({item:name,count,category:cat});
 }
 return out.sort((a,b)=>b.count-a.count);
}

export class StorageIndex{
 constructor(file){this.file=file;this.chests=[];this.load();}
 load(){try{const d=JSON.parse(fs.readFileSync(this.file,'utf8'));this.chests=Array.isArray(d.chests)?d.chests:[];}catch{this.chests=[];}}
 save(){try{fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file,JSON.stringify({chests:this.chests},null,1));}catch{}}
 key(p){return p.x+','+p.y+','+p.z;}
 get(p){return this.chests.find(c=>this.key(c)===this.key(p))||null;}
 // The first chest of the category with room (by the last read), or null.
 chestFor(category){return this.chests.find(c=>c.category===category&&!c.full)||null;}
 record(p,category,contents,full){
  let c=this.get(p);
  if(!c){c={x:p.x,y:p.y,z:p.z,category};this.chests.push(c);}
  c.category=category;c.contents=contents||{};c.full=!!full;c.updated=Date.now();
  this.save();return c;
 }
 forget(p){this.chests=this.chests.filter(c=>this.key(c)!==this.key(p));this.save();}
 // Where an item is stored: [{x,y,z,count}], most first.
 find(item){return this.chests.filter(c=>(c.contents?.[item]||0)>0).map(c=>({x:c.x,y:c.y,z:c.z,count:c.contents[item]})).sort((a,b)=>b.count-a.count);}
 totals(){const t={};for(const c of this.chests)for(const [n,k] of Object.entries(c.contents||{}))t[n]=(t[n]||0)+k;return t;}
}
// The storage row: chest spots in a line beside the base, one cell apart (a chest needs the cell
// above it open to be opened). base: {x,y,z}; dir: unit {x,z}; n: how many spots.
export function storageSpots(base,n=12,dir={x:1,z:0}){
 const side={x:-dir.z,z:dir.x};
 const out=[];
 for(let i=0;i<n;i++)out.push({x:base.x+side.x*2+dir.x*(i*2),y:base.y,z:base.z+side.z*2+dir.z*(i*2)});
 return out;
}
