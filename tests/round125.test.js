import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Autopilot,woodHeading,WOOD_LEG_GAIN,WOOD_LEG_AVOID_MS} from '../src/autopilot.js';
console.error=()=>{};

// Round 125: the round-124 hard1 river islands - `heads south (the least water)` seven times in a
// row from the same spot, every leg blocked. A leg that got under WOOD_LEG_GAIN sets its heading aside.
// Plains all round, the river 48 north and west and east: south is the least water.
function biomeBot(x,z){
 const bot={entity:{position:new Vec3(x,64,z)},registry:{biomes:{1:{name:'river'},2:{name:'plains'}}}};
 const wetAt=(gx,gz)=>gz<z-30||gx<x-30||gx>x+30;
 bot.world={getColumn:(cx,cz)=>({getBiome:p=>wetAt(cx*16+p.x,cz*16+p.z)?1:2})};
 return bot;
}
function pilot(bot){
 const logs=[],ap=Object.create(Autopilot.prototype);
 Object.assign(ap,{worker:{bot},log:m=>logs.push(m)});
 return {ap,logs};
}

test('round 125: a wood leg that got nowhere sets its heading aside; one that got clear does not',()=>{
 const bot=biomeBot(839,-699),{ap,logs}=pilot(bot);
 const first=ap.blockedExplore('wood').direction;
 assert.notEqual(first,'random');
 // the leg was blocked: the bot is back within a few blocks of the start
 bot.entity.position=new Vec3(841,61,-701);
 const second=ap.blockedExplore('wood').direction;
 assert.notEqual(second,first,logs.join('\n'));
 assert.ok(logs.some(l=>l==='Autopilot: the last wood explore '+first+' got the bot 3 blocks from (839, -699); heading another way for '+WOOD_LEG_AVOID_MS/60000+' min'),logs.join('\n'));
 // the second leg got clear: nothing more is set aside, and the first stays aside
 bot.entity.position=new Vec3(841+WOOD_LEG_GAIN+10,61,-701);
 const n=logs.length;
 const third=ap.blockedExplore('wood').direction;
 assert.equal(logs.filter(l=>/got the bot/.test(l)).length,1);
 assert.notEqual(third,first);
 assert.ok(logs.length>=n);
 // the set-aside runs out
 ap.woodAvoid.forEach(a=>{a.until=Date.now()-1;});ap.woodLeg=null;
 assert.equal(ap.woodLegAvoid().size,0);
});

test('round 125: woodHeading takes the set-aside headings off the top, but still picks one when all are aside',()=>{
 const bot=biomeBot(0,0);
 const free=woodHeading(bot,()=>0);
 const aside=woodHeading(bot,()=>0,new Set([free.direction]));
 assert.notEqual(aside.direction,free.direction);
 const all=woodHeading(bot,()=>0,new Set(['north','south','east','west']));
 assert.equal(all.direction,free.direction);
});
