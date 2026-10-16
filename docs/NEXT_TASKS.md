# Next tasks after round 10 (Claude, 2026-10-16 08:15)

For whichever agent implements next (the cloud credit is used up). Same rules as `docs/CLOUD_TASK.md` and `AGENTS.md`; machine-specific rules are in `LOCAL_RULES.md` (local only). Read the round-10 sections of `docs/TEST_REPORTS.md` (2026-10-16) and the "Cloud session round 10" section of `docs/HANDOVER_FROM_GLM.md` first.

## Round 10 live results
0 deaths in all 6 runs; iron pickaxe 3/3 (391-692 s); torches 16/run; furnace leave-and-take works (side jobs while smelting); meals only at bar <= 14; **first diamond** (normal1 held 1). Both creepers 0 damage; integration green.

## Bugs, in priority order
1. **Night mine leaves the bot under its shelter.** hard1: `Night mine: down from the shelter` (tod 12602), then `could not climb back into (163,121,34): No path to the goal!` and in the same second `back in the shelter (done ...)` - but the bot was at y=18 under the box; re-seal kept reporting `open cells ... (bot at 163.50,18.34)` for 7 min. The return must verify the bot is actually inside the cell before reporting success; if the climb fails, climb the recorded tunnel step by step, or pillar up the sump, or seal itself in a pod where it stands.
2. **Diamond descent is too cautious to arrive.** normal1 stopped at y=49 (`dropped to y=49 below the step`) and y=-16 (`three openings, no safe way on`); normal3 stopped at y=84 after three cave openings. Turning is right, but 3 openings per job and stopping is too few in cave-rich terrain: bridge small openings (place a block over a 1-2 wide gap), allow more turns, and if blocked, move a few blocks sideways and start a new staircase. The goal is to reach y -53 and branch-mine.
3. **Furnace take never happened** 3 times (`take queued twice`, then the next smelt placed a new furnace). Make the take run before any new smelt, and walk back to the loaded furnace.
4. **Water bucket fills fail**: 6x `use bucket ... produced no water bucket` at (358,94,-43) and (315,130,-13). Check the target is a water *source* block, that the bot looks at it within reach, and the use-item packet path on 1.21.4.
5. **Bed: no sheep found** (`no sheep after 3 search legs` both times). Widen the sheep search (grazing biomes, 64-96 blocks) or accept any wool source; keep the 10-min backoff.
6. **Deposit never happens**: `Inventory nearly full; deposit items first` with no chest placed/deposit. Place a home chest when none exists (8 planks) and deposit surplus.
7. **Hard runs**: hard2 never got a log (`no diggable target left` with logs at y=136-137 above a 131 stand: tall dark-oak canopy - pillar/jump up to the trunk or pick a lower tree); hard3's night pillar `timed out at 0/3 ... rose 0.00, 0 clicks, holding cobblestone, on grass_block` - the jump-place never fired.
8. No hunts happened (food set aside every run) - fine for progress, but batch hunting is still unmeasured.
