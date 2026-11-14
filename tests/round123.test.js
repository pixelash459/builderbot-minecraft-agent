import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,drownedNear,nearBank,DROWNED_BANK_MS,DROWNED_BANK_R,DROWNED_BANK_SEEN} from '../src/worker.js';
import {Autopilot,bankExit,DROWNED_BANK_CLEAR,DROWNED_BANK_LEAVES} from '../src/autopilot.js';
console.error=()=>{};

// Round 123: the round-122 hard2 loop - 13 `impaled by Drowned` deaths at the spawn river, every
// respawn's wood gather walking back down the same bank. A death beside a drowned marks the bank;
// logs on it are set aside and the first job after the respawn walks out of trident range.
const ent=(name,x,y,z,held)=>({name,type:'hostile',position:new Vec3(x,y,z),isValid:true,heldItem:held?{name:held}:null});
function worker(entities={},at=new Vec3(704.5,64,-436.5)){
 const logs=[],bot={entity:{position:at},entities};
 const w=Object.assign(Object.create(Worker.prototype),{bot,jobs:[],log:m=>logs.push(m)});
 return {w,bot,logs};
}
const DEATH=new Vec3(704.5,62,-444.5);

test('round 123: a death with a drowned or a flying trident in range marks the bank; a zombie death does not',()=>{
 const {w,bot,logs}=worker({1:ent('drowned',716,60,-452,'trident')});
 const mark=w.drownedDeath(bot,DEATH);
 assert.ok(mark,'marked');
 assert.deepEqual(logs,['Drowned bank: marked (704, 62, -445) for '+DROWNED_BANK_MS/60000+' min (drowned 14 away at the death, death 1 here); logs within '+DROWNED_BANK_R+' are set aside and the ladder walks out of trident range first']);
 assert.equal(w.drownedBanksLive().length,1);
 // a second death on the same bank renews the mark; one further along adds a mark
 w.drownedDeath(bot,DEATH.offset(3,1,2));
 assert.equal(w.drownedBanksLive().length,1);assert.equal(w.drownedBanksLive()[0].deaths,2);
 w.drownedDeath(bot,DEATH.offset(15,0,0));
 assert.equal(w.drownedBanksLive().length,2);
 // the hard1 shape: nothing within 8, the trident still in the air
 const air=worker({1:ent('trident',955,64,-560)});
 assert.ok(air.w.drownedDeath(air.bot,new Vec3(955,63,-564)));assert.match(air.logs[0],/\(trident 4 away at the death/);
 // no drowned in range, or only other mobs: no mark
 const far=worker({1:ent('drowned',704,62,-444-DROWNED_BANK_SEEN-2,'trident'),2:ent('zombie',705,62,-444)});
 assert.equal(far.w.drownedDeath(far.bot,DEATH),null);assert.deepEqual(far.logs,[]);assert.deepEqual(far.w.drownedBanksLive(),[]);
 // the mark runs out
 w.drownedBanks.forEach(h=>{h.until=Date.now()-1;});
 assert.deepEqual(w.drownedBanksLive(),[]);
});

test('round 123: drownedNear takes any drowned, or only an armed one',()=>{
 const bot={entity:{},entities:{1:ent('drowned',10,64,0),2:ent('drowned',20,64,0,'trident'),3:ent('zombie',1,64,0)}};
 assert.equal(drownedNear(bot,new Vec3(0,64,0),32).d,10);
 assert.equal(drownedNear(bot,new Vec3(0,64,0),32,true).d,20);
 assert.equal(drownedNear(bot,new Vec3(0,64,0),8),null);
});

test('round 123: the wood gather sets aside logs on a marked bank and beside a drowned with a trident',()=>{
 const {w,bot,logs}=worker({1:ent('drowned',740,60,-420,'trident'),2:ent('drowned',680,60,-436)});
 const log=(x,y,z)=>({name:'oak_log',position:new Vec3(x,y,z)});
 const bank=log(700,64,-450),beside=log(735,66,-410),clear=log(704,70,-405),unarmed=log(676,64,-430);
 const job={};
 // nothing marked, the armed drowned alone: its tree goes, the unarmed drowned's stays
 assert.deepEqual(w.offBank(job,[bank,beside,clear,unarmed]),[bank,clear,unarmed]);
 assert.deepEqual(logs,['Gather: drowned bank - 1 of 4 logs within '+DROWNED_BANK_R+' of a drowned with a trident at (740, 60, -420) set aside']);
 w.drownedDeath(bot,DEATH);logs.length=0;
 assert.deepEqual(w.offBank(job,[bank,beside,clear,unarmed]),[clear,unarmed]);
 assert.deepEqual(logs,['Gather: drowned bank - 2 of 4 logs within '+DROWNED_BANK_R+' of the mark at (704, 62, -445) set aside']);
 // the same cut is logged once per job
 w.offBank(job,[bank,beside,clear,unarmed]);assert.equal(logs.length,1);
 assert.ok(nearBank(w.drownedBankSpots(),bank.position));assert.equal(nearBank(w.drownedBankSpots(),clear.position),null);
 // no mark and no drowned: every target stays, nothing logged
 const calm=worker();
 assert.deepEqual(calm.w.offBank({},[bank,clear]),[bank,clear]);assert.deepEqual(calm.logs,[]);
});

test('round 123: bankExit heads straight away from the marks, far enough to be clear',()=>{
 const me=new Vec3(704.5,64,-436.5);
 assert.equal(bankExit(me,[]),null);
 assert.equal(bankExit(me,[{x:704.5,y:62,z:-436.5-DROWNED_BANK_CLEAR-1}]),null,'already clear');
 const south=bankExit(me,[{x:704.5,y:62,z:-444.5}]); // the mark at lower z: north of the bot
 assert.equal(south.direction,'south');assert.equal(south.d,8);assert.equal(south.distance,DROWNED_BANK_CLEAR-8+8);
 assert.equal(bankExit(me,[{x:720,y:62,z:-440}]).direction,'west');
 assert.equal(bankExit(me,[{x:690,y:62,z:-440}]).direction,'east');
 assert.equal(bankExit(me,[{x:700,y:62,z:-420}]).direction,'north');
 // the round-122 river: deaths spread along the bank at lower z - away from them all
 const river=bankExit(me,[{x:687,y:62,z:-450},{x:704,y:62,z:-444},{x:730,y:62,z:-460}]);
 assert.equal(river.direction,'south');assert.equal(river.mark.x,704);
});

function pilot(w,bot,{chain=null}={}){
 const subs=[];
 w.taskRunner={status:()=>({running:true,chain,task:null})};
 const ap=Object.create(Autopilot.prototype);
 Object.assign(ap,{worker:w,log:w.log,submit:(step,spec)=>subs.push([step,spec]),state:''});
 return {ap,subs};
}

test('round 123: the respawn beside a live mark walks out before any other job, at most '+DROWNED_BANK_LEAVES+' times a death',()=>{
 const {w,bot,logs}=worker({1:ent('drowned',716,60,-452,'trident')});
 const {ap,subs}=pilot(w,bot);
 assert.equal(ap.leaveDrownedBank(bot),false,'no mark, no walk');
 w.lastDeath={t:1,pos:DEATH};w.drownedDeath(bot,DEATH);logs.length=0;
 assert.equal(ap.leaveDrownedBank(bot),true);
 assert.deepEqual(subs,[['escape',{type:'explore',direction:'south',distance:40}]]);
 assert.match(logs[0],/^Autopilot: drowned bank at \(704, 62, -445\) 8 away, marked \d+ s ago; walking 40 south out of trident range before any other job$/);
 for(let i=1;i<DROWNED_BANK_LEAVES;i++)assert.equal(ap.leaveDrownedBank(bot),true);
 assert.equal(ap.leaveDrownedBank(bot),false);assert.equal(ap.leaveDrownedBank(bot),false);
 assert.equal(subs.length,DROWNED_BANK_LEAVES);
 assert.equal(logs.filter(l=>/did not get the bot 40 clear; back to the ladder/.test(l)).length,1);
 // the next death starts the count again
 w.lastDeath={t:2,pos:DEATH};
 assert.equal(ap.leaveDrownedBank(bot),true);
 // clear of the mark: the ladder goes on
 bot.entity.position=new Vec3(704.5,70,-436.5+DROWNED_BANK_CLEAR);
 assert.equal(ap.leaveDrownedBank(bot),false);
});

test('round 123: Mob Defense on - the flee has the bot and no walk goes out over it',()=>{
 const {w,bot}=worker({1:ent('drowned',716,60,-452,'trident')});
 w.lastDeath={t:1,pos:DEATH};w.drownedDeath(bot,DEATH);
 const {ap,subs}=pilot(w,bot,{chain:'Mob Defense'});
 assert.equal(ap.leaveDrownedBank(bot),false);assert.deepEqual(subs,[]);
});

test('round 123: the death handler makes the mark',()=>{
 const {w,bot,logs}=worker({1:ent('drowned',716,60,-452,'trident')},DEATH);
 Object.assign(bot,{inventory:{items:()=>[],slots:[]},respawn(){},once(){}});
 w.stop=()=>{};
 w.onDeath(bot);
 assert.equal(w.drownedBanksLive().length,1,logs.join('\n'));
 assert.equal(logs.filter(l=>/^Drowned bank: marked \(704, 62, -445\)/.test(l)).length,1);
});
