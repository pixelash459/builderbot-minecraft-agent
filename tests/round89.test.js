import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,ASCEND_PILLAR} from '../src/worker.js';

// Round 89: the round-88 soak on the Nitrous world copy (hard1's cave morning at (818, 62, -543):
// no path up, the pillar segments stopped at y=88 under a surface of 92, health 20 -> 11 on the
// way, and a skeleton shot it 8 s after `Completed shelter`).
function cave({seg=88,skyAt=null}={}){
 const logs=[],pillars=[];let sky=0;
 const bot={health:20,entity:{position:new Vec3(820.5,62,-542.5)},blockAt:()=>({name:'stone',boundingBox:'block',skyLight:sky,position:new Vec3(0,0,0)})};
 const w=Object.assign(Object.create(Worker.prototype),{bot,log:m=>logs.push(m),check(){},strandedTunnel:null,
  // the stair-out inside the navigation: 2 steps up, then no path
  navigate:async()=>{bot.entity.position=new Vec3(820.5,64,-542.5);throw Error('No path to the goal!');},
  pillarUp:async(target,token,opts)=>{
   pillars.push({target,opts});
   if(pillars.length===1){bot.entity.position=new Vec3(820.5,Math.min(target,seg),-542.5);bot.health=11;}
   else{const top=skyAt??target;bot.entity.position=new Vec3(820.5,top,-542.5);if(skyAt!=null)sky=15;if(skyAt!=null)assert.equal(opts.until(),true);}
   return true;}});
 return {w,bot,logs,pillars};
}

test('round 89: a no-path pillar that stops 4 under the surface with no sky pillars on to the sky',async()=>{
 const {w,logs,pillars}=cave({skyAt:91});
 await w.ascend({spec:{type:'ascend',y:92,sky:true}},0);
 assert.equal(pillars.length,2);
 assert.equal(pillars[0].target,88,'the segment stops at the surface - 4');
 assert.equal(pillars[1].target,88+ASCEND_PILLAR);assert.equal(typeof pillars[1].opts.until,'function');
 assert.deepEqual(logs,['Ascend: path up stopped (No path to the goal!)','Ascend: no path up from y=62; pillaring','Ascend: no sky at y=88 after the climb (surface 92); pillaring to the sky',
  'Ascend: head sky 15 at y=91; health 20 -> 11 on the climb','Ascend: y=62 -> 91 (surface 92)']);
});

test('round 89: a pillar short of its own target is not retried, and an escape ascend keeps its old lines',async()=>{
 // the segment stopped at 70 (a ceiling it may not dig): one pillar only
 const short=cave({seg:70});
 await short.w.ascend({spec:{type:'ascend',y:131,sky:true}},0);
 assert.equal(short.pillars.length,1);
 // an escape ascend (no sky wanted) that pillared to 4 under: no sky pillar, no sky line
 const plain=cave();
 await plain.w.ascend({spec:{type:'ascend',y:92}},0);
 assert.equal(plain.pillars.length,1);
 assert.deepEqual(plain.logs,['Ascend: path up stopped (No path to the goal!)','Ascend: no path up from y=62; pillaring','Ascend: y=62 -> 88 (surface 92)']);
});
