// Minecraft 26.3 requires client tick boundaries between movement packets.
// Upstream diagnosis: PrismarineJS/mineflayer#4128 (pending in 4.39.0).
// Apply per connection; no global package files or server settings are changed.
// While asleep the server rejects client movement, so those packets are suppressed.
// Global serverbound budget. Round 3 soak, hard2 17:58Z: Paper kicked the bot with 'You are
// sending too many packets!' (its limiter counts ALL play packets, 500/s averaged over 7 s),
// and only movement and input were capped here. Every play packet now goes through a 1 s
// sliding window of PACKET_BUDGET. Over it, packets a later one supersedes (movement, look,
// input, tick boundaries) and swings are dropped; everything else (digs, uses, attacks,
// clicks, chat) queues in order and drains as the window frees, at most PACKET_QUEUE deep (a
// runaway loop loses its newest packets, never memory). keep_alive, teleport_confirm and the
// tick boundary after a sent movement always go out. Swings are also capped at SWING_PER_SECOND on their own.
export const PACKET_BUDGET=200,PACKET_QUEUE=256,SWING_PER_SECOND=10;
const SUPERSEDED=new Set(['position','position_look','look','flying','player_input','tick_end','arm_animation']);
const ALWAYS=new Set(['keep_alive','teleport_confirm']);
const DROPPED=Symbol('dropped');
export function installMovementFix(bot){
 const client=bot._client,write=client.write.bind(client);
 let enabled=false;
 const sentAt=[],queue=[],swings=[];
 const stats=bot.packetStats={sent:0,dropped:0,queued:0,droppedByName:{},peak:0};
 let lastBudgetLog=0;
 const trim=(list,now)=>{while(list.length&&now-list[0]>=1000)list.shift();};
 const note=(name,how)=>{
  stats[how]++;if(how==='dropped')stats.droppedByName[name]=(stats.droppedByName[name]||0)+1;
  const now=Date.now();if(now-lastBudgetLog>1000){lastBudgetLog=now;console.log('PACKET_BUDGET',how,name,'window',sentAt.length,'queue',queue.length,'dropped',stats.dropped);}
 };
 const out=(name,data,now)=>{sentAt.push(now);stats.sent++;if(sentAt.length>stats.peak)stats.peak=sentAt.length;return write(name,data);};
 const drain=now=>{trim(sentAt,now);while(queue.length&&sentAt.length<PACKET_BUDGET){const [n,d]=queue.shift();out(n,d,now);}};
 const send=(name,data)=>{
  if(client.state!=='play')return write(name,data);
  const now=Date.now();
  if(ALWAYS.has(name))return out(name,data,now);
  if(name==='arm_animation'){trim(swings,now);if(swings.length>=SWING_PER_SECOND){note(name,'dropped');return DROPPED;}swings.push(now);}
  drain(now);
  if(!queue.length&&sentAt.length<PACKET_BUDGET)return out(name,data,now);
  if(SUPERSEDED.has(name)||queue.length>=PACKET_QUEUE){note(name,'dropped');return DROPPED;}
  queue.push([name,data]);note(name,'queued');return undefined;
 };
 // Windows timer hiccups make the physics catch-up loop burst position packets (300+/s),
 // which 26.3 servers reject with "You are sending too many packets!". Cap movement and
 // input packets at 30 per second; dropped intermediate positions are superseded by the next.
 let packetCount=0,packetSecond=Date.now(),lastName='';
 let movementSent=0,movementSecond=Date.now(),inputSent=0,inputSecond=Date.now();
 let lastKeepAlive=null,lastTeleportConfirm=0,lastConfirmedTeleportId=null;
 let staleLook=false,sentRot=null; // rotation the server last received (notchian degrees)
 const allowPace=(sentRef,secondRef)=>{
  const now=Date.now();
  if(now-secondRef.second>1000){secondRef.second=now;sentRef.count=0;}
  sentRef.count++;
  return sentRef.count<=30;
 };
 const movementPace={count:0},movementClock={second:Date.now()},inputPace={count:0},inputClock={second:Date.now()};
 const countPacket=name=>{packetCount++;lastName=name;const now=Date.now();if(now-packetSecond>1000){if(packetCount>45)console.log('PACKET_RATE',packetCount,'per second, last:',lastName);packetCount=0;packetSecond=now;}};
 bot.once('inject_allowed',()=>{enabled=bot.registry.version['>=']('1.21.3');});
 bot.once('login',()=>{enabled=bot.registry.version['>=']('1.21.3');});
 // 1.21.11+/26.x servers reject a move whose player box lands exactly on a block edge
 // (isPlayerCollidingWithAnythingNew: a float-exact 0.3 half-width "clips" the neighbour)
 // and snap the bot back silently, 16+ times a second in cluttered terrain, which is why
 // explore legs made no progress and the teleport gate jammed. Keeping the client's box a
 // hair wider than the server's keeps it off the edge (PrismarineJS/mineflayer#3911, #3913;
 // mineflayer-pathfinder#364). prismarine-physics reads these live.
 const padHitbox=()=>{if(bot.physics&&bot.physics.playerHalfWidth===0.3){bot.physics.playerHalfWidth=0.30001;bot.physics.playerHeight=1.80001;}};
 padHitbox();bot.once('login',padHitbox);
 bot.on('physicsTick',()=>{
  if(!enabled||client.state!=='play'||!bot.getControlState||bot.isSleeping)return;
  if(!allowPace(inputPace,inputClock))return;
  send('player_input',{inputs:{forward:bot.getControlState('forward'),backward:bot.getControlState('back'),left:bot.getControlState('left'),right:bot.getControlState('right'),jump:bot.getControlState('jump'),shift:bot.getControlState('sneak'),sprint:bot.getControlState('sprint')}});
 });
 client.write=(name,data)=>{
  countPacket(name);
  // Every keep-alive request needs its own reply, in order. Round 28 (hard2, 02:47:59 IST):
  // Paper kicked the bot `for sending keepalive response out-of-order` - the old 500 ms pacing
  // here dropped a reply when two requests arrived close together (after a stall), and the
  // next reply then carried the wrong id. Only an exact repeat of the same id is dropped.
  if(name==='keep_alive'){
   const id=data&&data.keepAliveId!=null?String(data.keepAliveId):null;
   if(id!=null&&id===lastKeepAlive)return undefined;
   lastKeepAlive=id;
  }
  // Physics catch-up sends position_look (not bare position) whenever yaw also changes.
  // That packet was uncapped, so a bed teleport plus a look every tick crossed Paper's
  // packet limit and kicked the bot mid-sleep (integration 2026-10-14 09:22 and 09:39,
  // "You are sending too many packets!"). Pure look stays uncapped so a shot still lands.
  const paced=name==='position'||name==='position_look'||name==='flying';
  const movement=['position','position_look','look','flying'].includes(name);
  if(bot.isSleeping&&movement)return undefined;
  // A use/release fires along the server's CURRENT rotation. mineflayer records a look as
  // sent before this wrapper may drop it, and then never re-sends an unchanged aim, so a
  // capped position_look left the server on a stale heading for the whole bow draw.
  // Re-assert the bot's rotation (one uncapped look) before the release; use_item carries
  // its own rotation (1.21.2+), which the server applies.
  if(name==='block_dig'&&data&&data.status===5)syncLook();
  if(name==='use_item'&&data&&data.rotation){staleLook=false;sentRot={yaw:Math.fround(data.rotation.x),pitch:Math.fround(data.rotation.y)};}
  if(paced&&!allowPace(movementPace,movementClock)){
   if(name==='position_look')staleLook=true;
   return undefined;
  }
  // The next position that gets through carries the rotation the dropped packet held.
  if(name==='position'&&staleLook&&data&&typeof data.yaw==='number')name='position_look';
  if(name==='teleport_confirm'){
   // Every teleport id must be confirmed exactly once. Paper does not re-send an unconfirmed
   // teleport (updateAwaitingTeleport has the resend disabled), so a dropped confirm leaves
   // the server awaiting it for good: it then ignores every movement packet AND every block
   // interaction (handleUseItemOn requires awaitingPositionFromClient == null). Two teleports
   // inside 100 ms ("moved too quickly" bursts) used to lose the second confirm this way,
   // and placements then timed out with "Server did not answer" until the next teleport.
   if(data&&data.teleportId===lastConfirmedTeleportId)return undefined;
   lastConfirmedTeleportId=data&&data.teleportId;
   lastTeleportConfirm=Date.now();
  }
  if(name==='teleport_confirm'&&bot.entity){
   data={...data,x:bot.entity.position.x,y:bot.entity.position.y,z:bot.entity.position.z,yRot:180-bot.entity.yaw*180/Math.PI,xRot:-bot.entity.pitch*180/Math.PI};
  }
  const result=send(name,data);
  if(result===DROPPED){if(name==='position_look'||name==='look')staleLook=true;return undefined;}
  if(name==='position_look'||name==='look'){staleLook=false;if(data)sentRot={yaw:data.yaw,pitch:data.pitch};}
  // The boundary after a movement that went out is part of that movement (26.3 rejects two
  // moves in one tick), so it is never dropped; the movement cap above bounds it.
  if(enabled&&client.state==='play'&&!bot.isSleeping&&movement)out('tick_end',{},Date.now());
  return result;
 };
 function syncLook(){
  if(!enabled||client.state!=='play'||!bot.entity||bot.isSleeping)return;
  const D=1/(Math.PI/180),yaw=Math.fround((Math.PI-bot.entity.yaw)*D),pitch=Math.fround(-bot.entity.pitch*D); // mineflayer's toNotchian*
  if(!staleLook&&sentRot&&sentRot.yaw===yaw&&sentRot.pitch===pitch)return;
  const onGround=!!bot.entity.onGround;
  client.write('look',{yaw,pitch,onGround,flags:{onGround,hasHorizontalCollision:false}});
 }
 const timer=setInterval(()=>{if(client.state==='play')drain(Date.now());if(enabled&&client.state==='play'&&!bot.isSleeping)send('tick_end',{});},50);timer.unref&&timer.unref();
 bot.once('end',()=>clearInterval(timer));
}

// Weather from the rain/thunder LEVELS, not from the begin/end flags.
// mineflayer's rain plugin names game event 1 'start_raining' and 2 'stop_raining', but on this
// server (Paper 26.3 through ViaBackwards to a 1.21.4 client) event 1 arrives when the sky
// CLEARS and event 2 when rain BEGINS (the historical protocol table: 1 = end raining,
// 2 = begin raining; the names were measured here with a second bot, 2026-10-14). The plugin's
// level handler only corrects the flag when the level crosses 0, so after `weather clear` the
// flag could stay `isRaining=true` for the rest of the session (the soak's dawn/clear check then
// failed on every run after the first death). Every join/respawn re-sends the levels, so the
// level itself is the reliable signal: raining = rain level past the half-way point of its
// 5-second fade. Falls back to the plugin's flags until the first level packet arrives.
export function installWeatherFix(bot){
 let rainLevel=null,thunderLevel=null,pluginRaining=false,pluginThunder=0;
 Object.defineProperty(bot,'isRaining',{configurable:true,enumerable:true,
  get(){return rainLevel===null?pluginRaining:rainLevel>0.5;},
  set(v){pluginRaining=!!v;}});
 Object.defineProperty(bot,'thunderState',{configurable:true,enumerable:true,
  get(){return thunderLevel===null?pluginThunder:(thunderLevel>0.5?thunderLevel:0);},
  set(v){pluginThunder=v;}});
 bot.weatherLevels=()=>({rain:rainLevel,thunder:thunderLevel});
 bot._client.on('game_state_change',packet=>{
  const reason=packet.reason;
  const value=Number(packet.gameMode)||0;
  if(reason==='rain_level_change'||reason===7)rainLevel=value;
  else if(reason==='thunder_level_change'||reason===8)thunderLevel=value;
 });
}
