"""Obstruction probe (user request 2026-10-28): does the bot adapt when the way is blocked?

Runs on the private FLAT test world (agent-test-world, peaceful) after a soak has restored it.
Console fixtures build an obstruction around BuilderBot, the bot gets one job, and the probe
records what happened: the job's end state and time, and the bot's own log lines about it.
Every fixture targets BuilderBot or fixed coordinates in the test world - never a player.
Each scenario has its own patch of ground (x = 2000 + 100*i), cleared again afterwards.

Usage: python tests/obstruct.py            (all scenarios)
       python tests/obstruct.py door shelter_hole   (named ones)
Writes data/obstruction-results.json and prints one line per scenario.
"""
import pathlib,json,time,re,sys,uuid
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from soak import api,command,ROOT,wait  # noqa: E402

FLOOR=-60            # the flat world's stand: grass at -61, dirt -62/-63, bedrock -64
LOG=ROOT/'logs/dashboard.log'
SERVER_LOG=ROOT/'logs/test-server.log'
NOTE=re.compile(r'Navigation|Boxed in|stranded|Pillar|Shelter|Place:|Tunnel|Ascend|Drop:|Job: |Burrow|Gather|Chains|Reflex|Bag run')

def log_mark():return LOG.stat().st_size
def log_since(mark):
    with open(LOG,'rb') as f:f.seek(mark);text=f.read().decode('utf-8','replace')
    return [l for l in text.splitlines() if re.match(r'\d{4}-\d\d-\d\dT',l)]
def server_says(condition,seconds=5):
    """True when `execute <condition>` passes on the server (checked through a say marker)."""
    marker='OBSTRUCT_'+uuid.uuid4().hex[:12]
    start=SERVER_LOG.stat().st_size
    command('execute '+condition+' run say '+marker)
    deadline=time.time()+seconds
    while time.time()<deadline:
        with open(SERVER_LOG,'rb') as f:f.seek(start);text=f.read().decode('utf-8','replace')
        if marker in text:return True
        time.sleep(.5)
    return False
def fill(a,b,block):command('fill %d %d %d %d %d %d minecraft:%s'%(a[0],a[1],a[2],b[0],b[1],b[2],block))
def setblock(p,block):command('setblock %d %d %d minecraft:%s'%(p[0],p[1],p[2],block))
def cancel_all():
    for j in api('state').get('jobs',[]):
        if j['status'] in ('queued','running','paused'):
            try:api('cancel',{'id':j['id']})
            except Exception:pass
def job_state(jid):return next((j for j in api('state')['jobs'] if j['id']==jid),None)
def run_job(spec,seconds):
    created=api('jobs',spec);t0=time.time();last=None
    while time.time()-t0<seconds:
        time.sleep(2)
        j=job_state(created['id'])
        if not j:continue
        last=j
        if j['status'] in ('complete','failed'):break
    if last and last['status'] not in ('complete','failed'):
        try:api('cancel',{'id':created['id']})
        except Exception:pass
    return {'status':(last or {}).get('status','unknown') if last and last['status'] in ('complete','failed') else 'timed out',
            'message':str((last or {}).get('message',''))[:160],'seconds':round(time.time()-t0,1)}
def pos():
    o=api('observe');p=o['position'];return [p['x'],p['y'],p['z']]
def clear_patch(o):
    x,y,z=o
    fill((x-6,FLOOR,z-34),(x+14,FLOOR+6,z+34),'air')
    fill((x-6,FLOOR-3,z-34),(x+14,FLOOR-2,z+34),'dirt')
    fill((x-6,FLOOR-1,z-34),(x+14,FLOOR-1,z+34),'grass_block')
def start(o,kit=()):
    cancel_all()
    command('tp BuilderBot %d %d %d'%(o[0],FLOOR+1,o[2]));time.sleep(3)  # load the chunks first
    clear_patch(o)
    command('tp BuilderBot %d %d %d'%(o[0],FLOOR,o[2]));time.sleep(2)
    command('clear BuilderBot')
    for item,count in kit:command('give BuilderBot minecraft:%s %d'%(item,count))
    command('effect give BuilderBot minecraft:saturation 30 5 true')
    time.sleep(2)
def box(o,block,roof=True):
    """A 1x2 cell around the bot's column: walls on all four sides, a roof over the head."""
    x,y,z=o
    fill((x-1,y,z-1),(x+1,y+(2 if roof else 1),z+1),block)
    setblock((x,y,z),'air');setblock((x,y+1,z),'air')

# ---- scenarios: each returns (spec, seconds, check) after building its obstruction ----
def s_cobble_wall(o):
    x,y,z=o;fill((x+3,y,z-6),(x+3,y+2,z+6),'cobblestone')
    return {'type':'goto','position':{'x':x+8,'y':y,'z':z}},90,None
def s_plank_wall_long(o):
    x,y,z=o;fill((x+3,y,z-30),(x+3,y+2,z+30),'oak_planks')
    return {'type':'goto','position':{'x':x+8,'y':y,'z':z}},150,None
def s_door_wall(o):
    x,y,z=o;fill((x+3,y,z-30),(x+3,y+2,z+30),'oak_planks')
    setblock((x+3,y,z),'oak_door[half=lower,facing=west]');setblock((x+3,y+1,z),'oak_door[half=upper,facing=west]')
    return {'type':'goto','position':{'x':x+8,'y':y,'z':z}},150,None
def s_cobble_box_pick(o):
    box(o,'cobblestone')
    return {'type':'goto','position':{'x':o[0]+10,'y':o[1],'z':o[2]}},120,None
def s_cobble_box_bare(o):
    box(o,'cobblestone')
    return {'type':'goto','position':{'x':o[0]+10,'y':o[1],'z':o[2]}},120,None
def s_plank_box(o):
    box(o,'oak_planks')
    return {'type':'goto','position':{'x':o[0]+10,'y':o[1],'z':o[2]}},120,None
def s_glass_box(o):
    box(o,'glass')
    return {'type':'goto','position':{'x':o[0]+10,'y':o[1],'z':o[2]}},120,None
def s_pit(o):
    x,y,z=o;fill((x,y-3,z),(x,y-1,z),'air')
    command('tp BuilderBot %d %d %d'%(x,y-3,z));time.sleep(2)
    return {'type':'goto','position':{'x':x+8,'y':y,'z':z}},120,None
def s_chest_spot_blocked(o):
    x,y,z=o;setblock((x+2,y,z),'cobblestone')
    return {'type':'place','block':'chest','position':{'x':x+2,'y':y,'z':z}},60,None
def s_chest_spot_flower(o):
    x,y,z=o;setblock((x+2,y,z),'poppy')
    return {'type':'place','block':'chest','position':{'x':x+2,'y':y,'z':z}},60,\
        lambda:server_says('if block %d %d %d minecraft:chest'%(x+2,y,z))
def s_shelter_hole(o):
    return None,0,None  # handled in its own function below
# Round 103 (the round-101 bag-run turn never fired in rounds 101-102: 0 `turning` lines): a
# bedrock ring the bot can neither dig nor climb out of, the death 30 east outside it. Every
# bearing has no path, so the run should log `Bag run: no path on the line ...; turning` and then
# the turns, before it fails on the last bearing.
def s_bag_run_no_path(o):
    x,y,z=o;mark=log_mark()
    fill((x-5,y,z-9),(x+13,y+2,z+9),'bedrock');fill((x-4,y,z-8),(x+12,y+2,z+8),'air')
    return {'type':'bagrun','position':{'x':x+30,'y':y,'z':z}},150,\
        lambda:any('Bag run: no path' in l and 'turning' in l for l in log_since(mark))
def s_box_pinned(o):
    return None,0,None  # handled in its own function below

SCENARIOS=[
    ('cobble_wall','a 13-wide, 3-high cobblestone wall across the way; goto 8 east',s_cobble_wall,[]),
    ('plank_wall_long','a 61-wide oak-plank wall; goto 8 east (the way round is ~60 blocks)',s_plank_wall_long,[]),
    ('door_wall','the same plank wall with an oak door in front of the bot; goto 8 east',s_door_wall,[]),
    ('cobble_box_pick','sealed in a cobblestone 1x2 cell, stone pickaxe held; goto 10 east',s_cobble_box_pick,[('stone_pickaxe',1)]),
    ('cobble_box_bare','sealed in a cobblestone 1x2 cell, nothing held; goto 10 east',s_cobble_box_bare,[]),
    ('plank_box','sealed in an oak-plank 1x2 cell, stone axe and pickaxe held; goto 10 east',s_plank_box,[('stone_axe',1),('stone_pickaxe',1)]),
    ('glass_box','sealed in a glass 1x2 cell, stone pickaxe held; goto 10 east',s_glass_box,[('stone_pickaxe',1)]),
    ('pit','at the bottom of a 1x1 pit 3 deep, 16 dirt held; goto 8 east',s_pit,[('dirt',16)]),
    ('chest_spot_blocked','place a chest where a cobblestone block sits',s_chest_spot_blocked,[('chest',1)]),
    ('chest_spot_flower','place a chest where a poppy grows',s_chest_spot_flower,[('chest',1)]),
    ('shelter_hole','a night shelter, then one wall block removed while it is sealed; re-sealed?',s_shelter_hole,[('dirt',64),('stone_pickaxe',1)]),
    ('bag_run_no_path','inside a bedrock ring, the death 30 east; the bag run should turn off the line',s_bag_run_no_path,[]),
    ('box_pinned','a night shelter, a zombie sealed under rock 6 east once the box is up, then morning; pinned and out through the roof?',s_box_pinned,[('dirt',64),('stone_pickaxe',1)]),
]

# Round 103 (round-102 hard1: `held past dawn by stray 15.7 dy 9 sky 0` and the run ended 0.02 s
# before the 30 s gate; the pin has never fired live): the box, a hostile sealed in a roofed cell
# (its head reads sky 0, so it counts as under rock) 6 east of it, then morning. Expected:
# `Shelter: held past dawn by zombie ...`, 30 s later `Shelter: pinned 30 s past dawn by zombie
# ...; climbing out through the roof`, an `Ascend: y=` line, the bot 3+ higher. The flat world is
# peaceful, so the difficulty goes to easy for the scenario and back; natural monster spawning
# stays off; the zombie is removed with a type-filtered selector.
def box_pinned(o,result,mark):
    command('gamerule advance_time false');command('time set 14000')
    command('gamerule spawn_monsters false');command('difficulty easy');time.sleep(2)
    created=api('jobs',{'type':'shelter'});t0=time.time();cell=None
    try:
        sealed=None
        while time.time()-t0<90:
            time.sleep(2);o2=api('observe');sh=o2.get('shelter')
            if sh and sh.get('safe') and (sh.get('seconds') or 0)>=3:sealed=o2['position'];break
        result['sealed_after']=round(time.time()-t0,1) if sealed else None
        if not sealed:
            j=job_state(created['id']) or {};result.update(status='not sealed',message=str(j.get('message',''))[:160]);return
        # The cell is dug INTO the ground (feet on the bedrock at y-4, head at y-2, the grass at y-1
        # its roof): the first live try roofed a cell on the surface with cobblestone and the
        # zombie's head still read `sky 15` - the client keeps the chunk-load light, so a roof
        # placed later does not darken a cell for the bot, but a cell carved out of solid ground
        # starts at sky 0.
        x,y,z=sealed['x'],sealed['y'],sealed['z'];cell=(x+6,y-3,z);result['cell']=list(cell)
        setblock(cell,'air');setblock((cell[0],y-2,cell[2]),'air')
        command('summon minecraft:zombie %d %d %d {PersistenceRequired:1b,NoAI:1b}'%cell);time.sleep(3)
        result['zombie']=server_says('positioned %d %d %d if entity @e[type=minecraft:zombie,distance=..3]'%cell)
        command('time set 1000');t1=time.time()
        while time.time()-t1<150:
            time.sleep(2);j=job_state(created['id'])
            if j and j['status'] in ('complete','failed'):break
            lines=log_since(mark)
            if any('could not climb out; holding the box' in l for l in lines):break
            if any('Shelter: pinned' in l for l in lines) and api('observe')['position']['y']>=y+3:break
        lines=log_since(mark)
        result['held']=any('held past dawn by' in l for l in lines)
        result['pinned']=any('Shelter: pinned' in l for l in lines)
        result['climbed']=any('Ascend: y=' in l for l in lines)
        j=job_state(created['id']) or {}
        result.update(status=j.get('status','unknown'),message=str(j.get('message',''))[:160],seconds=round(time.time()-t1,1))
    finally:
        try:api('cancel',{'id':created['id']})
        except Exception:pass
        if cell:command('execute positioned %d %d %d run kill @e[type=minecraft:zombie,distance=..24]'%cell)
        command('difficulty peaceful');command('gamerule spawn_monsters true')
        command('gamerule advance_time true');command('time set 1000')

def shelter_hole(o,result):
    """Night shelter on flat ground, a hole knocked in it once it is safe, then morning."""
    command('gamerule advance_time false');command('time set 14000');time.sleep(2)
    created=api('jobs',{'type':'shelter'});t0=time.time()
    try:
        sealed=None
        while time.time()-t0<90:
            time.sleep(2);o2=api('observe');sh=o2.get('shelter')
            if sh and sh.get('safe') and (sh.get('seconds') or 0)>=3:sealed=o2['position'];break
        result['sealed_after']=round(time.time()-t0,1) if sealed else None
        if not sealed:
            j=job_state(created['id']) or {};result.update(status='not sealed',message=str(j.get('message',''))[:160]);return
        x,y,z=sealed['x'],sealed['y'],sealed['z']
        # The wall cell east of the feet: part of every shell (box or pod).
        hole=(x+1,y,z)
        if server_says('if block %d %d %d minecraft:air'%hole,3):
            hole=(x-1,y,z)
        setblock(hole,'air');t1=time.time();result['hole']=list(hole)
        resealed=None
        while time.time()-t1<45:
            time.sleep(1)
            if not server_says('if block %d %d %d minecraft:air'%hole,3):resealed=round(time.time()-t1,1);break
        result['resealed_after']=resealed
        command('time set 1000');t2=time.time()
        while time.time()-t2<60:
            time.sleep(2);j=job_state(created['id'])
            if j and j['status'] in ('complete','failed'):break
        j=job_state(created['id']) or {}
        result.update(status=j.get('status','unknown'),message=str(j.get('message',''))[:160],opened_after=round(time.time()-t2,1))
    finally:
        try:api('cancel',{'id':created['id']})
        except Exception:pass
        command('gamerule advance_time true');command('time set 1000')

def main():
    wanted=set(sys.argv[1:])
    api('connect',{});wait(lambda:api('state').get('connected'),90)
    api('autopilot',{'enabled':False})
    command('gamemode survival BuilderBot');command('time set 1000');command('weather clear 1000000')
    results=[]
    for i,(name,what,build,kit) in enumerate(SCENARIOS):
        if wanted and name not in wanted:continue
        o=[2000+100*i,FLOOR,0]
        result={'scenario':name,'setup':what,'origin':o}
        try:
            start(o,kit)
            mark=log_mark()
            if name=='shelter_hole':shelter_hole(o,result)
            elif name=='box_pinned':box_pinned(o,result,mark)
            else:
                spec,seconds,check=build(o);time.sleep(1)
                result['job']=spec
                result.update(run_job(spec,seconds))
                if check:result['verified']=bool(check())
            p=pos();result['end_pos']=p
            lines=log_since(mark)
            result['lines']=[l[11:23]+' '+l[25:][:200] for l in lines if NOTE.search(l)][:60]
            errs={}
            for l in lines:
                m=re.search(r'Job: (.{0,90})',l)
                if m:k=re.sub(r'-?\d+','#',m.group(1));errs[k]=errs.get(k,0)+1
            result['repeated_errors']={k:v for k,v in errs.items() if v>=3}
        except Exception as e:
            result['status']='probe error';result['message']=str(e)[:200]
        finally:
            try:cancel_all();clear_patch(o)
            except Exception:pass
        results.append(result)
        print('%-20s %-11s %6ss  %s'%(name,result.get('status'),result.get('seconds',result.get('opened_after','')),result.get('message','')[:90]),flush=True)
    out=ROOT/'data'/'obstruction-results.json'
    out.write_text(json.dumps({'at':time.strftime('%Y-%m-%dT%H:%M:%S'),'results':results},indent=1),encoding='utf-8')
    command('clear BuilderBot');command('tp BuilderBot 0 %d 0'%FLOOR)
    print('wrote '+str(out),flush=True)

if __name__=='__main__':main()
