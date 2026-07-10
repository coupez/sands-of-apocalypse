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

function snapshot() {
  const arr = [];
  for (const p of players.values()) {
    if (!p.ready) continue; // hasn't sent a position yet
    arr.push({ id: p.id, name: p.name, color: p.color, x: p.x, z: p.z, ry: p.ry, state: p.state, hp: p.hp });
  }
  return JSON.stringify({ type: "snapshot", players: arr, serverTime: Date.now() });
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
      players.set(id, { id, name: "Wanderer", color: "#8dff3a", x: 0, z: 0, ry: 0, state: "idle", hp: 20, ready: false });
      ws.subscribe("game");
      ws.send(JSON.stringify({ type: "welcome", id }));
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

// broadcast snapshots ~15x/sec
setInterval(() => {
  if (players.size === 0) return;
  server.publish("game", snapshot());
}, 66);

console.log(`Sands of Apocalypse server running: http://0.0.0.0:${PORT}  (root ${ROOT})`);
