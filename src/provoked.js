// Round 61 (round-60 soak: `BuilderBot was slain by Polar Bear` at (72, 76, 202), nothing from
// Mob Defense first - minecraft-data files the polar bear under passive mobs, and only
// type 'hostile' was ever a threat). A mob of any kind that hurts the bot is a threat for
// PROVOKED_MS, and an adult polar bear with a cub in reach is one on sight.
export const PROVOKED_MS=60000,CUB_REACH=16,MOTHER_NEAR=12;
const provokedOf=bot=>bot&&(bot._provoked||(bot._provoked=new Map()));
export function markProvoked(bot,e,now=Date.now()){
 if(!bot||!e||e===bot.entity||e.type==='player'||e.type==='hostile'||e.id==null)return false;
 const m=provokedOf(bot),fresh=!(m.get(e.id)>now);
 m.set(e.id,now+PROVOKED_MS);
 return fresh;
}
const isBaby=e=>{const m=e&&e.metadata;return !!m&&(m[16]===true||m[15]===true);};
export function provoked(bot,e,now=Date.now()){
 if(!bot||!e||e===bot.entity||e.type==='player'||e.isValid===false)return false;
 const until=bot._provoked&&bot._provoked.get(e.id);
 if(until>now)return true;
 if(e.name==='polar_bear'&&!isBaby(e)&&e.position&&bot.entity?.position&&e.position.distanceTo(bot.entity.position)<=MOTHER_NEAR){
  for(const c of Object.values(bot.entities||{}))if(c&&c!==e&&c.name==='polar_bear'&&isBaby(c)&&c.position&&c.position.distanceTo(e.position)<=CUB_REACH)return true;
 }
 return false;
}
export function installProvoked(bot,log=()=>{}){
 if(!bot||bot._provokedHook)return;
 bot._provokedHook=true;
 bot.on('entityHurt',(entity,source)=>{
  try{
   if(entity!==bot.entity||!source)return;
   if(markProvoked(bot,source))log('Threat: '+(source.name||'unknown')+' at '+source.position?.floored?.()+' hit the bot; treating it as hostile for '+PROVOKED_MS/1000+' s');
  }catch{}
 });
 bot.on('entityGone',e=>{try{bot._provoked&&e&&bot._provoked.delete(e.id);}catch{}});
}
