import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,openSurface,SURFACE_SLACK,RESEAL_BACKOFF_MS} from '../src/worker.js';

// Round 59: the round-58 soak on seed 6274947974391380586 - rolling ground under the hard anchor,
// an unreachable oak trunk aimed at again and again, and a shelter re-sealing 7 cells 100 times.
test('round 59: open-sky ground below the surface floor is still the surface, a deep ravine is not',()=>{
 const bot=(y,sky)=>({entity:{position:new Vec3(0.5,y,0.5)},blockAt:()=>({skyLight:sky})});
 assert.equal(openSurface(bot(62,15),67),true,'5 under the floor, open sky');
 assert.equal(openSurface(bot(67-SURFACE_SLACK-1,15),67),false,'deeper than the slack');
 assert.equal(openSurface(bot(62,4),67),false,'under a roof: a cave');
});
test('round 59: an unreachable log blacklists its whole trunk for the next job',()=>{
 const seen=new Set(),w=Object.create(Worker.prototype);
 Object.assign(w,{logs:[],log(m){this.logs.push(m);},save(){},
  blacklist:{block:p=>seen.add(p.x+','+p.y+','+p.z),blockRecently:p=>seen.has(p.x+','+p.y+','+p.z)}});
 const job={spec:{type:'gather',block:'log'}};
 try{w.gatherFailed(job,{name:'oak_log',position:new Vec3(721,73,-378)},Error('Cannot reach or harvest this block (walk: No path to the goal!)'));}catch{}
 for(const y of [70,72,74,80])assert.equal(w.gatherBlacklisted({},new Vec3(721,y,-378)),true,'y='+y);
 assert.equal(w.gatherBlacklisted({},new Vec3(722,73,-378)),false,'the next trunk is still fair game');
 assert.ok(job.badColumns.includes('721,-378'));
});
test('round 59: a re-seal that closes nothing says why and backs off',async()=>{
 const w=Object.create(Worker.prototype);let seals=0;
 const origin=new Vec3(0,64,0);
 Object.assign(w,{logs:[],log(m){this.logs.push(m);},check(){},
  bot:{entity:{position:new Vec3(0.5,64,0.5)},entities:{},inventory:{items:()=>[{name:'dirt',count:0}]},blockAt:()=>({name:'air',boundingBox:'empty'})},
  sealShelter:async()=>{seals++;throw Error('No blocks to seal with');}});
 await w.guardShelter({pod:null},1,origin);
 assert.equal(seals,1);
 assert.ok(w.logs.some(l=>/^Shelter: re-seal left \d+ open \(No blocks to seal with; 0 blocks held\); next try in 15 s/.test(l)),JSON.stringify(w.logs));
 await w.guardShelter({pod:null},1,origin);
 assert.equal(seals,1,'backing off');
 w.resealIdleUntil=Date.now()-1;await w.guardShelter({pod:null},1,origin);
 assert.equal(seals,2);assert.equal(RESEAL_BACKOFF_MS,15000);
});
