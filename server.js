// ============================================================
// Sands of Apocalypse — Bun server
//   * Serves the static game over http (LAN-reachable on 0.0.0.0)
//   * WebSocket /ws for real-time multiplayer player presence
//   * Server holds authoritative player registry, broadcasts a
//     snapshot to all clients ~15x/sec
//   * /__mtime powers the browser live-reload
// Run:  bun server.js   (optionally PORT env)
// ============================================================

import { statSync, readdirSync } from "fs";
import { join, normalize, extname } from "path";

const ROOT = import.meta.dir;
const PORT = Number(process.env.PORT || 8080);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// ---- live-reload: newest source mtime ----
function newestMtime(dir) {
  let max = 0;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return max; }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      max = Math.max(max, newestMtime(full));
    } else if (/\.(html|js|css)$/.test(e.name)) {
      try { max = Math.max(max, statSync(full).mtimeMs); } catch {}
    }
  }
  return max;
}

// ---- multiplayer state ----
/** id -> { id, name, color, x, z, ry, state, hp, ready } */
const players = new Map();
let roundOver = false;      // a player has won; a restart is scheduled
let restartTimer = null;    // pending win-countdown timeout
let hostId = null;          // first player to join — chooses the game mode
let mode = "pending";       // 'pending' | 'versus' | 'coop' (write-once per session)
let coop = { sigils: {}, ritualReady: false, boss: null, builds: [], won: false };   // shared co-op state
let versus = { altars: {}, scores: {} };   // versus: altar key -> ownerId; id -> points
const ALTAR_KEYS = ["bandit", "merchant"];

// ============================================================
// Authoritative shared world: enemies + resource depletion.
// Clients render this; their local sim only runs when offline.
// Enemy counts/tiers are ordered to match the client's local
// generation so index i refers to the same creature everywhere.
// ============================================================
function rngFactory(seed) {
  let s = seed >>> 0;
  return function () { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return (s >>> 0) / 4294967296; };
}
const wrand = rngFactory(0x5eed1e);
const wrange = (a, b) => a + wrand() * (b - a);

const ETIERS = [
  { hp: 10, def: 1, maxHit: 3,  aggro: 8.5, speed: 3.5, atk: 1.6, range: 2.0 },
  { hp: 22, def: 4, maxHit: 6,  aggro: 9.5, speed: 3.8, atk: 1.6, range: 2.4 },
  { hp: 45, def: 8, maxHit: 10, aggro: 11,  speed: 4.1, atk: 1.8, range: 3.0 },
];
// No roaming enemies (combat is at the client-side bandit camps). Restore to
// [[4, 0], [3, 1], [2, 2]] (9 total) to bring the open-field mutants back.
const ENEMY_PLAN = [];
const BANDS = [[12, 30], [28, 44], [42, 56]];
const enemies = [];
(function genEnemies() {
  let idx = 0;
  for (const [count, tier] of ENEMY_PLAN) {
    for (let n = 0; n < count; n++) {
      const a = wrange(0, Math.PI * 2), r = wrange(BANDS[tier][0], BANDS[tier][1]);
      const x = Math.cos(a) * r, z = Math.sin(a) * r, T = ETIERS[tier];
      enemies.push({ i: idx++, tier, x, z, ry: 0, hp: T.hp, maxHp: T.hp, def: T.def, maxHit: T.maxHit,
        aggro: T.aggro, speed: T.speed, atkInt: T.atk, range: T.range, leash: 24,
        home: { x, z }, state: "wander", wander: null, idle: 0, atkT: 0, respawnT: 0 });
    }
  }
})();

// resource depletion state: trees 11 (8 t0 + 3 t1), rocks 8 (6 t0 + 2 t1)
const RES = {
  tree: Array.from({ length: 11 }, () => ({ active: true, amount: 8, respawnT: 0 })),
  rock: Array.from({ length: 8 }, () => ({ active: true, amount: 7, respawnT: 0 })),
};

// Reset the server-authoritative world (resources + enemies) for a new round.
function resetServerWorld() {
  for (const kind of ["tree", "rock"]) {
    RES[kind].forEach((r) => { r.active = true; r.amount = kind === "tree" ? 8 : 7; r.respawnT = 0; });
  }
  for (const e of enemies) {
    e.state = "wander"; e.hp = e.maxHp; e.x = e.home.x; e.z = e.home.z;
    e.wander = null; e.idle = 0; e.atkT = 0; e.respawnT = 0;
  }
}
// Broadcast a full round restart to every client (clients own obelisk/bandits/drops).
function doRestart() {
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  roundOver = false;
  versus = { altars: {}, scores: {} };
  resetServerWorld();
  server.publish("game", JSON.stringify({ type: "restart" }));
}

// ---- co-op boss (Mahrûk) — server-authoritative HP + slam windows ----
const BOSS = { maxHp: 600, slamInterval: 7.0, windup: 1.1, vuln: 3.0, reach: 9, slamRadius: 6, slamDmg: 11, maxStagger: 100, staggerDur: 5.0 };
function bossPhase(b) { return b.hp > b.maxHp * 0.66 ? 1 : b.hp > b.maxHp * 0.33 ? 2 : 3; }
function bossSlamInterval(b) { const f = b.hp / b.maxHp; return f > 0.66 ? BOSS.slamInterval : f > 0.33 ? 5.3 : 4.0; }
function bossFull() {
  const b = coop.boss;
  return { type: "bossState", active: b.active, phase: bossPhase(b), hp: b.hp, maxHp: b.maxHp,
    stagger: b.stagger, maxStagger: BOSS.maxStagger, stage: b.stage, hand: b.hand, hx: b.hx, hz: b.hz };
}
function startBoss() {
  coop.boss = { active: true, hp: BOSS.maxHp, maxHp: BOSS.maxHp, stagger: 0, phase: 1, stage: "idle", hand: "L", hx: 0, hz: 0, vulnT: 0, timer: BOSS.slamInterval };
  server.publish("game", JSON.stringify(bossFull()));
}
function simBoss(dt) {
  const b = coop.boss;
  if (!b || !b.active) return;
  if (b.stage === "idle") {
    b.timer -= dt;
    if (b.timer <= 0) {
      const live = [...players.values()].filter((p) => p.ready && (p.hp == null || p.hp > 0) && p.state !== "dead");
      const np = live.length ? live[Math.floor(Math.random() * live.length)] : null;
      const px = np ? np.x : 0, pz = np ? np.z : 0, d = Math.hypot(px, pz) || 1;
      b.hx = +(px / d * BOSS.reach).toFixed(2); b.hz = +(pz / d * BOSS.reach).toFixed(2);
      b.hand = Math.random() < 0.5 ? "L" : "R";
      b.stage = "windup"; b.timer = BOSS.windup;
      server.publish("game", JSON.stringify(bossFull()));
    }
  } else if (b.stage === "windup") {
    b.timer -= dt;
    if (b.timer <= 0) {
      b.stage = "vuln"; b.vulnT = BOSS.vuln;
      server.publish("game", JSON.stringify(bossFull()));
      server.publish("game", JSON.stringify({ type: "bossSlam", stage: "impact", x: b.hx, z: b.hz, radius: BOSS.slamRadius, dmg: BOSS.slamDmg }));
    }
  } else if (b.stage === "vuln" || b.stage === "stagger") {
    b.vulnT -= dt;
    if (b.vulnT <= 0) {
      if (b.stage === "stagger") b.stagger = 0;
      b.stage = "idle"; b.hand = null; b.timer = bossSlamInterval(b);
      server.publish("game", JSON.stringify(bossFull()));
    }
  }
}
function bossHit(part, dmg, stagAmt) {
  const b = coop.boss;
  if (!b || !b.active) return;
  if (b.stage !== "vuln" && b.stage !== "stagger") return;   // window closed
  if (part !== "hand" && part !== "heart") return;
  const d = Math.max(0, Math.min(80, Math.floor(dmg)));
  // heart = real HP damage (bow/ballista); hand = a chip + builds the stagger meter (melee)
  if (part === "heart") b.hp = Math.max(0, b.hp - d);
  else b.hp = Math.max(0, b.hp - Math.floor(d * 0.25));
  if (stagAmt > 0 && b.stage !== "stagger") b.stagger = Math.min(BOSS.maxStagger, b.stagger + Math.max(0, Math.min(50, Math.floor(stagAmt))));
  // full stagger → Mahrûk reels: a long window where the heart is wide open
  if (b.stagger >= BOSS.maxStagger && b.stage !== "stagger") { b.stage = "stagger"; b.vulnT = BOSS.staggerDur; server.publish("game", JSON.stringify(bossFull())); }
  server.publish("game", JSON.stringify({ type: "bossHit", part, dmg: Math.floor(d), hp: b.hp, stagger: b.stagger }));
  if (b.hp <= 0) {
    b.active = false;
    coop.boss = null;
    coop.ritualReady = false;   // victory is final — no re-summon loop
    coop.won = true;
    server.publish("game", JSON.stringify({ type: "bossDead" }));
  }
}

function nearestPlayer(x, z) {
  let best = null, bd = Infinity;
  for (const p of players.values()) {
    if (!p.ready || (typeof p.hp === "number" && p.hp <= 0) || p.state === "dead") continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { p: best, d: bd } : null;
}

function simWorld(dt) {
  for (const e of enemies) {
    if (e.state === "dead") {
      e.respawnT -= dt;
      if (e.respawnT <= 0) {
        e.state = "wander"; e.hp = e.maxHp; e.x = e.home.x; e.z = e.home.z; e.wander = null;
        server.publish("game", JSON.stringify({ type: "enemyRespawn", i: e.i, x: e.x, z: e.z }));
      }
      continue;
    }
    const np = nearestPlayer(e.x, e.z);
    const dHome = Math.hypot(e.home.x - e.x, e.home.z - e.z);
    let st = e.state;
    if (dHome >= e.leash) st = "returning";
    else if (np && np.d <= e.aggro) st = (np.d <= e.range) ? "attack" : "chase";
    else if (st === "chase" || st === "attack") st = "wander";
    e.state = st;

    let tx = null, tz = null, speed = 0;
    if (st === "wander") {
      if (!e.wander || e.idle > 0) {
        e.idle -= dt;
        if (!e.wander) { const a = wrange(0, Math.PI * 2), r = wrange(1, 7); e.wander = { x: e.home.x + Math.cos(a) * r, z: e.home.z + Math.sin(a) * r }; e.idle = 0; }
      }
      tx = e.wander.x; tz = e.wander.z; speed = 1.6;
      if (Math.hypot(tx - e.x, tz - e.z) < 0.4) { e.wander = null; e.idle = wrange(1, 3); }
    } else if (st === "chase") { tx = np.p.x; tz = np.p.z; speed = e.speed; }
    else if (st === "attack") {
      e.ry = Math.atan2(np.p.x - e.x, np.p.z - e.z);
      e.atkT += dt;
      if (np.d > e.range * 1.15) e.state = "chase";
      if (e.atkT >= e.atkInt) {
        e.atkT = 0;
        const dmg = (Math.random() < 0.6) ? (1 + Math.floor(Math.random() * e.maxHit)) : 0;
        // broadcast the strike so every client plays this enemy's attack swing
        // in sync with the actual hit (not just the victim)
        server.publish("game", JSON.stringify({ type: "enemyAttack", i: e.i }));
        server.publish("game", JSON.stringify({ type: "hit", from: "enemy" + e.i, target: np.p.id, dmg }));
      }
    } else if (st === "returning") { tx = e.home.x; tz = e.home.z; speed = e.speed * 0.8; if (dHome < 1) { e.state = "wander"; e.wander = null; } }

    if (tx !== null && e.state !== "attack") {
      const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
      if (d > 0.05) {
        const stop = e.state === "chase" ? e.range * 0.9 : 0.1;
        if (d > stop) { const step = Math.min(speed * dt, d - stop * 0.5); e.x += dx / d * step; e.z += dz / d * step; e.ry = Math.atan2(dx, dz); }
      }
    }
  }
  // resource respawns
  for (const kind of ["tree", "rock"]) {
    RES[kind].forEach((r, i) => {
      if (!r.active && r.respawnT > 0) {
        r.respawnT -= dt;
        if (r.respawnT <= 0) { r.active = true; r.amount = kind === "tree" ? 8 : 7; server.publish("game", JSON.stringify({ type: "resource", kind, i, active: true })); }
      }
    });
  }
}

function snapshot() {
  const arr = [];
  for (const p of players.values()) {
    if (!p.ready) continue; // hasn't sent a position yet
    arr.push({ id: p.id, name: p.name, color: p.color, x: p.x, z: p.z, ry: p.ry, state: p.state, hp: p.hp, app: p.app || null });
  }
  const es = [];
  for (const e of enemies) {
    if (e.state === "dead") continue; // dead ones handled by enemyDead/Respawn events
    es.push({ i: e.i, x: +e.x.toFixed(2), z: +e.z.toFixed(2), ry: +e.ry.toFixed(2), state: e.state, hp: e.hp });
  }
  const boss = (coop.boss && coop.boss.active) ? { hp: coop.boss.hp, stagger: coop.boss.stagger } : null;
  return JSON.stringify({ type: "snapshot", players: arr, enemies: es, boss, serverTime: Date.now() });
}

let uid = 0;
function newId() { uid++; return "p" + uid.toString(36) + "_" + Math.random().toString(36).slice(2, 8); }

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  development: false,

  fetch(req, server) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);

    // WebSocket upgrade
    if (path === "/ws") {
      const ok = server.upgrade(req, { data: { id: newId() } });
      if (ok) return undefined;
      return new Response("upgrade failed", { status: 400 });
    }

    // live-reload timestamp
    if (path === "/__mtime") {
      return Response.json({ mtime: Math.floor(newestMtime(ROOT)) }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    // simple debug endpoint
    if (path === "/__players") {
      return Response.json({ count: [...players.values()].filter(p => p.ready).length });
    }

    // static files
    if (path === "/") path = "/index.html";
    const full = normalize(join(ROOT, path));
    if (!full.startsWith(ROOT)) return new Response("forbidden", { status: 403 });

    const file = Bun.file(full);
    const ext = extname(full).toLowerCase();
    const headers = { "Cache-Control": "no-store" };
    if (MIME[ext]) headers["Content-Type"] = MIME[ext];
    return file.exists().then((ex) =>
      ex ? new Response(file, { headers })
         : new Response("404 Not Found: " + path, { status: 404 })
    );
  },

  websocket: {
    open(ws) {
      const id = ws.data.id;
      // camp slot: 1 = north (player 1), 2 = south (player 2); extras default to 1
      const used = new Set([...players.values()].map((p) => p.slot).filter(Boolean));
      const slot = !used.has(1) ? 1 : (!used.has(2) ? 2 : 1);
      players.set(id, { id, name: "Wanderer", color: "#8dff3a", x: 0, z: 0, ry: 0, state: "idle", hp: 20, ready: false, slot });
      ws.subscribe("game");
      if (!hostId) hostId = id;   // first player is the host and picks the mode
      ws.send(JSON.stringify({ type: "welcome", id, slot, mode, isHost: id === hostId }));
      // reconcile current world state so a late joiner doesn't see dead mutants
      // as alive or depleted resources as full
      ws.send(JSON.stringify({
        type: "worldInit", mode, coop,
        deadEnemies: enemies.filter((e) => e.state === "dead").map((e) => e.i),
        resources: { tree: RES.tree.map((r) => r.active), rock: RES.rock.map((r) => r.active) },
      }));
      console.log(`[ws] join ${id}  (online: ${players.size}, mode: ${mode})`);
      // Versus: a new rival restarts the race. Co-op: drop-in help, no restart.
      // While pending (host hasn't chosen): never restart.
      if (mode === "versus" && players.size > 1) doRestart();
    },
    message(ws, raw) {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === "state") {
        const p = players.get(ws.data.id);
        if (!p) return;
        if (typeof msg.name === "string") p.name = msg.name.slice(0, 24);
        if (typeof msg.color === "string") p.color = msg.color.slice(0, 9);
        if (Number.isFinite(msg.x)) p.x = msg.x;
        if (Number.isFinite(msg.z)) p.z = msg.z;
        if (Number.isFinite(msg.ry)) p.ry = msg.ry;
        if (typeof msg.state === "string") p.state = msg.state.slice(0, 12);
        if (Number.isFinite(msg.hp)) p.hp = msg.hp;
        if (msg.app && typeof msg.app === "object") p.app = msg.app;   // equipped gear tiers
        p.ready = true;
        // a hero falling during the boss feeds Mahrûk a little (deters zerging)
        const nowDead = (typeof p.hp === "number" && p.hp <= 0) || p.state === "dead";
        if (nowDead && !p._dead && coop.boss && coop.boss.active) {
          coop.boss.hp = Math.min(coop.boss.maxHp, coop.boss.hp + Math.round(coop.boss.maxHp * 0.05));
          server.publish("game", JSON.stringify(bossFull()));
        }
        p._dead = nowDead;
      } else if (msg.type === "attack" && typeof msg.target === "string" && Number.isFinite(msg.dmg)) {
        // relay a PvP hit; victim's client is authoritative over its own HP
        const dmg = Math.max(0, Math.min(99, Math.floor(msg.dmg)));
        server.publish("game", JSON.stringify({ type: "hit", from: ws.data.id, target: msg.target, dmg }));
      } else if (msg.type === "attackEnemy" && Number.isInteger(msg.i) && Number.isFinite(msg.dmg)) {
        // authoritative enemy damage
        const e = enemies[msg.i];
        if (e && e.state !== "dead") {
          const dmg = Math.max(0, Math.min(999, Math.floor(msg.dmg)));
          e.hp = Math.max(0, e.hp - dmg);
          server.publish("game", JSON.stringify({ type: "enemyHit", i: e.i, dmg }));
          if (e.hp <= 0) {
            e.state = "dead"; e.respawnT = 6;
            server.publish("game", JSON.stringify({ type: "enemyDead", i: e.i, x: +e.x.toFixed(2), z: +e.z.toFixed(2), by: ws.data.id }));
          }
        }
      } else if (msg.type === "gather" && (msg.kind === "tree" || msg.kind === "rock") && Number.isInteger(msg.i)) {
        // authoritative resource depletion
        const r = RES[msg.kind][msg.i];
        if (r && r.active) {
          r.amount--;
          if (r.amount <= 0) { r.active = false; r.respawnT = msg.kind === "tree" ? 8 : 6; server.publish("game", JSON.stringify({ type: "resource", kind: msg.kind, i: msg.i, active: false })); }
        }
      } else if (msg.type === "chat" && typeof msg.text === "string") {
        const p = players.get(ws.data.id);
        server.publish("game", JSON.stringify({ type: "chat", id: ws.data.id, name: p ? p.name : "?", text: msg.text.slice(0, 120) }));
      } else if (msg.type === "chooseMode" && ws.data.id === hostId && mode === "pending" && (msg.mode === "versus" || msg.mode === "coop")) {
        // host locks in the game mode (write-once); versus does one clean restart
        mode = msg.mode;
        server.publish("game", JSON.stringify({ type: "mode", mode, coop }));
        if (mode === "versus") doRestart();
      } else if (msg.type === "sigil" && mode === "coop" && typeof msg.which === "string") {
        // record a lit sigil (idempotent), recompute ritual readiness, broadcast
        const valid = ["forge", "hunt", "plenty", "deep", "devotion"];
        if (valid.indexOf(msg.which) >= 0 && !coop.sigils[msg.which]) {
          coop.sigils[msg.which] = true;
          coop.ritualReady = valid.filter((k) => coop.sigils[k]).length >= 3;
          server.publish("game", JSON.stringify({ type: "sigil", which: msg.which, lit: true, ritualReady: coop.ritualReady }));
        }
      } else if (msg.type === "placeEssence" && mode === "versus" && ALTAR_KEYS.indexOf(msg.key) >= 0) {
        // first to place an essence claims that altar (locked for the rest) + scores
        if (!versus.altars[msg.key]) {
          const p = players.get(ws.data.id);
          const name = (p && p.name) || "A rival";
          versus.altars[msg.key] = ws.data.id;
          versus.scores[ws.data.id] = (versus.scores[ws.data.id] || 0) + 1;
          server.publish("game", JSON.stringify({ type: "altarClaimed", key: msg.key, by: ws.data.id, name }));
          // claiming a strict majority of altars wins the round
          if (versus.scores[ws.data.id] > ALTAR_KEYS.length / 2 && !roundOver) {
            server.publish("game", JSON.stringify({ type: "win", name, restartIn: 10 }));
            roundOver = true; restartTimer = setTimeout(doRestart, 10000);
          }
        }
      } else if (msg.type === "build" && mode === "coop" && typeof msg.id === "string" && Number.isFinite(msg.x) && Number.isFinite(msg.z)) {
        if (coop.builds.length < 40) {
          const b = { id: msg.id.slice(0, 16), x: +msg.x, z: +msg.z };
          coop.builds.push(b);
          server.publish("game", JSON.stringify({ type: "build", id: b.id, x: b.x, z: b.z }));
        }
      } else if (msg.type === "ritualStart" && mode === "coop" && coop.ritualReady && (!coop.boss || !coop.boss.active)) {
        startBoss();
      } else if (msg.type === "bossHit" && mode === "coop") {
        bossHit(msg.part, msg.dmg, msg.stagger);
      } else if (msg.type === "win") {
        // first player to place the Heart wins — relay to everyone + start the
        // 10s countdown, then restart the whole game for a fresh round
        const p = players.get(ws.data.id);
        const name = (p && p.name) ? p.name : (typeof msg.name === "string" ? msg.name.slice(0, 24) : "A rival");
        server.publish("game", JSON.stringify({ type: "win", name, restartIn: 10 }));
        if (!roundOver) { roundOver = true; restartTimer = setTimeout(doRestart, 10000); }
      } else if (msg.type === "level" && typeof msg.skill === "string" && Number.isFinite(msg.level)) {
        // broadcast a level-up so everyone hears it (id lets the sender skip its echo)
        const p = players.get(ws.data.id);
        server.publish("game", JSON.stringify({ type: "level", id: ws.data.id,
          name: (p && p.name) ? p.name : (typeof msg.name === "string" ? msg.name.slice(0, 24) : "A wanderer"),
          skill: msg.skill.slice(0, 16), level: Math.max(1, Math.min(99, Math.floor(msg.level))), max: !!msg.max }));
      }
    },
    close(ws) {
      const id = ws.data.id;
      players.delete(id);
      server.publish("game", JSON.stringify({ type: "leave", id }));
      // if the host left, promote the oldest remaining player (and prompt if still pending)
      if (id === hostId) {
        const next = players.keys().next();
        hostId = next.done ? null : next.value;
        if (hostId && mode === "pending") server.publish("game", JSON.stringify({ type: "chooseMode", host: hostId }));
      }
      // empty session → back to a clean pending state for the next lobby
      if (players.size === 0) {
        mode = "pending"; hostId = null; coop = { sigils: {}, ritualReady: false, boss: null, builds: [], won: false };
        versus = { altars: {}, scores: {} };
        roundOver = false;
        if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      }
      console.log(`[ws] leave ${id}  (online: ${players.size})`);
    },
  },
});

// simulate the world + broadcast snapshots ~15x/sec
setInterval(() => {
  if (players.size === 0) return;
  simWorld(0.066);
  if (coop.boss && coop.boss.active) simBoss(0.066);
  server.publish("game", snapshot());
}, 66);

console.log(`Sands of Apocalypse server running: http://0.0.0.0:${PORT}  (root ${ROOT})`);
