"""Per-run counts and quoted lines for a soak round's report (docs/TEST_REPORTS.md).

    python tests/soak_report.py 102 logs/soak102-dash-slice.log
    python tests/soak_report.py 102 logs/soak102-dash-slice.log --results data/soak-results.json \
        --quote "Shelter: pinned" --max-quote 60

The dashboard log slice may carry no newline characters at all (logs/soak102-dash-slice.log
is one 355 KB line), so the file is split on the ISO timestamp that starts every dashboard
line; a line with no timestamp of its own (PACKET_RATE, "Dashboard ready at ...") stays glued
to the line before it, which is where the report counts it too.

Run windows come from the `Autopilot started` / `Autopilot stopped` marks: a window opens on a
`started` and closes on the next `stopped`; a `started` inside an open window (a hard run that
died and resumed) does not open a new one. Windows are paired in order with `runs` in the
soak-results JSON for the rung table. Everything else is a pattern count per run plus the
whole quoted lines, which is what the hand-built round-102 report assembled from
logs/analyze102.py (a one-off, git-ignored). Sections the script cannot produce are listed at
the end of its output.
"""
import argparse
import collections
import json
import re
import sys

TS_RE = re.compile(r'(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z(?: |$)')
SPLIT_RE = re.compile(r'(?=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z )')

# (label, substring). Order is the order of the report's sections, newest fix first.
PATTERNS = [
    # round-102 fix (roof exit for boxes held past dawn)
    ('Shelter: pinned', 'Shelter: pinned '),
    ('climbing out through the roof', 'climbing out through the roof'),
    ('could not climb out; holding the box', 'could not climb out; holding the box'),
    ('held past dawn by', 'held past dawn by'),
    ('around the box as it opens', 'around the box as it opens'),
    # shelter
    ('Shelter: dawn', 'Shelter: dawn'),
    ('Shelter: morning', 'Shelter: morning'),
    ('morning in a cave', 'morning in a cave'),
    ('opening up', 'opening up'),
    ('keeping the walls up', 'keeping the walls up'),
    ('opening the walls', 'opening the walls'),
    ('Shelter: sealed at', 'Shelter: sealed at'),
    ('Shelter: re-sealing', 'Shelter: re-sealing'),
    ('Job time limit reached', 'Job time limit reached'),
    ('Short of shelter blocks', 'Short of shelter blocks'),
    ('Ascend: y=', 'Ascend: y='),
    ('Ascend: no sky', 'Ascend: no sky'),
    ('Ascend: head sky', 'Ascend: head sky'),
    ('Ascend: no path up', 'Ascend: no path up'),
    ('Ascend: out under cover', 'out under cover'),
    ('Ascend: pillared', 'Ascend: pillared'),
    # round-101 fix (turning)
    ('Bag run: no path', 'Bag run: no path'),
    ('Bag run: turning', 'Bag run: turning'),
    # bag runs
    ('Autopilot [bag]', 'Autopilot [bag]'),
    ('Bag run: walking', 'Bag run: walking'),
    ('Bag run: at the death', 'Bag run: at the death'),
    ('Bag run: no drops picked up', 'no drops picked up'),
    ('Bag run: skipped', 'Bag run: skipped'),
    ('Bag run: too late', 'Bag run: too late'),
    ('Bag run: out of time', 'Bag run: out of time'),
    ('Bag run: given up', 'Bag run: given up'),
    ('Bag run: stopped', 'Bag run: stopped'),
    ('paused bagrun job was superseded', 'paused bagrun job was superseded'),
    ('Reflex: resumed the bagrun', 'Reflex: resumed the bagrun'),
    ('bag: waiting on a reflex', 'bag: waiting on a reflex'),
    # reflex / combat
    ('Reflex: fleeing creeper', 'Reflex: fleeing creeper'),
    ('Reflex: fleeing witch', 'Reflex: fleeing witch'),
    ('blocking its line of sight', 'blocking its line of sight'),
    ('witch cover is done', 'witch cover is done'),
    ('followed for N s', 'followed for'),
    ('keeping 20 away', 'keeping 20 away'),
    ('closed to', 'closed to'),
    ('Combat: pillar-up', 'pillar-up'),
    ('Fight result: creeper', 'Fight result: creeper'),
    ('Reflex: creeper fuse', 'Reflex: creeper fuse'),
    ('fuse wall is done', 'fuse wall is done'),
    ('cornered - fighting back', 'cornered - fighting back'),
    ('overrides the shelter hold', 'overrides the shelter hold'),
    ('with the box open; Mob Defense answers', 'with the box open; Mob Defense answers'),
    ('after a night respawn; Mob Defense answers', 'after a night respawn; Mob Defense answers'),
    ('on the night mine; Mob Defense answers', 'on the night mine; Mob Defense answers'),
    ('eating through the creeper keep-away', 'eating through the creeper keep-away'),
    ('Reflex: the creeper', 'Reflex: the creeper'),
    ('has kept the bot in one spot', 'has kept the bot in one spot'),
    ('held 20 s without moving', 'held 20 s without moving'),
    ('still recovering', 'still recovering'),
    ('COMBAT_SPEC', 'COMBAT_SPEC'),
    # deaths
    ('Bot died', 'Bot died at'),  # the death line itself, not the pause-trace echoes
    ('Death: health', 'Death: health'),
    ('was slain by', 'was slain by'),
    ('was shot by', 'was shot by'),
    ('blown up by', 'blown up by'),
    ('killed by Witch', 'killed by Witch'),
    ('drowned', 'drowned'),
    # navigation
    ('Navigation left the surface', 'Navigation left the surface'),
    ('Job: Navigation left the surface', 'Job: Navigation left the surface'),
    ('no path from the canopy', 'no path from the canopy'),
    ('down from the canopy', 'down from the canopy'),
    ('still stranded', 'still stranded'),
    ('digging down instead', 'digging down instead'),
    ('Pillar: no rise', 'Pillar: no rise'),
    ('Pillar: stopped', 'Pillar: stopped'),
    ('No path to the goal', 'No path to the goal'),
    ('Job: no path', 'Job: no path'),
    ('no path with mob avoidance', 'no path with mob avoidance'),
    ('Took to long to decide path', 'Took to long to decide path'),
    ('Cannot reach', 'Cannot reach'),
    ('No matching blocks within the allowed radius', 'No matching blocks within the allowed radius'),
    ('searching 320', 'searching 320'),
    ('Boxed in', 'Boxed in'),
    ('blocked under rock', 'blocked under rock'),
    ('A suitable harvesting tool is required', 'A suitable harvesting tool is required'),
    ('Tunnel needs a suitable tool', 'Tunnel needs a suitable tool'),
    ('Health or food is low', 'Health or food is low'),
    # gathers
    ('Gather: skipping', 'Gather: skipping'),
    ('Gather: skipping *_log', re.compile(r'Gather: skipping \w+_log ')),
    ('Gather: search leg', 'Gather: search leg'),
    # wood explores
    ('wood failed 3 times', 'wood failed 3 times'),
    ('the wood explore heads', 'the wood explore heads'),
    ('Water: no dry stand', 'Water: no dry stand'),
    ('no way to stair out', 'no way to stair out'),
    ('no path for explore', 'no path for explore'),
    ('no path for gather log', 'no path for gather log'),
    # water / air
    ('Water: head under', 'Water: head under'),
    ('drowning (air', 'drowning (air'),
    ('air falling', 'air falling'),
    ('no rise in 3 s swimming up', 'no rise in 3 s swimming up'),
    ('open water', 'open water'),
    ('head in a wall', 'head in a wall'),
    ('roof over the water', 'roof over the water'),
    ('breathing here', 'breathing here'),
    ('centring to', 'centring to'),
    # lava
    ('in lava', 'in lava'),
    ('Lava guard', 'Lava guard'),
    ('tried to swim in lava', 'tried to swim in lava'),
    ('Lava:', 'Lava:'),
    # food / meals
    ('Food: meal failed', 'Food: meal failed'),
    ('food step set aside', 'food step set aside'),
    ('Food: ate', 'Food: ate'),
    # falls
    ('Fall:', 'Fall:'),
    ('Ledge guard', 'Ledge guard'),
    # windows / tools / misc
    ('Window: closed a stale', 'Window: closed a stale'),
    ('PACKET_RUNAWAY window_click', 'PACKET_RUNAWAY window_click'),
    ('PACKET_RATE', 'PACKET_RATE'),
    ('Runner: closed the open crafting window', 'Runner: closed the open crafting window'),
    ('Tool left the inventory', 'Tool left the inventory'),
    ('Tool broke', 'broke)'),
    ('Craft: keeping the spare', 'Craft: keeping the spare'),
    ('Craft: dropped the', 'Craft: dropped the'),
    ('came back into the inventory', 'came back into the inventory'),
    ('the bag is full', 'the bag is full'),
    ('Unknown item', 'Unknown item'),
    ('invalid operation', 'invalid operation'),
    ('keepalive', 'keepalive'),
    ('Disconnected', 'Disconnected'),
    ('kicked', 'kicked'),
    ('Uncaught', 'ncaught'),
    # beds / respawn / night
    ('Autopilot [night]', 'Autopilot [night]'),
    ('Respawn point set', 'Respawn point set'),
    ('home set to the bed', 'ome set to the bed'),
    ('a bed here would put the respawn point', 'a bed here would put the respawn point'),
    ('deaths within 24 of the bed', 'deaths within 24 of the bed'),
    ('home cleared', 'home cleared'),
    ('could not break the bed', 'could not break the bed'),
    ('Picked the bed back up', 'Picked the bed back up'),
    ('Sleeping through this night', 'Sleeping through this night'),
    ('_bed craft', re.compile(r'"item":"\w+_bed"')),
    ('Night mine:', 'Night mine:'),
    ('filled the sump', 'filled the sump'),
    ('could not fill the sump', 'could not fill the sump'),
    ('pillaring up the sump', 'pillaring up the sump'),
    ('Tunnel climb:', 'Tunnel climb:'),
    ('not from a box with', 'not from a box with'),
    ('open cells', 'open cells'),
    ('re-seal left', 're-seal left'),
    ('Shelter: moved from', 'Shelter: moved from'),
    ('silverfish', 'silverfish'),
    ('preempted by Misc World Survival Chain', 'preempted by Misc World Survival Chain'),
    # storage / stores
    ('Store:', 'Store:'),
    ('home chest', 'home chest'),
    ('Smelt:', 'Smelt:'),
    ('deposit job', '"type":"deposit"'),
    ('produced no water bucket', 'produced no water bucket'),
    # superseded / resumes
    ('superseded; cancelled', 'superseded; cancelled'),
    ('Reflex: resumed the', 'Reflex: resumed the'),
    # ladder steps
    ('Autopilot [iron]', 'Autopilot [iron]'),
    ('Autopilot [armour]', 'Autopilot [armour]'),
    ('Autopilot [diamond', 'Autopilot [diamond'),
    ('Autopilot [bed', 'Autopilot [bed'),
    ('Autopilot [food]', 'Autopilot [food]'),
    ('Autopilot [inventory]', 'Autopilot [inventory]'),
    ('Movement: sprinting', 'Movement: sprinting'),
    # harness
    ('setup fill', 'setup fill'),
    ('suffocated', 'suffocated'),
    ('Server set position', 'Server set position'),
]

# Patterns whose whole lines are always quoted (the report quotes these by hand).
QUOTE_ALWAYS = {
    'Shelter: pinned', 'climbing out through the roof', 'could not climb out; holding the box',
    'held past dawn by', 'around the box as it opens', 'Shelter: dawn', 'Shelter: morning',
    'keeping the walls up', 'opening the walls', 'Shelter: sealed at', 'Shelter: re-sealing',
    'Job time limit reached', 'Short of shelter blocks', 'Ascend: y=', 'Ascend: no sky',
    'Ascend: head sky', 'Ascend: no path up', 'Ascend: out under cover', 'Bag run: no path',
    'Bag run: turning', 'Autopilot [bag]', 'Bag run: walking', 'Bag run: at the death',
    'Bag run: no drops picked up', 'Bag run: skipped', 'Bag run: too late', 'Bag run: out of time',
    'Bag run: given up', 'Bag run: stopped', 'Reflex: resumed the bagrun', 'Reflex: fleeing witch',
    'blocking its line of sight', 'witch cover is done', 'closed to', 'Combat: pillar-up',
    'Fight result: creeper', 'Reflex: creeper fuse', 'fuse wall is done', 'cornered - fighting back',
    'overrides the shelter hold', 'with the box open; Mob Defense answers',
    'after a night respawn; Mob Defense answers', 'on the night mine; Mob Defense answers',
    'Reflex: the creeper', 'held 20 s without moving', 'still recovering', 'COMBAT_SPEC', 'Bot died',
    'Death: health', 'was slain by', 'was shot by', 'blown up by', 'killed by Witch',
    'Job: Navigation left the surface', 'no path from the canopy', 'down from the canopy',
    'still stranded', 'digging down instead', 'Pillar: no rise', 'Pillar: stopped', 'Job: no path',
    'blocked under rock', 'Gather: skipping *_log', 'Gather: search leg', 'wood failed 3 times',
    'the wood explore heads', 'Water: no dry stand', 'no way to stair out', 'Water: head under',
    'drowning (air', 'air falling', 'no rise in 3 s swimming up', 'head in a wall',
    'roof over the water', 'in lava', 'Lava guard', 'tried to swim in lava', 'Food: meal failed',
    'food step set aside', 'Fall:', 'Ledge guard', 'Window: closed a stale',
    'PACKET_RUNAWAY window_click', 'Runner: closed the open crafting window', 'Tool broke',
    'Craft: keeping the spare', 'Unknown item', 'invalid operation', 'Uncaught', 'Autopilot [night]',
    'Respawn point set', 'home set to the bed', 'a bed here would put the respawn point',
    'deaths within 24 of the bed', 'home cleared', 'could not break the bed', 'Picked the bed back up',
    'Sleeping through this night', '_bed craft', 'Night mine:', 'filled the sump',
    'could not fill the sump', 'pillaring up the sump', 'Tunnel climb:', 'not from a box with',
    'open cells', 're-seal left', 'silverfish', 'Store:', 'home chest', 'produced no water bucket',
    'Autopilot [armour]', 'Autopilot [diamond', 'Autopilot [bed', 'Autopilot [food]',
    'Movement: sprinting', 'setup fill', 'suffocated',
}

CANNOT_PRODUCE = [
    'the harness tee (logs/soak-roundNNN.log): SOAK lines, scout anchors, operator night-skip lines, '
    'run summaries and run lengths - pass the tee through rg instead',
    'the server log slice (logs/test-server.log): kicks, moved wrongly, ERROR lines, SG-1 mentions',
    'data/obstruction-results.json and the obstruct table (run tests/obstruct.py separately)',
    'data/storage.json and data/ledger.json contents (cat them)',
    'the pre-soak restart lines (supervisor log, port checks, model-off line)',
    'the unit-test counts and the +N test delta between rounds',
    'the hand-written readings: which mob stood under rock, why a hold ended, what the storm did, '
    'the comparisons with earlier rounds - the script prints the lines, the writer reads them',
]


def ts_seconds(line):
    m = TS_RE.match(line)
    if not m:
        return None
    y, mo, d, hh, mm, ss, ms = (int(g) for g in m.groups())
    # days since an arbitrary epoch is enough; the slice spans at most two days
    day = (y * 372 + mo * 31 + d)
    return day * 86400 + hh * 3600 + mm * 60 + ss + ms / 1000.0


def ts_text(line):
    m = TS_RE.match(line)
    return m.group(0).strip() if m else '(no timestamp)'


def read_lines(path):
    raw = open(path, 'rb').read().decode('utf-8', 'replace')
    if '\n' in raw:
        lines = []
        for ln in raw.split('\n'):
            # a newline-separated file can still carry glued lines; split those too
            lines.extend(p for p in SPLIT_RE.split(ln) if p.strip())
        return lines
    return [p for p in SPLIT_RE.split(raw) if p.strip()]


def run_windows(lines):
    windows = []
    cur = None
    for ln in lines:
        t = ts_seconds(ln)
        if t is None:
            continue
        if 'Autopilot started' in ln:
            if cur is None:
                cur = t
            # a second `started` inside a window is the resume after a death
        elif 'Autopilot stopped' in ln and cur is not None:
            windows.append((cur, t))
            cur = None
    if cur is not None:
        windows.append((cur, None))
    return windows


def matches(pat, line):
    if isinstance(pat, str):
        return pat in line
    return pat.search(line) is not None


def fmt_rung(v):
    return '-' if v in (None, 0, False) else str(v)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('round', type=int, help='soak round number (for the header)')
    ap.add_argument('log', help='dashboard log slice for the soak (may have no newlines)')
    ap.add_argument('--results', default='data/soak-results.json', help='soak results JSON for the rung table')
    ap.add_argument('--quote', action='append', default=[], metavar='SUBSTRING',
                    help='also count and quote lines containing SUBSTRING (repeatable)')
    ap.add_argument('--max-quote', type=int, default=40, help='most lines quoted per pattern (default 40)')
    ap.add_argument('--width', type=int, default=260, help='quoted line width (default 260)')
    ap.add_argument('--counts-only', action='store_true', help='print the count table only')
    args = ap.parse_args(argv)

    lines = read_lines(args.log)
    windows = run_windows(lines)
    try:
        data = json.load(open(args.results, encoding='utf-8'))
        runs = data.get('runs', [])
    except (OSError, ValueError) as e:
        print('results JSON not read (%s); rung table skipped' % e)
        data, runs = {}, []
    names = [r.get('index', 'run%d' % (i + 1)) for i, r in enumerate(runs)]
    for i in range(len(names), len(windows)):
        names.append('window%d' % (i + 1))
    names = names[:max(len(windows), len(runs))]

    def run_of(t):
        if t is None:
            return None
        for (a, b), n in zip(windows, names):
            if a <= t <= (b if b is not None else float('inf')):
                return n
        return None

    print('round %d soak report from %s: %d dashboard lines, %d run windows' % (args.round, args.log, len(lines), len(windows)))
    if len(windows) != len(runs):
        print('NOTE: %d Autopilot windows but %d runs in %s - names are paired in order' % (len(windows), len(runs), args.results))
    print()
    print('run windows (Autopilot started -> stopped; a second started inside a window is a resume after a death):')
    for (a, b), n in zip(windows, names):
        first = next(ln for ln in lines if ts_seconds(ln) == a)
        last = next((ln for ln in lines if ts_seconds(ln) == b), None) if b is not None else None
        length = (b - a) if b is not None else None
        print('  %-10s %s -> %s  (%s)' % (n, ts_text(first), ts_text(last) if last else 'run end missing',
                                          ('%.1f s' % length) if length is not None else '-'))
    print()

    if runs:
        print('rung table (seconds from the run start; - = never) from %s:' % args.results)
        print('  %-10s | %-5s | %-10s | %-7s | %-9s | %-7s | %-12s | %-5s | %-8s | %-12s | %-6s | %s' % (
            'run', 'wood', 'stone pick', 'furnace', 'iron pick', 'torches', 'armour worn', 'bed', 'diamonds', 'diamond pick', 'deaths', 'food'))
        for r in runs:
            first = r.get('first', {})
            aw = r.get('armour_worn_at')
            print('  %-10s | %-5s | %-10s | %-7s | %-9s | %-7s | %-12s | %-5s | %-8s | %-12s | %-6s | %s' % (
                r.get('index'), fmt_rung(r.get('wood_at')), fmt_rung(r.get('stone_at')), fmt_rung(first.get('furnace')),
                fmt_rung(r.get('iron_pick_at')), r.get('torch_peak', 0),
                ('%d at %d' % (r.get('armour_worn_peak', 0), aw)) if aw else '0',
                fmt_rung(r.get('bed_at')), r.get('diamond_peak', 0), fmt_rung(r.get('diamond_pick_at')),
                len(r.get('death_log', [])), r.get('food_verdict', '')))
        print('  ingots_peak %s | iron_ore_peak %s | run length %s | interventions %d | deaths %d' % (
            data['summary'].get('ingots_peak'), data['summary'].get('iron_ore_peak'),
            [r['samples'][-1]['t'] for r in runs if r.get('samples')],
            sum(len(r.get('interventions', [])) for r in runs), data['summary'].get('deaths', 0)))
        for r in runs:
            if r.get('death_log'):
                print('  %s death_log: %s' % (r.get('index'), json.dumps(r['death_log'])[:600]))
            if r.get('interventions'):
                print('  %s interventions: %s' % (r.get('index'), '; '.join(str(x) for x in r['interventions'])[:600]))
        print()

    patterns = list(PATTERNS) + [(q, q) for q in args.quote]
    counts = {lab: collections.Counter() for lab, _ in patterns}
    quotes = collections.defaultdict(list)
    for ln in lines:
        t = ts_seconds(ln)
        nm = run_of(t) or 'outside'
        for lab, pat in patterns:
            if matches(pat, ln):
                counts[lab]['total'] += 1
                counts[lab][nm] += 1
                quotes[lab].append((nm, ln))

    print('pattern counts per run (outside = before the first run, between runs, after the last):')
    for lab, _ in patterns:
        c = counts[lab]
        per = ' '.join('%s=%d' % (n, c[n]) for n in names if c[n])
        extra = ' outside=%d' % c['outside'] if c['outside'] else ''
        print('  %-45s total=%-4d %s%s' % (lab, c['total'], per, extra))
    print()
    if args.counts_only:
        return 0

    quote_set = QUOTE_ALWAYS | set(args.quote)
    for lab, _ in patterns:
        if lab not in quote_set or not quotes[lab]:
            continue
        print('===== %s (%d) =====' % (lab, counts[lab]['total']))
        shown = 0
        for nm, ln in quotes[lab]:
            if shown >= args.max_quote:
                print('  ... %d more' % (len(quotes[lab]) - shown))
                break
            print('  [%s] %s' % (nm, ln[:args.width].rstrip()))
            shown += 1
        print()

    # the box list: seal -> dawn -> hold -> morning, in order, per run
    print('===== box list (seal -> dawn -> hold -> morning) =====')
    seal = None
    for ln in lines:
        t = ts_seconds(ln)
        if t is None:
            continue
        if 'Shelter: sealed at' in ln:
            seal = (t, ln)
            print('  [%s] %s' % (run_of(t) or 'outside', ln[:args.width].rstrip()))
        elif 'Shelter: dawn' in ln or 'held past dawn by' in ln or 'morning in a cave' in ln:
            print('      %s' % ln[:args.width].rstrip())
            if 'Shelter: dawn' in ln:
                seal = (seal[0] if seal else t, ln, t)
        elif 'Shelter: morning' in ln and 'opening up' in ln:
            held = (t - seal[2]) if seal and len(seal) == 3 else None
            print('      %s%s' % (ln[:args.width].rstrip(), ('  <- held %.1f s past dawn' % held) if held is not None else ''))
            seal = None
        elif 'Completed shelter' in ln or 'Job time limit reached' in ln:
            if seal:
                print('      %s' % ln[:args.width].rstrip())
            seal = None
    print()

    # sprint share with food above 6, weighted by walking seconds
    tot = collections.defaultdict(lambda: [0.0, 0])
    for ln in lines:
        if 'Movement: sprinting' not in ln:
            continue
        m = re.search(r'sprinting (\d+)% of (\d+) s of pathfinder walking \(food (\d+)\)', ln)
        nm = run_of(ts_seconds(ln))
        if m and nm and int(m.group(3)) > 6:
            tot[nm][0] += int(m.group(2)) * int(m.group(1)) / 100.0
            tot[nm][1] += int(m.group(2))
    print('===== sprint share (food > 6, weighted by walking seconds) =====')
    for nm in names:
        s, w = tot[nm]
        print('  %s %.0f/%d = %.1f%%' % (nm, s, w, 100 * s / w if w else 0))
    print()

    print('===== sections this script cannot produce =====')
    for item in CANNOT_PRODUCE:
        print('  - ' + item)
    return 0


if __name__ == '__main__':
    sys.exit(main())
