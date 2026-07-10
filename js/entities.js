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
    // store roof + footprint so we can lift the roof when the player steps inside
    buildings.push({ mesh: g, position: g.position, roof: roof, halfW: w / 2, halfD: d / 2, rotY: g.rotation.y });

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
  // limb as a shoulder/hip-pivoted Group: rotation.x swings the whole limb.
  // Tapered cylinder reads far more organic than a box.
  function makeLimb(mat, topR, botR, len, px, py, pz) {
    var grp = new THREE.Group();
    grp.position.set(px, py, pz);
    var m = new THREE.Mesh(new THREE.CylinderGeometry(topR, botR, len, 6), mat);
    m.position.y = -len / 2;
    grp.add(m);
    grp.userData.len = len;
    return grp;
  }
  // a few short claw cones at a limb's "hand" so they swing with the arm
  function addClaws(limbGrp, mat, n, size) {
    var hy = -limbGrp.userData.len;
    for (var i = 0; i < n; i++) {
      var c = new THREE.Mesh(new THREE.ConeGeometry(size * 0.4, size * 1.6, 4), mat);
      c.position.set((i - (n - 1) / 2) * size * 0.7, hy - size * 0.5, 0.05);
      c.rotation.x = Math.PI * 0.92;
      limbGrp.add(c);
    }
  }

  function makeEnemy(x, z, tierIdx) {
    var T = ENEMY_TIERS[tierIdx];
    var g = new THREE.Group();
    var flesh = new THREE.MeshStandardMaterial({ color: T.color, roughness: 1, flatShading: true });
    var dark = new THREE.MeshStandardMaterial({ color: 0x2a2214, roughness: 1, flatShading: true });
    var bone = new THREE.MeshStandardMaterial({ color: 0xc9bfa2, roughness: 1, flatShading: true });
    var claw = new THREE.MeshStandardMaterial({ color: 0x141018, roughness: 0.8, flatShading: true });
    var eyeMat = new THREE.MeshStandardMaterial({ color: 0x120800, emissive: T.eye, emissiveIntensity: 1.7 });
    var body, head, armL, armR, legL, legR;
    var eyeY, eyeZ, eyeSpread, eyeR;

    if (tierIdx === 0) {
      // ---- Mutant — lanky, emaciated, hunched wretch ----
      body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.52, 1.3, 7), flesh);
      body.position.set(0, 1.42, 0.05); body.rotation.x = 0.24; g.add(body);
      for (var mi = 0; mi < 3; mi++) { // knobbly spine
        var knob = new THREE.Mesh(new THREE.IcosahedronGeometry(Utils.randRange(0.12, 0.2), 0), dark);
        knob.position.set(Utils.randRange(-0.2, 0.2), 1.15 + mi * 0.32, -0.28); g.add(knob);
      }
      head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.33, 0), flesh);
      head.position.set(0, 2.0, 0.22); head.scale.set(0.9, 1.05, 1.15); g.add(head);
      armL = makeLimb(flesh, 0.09, 0.13, 1.1, -0.42, 1.8, 0.06);
      armR = makeLimb(flesh, 0.09, 0.13, 1.1, 0.42, 1.8, 0.06);
      addClaws(armL, claw, 3, 0.1); addClaws(armR, claw, 3, 0.1);
      legL = makeLimb(dark, 0.12, 0.16, 0.98, -0.2, 0.98, 0);
      legR = makeLimb(dark, 0.12, 0.16, 0.98, 0.2, 0.98, 0);
      eyeY = 2.03; eyeZ = 0.5; eyeSpread = 0.14; eyeR = 0.06;
    } else if (tierIdx === 1) {
      // ---- Ghoul — hunched, gaunt ribcage, long clawed arms ----
      body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), flesh);
      body.scale.set(0.98, 1.2, 0.72); body.position.set(0, 1.4, 0); body.rotation.x = 0.32; g.add(body);
      for (var gi = 0; gi < 4; gi++) { // exposed spine ridge
        var sp = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 4), bone);
        sp.position.set(0, 1.05 + gi * 0.26, -0.32); sp.rotation.x = -0.5; g.add(sp);
      }
      head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), flesh);
      head.position.set(0, 1.92, 0.34); head.scale.set(0.85, 0.95, 1.25); head.rotation.x = 0.3; g.add(head);
      var jaw = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), flesh);
      jaw.position.set(0, 1.74, 0.5); jaw.rotation.x = Math.PI * 0.5; g.add(jaw);
      armL = makeLimb(flesh, 0.1, 0.13, 1.35, -0.46, 1.78, 0.08);
      armR = makeLimb(flesh, 0.1, 0.13, 1.35, 0.46, 1.78, 0.08);
      addClaws(armL, claw, 3, 0.14); addClaws(armR, claw, 3, 0.14);
      legL = makeLimb(dark, 0.13, 0.17, 0.95, -0.22, 0.98, 0);
      legR = makeLimb(dark, 0.13, 0.17, 0.95, 0.22, 0.98, 0);
      eyeY = 1.98; eyeZ = 0.66; eyeSpread = 0.14; eyeR = 0.065;
    } else {
      // ---- Hell Brute — bulky, horned, heavy shoulders, back spikes ----
      body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.78, 0), flesh);
      body.scale.set(1.3, 1.0, 0.95); body.position.set(0, 1.5, 0); g.add(body);
      var chest = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), flesh);
      chest.position.set(0, 1.35, 0.32); chest.scale.set(1.3, 0.9, 0.7); g.add(chest);
      for (var hi = 0; hi < 4; hi++) { // back spikes
        var bs = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 5), bone);
        bs.position.set((hi % 2 ? 0.22 : -0.22), 1.55 + Math.floor(hi / 2) * 0.34, -0.42); bs.rotation.x = -0.7; g.add(bs);
      }
      head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), flesh);
      head.position.set(0, 2.12, 0.16); head.scale.set(1.05, 0.95, 1.0); g.add(head);
      for (var ci = 0; ci < 2; ci++) { // horns
        var horn = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.55, 5), bone);
        horn.position.set(ci ? 0.24 : -0.24, 2.42, 0.05); horn.rotation.z = ci ? -0.5 : 0.5; horn.rotation.x = -0.3; g.add(horn);
      }
      // heavy shoulder pauldrons (static, over the shoulders)
      var paL = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), dark); paL.position.set(-0.62, 1.95, 0.02); g.add(paL);
      var paR = paL.clone(); paR.position.x = 0.62; g.add(paR);
      armL = makeLimb(flesh, 0.19, 0.24, 1.05, -0.66, 1.86, 0.05);
      armR = makeLimb(flesh, 0.19, 0.24, 1.05, 0.66, 1.86, 0.05);
      addClaws(armL, claw, 3, 0.16); addClaws(armR, claw, 3, 0.16);
      legL = makeLimb(dark, 0.22, 0.28, 0.92, -0.3, 1.0, 0);
      legR = makeLimb(dark, 0.22, 0.28, 0.92, 0.3, 1.0, 0);
      eyeY = 2.16; eyeZ = 0.5; eyeSpread = 0.17; eyeR = 0.08;
    }

    // glowing eyes
    var eyeL = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 6, 6), eyeMat), eyeRm = eyeL.clone();
    eyeL.position.set(-eyeSpread, eyeY, eyeZ); eyeRm.position.set(eyeSpread, eyeY, eyeZ);
    g.add(eyeL); g.add(eyeRm);

    g.add(armL); g.add(armR); g.add(legL); g.add(legR);
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
  // Always returns exactly n points. Tries to honour minSep, relaxing it if
  // space is tight, then falls back to unconstrained placement so downstream
  // counts (which the server relies on for index alignment) never come up short.
  function scatter(n, minR, maxR, avoidList, minSep) {
    var out = [];
    var sep = minSep || 3;
    var guard = 0;
    while (out.length < n && guard < n * 200) {
      guard++;
      if (guard % (n * 40) === 0) sep *= 0.7; // loosen if we keep failing
      var a = Utils.randRange(0, Math.PI * 2), r = Utils.randRange(minR, maxR);
      var x = Math.cos(a) * r, z = Math.sin(a) * r, ok = true;
      var all = out.concat(avoidList || []);
      for (var i = 0; i < all.length; i++) {
        var p = all[i].position || all[i];
        var dx = p.x - x, dz = p.z - z;
        if (dx * dx + dz * dz < sep * sep) { ok = false; break; }
      }
      if (ok) out.push({ x: x, z: z });
    }
    while (out.length < n) { // absolute guarantee of count
      var a2 = Utils.randRange(0, Math.PI * 2), r2 = Utils.randRange(minR, maxR);
      out.push({ x: Math.cos(a2) * r2, z: Math.sin(a2) * r2 });
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

    // stable indices so the server can address the same object on every client
    trees.forEach(function (e, i) { e.index = i; });
    rocks.forEach(function (e, i) { e.index = i; });
    enemies.forEach(function (e, i) { e.index = i; });
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
    untag(ent);           // avoid duplicate raycast entries if it was still tagged
    tag(ent.mesh, ent);
  }

  // ---------- death (hell portal) animation, shared by offline + online ----------
  function runDeath(ent, dt, t) {
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
    return ent.dying <= 0;
  }

  // ---------- server-driven rendering (when online) ----------
  function updateEnemyOnline(ent, dt, t) {
    if (ent.state === 'hidden' || ent.state === 'respawning') return;
    var s = ent._srv;
    if (!s) return;
    ent.state = s.state;
    var px = ent.mesh.position.x, pz = ent.mesh.position.z;
    ent.mesh.position.x = Utils.damp(px, s.x, 10, dt);
    ent.mesh.position.z = Utils.damp(pz, s.z, 10, dt);
    ent.mesh.position.y = terrainY(ent.mesh.position.x, ent.mesh.position.z);
    var cur = ent.mesh.rotation.y, diff = Math.atan2(Math.sin(s.ry - cur), Math.cos(s.ry - cur));
    ent.mesh.rotation.y = cur + diff * Utils.clamp(10 * dt, 0, 1);
    ent.mesh.scale.setScalar(ent.tierScale);
    ent.hp = s.hp;
    var moving = Math.hypot(ent.mesh.position.x - px, ent.mesh.position.z - pz) > 0.003;
    animateEnemy(ent, dt, t, moving);
  }

  // ---------- AI + animation ----------
  function updateEnemy(ent, dt, t) {
    if (ent.state === 'dead') {
      if (runDeath(ent, dt, t)) {
        ent.mesh.visible = false; removePortal(ent);
        if (Game.online) { ent.state = 'hidden'; }
        else { ent.state = 'respawning'; ent.respawn = Utils.randRange(4, 7); }
      }
      return;
    }
    if (Game.online) { updateEnemyOnline(ent, dt, t); return; }
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
    if (!Game.online) {  // server owns resource respawn when connected
      for (i = 0; i < trees.length; i++) if (!trees[i].active && trees[i].respawn > 0) { trees[i].respawn -= dt; if (trees[i].respawn <= 0) restoreResource(trees[i]); }
      for (i = 0; i < rocks.length; i++) if (!rocks[i].active && rocks[i].respawn > 0) { rocks[i].respawn -= dt; if (rocks[i].respawn <= 0) restoreResource(rocks[i]); }
    }
    for (i = 0; i < barrels.length; i++) { var b = barrels[i]; b.light.intensity = b.baseIntensity * (0.7 + 0.5 * Math.abs(Math.sin(t * 3 + i)) + Utils.rand() * 0.1); }
    for (i = 0; i < pools.length; i++) { pools[i].disc.material.emissiveIntensity = 0.45 + 0.25 * Math.abs(Math.sin(t * 2 + i)); }
    // lift the roof off whichever building the local player is standing inside
    var pl = Game.player;
    if (pl && pl.position) {
      for (i = 0; i < buildings.length; i++) {
        var bld = buildings[i];
        if (!bld.roof) continue;
        var lx = pl.position.x - bld.position.x, lz = pl.position.z - bld.position.z;
        var ca = Math.cos(bld.rotY), sa = Math.sin(bld.rotY);
        var rx = lx * ca - lz * sa, rz = lx * sa + lz * ca; // into building-local space
        var inside = Math.abs(rx) < bld.halfW + 0.3 && Math.abs(rz) < bld.halfD + 0.3;
        bld.roof.visible = !inside;
      }
    }
    for (i = 0; i < enemies.length; i++) updateEnemy(enemies[i], dt, t);
  }

  // ---------- applied from server (net.js) ----------
  function applyServerEnemies(list) {
    Game.online = true;
    for (var i = 0; i < list.length; i++) {
      var s = list[i], e = enemies[s.i];
      if (!e) continue;
      e._srv = s;
      if (e.state !== 'dead' && e.state !== 'hidden') e.hp = s.hp;
    }
  }
  function serverEnemyHit(i, dmg) {
    var e = enemies[i];
    if (!e || !window.UI) return;
    var head = new THREE.Vector3(e.mesh.position.x, e.mesh.position.y + 2.6, e.mesh.position.z);
    UI.spawnHitsplat(head, dmg, dmg > 0 ? 'hit' : 'miss');
  }
  function serverEnemyDead(i, x, z, byMe) {
    var e = enemies[i];
    if (!e || e.state === 'dead') return;
    e.mesh.position.set(x, terrainY(x, z), z);
    e.active = true;      // ensure killEnemy runs its visual
    killEnemy(e);         // portal + arigato + sink; online path parks it 'hidden'
    if (byMe) {           // the killer gets the same kill bonus as offline
      Skills.addXp('attack', 15);
      Skills.addXp('strength', 10);
      if (window.UI) UI.showActionText('The mutant is dragged to hell.');
    }
  }
  // reconcile an enemy the server reports as already dead when we join
  function initDeadEnemy(i) {
    var e = enemies[i];
    if (!e) return;
    e.mesh.visible = false; e.active = false; e.state = 'hidden';
    untag(e); removePortal(e);
  }
  function serverEnemyRespawn(i, x, z) {
    var e = enemies[i];
    if (!e) return;
    removePortal(e);
    e.mesh.position.set(x, terrainY(x, z), z);
    e.mesh.rotation.set(0, 0, 0);
    e.mesh.scale.setScalar(e.tierScale);
    e.mesh.visible = true;
    e.hp = e.maxHp; e.active = true; e.state = 'wander'; e.dying = 0;
    e._srv = { i: i, x: x, z: z, ry: 0, state: 'wander', hp: e.maxHp };
    tag(e.mesh, e);
  }
  function setResourceState(kind, i, active) {
    var arr = kind === 'tree' ? trees : kind === 'rock' ? rocks : null;
    if (!arr || !arr[i]) return;
    if (active) restoreResource(arr[i]); else depleteResource(arr[i]);
  }
  function goOffline() {
    // server dropped: let local sim take back over from current positions
    Game.online = false;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.state === 'hidden') { e.state = 'respawning'; e.respawn = 1; }
      e._srv = null;
    }
  }

  function reset() {
    if (Game.online) return; // server owns the shared world; don't touch it locally
    for (var i = 0; i < trees.length; i++) restoreResource(trees[i]);
    for (var j = 0; j < rocks.length; j++) restoreResource(rocks[j]);
    for (var k = 0; k < enemies.length; k++) { if (enemies[k].state !== 'wander') respawnEnemy(enemies[k]); }
  }

  return {
    init: init, update: update, reset: reset,
    depleteResource: depleteResource, killEnemy: killEnemy, openChest: openChest,
    applyServerEnemies: applyServerEnemies, serverEnemyHit: serverEnemyHit,
    serverEnemyDead: serverEnemyDead, serverEnemyRespawn: serverEnemyRespawn,
    initDeadEnemy: initDeadEnemy,
    setResourceState: setResourceState, goOffline: goOffline,
    get interactMeshes() { return interactMeshes; },
    get trees() { return trees; }, get rocks() { return rocks; },
    get enemies() { return enemies; }, get barrels() { return barrels; },
    get pools() { return pools; }, get chests() { return chests; }, get buildings() { return buildings; }
  };
})();
