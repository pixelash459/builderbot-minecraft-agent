# TASK_API — shared interfaces for the AltoClef port (Phase 7A)

This is the frozen contract between the porting subagents (P1 task system, P2 chains,
P3 resource tasks, P4 trackers/movement) and the main agent's wiring. Read it together with
docs/ALTOCLEF_PORT_SPEC.md. Behaviour questions are settled by the referenced Java files in
`D:\Usefu Shi\Epic\SGSMP\reference\altoclef\` (read-only; never build or run it). Every
ported file starts with a header naming the original AltoClef file(s) and the MIT notice;
`third_party/ALTOCLEF_LICENSE` holds the licence text. Do not port Baritone code.

House style: ES modules, compact code, 1-space indent, comments only for non-obvious
constraints. Every file's ported functions get `bot` explicitly (no globals).

## src/tasks/task.js — `export class Task`

Port of `tasksystem/Task.java`. A task is a small decision: each tick it either returns the
child task it wants run, or `null` to do its own work.

```js
export class Task {
  constructor(name){this.name=name;this.child=null;this.started=false;this.stopped=false;}
  onStart(bot){}                    // first tick after the task became reachable
  onTick(bot){return null;}         // return the child Task to switch to, or null
  onStop(bot,interrupt){this.stopped=true;}  // interrupt=true when superseded/stopped
  isFinished(bot){return true;}     // true once the task's goal is met
  isEqual(other){return other instanceof this.constructor;} // same goal? override with args
}
```

Runner-managed state (tasks must not set these): `this.child`, `this.started`, `this.stopped`.

## Lifecycle (port of `tasksystem/TaskRunner.java`)

The runner keeps, per chain, the root task returned by `chain.onTick(bot)`. Each runner tick:

1. `child` switching: when a task's `onTick` returns `T`: if `this.child` is `null` or
   `!this.child.isEqual(T)`, stop the old child (`onStop(bot,true)`) and adopt `T`
   (`started=false`). Identical children keep running — this is what prevents AltoClef's
   subtask-restart storms.
2. Descent: walk `child` links; the first task whose `onTick` returned `null` is the active
   leaf. `onStart(bot)` fires on a task's first tick after becoming reachable.
3. Completion: if `isFinished(bot)` is true at descent, stop it (`onStop(bot,false)`) and
   clear it from its parent; the parent re-decides on its next tick.
4. `runner.stop()`: stops the whole active tree with `interrupt=true` (deepest first).

## src/tasks/chain.js — `export class TaskChain`

Port of `tasksystem/TaskChain.java`, `chains/SingleTaskChain.java`.

```js
export class TaskChain{
  constructor(name){this.name=name;this.root=null;this.started=false;}
  priority(bot,ctx){return -1;}     // >=0 active, higher wins; -1 inactive (skip)
  onTick(bot,ctx){return this.root;} // the root Task for this tick (chain builds/keeps it)
  onStartup(bot,ctx){this.started=true;}
  onStopped(bot,ctx){this.started=false;}
}
```

## src/tasks/runner.js — `export class TaskRunner`

Port of `TaskRunner.java`. `new TaskRunner(worker,chains,{intervalMs:50})`.

- `start()` / `stop()`: an interval (unref'd) calls `tick()` every `intervalMs`.
- `tick()`: pick the chain with the highest `priority(bot,ctx) >= 0`; on a chain switch,
  stop the previous chain's whole tree with `interrupt=true`, call the new chain's
  `onStartup`, then run that chain's lifecycle (rules above).
- **Single owner of the pathfinder and controls**: the runner holds the ownership token
  (`worker.controlToken`, epoch rules from docs/PROMPT_CURRENT.md's race fix) while a tree
  is active; task code never calls `pathfinder.setGoal/setMovements/clearControlStates`
  directly — it uses the movement helpers (P4), which are ownership-guarded the same way
  the reflex `gotoPoint` is.
- `ctx` (built by the runner, passed to every chain/task callback):
  `{worker,bot (live getter),config,trackers,blacklist,move}` where `trackers` (P4),
  `blacklist` (P4: `entity(kind,pos,seconds)`/`wasRecently(kind,pos,seconds)`), `move` (P4
  movement task helpers). Until P4 lands, these are `{}` and chains/tasks must tolerate
  that (no-arg guards); the wiring order is main agent's job.
- Exposes `runner.status()` → `{running:bool,chain:string|null,task:string|null}` for the
  API/dashboard.

## What each subagent builds

- **P1** `src/tasks/task.js,runner.js,chain.js` per the classes/lifecycle above, ported from
  `tasksystem/*.java`, with unit tests (fake bot, manual clock) covering: subtask switching
  stops the old child exactly once, `isEqual` prevents restarts, chain priority switching
  interrupts cleanly, completion pops, `runner.stop()` walks the tree.
- **P2** `src/chains/*.js`: `MobDefenseChain`, `FoodChain`, `WorldSurvivalChain`,
  `MLGBucketFallChain`, `UserTaskChain`, `RespawnChain` (from `DeathMenuChain.java`),
  porting the Java priority values and decision logic, with thresholds adapted to
  docs/COMBAT_SPEC.md 7f (never fight unarmed; get-armed → walk away → daylight burn →
  shelter → cornered order; hunt only the named animal, abort within 8 blocks of a hostile).
- **P3** `src/tasks/resources/*.js`, `src/tasks/container/*.js`, `src/tasks/catalogue.js`:
  the overworld resource tasks named in the port spec, with `howto.js` (minecraft-data) as
  the recipe source of truth for this server version.
- **P4** `src/trackers/*.js` (BlockTracker, EntityTracker, storage, blacklisting) and
  `src/tasks/movement/*.js` (get-to-block/entity/xz, run-away, escape-lava, out-of-water,
  timeout wanderer, chunk search) on mineflayer-pathfinder with our dig-safety rules.

Conventions: constructors take plain arguments (no `bot` captured at construction — it can
reconnect); tasks receive `bot` and `ctx` in every callback; keep files small and single
purpose like the Java originals. Unit tests use fake bots; nothing here touches the live
server, services, or the dashboard.

## Async actions (added by Claude review; binding for P1-P4 and the main agent)

AltoClef's Baritone actions are non-blocking processes, but Mineflayer actions (pathfinder.goto, dig, placeBlock, craft, openContainer/openFurnace, consume, equip, attack-cooldown waits) are Promises. Rules:
1. `onStart`/`onTick`/`onStop`/`isFinished` are SYNCHRONOUS and never `await`. The runner never awaits, and ticks never overlap.
2. P1 provides a shared base class `ActionTask` in `src/tasks/action.js`: it starts its async action once (`this.inflight=promise`), records the result or error when it settles, returns `null` while in flight, reports finished when it settled OK, and on `onStop(bot,interrupt)` cancels through ownership-guarded stops (pathfinder stop/setGoal(null), stopDigging, closeWindow, clearControlStates) and ignores any late settlement.
3. A settled action's error is exposed to the parent (`this.failed={reason}`), so parents can blacklist or retry instead of throwing.
4. No task holds a promise across a chain switch.
5. Unit tests: interrupt during an in-flight action; late settlement after stop is ignored; a failed action is visible to the parent.

## HARD RULE: memory limits (added by Claude after two incidents on 2026-10-10)
Runs of tests/resources.test.js and the dashboard node process grew to 17-140 GB, exhausted the page file and crashed one of the user's other servers with players online. A guard now stops any minecraft-agent node process above 4 GB.
- Every node test or script: `--max-old-space-size=2048`; `node --test` also gets `--test-timeout=60000`. Never run anything without a timeout.
- Before running tests/resources.test.js again, find and fix its unbounded growth (likely recursion/looping in the resource tasks or howto chain, the runner/ActionTask, or a fake clock that never advances) and the dashboard growth. Add a unit test that runs the runner for 10k ticks and asserts heap stays bounded.
- Re-read the "Async actions" section at the end of docs/TASK_API.md.
