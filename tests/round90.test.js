import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,ASCEND_PILLAR,SKY_OVER} from '../src/worker.js';

// Round 90: the round-89 soak on the Nitrous world copy (hard1's cave morning at (806, 58, -534):
// a 4-step stair-out to y=62, `no sky at y=62 after the climb (surface 89)`, the pillar to its own
// target 62+24, `head sky 0 at y=86`, and slain by a zombie 11 s later).
function cave({from=62,roof=89}={}){
 const logs=[],pillars=[];let sky=0;
 const bot={health:4,entity:{position:new Vec3(806.5,58,-533.5)},blockAt:()=>({name:'stone',boundingBox:'block',skyLight:sky,position:new Vec3(0,0,0)})};
 const w=Object.assign(Object.create(Worker.prototype),{bot,log:m=>logs.push(m),check(){},strandedTunnel:null,
  navigate:async()=>{bot.entity.position=new Vec3(810.5,from,-533.5);throw Error('No path to the goal!');},
  // the pillar rises until its until() holds (the sky over the roof) or its target
  pillarUp:async(target,token,opts)=>{pillars.push({target,opts});
   for(let y=from;y<target;y++){bot.entity.position=new Vec3(810.5,y+1,-533.5);sky=y+1>roof?15:0;if(opts.until&&opts.until())break;}
   return true;}});
 return {w,bot,logs,pillars};
}

test('round 90: the sky pillar goes on past its 24 to the sky over the surface anchor',async()=>{
 const {w,logs,pillars}=cave();
 await w.ascend({spec:{type:'ascend',y:89,sky:true}},0);
 assert.equal(pillars.length,1);
 assert.equal(pillars[0].target,Math.max(62+ASCEND_PILLAR,89+SKY_OVER));
 assert.equal(pillars[0].target,95,'not the 86 of round 89');
 assert.deepEqual(logs.slice(-3),['Ascend: no sky at y=62 after the climb (surface 89); pillaring to the sky','Ascend: head sky 15 at y=90; health 4 -> 4 on the climb','Ascend: y=58 -> 90 (surface 89)']);
});

test('round 90: a short climb under a low surface keeps the 24 target',async()=>{
 const {w,pillars}=cave({from:62,roof:70});
 await w.ascend({spec:{type:'ascend',y:70,sky:true}},0);
 assert.equal(pillars[0].target,62+ASCEND_PILLAR);
});
