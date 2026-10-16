// Round 10, habit 4: use the night instead of idling in the box. A sealed shelter with a stone
// pickaxe sinks a checked 2-deep sump through its floor, staircases down from there (the box
// stays sealed above), mines coal/iron in the walls, and is back in the box before dawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';
import {shelterShell,shellGaps,nightMineWanted,tunnelBreach,NIGHT_MINE_FROM,NIGHT_MINE_STOP,NIGHT_MINE_BLOCKS} from '../src/night.js';
const ORIGIN=new Vec3(0,64,0);
function world(edit={}){
 const cells=new Map(Object.entries(edit));
 const nameAt=(x,y,z)=>{const k=x+','+y+','+z;if(cells.has(k))return cells.get(k);return y>=64?'air':'stone';};
 const blockAt=(x,y,z)=>{const name=nameAt(x,y,z);return {name,position:new Vec3(x,y,z),boundingBox:/air|water|lava/.test(name)?'empty':'block'};};
 const set=(x,y,z,n)=>cells.set(x+','+y+','+z,n);
 for(const c of shelterShell(ORIGIN).required)if(nameAt(c.x,c.y,c.z)==='air')set(c.x,c.y,c.z,'cobblestone');
 return {nameAt,blockAt,set};
}
const solidAt=(w,x,y,z)=>w.blockAt(x,y,z).boundingBox==='block';
function miner(w,{tod=13500,items=[{name:'stone_pickaxe',count:1,type:901},{name:'cobblestone',count:12}]}={}){
 const logs=[],gapsSeen=[];
 const fall=()=>{let p=bot.entity.position.floored();while(p.y>0&&!solidAt(w,p.x,p.y-1,p.z))p=p.offset(0,-1,0);bot.entity.position=new Vec3(p.x+0.5,p.y,p.z+0.5);};
 const bot={entity:{position:new Vec3(0.5,64,0.5)},entities:{},health:20,time:{timeOfDay:tod},
  blockAt:p=>w.blockAt(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)),
  inventory:{items:()=>items},tool:{async equipForBlock(){}},
  pathfinder:{movements:'normal',setMovements(m){this.movements=m;}},
  async equip(){},async placeBlock(){},
  async dig(bl){w.set(bl.position.x,bl.position.y,bl.position.z,'air');fall();
   gapsSeen.push(shellGaps(w.blockAt,shelterShell(ORIGIN).required.slice(1)).length);}};
 const worker=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,config:{},logs,check(){},save(){},log(m){logs.push(m);},async placeTorch(){},
  count(n){return items.filter(i=>i.name===n).reduce((a,i)=>a+i.count,0);},
  exploreMovements(){return 'explore';},
  async stepInto(next){bot.entity.position=new Vec3(next.x+0.5,next.y,next.z+0.5);fall();},
  async climbTunnel(job){const p=job.tunnel[0];bot.entity.position=new Vec3(p.x+0.5,p.y,p.z+0.5);worker.climbed=job.tunnel.length;},
  // the pathfinder's 1x1 tower: places a block under the bot at each jump
  async navigate(goal){if(goal.x===ORIGIN.x&&goal.y===ORIGIN.y&&goal.z===ORIGIN.z){w.set(0,62,0,'cobblestone');w.set(0,63,0,'cobblestone');bot.entity.position=new Vec3(0.5,64,0.5);worker.towered=true;}}});
 return {bot,worker,logs,gapsSeen};
}
test('nightMineWanted: a sealed box, a stone pickaxe, blocks to tower back, inside the window',()=>{
 const ok={tod:NIGHT_MINE_FROM,pickaxe:true,blocks:NIGHT_MINE_BLOCKS};
 assert.equal(nightMineWanted(ok),true);
 assert.equal(nightMineWanted({...ok,tod:NIGHT_MINE_FROM-1}),false,'the first spawns first');
 assert.equal(nightMineWanted({...ok,tod:NIGHT_MINE_STOP}),false,'too close to dawn');
 assert.equal(nightMineWanted({...ok,pod:true}),false,'a pod has no room');
 assert.equal(nightMineWanted({...ok,pickaxe:false}),false);
 assert.equal(nightMineWanted({...ok,blocks:NIGHT_MINE_BLOCKS-1}),false);
 assert.equal(nightMineWanted({...ok,done:true}),false,'once a night');
 assert.equal(nightMineWanted({...ok,enabled:false}),false);
});
test('tunnelBreach: an open cell the bot did not dig is a cave',()=>{
 const w=world({'5,60,1':'air'});
 assert.equal(tunnelBreach(w.blockAt,{x:5,y:60,z:0},new Set(['5,60,0','5,61,0'])).z,1);
 assert.equal(tunnelBreach(w.blockAt,{x:5,y:60,z:0},new Set(['5,60,0','5,61,0','5,60,1'])),null);
});
test('the night mine keeps the box sealed, mines wall coal, and is back in the box',async()=>{
 // coal beside the second staircase step
 const w=world();
 const {worker,bot,logs,gapsSeen}=miner(w);
 // the staircase from the sump bottom (0,62,0) heads east, south, west or north by its hash
 const dir=[new Vec3(1,0,0),new Vec3(0,0,1),new Vec3(-1,0,0),new Vec3(0,0,-1)][Math.abs(0*3+0)%4];
 const step2=new Vec3(0,62,0).plus(dir.scaled(2)).offset(0,-2,0);
 const side=new Vec3(dir.z,0,-dir.x);
 w.set(step2.x+side.x,step2.y,step2.z+side.z,'coal_ore');
 const job={id:'s1',placed:[]};
 const ok=await worker.nightMine(job,0,ORIGIN);
 assert.equal(ok,true);
 assert.ok(gapsSeen.every(n=>n===0),'no wall, roof or ring cell ever opened: '+gapsSeen);
 assert.equal(w.nameAt(step2.x+side.x,step2.y,step2.z+side.z),'air','the wall coal was mined');
 assert.ok(worker.climbed>6,'climbed its tunnel back');
 assert.ok(worker.towered,'towered back into the shelter cell');
 assert.deepEqual(bot.entity.position.floored().toArray(),[0,64,0]);
 assert.equal(w.nameAt(0,63,0),'cobblestone','the floor is back');
 assert.ok(logs.some(l=>/Night mine: down from the shelter at/.test(l)));
 assert.ok(logs.some(l=>/Night mine: back in the shelter \(/.test(l)),logs.join('\n'));
 assert.equal(worker.shelterSealed,false,'the caller re-seals');
});
test('the night mine turns back when its tunnel opens onto a cave',async()=>{
 const w=world();
 const dir=[new Vec3(1,0,0),new Vec3(0,0,1),new Vec3(-1,0,0),new Vec3(0,0,-1)][0];
 // a cave pocket beside step 2's head
 const step2=new Vec3(0,62,0).plus(dir.scaled(2)).offset(0,-2,0);
 w.set(step2.x,step2.y+1,step2.z+1,'air');
 const {worker,logs}=miner(w);
 await worker.nightMine({id:'s2',placed:[]},0,ORIGIN);
 assert.ok(logs.some(l=>/back in the shelter \(opened onto a cave at/.test(l)),logs.join('\n'));
 assert.ok(worker.climbed<=3,'turned back at once: '+worker.climbed);
});
test('no night mine over water, or through a player-made floor',async()=>{
 const wet=world({'1,63,0':'water'});
 const a=miner(wet);
 assert.equal(await a.worker.nightMine({id:'w',placed:[]},0,ORIGIN),false);
 assert.equal(wet.nameAt(0,63,0),'stone','nothing dug');
 const built=world({'0,63,0':'oak_planks'});
 const b=miner(built);
 assert.equal(await b.worker.nightMine({id:'p',placed:[]},0,ORIGIN),false);
 assert.ok(b.logs.some(l=>/oak_planks under the shelter is not natural/.test(l)));
 // its own placed floor block is fine to dig
 const own=world({'0,63,0':'oak_planks'});
 const c=miner(own);
 assert.equal(await c.worker.nightMine({id:'o',placed:[{x:0,y:63,z:0}]},0,ORIGIN),true);
});
// ---- round 11: home is checked, never assumed ------------------------------------------------
// hard1: `could not climb back into (163,121,34): No path to the goal!` and `back in the shelter`
// in the same second, while the bot stood 16 blocks away and the re-seal found the sump open.
function physics(w,bot){
 // jump lifts the bot 1.2; forward walks one cell the way it looks (a held jump climbs a stair);
 // letting go lands it on whatever is below.
 const fall=()=>{let p=bot.entity.position.floored();while(p.y>0&&!solidAt(w,p.x,p.y-1,p.z))p=p.offset(0,-1,0);bot.entity.position=new Vec3(p.x+0.5,p.y,p.z+0.5);};
 const held={};
 Object.assign(bot,{yaw:0,
  async look(yaw){bot.yaw=yaw;},
  setControlState(c,v){held[c]=v;
   if(c==='jump'&&v)bot.entity.position=bot.entity.position.offset(0,1.2,0);
   if(c==='forward'&&v){const p=bot.entity.position.floored(),dx=Math.round(-Math.sin(bot.yaw)),dz=Math.round(-Math.cos(bot.yaw));
    const to=new Vec3(p.x+dx,Math.floor(bot.entity.position.y),p.z+dz);
    if(!solidAt(w,to.x,to.y,to.z)&&!solidAt(w,to.x,to.y+1,to.z)){bot.entity.position=new Vec3(to.x+0.5,bot.entity.position.y,to.z+0.5);fall();}}},
  clearControlStates(){for(const c in held)held[c]=false;fall();},
  async placeBlock(ref,face){const t=ref.position.plus(face);if(bot.entity.position.floored().equals(t))return;w.set(t.x,t.y,t.z,'cobblestone');}});
 return fall;
}
test('the tower fails: the bot pillars up its sump and is really back in the cell',async()=>{
 const w=world();
 const {worker,bot,logs}=miner(w);
 physics(w,bot);
 worker.navigate=async goal=>{if(goal.x===ORIGIN.x&&goal.y===ORIGIN.y&&goal.z===ORIGIN.z)throw Error('No path to the goal!');};
 const ok=await worker.nightMine({id:'t1',placed:[]},0,ORIGIN);
 assert.equal(ok,true,logs.join('\n'));
 assert.deepEqual(bot.entity.position.floored().toArray(),[0,64,0],'feet in the shelter cell');
 assert.equal(w.nameAt(0,63,0),'cobblestone');assert.equal(w.nameAt(0,62,0),'cobblestone','the sump is filled');
 assert.ok(logs.some(l=>/could not climb back into/.test(l)));
 assert.ok(logs.some(l=>/pillaring up the sump from y=62/.test(l)),logs.join('\n'));
 assert.ok(logs.some(l=>/Night mine: back in the shelter \(/.test(l)));
});
test('the climb and the tower both fail at the strip end: it walks the tunnel by hand, then pillars',async()=>{
 const w=world();
 const {worker,bot,logs}=miner(w);
 physics(w,bot);
 worker.climbTunnel=async()=>{throw Error('Navigation timed out');};
 worker.navigate=async()=>{throw Error('No path to the goal!');};
 const ok=await worker.nightMine({id:'t2',placed:[]},0,ORIGIN);
 assert.equal(ok,true,logs.join('\n'));
 assert.ok(logs.some(l=>/walking the tunnel back by hand from/.test(l)),logs.join('\n'));
 assert.deepEqual(bot.entity.position.floored().toArray(),[0,64,0]);
});
test('no way home: the night mine says so instead of claiming the shelter',async()=>{
 const w=world();
 const {worker,bot,logs}=miner(w,{items:[{name:'stone_pickaxe',count:1,type:901}]});
 physics(w,bot);
 worker.climbTunnel=async()=>{throw Error('Navigation timed out');};
 worker.navigate=async()=>{throw Error('No path to the goal!');};
 worker.walkTunnelBack=async()=>false; // knocked off the tunnel, no blocks to pillar with
 const r=await worker.nightMine({id:'t3',placed:[]},0,ORIGIN);
 assert.equal(r,'away');
 assert.ok(!logs.some(l=>/Night mine: back in the shelter/.test(l)),logs.join('\n'));
 assert.ok(logs.some(l=>/Night mine: not back in the shelter .*the box is at \(0, 64, 0\)/.test(l)),logs.join('\n'));
});
test('pillarUp never jumps into a ceiling',async()=>{
 const w=world({'0,66,0':'stone'});
 const {worker,bot,logs}=miner(w);
 physics(w,bot);
 bot.entity.position=new Vec3(0.5,64,0.5);
 assert.equal(await worker.pillarUp(65,0),false);
 assert.ok(logs.some(l=>/Pillar: ceiling at \(0, 66, 0\)/.test(l)));
});
test('tunnelHeading: the strip carries on the stairs heading',async()=>{
 const {tunnelHeading}=await import('../src/worker.js');
 assert.deepEqual(tunnelHeading([{x:0,y:62,z:0},{x:0,y:61,z:-1}]).toArray(),[0,0,-1]);
 assert.equal(tunnelHeading([{x:0,y:62,z:0}]),null);
 assert.equal(tunnelHeading([{x:0,y:62,z:0},{x:0,y:61,z:0}]),null,'a straight drop has no heading');
});
