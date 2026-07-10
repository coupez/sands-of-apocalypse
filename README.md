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
- **Six skills**: Attack, Strength, Defence, Woodcutting, Mining, Fishing — RS-style XP
  curve, level-ups, 28-slot inventory. Strength drives max hit, Defence mitigates damage.
- **Level-gated content**: higher-tier trees (Blightwood), ore (Plutonium), fishing pools,
  and mutants (Mutant → Ghoul → Hell Brute) that need a skill level to harvest/fight.
- **Weapons & loot**: ruined buildings hold chests → Scrap Sword, Rusty Pistol, and the
  **Fanny Pack of Doom** (strongest — instakills). Equipped weapon shown in the HUD.
- **Combat**: hitsplats (hit/crit/miss/dodge), floating enemy HP bars, death & respawn,
  player HP globe; damage scales with Strength + weapon, accuracy with Attack + weapon.
- **Enemy AI**: mutants wander, aggro & chase within range, leash home; die into a
  **fiery hell portal** (sink + spin + red light). Three visually **distinct low-poly
  silhouettes** per tier (lanky Mutant, gaunt clawed Ghoul, bulky horned Hell Brute).
- **Impact-timed animations**: player chop / mine / fish / attack and enemy strikes each
  have distinct windup→strike→recover motion whose contact frame is synced to the actual
  hit. Enemy strikes are **server-broadcast** (`enemyAttack`) so every client sees the swing
  in sync with the real damage.
- **Buildings**: the sagging roof **lifts off automatically** when you step inside, so you
  can see the chest and loot within.
- **Dodge roll** with invulnerability frames (Shift).
- **Death sequence**: dance → backflip → collapse → "YOU DIED" → respawn; player shouts a
  Flemish line (`o nee godverdomme ik ben dood`) via TTS.
- **Multiplayer** (WebSocket): see other players in real time with nameplates.
- **Server-authoritative world**: enemies and resource depletion live on the server, so all
  players see the same mutants, deaths, and depleted trees.
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
  entities.js        tiered trees/rocks/pools/mutants, barrels, buildings+chests,
                     enemy AI, resource respawn, hell-death, server-driven render path
  net.js             multiplayer client: WS, remote avatars, PvP + world sync, nameplates
  skills.js          6 skills + XP, inventory, items, equippable weapons
  combat.js          damage rolls (Strength/Defence/weapon), hitsplats, enemy/PvP attacks
  ui.js              HUD wiring: vitals, skills, inventory, hitsplats, labels, speech, death
  selftest.js        headless end-to-end self-test (see below)
  main.js            bootstrap, input routing (raycast), game loop
```

### Multiplayer / authority model

The server (`server.js`) is authoritative for the **shared world**:

- **Players**: server holds a registry, broadcasts a pose snapshot ~15×/sec; clients stream
  their pose ~12×/sec. Each client is authoritative over **its own HP/death** — incoming
  damage (PvP or from a mutant) arrives as a `hit` event and the victim applies it (and can
  dodge it with i-frames).
- **Enemies**: server runs the mutant AI (wander/aggro/chase/attack/leash), HP, death, and
  respawn, and includes them in the snapshot. Clients render enemies from the snapshot when
  online. A player's hit is sent as `attackEnemy`; the server applies it and broadcasts
  `enemyHit` / `enemyDead` / `enemyRespawn`. When a server enemy lands a blow it also
  broadcasts `enemyAttack {i}`, so every client plays that enemy's strike swing in sync
  with the actual damage (not just the victim).
- **Resources**: server owns depletion/respawn. A successful harvest sends `gather`; the
  server decrements and broadcasts a `resource` deplete/restore event.
- Enemy/resource **indices** are shared: the client builds the same count & tier order
  locally, so index `i` refers to the same creature/resource everywhere. Enemy positions
  come from the server; resource positions are local (identical across clients via a fixed
  RNG seed) and only their active-state is synced.
- **Offline fallback**: with no server (e.g. self-test, or a dropped connection) the client
  runs the full local simulation. `Game.online` toggles between the two paths.

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

Current status: **logic self-test 57/57**. A 2-browser (CDP-driven headless Chrome) sync
test confirms combat is server-authoritative end-to-end: attacking an enemy on one client
drops its HP and kills it on the other client; the `enemyAttack` broadcast reaches every
client. WS relay tests (combat + enemyAttack) pass.

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
- `autopull.ps1` (run in the background) fetches + rebases from `origin/main` every 5 min
  and logs to `autopull.log`; conflicts are logged as `CONFLICT` for an agent to resolve.
- Enemy/resource **indices must stay aligned** between `server.js` (ENEMY_PLAN / RES counts)
  and the client's `Entities.init` spawn order. If you change counts or tier order in one,
  change both, or online play will address the wrong object. `scatter()` guarantees the
  requested count so this holds.
- **Intentional tradeoff**: online, the harvesting client credits its own item/XP on a local
  success roll for snappy feedback, while the server owns depletion/respawn. With several
  players on one resource, total items extracted can slightly exceed its amount before the
  depletion broadcast lands. Fine for a demo; make gathering server-confirmed if it matters.
- Enemy damage online is client-computed then applied server-side (clamped) — authoritative
  over enemy HP/state, not over the damage number. Add server-side rolls to make it cheat-proof.
- Ideas not yet done: shared player inventories/trading, chat UI (server already relays a
  `chat` message type), item drops on the ground, more skills, sound/music polish,
  server-authoritative fishing pools & chests.
