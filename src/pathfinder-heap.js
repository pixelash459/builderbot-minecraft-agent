// mineflayer-pathfinder 2.4.5's open set (lib/heap.js) sifts down wrong: pop() compares the two
// children only when `smallerChild < size - 1`, so a right child that is the heap's last element
// is never looked at. The larger left child can then move over a smaller right one, the heap is
// no longer a heap, and A* expands nodes out of cost order - dearer paths, and more nodes spent
// before the search times out. Fixed upstream in PrismarineJS/mineflayer-pathfinder#369, not in
// the installed release. node_modules is not ours to edit, so the class the pathfinder itself
// loads gets a correct pop() here, and only while a probe still shows the fault.
import {createRequire} from 'node:module';

// True when the heap class hands back its elements out of order.
export function heapBroken(Heap){
 const h=new Heap();
 for(const f of [1,6,5,7])h.push({f});
 h.pop();
 return h.pop().f!==5;
}
export function pop(){
 const heap=this.heap;
 const smallest=heap[1];
 const last=heap.pop();
 const size=heap.length-1;
 if(size<1)return smallest;
 heap[1]=last;
 let index=1;
 for(;;){
  let child=index*2;
  if(child>size)break;
  if(child<size&&heap[child+1].f<heap[child].f)child++;
  if(last.f<=heap[child].f)break;
  heap[index]=heap[child];heap[child]=last;
  index=child;
 }
 return smallest;
}
// Returns 'fixed', 'ok' (the installed heap is already right) or 'missing'.
export function fixHeap(Heap){
 if(!Heap?.prototype?.pop||!Heap.prototype.push)return 'missing';
 if(!heapBroken(Heap))return 'ok';
 Heap.prototype.pop=pop;
 return heapBroken(Heap)?'missing':'fixed';
}
export function installHeapFix(){
 try{return fixHeap(createRequire(import.meta.url)('mineflayer-pathfinder/lib/heap.js'));}catch{return 'missing';}
}
