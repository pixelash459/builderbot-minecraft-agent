import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {Vec3} from 'vec3';
import pf from 'mineflayer-pathfinder';
import {waterAware} from '../src/worker.js';
const require=createRequire(import.meta.url);
const {Movements}=pf;

// A serverless world, as in the upstream fix's own tests (1.21.4, the bot's client version).
function fixture(){
 const registry=require('minecraft-data')('1.21.4'),Block=require('prismarine-block')('1.21.4');
 const blocks=new Map(),bot=new EventEmitter();
 Object.assign(bot,{registry,game:{minY:-64},entity:{position:new Vec3(0.5,64,0.5),effects:{},onGround:false},entities:{},inventory:{items:()=>[]},clearControlStates(){}});
 bot.blockAt=p=>{const f=p.floored(),b=Block.fromStateId(blocks.get(f.toString())??registry.blocksByName.air.defaultState,0);b.position=f;return b;};
 const put=(name,p,props={})=>{const d=registry.blocksByName[name];
  for(let s=d.minStateId;s<=d.maxStateId;s++){const b=Block.fromStateId(s,0);if(Object.entries(props).every(([k,v])=>b.getProperties()[k]===v)){blocks.set(p.toString(),s);return;}}
  throw Error('no state for '+name);};
 return {bot,put,movements:new Movements(bot)};
}
test('round 82: water plants, bubble columns and waterlogged blocks are liquid to the planner (pathfinder#384)',()=>{
 const p=new Vec3(0,64,0);
 for(const name of ['seagrass','tall_seagrass','kelp','kelp_plant','bubble_column']){
  const {put,movements}=fixture();put('water',p);put(name,p.offset(1,0,0));
  assert.equal(movements.getBlock(p,1,0,0).liquid,false,'the library alone reads '+name+' as dry');
  waterAware(movements);movements.canDig=false;
  assert.equal(movements.getBlock(p,1,0,0).liquid,true,name);
  const n=[];movements.getMoveForward({...p,remainingBlocks:0},{x:1,z:0},n);
  assert.equal(n.length,1);assert.deepEqual(n[0].toPlace,[],'no scaffold through '+name);
 }
 const {put,movements}=fixture();
 waterAware(movements);
 put('horn_coral_wall_fan',p,{waterlogged:true});assert.equal(movements.getBlock(p,0,0,0).liquid,true);
 put('horn_coral_wall_fan',p,{waterlogged:false});assert.equal(movements.getBlock(p,0,0,0).liquid,false);
 // a block beside a waterlogged slab is not broken (it would let the water flow)
 put('stone',p);put('oak_slab',p.offset(1,0,0),{waterlogged:true,type:'bottom'});
 assert.equal(movements.safeToBreak(movements.getBlock(p,0,0,0)),false);
 // no dive from a waterlogged fan into the water below
 const f=fixture();waterAware(f.movements);f.put('horn_coral_wall_fan',p,{waterlogged:true});f.put('water',p.offset(0,-1,0));f.put('water',p.offset(0,-2,0));
 const down=[];f.movements.getMoveDown({...p,remainingBlocks:0},down);assert.deepEqual(down,[]);
});
