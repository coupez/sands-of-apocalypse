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
// Enemies deactivated for now (matches the client's ENEMIES_ENABLED flag).
// Restore to [[4, 0], [3, 1], [2, 2]] (9 total) to bring them back.
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
    arr.push({ id: p.id, name: p.name, color: p.color, x: p.x, z: p.z, ry: p.ry, state: p.state, hp: p.hp });
  }
  const es = [];
  for (const e of enemies) {
    if (e.state === "dead") continue; // dead ones handled by enemyDead/Respawn events
    es.push({ i: e.i, x: +e.x.toFixed(2), z: +e.z.toFixed(2), ry: +e.ry.toFixed(2), state: e.state, hp: e.hp });
  }
  return JSON.stringify({ type: "snapshot", players: arr, enemies: es, serverTime: Date.now() });
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
      ws.send(JSON.stringify({ type: "welcome", id, slot }));
      // reconcile current world state so a late joiner doesn't see dead mutants
      // as alive or depleted resources as full
      ws.send(JSON.stringify({
        type: "worldInit",
        deadEnemies: enemies.filter((e) => e.state === "dead").map((e) => e.i),
        resources: { tree: RES.tree.map((r) => r.active), rock: RES.rock.map((r) => r.active) },
      }));
      console.log(`[ws] join ${id}  (online: ${players.size})`);
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
        p.ready = true;
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
      }
    },
    close(ws) {
      const id = ws.data.id;
      players.delete(id);
      server.publish("game", JSON.stringify({ type: "leave", id }));
      console.log(`[ws] leave ${id}  (online: ${players.size})`);
    },
  },
});

// simulate the world + broadcast snapshots ~15x/sec
setInterval(() => {
  if (players.size === 0) return;
  simWorld(0.066);
  server.publish("game", snapshot());
}, 66);

console.log(`Sands of Apocalypse server running: http://0.0.0.0:${PORT}  (root ${ROOT})`);
