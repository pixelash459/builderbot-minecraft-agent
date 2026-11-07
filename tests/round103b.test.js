import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,DROP_CLIMB_MIN} from '../src/worker.js';

// Round 103, pre-soak: the round-102 normal3 full-bag stall. `Dropped cobblestone came back into the
// inventory` 15 times at (831, 57, -418), a dead-end iron tunnel 6 under the surface (y=63), and the
// ladder stood 7.5 min on `waiting: bag full (iron craft)`.
function tunnelDrop({y=57,surface=63,backAt=[57],ascendTo=null}={}){
 const air={name:'air',boundingBox:'empty'},stone={name:'stone',boundingBox:'block'};
 const inv=[{name:'cobblestone',count:320,type:1}];const tossed=[],ascends=[];
 const bot={entity:{position:new Vec3(831.5,y,-417.5)},async look(){},pathfinder:{},
  // a 6-long tunnel east of the feet at every height (the toss always has an open run)
  blockAt(p){const dx=p.x-831,dy=p.y-Math.floor(bot.entity.position.y);return dx>0&&dx<=6&&p.z===-418&&(dy===0||dy===1)?air:stone;},
  inventory:{items:()=>inv.filter(i=>i.count>0)},
  async toss(t,m,n){tossed.push({n,y:Math.floor(bot.entity.position.y)});if(!backAt.includes(Math.floor(bot.entity.position.y)))inv[0].count-=n;}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,dropSettleMs:0,logs:[],log(m){this.logs.push(m);},check(){},
  autopilot:{lastSurfaceY:surface},
  count(n){return inv.filter(i=>i.name===n).reduce((a,i)=>a+i.count,0);},
  async navigate(){},
  async ascend(job){ascends.push(job.spec);if(ascendTo!=null)bot.entity.position=new Vec3(831.5,ascendTo,-417.5);}});
 return {w,tossed,ascends,bot};
}
test('round 103: a toss that came back in a tunnel climbs to the surface and tosses again there',async()=>{
 const {w,tossed,ascends}=tunnelDrop({backAt:[57],ascendTo:63});
 const job={spec:{type:'drop',item:'cobblestone',count:256}};
 await w.drop(job,0);
 assert.deepEqual(ascends,[{type:'ascend',y:63}]);
 assert.deepEqual(tossed.map(t=>t.y),[57,63],'one toss below, one on top');
 assert.equal(w.count('cobblestone'),64);
 assert.ok(w.logs.includes('Drop: the toss at (831, 57, -418) came straight back; climbing to the surface (y=63) to toss there'),w.logs.join('\n'));
 assert.match(w.logs.at(-1),/^Dropped 256 cobblestone/);
});
test('round 103: the climb is tried once a drop job; a toss that comes back on top still fails',async()=>{
 const {w,tossed,ascends}=tunnelDrop({backAt:[57,63],ascendTo:63});
 const job={spec:{type:'drop',item:'cobblestone',count:256}};
 await assert.rejects(w.drop(job,0),/came back/);
 assert.equal(ascends.length,1);assert.equal(tossed.length,2);
 assert.equal(job.retriedUp,true);
});
test('round 103: no climb on the surface, just under it, or with no surface known',async()=>{
 for(const opts of [{y:63,surface:63},{y:63-DROP_CLIMB_MIN+1,surface:63},{y:57,surface:null}]){
  const {w,ascends}=tunnelDrop({...opts,backAt:[opts.y]});
  await assert.rejects(w.drop({spec:{type:'drop',item:'cobblestone',count:256}},0),/came back/);
  assert.deepEqual(ascends,[],JSON.stringify(opts));
 }
});
test('round 103: a climb that did not rise gives the old failure, with the stop logged',async()=>{
 const {w,ascends}=tunnelDrop({backAt:[57],ascendTo:null});
 await assert.rejects(w.drop({spec:{type:'drop',item:'cobblestone',count:256}},0),/came back/);
 assert.equal(ascends.length,1);
 assert.ok(w.logs.some(l=>/climbing to the surface/.test(l)));
});
