import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {airFall} from '../src/chains/worldSurvivalChain.js';
import {installOwnAir,goalText} from '../src/worker.js';

// Round 70: the round-69 soak on the Nitrous world copy.
test('round 70: a step between the two air scales is not a fall; two levels in 3 s is',()=>{
 const st={};
 assert.equal(airFall(st,20,0),false);
 assert.equal(airFall(st,299/15,100),false,'20 -> 19.93 (ticks/15)');
 assert.equal(airFall(st,19,200),false,'-> 19');
 const b={};
 assert.equal(airFall(b,14.4,0),false);assert.equal(airFall(b,14,50),false,'14.4 -> 14');
 const u={};
 let falling=false;
 for(let t=0,a=20;t<=3000;t+=750,a--)falling=airFall(u,a,t);
 assert.equal(falling,true,'a level every 0.75 s under water');
 const late={};airFall(late,20,0);
 assert.equal(airFall(late,17,4000),false,'readings older than 3 s are forgotten');
});
test('round 70: the bot reads only its own air; the air_supply of another entity is ignored',()=>{
 const bot=new EventEmitter();bot._client=new EventEmitter();bot.entity={id:6};
 bot.registry={entitiesByName:{player:{metadataKeys:['shared_flags','air_supply','custom_name']}}};
 installOwnAir(bot);
 assert.equal(bot.oxygenLevel,20);
 bot._client.emit('entity_metadata',{entityId:41,metadata:[{key:1,type:'int',value:-15}]});
 assert.equal(bot.oxygenLevel,20,'a drowning fish');
 bot.oxygenLevel=-1;assert.equal(bot.oxygenLevel,20,'mineflayer writes for any entity are ignored');
 bot._client.emit('entity_metadata',{entityId:6,metadata:[{key:1,type:'int',value:120}]});
 assert.equal(bot.oxygenLevel,8,'its own air: 120 ticks = 8');
 bot._client.emit('entity_metadata',{entityId:6,metadata:[{key:0,type:'byte',value:0}]});
 assert.equal(bot.oxygenLevel,8,'other keys leave it');
 bot.emit('spawn');assert.equal(bot.oxygenLevel,20,'full at a respawn');
});
test('round 70: a no-path job line names the goal it was walking to',()=>{
 class GoalNear{constructor(x,y,z,r){this.x=x;this.y=y;this.z=z;this.rangeSq=r*r;}}
 class GoalInvert{constructor(g){this.goal=g;}}
 assert.equal(goalText(new GoalNear(720.5,74,-423,2)),'GoalNear 720,74,-423 within 2');
 assert.equal(goalText(new GoalInvert({})),'GoalInvert');
 assert.equal(goalText(null),'none');
});
