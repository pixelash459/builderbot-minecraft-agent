import {z} from 'zod';
export const position=z.object({x:z.number().int().min(-30000000).max(30000000),y:z.number().int().min(-64).max(320),z:z.number().int().min(-30000000).max(30000000)}).strict();
const item=z.string().regex(/^[a-z0-9_]{1,64}$/);
export const jobSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('gather'),block:item,count:z.number().int().min(1).max(128),radius:z.number().int().min(1).max(128).optional(),searchIfMissing:z.boolean().optional(),targetY:z.number().int().min(-63).max(320).optional(),bandTop:z.number().int().min(-63).max(320).optional(),smeltAt:z.number().int().min(1).max(64).optional(),strip:z.boolean().optional(),belowFoots:z.boolean().optional(),openSky:z.boolean().optional(),surface:z.boolean().optional()}).strict(),
 z.object({type:z.literal('goto'),position}).strict(),
 // keepTable: leave a placed table standing for the next craft (wood-step ladder);
 // collectTable: pick the used table back up at the end of a step even when only reused.
 z.object({type:z.literal('craft'),item,count:z.number().int().min(1).max(128),keepTable:z.boolean().optional(),collectTable:z.boolean().optional()}).strict(),
 // keep (round 10, habit 6): with item, deposit all but this many.
 z.object({type:z.literal('deposit'),position,item:item.optional(),keep:z.number().int().min(0).max(2304).optional()}).strict(),
 // drop (round 10, habit 6): toss count (default all) of item - the autopilot drops only junk.
 z.object({type:z.literal('drop'),item,count:z.number().int().min(1).max(2304).optional()}).strict(),
 z.object({type:z.literal('build'),blueprint:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),origin:position}).strict(),
 // surface/surfaceY: the ladder's unblock explore after a surface gather stays on the stand
 // (worker.explore honours them; they were rejected by this schema until 2026-10-14, so the
 // "exploring before retry" leg never ran and a blocked step retried in place forever).
 z.object({type:z.literal('explore'),direction:z.enum(['north','south','east','west','random']).optional(),distance:z.number().int().min(16).max(256),surface:z.boolean().optional(),surfaceY:z.number().int().min(-64).max(320).optional(),surfaceCeiling:z.number().int().min(-64).max(320).optional(),surfaceFloor:z.number().int().min(-64).max(320).optional(),forFood:z.boolean().optional()}).strict(),
 z.object({type:z.literal('place'),block:item,position}).strict(),
 z.object({type:z.literal('eat')}).strict(),
 z.object({type:z.literal('equip')}).strict(),
 z.object({type:z.literal('collect'),radius:z.number().int().min(1).max(64).optional()}).strict(),
 // leave: load the furnace and finish (worker.furnaceRun records it); take: collect that run
 // (waiting out what is left), keepFurnace: leave a placed furnace standing for more cooking.
 z.object({type:z.literal('smelt'),item,count:z.number().int().min(1).max(48),fuel:item.optional(),leave:z.boolean().optional(),take:z.boolean().optional(),keepFurnace:z.boolean().optional()}).strict(),
 z.object({type:z.literal('sleep'),position:position.optional()}).strict(),
 z.object({type:z.literal('fight'),entity:item.optional(),maxSeconds:z.number().int().min(1).max(120).optional(),style:z.enum(['auto','melee','bow','plain']).optional(),
 primitives:z.object({backpedal:z.boolean().optional(),shield:z.boolean().optional(),sprintKnockback:z.boolean().optional(),kite:z.boolean().optional(),crit:z.boolean().optional()}).strict().optional()}).strict(),
 z.object({type:z.literal('shelter')}).strict(),
 z.object({type:z.literal('obtain'),item,count:z.number().int().min(1).max(1024),deposit:position.optional()}).strict(),
 z.object({type:z.literal('use'),item,position:position.optional(),entity:item.optional(),maxSeconds:z.number().int().min(1).max(120).optional()}).strict(),
 z.object({type:z.literal('shear'),maxSeconds:z.number().int().min(1).max(120).optional()}).strict(),
 z.object({type:z.literal('breed'),entity:item,maxSeconds:z.number().int().min(1).max(180).optional()}).strict(),
 z.object({type:z.literal('hunt'),entity:item,count:z.number().int().min(1).max(16),maxSeconds:z.number().int().min(1).max(180).optional()}).strict()
]);
export const blueprintSchema=z.object({name:z.string(),description:z.string().optional(),blocks:z.array(position.extend({name:item}).strict()).min(1).max(2048)}).strict();
export function validateBlueprint(input){
 const parsed=blueprintSchema.parse(input);const seen=new Set();
 for(const b of parsed.blocks){const key=`${b.x},${b.y},${b.z}`;if(seen.has(key))throw Error('Duplicate blueprint coordinate');seen.add(key);}
 return parsed;
}
