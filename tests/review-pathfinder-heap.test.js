import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {heapBroken,fixHeap,pop,installHeapFix} from '../src/pathfinder-heap.js';

// mineflayer-pathfinder 2.4.5 lib/heap.js: pop() skips the right child when it is the last
// element, so the open set hands A* its nodes out of cost order (upstream #369).
const require=createRequire(import.meta.url);
// A fresh copy of the installed class, so the tests do not depend on what another test patched.
function installed(){
 const p=require.resolve('mineflayer-pathfinder/lib/heap.js');
 delete require.cache[p];
 const Heap=require(p);
 delete require.cache[p];
 return Heap;
}
const drain=h=>{const out=[];while(!h.isEmpty())out.push(h.pop().f);return out;};
function sortsRandom(Heap,rounds=200){
 let seed=12345;const rnd=()=>(seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff;
 for(let r=0;r<rounds;r++){
  const h=new Heap(),fs=[];
  const n=1+Math.floor(rnd()*40);
  for(let i=0;i<n;i++){const f=Math.floor(rnd()*50);fs.push(f);h.push({f});}
  // pops between pushes, and a cost lowered in place, as A* does
  const early=[];
  for(let i=0;i<Math.floor(n/3);i++)early.push(h.pop().f);
  const node={f:60};h.push(node);node.f=-1;h.update(node);
  const rest=drain(h);
  const want=[...fs].sort((a,b)=>a-b);
  if(JSON.stringify(early)!==JSON.stringify(want.slice(0,early.length)))return false;
  if(JSON.stringify(rest)!==JSON.stringify([-1,...want.slice(early.length)]))return false;
 }
 return true;
}
test('the installed open set pops out of order; the fix puts it right, and only once',()=>{
 const Heap=installed();
 const h=new Heap();for(const f of [1,6,5,7])h.push({f});
 if(heapBroken(Heap)){
  assert.deepEqual(drain(h),[1,6,5,7],'the fault: 6 before 5');
  assert.equal(sortsRandom(Heap),false);
  assert.equal(fixHeap(Heap),'fixed');
  assert.equal(Heap.prototype.pop,pop);
 }
 assert.equal(heapBroken(Heap),false);
 assert.equal(fixHeap(Heap),'ok','a heap that is right is left alone');
 const g=new Heap();for(const f of [1,6,5,7])g.push({f});
 assert.deepEqual(drain(g),[1,5,6,7]);
 assert.equal(sortsRandom(Heap),true);
});
test('the fixed pop: empty, one and two elements, ties',()=>{
 const Heap=installed();fixHeap(Heap);
 const h=new Heap();
 h.push({f:3});assert.equal(h.pop().f,3);assert.equal(h.isEmpty(),true);assert.equal(h.size(),0);
 h.push({f:2});h.push({f:1});assert.deepEqual(drain(h),[1,2]);
 for(const f of [4,4,1,4,1])h.push({f});assert.deepEqual(drain(h),[1,1,4,4,4]);
});
test('installHeapFix patches the class the pathfinder itself loads; anything else is "missing"',()=>{
 assert.match(installHeapFix(),/^(fixed|ok)$/);
 assert.equal(heapBroken(require('mineflayer-pathfinder/lib/heap.js')),false);
 assert.equal(installHeapFix(),'ok');
 assert.equal(fixHeap(null),'missing');assert.equal(fixHeap(class{}),'missing');
});
