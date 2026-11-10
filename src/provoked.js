// Round 61 (round-60 soak: `BuilderBot was slain by Polar Bear` at (72, 76, 202), nothing from
// Mob Defense first - minecraft-data files the polar bear under passive mobs, and only
// type 'hostile' was ever a threat). A mob of any kind that hurts the bot is a threat for
// PROVOKED_MS, and an adult polar bear with a cub in reach is one on sight.
export const PROVOKED_MS=60000,CUB_REACH=16,MOTHER_NEAR=12;
// Round 107 (round-106 hard3: a spider at sky 14 by day bit the bot to death; leaveAlone dropped it
// from the threats whenever it hopped back past 2 blocks, so the fight against it kept ending): a
// spider is neutral in daylight only until it attacks - one that hurts the bot is a threat too.
export const DAY_NEUTRAL=new Set(['spider']);
const provokedOf=bot=>bot&&(bot._provoked||(bot._provoked=new Map()));
export function markProvoked(bot,e,now=Date.now()){
 if(!bot||!e||e===bot.entity||e.type==='player'||(e.type==='hostile'&&!DAY_NEUTRAL.has(e.name))||e.id==null)return false;
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
// Round 113: the moment an enderman turns angry (metadata 17, screaming), say why it might have:
// how far it is, how many degrees the bot's look was off its eyes (the game provokes on a look
// within acos(1 - 0.025/d) with a clear line, up to 64 blocks), and when the bot last swung at it.
export const ENDER_EYE=2.55,ENDER_STARE_RANGE=64;
export function lookOffEyes(bot,e){
 const me=bot.entity,p=me.position,y=me.yaw||0,pt=me.pitch||0;
 const vx=-Math.sin(y)*Math.cos(pt),vy=Math.sin(pt),vz=-Math.cos(y)*Math.cos(pt);
 const dx=e.position.x-p.x,dy=e.position.y+ENDER_EYE-(p.y+1.62),dz=e.position.z-p.z,d=Math.hypot(dx,dy,dz)||1;
 const dot=(vx*dx+vy*dy+vz*dz)/d;
 return {d,deg:Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI,stare:dot>1-0.025/d};
}
export function installEndermanWatch(bot,log=()=>{}){
 if(!bot||bot._enderWatch)return;
 bot._enderWatch=true;
 const angry=new Set(),hits=new Map();
 const raw=bot.attack;
 if(typeof raw==='function')bot.attack=function(target,...a){try{if(target&&target.name==='enderman')hits.set(target.id,Date.now());}catch{}return raw.call(this,target,...a);};
 bot.on('entityUpdate',e=>{
  try{
   if(!e||e.name!=='enderman'||!e.position||!bot.entity?.position)return;
   const m=e.metadata||[],now=m[17]===true||m[17]===1;
   if(!now){angry.delete(e.id);return;}
   if(angry.has(e.id))return;
   angry.add(e.id);
   const o=lookOffEyes(bot,e),h=hits.get(e.id);
   log('Enderman: the one at '+e.position.floored()+' ('+o.d.toFixed(1)+' away) turned angry; '+"the bot's look was "+o.deg.toFixed(1)+' deg off its eyes'+(o.stare?' (a stare)':'')+'; last swung at it '+(h?((Date.now()-h)/1000).toFixed(1)+' s ago':'never'));
  }catch{}
 });
 bot.on('entityGone',e=>{try{e&&(angry.delete(e.id),hits.delete(e.id));}catch{}});
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
