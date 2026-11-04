// Round 94 (round-93 hard2: six random `exploring before retry` legs for wood took the bot down a
// plains strip between the ocean and a lake, three ending boxed in in the water, with the cherry
// grove ~100 east of three of the starts; wood at 1717 s and a drowned death on the way): the
// wood step's explore heads for a tree biome it can sample, else for the least water.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Autopilot,woodHeading,WOOD_SAMPLES} from '../src/autopilot.js';

const NAMES=['plains','sunflower_plains','cherry_grove','ocean','river','beach','stony_shore','forest'];
const ID=Object.fromEntries(NAMES.map((n,i)=>[n,i+1]));
// A biome fake: biomeAt(x,z) names the biome of an absolute column; null leaves it unloaded.
function biomeBot(x,z,biomeAt){
 return {entity:{position:{x:x+0.5,y:64,z:z+0.5}},
  registry:{biomes:Object.fromEntries(NAMES.map((n,i)=>[i+1,{name:'minecraft:'+n}]))},
  world:{getColumn:(cx,cz)=>({getBiome:p=>{const n=biomeAt(cx*16+p.x,cz*16+p.z);return n?ID[n]:null;}})}};
}
// The round-93 soak world around hard2's explore start at (694, -491), read from its region files:
// ocean west and north, a shore then plains south, sunflower plains then the cherry grove east.
const at694=(x,z)=>{
 if(x<694)return 'ocean';
 if(z<-491)return z>=-491-16?'stony_shore':'ocean';
 if(z>-491)return z<=-491+16?'stony_shore':z<=-491+48?'beach':'plains';
 return x>=694+96?'cherry_grove':'sunflower_plains';
};

test('round 94: the wood explore heads for the tree biome it can sample',()=>{
 assert.deepEqual(WOOD_SAMPLES,[16,48,96,128]);
 const h=woodHeading(biomeBot(694,-491,at694));
 assert.equal(h.direction,'east');
 assert.deepEqual(h.tree,{biome:'cherry_grove',dist:96});
 // a forest 16 west beats a grove 96 east only on score: 2+2+3+3 against 0+0+3+3
 const west=woodHeading(biomeBot(0,0,(x,z)=>x<0?'forest':x>=96?'cherry_grove':'plains'));
 assert.equal(west.direction,'west');assert.deepEqual(west.tree,{biome:'forest',dist:16});
});

test('round 94: with no tree biome in reach it takes the heading with the least water',()=>{
 // the hard anchor (704, -423): north plains then a stony shore, south plains then ocean, east a
 // lake (river), west the beach and the ocean
 const anchor=(x,z)=>x>704?(x>=704+48?'river':'plains'):x<704?(x>=704-16?'beach':'ocean'):z<-423?(z<=-423-96?'stony_shore':'plains'):z>-423?(z>=-423+96?'ocean':'plains'):'plains';
 const seen=new Set();
 for(const r of [0,0.49,0.51,0.99]){
  const h=woodHeading(biomeBot(704,-423,anchor),()=>r);
  assert.ok(['north','south'].includes(h.direction),h.direction);assert.equal(h.tree,null);seen.add(h.direction);
 }
 assert.deepEqual([...seen].sort(),['north','south'],'the tie is split, not always the first');
 // nothing loaded, or no bot position: random as before
 assert.equal(woodHeading(biomeBot(0,0,()=>null)).direction,'random');
 assert.equal(woodHeading({}).direction,'random');
});

test('round 94: a blocked wood step explores by woodHeading and logs it; other steps stay random',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r94-'));
 try{
  const logs=[];
  const ap=new Autopilot({log:m=>logs.push(m),bot:biomeBot(694,-491,at694)},root);
  assert.deepEqual(ap.blockedExplore('wood',{surface:true,surfaceY:63}),{type:'explore',direction:'east',distance:48,surface:true,surfaceY:63});
  assert.ok(logs.includes('Autopilot: the wood explore heads east (cherry_grove at 96)'),logs.join('\n'));
  assert.deepEqual(ap.blockedExplore('stone'),{type:'explore',direction:'random',distance:64});
  assert.equal(logs.length,1,'no heading line for the stone step');
  ap.worker.bot=biomeBot(0,0,()=>null);
  assert.equal(ap.blockedExplore('wood').direction,'random');
  assert.equal(logs.length,1,'no heading line when the explore stays random');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
 // the blocked-step branch submits it
 const src=fs.readFileSync(new URL('../src/autopilot.js',import.meta.url),'utf8');
 assert.ok(src.includes("this.submit(step,this.blockedExplore(step,surface));"));
 assert.ok(!src.includes("this.submit(step,{type:'explore',direction:'random',distance:step==='wood'?48:64"));
});
