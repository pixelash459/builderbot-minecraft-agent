import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Vec3} from 'vec3';
import {ledgeGuard,fleeDrop,FLEE_DROP_LAND,FLEE_DROP_MARK_MS} from '../src/worker.js';
import {FLEE_DROP_DEADLY} from '../src/night.js';

// Round 127: the round-126 soak on the Nitrous world copy. hard2a2 fled a 48-mob dawn crowd at
// health 12.7 to the cliff at (777, 82, -566); the flee's heading had kept the drop, the ledge guard
// stopped it on the edge, and skeleton arrows took it 12.7 -> 0 in 0.7 s.
// The bot at x=777.5 moving east; the cliff edge at x=778, the floor `drop` cells below, `under` there.
function cliff({drop=7,under='stone',health=12.7,mark=true,vx=0.2,vz=0}={}){
 const controls={forward:true,sprint:true},logs=[];
 const at=p=>{const x=Math.floor(p.x),y=Math.floor(p.y);
  if(x<=777)return y<82?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'};
  if(y===82-drop-1)return under==='water'?{name:'water',boundingBox:'empty'}:{name:under,boundingBox:'block'};
  if(y<82-drop-1)return {name:'stone',boundingBox:'block'};
  return {name:'air',boundingBox:'empty'};};
 const bot={entity:{position:new Vec3(777.5,82,-565.5),velocity:new Vec3(vx,0,vz),onGround:true},health,blockAt:at,
  getControlState:k=>!!controls[k],setControlState:(k,v)=>{controls[k]=v;},_ledgeLog:m=>logs.push(m)};
 if(mark)bot._fleeDrop={x:1,z:0,until:Date.now()+FLEE_DROP_MARK_MS};
 return {bot,controls,logs};
}
test('round 127: a flee that chose a survivable drop goes over it; the guard still stops everything else',()=>{
 // hard2's cliff at health 12.7: a 7-block drop, 4 to lose
 let s=cliff();
 assert.equal(fleeDrop(s.bot),7);
 assert.equal(ledgeGuard(s.bot),false,'not stopped');
 assert.equal(s.controls.forward,true);
 assert.equal(s.logs[0],'Ledge guard: the flee goes over the 7-block drop at (777, 82, -566) (health 12.7, about 4 to lose on landing; standing on the edge is worse)');
 // no flee mark (a fight, a food chase): stopped as before
 s=cliff({mark:false});assert.equal(ledgeGuard(s.bot),true);assert.equal(s.controls.forward,false);
 // a stale mark: stopped
 s=cliff();s.bot._fleeDrop.until=Date.now()-1;assert.equal(ledgeGuard(s.bot),true);
 // moving off the flee heading (sideways): stopped
 s=cliff({vx:0.05,vz:0.2});s.bot._fleeDrop={x:1,z:0,until:Date.now()+FLEE_DROP_MARK_MS};
 assert.equal(fleeDrop(s.bot),0);
 // too little health left after the landing: stopped (round-126 death 2 was at 4.7)
 s=cliff({health:4.7});assert.equal(ledgeGuard(s.bot),true);
 s=cliff({drop:7,health:FLEE_DROP_LAND+4});assert.equal(fleeDrop(s.bot),7,'exactly the margin');
 s=cliff({drop:7,health:FLEE_DROP_LAND+3.9});assert.equal(fleeDrop(s.bot),0);
 // deadly height, water or lava at the foot: stopped
 s=cliff({drop:FLEE_DROP_DEADLY,health:20});assert.equal(ledgeGuard(s.bot),true);
 s=cliff({under:'water',health:20});assert.equal(ledgeGuard(s.bot),true);
 s=cliff({under:'lava',health:20});assert.equal(fleeDrop(s.bot),0);
 // a drop under LEDGE_DROP never reached the guard and still does not
 s=cliff({drop:4,health:20,mark:false});assert.equal(ledgeGuard(s.bot),false);
});
test('round 127: the flee step marks its heading for the guard, and clears it when it stands',()=>{
 const src=fs.readFileSync(new URL('../src/chains/fallbackTasks.js',import.meta.url),'utf8');
 assert.ok(src.includes(" bot._fleeDrop=go?{x:h.x,z:h.z,until:Date.now()+300}:null;\n"));
 assert.equal(FLEE_DROP_MARK_MS,300);
 const w=fs.readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
 assert.ok(w.includes("}if(!bot._ledgeLog)bot._ledgeLog=m=>this.log(m);if(ledgeGuard(bot)&&Date"));
});
