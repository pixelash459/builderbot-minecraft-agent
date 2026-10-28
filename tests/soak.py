"""Autopilot soak on a normal-terrain world (agent-soak-world, seed SOAK_SEED - default 8675309,
mixed biomes; 12345 is the measured dark-forest world of rounds up to 49): 3 normal runs of
40 minutes (NORMAL_SECONDS, frozen daylight) and 3 hard runs of ~21 minutes (HARD_SECONDS,
natural time from dawn).
Every run is made fair and reproducible by resetting the same five things at its start:
dawn (time set 0), clear weather, an empty inventory, the bot teleported to the world's
join point (the fixed canopy spawn for this seed), and full vitals - instant health plus
saturation, then confirmed 20/20 via /api/observe before the run clock starts. Milestones
are also tracked as per-run peaks (best counts seen in any sample), so a late death that
empties the inventory cannot erase the evidence. The operator roles (death resume, unstick,
return-to-join-point) stay active and every intervention is recorded. The three runs share
one world session, so each run's block changes persist into the next; the resets above are
the fairness contract, not a world reset.

Results go to data/soak-results-<timestamp>.json; a failed run never overwrites
data/soak-results.json - only a fully clean triple (no errors, full samples, final state in
every run) is promoted to it. The flat agent-test-world is restored afterwards, never deleted.
"""
import pathlib,json,urllib.request,urllib.error,time,re,sys,subprocess,socket,shutil,os
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.stdout.reconfigure(encoding='utf-8')
PROPS=ROOT/'test-server'/'server.properties'
def read_token(name):
    for _ in range(10):
        try:text=(ROOT/'data'/name).read_text().strip()
        except OSError:text=''
        if text:return text
        time.sleep(.5)
    raise RuntimeError('token file data/'+name+' is empty')
def api(route,data=None):
    last=None
    for attempt in range(2):
        r=urllib.request.Request('http://127.0.0.1:8765/api/'+route,data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer '+read_token('dashboard-token'),'Content-Type':'application/json'})
        try:return json.load(urllib.request.urlopen(r,timeout=120))
        except urllib.error.HTTPError as e:
            last=e
            if e.code==401 and attempt==0:time.sleep(2);continue # token just rotated; re-read
            raise RuntimeError(e.read().decode())
        except OSError as e:last=e;time.sleep(1)
    raise last
# Night skip (user request 2026-10-27): once observe reports the bot sealed and safe in its
# shelter for NIGHT_SKIP_SECONDS (box or burrow: in the cell, nothing open, nothing inside), the
# operator moves the clock to the next morning (tick 1000 of the next day, so the day counter
# advances like a slept night). The bot sees the morning and opens up on its own. 0 disables it.
NIGHT_SKIP_SECONDS=int(os.environ.get('SOAK_NIGHT_SKIP','150'))
def night_skip_ticks(o):
    sh=o.get('shelter') if isinstance(o,dict) else None;tod=o.get('tod') if isinstance(o,dict) else None
    if NIGHT_SKIP_SECONDS<=0 or not sh or not sh.get('safe') or (sh.get('seconds') or 0)<NIGHT_SKIP_SECONDS:return None
    if not isinstance(tod,(int,float)) or not (12000<=tod<23500):return None
    return int(24000-tod+1000)
def command(text):
    # Console fixtures affect ONLY the private test server (supervisor, loopback, token auth).
    r=urllib.request.Request('http://127.0.0.1:8766/test-command',data=json.dumps({'command':text}).encode(),headers={'Authorization':'Bearer '+read_token('supervisor-token'),'Content-Type':'application/json'})
    return json.load(urllib.request.urlopen(r,timeout=30))
def port_open(port):
    try:
        with socket.create_connection(('127.0.0.1',port),timeout=.5):return True
    except OSError:return False
def wait_port_closed(port,seconds=30):
    deadline=time.time()+seconds
    while time.time()<deadline:
        if not port_open(port):return
        time.sleep(1)
    # An orphaned process from an earlier run may still hold our own agent port. A PID here
    # is killed ONLY after its command line is confirmed to run from this project; a
    # foreign or unreadable one is reported and aborts the run instead - never killed.
    out=subprocess.run(['powershell','-NoProfile','-Command',f'Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess'],capture_output=True,text=True).stdout
    verified=[]
    for pid in {line.strip() for line in out.splitlines() if line.strip().isdigit()}:
        cmd=subprocess.run(['powershell','-NoProfile','-Command',f'Get-CimInstance Win32_Process -Filter "ProcessId={pid}" | Select-Object -ExpandProperty CommandLine'],capture_output=True,text=True).stdout.strip()
        if not cmd or 'minecraft-agent' not in cmd.lower():
            print(f'FOREIGN process {pid} (command line: {cmd or "unreadable"}) holds port {port}; refusing to kill it',flush=True)
            raise RuntimeError(f'port {port} is still in use; refusing to continue with a stale service')
        verified.append(pid)
    for pid in verified:
        print(f'killing orphaned project process {pid} holding port {port}',flush=True)
        subprocess.run(['powershell','-NoProfile','-Command',f'Stop-Process -Id {pid} -Force'],capture_output=True)
    deadline=time.time()+15
    while time.time()<deadline:
        if not port_open(port):return
        time.sleep(1)
    raise RuntimeError(f'port {port} is still in use; refusing to continue with a stale service')
def stop_services():
    try:
        r=urllib.request.Request('http://127.0.0.1:8766/stop',data=b'{"ok":1}',headers={'Authorization':'Bearer '+read_token('supervisor-token'),'Content-Type':'application/json'})
        urllib.request.urlopen(r,timeout=30)
    except Exception:pass
    # The game server gets a long grace: it must finish saving the world before we would
    # ever consider freeing its port.
    for port,grace in ((8765,30),(8766,30),(25569,120),(8081,30)):wait_port_closed(port,grace)
def wait_dashboard():
    for _ in range(60):
        try:
            urllib.request.urlopen('http://127.0.0.1:8765/',timeout=2);return
        except Exception:time.sleep(1)
    raise RuntimeError('dashboard did not start')
def wait_server():
    for attempt in range(40):
        try:
            print(f'connect attempt {attempt+1}',flush=True)
            api('disconnect',{}) # drop a possibly stuck half-open login before retrying
            time.sleep(2)
            api('connect',{})
            for _ in range(30):
                if api('state').get('connected'):
                    print('bot connected',flush=True);return
                time.sleep(3)
        except Exception as e:print('connect try failed: '+str(e)[:120],flush=True)
        time.sleep(3)
    raise RuntimeError('server did not come up')
# The fixed, known starting position for every run, measured in this soak world (seed 12345):
# an open clearing on the dark-forest floor at y=130 with ~95 trunk logs within 7 blocks and
# free air to stand in. (The world spawn for this seed is a cliff mountainside, and most
# plateau spots land the bot on TOP of the leaf canopy - the pathfinder cannot traverse
# either inside the time window - so runs anchor to this measured clearing instead.)
ANCHOR=[140,130,30]
# The soak seed. 12345 (the dark-forest world every soak through round 49 ran on) keeps its
# measured anchors; any other seed (SOAK_SEED, or the default below) is a new world in
# whatever biomes it generates: the scout starts from the bot's spawn and finds both anchors
# by gathering (no measured coordinates).
import os
SEED=os.environ.get('SOAK_SEED','8675309')
# Round 67 (user request 2026-10-29: the bot on a copy of the group's Nitrous survival world, to
# see what it does among player-made builds): SOAK_WORLD names a pristine world folder (a copy,
# never the live server's). Each soak copies it fresh into agent-soak-world instead of
# generating from SOAK_SEED; the pristine folder itself is never played on. Anchors are scouted
# from that world's own spawn.
WORLD_COPY=os.environ.get('SOAK_WORLD','').strip()
LIVE_SERVERS=ROOT.parent/'crafty'
MEASURED=SEED=='12345' and not WORLD_COPY
def edit_props(changes):
    lines=PROPS.read_text(encoding='utf-8').splitlines(True)
    out=[]
    for line in lines:
        key=line.split('=',1)[0] if '=' in line and not line.startswith('#') else None
        if key and key in changes:out.append(key+'='+changes[key]+'\n')
        else:out.append(line)
    PROPS.write_text(''.join(out),encoding='utf-8')
def inventory_counts():
    state=api('state')
    return state,merge_inventory(state)
def merge_inventory(state):
    # Stacks are summed (a dict comprehension kept only the LAST stack of an item: 64+ cobble
    # or two torch stacks read short). Round 8: worn armour and the off hand (state
    # 'equipment') count as held, and each worn piece also as '_worn:<name>'.
    inv={}
    for i in state.get('inventory') or []:inv[i['name']]=inv.get(i['name'],0)+i['count']
    for i in state.get('equipment') or []:
        inv[i['name']]=inv.get(i['name'],0)+i.get('count',1)
        inv['_worn:'+i['name']]=inv.get('_worn:'+i['name'],0)+i.get('count',1)
    return inv
def job_evidence(jobs):
    # Compact per-job trail: what was asked, how it ended, and the last word on it.
    out=[]
    # The session job list grows across runs: jobs[:40] recorded run 1's trail forever and
    # later runs' evidence was lost - keep the most recent 40 (the recording happens at the
    # run's end, so this is that run's trail plus at most a little of the next).
    for j in jobs[-40:]:
        spec=j.get('spec') or {}
        out.append({'type':spec.get('type'),'of':spec.get('block') or spec.get('item') or spec.get('entity'),
                    'status':j['status'],'progress':j.get('progress'),'message':(j.get('message') or '')[:140]})
    return out
def meals_delta(state,run):
    # worker.meals is session-wide (eaten = food-bar rises right after a consume, i.e. the
    # eat job, auto-eat, FoodChain and the fight's disengage-eat; cooked = food smelted).
    # The run's share is the difference from its start; a dashboard restart resets the
    # counters, so a negative difference counts from zero.
    now=state.get('meals') or {};mark=run.get('meals_mark') or {}
    if now.get('eaten',0)<mark.get('eaten',0):mark={}
    items={k:v-(mark.get('items') or {}).get(k,0) for k,v in (now.get('items') or {}).items()}
    return {'eaten':now.get('eaten',0)-mark.get('eaten',0),'points':now.get('points',0)-mark.get('points',0),
            'cooked':max(0,now.get('cooked',0)-mark.get('cooked',0)),'items':{k:v for k,v in items.items() if v>0},
            'due':max(0,now.get('due',0)-mark.get('due',0)),'failed':max(0,now.get('failed',0)-mark.get('failed',0)),
            'no_food':max(0,now.get('noFood',0)-mark.get('noFood',0)),
            'attempts':max(0,now.get('attempts',0)-mark.get('attempts',0)),'deferred':max(0,now.get('deferred',0)-mark.get('deferred',0)),
            'ok':max(0,now.get('ok',0)-mark.get('ok',0)),
            'last_error':now.get('lastError') if now.get('failed',0)>mark.get('failed',0) else None,
            'last_deferred':now.get('lastDeferred') if now.get('deferred',0)>mark.get('deferred',0) else None}
# FoodChain eats at a bar of 14 or less with food held (round 8; AltoClef's 10 left the bar
# at 11..14 all run), and below 14 health at any bar < 20.
FOOD_EAT_AT=14
def food_level(samples):
    # Round 6: 'eaten 0' on all six round-5 runs could mean a broken eat path or a bar that
    # never got low in 20 min. The samples' food bar (and saturation) says which.
    food=[s['food'] for s in samples if isinstance(s.get('food'),(int,float))]
    sat=[s['sat'] for s in samples if isinstance(s.get('sat'),(int,float))]
    # Round 7: the lowest bar while food was actually held - normal2 fell to 5 with nothing
    # to eat and read EAT FAILED.
    held=[s['food'] for s in samples if isinstance(s.get('food'),(int,float)) and s.get('food_items',0)>0]
    return {'food_min':min(food) if food else None,'food_max':max(food) if food else None,'sat_min':min(sat) if sat else None,
            'food_min_held':min(held) if held else None}
def food_verdict(run):
    # Round 8: the verdict says what happened -
    #   ate N | not hungry enough (no meal was due) | no food held |
    #   attempted and failed: reason (a meal started and failed) |
    #   EAT FAILED: never attempted (a meal was due with food held and none started; the
    #   chain's last deferral reason when it recorded one).
    # Round 7 read `EAT FAILED (due 1, failed 0)` with 8-10 cooked food held: no attempt at
    # all, which the old wording could not tell from a failed one.
    meals=run.get('meals') or {};lv=run.get('food_level') or {}
    due,failed,attempts=meals.get('due',0),meals.get('failed',0),meals.get('attempts')
    low=lv.get('food_min')
    tail=' (due '+str(due)+', failed '+str(failed)+', food min '+str(low)+')'
    reason=meals.get('last_error') or 'no reason recorded'
    # Round 9: 'ok' is the FoodChain's own count of meals that showed a bar rise or a shrunk
    # stack. Round 8's normal1 logged two `Food: ate` lines and read `never attempted (due 2)`:
    # the consume wrap counted nothing live, and the verdict ignored attempts at a bar > 14.
    eaten=max(meals.get('eaten',0),meals.get('ok',0))
    if eaten>0:
        return 'ate '+str(eaten)+('' if not failed else ' ('+str(failed)+' failed'+(': '+meals['last_error'] if meals.get('last_error') else '')+')')
    if failed:return 'attempted and failed: '+reason+tail
    never='EAT FAILED: never attempted'+(' (last deferred: '+meals['last_deferred']+')' if meals.get('last_deferred') else '')+tail
    if attempts and attempts>failed:
        return 'attempted '+str(attempts)+', no meal recorded'+tail
    if low is None or low>FOOD_EAT_AT:
        return 'not hungry enough (food min '+str(low)+')' if due==0 else never
    held=lv.get('food_min_held')
    if meals.get('no_food',0) or not run.get('edible_peak') or ('food_min_held' in lv and (held is None or held>FOOD_EAT_AT)):
        return 'no food held (food min '+str(low)+')'
    return never
# Deaths (round 5): the run count is the max of three independent sources, so no single
# blind spot can hide one - round 4 recorded 1 death where the server log has 4:
# - the bot's own counter (state['deaths'], +1 per mineflayer 'death' event, session-wide);
# - the server log from the run's start, matched against every vanilla death message (the
#   old 'was|blew up|fell|died' missed 'drowned', and the per-death parse moved the log mark
#   so the final parse only saw the tail);
# - 'Bot died at' in the dashboard's 100-event window (a flee storm scrolls it out fast).
# The log parse never depends on the dashboard: round 4 hard3's final read timed out and the
# run line said deaths=0 with two skeleton deaths in the log.
DEATH_RE=re.compile(r"\bBuilderBot (was |were |drowned|blew up|burned to death|went up in flames|went off with a bang|walked into|fell |hit the ground too hard|"
                    r"tried to swim in lava|suffocated|starved|froze to death|withered away|died|experienced kinetic energy|discovered the floor was lava|"
                    r"didn't want to live|left the confines|was killed)")
DEATH_NOT=re.compile(r"<BuilderBot>|BuilderBot (was kicked|lost connection|joined|left the game)")
def log_deaths(text):
    out=[]
    for line in (text or '').splitlines():
        if DEATH_RE.search(line) and not DEATH_NOT.search(line):out.append(re.sub(r'^.*?INFO..?:\s*','',line).strip()[:120])
    return out
def bot_deaths(state,run):
    # The run's share of the bot's session counter; a dashboard restart resets it (count from 0).
    now=(state or {}).get('deaths');mark=run.get('bot_deaths_mark') or 0
    if not isinstance(now,int):return 0
    return now-mark if now>=mark else now
def death_tally(run,state=None,events='',log_text=None):
    """Deaths so far: the max of the bot counter, the server log and the event window; causes from the log."""
    causes=log_deaths(log_text) if log_text is not None else list(run.get('death_causes') or [])
    window=max(0,(events or '').count('Bot died at')-run.get('deaths_mark',0))
    counter=bot_deaths(state,run) if state is not None else 0
    return {'deaths':max(run.get('deaths',0),counter,len(causes),window),'causes':causes,'counter':counter,'log':len(causes),'window':window}
def run_log(run):
    text=(ROOT/'logs/test-server.log').read_text(encoding='utf-8',errors='replace')
    return text[run.get('logstart',0):]
# Normal runs ended at 600 s still on the food step (soak 2026-10-14 18:44), so the iron step
# was never measured: 1200 s from the frozen-day start left it room. Round 9: the iron pickaxe
# lands at 15-20 min, right at the 1200 s bell, so the rung after it (torches, worn armour,
# bed, diamonds) could never be measured - normal runs are 2400 s. Hard runs stay 1250 s
# (dawn to past the first night).
NORMAL_SECONDS=2400
HARD_SECONDS=1250
IRON_KEYS=('iron_ore','ingots','iron_pick')
def iron_sample(inv):
    # Raw iron is what an iron_ore / deepslate_iron_ore dig drops; the ore item itself only
    # with silk touch (unsupported), counted anyway so nothing is missed.
    return {'iron_ore':inv.get('raw_iron',0)+inv.get('iron_ore',0)+inv.get('deepslate_iron_ore',0),
            'ingots':inv.get('iron_ingot',0),'iron_pick':inv.get('iron_pickaxe',0)}
def iron_metrics(samples):
    # Peaks, not end counts: smelting eats the ore and the pickaxe craft eats 3 ingots.
    return {'iron_ore_peak':max([s.get('iron_ore',0) for s in samples]+[0]),
            'ingots_peak':max([s.get('ingots',0) for s in samples]+[0]),
            'iron_pick_at':first_sample_at(samples,'iron_pick'),
            'iron':any(s.get('iron_pick',0)>=1 for s in samples)}
# Round 8 rung: armour (iron or better pieces held / worn), torches, a bed, diamonds and
# the diamond pickaxe - sampled and summarised like the iron columns.
KIT_KEYS=('armour','armour_worn','torches','bed','diamonds','diamond_pick')
ARMOUR_PIECES=('helmet','chestplate','leggings','boots')
ARMOUR_TIERS=('iron','diamond','netherite')
def kit_sample(inv):
    pieces=[t+'_'+p for p in ARMOUR_PIECES for t in ARMOUR_TIERS]
    held=sum(1 for p in ARMOUR_PIECES if any(inv.get(t+'_'+p,0)>0 for t in ARMOUR_TIERS))
    worn=sum(1 for p in ARMOUR_PIECES if any(inv.get('_worn:'+t+'_'+p,0)>0 for t in ARMOUR_TIERS))
    return {'armour':held,'armour_worn':worn,'torches':inv.get('torch',0),
            'bed':sum(v for k,v in inv.items() if k.endswith('_bed') and not k.startswith('_')),
            'diamonds':inv.get('diamond',0),'diamond_pick':inv.get('diamond_pickaxe',0)}
def kit_metrics(samples):
    peak=lambda k:max([s.get(k,0) for s in samples]+[0])
    return {'armour_peak':peak('armour'),'armour_worn_peak':peak('armour_worn'),'armour_worn_at':first_sample_at(samples,'armour_worn'),
            'torch_peak':peak('torches'),'bed_at':first_sample_at(samples,'bed'),
            'diamond_peak':peak('diamonds'),'diamond_pick_at':first_sample_at(samples,'diamond_pick')}
def first_sample_at(samples,key,n=1):
    for s in samples:
        if s.get(key,0)>=n:return s['t']
    return None
def reset_vitals(run):
    # Second half of the fairness contract: the previous run can end starving or freshly
    # dead, so every run starts from confirmed full health and hunger. Effects target the
    # bot only (never @a/@p - a human spectator may be on the server).
    def effects():
        for text in ('effect give BuilderBot minecraft:instant_health 1 10 true',
                     'effect give BuilderBot minecraft:saturation 1 20 true',
                     'effect clear BuilderBot'):
            try:command(text)
            except Exception as e:run['errors'].append('vitals '+text.split()[1]+': '+str(e)[:120])
            time.sleep(.5)
    def at20():
        try:o=api('observe');return o.get('health')==20 and o.get('food')==20
        except Exception:return False
    effects()
    ok=False
    for _ in range(6): # ~6s for the instant effects to land
        if at20():ok=True;break
        time.sleep(1)
    if not ok:
        effects() # one retry: a lingering damage/hunger tick can eat the first pair
        for _ in range(4):
            if at20():ok=True;break
            time.sleep(1)
    run['vitals_ok']=ok
    if not ok:run['errors'].append('vitals: 20/20 not confirmed before run start')
    print('run '+str(run['index'])+' vitals: '+('ok (health 20, food 20)' if ok else 'NOT CONFIRMED'),flush=True)
def reset_ladder(run):
    # Ghost inventory + leftover ladder: a previous run's furnace window /clear left the
    # client holding a stone kit it did not have (soak 20261014-0239 normal2 skipped wood
    # for 4.5 minutes). Stop the ladder, cancel every job, then /clear after the windows close.
    try:api('autopilot',{'enabled':False})
    except Exception as e:run['errors'].append('cleanup autopilot: '+str(e)[:100])
    try:
        for leftover in api('state').get('jobs',[]):
            if leftover['status'] in ('paused','queued','running'):
                api('cancel',{'id':leftover['id']})
    except Exception as e:run['errors'].append('cleanup jobs: '+str(e)[:100])
    time.sleep(1.5)

def inventory_clean():
    try:
        _,inv=inventory_counts()
        return not any(inv.get(k,0)>0 for k in (
            'wooden_pickaxe','wooden_sword','wooden_axe','stone_pickaxe','stone_sword',
            'stone_axe','stone_shovel','crafting_table','furnace','stick'))
    except Exception:
        return False

# Round 66 (round-65 soak, 14:53:06Z: the run-start teleport put the bot at -71.5,69,150.5 and it
# `suffocated in a wall` the same second - a block placed there by an earlier run, and the bot
# arrived starving at about 1 health from the run before): the anchor's feet and head cells are
# cleared before every teleport there, and the bot is healed first. Test world only; the cells
# are the bot's own standing room.
def clear_stand(spawn,run=None):
    x,y,z=spawn
    try:command(f'fill {x} {y} {z} {x} {y+1} {z} minecraft:air')
    except Exception as e:
        if run is not None:run['errors'].append('setup fill: '+str(e)[:120])
def tp_anchor(spawn,run=None):
    clear_stand(spawn,run)
    command(f'tp BuilderBot {spawn[0]} {spawn[1]} {spawn[2]}')
def run_one(index,spawn,seconds=NORMAL_SECONDS):
    run={'index':index,'errors':[],'samples':[],'interventions':[],'resumes':0,'deaths':0}
    reset_ladder(run)
    # Fair, reproducible start: the fixed spawn point, dawn, clear sky, empty inventory.
    # `weather clear <ticks>`: 1200 was only 60 s, and when a clear timer expires vanilla flips
    # straight into rain (rainTime is held at 1 while clear), so every run used to turn to rain and
    # thunder a minute in. 1000000 ticks (~14 h) keeps the run's sky clear.
    try:command('effect give BuilderBot minecraft:instant_health 1 10 true')
    except Exception as e:run['errors'].append('setup heal: '+str(e)[:120])
    clear_stand(spawn,run)
    for text in (f'tp BuilderBot {spawn[0]} {spawn[1]} {spawn[2]}','time set 0','weather clear 1000000','clear BuilderBot'):
        try:command(text)
        except Exception as e:run['errors'].append('setup '+text.split()[0]+': '+str(e)[:120])
        time.sleep(.5)
    # Leftover hostiles around the spawn are carried-over state from earlier runs and nights
    # (under dark-forest canopy they survive daylight); every suite test sweeps them too.
    for mob in ('zombie','skeleton','creeper','spider','witch','slime','enderman','phantom','husk','stray','drowned','zombie_villager'):
        try:command(f'execute as BuilderBot at @s run kill @e[type=minecraft:{mob},distance=..64]')
        except Exception as e:run['errors'].append('setup kill '+mob+': '+str(e)[:100])
        time.sleep(.2)
    # FAIL-CLOSED setup verification (review): a failed time set would poison the run at
    # nightfall - skeletons do not burn outside daylight, so an unconfirmed setup makes the
    # run INVALID (never counted). Retry the commands while polling observe.
    world_ok=False;o={}
    for attempt in range(6):
        try:
            o=api('observe')
            if o.get('timeOfDay')=='day' and o.get('weather')=='clear':world_ok=True;break
        except Exception:pass
        try:command('time set 0');command('weather clear 1000000')
        except Exception:pass
        time.sleep(3)
    run['world_ok']=world_ok
    run['tod_at_start']=o.get('timeOfDay') if world_ok else None
    if not world_ok:
        seen=f"observe: timeOfDay={o.get('timeOfDay')!r} weather={o.get('weather')!r}" if isinstance(o,dict) else 'observe unavailable'
        run['invalid']='setup: dawn/clear weather not confirmed after retries ('+seen+')'
        print(f'--- soak run {index}: INVALID - dawn/clear not confirmed ({seen}); not counted',flush=True)
        return run
    time.sleep(2)
    # /clear while a furnace/table window is open resurrects the old inventory on close.
    # Re-clear until observe shows no leftover kit, then the ladder starts honest.
    for _ in range(4):
        if inventory_clean():break
        try:command('clear BuilderBot')
        except Exception as e:run['errors'].append('reclear: '+str(e)[:80])
        time.sleep(1)
    if not inventory_clean():run['errors'].append('setup: leftover kit still in observe after /clear')
    reset_vitals(run)
    print(f'--- soak run {index}/3: dawn, clear weather, empty inventory, full vitals, spawn {spawn}',flush=True)
    api('autopilot',{'enabled':True})
    run['logstart']=len((ROOT/'logs/test-server.log').read_text(encoding='utf-8',errors='replace'))
    try:run['bot_deaths_mark']=int(api('state').get('deaths') or 0)
    except Exception as e:run['bot_deaths_mark']=0;run['errors'].append('deaths mark: '+str(e)[:80])
    # The dashboard event window is session-wide. A death in run N still matches
    # 'Bot died at' in run N+1 and used to start that run at deaths=1 with a false resume
    # (soak 5 normal2 t=30 after normal1's fall). Snapshot the count at the start.
    try:
        _ev=' | '.join(e['message'] for e in api('state').get('events',[])[:100])
        run['deaths_mark']=_ev.count('Bot died at')
    except Exception:
        run['deaths_mark']=0
    try:run['meals_mark']=dict(api('state').get('meals') or {})
    except Exception as e:run['meals_mark']={};run['errors'].append('meals mark: '+str(e)[:80])
    start=time.time();deaths=0;deaths_prev=0;stuck_count=0;stuck_key=None
    while time.time()-start<seconds:
        time.sleep(30)
        try:
            state,inv=inventory_counts();o=api('observe')
            events=' | '.join(e['message'] for e in state['events'][:100])
            # Every source at every sample (death_tally): an undercounted death stops the
            # operator from resuming the run.
            try:log_text=run_log(run)
            except Exception as e:log_text=None;run['errors'].append('death log: '+str(e)[:80])
            tally=death_tally(run,state,events,log_text)
            if log_text is not None:run['death_causes']=tally['causes']
            new_deaths=tally['deaths']
            if new_deaths>deaths: # record the sky state at every death (review directive)
                tod_now=o.get('timeOfDay');light_now=o.get('light')
                run.setdefault('death_tods',[]).append({'at':round(time.time()-start),'tod':tod_now,'light':light_now,
                    'pos':[round(o['position'][k],1) for k in ('x','y','z')]})
            deaths=max(deaths,new_deaths);run['deaths']=deaths
            ap=o['autopilot']
            sample={'t':round(time.time()-start),'pos':[round(o['position'][k],1) for k in ('x','y','z')],'hp':round(o['health'],1),'food':o['food'],
                    'sat':None if o.get('saturation') is None else round(o['saturation'],1),
                    'step':ap.get('step'),'apstate':ap.get('state'),
                    'logs':sum(v for k,v in inv.items() if k.endswith('_log')),
                    'planks':sum(v for k,v in inv.items() if k.endswith('_planks')),
                    'sticks':inv.get('stick',0),
                    'cobble':inv.get('cobblestone',0),
                    'wood_pick':inv.get('wooden_pickaxe',0),'table':inv.get('crafting_table',0),
                    'stone_pick':inv.get('stone_pickaxe',0),
                    'stone_sword':inv.get('stone_sword',0),'furnace':inv.get('furnace',0),
                    **iron_sample(inv),**kit_sample(inv),
                    'food_items':o.get('edible',0),'eaten':meals_delta(state,run)['eaten'],'deaths':deaths}
            run['samples'].append(sample)
            skip=night_skip_ticks(o)
            if skip:
                try:
                    command('time add '+str(skip))
                    run.setdefault('night_skips',[]).append({'at':sample['t'],'tod':o.get('tod'),'kind':o['shelter'].get('kind'),'sealed_s':o['shelter'].get('seconds')})
                    run['interventions'].append('operator: skipped the night at t='+str(sample['t'])+' (tod '+str(o.get('tod'))+', '+str(o['shelter'].get('kind'))+' safe '+str(o['shelter'].get('seconds'))+' s)')
                    print('operator: night skipped (tod '+str(o.get('tod'))+', sealed safe '+str(o['shelter'].get('seconds'))+' s)',flush=True)
                except Exception as e:run['errors'].append('night skip: '+str(e)[:80])
            # Operator role: a death pauses everything and needs an explicit resume before the
            # ladder will move again. The death also disables the autopilot within a second
            # (worker.stop on death sets userStopped), so trigger on the death COUNT rising,
            # not on the transient 'paused: died' state. The respawn point is the world spawn
            # (a cliff mountainside the bot cannot leave), so return it to the anchor.
            # 'idle' after the run started means the death stopped the autopilot (worker.stop
            # on death sets userStopped; the next tick disables the ladder): resume that too.
            died=deaths>deaths_prev or str(ap.get('state','')).startswith('paused: died')
            idle=sample['t']>60 and ap.get('state')=='idle' and ap.get('enabled') is False
            if died or idle:
                for j in state.get('jobs',[]):
                    if j['status']=='paused':api('cancel',{'id':j['id']})
                api('autopilot',{'enabled':True})
                deaths_prev=deaths
                if died:
                    # The causes come from the run's whole log slice (death_tally above). The bot
                    # is NOT returned to the anchor after a death: respawning into the same mob
                    # cluster every 30 s turned one death into a death spiral in the baseline soak.
                    run['resumes']+=1
                    run['interventions'].append('operator: resumed the ladder after death at t='+str(sample['t']))
                    print('operator: resumed the ladder after death '+str(deaths),flush=True)
                else:
                    run['resumes']+=1
                    run['interventions'].append('operator: resumed idle autopilot at t='+str(sample['t']))
                    print('operator: resumed idle autopilot',flush=True)
            # A ravine path drops the bot under the trunks (measured: y=108 vs logs at y=131)
            # and belowFoots then refuses every log. Put it back on the anchor. WOOD STEP ONLY:
            # logs are 0 again once they are spent, and soak 20261014-0218 teleported the bot
            # out of legitimate downhill explore legs of the food step three times.
            # Round 59: 14 below, not 8 - the bot's own surface floor now allows open-sky ground
            # down to 12 under the gather's start (rolling seeds: 6274947974391380586's hard
            # anchor sits at y=71 over ground at y=61-66, and 8 below teleported it 12 times).
            if sample['step']=='wood' and sample['logs']==0 and sample['pos'][1]<spawn[1]-14 and run.get('returns',0)<3:
                run['returns']=run.get('returns',0)+1
                tp_anchor(spawn,run)
                run['interventions'].append('operator: returned the bot from below the anchor at '+json.dumps(sample['pos']))
                print('operator: returned the bot from y='+str(sample['pos'][1]),flush=True)
            # Operator role: wood blocked with no logs means the bot wandered somewhere it
            # cannot path from; return it to the fixed spawn point once per run.
            if 'blocked: wood' in str(ap.get('state','')) and sample['logs']==0 and 'recovered' not in run:
                run['recovered']=True
                tp_anchor(spawn,run)
                run['interventions'].append('operator: returned the bot to the spawn point after wood blocked at '+json.dumps(sample['pos']))
                print('operator: returned the bot to the forest after wood blocked',flush=True)
            # Operator role: a gather that holds the bot motionless for three straight samples
            # is wedged (leaf pockets on the canopy spawn); lift it out and let it re-plan.
            # Surface only: the iron step's staircase gathers run far below the anchor, and a
            # +4 teleport there lands inside rock (suffocation), not out of a leaf pocket.
            if ap.get('state')=='working: gather' and sample['pos'][1]>=spawn[1]-8:
                key=tuple(sample['pos'])
                stuck_count=stuck_count+1 if stuck_key==key else 1
                stuck_key=key
                if stuck_count>=3:
                    p0=sample['pos']
                    command(f'tp BuilderBot {p0[0]+2} {p0[1]+4} {p0[2]+2}')
                    run['interventions'].append('operator: unstuck the bot from '+json.dumps(p0))
                    stuck_count=0
                    print('operator: unstuck the bot at '+json.dumps(p0),flush=True)
            else:stuck_count=0
            print('SOAK',json.dumps({'run':index,**sample}),flush=True)
            if not state.get('connected'):
                run['errors'].append('bot disconnected at t='+str(sample['t']))
                api('connect',{})
        except Exception as e:
            run['errors'].append('sample error: '+str(e))
    # Peaks: a late death empties the inventory, so milestones are judged by the best
    # counts seen in any sample, not the final one. 'at' keeps the first t of the maximum.
    peak_keys=('logs','planks','sticks','cobble','wood_pick','table','stone_pick','stone_sword','furnace')+IRON_KEYS+KIT_KEYS
    run['peaks']={k:{'max':0,'at':None} for k in peak_keys}
    for s in run['samples']:
        for k in peak_keys:
            if s.get(k,0)>run['peaks'][k]['max']:run['peaks'][k]={'max':s[k],'at':s['t']}
    run['first']={k:first_sample_at(run['samples'],k) for k in ('wood_pick','table','cobble','stone_pick','furnace')+IRON_KEYS+KIT_KEYS}
    run.update(iron_metrics(run['samples']))
    run.update(kit_metrics(run['samples']))
    try:
        state,inv=inventory_counts();o=api('observe')
        run['achieved']={k:inv.get(k,0) for k in ('stick','crafting_table','wooden_pickaxe','wooden_axe','wooden_sword','wooden_shovel','cobblestone','stone_pickaxe','stone_axe','stone_sword','stone_shovel','furnace','torch','raw_iron','iron_ingot','iron_pickaxe','iron_sword',
            'iron_helmet','iron_chestplate','iron_leggings','iron_boots','diamond','diamond_pickaxe')}
        run['achieved']['armour_worn']=kit_sample(inv)['armour_worn'];run['achieved']['bed']=kit_sample(inv)['bed']
        run['achieved']['logs_total']=sum(v for k,v in inv.items() if k.endswith('_log'))
        run['achieved']['planks_total']=sum(v for k,v in inv.items() if k.endswith('_planks'))
        # observe's `edible` (registry foods minus the never-eat list): the old
        # o['inventory']['_edible'] key never existed, so every food count read 0.
        run['achieved']['edible_food']=o.get('edible',0)
        # Step completion matches the ladder's own done() predicates.
        run['wood']=run['achieved']['wooden_pickaxe']>=1 and run['achieved']['crafting_table']>=1
        run['stone']=all(run['achieved'].get(k,0)>=1 for k in ('stone_pickaxe','stone_axe','stone_sword','stone_shovel','furnace'))
        run['wood_at']=first_sample_at(run['samples'],'wood_pick')
        run['stone_at']=first_sample_at(run['samples'],'stone_pick')
        # M4 food: eating is the point, so the END count alone lies (a fed bot shows 0).
        # food = the run obtained edible food at any sample; tod_end shows whether the hard
        # runs actually crossed dusk/night (first-night milestone).
        peak_food=max([s.get('food_items',0) for s in run['samples']]+[0])
        meals=run['meals']=meals_delta(state,run)
        run['food']=peak_food>=1 or run['achieved']['edible_food']>=1 or meals['eaten']>=1 or meals['cooked']>=1
        run['edible_peak']=peak_food
        run['food_level']=food_level(run['samples'])
        run['food_verdict']=food_verdict(run)
        run['tod_end']=o.get('timeOfDay')
        run['final_state']=o['autopilot']
        events=' | '.join(e['message'] for e in state['events'][:100])
        tally=death_tally(run,state,events,None)
        run['deaths']=tally['deaths'];run['death_sources']={'counter':tally['counter'],'window':tally['window']}
        run['death_log']=[d for d in (state.get('deathLog') or [])][-max(1,tally['counter']):] if tally['counter'] else []
        run['jobs']=job_evidence(state.get('jobs',[]))
    except Exception as e:run['errors'].append('final read: '+str(e))
    # Authoritative and dashboard-free: the run's whole server-log slice.
    try:
        tally=death_tally(run,None,'',run_log(run))
        run['death_causes']=tally['causes'];run['deaths']=tally['deaths']
        run.setdefault('death_sources',{})['log']=tally['log']
    except Exception as e:run['errors'].append('death causes final: '+str(e)[:100])
    try:api('autopilot',{'enabled':False})
    except Exception:pass
    # Stop the run's last job too, so no container window is open when the next run's
    # `clear` lands (soak 20261014-0239 normal2: a furnace left open through the clear gave
    # the client a ghost stone kit on close and the ladder spent 4.5 min in the food step).
    try:
        for j in api('state').get('jobs',[]):
            if j['status'] in ('running','queued','paused'):api('cancel',{'id':j['id']})
        time.sleep(2)
    except Exception as e:run['errors'].append('end cancel: '+str(e)[:120])
    print(f"--- run {index}: wood={'YES' if run.get('wood') else 'no'} stone={'YES' if run.get('stone') else 'no'} "
          f"food={'YES' if run.get('food') else 'no'} (peak {run.get('edible_peak',0)}, eaten {(run.get('meals') or {}).get('eaten',0)}, cooked {(run.get('meals') or {}).get('cooked',0)}, "
          f"bar {(run.get('food_level') or {}).get('food_min')}..{(run.get('food_level') or {}).get('food_max')}: {run.get('food_verdict')}) "
          f"iron={'YES' if run.get('iron') else 'no'} (ore {run.get('iron_ore_peak',0)}, ingots {run.get('ingots_peak',0)}, pick at {run.get('iron_pick_at')}) "
          f"kit (armour {run.get('armour_peak',0)}/4, worn {run.get('armour_worn_peak',0)} at {run.get('armour_worn_at')}, torches {run.get('torch_peak',0)}, bed at {run.get('bed_at')}, diamonds {run.get('diamond_peak',0)}, diamond pick at {run.get('diamond_pick_at')}) "
          f"deaths={run['deaths']} resumes={run['resumes']} interventions={len(run['interventions'])} errors={len(run['errors'])}",flush=True)
    return run
def _median(vals):
    s=sorted(vals);n=len(s)
    if not n:return 0
    mid=n//2
    return s[mid] if n%2 else (s[mid-1]+s[mid])/2
def summarise(runs):
    keys=('logs_total','planks_total','stick','crafting_table','wooden_pickaxe','cobblestone','stone_pickaxe','stone_axe','stone_sword','stone_shovel','furnace')
    peak_keys=('logs','planks','sticks','cobble','wood_pick','table','stone_pick','stone_sword','furnace')+IRON_KEYS+KIT_KEYS
    return {'wood_runs':sum(1 for r in runs if r.get('wood')),'stone_runs':sum(1 for r in runs if r.get('stone')),
            'food_runs':sum(1 for r in runs if r.get('food')),
            'iron_runs':sum(1 for r in runs if r.get('iron')),
            'iron_ore_peak':[r.get('iron_ore_peak',0) for r in runs],'ingots_peak':[r.get('ingots_peak',0) for r in runs],
            'iron_pick_at':[r.get('iron_pick_at') for r in runs],
            'armour_runs':sum(1 for r in runs if r.get('armour_worn_peak',0)>=2),
            'armour_peak':[r.get('armour_peak',0) for r in runs],'armour_worn_peak':[r.get('armour_worn_peak',0) for r in runs],
            'armour_worn_at':[r.get('armour_worn_at') for r in runs],'torch_peak':[r.get('torch_peak',0) for r in runs],
            'bed_at':[r.get('bed_at') for r in runs],'diamond_peak':[r.get('diamond_peak',0) for r in runs],
            'diamond_pick_at':[r.get('diamond_pick_at') for r in runs],
            'edible_peak':[r.get('edible_peak',0) for r in runs],'edible_end':[(r.get('achieved') or {}).get('edible_food',0) for r in runs],
            'eaten':[(r.get('meals') or {}).get('eaten',0) for r in runs],'food_points':[(r.get('meals') or {}).get('points',0) for r in runs],
            'cooked':[(r.get('meals') or {}).get('cooked',0) for r in runs],
            'food_due':[(r.get('meals') or {}).get('due',0) for r in runs],'food_failed':[(r.get('meals') or {}).get('failed',0) for r in runs],
            'food_no_food':[(r.get('meals') or {}).get('no_food',0) for r in runs],
            'food_attempts':[(r.get('meals') or {}).get('attempts',0) for r in runs],'food_deferred':[(r.get('meals') or {}).get('deferred',0) for r in runs],
            'food_min':[(r.get('food_level') or {}).get('food_min') for r in runs],'food_max':[(r.get('food_level') or {}).get('food_max') for r in runs],
            'food_verdict':[r.get('food_verdict') for r in runs],
            'tod_end':[r.get('tod_end') for r in runs],'night_skips':[len(r.get('night_skips') or []) for r in runs],
            'wood_at':[r.get('wood_at') for r in runs],'stone_at':[r.get('stone_at') for r in runs],
            'deaths':sum((r.get('deaths') or 0) for r in runs),'resumes':sum((r.get('resumes') or 0) for r in runs),
            'interventions':sum(len(r['interventions']) for r in runs),
            'median':{k:_median([(r.get('achieved') or {}).get(k,0) for r in runs]) for k in keys},
            'peak_median':{k:_median([(r.get('peaks') or {}).get(k,{}).get('max',0) for r in runs]) for k in peak_keys}}
# Round 9: one row per run, one column per ladder rung (first sample seconds, or the peak),
# so the iron rung's torches / worn armour / bed / diamonds read at a glance.
RUNG_COLUMNS=('run','wood','stone pick','furnace','iron pick','torches','armour worn','bed','diamonds','diamond pick','food','deaths')
def rung_rows(runs):
    def at(v):return '-' if v is None else str(v)
    rows=[]
    for r in runs:
        first=r.get('first') or {}
        rows.append((str(r.get('index')),at(r.get('wood_at')),at(first.get('stone_pick',r.get('stone_at'))),at(first.get('furnace')),
                     at(r.get('iron_pick_at')),str(r.get('torch_peak',0)),
                     str(r.get('armour_worn_peak',0))+('' if r.get('armour_worn_at') is None else ' at '+str(r.get('armour_worn_at'))),
                     at(r.get('bed_at')),str(r.get('diamond_peak',0)),at(r.get('diamond_pick_at')),
                     str(r.get('food_verdict') or '-'),str(r.get('deaths') or 0)))
    return rows
def rung_table(runs):
    rows=[RUNG_COLUMNS]+rung_rows(runs)
    widths=[max(len(row[i]) for row in rows) for i in range(len(RUNG_COLUMNS))]
    return '\n'.join(' | '.join(c.ljust(widths[i]) for i,c in enumerate(row)).rstrip() for row in rows)
def save_results(payload):
    stamp=time.strftime('%Y%m%d-%H%M%S')
    (ROOT/'data'/f'soak-results-{stamp}.json').write_text(json.dumps(payload,indent=2),encoding='utf-8')
    clean=all(not r['errors'] and len(r['samples'])>=15 and r.get('final_state') is not None for r in payload['runs'])
    if clean:
        (ROOT/'data'/'soak-results.json').write_text(json.dumps(payload,indent=2),encoding='utf-8')
        print('clean triple promoted to data/soak-results.json',flush=True)
    else:
        print(f"triple had errors ({sum(len(r['errors']) for r in payload['runs'])}); data/soak-results.json left untouched; full results in data/soak-results-{stamp}.json",flush=True)
    return clean
def wait(predicate,seconds):
    deadline=time.time()+seconds
    while time.time()<deadline:
        try:
            value=predicate()
        except Exception:
            value=None
        if value:return value
        time.sleep(2)
    raise TimeoutError('soak wait: condition did not become true')
def probe_spot():
    # Live read at the bot's current position: reachable logs within 24 and the light.
    o=api('observe')
    logs=(o.get('blocks') or {}).get('logs') or {}
    return {'logs':logs.get('count',0),'log_at':logs.get('at'),'light':o.get('light'),
            'tod':o.get('timeOfDay'),'pos':[round(o['position'][k]) for k in ('x','y','z')]}

def scout_anchors(base):
    # (review) Fail-closed anchor scout on the regenerated seed.
    # The observe survey's strided scan misses sparse dark-oak trunks (measured: logs=0 at
    # every probe of a forest), so the detector is the gather job itself - findBlocks is
    # exhaustive within its radius. A gather that COMPLETES proves reachable logs; the
    # landing position is probed for the anchor's light signature:
    #   normal = open sky at the landing (daylight light >= 14);
    #   hard   = the dark canopy base (light <= 7, historically log-bearing).
    # The scout holds DAY and keeps the bot vitals-topped: night mobs under the canopy
    # otherwise swamp the survey gather (measured). Raises when neither anchor can be
    # confirmed - the soak refuses unmeasurable anchors.
    api('connect',{});wait(lambda:api('state').get('connected'),90)
    scratch={'errors':[],'index':'scout'}
    reset_vitals(scratch)
    command('give BuilderBot minecraft:cooked_beef 6')
    command('effect give BuilderBot minecraft:resistance 900 2 true')
    # Hostiles spawn under the canopy in daylight. The old camelCase gamerule was
    # rejected, so confirm the 26.x name before any gather or the scout measures combat.
    command('gamerule spawn_mobs false')
    if not verify_rule('spawn_mobs',False):
        raise RuntimeError('anchor scout failed: spawn_mobs false was not confirmed')
    print('scout: spawn_mobs false confirmed',flush=True)
    found={}
    def hold_day():
        command('time set 1000')
    next_day=time.time()+30
    # hard: the base is the dark canopy - confirm light and reachability with one gather.
    # belowFoots matches the soak wood step (logs at standing height). Without it the job
    # locks onto the canopy top and spends the whole budget on "Cannot reach".
    command('tp BuilderBot %d %d %d'%(base[0],base[1],base[2]));time.sleep(3)
    for mob in ('zombie','husk','drowned','zombie_villager','skeleton','stray','bogged','creeper','spider','cave_spider','witch','phantom','pillager'):
        command('execute as BuilderBot at @s run kill @e[type=minecraft:%s,distance=..64]'%mob)
    o=api('observe');base_light=o.get('light')
    created=api('jobs',{'type':'gather','block':'log','count':3,'radius':32,'searchIfMissing':True,'belowFoots':True})
    t0=time.time();done=None
    while time.time()-t0<300 and not done:
        if time.time()>next_day:hold_day();next_day=time.time()+45
        time.sleep(3)
        done=next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status'] in ('complete','failed')),None)
    for leftover in api('state')['jobs']:
        if leftover['status'] in ('paused','queued','running'):api('cancel',{'id':leftover['id']})
    if done and done['status']=='complete':
        time.sleep(2);o=api('observe')
        found['hard']=[round(o['position']['x']),round(o['position']['y']),round(o['position']['z'])]
        found['hard_light']=base_light
        print('scout: HARD anchor confirmed (gather completed, canopy light '+str(base_light)+') at '+json.dumps(found['hard']),flush=True)
    if 'hard' not in found and not MEASURED:
        # A new seed's spawn may have no reachable wood (ocean, desert, a cliff): walk out with
        # explore legs and take the first stand where a log gather completes, any light.
        for dist,dirs in ((64,('east','south','west','north')),(112,('south','east','north','west'))):
            for dirn in dirs:
                try:
                    reset_vitals(scratch);hold_day();next_day=time.time()+45
                    command('effect give BuilderBot minecraft:resistance 300 2 true')
                    created=api('jobs',{'type':'explore','direction':dirn,'distance':dist})
                    t0=time.time()
                    while time.time()-t0<240:
                        if time.time()>next_day:hold_day();next_day=time.time()+45
                        time.sleep(3)
                        j=next((j for j in api('state')['jobs'] if j['id']==created['id']),None)
                        if j and j['status'] in ('complete','failed'):break
                    time.sleep(2);o=api('observe');leg_light=o.get('light')
                    created=api('jobs',{'type':'gather','block':'log','count':3,'radius':48,'searchIfMissing':True,'belowFoots':True})
                    t0=time.time();done=None
                    while time.time()-t0<300 and not done:
                        if time.time()>next_day:hold_day();next_day=time.time()+45
                        time.sleep(3)
                        done=next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status'] in ('complete','failed')),None)
                    for leftover in api('state')['jobs']:
                        if leftover['status'] in ('paused','queued','running'):api('cancel',{'id':leftover['id']})
                    if done and done['status']=='complete':
                        time.sleep(2);o=api('observe')
                        found['hard']=[round(o['position']['x']),round(o['position']['y']),round(o['position']['z'])]
                        found['hard_light']=leg_light
                        print('scout: HARD anchor confirmed (explore leg '+dirn+' '+str(dist)+', gather completed, light '+str(leg_light)+') at '+json.dumps(found['hard']),flush=True)
                        break
                except Exception as e:
                    print('scout hard leg '+dirn+' '+str(dist)+' failed: '+str(e)[:90],flush=True)
            if 'hard' in found:break
    if 'hard' not in found:
        msg=(done or {}).get('message','timed out')
        raise RuntimeError('anchor scout failed: no hard-anchor gather completed ('+str(msg)[:140]+') - refusing unmeasurable anchors')
    # normal: seed 12345's dark forest stays shaded for hundreds of blocks, and explore
    # legs from the canopy fall into the ocean. These floor points were measured on this
    # seed (open sky, and a 1-log gather finished at the first). Still verified below:
    # light >= 12 and a completed gather, or the point is rejected. Count 1 / radius 24
    # is the gather that finished here; a radius-48 job locked onto a buried spruce.
    for guess in (((310,132,30),(332,129,30)) if MEASURED else ()):
        try:
            reset_vitals(scratch);hold_day()
            command('effect give BuilderBot minecraft:resistance 300 2 true')
            command('tp BuilderBot %d %d %d'%guess);time.sleep(2)
            for mob in ('zombie','husk','drowned','zombie_villager','skeleton','stray','bogged','creeper','spider','cave_spider','witch','phantom','pillager'):
                command('execute as BuilderBot at @s run kill @e[type=minecraft:%s,distance=..64]'%mob)
            o=api('observe')
            if (o.get('light') or 0)<12:
                print('scout surface '+json.dumps(guess)+' light '+str(o.get('light'))+' - not open sky',flush=True)
                continue
            # The anchor is this open-sky standing spot. The gather may step under a trunk
            # (light 0) to take the log; that must not reject a spot whose own light was >= 12.
            spot=[round(o['position']['x']),round(o['position']['y']),round(o['position']['z'])]
            spot_light=o.get('light')
            created=api('jobs',{'type':'gather','block':'log','count':1,'radius':24,'searchIfMissing':False,'openSky':True})
            t0=time.time();done=None
            while time.time()-t0<180 and not done:
                if time.time()>next_day:hold_day();next_day=time.time()+45
                time.sleep(3)
                done=next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status'] in ('complete','failed')),None)
            for leftover in api('state')['jobs']:
                if leftover['status'] in ('paused','queued','running'):api('cancel',{'id':leftover['id']})
            if done and done['status']=='complete':
                found['normal']=spot
                found['normal_light']=spot_light
                print('scout: NORMAL anchor confirmed (open sky '+str(spot_light)+', gather completed) at '+json.dumps(found['normal']),flush=True)
                break
            msg=(done or {}).get('message','timed out')
            print('scout surface '+json.dumps(guess)+' gather did not complete: '+str(msg)[:140],flush=True)
        except Exception as e:
            print('scout surface '+json.dumps(guess)+' failed: '+str(e)[:90],flush=True)
    # normal fallback: walk outward with explore legs; at each, a bounded gather proves open-sky logs.
    if 'normal' not in found:
        for dist,dirs in ((64,('east','south','west','north')),(112,('south','east','north','west'))):
            for dirn in dirs:
                try:
                    reset_vitals(scratch);hold_day();next_day=time.time()+45
                    command('effect give BuilderBot minecraft:resistance 300 2 true')
                    created=api('jobs',{'type':'explore','direction':dirn,'distance':dist})
                    t0=time.time()
                    while time.time()-t0<240:
                        if time.time()>next_day:hold_day();next_day=time.time()+45
                        time.sleep(3)
                        j=next((j for j in api('state')['jobs'] if j['id']==created['id']),None)
                        if j and j['status'] in ('complete','failed'):break
                    time.sleep(2)
                    o=api('observe')
                    if (o.get('light') or 0)<12:continue # research: sky light >= 12 = unobstructed sky
                    created=api('jobs',{'type':'gather','block':'log','count':3,'radius':48,'searchIfMissing':True,'openSky':True})
                    t0=time.time();done=None
                    while time.time()-t0<300 and not done:
                        if time.time()>next_day:hold_day();next_day=time.time()+45
                        time.sleep(3)
                        done=next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status'] in ('complete','failed')),None)
                    for leftover in api('state')['jobs']:
                        if leftover['status'] in ('paused','queued','running'):api('cancel',{'id':leftover['id']})
                    if done and done['status']=='complete':
                        time.sleep(2);o=api('observe')
                        found['normal']=[round(o['position']['x']),round(o['position']['y']),round(o['position']['z'])]
                        found['normal_light']=o.get('light')
                        print('scout: NORMAL anchor confirmed (open sky '+str(o.get('light'))+', gather completed) at '+json.dumps(found['normal']),flush=True)
                        break
                except Exception as e:
                    print('scout leg '+dirn+' '+str(dist)+' failed: '+str(e)[:90],flush=True)
                if 'normal' in found:break
            if 'normal' in found:break
    if 'normal' not in found:
        raise RuntimeError('anchor scout failed: no open-sky spot with reachable logs found - refusing unmeasurable anchors')
    return found['normal'],found['hard']

    if 'normal' not in found or 'hard' not in found:
        raise RuntimeError('anchor scout failed: confirmed '+json.dumps(found)+' - refusing to soak unmeasurable anchors')
    return found['normal'],found['hard']

def wait_job(created,seconds):
    deadline=time.time()+seconds
    while time.time()<deadline:
        time.sleep(3)
        try:
            for leftover in api('state')['jobs']:
                if leftover['status']=='paused' and str(leftover.get('message','')).startswith(('Bot died','Preempted by')):api('cancel',{'id':leftover['id']})
            j=next((j for j in api('state')['jobs'] if j['id']==created['id']),None)
            if j and j['status'] in ('complete','failed'):
                if j['status']=='failed':raise RuntimeError(j['message'][:90])
                return
        except TimeoutError:raise
        except RuntimeError:raise
def verify_rule(name,value):
    # (research 1) 26.x renamed game rules to snake_case (spawn_mobs, advance_time,
    # advance_weather); the old camelCase names are rejected. Query the rule back and
    # confirm from the server log; fail-closed (returns False) when not verifiable.
    mark=len(re.sub(r'\[[0-9;]*[A-Za-z]','',pathlib.Path(ROOT/'logs/test-server.log').read_text(encoding='utf-8',errors='replace')))
    try:command('gamerule '+name)
    except Exception as e:print('verify_rule '+name+' send failed: '+str(e)[:80],flush=True);return False
    deadline=time.time()+8
    while time.time()<deadline:
        text=re.sub(r'\[[0-9;]*[A-Za-z]','',pathlib.Path(ROOT/'logs/test-server.log').read_text(encoding='utf-8',errors='replace'))[mark:]
        # 26.x prints "Game rule <name> is currently set to <value>" (two words).
        m=re.search(r'Game ?rule '+re.escape(name)+r' is currently set to (\S+)',text)
        if m:return m.group(1).lower()==str(value).lower()
        time.sleep(.5)
    return False
def apply_rules(mode):
    # normal: frozen deterministic daylight+clear (verified fail-closed), ANIMALS on and
    # monster spawning off (GLM_CONTINUE M4: spawn_mobs false also stops animals, which
    # starved the food step - 26.x splits the rules). hard: natural time/weather AND
    # natural spawning from a confirmed dawn (the first night must be survived with real
    # mobs); the dark-canopy hostiles that forced spawn_mobs false are exactly what the
    # night milestone has to measure now that wood/stone are reliable (M2/M3 met).
    ok=True
    command('gamerule spawn_mobs true')
    if not verify_rule('spawn_mobs',True):ok=False;print('RULE NOT CONFIRMED: spawn_mobs',flush=True)
    if mode=='normal':
        command('gamerule spawn_monsters false')
        if not verify_rule('spawn_monsters',False):ok=False;print('RULE NOT CONFIRMED: spawn_monsters',flush=True)
        for name,value in (('advance_time',False),('advance_weather',False)):
            command('gamerule '+name+' '+str(value).lower())
            if not verify_rule(name,value):ok=False;print('RULE NOT CONFIRMED: '+name,flush=True)
        command('time set 1000');command('weather clear 1200000000')
    else:
        command('gamerule spawn_monsters true')
        if not verify_rule('spawn_monsters',True):ok=False;print('RULE NOT CONFIRMED: spawn_monsters',flush=True)
        # Normal runs freeze the clock. This branch is the hard/dawn call, and it used to
        # leave advance_time false, so a 1250s hard run stayed at daytime and never
        # submitted a [night] job (soak 2026-10-14, tod_end day on all three hard runs).
        for name,value in (('advance_time',True),('advance_weather',True)):
            command('gamerule '+name+' '+str(value).lower())
            if not verify_rule(name,value):ok=False;print('RULE NOT CONFIRMED: '+name,flush=True)
        command('time set 1000');command('weather clear')
    return ok
def restore_rules():
    for name,value in (('advance_time',True),('advance_weather',True),('spawn_mobs',True),('spawn_monsters',True)):
        command('gamerule '+name+' '+str(value).lower())
    print('game rules restored (advance_time/advance_weather/spawn_mobs/spawn_monsters true)',flush=True)

def main():
    print('stopping services',flush=True)
    subprocess.run(['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'Stop-Agent.ps1')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=300)
    stop_services()
    print('switching to agent-soak-world',flush=True)
    edit_props({'level-name':'agent-soak-world','level-seed':'' if WORLD_COPY else SEED,'level-type':'normal','difficulty':'normal'})
    if WORLD_COPY:print('soak world copy '+WORLD_COPY+' (anchors scouted from spawn)',flush=True)
    else:print('soak seed '+SEED+(' (measured anchors)' if MEASURED else ' (anchors scouted from spawn)'),flush=True)
    # Every soak starts from VIRGIN terrain: delete the soak world entirely and let the
    # server regenerate it from the pinned seed. Previous soaks dug out every reachable
    # trunk around the anchor, which would make later soaks - and later runs within one
    # soak - measure the leftovers instead of the ladder. The seed regenerates the same
    # terrain, so the measured anchor coordinates stay valid. Services are stopped here,
    # so the files are not in use. The flat agent-test-world is never touched.
    world=(ROOT/'test-server'/'agent-soak-world')
    if world.exists():
        shutil.rmtree(world);print('removed the old agent-soak-world'+('' if WORLD_COPY else ' (regenerating from seed)'),flush=True)
    # Round 68 (round-67: data/storage.json still held round 66's chests at 211,78,240 - another
    # world): the bot's world memory starts empty with the world (the storage index, the
    # autopilot's home and the earned ledger), kept aside as .prev for reading.
    for name,empty in (('storage.json','{"chests": []}'),('autopilot.json','{}'),('ledger.json','{}')):
        f=ROOT/'data'/name
        try:
            if f.exists():shutil.copyfile(f,f.with_name(name+'.prev'))
            f.write_text(empty,encoding='utf-8')
        except Exception as e:print('could not reset data/'+name+': '+str(e)[:80],flush=True)
    print('reset the bot world memory (storage, home, ledger)',flush=True)
    if WORLD_COPY:
        src=pathlib.Path(WORLD_COPY).resolve()
        if not (src/'level.dat').exists():raise RuntimeError('SOAK_WORLD has no level.dat: '+WORLD_COPY)
        if LIVE_SERVERS.resolve() in src.parents:raise RuntimeError('SOAK_WORLD must be a copy, not a live server world: '+WORLD_COPY)
        shutil.copytree(src,world,ignore=shutil.ignore_patterns('session.lock','players'))
        print('copied the soak world from '+WORLD_COPY,flush=True)
    print('starting services (fresh world generation takes a while)',flush=True)
    subprocess.Popen(['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'Start-Agent.ps1'),'-NoBrowser'],cwd=str(ROOT),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    wait_dashboard();wait_server()
    # No mob spawning during the soak window: under dark-forest canopy the light stays low
    # enough for hostile spawns around the clock, and a naked pre-wood bot cannot survive
    # them - that would measure combat, not the ladder this soak is about.
    # (research 1) 26.x renamed the game rules (spawn_mobs/advance_time/advance_weather);
    # the old camelCase names are rejected. Each anchor's mode applies and VERIFIES its own
    # rules fail-closed below. (review 3) TWO anchors, 3 runs each, reported separately:
    # 'hard' = the dark-forest canopy clearing (progression under mob pressure), 'normal' =
    # an open-sky grove edge scouted live on the same seed (progression apart from survival).
    # canopy clearing (progression under mob pressure), 'normal' = an open-sky grove edge
    # scouted live on the same seed (progression measured apart from survival).
    runs=[]
    payload=None
    clean=False
    try:
        api('connect',{});wait(lambda:api('state').get('connected'),90)
        command('time set 0');command('weather clear 1000000');time.sleep(3)
        if MEASURED:base=ANCHOR
        else:
            o=api('observe');base=[round(o['position']['x']),round(o['position']['y']),round(o['position']['z'])]
            print('scout base: the spawn at '+json.dumps(base),flush=True)
        normal_anchor,hard_anchor=scout_anchors(base)
        runs=[]
        attempts={'normal':0,'hard':0}
        done={'normal':0,'hard':0}
        for label,anchor in (('normal',normal_anchor),('hard',hard_anchor)):
            # normal: frozen daylight+clear, VERIFIED fail-closed (research 1). hard: natural
            # time/weather from a confirmed dawn. spawn_mobs stays false for both.
            if not apply_rules('normal' if label=='normal' else 'dawn'):
                runs.append({'index':label+'-rules','invalid':'game rules not verifiable','errors':[]})
                print('--- '+label+' rules not confirmable: runs for this anchor are INVALID',flush=True)
                continue
            while done[label]<3 and attempts[label]<5:
                attempts[label]+=1
                # GLM_CONTINUE item 3: hard runs span 20+ minutes so dusk/night happen and
                # the bed/shelter first night is measured with natural spawning. Normal runs
                # keep the frozen day and run NORMAL_SECONDS (2400) so the rung after the
                # iron pickaxe is measured too.
                r=run_one(label+str(done[label]+1)+'a'+str(attempts[label]),anchor,seconds=HARD_SECONDS if label=='hard' else NORMAL_SECONDS)
                runs.append(r)
                if r.get('invalid'):
                    print('--- '+label+' attempt '+str(attempts[label])+' was INVALID (setup unconfirmed); not counted',flush=True)
                    continue
                done[label]+=1
        if done['normal']<3 or done['hard']<3:
            print('WARNING: fewer than 3 valid runs per anchor: '+json.dumps({'normal':done['normal'],'hard':done['hard']}),flush=True)
        valid=[r for r in runs if not r.get('invalid')]
        payload={'runs':runs,'summary':summarise(valid),'errors':[e for r in valid for e in r['errors']],
                 'invalid_attempts':[{'index':r.get('index'),'reason':r.get('invalid')} for r in runs if r.get('invalid')],
                 'anchors':{'hard':hard_anchor,'normal':normal_anchor},'world':WORLD_COPY or ('seed '+SEED)}
        clean=save_results(payload)
    finally:
        # Always put the flat test world back, including when a run or the supervisor dies.
        try:restore_rules()
        except Exception as e:print('restore_rules failed: '+str(e)[:120],flush=True)
        print('stopping services and restoring agent-test-world',flush=True)
        subprocess.run(['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'Stop-Agent.ps1')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=300)
        stop_services()
        edit_props({'level-name':'agent-test-world','level-seed':'','level-type':'minecraft\\:flat','difficulty':'peaceful'})
        print('note: agent-soak-world keeps spawn_mobs false for future soaks',flush=True)
        print('soak complete; restarting the flat world services',flush=True)
        subprocess.Popen(['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'Start-Agent.ps1'),'-NoBrowser'],cwd=str(ROOT),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:wait_dashboard()
        except Exception as e:print('dashboard did not return: '+str(e)[:120],flush=True)
    if payload:
        print('SOAK DONE','(clean)' if clean else '(with errors)')
        print('SUMMARY '+json.dumps(payload['summary'],indent=1),flush=True)
        print('RUNGS (seconds from the run start; - = never)\n'+rung_table([r for r in runs if not r.get('invalid')]),flush=True)
        for r in runs:
            print(f"run {r['index']}: wood={r.get('wood')} stone={r.get('stone')} iron={r.get('iron')} achieved={json.dumps(r.get('achieved',{}))}",flush=True)
if __name__=='__main__':main()
