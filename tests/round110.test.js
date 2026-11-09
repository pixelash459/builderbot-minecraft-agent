import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {KeepDistanceTask,RANGED_KEEP,RANGED_MOBS,BOW_RANGE,inSight,FLEE_STUCK_LOGS} from '../src/chains/fallbackTasks.js';
console.error=()=>{};

// Round 110: the round-109 soak's one death - hard3 `still recovering` at health 7, the
// KeepDistanceTask(16) with a skeleton 10.0 away under the canopy, `shot by Skeleton` 3 s later.
// The keep-away had no jump and no turn, and 16 is inside the skeleton's 15-block bow with the
// 16-20 band walking the bot back toward it.
const S={name:'stone',boundingBox:'block'},A={name:'air',boundingBox:'empty'};
const world=(extra={})=>(x,y,z)=>extra[x+','+y+','+z]||(y<=63?S:A);
const mob=(id,name,x,z=0.5)=>({id,name,type:'hostile',position:new Vec3(x,64,z),isValid:true,height:name==='skeleton'?1.99:1.95});
function keepBot(mobs,extra={}){
 const keys={},at=world(extra),entities={};
 for(const m of mobs)entities[m.id]=m;
 return {keys,entity:{position:new Vec3(0.5,64,0.5),onGround:true},health:7,food:18,entities,
  inventory:{items:()=>[],slots:[]},registry:{foodsByName:{}},time:{timeOfDay:1000},
  setControlState:(k,v)=>{keys[k]=v;},getControlState:k=>!!keys[k],look:async()=>{},
  blockAt:p=>{const b=at(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z));return {...b,position:p.floored(),skyLight:15};}};
}
const ctxOf=logs=>({config:{chains:{}},worker:{log:x=>logs.push(x)}});

test('round 110: a skeleton in sight is kept 24 away, past its bow, and said once',()=>{
 assert.equal(RANGED_KEEP,24);assert.equal(BOW_RANGE,15);assert.ok(RANGED_KEEP>BOW_RANGE+4);
 assert.deepEqual([...RANGED_MOBS].sort(),['bogged','skeleton','stray']);
 // the death's shape: a skeleton 10 away in the open
 const bot=keepBot([mob(1,'skeleton',-9.5)]),logs=[],t=new KeepDistanceTask(16);t.now=()=>0;
 assert.equal(t.isFinished(bot,ctxOf(logs)),false);
 t.onTick(bot,ctxOf(logs));
 assert.ok(t.heading.x>0.9,'east, away from it');
 assert.equal(bot.keys.forward,true);assert.equal(bot.keys.sprint,true);assert.equal(bot.keys.back,false);
 assert.deepEqual(logs,['Reflex: skeleton 10.0 away has the bot in sight (health 7); keeping 24 away, past its bow range']);
 t.onTick(bot,ctxOf(logs));assert.equal(logs.length,1,'once a keep-away');
 // 18 away: outside the old 16 but inside the bow plus margin - it keeps running, never backs toward it
 const b2=keepBot([mob(1,'skeleton',-17.5)]),t2=new KeepDistanceTask(16);t2.now=()=>0;
 t2.onTick(b2,ctxOf([]));
 assert.equal(b2.keys.forward,true);assert.equal(b2.keys.back,false);assert.equal(t2.isFinished(b2,ctxOf([])),false);
 // past RANGED_KEEP: done
 const b3=keepBot([mob(1,'skeleton',-25.5)]),t3=new KeepDistanceTask(16);
 assert.equal(t3.isFinished(b3,ctxOf([])),true);
 // a zombie 18 away keeps the old hover (the 16-20 band backs, no run)
 const b4=keepBot([mob(1,'zombie',-17.5)]),t4=new KeepDistanceTask(16);t4.now=()=>0;
 t4.onTick(b4,ctxOf([]));
 assert.equal(b4.keys.forward,false);assert.equal(b4.keys.back,true);assert.equal(t4.isFinished(b4,ctxOf([])),true);
});

test('round 110: a skeleton that cannot see the bot is the old 16-block keep-away',()=>{
 // a three-high stone wall between the bot and a skeleton 18 away
 const wall={};for(const y of [64,65,66])wall['-3,'+y+',0']=S;
 const bot=keepBot([mob(1,'skeleton',-17.5)],wall),logs=[],t=new KeepDistanceTask(16);t.now=()=>0;
 assert.equal(inSight(bot,bot.entities[1]),false);
 assert.equal(t.isFinished(bot,ctxOf(logs)),true);
 t.onTick(bot,ctxOf(logs));
 assert.equal(bot.keys.forward,false);assert.equal(logs.length,0);
 // the same skeleton in the open is in sight
 const open=keepBot([mob(1,'skeleton',-17.5)]);
 assert.equal(inSight(open,open.entities[1]),true);
});

test('round 110: the keep-away jumps a step and turns off a heading that does not move it (the round-109 flee)',()=>{
 // a one-block step east
 const bot=keepBot([mob(1,'zombie',-4.5)],{'1,64,0':S}),t=new KeepDistanceTask(16);t.now=()=>0;
 t.onTick(bot,ctxOf([]));
 assert.ok(t.heading.x>0.9);assert.equal(bot.keys.jump,true,'the step: jump');
 // a dead-end pocket open only to the west, where the zombie is
 const pocket={};for(let z=-3;z<=3;z++)for(const y of [64,65])pocket['1,'+y+','+z]=S;
 for(let x=-3;x<=0;x++)for(const z of [-1,1])for(const y of [64,65])pocket[x+','+y+','+z]=S;
 const b2=keepBot([mob(1,'zombie',-4.5)],pocket),logs=[],t2=new KeepDistanceTask(16);let now=50;t2.now=()=>now;
 t2.onTick(b2,ctxOf(logs));now+=0.5;t2.onTick(b2,ctxOf(logs));now+=0.5;t2.onTick(b2,ctxOf(logs));
 assert.equal(logs[0],'Flee: no headway for 1.0 s heading east from (0, 64, 0) (ahead: feet stone, head stone); trying another way');
 assert.ok(Math.atan2(Math.abs(t2.heading.z),t2.heading.x)>0.6,'turned off east');
 for(let i=0;i<20;i++){now+=0.5;t2.onTick(b2,ctxOf(logs));}
 assert.equal(logs.filter(l=>/^Flee: no headway/.test(l)).length,FLEE_STUCK_LOGS);
 t2.onStop(b2);assert.equal(b2.keys.forward,false);assert.equal(b2.keys.jump,false);
});
