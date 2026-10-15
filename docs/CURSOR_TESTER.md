# Cursor (Grok 4.7): local test runner and verifier (Claude, 2026-10-14)

GLM has hit its usage limit. A Claude cloud session (code-only, no game access) is working through `docs/CLOUD_TASK.md` and pushes its commits to `origin main`. Your job is the part only this PC can do: **run the live tests on whatever is on `main` and report honestly.**

**Division of work (user's decision, 2026-10-14):** all improvements, new behaviours and non-trivial fixes are done by the Claude cloud session (Opus 5.5). You do NOT design or change bot behaviour. You may only fix trivial, mechanical breakage that blocks a test run (a crash on a null, a typo, a test-harness/setup bug), in a small separate commit that says why. Everything else - wrong behaviour, missing features, tuning, combat, pathing, ladder logic - goes into `docs/TEST_REPORTS.md` as a concrete bug report (what, where in the logs, which run) for the cloud session to fix.

## Hard rules (unchanged, see AGENTS.md)
- Never kill processes by name; only `Stop-Agent.ps1`/supervisor `/stop`, PIDs in `data/processes.json`, or a verified project-port PID.
- Every node run `--max-old-space-size=2048`; `node --test` also `--test-timeout=60000`; everything with a timeout.
- **Model off**: `$env:AGENT_MODEL='off'` before every Start-Agent / soak. Never start llama-server.
- Never touch the user's other servers, tools or folders (listed in `LOCAL_RULES.md`, kept out of git); `reference/` is read-only source.
- Test server stays `server-ip=0.0.0.0`; never kick/tp/gamemode/target players; every `@e` has `type=`; no `@a`/`@p`.
- One soak at a time. No test-fixture coordinates in `src/`; never make a test easier; report failures as failures.
- **Always restart the services (`Stop-Agent.ps1`, then `Start-Agent.ps1` with the model off) after pulling or editing code**, otherwise the running bot uses stale code.

## Git
`git pull --rebase` before every test run. Commit and push only your own fixes and reports, small and with clear messages. Do not rewrite or revert the cloud session's commits; if one of them breaks a test, fix forward in a separate commit and say why. Never force-push.

## Do, in order
The cloud session has FINISHED (commits c3c0ce6..4afa796; read its "Cloud session" section at the end of `docs/HANDOVER_FROM_GLM.md`). Unit tests: 222/222 on this PC. Nothing in it is live-verified yet, so everything below is new evidence.

1. `git pull --rebase`; run the unit tests (all `tests/*.test.js` except `resources.test.js`). Must be 222/222.
2. Restart services (model off). Run `python tests/integration.py` (must be green).
3. **Verify the yaw/pitch fix first** (`src/heading.js`, commit 8833466): the cloud session found that combat/flee code used the wrong yaw convention, so headings with a z component were mirrored and bow pitch inverted. In `tests/combat_integration.py`, check in the logs that flee/kite legs move AWAY from the mob and arrows now hit. If movement looks mirrored after the fix, say so immediately in the report - do not "tune" around it.
4. `python tests/combat_integration.py`: report `4_creeper` and `4b_creeper_roofed` damage and whether the new pillar-up fired ("pillar" lines in the dashboard log), plus arrow hits. At most 3 runs.
5. **Dual soak** (`python -u tests/soak.py`): wood/stone/furnace times, food (`eaten`, `food_points` now real), night sleep/shelter (look for `[night]` jobs in the hard runs), iron (ore/ingots/iron pickaxe if reached), deaths with causes.
6. After every run, append a dated section to `docs/TEST_REPORTS.md`: commit tested (`git rev-parse --short HEAD`), results, soak table, concrete bugs seen. Commit and push it. Fix only what tests show broken, in small separate commits.

Keep going until all of the above is done or you hit your usage limit (write the report first).
