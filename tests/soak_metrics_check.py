"""Offline check of tests/soak.py's food metric (no server needed): python tests/soak_metrics_check.py"""
import importlib.util,pathlib
spec=importlib.util.spec_from_file_location('soak',str(pathlib.Path(__file__).resolve().parent/'soak.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
run={'meals_mark':{'eaten':2,'points':10,'cooked':3,'items':{'cooked_beef':2}}}
d=m.meals_delta({'meals':{'eaten':5,'points':22,'cooked':7,'items':{'cooked_beef':3,'cooked_chicken':2}}},run)
assert d=={'eaten':3,'points':12,'cooked':4,'items':{'cooked_beef':1,'cooked_chicken':2},'due':0,'failed':0,'no_food':0,'attempts':0,'deferred':0,'ok':0,'last_error':None,'last_deferred':None},d
d=m.meals_delta({'meals':{'eaten':1,'points':6,'cooked':0,'items':{'bread':1}}},run) # dashboard restarted
assert d['eaten']==1 and d['points']==6 and d['cooked']==0,d
d=m.meals_delta({},{} )
assert d=={'eaten':0,'points':0,'cooked':0,'items':{},'due':0,'failed':0,'no_food':0,'attempts':0,'deferred':0,'ok':0,'last_error':None,'last_deferred':None},d
# Round 6: due/failed (FoodChain) say whether 'eaten 0' is a full bar or a broken eat path.
d=m.meals_delta({'meals':{'eaten':0,'due':3,'failed':2,'lastError':'consume timed out'}},{'meals_mark':{'due':1,'failed':0}})
assert d['due']==2 and d['failed']==2 and d['last_error']=='consume timed out',d
assert m.meals_delta({'meals':{'failed':1,'lastError':'old'}},{'meals_mark':{'failed':1}})['last_error'] is None
lv=m.food_level([{'food':20,'sat':5.0},{'food':13,'sat':0.0},{'food':17},{'hp':20}])
assert lv=={'food_min':13,'food_max':20,'sat_min':0.0,'food_min_held':None},lv
assert m.food_level([])=={'food_min':None,'food_max':None,'sat_min':None,'food_min_held':None}
lv={'food_min':15,'food_max':20,'sat_min':0.0}
assert m.food_verdict({'meals':{'eaten':1},'food_level':lv})=='ate 1'
assert m.food_verdict({'meals':{'eaten':0,'due':0},'food_level':lv,'edible_peak':8})=='not hungry enough (food min 15)'
# Round 8: the eat threshold is 14 - a bar of 13 with food held and nothing due is the chain never asking.
assert m.FOOD_EAT_AT==14
assert m.food_verdict({'meals':{'eaten':0,'due':0},'food_level':{'food_min':13},'edible_peak':8}).startswith('EAT FAILED: never attempted')
v=m.food_verdict({'meals':{'eaten':0,'due':2,'failed':2,'attempts':2,'last_error':'no cooked_beef stack in the inventory'},'food_level':{'food_min':9},'edible_peak':8})
assert v.startswith('attempted and failed: no cooked_beef stack'),v
assert m.food_verdict({'meals':{'eaten':0},'food_level':{'food_min':6},'edible_peak':0})=='no food held (food min 6)'
assert m.food_verdict({'meals':{'eaten':0},'food_level':{'food_min':8},'edible_peak':7}).startswith('EAT FAILED: never attempted'),'hungry, food held, never due: the chain never asked'
# Round 7: normal2 fell to 5 with `due 1, failed 0` and no food held at the low (cooked 0).
lv7=m.food_level([{'food':16,'food_items':2},{'food':9,'food_items':0},{'food':5,'food_items':0}])
assert lv7['food_min']==5 and lv7['food_min_held']==16,lv7
assert m.food_verdict({'meals':{'eaten':0,'due':1,'failed':0},'food_level':lv7,'edible_peak':2})=='no food held (food min 5)'
assert m.food_verdict({'meals':{'eaten':0,'due':1,'failed':0,'no_food':1},'food_level':{'food_min':5},'edible_peak':2})=='no food held (food min 5)'
assert m.meals_delta({'meals':{'noFood':3}},{'meals_mark':{'noFood':1}})['no_food']==2
# food held at the low and the meal failed: attempted and failed, with the reason
lv8=m.food_level([{'food':8,'food_items':4}])
v=m.food_verdict({'meals':{'eaten':0,'due':3,'failed':4,'last_error':'Promise timed out. (2 tries)'},'food_level':lv8,'edible_peak':4})
assert v.startswith('attempted and failed: Promise timed out. (2 tries) (due 3, failed 4'),v
v=m.food_verdict({'meals':{'eaten':0,'due':3,'failed':4,'last_error':'x'},'food_level':{'food_min':15},'edible_peak':4})
assert v.startswith('attempted and failed'),'a failed meal is never "not hungry enough"'
assert m.food_verdict({'meals':{'eaten':2,'failed':1,'last_error':'x'},'food_level':lv8})=='ate 2 (1 failed: x)'
# Round 7's live line: bar 14, due 1, failed 0, food held -> never attempted, with the deferral reason when there is one.
v=m.food_verdict({'meals':{'eaten':0,'due':1,'failed':0,'attempts':0},'food_level':{'food_min':14,'food_min_held':14},'edible_peak':9})
assert v=='EAT FAILED: never attempted (due 1, failed 0, food min 14)',v
v=m.food_verdict({'meals':{'eaten':0,'due':1,'failed':0,'attempts':0,'last_deferred':'a window is open'},'food_level':{'food_min':16},'edible_peak':9})
assert v=='EAT FAILED: never attempted (last deferred: a window is open) (due 1, failed 0, food min 16)',v
d=m.meals_delta({'meals':{'attempts':4,'deferred':3,'lastDeferred':'mid-fight (Mob Defense active)'}},{'meals_mark':{'attempts':1,'deferred':3}})
assert d['attempts']==3 and d['deferred']==0 and d['last_deferred'] is None,d
runs=[{'food':True,'meals':{'eaten':2,'points':12,'cooked':3},'edible_peak':4,'achieved':{'edible_food':1},'interventions':[]},{'interventions':[]}]
runs[0]['meals'].update(due=2,failed=0);runs[0]['food_level']={'food_min':10,'food_max':20};runs[0]['food_verdict']='ate 2'
sm=m.summarise(runs)
assert sm['food_runs']==1 and sm['eaten']==[2,0] and sm['cooked']==[3,0] and sm['food_points']==[12,0],sm
assert sm['food_due']==[2,0] and sm['food_failed']==[0,0] and sm['food_min']==[10,None] and sm['food_max']==[20,None] and sm['food_verdict']==['ate 2',None],sm
assert sm['food_attempts']==[0,0] and sm['food_deferred']==[0,0],sm
# Iron columns (round 3): normal runs are long enough to reach the iron step now.
assert m.NORMAL_SECONDS==2400 # round 9: normal runs measure the rung after the iron pickaxe
assert m.HARD_SECONDS==int(m.os.environ.get('SOAK_HARD_SECONDS','2400')) # round 74: hard runs reach the furnace and iron too
assert m.iron_sample({'raw_iron':4,'iron_ingot':2,'iron_pickaxe':1})=={'iron_ore':4,'ingots':2,'iron_pick':1}
assert m.iron_sample({})=={'iron_ore':0,'ingots':0,'iron_pick':0}
samples=[{'t':30,'iron_ore':0,'ingots':0,'iron_pick':0},{'t':900,'iron_ore':6,'ingots':0,'iron_pick':0},
         {'t':960,'iron_ore':0,'ingots':6,'iron_pick':0},{'t':990,'iron_ore':0,'ingots':3,'iron_pick':1}]
im=m.iron_metrics(samples)
assert im=={'iron_ore_peak':6,'ingots_peak':6,'iron_pick_at':990,'iron':True},im
assert m.iron_metrics([])=={'iron_ore_peak':0,'ingots_peak':0,'iron_pick_at':None,'iron':False}
sm=m.summarise([{**im,'interventions':[]},{'interventions':[]}])
assert sm['iron_runs']==1 and sm['iron_ore_peak']==[6,0] and sm['ingots_peak']==[6,0] and sm['iron_pick_at']==[990,None],sm
assert sm['peak_median']['iron_pick']==0,sm['peak_median']
# Round 8 rung columns: armour held/worn, torches, bed, diamonds, the diamond pickaxe.
inv=m.merge_inventory({'inventory':[{'name':'cobblestone','count':64},{'name':'cobblestone','count':20},{'name':'torch','count':12},{'name':'iron_helmet','count':1},{'name':'red_bed','count':1}],
                       'equipment':[{'slot':'chest','name':'iron_chestplate','count':1},{'slot':'feet','name':'leather_boots','count':1},{'slot':'off-hand','name':'shield','count':1}]})
assert inv['cobblestone']==84,'every stack counts, not the last one'
assert inv['iron_chestplate']==1 and inv['_worn:iron_chestplate']==1 and inv['shield']==1 and '_worn:iron_helmet' not in inv,inv
assert m.merge_inventory({'inventory':[{'name':'stick','count':3}]})=={'stick':3},'no equipment key: older dashboards'
ks=m.kit_sample(inv)
assert ks=={'armour':2,'armour_worn':1,'torches':12,'bed':1,'diamonds':0,'diamond_pick':0},ks
assert m.kit_sample({})=={'armour':0,'armour_worn':0,'torches':0,'bed':0,'diamonds':0,'diamond_pick':0}
ksam=[{'t':30,**m.kit_sample({})},{'t':600,**ks},{'t':900,**m.kit_sample({**inv,'_worn:iron_helmet':1,'diamond':3})},{'t':960,**m.kit_sample({'diamond_pickaxe':1,'torch':5})}]
km=m.kit_metrics(ksam)
assert km=={'armour_peak':2,'armour_worn_peak':2,'armour_worn_at':600,'torch_peak':12,'bed_at':600,'diamond_peak':3,'diamond_pick_at':960},km
sm=m.summarise([{**km,'interventions':[]},{'interventions':[]}])
assert sm['armour_runs']==1 and sm['armour_worn_peak']==[2,0] and sm['torch_peak']==[12,0] and sm['bed_at']==[600,None] and sm['diamond_peak']==[3,0] and sm['diamond_pick_at']==[960,None],sm
assert all(k in sm['peak_median'] for k in m.KIT_KEYS),sm['peak_median']
print('soak food metric ok')
print('soak iron metric ok')
# Deaths (round 5): the server log, the bot counter and the event window; max of the three.
LOG='''[02:06:11] [Server thread/INFO]: BuilderBot was shot by Skeleton
[02:20:00] [Server thread/INFO]: <BuilderBot> I was shot earlier
[02:41:02] [Server thread/INFO]: BuilderBot was shot by Skeleton
[02:44:40] [Server thread/INFO]: BuilderBot was shot by Skeleton
[02:46:13] [Server thread/INFO]: BuilderBot drowned
[02:46:50] [Server thread/INFO]: BuilderBot lost connection: Timed out
[02:47:00] [Server thread/INFO]: BuilderBot left the game
[02:48:00] [Server thread/INFO]: BuilderBot joined the game
[02:49:00] [Server thread/INFO]: BuilderBot froze to death
[02:50:00] [Server thread/INFO]: BuilderBot suffocated in a wall
[02:51:00] [Server thread/INFO]: BuilderBot hit the ground too hard
[02:52:00] [Server thread/INFO]: BuilderBot tried to swim in lava to escape Zombie
'''
causes=m.log_deaths(LOG)
assert causes==['BuilderBot was shot by Skeleton']*3+['BuilderBot drowned','BuilderBot froze to death','BuilderBot suffocated in a wall','BuilderBot hit the ground too hard','BuilderBot tried to swim in lava to escape Zombie'],causes
# Round 4 hard3: the dashboard read failed; the log alone still counts both shots.
run={'deaths_mark':0,'bot_deaths_mark':5}
t=m.death_tally(run,None,'',LOG.splitlines()[0]+'\n'+LOG.splitlines()[2]+'\n')
assert t['deaths']==2 and t['log']==2,t
# The bot counter rises past a scrolled-out event window (window 1, counter 4, log 3).
run={'deaths_mark':1,'bot_deaths_mark':5,'deaths':0}
t=m.death_tally(run,{'deaths':9},'Bot died at 1, 2, 3 | Bot died at 4, 5, 6','\n'.join(LOG.splitlines()[:4]))
assert t['deaths']==4 and t['counter']==4 and t['window']==1 and t['log']==3,t
# A dashboard restart resets the counter: count from zero, never negative.
assert m.bot_deaths({'deaths':2},{'bot_deaths_mark':7})==2
assert m.bot_deaths({},{'bot_deaths_mark':7})==0
# Monotonic: an earlier higher count is never lowered by a later read.
assert m.death_tally({'deaths':3},None,'','')['deaths']==3
print('soak death metric ok')
# Round 9: round-8 normal1 ate twice (FoodChain logs) with the consume wrap counting nothing;
# the FoodChain's own 'ok' count makes that 'ate 2', and attempts at a bar > 14 are never 'never attempted'.
assert m.meals_delta({'meals':{'ok':5}},{'meals_mark':{'ok':3}})['ok']==2
assert m.food_verdict({'meals':{'eaten':0,'ok':2,'due':2,'attempts':2},'food_level':{'food_min':16},'edible_peak':9})=='ate 2'
v=m.food_verdict({'meals':{'eaten':0,'due':2,'failed':0,'attempts':2},'food_level':{'food_min':16},'edible_peak':9})
assert v=='attempted 2, no meal recorded (due 2, failed 0, food min 16)',v
print('round 9 food verdict ok')
# Round 9: the rung table prints one column per rung, '-' for never.
t=m.rung_table([{'index':'normal1a1','wood_at':60,'first':{'stone_pick':211,'furnace':301},'iron_pick_at':1020,'torch_peak':16,
                 'armour_worn_peak':2,'armour_worn_at':1500,'bed_at':None,'diamond_peak':0,'diamond_pick_at':None,'food_verdict':'ate 3','deaths':0},
                {'index':'hard2a2'}]).split('\n')
assert t[0].split(' | ')[0].strip()=='run' and 'armour worn' in t[0] and 'diamond pick' in t[0],t[0]
cells=[c.strip() for c in t[1].split(' | ')]
assert cells==['normal1a1','60','211','301','1020','16','2 at 1500','-','0','-','ate 3','0'],cells
assert [c.strip() for c in t[2].split(' | ')]==['hard2a2','-','-','-','-','0','0','-','0','-','-','0'],t[2]
print('round 9 rung table ok')
