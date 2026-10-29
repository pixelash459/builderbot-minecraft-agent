import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {WorldSurvivalChain} from '../src/chains/worldSurvivalChain.js';
import {sinkGuard,SINK_MS} from '../src/worker.js';

// Round 69: the round-68 scout on the Nitrous world copy.
function dryBot(air){
 return {oxygenLevel:air,health:20,entity:{position:new Vec3(0.5,60,0.5),isInWater:false},
  blockAt:()=>({name:'air'}),setControlState(){},getControlState(){return false;}};
}
test('round 69: falling air is water to the drowning latch when the client sees none',()=>{
 const w=new WorldSurvivalChain();const logs=[];const ctx={worker:{log:m=>logs.push(m)}};
 const bot=dryBot(9);
 w._handleDrowning(bot,{},ctx);assert.equal(w._drowning,false,'one reading: nothing to compare');
 bot.oxygenLevel=8;w._handleDrowning(bot,{},ctx);
 assert.equal(w._drowning,false,'round 70: one level is not yet a fall');
 bot.oxygenLevel=7;w._handleDrowning(bot,{},ctx);
 assert.equal(w._drowning,true,'air 9 -> 7 with a dry head: drowning');
 assert.match(logs.join(' '),/air falling \(air 7\) with no water seen at the head \(air\) or feet \(air\)/);
 const fresh=new WorldSurvivalChain();const still=dryBot(8);
 fresh._handleDrowning(still,{},ctx);fresh._handleDrowning(still,{},ctx);
 assert.equal(fresh._drowning,false,'a steady low reading on dry land is not water');
});
test('round 69: the sink guard holds jump on falling air with a dry-looking head',()=>{
 const ctl={};const bot=dryBot(20);bot.getControlState=k=>!!ctl[k];bot.setControlState=(k,v)=>{ctl[k]=v;};
 const st={};
 for(let t=0,a=20;t<=SINK_MS+2500;t+=750,a--){bot.oxygenLevel=a;var line=sinkGuard(bot,st,t)||line;}
 assert.equal(ctl.jump,true);
 assert.match(line,/head block air - the water is not seen, the air is falling/);
 bot.oxygenLevel=20;sinkGuard(bot,st,SINK_MS+5000);
 assert.equal(ctl.jump,false,'air back up: let go');
});
