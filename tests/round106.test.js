import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,escapeSpot,compassOf,nightMineOverride,ESCAPE_DIST,ESCAPE_NEAR,ESCAPE_TRIES} from '../src/worker.js';
console.error=()=>{};

// Round 106: the round-105 hard3 death loop. Each respawn came back at night to the world spawn on
// a river bank with an empty bag, into the crowd that had just killed it, tried to shelter there,
// and died again 10-40 s later - 31 deaths. A night respawn into a crowd (or onto ground no burrow
// fits) now runs ESCAPE_DIST blocks to a dry spot it can dig into by hand, away from the mobs.
const k=(x,y,z)=>x+','+y+','+z;
// Flat ground: dirt from y=-70 up to grass at -61, air above; `water(x,z)` turns a column's top
// into water, `stone` makes the ground stone (no burrow by hand).
function world({water=()=>false,stone=false}={}){
 const at3=(x,y,z)=>{
  x=Math.floor(x);y=Math.floor(y);z=Math.floor(z);
  let name='air';
  if(y<=-61&&y>=-70)name=stone?'stone':(y===-61?'grass_block':'dirt');
  if(y<-70)name='bedrock';
  if(water(x,z)&&(y===-61||y===-62))name='water';
  return {name,position:new Vec3(x,y,z),boundingBox:(name==='air'||name==='water')?'empty':'block'};
 };
 return at3;
}
const mob=(name,x,z)=>({name,type:'hostile',isValid:true,position:new Vec3(x,-60,z)});

test('round 106: escapeSpot picks a dry stand it can dig into, away from the mobs and off the river',()=>{
 const me=new Vec3(0.5,-60,0.5);
 // the river runs north-south from x=4 eastwards, the mobs are west: east is the flee line but wet
 const at3=world({water:(x)=>x>=4});
 const s=escapeSpot(at3,me,[mob('zombie',-5.5,0.5),mob('drowned',-4.5,2.5)]);
 assert.ok(s,'a spot');
 assert.ok(s.x<4-2,'not in or beside the river: '+JSON.stringify(s));
 assert.equal(s.y,-60);
 assert.ok(s.minD>=28,'well away from the mobs: '+s.minD);
 assert.ok([ESCAPE_DIST,Math.round(ESCAPE_DIST*0.75)].includes(s.dist));
 // dry flat ground with the mobs west: the run goes east-ish
 const d=escapeSpot(world(),me,[mob('zombie',-5.5,0.5)]);
 assert.ok(Math.cos(d.bearing)>0.5,'away from the mob: '+compassOf(d.bearing));
 assert.equal(d.dist,ESCAPE_DIST);assert.equal(d.wet,0);
});
test('round 106: escapeSpot gives up on water everywhere, and on stone without a pickaxe',()=>{
 const me=new Vec3(0.5,-60,0.5);
 assert.equal(escapeSpot(world({water:(x,z)=>Math.hypot(x,z)>6}),me,[mob('zombie',3,3)]),null);
 assert.equal(escapeSpot(world({stone:true}),me,[mob('zombie',3,3)]),null,'stone by hand');
 assert.ok(escapeSpot(world({stone:true}),me,[mob('zombie',3,3)],{pickaxe:true}),'stone with a pickaxe');
});
test('round 106: compassOf names the heading',()=>{
 assert.equal(compassOf(0),'east');assert.equal(compassOf(Math.PI/2),'south');
 assert.equal(compassOf(Math.PI),'west');assert.equal(compassOf(-Math.PI/2),'north');
 assert.equal(compassOf(-Math.PI/4),'north-east');
});

function fakeWorker({at3=world(),hostiles=[],pos=[0.5,-60,0.5],items=[],walkThrows=null}={}){
 const logs=[],walked=[];
 const bot={entity:{position:new Vec3(...pos)},entities:{},inventory:{items:()=>items},blockAt:p=>at3(p.x,p.y,p.z),spawnPoint:new Vec3(0,-60,0)};
 hostiles.forEach((h,i)=>{bot.entities[10+i]={id:10+i,...h};});
 const w={bot,lastDeath:{t:1000},respawnPos:{x:0.5,y:-60,z:0.5},respawnGuard:()=>true,
  log:m=>logs.push(m),check(){},
  walk:async target=>{walked.push({target,escaping:w.respawnEscaping});if(walkThrows)throw Error(walkThrows);bot.entity.position=new Vec3(target.x+0.5,target.y,target.z+0.5);}};
 return {w,bot,logs,walked};
}
const run=(w,job)=>Worker.prototype.respawnEscape.call(w,job,0);

test('round 106: a night respawn with a hostile near runs out and says where',async()=>{
 const {w,bot,logs,walked}=fakeWorker({hostiles:[mob('zombie',-4.5,0.5),mob('skeleton',0.5,-9.5)]});
 const job={spec:{type:'shelter'}};
 assert.equal(await run(w,job),true);
 assert.equal(walked.length,1);
 assert.equal(walked[0].escaping,true,'Mob Defense\'s respawn override is off during the run');
 assert.equal(w.respawnEscaping,false);
 assert.match(logs[0],/^Respawn: at night with 2 hostile\(s\) within 16 \(zombie 5\.0, skeleton 10\.0\); running 36 blocks (east|south-east|south) to dig in at -?\d+,-60,-?\d+ \(nearest hostile \d+\.\d from it\)$/);
 assert.match(logs[1],/^Respawn: ran out to \(-?\d+, -60, -?\d+\) in \d+\.\d s; digging in$/);
 const t=walked[0].target;assert.ok(Math.hypot(t.x,t.z)>=26);
 assert.deepEqual(job.escape,{t:1000,tries:1});
 void bot;
});
test('round 106: quiet ground it can dig into stays put; a wet spawn with no mob still runs',async()=>{
 {const {w,logs,walked}=fakeWorker({hostiles:[mob('zombie',20.5,0.5)]});
  assert.equal(await run(w,{spec:{type:'shelter'}}),false);
  assert.equal(walked.length,0);assert.deepEqual(logs,[]);}
 // the river bank: water beside the burrow cells
 {const {w,logs,walked}=fakeWorker({at3:world({water:x=>x>=1&&x<=6})});
  assert.equal(await run(w,{spec:{type:'shelter'}}),true);
  assert.equal(walked.length,1);
  assert.match(logs[0],/^Respawn: at night with no hostile within 16, no burrow here \(open wall beside 0,-61,0\); running /);}
});
test('round 106: only at the spawn, only in the guard, ESCAPE_TRIES runs per death',async()=>{
 const crowd=[mob('zombie',-3.5,0.5)];
 // far from where it respawned (a bag run, a walk): no run
 {const {w,walked}=fakeWorker({hostiles:crowd});w.respawnPos={x:40,y:-60,z:0};
  assert.equal(await run(w,{spec:{type:'shelter'}}),false);assert.equal(walked.length,0);}
 // out of the respawn guard
 {const {w,walked}=fakeWorker({hostiles:crowd});w.respawnGuard=()=>false;
  assert.equal(await run(w,{spec:{type:'shelter'}}),false);assert.equal(walked.length,0);}
 // no respawnPos yet: the world spawn point stands in
 {const {w,walked}=fakeWorker({hostiles:crowd});w.respawnPos=null;
  assert.equal(await run(w,{spec:{type:'shelter'}}),true);assert.equal(walked.length,1);}
 // the same death: ESCAPE_TRIES runs, then the shelter goes on where it stands; a new death runs again
 const {w,bot,walked}=fakeWorker({hostiles:crowd});
 const job={spec:{type:'shelter'}};
 for(let i=0;i<ESCAPE_TRIES;i++){bot.entity.position=new Vec3(0.5,-60,0.5);assert.equal(await run(w,job),true);}
 bot.entity.position=new Vec3(0.5,-60,0.5);
 assert.equal(await run(w,job),false);
 assert.equal(walked.length,ESCAPE_TRIES);
 w.lastDeath={t:2000};
 assert.equal(await run(w,job),true);
 assert.equal(walked.length,ESCAPE_TRIES+1);
});
test('round 106: a run that stops on the way shelters where it stopped, with the override back on',async()=>{
 const {w,logs}=fakeWorker({hostiles:[mob('zombie',-3.5,0.5)],walkThrows:'No path'});
 assert.equal(await run(w,{spec:{type:'shelter'}}),true);
 assert.equal(w.respawnEscaping,false);
 assert.match(logs[1],/^Respawn: the run stopped at \(0, -60, 0\) after \d+\.\d s \(No path\); sheltering there$/);
});
test('round 106: no dry spot anywhere: the shelter goes on at the spawn',async()=>{
 const {w,logs,walked}=fakeWorker({at3:world({water:(x,z)=>Math.hypot(x,z)>3}),hostiles:[mob('drowned',2.5,0.5)]});
 assert.equal(await run(w,{spec:{type:'shelter'}}),false);
 assert.equal(walked.length,0);
 assert.match(logs[0],/; no dry spot to dig in 36 out; sheltering here$/);
});
test('round 106: Mob Defense\'s night-respawn override is off while the run is on',()=>{
 const base={jobs:[{status:'running',spec:{type:'shelter'}}],shelterSealed:false,respawnGuard:()=>true};
 const on=Worker.prototype.survivalHold.call({...base,respawnEscaping:false});
 const off=Worker.prototype.survivalHold.call({...base,respawnEscaping:true});
 assert.equal(on.respawned,true);assert.equal(off.respawned,false);
 assert.equal(nightMineOverride('Mob Defense',on,'a hit'),true);
 assert.equal(nightMineOverride('Mob Defense',off,'a hit'),false);
});
test('round 106: the shelter job runs the respawn escape before any burrow or dirt dig',()=>{
 const src=Worker.prototype.shelter.toString();
 const i=src.indexOf('respawnEscape('),j=src.indexOf('this.burrow(');
 assert.ok(i>0&&j>0&&i<j);
 assert.equal(ESCAPE_NEAR,16);
});
