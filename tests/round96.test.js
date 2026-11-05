// Round 96 (round-95 hard1: a night box at (785, 86, -517) two under the grass of a cherry grove,
// `morning in a cave (3 hostiles within 24, sky 0)` under the canopy, `no path up from y=86;
// pillaring` and `Ascend: y=86 -> 94 (surface 94)` into the leaves - then 15 minutes of `no path`
// for every wood gather and explore from (786, 94, -517)): a sky climb is out once a cell beside the
// bot opens onto ground with nothing but the canopy over it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,walkOut,OUT_SCAN} from '../src/worker.js';

// The grove around (786, -517), from the soak world: grass to y=87 (stand at 88), cherry leaves
// y=94-97 over x 785-789, a trunk at (787, 94-95, -519). `column` is the bot's own pillar; `walls`
// boxes cells; `roof` puts stone over everything (a real cave).
function grove({column=new Set(),walls=new Set(),roof=null,leafFloor=false}={}){
 return (x,y,z)=>{
  const k=x+','+y+','+z;
  if(column.has(k)||walls.has(k))return {name:'cobblestone',boundingBox:'block'};
  if(roof!=null&&y===roof)return {name:'stone',boundingBox:'block'};
  if(y<=87)return {name:y===87?(leafFloor?'cherry_leaves':'grass_block'):'dirt',boundingBox:'block'};
  if(x===787&&z===-519&&(y===94||y===95))return {name:'cherry_log',boundingBox:'block'};
  if(y>=94&&y<=97&&x>=783&&x<=790&&z>=-521&&z<=-516)return {name:'cherry_leaves',boundingBox:'block'};
  return {name:'air',boundingBox:'empty',skyLight:y>=98||x<783||x>790||z<-521||z>-516?15:10};
 };
}
const fake=f=>({blockAt:p=>{const b=f(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z));return b&&{...b,position:new Vec3(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z))};}});

test('round 96: ground beside the bot under the canopy is out; a box wall, a cave roof or leaves underfoot are not',()=>{
 assert.equal(OUT_SCAN,24);
 const b=fake(grove());
 assert.deepEqual(walkOut(b,new Vec3(786,88,-517)),{x:787,y:88,z:-517},'on the grass under the cherry');
 // boxed: all four sides walled
 const walls=new Set([[787,88,-517],[785,88,-517],[786,88,-516],[786,88,-518]].flatMap(([x,y,z])=>[x+','+y+','+z,x+','+(y+1)+','+z]));
 assert.equal(walkOut(fake(grove({walls})),new Vec3(786,88,-517)),null);
 // a real cave: stone 10 over the floor
 assert.equal(walkOut(fake(grove({roof:98})),new Vec3(786,88,-517)),null);
 // in the canopy, on leaves: not ground
 assert.equal(walkOut(fake(grove({leafFloor:true})),new Vec3(786,88,-517)),null);
 // round-95 hard1's cell at y=94: leaves on every side at the feet - not out
 assert.equal(walkOut(b,new Vec3(786,94,-517)),null);
});

// The round-95 climb: from (786, 86, -517), two under the grass, the pillar rises a cell a step.
function climb(){
 const logs=[],pillars=[],column=new Set();
 const f=grove({column}),b=fake(f);
 const bot={health:17,entity:{position:new Vec3(786.5,86,-516.5)},blockAt:b.blockAt};
 const w=Object.assign(Object.create(Worker.prototype),{bot,log:m=>logs.push(m),check(){},strandedTunnel:null,
  navigate:async()=>{throw Error('No path to the goal! (empty path at (786, 86, -517), last path: noPath, 0 steps, 1 nodes)');},
  pillarUp:async(target,token,opts)=>{pillars.push({target,until:!!opts.until});
   for(let y=Math.floor(bot.entity.position.y);y<target;y++){column.add('786,'+y+',-517');bot.entity.position=new Vec3(786.5,y+1,-516.5);if(opts.until&&opts.until())break;}
   return true;}});
 // the box two down: walls round the feet and head at y 86-87
 for(const [x,z] of [[787,-517],[785,-517],[786,-516],[786,-518]])for(const y of [86,87])column.add(x+','+y+','+z);
 return {w,bot,logs,pillars};
}
test('round 96: the cave-morning climb under a cherry stops at the grass, not in the leaves',async()=>{
 const {w,bot,logs,pillars}=climb();
 await w.ascend({spec:{type:'ascend',y:94,sky:true}},0);
 assert.equal(Math.floor(bot.entity.position.y),88,'on the grass, not 94');
 assert.ok(pillars.every(p=>p.until),'the no-path pillar stops on out()');
 assert.ok(!logs.some(l=>/pillaring to the sky/.test(l)),'no sky pillar into the canopy');
 assert.ok(logs.includes('Ascend: out under cover at y=88 (ground beside at 787, -517 with only the canopy over it); not pillaring into it'),logs.join('\n'));
 assert.equal(logs.at(-1),'Ascend: y=86 -> 88 (surface 94)');
});
test('round 96: under a cave roof the climb goes on as before',async()=>{
 const {w,bot,logs}=climb();
 // stone over the grove at 92: the canopy is a cave roof now; open sky only past it
 const inner=bot.blockAt;bot.blockAt=p=>{const y=Math.floor(p.y);if(y===92&&!(Math.floor(p.x)===786&&Math.floor(p.z)===-517&&bot.entity.position.y>92))return {name:'stone',boundingBox:'block',position:p};const r=inner(p);return y>92&&r&&r.boundingBox==='empty'?{...r,skyLight:15}:r;};
 await w.ascend({spec:{type:'ascend',y:94,sky:true}},0);
 assert.equal(Math.floor(bot.entity.position.y),92,'the head through the roof');
 assert.ok(logs.includes('Ascend: head sky 15 at y=92; health 17 -> 17 on the climb'),logs.join(String.fromCharCode(10)));
 assert.ok(!logs.some(l=>/out under cover/.test(l)));
});
