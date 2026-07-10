// ============================================================
// entities.js — world objects & enemy AI
//   * tiered trees / ore rocks / fishing pools (level-gated)
//   * tiered mutant enemies (level-gated) with wander/aggro AI
//   * hazard barrels (light/atmosphere)
//   * ruined buildings with lootable weapon chests
//   * hell-portal death animation
// ============================================================

var Entities = (function () {
  var scene;
  var trees = [], rocks = [], barrels = [], enemies = [], pools = [], chests = [], buildings = [];
  var interactMeshes = [];

  // ---- tier definitions ----
  var TREE_TIERS = [
    { name: 'Dead Tree', reqLevel: 1,  itemId: 'log',  xp: 25, bark: 0x2c2418, glow: 0x6cff3a, h: [3.2, 5.0] },
    { name: 'Blightwood', reqLevel: 15, itemId: 'blog', xp: 55, bark: 0x24301c, glow: 0xb6ff4a, h: [5.0, 7.0] }
  ];
  var ROCK_TIERS = [
    { name: 'Ore Vein',       reqLevel: 1,  itemId: 'ore',  xp: 35, ore: 0x7cff3a, rock: 0x4a4a4a },
    { name: 'Plutonium Vein', reqLevel: 15, itemId: 'pore', xp: 70, ore: 0xb060ff, rock: 0x3a3040 }
  ];
  var POOL_TIERS = [
    { name: 'Toxic Pool',   reqLevel: 1,  itemId: 'fish',  xp: 30, color: 0x5cff6a },
    { name: 'Glowing Pool', reqLevel: 20, itemId: 'bfish', xp: 65, color: 0x6affe0 }
  ];
  var ENEMY_TIERS = [
    { name: 'Mutant',     reqLevel: 1,  hp: 10, def: 1, maxHit: 3,  color: 0x5c7a3a, eye: 0xaaff33, scale: 1.0, aggro: 8.5 },
    { name: 'Ghoul',      reqLevel: 10, hp: 22, def: 4, maxHit: 6,  color: 0x6a4a7a, eye: 0xff5ad1, scale: 1.2, aggro: 9.5 },
    { name: 'Hell Brute', reqLevel: 25, hp: 45, def: 8, maxHit: 10, color: 0x7a2a2a, eye: 0xff7a2a, scale: 1.6, aggro: 11 }
  ];

  function terrainY(x, z) {
    if (World.ground && World.ground.userData.heightAt) return World.ground.userData.heightAt(x, z);
    return 0;
  }
  function tag(mesh, ref) { mesh.traverse(function (o) { if (o.isMesh) { o.userData.ref = ref; interactMeshes.push(o); } }); }
  function untag(ref) { interactMeshes = interactMeshes.filter(function (m) { return m.userData.ref !== ref; }); }

  // ---------- tree ----------
  function makeTree(x, z, tierIdx) {
    var T = TREE_TIERS[tierIdx];
    var g = new THREE.Group();
    var barkMat = new THREE.MeshStandardMaterial({ color: T.bark, roughness: 1, flatShading: true });
    var glowMat = new THREE.MeshStandardMaterial({ color: 0x1a2a10, emissive: T.glow, emissiveIntensity: 0.4, roughness: 1, flatShading: true });
    var h = Utils.randRange(T.h[0], T.h[1]);
    var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.46, h, 6), barkMat);
    trunk.position.y = h / 2; g.add(trunk);
    var branches = new THREE.Group();
    var nb = Utils.randInt(3, 5);
    for (var i = 0; i < nb; i++) {
      var b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.15, Utils.randRange(1.0, 1.9), 5), barkMat);
      b.position.y = h * Utils.randRange(0.55, 0.95);
      b.rotation.z = Utils.randRange(-1.1, 1.1);
      b.rotation.y = Utils.randRange(0, Math.PI * 2);
      branches.add(b);
    }
    for (var j = 0; j < 5; j++) {
      var bud = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), glowMat);
      bud.position.set(Utils.randRange(-0.9, 0.9), h * Utils.randRange(0.6, 1.0), Utils.randRange(-0.9, 0.9));
      branches.add(bud);
    }
    g.add(branches);
    g.position.set(x, terrainY(x, z), z);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    var ent = { type: 'tree', name: T.name, reqLevel: T.reqLevel, itemId: T.itemId, xp: T.xp,
      mesh: g, position: g.position, active: true, interactRange: 2.2,
      branches: branches, amount: Utils.randInt(5, 8), maxAmount: 8, respawn: 0 };
    tag(g, ent); return ent;
  }

  // ---------- rock ----------
  function makeRock(x, z, tierIdx) {
    var T = ROCK_TIERS[tierIdx];
    var g = new THREE.Group();
    var rockMat = new THREE.MeshStandardMaterial({ color: T.rock, roughness: 1, flatShading: true });
    var oreMat = new THREE.MeshStandardMaterial({ color: 0x243018, emissive: T.ore, emissiveIntensity: 0.7, roughness: 0.6, flatShading: true });
    var body = new THREE.Mesh(new THREE.DodecahedronGeometry(Utils.randRange(1.0, 1.5), 0), rockMat);
    body.position.y = 0.7; body.rotation.set(Utils.randRange(0, 1), Utils.randRange(0, 3), Utils.randRange(0, 1)); g.add(body);
    var veins = new THREE.Group();
    for (var i = 0; i < 6; i++) {
      var v = new THREE.Mesh(new THREE.IcosahedronGeometry(Utils.randRange(0.12, 0.24), 0), oreMat);
      var a = Utils.randRange(0, Math.PI * 2), r = Utils.randRange(0.6, 1.1);
      v.position.set(Math.cos(a) * r, 0.7 + Utils.randRange(-0.3, 0.5), Math.sin(a) * r);
      veins.add(v);
    }
    g.add(veins);
    g.position.set(x, terrainY(x, z), z);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    var ent = { type: 'rock', name: T.name, reqLevel: T.reqLevel, itemId: T.itemId, xp: T.xp,
      mesh: g, position: g.position, active: true, interactRange: 2.2,
      veins: veins, body: body, amount: Utils.randInt(4, 7), maxAmount: 7, respawn: 0 };
    tag(g, ent); return ent;
  }

  // ---------- fishing pool ----------
  function makeFishPool(x, z, tierIdx) {
    var T = POOL_TIERS[tierIdx];
    var g = new THREE.Group();
    var mat = new THREE.MeshStandardMaterial({ color: 0x0a1a0a, emissive: T.color, emissiveIntensity: 0.55, roughness: 0.3, transparent: true, opacity: 0.9 });
    var disc = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.0, 0.2, 16), mat);
    disc.position.y = 0.08; g.add(disc);
    var rim = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.16, 6, 18), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1, flatShading: true }));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.12; g.add(rim);
    g.position.set(x, terrainY(x, z), z);
    scene.add(g);
    var ent = { type: 'fishpool', name: T.name, reqLevel: T.reqLevel, itemId: T.itemId, xp: T.xp,
      mesh: g, position: g.position, active: true, interactRange: 2.6, disc: disc };
    tag(g, ent); return ent;
  }

  // ---------- hazard barrel ----------
  function makeBarrel(x, z) {
    var g = new THREE.Group();
    var yellow = new THREE.MeshStandardMaterial({ color: 0x8a7a1e, roughness: 0.7, flatShading: true });
    var glow = new THREE.MeshStandardMaterial({ color: 0x2a3a12, emissive: 0x8dff3a, emissiveIntensity: 1.2, roughness: 0.4 });
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.4, 10), yellow); body.position.y = 0.7; g.add(body);
    var top = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.15, 10), glow); top.position.y = 1.45; g.add(top);
    var stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.25, 10), new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 1 })); stripe.position.y = 0.7; g.add(stripe);
    var light = new THREE.PointLight(0x8dff3a, 1.4, 12, 2); light.position.y = 1.6; g.add(light);
    g.position.set(x, terrainY(x, z), z); g.rotation.y = Utils.randRange(0, Math.PI);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    var ent = { type: 'barrel', mesh: g, position: g.position, light: light, baseIntensity: 1.4, active: true };
    barrels.push(ent); return ent;
  }

  // ---------- ruined building + chest ----------
  function makeBuilding(x, z, weaponId) {
    var g = new THREE.Group();
    var wallMat = new THREE.MeshStandardMaterial({ color: 0x3b3b34, roughness: 1, flatShading: true });
    var w = 6, d = 6, h = 3.2;
    // floor
    var floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), new THREE.MeshStandardMaterial({ color: 0x2a2a26, roughness: 1 }));
    floor.position.y = 0.15; g.add(floor);
    // three walls (front left open as a doorway)
    function wall(ww, hh, px, py, pz) { var m = new THREE.Mesh(new THREE.BoxGeometry(ww, hh, 0.3), wallMat); m.position.set(px, py, pz); g.add(m); return m; }
    wall(w, h, 0, h / 2, -d / 2);            // back
    wall(0.3 * 0 + d, h, -w / 2, h / 2, 0); // left (rotate)
    g.children[g.children.length - 1].rotation.y = Math.PI / 2;
    wall(d, h, w / 2, h / 2, 0);            // right
    g.children[g.children.length - 1].rotation.y = Math.PI / 2;
    // partial front walls leaving a doorway
    wall(w * 0.32, h, -w * 0.34, h / 2, d / 2);
    wall(w * 0.32, h, w * 0.34, h / 2, d / 2);
    // sagging roof
    var roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.3, d + 0.4), wallMat);
    roof.position.y = h; roof.rotation.z = 0.05; g.add(roof);
    g.position.set(x, terrainY(x, z), z);
    g.rotation.y = Utils.randRange(0, Math.PI * 2);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    buildings.push({ mesh: g, position: g.position });

    // chest inside
    var chest = makeChest(0, 0, weaponId, g);
    return chest;
  }

  function makeChest(localX, localZ, weaponId, parent) {
    var g = new THREE.Group();
    var wood = new THREE.MeshStandardMaterial({ color: 0x5a3d1e, roughness: 1, flatShading: true });
    var gold = new THREE.MeshStandardMaterial({ color: 0x2a2410, emissive: 0xffcf3f, emissiveIntensity: 0.7, roughness: 0.4, metalness: 0.5 });
    var base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.8), wood); base.position.y = 0.45; g.add(base);
    var lid = new THREE.Group();
    var lidMesh = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.3, 0.84), wood); lidMesh.position.set(0, 0.15, 0); lid.add(lidMesh);
    lid.position.set(0, 0.8, -0.4); g.add(lid);
    var lock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.1), gold); lock.position.set(0, 0.65, 0.42); g.add(lock);
    var glow = new THREE.PointLight(0xffcf3f, 0.8, 6, 2); glow.position.y = 1.0; g.add(glow);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    // place inside the parent building
    parent.add(g);
    g.position.set(localX, 0.15, localZ);
    // world position for interaction (approx parent origin)
    var ent = { type: 'chest', name: 'Supply Chest', mesh: g, lid: lid, light: glow,
      position: parent.position, interactRange: 2.6, active: true, opened: false,
      weaponId: weaponId };
    tag(g, ent);
    chests.push(ent);
    return ent;
  }

  function openChest(chest) {
    if (!chest || chest.opened) return;
    chest.opened = true; chest.active = false;
    untag(chest);
    // open the lid
    chest.lid.rotation.x = -1.6;
    chest.light.color.setHex(0x8dff3a);
    var w = Skills.WEAPONS[chest.weaponId];
    if (w) {
      Skills.equip(chest.weaponId);
      if (window.UI) {
        UI.toast('Looted', w.name);
        var head = new THREE.Vector3(chest.position.x, chest.position.y + 3.0, chest.position.z);
        UI.spawnSpeech(head, 'You found a ' + w.name + '!');
      }
    }
    Game.log.push('chestOpened:' + chest.weaponId);
  }

  // ---------- mutant enemy ----------
  function makeEnemy(x, z, tierIdx) {
    var T = ENEMY_TIERS[tierIdx];
    var g = new THREE.Group();
    var flesh = new THREE.MeshStandardMaterial({ color: T.color, roughness: 1, flatShading: true });
    var dark = new THREE.MeshStandardMaterial({ color: 0x2a2214, roughness: 1, flatShading: true });
    var eyeMat = new THREE.MeshStandardMaterial({ color: 0x120800, emissive: T.eye, emissiveIntensity: 1.6 });
    var body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 0.7), flesh); body.position.y = 1.35; body.rotation.x = 0.15; g.add(body);
    var head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.7), flesh); head.position.set(0, 2.05, 0.15); g.add(head);
    var eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.06), eyeMat), eyeR = eyeL.clone();
    eyeL.position.set(-0.16, 2.08, 0.5); eyeR.position.set(0.16, 2.08, 0.5); g.add(eyeL); g.add(eyeR);
    for (var i = 0; i < 3; i++) { var lump = new THREE.Mesh(new THREE.IcosahedronGeometry(Utils.randRange(0.18, 0.32), 0), dark); lump.position.set(Utils.randRange(-0.5, 0.5), 1.4 + Utils.randRange(-0.3, 0.6), Utils.randRange(-0.4, 0.4)); g.add(lump); }
    var armL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.0, 0.24), flesh), armR = armL.clone();
    armL.position.set(-0.62, 1.35, 0.1); armR.position.set(0.62, 1.35, 0.1); g.add(armL); g.add(armR);
    var legL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.3), dark), legR = legL.clone();
    legL.position.set(-0.26, 0.45, 0); legR.position.set(0.26, 0.45, 0); g.add(legL); g.add(legR);
    g.scale.setScalar(T.scale);
    g.position.set(x, terrainY(x, z), z);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    var ent = { type: 'enemy', name: T.name, reqLevel: T.reqLevel, tierScale: T.scale,
      mesh: g, position: g.position, active: true, interactRange: 1.9 * T.scale,
      hp: T.hp, maxHp: T.hp, def: T.def, maxHit: T.maxHit, attackInterval: 1.6,
      home: new THREE.Vector3(x, 0, z),
      aggroRange: T.aggro, attackRange: 2.0 * T.scale, leashRange: 22, wanderRadius: 7,
      state: 'wander', ai: { wanderTarget: null, idle: 0, attackTimer: 0 },
      speedWander: 1.6, speedChase: 3.5 + tierIdx * 0.3,
      parts: { armL: armL, armR: armR, legL: legL, legR: legR, body: body },
      animPhase: Utils.randRange(0, 6), respawn: 0, dying: 0, tierIdx: tierIdx, _portal: null };
    tag(g, ent); return ent;
  }

  // ---------- spawning ----------
  function scatter(n, minR, maxR, avoidList, minSep) {
    var out = [], attempts = 0;
    while (out.length < n && attempts < n * 40) {
      attempts++;
      var a = Utils.randRange(0, Math.PI * 2), r = Utils.randRange(minR, maxR);
      var x = Math.cos(a) * r, z = Math.sin(a) * r, ok = true;
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
    // trees: mostly tier0, a few tier1 further out
    scatter(12, 8, 40, placed, 4).forEach(function (p) { var e = makeTree(p.x, p.z, 0); trees.push(e); placed.push(e); });
    scatter(5, 34, 54, placed, 5).forEach(function (p) { var e = makeTree(p.x, p.z, 1); trees.push(e); placed.push(e); });
    // rocks
    scatter(9, 8, 40, placed, 4).forEach(function (p) { var e = makeRock(p.x, p.z, 0); rocks.push(e); placed.push(e); });
    scatter(4, 34, 54, placed, 5).forEach(function (p) { var e = makeRock(p.x, p.z, 1); rocks.push(e); placed.push(e); });
    // fishing pools
    scatter(3, 10, 30, placed, 6).forEach(function (p) { var e = makeFishPool(p.x, p.z, 0); pools.push(e); placed.push(e); });
    scatter(2, 38, 55, placed, 6).forEach(function (p) { var e = makeFishPool(p.x, p.z, 1); pools.push(e); placed.push(e); });
    // barrels
    scatter(10, 6, 50, placed, 5).forEach(function (p) { makeBarrel(p.x, p.z); });
    // enemies by tier (closer = weaker)
    scatter(6, 12, 30, placed, 6).forEach(function (p) { var e = makeEnemy(p.x, p.z, 0); enemies.push(e); placed.push(e); });
    scatter(4, 28, 44, placed, 7).forEach(function (p) { var e = makeEnemy(p.x, p.z, 1); enemies.push(e); placed.push(e); });
    scatter(3, 42, 56, placed, 8).forEach(function (p) { var e = makeEnemy(p.x, p.z, 2); enemies.push(e); placed.push(e); });
    // buildings with chests (fanny pack hidden in the farthest one)
    var bspots = scatter(4, 16, 50, placed, 12);
    var loot = ['sword', 'gun', 'sword', 'fanny'];
    bspots.forEach(function (p, i) { makeBuilding(p.x, p.z, loot[i % loot.length]); placed.push(p); });
  }

  // ---------- resource depletion ----------
  function depleteResource(ent) {
    if (ent.type === 'tree') { ent.branches.visible = false; ent.mesh.scale.y = 0.4; }
    else if (ent.type === 'rock') { ent.veins.visible = false; ent.mesh.scale.set(0.6, 0.5, 0.6); }
    ent.active = false;
    ent.respawn = ent.type === 'tree' ? 8 : 6;
  }
  function restoreResource(ent) {
    ent.active = true; ent.amount = ent.maxAmount; ent.respawn = 0;
    if (ent.type === 'tree') { ent.branches.visible = true; ent.mesh.scale.set(1, 1, 1); }
    else if (ent.type === 'rock') { ent.veins.visible = true; ent.mesh.scale.set(1, 1, 1); }
  }

  // ---------- enemy death (hell portal) + respawn ----------
  function makePortal(ent) {
    var group = new THREE.Group();
    var disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.6 * ent.tierScale, 20),
      new THREE.MeshBasicMaterial({ color: 0xff3a10, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.05;
    group.add(disc);
    var ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.6 * ent.tierScale, 0.16, 8, 22),
      new THREE.MeshStandardMaterial({ color: 0x2a0a00, emissive: 0xff6a1a, emissiveIntensity: 1.4 })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08; group.add(ring);
    var light = new THREE.PointLight(0xff4a10, 2.4, 10 * ent.tierScale, 2); light.position.y = 0.5; group.add(light);
    group.position.set(ent.mesh.position.x, terrainY(ent.mesh.position.x, ent.mesh.position.z), ent.mesh.position.z);
    scene.add(group);
    ent._portal = { group: group, disc: disc, light: light };
  }
  function removePortal(ent) {
    if (ent._portal) { scene.remove(ent._portal.group); ent._portal = null; }
  }

  function killEnemy(ent) {
    if (!ent.active) return;
    ent.active = false; ent.state = 'dead'; ent.dying = 1.0;
    untag(ent);
    makePortal(ent);
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
    removePortal(ent);
    ent.mesh.position.set(x, terrainY(x, z), z);
    ent.mesh.rotation.set(0, 0, 0);
    ent.mesh.scale.setScalar(ent.tierScale);
    ent.mesh.visible = true;
    ent.hp = ent.maxHp; ent.active = true; ent.state = 'wander';
    ent.ai.wanderTarget = null; ent.ai.attackTimer = 0; ent.dying = 0;
    tag(ent.mesh, ent);
  }

  // ---------- AI + animation ----------
  function updateEnemy(ent, dt, t) {
    if (ent.state === 'dead') {
      // dragged down into a fiery portal
      ent.dying -= dt * 0.7;
      ent.mesh.rotation.z += dt * 5;
      ent.mesh.rotation.y += dt * 3;
      var sink = (1 - Math.max(ent.dying, 0)) * 2.6;
      ent.mesh.position.y = terrainY(ent.mesh.position.x, ent.mesh.position.z) - sink;
      ent.mesh.scale.setScalar(Math.max(ent.dying, 0.01) * ent.tierScale);
      if (ent._portal) {
        var pulse = 0.7 + 0.3 * Math.sin(t * 12);
        ent._portal.disc.material.opacity = Math.max(ent.dying, 0) * pulse;
        ent._portal.light.intensity = 2.4 * Math.max(ent.dying, 0) * (0.7 + pulse * 0.5);
        ent._portal.group.rotation.y += dt * 2;
      }
      if (ent.dying <= 0) { ent.mesh.visible = false; removePortal(ent); ent.state = 'respawning'; ent.respawn = Utils.randRange(4, 7); }
      return;
    }
    if (ent.state === 'respawning') { ent.respawn -= dt; if (ent.respawn <= 0) respawnEnemy(ent); return; }

    var player = Game.player;
    var pp = player && !player.isDead ? player.position : null;
    var pos = ent.mesh.position;
    var distToPlayer = pp ? Math.hypot(pp.x - pos.x, pp.z - pos.z) : Infinity;
    var distFromHome = Math.hypot(ent.home.x - pos.x, ent.home.z - pos.z);

    if (ent.state !== 'returning') {
      if (pp && distToPlayer <= ent.aggroRange && distFromHome < ent.leashRange) {
        ent.state = (distToPlayer <= ent.attackRange) ? 'attack' : 'chase';
      } else if (ent.state === 'chase' || ent.state === 'attack') { ent.state = 'wander'; }
    }
    if (distFromHome >= ent.leashRange) ent.state = 'returning';

    var moving = false, speed = 0, tx = null, tz = null;
    if (ent.state === 'wander') {
      if (!ent.ai.wanderTarget || ent.ai.idle > 0) {
        ent.ai.idle -= dt;
        if (!ent.ai.wanderTarget) {
          var a = Utils.randRange(0, Math.PI * 2), r = Utils.randRange(1, ent.wanderRadius);
          ent.ai.wanderTarget = { x: ent.home.x + Math.cos(a) * r, z: ent.home.z + Math.sin(a) * r }; ent.ai.idle = 0;
        }
      }
      tx = ent.ai.wanderTarget.x; tz = ent.ai.wanderTarget.z; speed = ent.speedWander;
      if (Math.hypot(tx - pos.x, tz - pos.z) < 0.4) { ent.ai.wanderTarget = null; ent.ai.idle = Utils.randRange(1, 3); }
    } else if (ent.state === 'chase') {
      tx = pp.x; tz = pp.z; speed = ent.speedChase;
      if (distToPlayer <= ent.attackRange) ent.state = 'attack';
    } else if (ent.state === 'attack') {
      faceMesh(ent, pp.x, pp.z, dt);
      ent.ai.attackTimer += dt;
      if (distToPlayer > ent.attackRange * 1.15) ent.state = 'chase';
      if (ent.ai.attackTimer >= ent.attackInterval) { ent.ai.attackTimer = 0; Combat.enemyAttack(ent); ent.parts.armR.rotation.x = -2.2; }
    } else if (ent.state === 'returning') {
      tx = ent.home.x; tz = ent.home.z; speed = ent.speedChase * 0.8;
      if (distFromHome < 1.0) { ent.state = 'wander'; ent.ai.wanderTarget = null; }
    }

    if (tx !== null && ent.state !== 'attack') {
      var dx = tx - pos.x, dz = tz - pos.z, d = Math.hypot(dx, dz);
      if (d > 0.05) {
        var stopStop = ent.state === 'chase' ? ent.attackRange * 0.9 : 0.1;
        if (d > stopStop) { var step = Math.min(speed * dt, d - stopStop * 0.5); pos.x += (dx / d) * step; pos.z += (dz / d) * step; faceMesh(ent, tx, tz, dt); moving = true; }
      }
    }
    pos.y = terrainY(pos.x, pos.z);
    animateEnemy(ent, dt, t, moving);
  }

  function faceMesh(ent, x, z, dt) {
    var dx = x - ent.mesh.position.x, dz = z - ent.mesh.position.z;
    if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return;
    var want = Math.atan2(dx, dz), cur = ent.mesh.rotation.y;
    var diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
    ent.mesh.rotation.y = cur + diff * Utils.clamp(10 * dt, 0, 1);
  }
  function animateEnemy(ent, dt, t, moving) {
    ent.animPhase += dt * (moving ? 9 : 2);
    var s = Math.sin(ent.animPhase), p = ent.parts;
    if (ent.state === 'attack') { p.armR.rotation.x = Utils.damp(p.armR.rotation.x, Math.sin(ent.ai.attackTimer * 12) * 0.6, 8, dt); p.armL.rotation.x = Math.sin(t * 3) * 0.2; }
    else { p.legL.rotation.x = s * 0.6; p.legR.rotation.x = -s * 0.6; p.armL.rotation.x = -s * 0.4; p.armR.rotation.x = s * 0.4; }
  }

  function update(dt, t) {
    var i;
    for (i = 0; i < trees.length; i++) if (!trees[i].active && trees[i].respawn > 0) { trees[i].respawn -= dt; if (trees[i].respawn <= 0) restoreResource(trees[i]); }
    for (i = 0; i < rocks.length; i++) if (!rocks[i].active && rocks[i].respawn > 0) { rocks[i].respawn -= dt; if (rocks[i].respawn <= 0) restoreResource(rocks[i]); }
    for (i = 0; i < barrels.length; i++) { var b = barrels[i]; b.light.intensity = b.baseIntensity * (0.7 + 0.5 * Math.abs(Math.sin(t * 3 + i)) + Utils.rand() * 0.1); }
    for (i = 0; i < pools.length; i++) { pools[i].disc.material.emissiveIntensity = 0.45 + 0.25 * Math.abs(Math.sin(t * 2 + i)); }
    for (i = 0; i < enemies.length; i++) updateEnemy(enemies[i], dt, t);
  }

  function reset() {
    for (var i = 0; i < trees.length; i++) restoreResource(trees[i]);
    for (var j = 0; j < rocks.length; j++) restoreResource(rocks[j]);
    for (var k = 0; k < enemies.length; k++) { if (enemies[k].state !== 'wander') respawnEnemy(enemies[k]); }
  }

  return {
    init: init, update: update, reset: reset,
    depleteResource: depleteResource, killEnemy: killEnemy, openChest: openChest,
    get interactMeshes() { return interactMeshes; },
    get trees() { return trees; }, get rocks() { return rocks; },
    get enemies() { return enemies; }, get barrels() { return barrels; },
    get pools() { return pools; }, get chests() { return chests; }, get buildings() { return buildings; }
  };
})();
