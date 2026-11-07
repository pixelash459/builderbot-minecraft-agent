// Round 102 (round-101 hard3: `held past dawn by creeper 2.3 dy 1 sky 0`, the creeper pressed to the box
// wall under rock from dawn to tod 9080, then the job's exit margin and the 60 s creeper wait ended
// together: `Job time limit reached`, walls still up, and the bot stood in that cell to the end of the run).
// These tests go through the real shelter() hold on a fake clock: 20 ticks of the day per second.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,BOX_PINNED_MS,ROCK_SKY} from '../src/worker.js';

const CELL=new Vec3(828,91,-502);
const mob=(name,dx,dy,dz,sky)=>({name,type:'hostile',sky,position:CELL.offset(dx+0.5,dy,dz+0.5)});
const creeper=()=>mob('creeper',2,1,1,0);
function box({mobs=[creeper()],climb=true,surface=80}={}){
 const logs=[],calls={climbs:[],down:0,marked:0,reseal:0};
 const b={entity:{position:CELL.offset(0.5,0,0.5)},health:20,time:{timeOfDay:990,day:1},inventory:{items:()=>[]},entities:{},
  blockAt:p=>({name:'stone',boundingBox:'block',skyLight:(Object.values(b.entities).find(e=>e.position.floored().offset(0,1,0).equals(p))?.sky)??0})};
 const set=l=>{b.entities={};l.forEach((e,i)=>{b.entities[i]=e;});};set(mobs);
 const job={spec:{type:'shelter'},placed:[{x:828,y:93,z:-502}],origin:{x:CELL.x,y:CELL.y,z:CELL.z},shell:[],sawDark:true};
 const w=Object.assign(Object.create(Worker.prototype),{bot:b,config:{nightMine:false},autopilot:{lastSurfaceY:surface},deadline:Infinity,shelterGaps:0,
  log:m=>logs.push(m),check(){},save(){},update(){},noteShelter(){},nearHazard:()=>false,burrowAgain:()=>false,
  shelterStock:()=>64,shelterNeed:()=>7,centreInCell:async()=>{},guardShelter:async()=>{},
  sealShelter:async()=>{calls.reseal++;},
  markMobCave(){calls.marked++;},
  ascend:async j=>{calls.climbs.push(j.spec);if(climb)b.entity.position=b.entity.position.offset(0,6,0);else throw Error('Could not climb toward the surface from y=91');},
  removeShelter:async()=>{calls.down++;}});
 return {w,b,job,logs,calls,set};
}
// `each(seconds)` runs on the fake clock, after every step of the hold
async function run(t,each=()=>{}){
 const {w,b,job}=t,real=Date.now,timers=globalThis.setTimeout;let now=1e6;const t0=now;
 Date.now=()=>now;
 globalThis.setTimeout=(fn,ms)=>{now+=ms;b.time.timeOfDay+=ms/50;each((now-t0)/1000);if(now-t0>900000)throw Error('never left the hold');return timers(fn,0);};
 try{await w.shelter(job,0);}finally{Date.now=real;globalThis.setTimeout=timers;}
 return (now-t0)/1000;
}

test('round 102: the round-101 box: a creeper at the wall under rock, out through the roof 30 s past dawn',async()=>{
 assert.equal(BOX_PINNED_MS,30000);assert.equal(ROCK_SKY,3);
 const t=box();const s=await run(t);
 assert.ok(s<45,s+' s, not 404');
 assert.ok(t.logs.includes('Shelter: held past dawn by creeper 2.4 dy 1 sky 0'),t.logs.join('\n'));
 assert.ok(t.logs.includes('Shelter: pinned 30 s past dawn by creeper 2.4 dy 1 sky 0; climbing out through the roof'),t.logs.join('\n'));
 assert.equal(t.calls.climbs.length,1);assert.equal(t.calls.climbs[0].sky,true);assert.equal(t.calls.climbs[0].y,96);
 assert.equal(t.calls.down,0,'the walls stay up beside the creeper');
 assert.equal(t.calls.marked,0,'one creeper is not a mob cave');
 assert.equal(t.logs.some(l=>/opening up/.test(l)),false);
});

test('round 102: a mob that leaves inside the 30 s is the old morning: the box opens, no climb',async()=>{
 const t=box();const s=await run(t,sec=>{if(sec>=20)t.set([]);});
 assert.ok(s<30);assert.equal(t.calls.climbs.length,0);assert.equal(t.calls.down,1);
 assert.equal(t.logs.some(l=>/pinned/.test(l)),false);
});

test('round 102: a mob with the sky over it holds the box as before; once it is gone the rest is a pin',async()=>{
 const zombie=mob('zombie',-7,0,0,15),t=box({mobs:[creeper(),zombie]});
 const s=await run(t,sec=>{if(sec>=100)t.set([creeper()]);});
 assert.ok(s>=100&&s<102,String(s));assert.equal(t.calls.climbs.length,1);
 assert.ok(t.logs.some(l=>/^Shelter: pinned 100 s past dawn by creeper/.test(l)),t.logs.join('\n'));
});

test('round 102: a canopy is not rock: a mob at sky 8 does not pin the box',async()=>{
 const t=box({mobs:[mob('skeleton',8,0,0,8)]});
 await run(t,sec=>{if(sec>=120)t.set([]);});
 assert.equal(t.calls.climbs.length,0);assert.equal(t.calls.down,1);
 assert.equal(box({mobs:[mob('skeleton',8,0,0,ROCK_SKY)]}).w.boxPinned({heldSince:1},2000),true);
 assert.equal(box({mobs:[mob('skeleton',8,0,0,ROCK_SKY+1)]}).w.boxPinned({heldSince:1},2000),false);
});

test('round 102: only by day, only once held, only after the wait, one try a box, and never an empty list',()=>{
 const {w}=box(),now=Date.now(),old=now-BOX_PINNED_MS-1000;
 assert.equal(w.boxPinned({heldSince:old},2000),true);
 assert.equal(w.boxPinned({},2000),false,'never held');
 assert.equal(w.boxPinned({heldSince:now-BOX_PINNED_MS+1000},2000),false,'inside the wait');
 assert.equal(w.boxPinned({heldSince:old},999),false,'before the morning is light');
 assert.equal(w.boxPinned({heldSince:old},10000),false,'dusk: the box is wanted again');
 assert.equal(w.boxPinned({heldSince:old},null),false,'no clock');
 assert.equal(w.boxPinned({heldSince:old,roofTried:true},2000),false);
 assert.equal(box({mobs:[]}).w.boxPinned({heldSince:old},2000),false);
});

test('round 102: a climb that fails goes back to holding the box: no second try, no walls down beside the mob',async()=>{
 const t=box({climb:false});
 const s=await run(t,sec=>{if(sec>=200)t.set([]);});
 assert.equal(t.calls.climbs.length,1,'one try');
 assert.ok(t.logs.includes('Shelter: could not climb out; holding the box'),t.logs.join('\n'));
 assert.ok(s>=200,'held until the creeper left: '+s);assert.equal(t.calls.down,1);
 assert.equal(t.logs.some(l=>/could not climb out of the cave/.test(l)),false);
});

test('round 102: a pinned box in a mob cave is still marked as one, and a plain cave morning is unchanged',async()=>{
 const crowd=[creeper(),mob('zombie',3,0,3,0),mob('skeleton',-4,0,2,0)];
 const t=box({mobs:crowd,surface:100});await run(t);
 assert.equal(t.calls.marked,1);assert.equal(t.calls.climbs.length,1);
 assert.ok(t.logs.some(l=>/^Shelter: pinned 30 s past dawn by/.test(l)));
 // the old exit: mobs out past 16 and within 24 do not pin it, and it still reads as a cave morning
 const far=[mob('zombie',17,0,0,0),mob('zombie',-17,0,0,0),mob('zombie',0,0,17,0)],c=box({mobs:far,surface:100});
 await run(c);
 assert.ok(c.logs.includes('Shelter: morning in a cave (3 hostiles within 24, sky 0); climbing out through the roof'),c.logs.join('\n'));
 assert.equal(c.calls.marked,1);assert.equal(c.job.roofTried,undefined);
});
