# BuilderBot Minecraft agent

Everything installed for this project lives in this folder. Other Minecraft servers, Java installations and worlds on the machine are not modified.

## Start and use

1. Double-click **Start-Agent.cmd**. It starts the control page, local AI and a private test server. Initial startup takes about a minute.
2. The control page opens at **http://127.0.0.1:8765**. The launcher signs you in automatically. If the page asks you to sign in, launch Start-Agent.cmd again.
3. Click **Connect**. BuilderBot joins the private world. You can join the same world from Minecraft Java using **127.0.0.1:25569**.
4. Enter a task, click **Create AI plan**, review it, then click **Run this plan**. You can also expand **Add a task directly**.
5. **Stop all jobs** pauses movement and all queued work. **Stop-Agent.cmd** saves the private world and stops the services.

Examples:

- Gather 8 oak logs, then craft 32 oak planks.
- Mine 16 cobblestone.
- Deposit oak planks in the chest at X=-3, Y=-60, Z=0.
- Build the platform blueprint with its origin at X=5, Y=-60, Z=0.

The test world contains a demonstration chest and platform after validation. Provide accessible materials when you queue further jobs. It is a flat survival world with peaceful difficulty. Tests use console commands to create fixtures and supply tools; the worker itself digs, walks, crafts, deposits and places blocks through ordinary survival actions.

## What works

- Local natural-language planning with **Qwen3-8B Q4_K_M**, served by portable llama.cpp on your NVIDIA GPU. No paid AI account or API key is required.
- A serial saved queue for gathering (search radius up to 64 with optional exploration and staircase mining down to a target Y), movement, crafting (it places or crafts a crafting table for 3x3 recipes and picks it back up), smelting (furnace found, placed or crafted; fuel chosen automatically; its provisioning table is picked up too), depositing, exploring, placing single blocks, eating, equipping, collecting drops, sleeping, fighting hostiles, overnight shelter, **obtaining any item through its full chain** (`obtain`), using held items (`use`: strip logs, till, bone meal, fill/empty water buckets, shear leaves), shearing sheep, breeding animals and hunting for drops — and simple block blueprints.
- A version-accurate acquisition guide at `GET /api/howto?item=` and the `minecraft_howto` MCP tool: the full gather/smelt/craft/hunt chain for any item, built from minecraft-data for the connected version, with unsupported leaves and the reason why (the End, needs silk touch, loot only...).
- Actual inventory and world checks before marking jobs complete.
- Building skips matching blocks and refuses to replace existing mismatches. It uses inventory materials and needs a reachable support surface. Blueprint files go in `blueprints`; the sample `platform.json` explains the format.
- Jobs pause after restarting. Resume is explicit. A failed job pauses later queued tasks so a dependent plan cannot silently continue.
- An autonomous progression ladder (`src/autopilot.js`, off by default): start it from the dashboard or `minecraft_autopilot_start` and it works through wood tools (any log species it actually finds), stone tools and a furnace, food, iron gear with torches and a bed on its own, sleeping or sheltering at night, remembering a home chest, depositing when its pockets fill up, exploring elsewhere when a step fails three times, and stopping the moment you press Stop. For underground goals it digs a safe 45-degree staircase (torches every few steps, stops at fluids) and can strip-mine at bedrock depth for diamonds. It only queues the same verified jobs a human would, so reflexes and Stop keep working. Limits: iron/diamond steps stall honestly on the flat test world where those ores do not exist; the diamonds step strip-mines but has not yet been observed end-to-end on normal terrain.
- Always-on reflexes while connected (toggle in `config.json` or via MCP): auto-eat, fight-or-flee hostiles, keep distance from creepers, swim up when drowning, step out of fire and lava, auto-equip better armour while idle, and death handling that pauses everything until an explicit resume. A reflex briefly pauses the running job and resumes it from saved progress afterwards.
- Local MCP tools for an AI client: status, observe, connect, submit, stop, resume, reflexes, autopilot start/stop and howto.
- A perception summary at `GET /api/observe` and the `minecraft_observe` MCP tool: position, dimension, biome, time of day, weather, vitals, held item, armour, grouped inventory, nearby blocks and living entities within 24 blocks (counts plus nearest positions) with a dropped-item count, the current job and the last 10 events, as one compact JSON document under about 3 KB.
- Optional **Mindcraft** chat companion, Andy, installed in `vendor/mindcraft`.

These routines are a starting agent, with bounded tasks. Complex structures with stairs, orientation, redstone or temporary scaffolding are not supported by the current blueprint format. `obtain` explains what it cannot get and why (silk touch, Nether/End, loot-only items) and refuses once instead of looping; farming crops from seeds, eggs, trading and lava handling are not supported. Gathering is limited to a 64-block radius around the job's starting point and accessible blocks. It refuses many structural/container blocks, lava-adjacent targets, digging under itself and unsuitable harvesting tools. Travel does not dig through terrain. It pauses for low health/food, a nearly full inventory or the job time limit.

## Connect to another server

The default private world lets you test first. To target another server you run:

1. Stop the agent services.
2. In `config.json`, set `host` and `port` to that server.
3. If it has a whitelist, add **BuilderBot** from its console (`whitelist add BuilderBot`). The bot uses a separate offline identity and does not need your account or operator permissions.
4. Start the agent and Connect. Supply tools and materials and choose the mining area, chest and build origin before running jobs.

The private test server uses ViaVersion/ViaBackwards **5.12.1** with client protocol **1.21.4**; recheck inventory operations on servers with other plugin versions. The local compatibility hook sends the required movement tick boundaries on Minecraft 26.3. Never open an existing 26.3 world with an older server.

## Optional chat companion

Double-click **Start-Companion.cmd** after the main services start. Andy joins the private test world and its UI is at **http://localhost:8080**. It listens only to the observed player name **SH1FU_01** by default; change `only_chat_with` in `vendor/mindcraft/settings.js` if your name differs. Its own server settings are in that file, independently of BuilderBot's `config.json`.

Andy uses the same local model, saves memory under `vendor/mindcraft/bots`, and has generated-code execution and vision disabled. It uses Mindcraft's conversational actions. Use the main worker for blueprints and saved jobs. Stop-Agent.cmd stops both agents and the model. The companion UI is local-only; do not publish its port.

## Connect Codex or another MCP client

Open **this minecraft-agent folder as the Codex project** to load its project-scoped `.codex/config.toml`, subject to your normal project trust settings. No global Codex configuration was changed. Existing chats do not gain newly configured tools until the project/session is reloaded.

Another MCP client can launch `runtime/node-v22.23.3-win-x64/node.exe` with the absolute path of `src/mcp.js` as its argument. Start-Agent.cmd must be running. The bridge automatically reads the local dashboard token and submits jobs; it does not execute arbitrary generated code.

## Files and troubleshooting

- `config.json`: bot connection, local model endpoint and limits.
- `data/jobs.json`: persisted tasks. Completed and failed test jobs remain as evidence.
- `data/integration-results.json`: in-game validation results once the suite passes.
- `logs/dashboard.log`, `logs/test-server.log`, `logs/model.log`: runtime logs. Old startup attempts remain in the same files.
- `logs/supervisor-error.log`: startup problems, including a port already in use.
- `runtime`, `models`, `downloads`, `cache`, `temp`: portable installation, model and local caches.
- `bootstrap.py`: installer for the portable runtime and model. Node and model downloads are checked against official SHA-256 values.

If the connection is refused, allow the world to finish starting and press Connect again. If a job fails, read its message, supply the missing materials or fix access, then Resume. Failed jobs never count as completed. If a port is already occupied, the launcher stops with a log message and preserves the other service. All services bind to loopback; the dashboard and model use locally generated access tokens.

## Versions and source

- Portable Node **22.23.3**, [official distribution](https://nodejs.org/dist/v22.23.3/).
- Mineflayer **4.39.0**, [upstream repository](https://github.com/PrismarineJS/mineflayer).
- Minecraft 26.3 movement workarounds follow the diagnosis in [upstream PR 4128](https://github.com/PrismarineJS/mineflayer/pull/4128) and [PR 4130](https://github.com/PrismarineJS/mineflayer/pull/4130). The hook is in `src/compat.js`, scoped to each connection.
- ViaVersion/ViaBackwards **5.12.1**, [ViaVersion release](https://github.com/ViaVersion/ViaVersion/releases/tag/5.12.1), [ViaBackwards release](https://github.com/ViaVersion/ViaBackwards/releases/tag/5.12.1).
- llama.cpp **b11505**, [official release](https://github.com/ggml-org/llama.cpp/releases/tag/b11505).
- [Official Qwen3-8B GGUF](https://huggingface.co/Qwen/Qwen3-8B-GGUF).
- Mindcraft pinned to **f6a9556cf756e6bd88a75cc2fa0d5aed7599b101**, [upstream source](https://github.com/mindcraft-bots/mindcraft/tree/f6a9556cf756e6bd88a75cc2fa0d5aed7599b101). Local changes: settings/profile, per-connection movement hook, local word-overlap search instead of cloud embeddings, and the remaining harvesting-material correction from its older Mineflayer patch. Dependencies were installed using portable Node 22 with local caches.
