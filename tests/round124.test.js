import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,DROWNED_BANK_R,DROWNED_HIT_NEAR} from '../src/worker.js';
import {Autopilot,DROWNED_BANK_LEAVES} from '../src/autopilot.js';
console.error=()=>{};

// Round 124: the round-123 hard3 shape - five trident deaths in 99 s, one mark per death; death 1
// lived through a trident hit (18.5 -> 6.8) and stayed on the bank. A trident hit now marks the bank.
const ent=(name,x,y,z,held)=>({name,type:'hostile',position:new Vec3(x,y,z),isValid:true,heldItem:held?{name:held}:null});
const AT=new Vec3(763.5,64,-441.5);
function worker(entities={}){
 const logs=[],bot={entity:{position:AT},entities,health:20};
 const w=Object.assign(Object.create(Worker.prototype),{bot,jobs:[],log:m=>logs.push(m),config:{limits:{minHealth:0,minFood:0}}});
 return {w,bot,logs};
}

test('round 124: a trident hit marks the bank at once; a zombie hit, a scratch or a far trident does not',()=>{
 const {w,bot,logs}=worker({1:ent('trident',765,65,-440)});
 bot.health=18.5;w.onHealth(bot);bot.health=6.8;w.onHealth(bot);
 assert.equal(w.drownedBanksLive().length,1,logs.join('\n'));
 assert.deepEqual(logs,['Drowned bank: marked (763, 64, -442) for 10 min (trident 2 away at a hit, health 18.5 -> 6.8, hit 1 here); logs within '+DROWNED_BANK_R+' are set aside and the ladder walks out of trident range first']);
 // a second hit on the same bank renews the mark
 bot.health=3;w.onHealth(bot);
 assert.equal(w.drownedBanksLive().length,1);assert.equal(w.drownedBanksLive()[0].hits,2);
 // regen is not a hit
 logs.length=0;bot.health=4;w.onHealth(bot);assert.deepEqual(logs,[]);
 for(const [ents,hp] of [[{1:ent('zombie',764,64,-441)},12],[{1:ent('trident',763,64,-441-DROWNED_HIT_NEAR-2)},12],[{1:ent('trident',765,65,-440)},19],[{1:ent('drowned',770,62,-441,'trident')},12]]){
  const o=worker(ents);o.bot.health=20;o.w.onHealth(o.bot);o.bot.health=hp;o.w.onHealth(o.bot);
  assert.deepEqual(o.w.drownedBanksLive(),[],JSON.stringify(ents)+' '+hp);
 }
});

test('round 124: a hit mark sends the walk out of trident range, with a fresh budget after the last death\'s',()=>{
 const {w,bot}=worker({1:ent('trident',765,65,-440)});
 const subs=[],ap=Object.create(Autopilot.prototype);
 Object.assign(ap,{worker:w,log:()=>{},submit:(s,j)=>subs.push([s,j]),mobDefenseOn:()=>false});
 w.lastDeath={t:1,pos:AT};
 ap.bankLeave={death:1,n:DROWNED_BANK_LEAVES,out:true}; // the last death's walks spent (the round-123 key)
 bot.health=18.5;w.onHealth(bot);bot.health=6.8;w.onHealth(bot);
 assert.equal(ap.leaveDrownedBank(bot),true);
 assert.equal(subs.length,1);assert.equal(subs[0][1].type,'explore');
});
