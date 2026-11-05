// Round 97 (round-96 hard3: a wood search leg left the bot on a cherry canopy at (831, 101, -496),
// a leaf under the feet and the grass 5 below; a sheep hunt and three stone gathers were all
// `No path to the goal!` for ~5 min until a dusk dig-down broke through): a walk with no path
// from a leaf stand digs the leaves under the feet down to the ground, then paths again.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Vec3} from 'vec3';
import {Worker,canopyFloor,CANOPY_DROP,STRANDED_HEALTH} from '../src/worker.js';

// hard3's column, read from the soak world's region files: cherry leaves at y=100, air 96-99,
// grass 95, dirt 94, stone 93 and below.
function column(over={}){
 const cells={100:'cherry_leaves',95:'grass_block',94:'dirt',...over};
 const name=y=>cells[y]??(y<=93?'stone':'air');
 return (x,y,z)=>x===831&&z===-496?name(y):'air';
}
function fakeBot(world,y=101,health=20){
 const dug=new Set();
 const at=(x,y,z)=>dug.has(x+','+y+','+z)?'air':world(x,y,z);
 const bot={health,entity:{position:new Vec3(831.5,y,-495.5)},
  blockAt:p=>{const n=at(p.x,p.y,p.z);return {name:n,boundingBox:n==='air'||n==='water'?'empty':'block',position:new Vec3(p.x,p.y,p.z)};},
  dig:async bl=>{
   dug.add(bl.position.x+','+bl.position.y+','+bl.position.z);
   let fy=bl.position.y; // fall to the first solid cell
   while(bot.blockAt(new Vec3(831,fy-1,-496)).boundingBox!=='block')fy--;
   bot.entity.position=new Vec3(831.5,fy,-495.5);bot.digs=(bot.digs||0)+1;
  }};
 return bot;
}

test('round 97: canopyFloor finds the ground under a leaf stand',()=>{
 assert.equal(CANOPY_DROP,6);
 const f=new Vec3(831,101,-496);
 assert.deepEqual(canopyFloor(fakeBot(column()),f),{under:'cherry_leaves',stand:96});
 // more leaves on the way down are dug through too
 assert.deepEqual(canopyFloor(fakeBot(column({97:'cherry_leaves'})),f),{under:'cherry_leaves',stand:96});
 // not on leaves: the grass itself, a log, the bot's own dirt pillar
 assert.equal(canopyFloor(fakeBot(column()),new Vec3(831,96,-496)),null);
 assert.equal(canopyFloor(fakeBot(column({100:'cherry_log'})),f),null);
 assert.equal(canopyFloor(fakeBot(column({100:'dirt'})),f),null);
 // the ground more than 6 below, water or lava on the way, an unloaded cell: no
 assert.equal(canopyFloor(fakeBot(column({95:'air',94:'air'})),f),null,'7 below');
 assert.deepEqual(canopyFloor(fakeBot(column({95:'air'})),f),{under:'cherry_leaves',stand:95},'6 below');
 assert.equal(canopyFloor(fakeBot(column({95:'water'})),f),null);
 assert.equal(canopyFloor(fakeBot(column({96:'lava'})),f),null);
 assert.equal(canopyFloor(fakeBot(column({95:'magma_block'})),f),null);
 assert.equal(canopyFloor({blockAt:p=>p.y===100?{name:'cherry_leaves',boundingBox:'block'}:null},f),null);
});

test('round 97: a walk with no path from the canopy digs down to the ground',async()=>{
 const logs=[],bot=fakeBot(column({97:'cherry_leaves'}));
 const w=Object.assign(Object.create(Worker.prototype),{bot,log:m=>logs.push(m),check(){}});
 assert.equal(await w.canopyDown(0),true);
 assert.equal(Math.floor(bot.entity.position.y),96);assert.equal(bot.digs,2);
 assert.deepEqual(logs,['Navigation: no path from the canopy at (831, 101, -496) (cherry_leaves under the feet, the ground 5 below); digging down through the leaves',
  'Navigation: down from the canopy y=101 -> 96; pathing again']);
 assert.equal(w._canopy,false);
 // on the ground now: nothing more to do
 assert.equal(await w.canopyDown(0),false);assert.equal(logs.length,2);
 // low health, a tunnel climb, or already digging: no
 for(const set of [{health:STRANDED_HEALTH-1},{_ownFallback:true},{_canopy:true}]){
  const b=fakeBot(column(),101,set.health??20),l=[];
  const v=Object.assign(Object.create(Worker.prototype),{bot:b,log:m=>l.push(m),check(){},...(set.health?{}:set)});
  assert.equal(await v.canopyDown(0),false,JSON.stringify(set));assert.equal(l.length,0);assert.equal(b.digs,undefined);
 }
});

test('round 97: both no-path branches of navigate try the canopy descent first',()=>{
 const src=fs.readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
 const hook='if(await this.canopyDown(token))return await this.navigate(goal,token,seconds);';
 assert.equal(src.split(hook).length-1,2);
 // after the no-avoidance retry, before the water search and the stair-out
 const i=src.indexOf(hook),j=src.indexOf(hook,i+1);
 assert.ok(i<src.indexOf("this.log('Navigation: no path from the water at '")&&src.indexOf("this.log('Navigation: no path from the water at '")<j);
 assert.ok(j<src.indexOf("if(/ [12] nodes/.test(last)&&!this._staired&&!this._ownFallback){"));
});
