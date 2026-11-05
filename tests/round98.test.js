// Round 98 (round-97 hard1: `fleeing witch` from the iron gather's hole at (794, 78, -590), the
// run-away pinned against its walls, health 20 to 0 in 21 s and `killed by Witch using magic` with
// the witch 3.6 off and 6 cobblestone held): a pinned witch flee blocks the witch's line of sight.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Vec3} from 'vec3';
import {MobDefenseChain,WITCH_COVER_OFF,FLEE_PINNED_S} from '../src/chains/mobDefenseChain.js';
import {WitchCoverTask,witchCoverCell,WITCH_COVER_TRIES,WITCH_COVER_REACH} from '../src/chains/fallbackTasks.js';
console.error=()=>{};

// A 1x1 hole three deep: the bot stands at (0, 71, 0), the floor at y=70, walls round it at y=71-73,
// the ground surface at y=73 (standing y=74). The witch stands on the rim at (1, 74, 0).
const hole=(x,y,z)=>y<=70||(y<=73&&!(x===0&&z===0));
const witch=(x=1.5,y=74,z=0.5,id=5)=>({id,name:'witch',type:'hostile',position:new Vec3(x,y,z),isValid:true,height:1.95});
function holeBot({health=13.8,solid=hole,items=[{name:'cobblestone',count:6,slot:37}],w=witch()}={}){
 const placed=new Set();
 const isSolid=(x,y,z)=>placed.has(x+','+y+','+z)||solid(x,y,z);
 const bot={entity:{position:new Vec3(0.5,71,0.5),onGround:true},entities:{[w.id]:w},health,food:19,
  inventory:{items:()=>[{name:'stone_pickaxe',count:1,slot:36},...items],slots:[]},
  registry:{foodsByName:{}},time:{timeOfDay:6000},heldItem:{name:'stone_pickaxe'},
  blockAt:p=>{const x=Math.floor(p.x),y=Math.floor(p.y),z=Math.floor(p.z),s=isSolid(x,y,z);return {name:s?'stone':'air',boundingBox:s?'block':'empty',position:new Vec3(x,y,z)};},
  setControlState(){},clearControlStates(){},
  equip:async it=>{bot.heldItem={name:it.name};},
  placeBlock:async(ref,face)=>{const c=ref.position.plus(face);bot.places.push(c.toString());placed.add(c.x+','+c.y+','+c.z);},
  places:[],unplace:()=>placed.clear()};
 return bot;
}
const chainCtx=logs=>({config:{chains:{}},move:{},trackers:{},blacklist:{},worker:{log:m=>logs.push(m)}});

test('round 98: the cover cell is the first open cell on the line to the witch',()=>{
 assert.equal(WITCH_COVER_TRIES,2);assert.equal(WITCH_COVER_REACH,4.5);
 const bot=holeBot(),w=bot.entities[5];
 // from the hole: the cell over the bot's head, against the wall beside it
 const q=witchCoverCell(bot,w);
 assert.deepEqual([q.x,q.y,q.z],[0,73,0]);
 assert.equal(q.ref.boundingBox,'block');
 assert.deepEqual(q.ref.position.plus(q.face).toArray(),[0,73,0]);
 // that cell tried twice: the next open cell on the line, if any has a block to place against
 const next=witchCoverCell(bot,w,{'0,73,0':2});
 assert.ok(next===null||next.key!=='0,73,0');
 // on flat ground, the witch 3 east at eye level: the head cell beside the bot, toward it, which
 // has nothing to place against until the feet cell under it is filled
 const flat=holeBot({solid:(x,y,z)=>y<=70,w:witch(3.5,71,0.5)});
 const f=witchCoverCell(flat,flat.entities[5]);
 assert.deepEqual([f.x,f.y,f.z],[1,71,0]);
 assert.deepEqual(f.ref.position.toArray(),[1,70,0]);
 const f2=witchCoverCell(holeBot({solid:(x,y,z)=>y<=70||(x===1&&y===71&&z===0),w:witch(3.5,71,0.5)}),witch(3.5,71,0.5));
 assert.deepEqual([f2.x,f2.y,f2.z],[1,72,0]);
 // the line already cut: covered
 assert.deepEqual(witchCoverCell(holeBot({solid:(x,y,z)=>hole(x,y,z)||(x===0&&y===73&&z===0)}),witch()),{covered:true});
 // an unloaded cell on the line: nothing to do
 const dark=holeBot();dark.blockAt=()=>null;
 assert.equal(witchCoverCell(dark,witch()),null);
});

test('round 98: a witch flee pinned 2 s in the hole covers itself, then falls back to the flee',async()=>{
 assert.equal(FLEE_PINNED_S,2);assert.equal(WITCH_COVER_OFF,3);
 const bot=holeBot(),logs=[],m=new MobDefenseChain(),ctx=chainCtx(logs);
 let t=1000;m.now=()=>t;
 assert.equal(m.priority(bot,ctx),68);
 assert.equal(m.root.name,'RunAwayFromHostilesTask');
 assert.equal(logs.at(-1),'Reflex: fleeing witch (26.3: it kites and out-potions the rush)');
 t+=1;m.priority(bot,ctx);
 t+=1;m.priority(bot,ctx);assert.equal(m.root.name,'RunAwayFromHostilesTask','1 s pinned: still fleeing');
 t+=1.1;assert.equal(m.priority(bot,ctx),68);
 const cover=m.root;
 assert.equal(cover.name,'WitchCoverTask');
 assert.equal(logs.at(-1),'Reflex: the witch flee has kept the bot in one spot for 2.1 s with the witch 3.2 away in sight (health 13.8, cobblestone 6); blocking its line of sight');
 // equip the cobble, then the block over the head
 cover.onTick(bot,ctx);await new Promise(r=>setImmediate(r));
 assert.equal(bot.heldItem.name,'cobblestone');
 cover.onTick(bot,ctx);await new Promise(r=>setImmediate(r));
 assert.deepEqual(bot.places,['(0, 73, 0)']);assert.equal(cover.placed,1);
 // out of sight now: the witch branch lets go (the vulnerable flee answers health 13.8, unarmoured)
 t+=0.5;m.priority(bot,ctx);
 assert.equal(m.root.name,'RunAwayFromHostilesTask');
 assert.match(logs.at(-1),/\(vulnerable\)$/);
 cover.onStop(bot,true);cover.onStop(bot,true);
 assert.equal(logs.filter(l=>/cover is done/.test(l)).length,1);
 assert.equal(logs.at(-1),'Reflex: the witch cover is done: 1 block(s) placed (held cobblestone 6); the witch is 3.2 away');
 // the cover block lost (a blast, a mob breaking it), the witch in sight again: a fresh cover at
 // once from the same spot, no second start line
 cover.stopped=true;
 bot.unplace();
 t+=0.5;assert.equal(m.priority(bot,ctx),68);
 assert.equal(m.root.name,'WitchCoverTask');assert.notEqual(m.root,cover);
 assert.equal(logs.filter(l=>/blocking its line of sight/.test(l)).length,1);
 // no cell left to fill: the flee for WITCH_COVER_OFF s, then a look again
 m.root.exhausted=true;
 t+=0.5;assert.equal(m.priority(bot,ctx),68);assert.equal(m.root.name,'RunAwayFromHostilesTask');
 t+=WITCH_COVER_OFF+0.1;m.priority(bot,ctx);assert.equal(m.root.name,'WitchCoverTask');
 // the bot moves off the spot: the cover ends, and a new spot waits for a new pin
 bot.entity.position=new Vec3(3.5,74,3.5);bot.entities[5]=witch(5.5,74,3.5);
 t+=0.5;m.priority(bot,ctx);assert.equal(m.root.name,'RunAwayFromHostilesTask');
 assert.equal(m._cover,null);
});

test('round 98: no cover with no blocks held, or for a flee that moves',()=>{
 {const bot=holeBot({items:[]}),logs=[],m=new MobDefenseChain(),ctx=chainCtx(logs);let t=0;m.now=()=>t;
  for(let i=0;i<6;i++){t+=1;m.priority(bot,ctx);assert.equal(m.root.name,'RunAwayFromHostilesTask');}
  assert.ok(!logs.some(l=>/line of sight/.test(l)));}
 {const bot=holeBot({solid:(x,y,z)=>y<=70}),logs=[],m=new MobDefenseChain(),ctx=chainCtx(logs);let t=0;m.now=()=>t;
  for(let i=0;i<8;i++){t+=1;bot.entity.position=new Vec3(0.5+i*1.5,71,0.5);bot.entities[5]=witch(bot.entity.position.x+4,71,0.5);m.priority(bot,ctx);assert.equal(m.root.name,'RunAwayFromHostilesTask');}
  assert.ok(!logs.some(l=>/line of sight/.test(l)));}
 // a cover with nothing tried logs no done line
 const logs=[],task=new WitchCoverTask(5);task.w={log:m=>logs.push(m)};
 task.onStop(holeBot(),true);assert.equal(logs.length,0);
 // the witch branch takes the cover before it builds the run-away
 const src=fs.readFileSync(new URL('../src/chains/mobDefenseChain.js',import.meta.url),'utf8');
 const i=src.indexOf('const cover=this._coverFrom(bot,ctx,witch,pinned);');
 assert.ok(i>src.indexOf("if(!this._witchSince)this._witchSince=now;")&&i<src.indexOf("this._fleeLog(ctx,'witch','Reflex: fleeing witch"));
});
