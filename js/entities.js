// ============================================================
// entities.js — trees, ore rocks, hazard barrels, mutant enemies
// Also owns enemy AI (wander / aggro / chase / attack / leash) and
// resource depletion + respawn.
// ============================================================

var Entities = (function () {
  var scene;
  var trees = [], rocks = [], barrels = [], enemies = [];
  var interactMeshes = [];   // meshes tagged with userData.ref for raycasting

  function terrainY(x, z) {
    if (World.ground && World.ground.userData.heightAt) return World.ground.userData.heightAt(x, z);
    return 0;
  }

  function tag(mesh, ref) {
    mesh.traverse(function (o) { if (o.isMesh) { o.userData.ref = ref; interactMeshes.push(o); } });
  }
  function untag(ref) {
    interactMeshes = interactMeshes.filter(function (m) { return m.userData.ref !== ref; });
  }

  // ---------- Dead irradiated tree ----------
  function makeTree(x, z) {
    var g = new THREE.Group();
    var barkMat = new THREE.MeshStandardMaterial({ color: 0x2c2418, roughness: 1, flatShading: true });
    var glowMat = new THREE.MeshStandardMaterial({ color: 0x1a2a10, emissive: 0x6cff3a, emissiveIntensity: 0.35, roughness: 1, flatShading: true });
    var h = Utils.randRange(3.2, 5.0);
    var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, h, 6), barkMat);
    trunk.position.y = h / 2;
    g.add(trunk);
    // gnarled bare branches
    var branches = new THREE.Group();
    var nb = Utils.randInt(3, 5);
    for (var i = 0; i < nb; i++) {
      var b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.14, Utils.randRange(1.0, 1.8), 5), barkMat);
      b.position.y = h * Utils.randRange(0.55, 0.95);
      b.rotation.z = Utils.randRange(-1.1, 1.1);
      b.rotation.y = Utils.randRange(0, Math.PI * 2);
      b.position.x = Utils.randRange(-0.3, 0.3);
      branches.add(b);
    }
    // a few toxic glowing buds
    for (var j = 0; j < 4; j++) {
      var bud = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), glowMat);
      bud.position.set(Utils.randRange(-0.8, 0.8), h * Utils.randRange(0.6, 1.0), Utils.randRange(-0.8, 0.8));
      branches.add(bud);
    }
    g.add(branches);
    g.position.set(x, terrainY(x, z), z);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g);

    var ent = {
      type: 'tree', name: 'Dead Tree', mesh: g, position: g.position,
      active: true, interactRange: 2.2,
      branches: branches, fullHeight: h,
      amount: Utils.randInt(4, 7), maxAmount: 8, respawn: 0
    };
    tag(g, ent);
    return ent;
  }

  // ---------- Ore rock ----------
  function makeRock(x, z) {
    var g = new THREE.Group();
    var rockMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 1, flatShading: true });
    var oreMat = new THREE.MeshStandardMaterial({ color: 0x243018, emissive: 0x7cff3a, emissiveIntensity: 0.6, roughness: 0.6, flatShading: true });
    var body = new THREE.Mesh(new THREE.DodecahedronGeometry(Utils.randRange(1.0, 1.4), 0), rockMat);
    body.position.y = 0.7;
    body.rotation.set(Utils.randRange(0,1), Utils.randRange(0,3), Utils.randRange(0,1));
    g.add(body);
    var veins = new THREE.Group();
    for (var i = 0; i < 6; i++) {
      var v = new THREE.Mesh(new THREE.IcosahedronGeometry(Utils.randRange(0.12, 0.22), 0), oreMat);
      var a = Utils.randRange(0, Math.PI * 2), r = Utils.randRange(0.6, 1.1);
      v.position.set(Math.cos(a) * r, 0.7 + Utils.randRange(-0.3, 0.5), Math.sin(a) * r);
      veins.add(v);
    }
    g.add(veins);
    g.position.set(x, terrainY(x, z), z);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g);

    var ent = {
      type: 'rock', name: 'Ore Vein', mesh: g, position: g.position,
      active: true, interactRange: 2.2, veins: veins, body: body,
      amount: Utils.randInt(3, 6), maxAmount: 6, respawn: 0
    };
    tag(g, ent);
    return ent;
  }

  // ---------- Hazard barrel (atmosphere + light) ----------
  function makeBarrel(x, z) {
    var g = new THREE.Group();
    var yellow = new THREE.MeshStandardMaterial({ color: 0x8a7a1e, roughness: 0.7, flatShading: true });
    var glow = new THREE.MeshStandardMaterial({ color: 0x2a3a12, emissive: 0x8dff3a, emissiveIntensity: 1.2, roughness: 0.4 });
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.4, 10), yellow);
    body.position.y = 0.7;
    g.add(body);
    var top = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.15, 10), glow);
    top.position.y = 1.45;
    g.add(top);
    var stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.25, 10), new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 1 }));
    stripe.position.y = 0.7;
    g.add(stripe);
    var light = new THREE.PointLight(0x8dff3a, 1.4, 12, 2);
    light.position.y = 1.6;
    g.add(light);
    g.position.set(x, terrainY(x, z), z);
    g.rotation.y = Utils.randRange(0, Math.PI);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    var ent = { type: 'barrel', mesh: g, position: g.position, light: light, baseIntensity: 1.4, active: true };
    barrels.push(ent);
    return ent;
  }

  // ---------- Mutant enemy ----------
  function makeEnemy(x, z) {
    var g = new THREE.Group();
    var flesh = new THREE.MeshStandardMaterial({ color: 0x5c7a3a, roughness: 1, flatShading: true });
    var dark = new THREE.MeshStandardMaterial({ color: 0x33421f, roughness: 1, flatShading: true });
    var eyeMat = new THREE.MeshStandardMaterial({ color: 0x102000, emissive: 0xaaff33, emissiveIntensity: 1.5 });

    var body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 0.7), flesh);
    body.position.y = 1.35;
    body.rotation.x = 0.15; // hunched
    g.add(body);
    var head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.7), flesh);
    head.position.set(0, 2.05, 0.15);
    g.add(head);
    var eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.06), eyeMat);
    var eyeR = eyeL.clone();
    eyeL.position.set(-0.16, 2.08, 0.5); eyeR.position.set(0.16, 2.08, 0.5);
    g.add(eyeL); g.add(eyeR);
    // lumpy growths
    for (var i = 0; i < 3; i++) {
      var lump = new THREE.Mesh(new THREE.IcosahedronGeometry(Utils.randRange(0.18, 0.3), 0), dark);
      lump.position.set(Utils.randRange(-0.5, 0.5), 1.4 + Utils.randRange(-0.3, 0.6), Utils.randRange(-0.4, 0.4));
      g.add(lump);
    }
    var armL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.0, 0.24), flesh);
    var armR = armL.clone();
    armL.position.set(-0.62, 1.35, 0.1); armR.position.set(0.62, 1.35, 0.1);
    g.add(armL); g.add(armR);
    var legL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.3), dark);
    var legR = legL.clone();
    legL.position.set(-0.26, 0.45, 0); legR.position.set(0.26, 0.45, 0);
    g.add(legL); g.add(legR);

    g.position.set(x, terrainY(x, z), z);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g);

    var ent = {
      type: 'enemy', name: 'Mutant', mesh: g, position: g.position,
      active: true, interactRange: 1.9,
      hp: 10, maxHp: 10, def: 1, maxHit: 3, attackInterval: 1.6,
      home: new THREE.Vector3(x, 0, z),
      aggroRange: 8.5, attackRange: 2.0, leashRange: 20, wanderRadius: 7,
      state: 'wander', ai: { wanderTarget: null, idle: 0, attackTimer: 0 },
      speedWander: 1.6, speedChase: 3.6,
      parts: { armL: armL, armR: armR, legL: legL, legR: legR, body: body },
      animPhase: Utils.randRange(0, 6), respawn: 0, dying: 0
    };
    tag(g, ent);
    return ent;
  }

  // ---------- spawning ----------
  function scatter(n, minR, maxR, avoidList, minSep) {
    var out = [];
    var attempts = 0;
    while (out.length < n && attempts < n * 40) {
      attempts++;
      var a = Utils.randRange(0, Math.PI * 2);
      var r = Utils.randRange(minR, maxR);
      var x = Math.cos(a) * r, z = Math.sin(a) * r;
      var ok = true;
      var all = out.concat(avoidList || []);
      for (var i = 0; i < all.length; i++) {
        var p = all[i].position || all[i];
        var dx = p.x - x, dz = p.z - z;
        if (dx * dx + dz * dz < (minSep || 3) * (minSep || 3)) { ok = false; break; }
      }
      if (ok) out.push({ x: x, z: z });
    }
    return out;
  }

  function init(sc) {
    scene = sc;
    var placed = [];
    scatter(16, 8, 52, placed, 4).forEach(function (p) { var e = makeTree(p.x, p.z); trees.push(e); placed.push(e); });
    scatter(12, 8, 52, placed, 4).forEach(function (p) { var e = makeRock(p.x, p.z); rocks.push(e); placed.push(e); });
    scatter(10, 6, 50, placed, 5).forEach(function (p) { makeBarrel(p.x, p.z); });
    scatter(9, 12, 48, placed, 6).forEach(function (p) { var e = makeEnemy(p.x, p.z); enemies.push(e); placed.push(e); });
  }

  // ---------- resource depletion visuals ----------
  function depleteResource(ent) {
    if (ent.type === 'tree') {
      ent.branches.visible = false;
      ent.mesh.scale.y = 0.4;
    } else if (ent.type === 'rock') {
      ent.veins.visible = false;
      ent.mesh.scale.set(0.6, 0.5, 0.6);
    }
    ent.active = false;
    ent.respawn = ent.type === 'tree' ? 8 : 6;
  }
  function restoreResource(ent) {
    ent.active = true;
    ent.amount = ent.maxAmount;
    ent.respawn = 0;
    if (ent.type === 'tree') { ent.branches.visible = true; ent.mesh.scale.set(1, 1, 1); }
    else if (ent.type === 'rock') { ent.veins.visible = true; ent.mesh.scale.set(1, 1, 1); }
  }

  // ---------- enemy death + respawn ----------
  function killEnemy(ent) {
    if (!ent.active) return;
    ent.active = false;
    ent.state = 'dead';
    ent.dying = 1.0;
    untag(ent);
    // the mutant's dying words — shown and screamed aloud
    if (window.UI) {
      var head = new THREE.Vector3(ent.position.x, ent.position.y + 3.2, ent.position.z);
      UI.spawnSpeech(head, 'ARIGATOU GOZAIMASU');
    }
    Voice.scream('Arigatou gozaimasu!');
    Game.log.push('enemy:killed');
  }
  function respawnEnemy(ent) {
    var a = Utils.randRange(0, Math.PI * 2), r = Utils.randRange(2, ent.wanderRadius);
    var x = ent.home.x + Math.cos(a) * r, z = ent.home.z + Math.sin(a) * r;
    ent.mesh.position.set(x, terrainY(x, z), z);
    ent.mesh.rotation.set(0, 0, 0);
    ent.mesh.scale.set(1, 1, 1);
    ent.mesh.visible = true;
    ent.hp = ent.maxHp; ent.active = true; ent.state = 'wander';
    ent.ai.wanderTarget = null; ent.ai.attackTimer = 0; ent.dying = 0;
    tag(ent.mesh, ent);
  }

  // ---------- AI + animation update ----------
  function updateEnemy(ent, dt, t) {
    // death animation: sink + fade + spin, then schedule respawn
    if (ent.state === 'dead') {
      ent.dying -= dt * 0.8;
      ent.mesh.rotation.z += dt * 4;
      ent.mesh.position.y = terrainY(ent.mesh.position.x, ent.mesh.position.z) - (1 - Math.max(ent.dying, 0)) * 2.2;
      ent.mesh.scale.setScalar(Math.max(ent.dying, 0.01));
      if (ent.dying <= 0) {
        ent.mesh.visible = false;
        ent.state = 'respawning';
        ent.respawn = Utils.randRange(4, 7);
      }
      return;
    }
    if (ent.state === 'respawning') {
      ent.respawn -= dt;
      if (ent.respawn <= 0) respawnEnemy(ent);
      return;
    }

    var player = Game.player;
    var pp = player && !player.isDead ? player.position : null;
    var pos = ent.mesh.position;

    var distToPlayer = pp ? Math.hypot(pp.x - pos.x, pp.z - pos.z) : Infinity;
    var distFromHome = Math.hypot(ent.home.x - pos.x, ent.home.z - pos.z);

    // transitions
    if (ent.state !== 'returning') {
      if (pp && distToPlayer <= ent.aggroRange && distFromHome < ent.leashRange) {
        ent.state = (distToPlayer <= ent.attackRange) ? 'attack' : 'chase';
      } else if (ent.state === 'chase' || ent.state === 'attack') {
        ent.state = 'wander';
      }
    }
    if (distFromHome >= ent.leashRange) ent.state = 'returning';

    var moving = false, speed = 0, tx = null, tz = null;

    if (ent.state === 'wander') {
      if (!ent.ai.wanderTarget || ent.ai.idle > 0) {
        ent.ai.idle -= dt;
        if (!ent.ai.wanderTarget) {
          var a = Utils.randRange(0, Math.PI * 2), r = Utils.randRange(1, ent.wanderRadius);
          ent.ai.wanderTarget = { x: ent.home.x + Math.cos(a) * r, z: ent.home.z + Math.sin(a) * r };
          ent.ai.idle = 0;
        }
      }
      tx = ent.ai.wanderTarget.x; tz = ent.ai.wanderTarget.z; speed = ent.speedWander;
      if (Math.hypot(tx - pos.x, tz - pos.z) < 0.4) { ent.ai.wanderTarget = null; ent.ai.idle = Utils.randRange(1, 3); }
    } else if (ent.state === 'chase') {
      tx = pp.x; tz = pp.z; speed = ent.speedChase;
      if (distToPlayer <= ent.attackRange) ent.state = 'attack';
    } else if (ent.state === 'attack') {
      // face & strike
      faceMesh(ent, pp.x, pp.z, dt);
      ent.ai.attackTimer += dt;
      if (distToPlayer > ent.attackRange * 1.15) { ent.state = 'chase'; }
      if (ent.ai.attackTimer >= ent.attackInterval) {
        ent.ai.attackTimer = 0;
        Combat.enemyAttack(ent);
        // lunge animation kick
        ent.parts.armR.rotation.x = -2.2;
      }
    } else if (ent.state === 'returning') {
      tx = ent.home.x; tz = ent.home.z; speed = ent.speedChase * 0.8;
      if (distFromHome < 1.0) { ent.state = 'wander'; ent.ai.wanderTarget = null; }
    }

    if (tx !== null && ent.state !== 'attack') {
      var dx = tx - pos.x, dz = tz - pos.z;
      var d = Math.hypot(dx, dz);
      if (d > 0.05) {
        var stepStop = ent.state === 'chase' ? ent.attackRange * 0.9 : 0.1;
        if (d > stepStop) {
          var step = Math.min(speed * dt, d - stepStop * 0.5);
          pos.x += (dx / d) * step;
          pos.z += (dz / d) * step;
          faceMesh(ent, tx, tz, dt);
          moving = true;
        }
      }
    }

    pos.y = terrainY(pos.x, pos.z);
    animateEnemy(ent, dt, t, moving);
  }

  function faceMesh(ent, x, z, dt) {
    var dx = x - ent.mesh.position.x, dz = z - ent.mesh.position.z;
    if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return;
    var want = Math.atan2(dx, dz);
    var cur = ent.mesh.rotation.y;
    var diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
    ent.mesh.rotation.y = cur + diff * Utils.clamp(10 * dt, 0, 1);
  }

  function animateEnemy(ent, dt, t, moving) {
    ent.animPhase += dt * (moving ? 9 : 2);
    var s = Math.sin(ent.animPhase);
    var p = ent.parts;
    if (ent.state === 'attack') {
      p.armR.rotation.x = Utils.damp(p.armR.rotation.x, Math.sin(ent.ai.attackTimer * 12) * 0.6, 8, dt);
      p.armL.rotation.x = Math.sin(t * 3) * 0.2;
    } else {
      p.legL.rotation.x = s * 0.6; p.legR.rotation.x = -s * 0.6;
      p.armL.rotation.x = -s * 0.4; p.armR.rotation.x = s * 0.4;
    }
    // menacing bob
    ent.mesh.position.y += Math.abs(Math.sin(ent.animPhase)) * 0.04 * (moving ? 1 : 0.3);
  }

  function update(dt, t) {
    // resource respawn timers
    var i;
    for (i = 0; i < trees.length; i++) if (!trees[i].active && trees[i].respawn > 0) { trees[i].respawn -= dt; if (trees[i].respawn <= 0) restoreResource(trees[i]); }
    for (i = 0; i < rocks.length; i++) if (!rocks[i].active && rocks[i].respawn > 0) { rocks[i].respawn -= dt; if (rocks[i].respawn <= 0) restoreResource(rocks[i]); }
    for (i = 0; i < barrels.length; i++) {
      var b = barrels[i];
      b.light.intensity = b.baseIntensity * (0.7 + 0.5 * Math.abs(Math.sin(t * 3 + i)) + Utils.rand() * 0.1);
    }
    for (i = 0; i < enemies.length; i++) updateEnemy(enemies[i], dt, t);
  }

  function reset() {
    for (var i = 0; i < trees.length; i++) restoreResource(trees[i]);
    for (var j = 0; j < rocks.length; j++) restoreResource(rocks[j]);
    for (var k = 0; k < enemies.length; k++) { if (enemies[k].state !== 'wander') respawnEnemy(enemies[k]); }
  }

  return {
    init: init, update: update, reset: reset,
    depleteResource: depleteResource, killEnemy: killEnemy,
    get interactMeshes() { return interactMeshes; },
    get trees() { return trees; }, get rocks() { return rocks; },
    get enemies() { return enemies; }, get barrels() { return barrels; }
  };
})();
