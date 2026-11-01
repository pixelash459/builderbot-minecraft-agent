import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EventEmitter} from 'node:events';
import {Vec3} from 'vec3';
import {Worker,guardPlace,SHELTER_CROWD,CROWD_WAIT_MS,NO_AVOID_LOG_MS} from '../src/worker.js';
import {fleeHeading,FLEE_DROP_DEADLY} from '../src/night.js';

// Round 81: the round-80 soak on the Nitrous world copy.
test('round 81: the sneak-place guard installs once mineflayer injects placeBlock',async()=>{
 // round-80 normal3: 597 stale chest windows - connect() ran the guard before placeBlock existed
 const bot=new EventEmitter(),log=[];let sneak=false;
 bot.getControlState=()=>sneak;bot.setControlState=(k,v)=>{if(k==='sneak'){sneak=v;log.push('sneak='+v);}};
 guardPlace(bot);
 assert.equal(bot.__rawPlace,undefined,'nothing to wrap yet');
 bot.placeBlock=async ref=>{log.push('place on '+ref.name+' sneak='+sneak);};
 bot.emit('inject_allowed');
 await bot.placeBlock({name:'chest'},{x:0,y:1,z:0});
 assert.deepEqual(log,['sneak=true','place on chest sneak=true','sneak=false']);
 const src=fs.readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
 assert.ok(src.includes("if(typeof bot.placeBlock!=='function')return afterInject(bot,'placeBlock',()=>guardPlace(bot));"));
});
test('round 81: the flee heading never takes a lethal drop or one onto lava',()=>{
 // round-80 hard3: hostiles on three sides, a 13-block cliff to the east with lava at its foot
 const me=new Vec3(834.5,87,-540.5);
 const land=(cliff)=>(x,y,z)=>x>=835?cliff(y):{name:y<=86?'grass_block':'air',boundingBox:y<=86?'block':'empty'};
 const lava=land(y=>y===73?{name:'lava',boundingBox:'empty'}:{name:y<73?'stone':'air',boundingBox:y<73?'block':'empty'});
 const dry8=land(y=>({name:y<=78?'stone':'air',boundingBox:y<=78?'block':'empty'}));
 const crowd=[[0,-3],[0,3],[-3,0],[-2,-2],[-2,2],[1,-3],[1,3]].map(([dx,dz])=>({position:new Vec3(me.x+dx,87,me.z+dz)}));
 const east=h=>!h.blocked&&h.x>0.3;
 assert.ok(!east(fleeHeading(lava,me,crowd,{health:20})),'never toward lava');
 assert.ok(!east(fleeHeading(dry8,me,crowd,{health:6})),'an 8 drop (5 damage) at health 6');
 assert.ok(east(fleeHeading(dry8,me,crowd,{health:20})),'the same drop at health 20 is a way out');
 // a column with drops of FLEE_DROP_DEADLY+ on every side: stand
 assert.ok(FLEE_DROP_DEADLY<=12);
 const pillar=(x,y,z)=>{const on=x===834&&z===-541&&y<=86;return {name:on?'dirt':'air',boundingBox:on?'block':'empty'};};
 assert.equal(fleeHeading(pillar,me,crowd,{health:20}).blocked,true);
});
test('round 81: a crowd around the box keeps the walls up, for at most the crowd wait',async()=>{
 assert.equal(SHELTER_CROWD,6);assert.equal(CROWD_WAIT_MS,180000);
 const logs=[];let crowd=9,t=0;
 const real=Date.now;Date.now=()=>t;
 try{
  const w=Object.assign(Object.create(Worker.prototype),{log:m=>logs.push(m),check(){},deadline:Infinity,
   nearestOf:()=>({d:Infinity,name:null}),hostilesWithin:()=>crowd});
  const timers=globalThis.setTimeout;
  globalThis.setTimeout=(fn,ms)=>{t+=ms;if(t>=40000)crowd=4;return timers(fn,0);};
  try{await w.waitCreeperClear(0);}finally{globalThis.setTimeout=timers;}
  assert.equal(logs[0],'Shelter: 9 hostiles within 16; keeping the walls up');
  assert.equal(logs.at(-1),'Shelter: 4 hostiles within 16; opening the walls');
  // a crowd that never thins: open at the cap
  logs.length=0;crowd=12;t=0;
  globalThis.setTimeout=(fn,ms)=>{t+=ms;return timers(fn,0);};
  try{await w.waitCreeperClear(0);}finally{globalThis.setTimeout=timers;}
  assert.equal(logs.at(-1),'Shelter: 12 hostiles within 16 after 180 s; opening the walls');
  // a small group: no hold
  logs.length=0;crowd=3;await w.waitCreeperClear(0);assert.deepEqual(logs,[]);
 }finally{Date.now=real;}
});
test('round 81: the no-avoidance retry line is logged once per cell per 30 s',async()=>{
 const logs=[];let t=1e9;const real=Date.now;Date.now=()=>t;
 try{
  const mv={exclusionAreasStep:[],_mobAvoidHook:null};
  const w=Object.assign(Object.create(Worker.prototype),{log:m=>logs.push(m),navigate:async()=>{},
   bot:{entity:{position:new Vec3(809.5,92,-530.5)},pathfinder:{movements:mv}}});
  for(let i=0;i<20;i++){await w.navigateNoAvoid({},0,10);t+=500;}
  assert.equal(logs.length,1);
  t+=NO_AVOID_LOG_MS;await w.navigateNoAvoid({},0,10);
  assert.equal(logs.length,2);assert.match(logs[1],/trying without it \(19 more here in \d+ s\)$/);
  w.bot.entity.position=new Vec3(820.5,92,-530.5);await w.navigateNoAvoid({},0,10);
  assert.equal(logs.length,3);assert.equal(logs[2],'Navigation: no path with mob avoidance at (820, 92, -531); trying without it');
 }finally{Date.now=real;}
});
