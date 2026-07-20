// ============================================================
// grid.js — tile grid + A* pathfinding for RuneScape-style movement.
// The world is diced into square tiles. Static obstacles (trees, rocks,
// plants, stations, altars, the obelisk) block tiles; the player paths
// around them tile-to-tile. Enemies are NOT stored here — they collide
// via a separate separation pass so the player can run through them.
// Positions stay continuous world-coords; only the local pathing is gridded,
// so multiplayer/netcode is unaffected.
// ============================================================

var Grid = (function () {
  var TILE = 2;                 // world units per tile
  var cols = 0, rows = 0, ox = 0, oz = 0;
  var blocked = null;           // Uint8Array, 1 = blocked
  var inited = false;

  function ensure() {
    if (inited) return;
    var W = (window.World && World.WORLD_SIZE) ? World.WORLD_SIZE : 144;
    cols = Math.ceil(W / TILE); rows = cols;
    ox = -cols * TILE / 2; oz = -rows * TILE / 2;
    blocked = new Uint8Array(cols * rows);
    inited = true;
  }
  function idx(tx, tz) { return tz * cols + tx; }
  function inB(tx, tz) { return tx >= 0 && tz >= 0 && tx < cols && tz < rows; }
  function worldToTile(x, z) { ensure(); return { tx: Math.floor((x - ox) / TILE), tz: Math.floor((z - oz) / TILE) }; }
  function tileCenter(tx, tz) { return { x: ox + (tx + 0.5) * TILE, z: oz + (tz + 0.5) * TILE }; }
  function walkable(tx, tz) { return inB(tx, tz) && !blocked[idx(tx, tz)]; }

  function clearBlocks() { ensure(); for (var i = 0; i < blocked.length; i++) blocked[i] = 0; }
  function blockCircle(x, z, r) {
    ensure();
    var a = worldToTile(x - r, z - r), b = worldToTile(x + r, z + r);
    var rr = (r + TILE * 0.3) * (r + TILE * 0.3);
    for (var tz = a.tz; tz <= b.tz; tz++) for (var tx = a.tx; tx <= b.tx; tx++) {
      if (!inB(tx, tz)) continue;
      var c = tileCenter(tx, tz);
      if ((c.x - x) * (c.x - x) + (c.z - z) * (c.z - z) <= rr) blocked[idx(tx, tz)] = 1;
    }
  }

  // nearest walkable tile to (tx,tz), searched in growing rings
  function nearestWalkable(tx, tz) {
    if (walkable(tx, tz)) return { tx: tx, tz: tz };
    for (var rad = 1; rad < 16; rad++) {
      for (var dz = -rad; dz <= rad; dz++) for (var dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== rad) continue;
        if (walkable(tx + dx, tz + dz)) return { tx: tx + dx, tz: tz + dz };
      }
    }
    return null;
  }

  var NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
           [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

  function key(x, z) { return x + ',' + z; }

  // A* from (sx,sz) to the first tile where isGoal(x,z) is true; heuristic aims at (fx,fz)
  function astar(sx, sz, isGoal, fx, fz) {
    var open = [{ x: sx, z: sz, f: 0 }];
    var g = {}, came = {}, closed = {};
    g[key(sx, sz)] = 0;
    function h(x, z) { var dx = Math.abs(x - fx), dz = Math.abs(z - fz); return (dx + dz) - 0.586 * Math.min(dx, dz); }
    var guard = 0;
    while (open.length && guard++ < 9000) {
      var bi = 0;
      for (var i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      var cur = open.splice(bi, 1)[0];
      var ck = key(cur.x, cur.z);
      if (closed[ck]) continue;
      closed[ck] = 1;
      if (isGoal(cur.x, cur.z)) return reconstruct(came, cur.x, cur.z, sx, sz);
      for (var n = 0; n < NB.length; n++) {
        var nx = cur.x + NB[n][0], nz = cur.z + NB[n][1];
        if (!walkable(nx, nz)) continue;
        if (NB[n][2] > 1 && (!walkable(cur.x + NB[n][0], cur.z) || !walkable(cur.x, cur.z + NB[n][1]))) continue; // no corner-cut
        var nk = key(nx, nz);
        if (closed[nk]) continue;
        var ng = g[ck] + NB[n][2];
        if (g[nk] === undefined || ng < g[nk]) {
          g[nk] = ng; came[nk] = ck;
          open.push({ x: nx, z: nz, f: ng + h(nx, nz) });
        }
      }
    }
    return null;
  }
  function reconstruct(came, gx, gz, sx, sz) {
    var out = [], x = gx, z = gz;
    while (!(x === sx && z === sz)) {
      out.unshift(tileCenter(x, z));
      var p = came[key(x, z)];
      if (!p) break;
      var parts = p.split(','); x = +parts[0]; z = +parts[1];
    }
    return out;   // world centers, start tile excluded
  }

  // is the straight line between two world points clear of blocked tiles?
  function lineWalkable(ax, az, bx, bz) {
    var dist = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
    var steps = Math.max(1, Math.ceil(dist / (TILE * 0.34)));   // dense enough to hit every tile crossed
    for (var i = 0; i <= steps; i++) {
      var t = i / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      var tt = worldToTile(x, z);
      if (!walkable(tt.tx, tt.tz)) return false;
    }
    return true;
  }
  // String-pull the tile path: keep only the waypoints you can't reach in a straight
  // line, so the character walks smooth diagonals instead of stair-stepping tile centres.
  function smooth(fromWorld, pts) {
    if (!pts || pts.length < 2) return pts;
    var out = [], cx = fromWorld.x, cz = fromWorld.z, i = 0;
    while (i < pts.length) {
      var j = i;
      for (var k = pts.length - 1; k > i; k--) {
        if (lineWalkable(cx, cz, pts[k].x, pts[k].z)) { j = k; break; }
      }
      out.push(pts[j]);
      cx = pts[j].x; cz = pts[j].z;
      i = j + 1;
    }
    return out;
  }

  // Path to a walkable tile at (toWorld). Returns array of world waypoints, or null.
  function findPath(fromWorld, toWorld) {
    ensure();
    var s = worldToTile(fromWorld.x, fromWorld.z);
    var tt = worldToTile(toWorld.x, toWorld.z);
    var goal = nearestWalkable(tt.tx, tt.tz);
    if (!goal) return null;
    if (!walkable(s.tx, s.tz)) { var ns = nearestWalkable(s.tx, s.tz); if (ns) s = ns; }
    if (s.tx === goal.tx && s.tz === goal.tz) return [{ x: toWorld.x, z: toWorld.z }];
    var path = astar(s.tx, s.tz, function (x, z) { return x === goal.tx && z === goal.tz; }, goal.tx, goal.tz);
    if (!path) return null;
    if (goal.tx === tt.tx && goal.tz === tt.tz) path.push({ x: toWorld.x, z: toWorld.z }); // exact stop on open ground
    return smooth(fromWorld, path);
  }

  // Path to a tile ADJACENT to (or on) the target's tile — for interacting with a blocked object.
  function findPathAdj(fromWorld, targetWorld) {
    ensure();
    var s = worldToTile(fromWorld.x, fromWorld.z);
    var tt = worldToTile(targetWorld.x, targetWorld.z);
    // orthogonal only: you must stand directly N/E/S/W of the object to use it
    function isGoal(x, z) { return (Math.abs(x - tt.tx) + Math.abs(z - tt.tz)) === 1 && walkable(x, z); }
    if (isGoal(s.tx, s.tz)) return [];
    if (!walkable(s.tx, s.tz)) { var ns = nearestWalkable(s.tx, s.tz); if (ns) s = ns; }
    var p = astar(s.tx, s.tz, isGoal, tt.tx, tt.tz);
    if (p) return smooth(fromWorld, p);
    return findPath(fromWorld, targetWorld);   // no clean adjacent tile → get as close as possible
  }

  // The next tile-CENTRE to move to when greedily heading toward (tx,tz) — used
  // to make enemies/critters hop tile-to-tile. Returns the current tile's centre
  // if none of the neighbours gets closer (or if the target is on this tile).
  function stepToward(fromX, fromZ, tx, tz) {
    ensure();
    var ct = worldToTile(fromX, fromZ);
    var best = tileCenter(ct.tx, ct.tz);
    var bd = (best.x - tx) * (best.x - tx) + (best.z - tz) * (best.z - tz);
    for (var i = 0; i < NB.length; i++) {
      var nx = ct.tx + NB[i][0], nz = ct.tz + NB[i][1];
      if (!walkable(nx, nz)) continue;
      if (NB[i][2] > 1 && (!walkable(ct.tx + NB[i][0], ct.tz) || !walkable(ct.tx, ct.tz + NB[i][1]))) continue;
      var c = tileCenter(nx, nz), d = (c.x - tx) * (c.x - tx) + (c.z - tz) * (c.z - tz);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  function setBlocked(tx, tz, v) { ensure(); if (inB(tx, tz)) blocked[idx(tx, tz)] = v ? 1 : 0; }
  return {
    ensure: ensure, clearBlocks: clearBlocks, blockCircle: blockCircle, setBlocked: setBlocked,
    worldToTile: worldToTile, tileCenter: tileCenter, walkable: walkable,
    nearestWalkable: nearestWalkable,
    findPath: findPath, findPathAdj: findPathAdj, stepToward: stepToward,
    get TILE() { return TILE; }
  };
})();
