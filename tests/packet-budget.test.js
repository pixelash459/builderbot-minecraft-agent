import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {installMovementFix,PACKET_BUDGET,PACKET_QUEUE,SWING_PER_SECOND} from '../src/compat.js';
import {EscapeFreezingTask} from '../src/chains/fallbackTasks.js';
// Round 3 soak, hard2 17:58Z: 'You are sending too many packets!' (Paper counts every play
// packet, 500/s averaged over 7 s). Only movement and input were capped. The budget holds
// every serverbound play packet to PACKET_BUDGET in any 1 s window.
console.log=()=>{};
function compatBot(){
 const b=new EventEmitter(),packets=[];
 b.registry={version:{'>=':()=>true}};
 b.entity={position:{x:1,y:64,z:2},yaw:0,pitch:0,onGround:true};
 b._client={state:'play',write:(name,data)=>packets.push({name,data,t:Date.now()})};
 installMovementFix(b);b.emit('login');
 return {b,packets};
}
// The most packets inside any 1000 ms window.
const peak=packets=>{let best=0,i=0;for(let j=0;j<packets.length;j++){while(packets[j].t-packets[i].t>=1000)i++;best=Math.max(best,j-i+1);}return best;};
test('a dig/attack flood never exceeds the budget in any second, and queued packets keep their order',t=>{
 t.mock.timers.enable({apis:['Date','setInterval'],now:2_000_000});
 const {b,packets}=compatBot();
 for(let i=0;i<1000;i++)b._client.write('block_dig',{status:i%2,location:{x:0,y:0,z:0},face:1,sequence:i});
 assert.equal(packets.length,PACKET_BUDGET,'the first window fills');
 assert.equal(b.packetStats.queued,PACKET_QUEUE,'the rest queues up to the cap');
 assert.equal(b.packetStats.dropped,1000-PACKET_BUDGET-PACKET_QUEUE,'a runaway loop loses its newest packets');
 for(let s=0;s<3;s++)t.mock.timers.tick(1000);
 const digs=packets.filter(p=>p.name==='block_dig');
 assert.equal(digs.length,PACKET_BUDGET+PACKET_QUEUE,'the queue drained');
 assert.deepEqual(digs.map(p=>p.data.sequence),[...Array(PACKET_BUDGET+PACKET_QUEUE).keys()],'in order');
 assert.ok(peak(packets)<=PACKET_BUDGET,'peak '+peak(packets));
 b.emit('end');
});
test('over budget, superseded packets (look, tick_end) drop; keep_alive and teleport_confirm always go out',t=>{
 t.mock.timers.enable({apis:['Date','setInterval'],now:3_000_000});
 const {b,packets}=compatBot();
 for(let i=0;i<PACKET_BUDGET;i++)b._client.write('use_entity',{target:1,mouse:1,sneaking:false});
 const n=packets.length;
 b._client.write('look',{yaw:10,pitch:0,onGround:true});
 b._client.write('keep_alive',{keepAliveId:1n});
 b._client.write('teleport_confirm',{teleportId:4});
 assert.deepEqual(packets.slice(n).map(p=>p.name),['keep_alive','teleport_confirm']);
 assert.equal(b.packetStats.droppedByName.look,1);
 // A dropped look is not forgotten: the next position that gets through carries it.
 t.mock.timers.tick(1001);
 b._client.write('position',{x:1,y:64,z:2,yaw:10,pitch:0});
 assert.equal(packets.filter(p=>p.name!=='tick_end').at(-1).name,'position_look');
 b.emit('end');
});
test('arm swings are capped on their own',t=>{
 t.mock.timers.enable({apis:['Date','setInterval'],now:4_000_000});
 const {b,packets}=compatBot();
 for(let i=0;i<50;i++)b._client.write('arm_animation',{hand:0});
 assert.equal(packets.filter(p=>p.name==='arm_animation').length,SWING_PER_SECOND);
 t.mock.timers.tick(1001);
 b._client.write('arm_animation',{hand:0});
 assert.equal(packets.filter(p=>p.name==='arm_animation').length,SWING_PER_SECOND+1);
 b.emit('end');
});
test('normal play traffic (20 Hz movement, input and ticks) is never touched',t=>{
 t.mock.timers.enable({apis:['Date','setInterval'],now:5_000_000});
 const {b,packets}=compatBot();b.getControlState=()=>false;
 for(let tick=0;tick<200;tick++){ // 10 s of play
  b._client.write('position',{x:1+tick/100,y:64,z:2});
  b.emit('physicsTick');
  if(tick%7===0)b._client.write('block_dig',{status:0,location:{x:0,y:0,z:0},face:1,sequence:tick});
  t.mock.timers.tick(50);
 }
 assert.equal(b.packetStats.dropped,0);assert.equal(b.packetStats.queued,0);
 assert.ok(packets.filter(p=>p.name==='player_input').length>=190,'input went out every tick');
 b.emit('end');
});
test('the powder-snow escape digs once, not once per tick',()=>{
 // A 20 Hz bot.dig restarts the dig every tick: a dig start, an abort, a swing and a look.
 const calls=[];
 const snow={name:'powder_snow',position:{x:0,y:-60,z:0}};
 const bot={entity:{position:{x:0.5,y:-60,z:0.5,offset(dx,dy,dz){return {x:this.x+dx,y:this.y+dy,z:this.z+dz};}}},
  blockAt:p=>Math.floor(p.y)===-60&&Math.floor(p.x)===0&&Math.floor(p.z)===0?snow:null,
  dig:()=>{calls.push('dig');return new Promise(()=>{});},setControlState(){},look:async()=>{}};
 const task=new EscapeFreezingTask();
 for(let i=0;i<20;i++)task.onTick(bot,{});
 assert.equal(calls.length,1);
});
test('a movement that gets through always carries its tick boundary, even at the budget edge',t=>{
 t.mock.timers.enable({apis:['Date','setInterval'],now:6_000_000});
 const {b,packets}=compatBot();
 for(let i=0;i<PACKET_BUDGET-1;i++)b._client.write('use_entity',{target:1,mouse:1,sneaking:false});
 b._client.write('position',{x:1,y:64,z:2}); // takes the last slot
 assert.deepEqual(packets.slice(-2).map(p=>p.name),['position','tick_end']);
 b._client.write('position',{x:1.1,y:64,z:2}); // over budget: dropped, and no orphan boundary
 assert.equal(packets.at(-1).name,'tick_end');assert.equal(packets.filter(p=>p.name==='position').length,1);
 b.emit('end');
});
// Round 28 (hard2 kicked `for sending keepalive response out-of-order`): every keep-alive id
// gets its reply, however close together they come; only an exact repeat is dropped.
test('keep-alive replies are never paced away, only exact repeats are dropped',()=>{
 const {b,packets}=compatBot();
 b._client.write('keep_alive',{keepAliveId:100n});
 b._client.write('keep_alive',{keepAliveId:101n}); // a few ms later: must still go out
 b._client.write('keep_alive',{keepAliveId:101n}); // the same id twice: one reply
 assert.deepEqual(packets.filter(p=>p.name==='keep_alive').map(p=>p.data.keepAliveId),[100n,101n]);
 b.emit('end');
});
