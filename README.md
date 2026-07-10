# ☢ Sands of Apocalypse

A moody, cartoony-but-grim **3D apocalyptic survival demo** with RuneScape-style
click-to-move controls, gathering skills, combat, and **real-time multiplayer**.
Runs in the browser; served by a tiny [Bun](https://bun.sh) server so other devices
on your LAN can join.

> Setting: a **nuclear/toxic wasteland** — toxic-green haze, glowing hazard barrels,
> irradiated dead trees, ore veins, and shambling mutants.

---

## Quick start

```sh
bun server.js
```

Then open **http://localhost:8080/**. Other devices on the same network join at
**http://<this-machine-LAN-IP>:8080/** (e.g. `http://192.168.1.8:8080/`). Each
browser that connects becomes a player everyone else can see.

No build step — the client is plain ES5-ish JS loaded via `<script>` tags, with
Three.js vendored locally in `lib/three.min.js` (UMD global build).

## Controls

| Input | Action |
|-------|--------|
| **Left-click** ground | walk there |
| **Left-click** tree / ore / mutant / player | walk up & interact (chop / mine / attack) |
| **WASD / Arrow keys** | orbit + pitch/zoom the camera |
| **Q / E** | rotate camera |
| **Mouse wheel** | zoom |
| **Shift** | Dark Souls-style **dodge roll** (brief i-frames) |

## Features

- **Click-to-move** pathing with facing + procedural walk animation.
- **Skills**: Woodcutting, Mining, Attack — RS-style XP curve, level-ups, 28-slot inventory.
- **Combat**: hitsplats (hit/crit/miss/dodge), floating enemy HP bars, death & respawn, player HP globe.
- **Enemy AI**: mutants wander, aggro & chase within range, leash back home.
- **Dodge roll** with invulnerability frames (Shift).
- **Death sequence**: dance → backflip → collapse → "YOU DIED" → respawn.
- **Multiplayer** (WebSocket): see other players move in real time, with nameplates.
- **PvP**: click another player to fight them; victim-authoritative damage, respects dodge.
- **Flavor**: dying mutants shout **"Arigatou Gozaimasu"** (on-screen bubble + browser TTS).
- **Live-reload** during dev (browser polls `/__mtime`).

## Architecture

```
server.js            Bun server: static files + WebSocket /ws + snapshot broadcast + /__mtime
index.html           canvas + HUD DOM + ordered <script> includes
css/style.css        HUD, globes, inventory, hitsplats, speech bubbles, vignette, death screen
lib/three.min.js     vendored Three.js r128 (UMD global)
js/
  utils.js           Game state, math, RS XP table, seeded RNG, SFX (WebAudio), Voice (TTS)
  world.js           renderer, scene, toxic fog, terrain (height-sampled), lights, haze
  camera.js          orbit-follow camera rig (WASD/arrows/QE/wheel)
  player.js          local player: click-to-move, actions, dodge, death anim
  entities.js        trees/rocks/barrels/mutants + enemy AI + resource respawn
  net.js             multiplayer client: WS, remote avatars, PvP attack/hit, nameplates
  skills.js          Woodcutting/Mining/Attack XP + inventory
  combat.js          damage rolls, hitsplats, enemy attacks, PvP attack/receive
  ui.js              HUD wiring: vitals, skills, inventory, hitsplats, labels, speech, death
  selftest.js        headless end-to-end self-test (see below)
  main.js            bootstrap, input routing (raycast), game loop
```

### Multiplayer model

The server holds an authoritative **player registry** and broadcasts a snapshot
of everyone's pose ~15×/sec. Clients stream their own pose ~12×/sec. **Each client
is authoritative over its own HP/death** — a PvP attack is sent to the server, which
relays a `hit` event; the victim's client applies the damage (and can dodge it).
Mutants and gathering are simulated **client-side** (the world layout is identical on
every client thanks to a fixed RNG seed), so kills/resources are local per player.

## Testing / validation

Two automated harnesses back this project — run them after changes:

1. **Logic self-test** (headless, no WebGL needed): open `?selftest=1`. It scripts
   movement, woodcutting, mining, combat, aggro, dodge i-frames, PvP, death & respawn,
   then writes a JSON verdict to `#selftest-result` and sets the page `<title>` to
   `SELFTEST PASS n/n`. Run headless:
   ```sh
   chrome --headless --disable-gpu --dump-dom --virtual-time-budget=60000 "http://localhost:8080/?selftest=1"
   ```
2. **Multiplayer WS test**: a Bun script that connects two clients and asserts they
   see each other + PvP relay works (kept in the dev scratchpad; re-create with two
   `WebSocket`s to `/ws` if needed).

Current status: **logic self-test 34/34, multiplayer/PvP test 14/14.**

## For the next agent / dev notes

- **No bundler, classic scripts, shared globals** (`Game`, `Utils`, `World`, `Player`,
  `Entities`, `Skills`, `Combat`, `UI`, `Net`, `Voice`, `SFX`). Script order in
  `index.html` matters. Keep it ES5-friendly (Three.js r128 UMD).
- The world RNG (`Utils.rand`, seeded) **must stay deterministic during init** so all
  clients share the same map. Network identity in `net.js` uses `Math.random` on purpose.
- When you add a feature, extend `selftest.js` with an assertion and keep it green.
- The Bun server must be **restarted manually** after editing `server.js` (client
  live-reload only reloads the browser). Client-file edits auto-reload via `/__mtime`.
- LAN access needs the Windows Firewall to allow inbound TCP 8080 for the Bun process.
- Ideas not yet done: server-authoritative enemies, chat (server already relays a
  `chat` message type), item drops, more skills, sound polish.
