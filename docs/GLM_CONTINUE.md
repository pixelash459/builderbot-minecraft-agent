# GLM: continue after Cursor (Claude, 2026-10-14 09:40)

Cursor (Fable 5.1, then Grok 4.6) owned the project from 00:50 to 09:05 and has stopped. You own it now; no other agent is working in this folder. Read, in this order: `docs/HANDOVER_FROM_CURSOR.md` (Rounds 3-6 at the end), `docs/CLAUDE_REVIEW.md`, the 2026-10-14 sections at the end of `docs/RESEARCH_FIXES.md`, and the milestones in `docs/CURSOR_FABLE.md`.

## Hard rules (unchanged)
- Never kill processes by name; only `Stop-Agent.ps1`/supervisor `/stop`, PIDs in `data/processes.json`, or a verified project-port PID.
- Every node run `--max-old-space-size=2048`; `node --test` also `--test-timeout=60000`; everything with a timeout.
- **Keep the local model off**: set `$env:AGENT_MODEL='off'` before every Start-Agent / soak (the user games on this PC; a guard stops llama-server while the game runs).
- Never touch the user's other servers, tools or folders (listed in `LOCAL_RULES.md`, kept out of git); `reference/` is read-only source.
- Test server stays `server-ip=0.0.0.0`; never kick/tp/gamemode/target players; every `@e` has `type=`; no `@a`/`@p`.
- One soak at a time. No test-fixture coordinates or names in `src/` (see CLAUDE_REVIEW). Do not make tests easier to pass; if you change a fixture, keep the old case and report both.
- Report honestly with evidence.

## Where it stands (Cursor's measurements)
- M1 integration green. M2 wooden pickaxe 6/6 and M3 stone pickaxe + furnace 5/6 in soak 5 (`data/soak-results-20261014-081355.json`), 0 "No clear spot". Unit tests ~182 pass.
- Key fixes you must not undo: `src/compat.js` hitbox 0.30001 / height 1.80001, teleport-confirm dedupe by id, weather tracking from rain levels; powder-snow escape and hazard avoidance; wall-clock bow draw.
- Open: food 0/6; one fall death on a food explore (soak 5 normal1); creeper damage 17.1 at best (arrows miss on this ViaVersion path; a 1-wide cobble pillar does not stop it); enderman roof 0/20; first night and iron not measured.

## Do, in order
1. **Food (M4).** The soak sets `spawn_mobs false`, which also stops animals spawning, so the food step finds nothing. 26.x has a separate `spawn_monsters` rule: in the soak use `spawn_mobs true` + `spawn_monsters false` (verify each rule back like the others), so animals exist but hostiles don't spawn in normal mode. Then make the food step hunt the nearest passive animal (cow/pig/sheep/chicken) within 48-64 blocks on safe terrain, cook the meat in the furnace it already has, and eat. Target: edible food in >= 4/6 runs.
2. **No falls.** Cursor's `surfaceCeiling=standY+8` on food explore is loaded but unmeasured; also refuse paths with drops > 3 blocks and never path along cliff edges without a block below. Target: 0 deaths in normal mode.
3. **First night.** Run the soak 20+ minutes (or start runs at dusk) in hard mode with natural spawning and check the bot sleeps (bed from wool) or shelters and survives the night.
4. **Creeper (lower priority; do not spend more than ~5 combat runs).** Arrows miss on this stack, so use what works for humans: when a creeper is within ~6, step back and place a 3-wide, 2-high wall across its heading (Cursor's next hypothesis), or pillar up 2-3 blocks (creepers cannot climb) and wait; a shield raised toward the blast cuts damage hugely. Report damage honestly in both arena variants.
5. **Iron (M5)** if the above are done: stone pickaxe -> find/dig iron ore -> smelt -> iron pickaxe/sword.
6. After each soak, append a dated section to `docs/HANDOVER_FROM_GLM.md`: files changed, unit/integration/combat results, soak table (wood/stone/furnace/food times, deaths with causes), open issues. Stop when all done or when you hit your usage limit (write the handover first if you can).

Use web search for version-correct fixes (Minecraft 26.x / Paper 26.3, mineflayer). Use subagents for disjoint files; only the main agent restarts services and runs live tests.
