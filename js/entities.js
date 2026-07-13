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
  var trees = [], rocks = [], barrels = [], enemies = [], pools = [], chests = [], buildings = [], stations = [], camps = [];
  var interactMeshes = [];
  var obelisk = null;   // the central endgame monument
  var bandits = [], banditCamps = [], drops = [];   // E/W bandit-camp wave system
  var rats = [], birds = [];   // ambient critters (attackable rats) + flying birds

  // No roaming enemies in the open field — combat lives at the E/W bandit camps
  // (and rats). Enemies still spawn hidden so the self-test + server indices align.
  var ENEMIES_ENABLED = false;
  var enemiesLive = true;         // resolved in init(): live if enabled OR self-test


  // ---- tier definitions (desert / Middle-Eastern fantasy) ----
  var TREE_TIERS = [
    { name: 'Dead Tree',    reqLevel: 1,  itemId: 'log',       xp: 20,  style: 'dead', bark: 0x6b5236, h: [3.0, 4.2] },
    { name: 'Palm Tree',    reqLevel: 4,  itemId: 'palmwood',  xp: 40,  style: 'palm', bark: 0x8a5a2b, frond: 0x6a9a3a, dates: null,    h: [4.5, 6.0] },
    { name: 'Ancient Palm', reqLevel: 7,  itemId: 'blog',      xp: 70,  style: 'palm', bark: 0x5a3a1c, frond: 0x4a7a2a, dates: 0xc86a2a, h: [6.0, 7.5] },
    { name: 'Elder Palm',   reqLevel: 10, itemId: 'elderwood', xp: 120, style: 'palm', bark: 0x4a2f18, frond: 0x2e8f3a, dates: 0xffd24a, h: [8.5, 10.5], scale: 1.15 }
  ];
  // Each vein has its own distinct silhouette (built in makeRock), not just a recolour.
  var ROCK_TIERS = [
    { name: 'Copper Vein', reqLevel: 1,  itemId: 'ore',    xp: 30,  ore: 0xd07a30, rock: 0x9a9aa2 },  // silvery rock, copper flecks
    { name: 'Iron Vein',   reqLevel: 4,  itemId: 'iron',   xp: 55,  ore: 0x5a5a64, rock: 0x8a7c6a },  // lumpy boulder, dark iron
    { name: 'Silver Vein', reqLevel: 7,  itemId: 'silver', xp: 90,  ore: 0xeaeaf2, rock: 0x8890a0 },  // crystal spikes
    { name: 'Gold Vein',   reqLevel: 10, itemId: 'pore',   xp: 140, ore: 0xffd24a, rock: 0x8a6a3c }   // glowing gold nuggets
  ];
  // Oasis fishing spots, gated by Fishing level (ids kept: shrimp/lobster/whale).
  var FISH_TIERS = [
    { name: 'Sardine Shallows', reqLevel: 1,  itemId: 'shrimp',  xp: 15, color: 0x9fd0e0, ring: 0.9 },
    { name: 'Crab Pool',        reqLevel: 5,  itemId: 'lobster', xp: 35, color: 0xff8a4a, ring: 1.4 },
    { name: 'Perch Depths',     reqLevel: 12, itemId: 'whale',   xp: 90, color: 0x4ab6ff, ring: 2.1 }
  ];
  var ENEMY_TIERS = [
    { name: 'Sand Bandit',  reqLevel: 1,  hp: 10, def: 1, maxHit: 3,  color: 0xb8895a, eye: 0xffe08a, scale: 1.0, aggro: 8.5 },
    { name: 'Desert Ghoul', reqLevel: 10, hp: 22, def: 4, maxHit: 6,  color: 0x9a8a6a, eye: 0xff6a3a, scale: 1.2, aggro: 9.5 },
    { name: 'Sand Golem',   reqLevel: 25, hp: 45, def: 8, maxHit: 10, color: 0xc19a6b, eye: 0xffcf5a, scale: 1.6, aggro: 11 }
  ];

  var WOOD_IDS = ['log', 'palmwood', 'blog', 'elderwood'];  // any log fuels a fire
  function removeFirstItem(ids) { for (var i = 0; i < ids.length; i++) if (Skills.removeItem(ids[i])) return true; return false; }
  // smelt/cook the richest first; each tier needs the station upgraded to that level
  var SMELT_PLAN = [
    { ore: 'pore',   tier: 4 }, { ore: 'silver', tier: 3 },
    { ore: 'iron',   tier: 2 }, { ore: 'ore',    tier: 1 }
  ];
  var COOK_PLAN = [
    { raw: 'whale', tier: 3 }, { raw: 'lobster', tier: 2 }, { raw: 'shrimp', tier: 1 }
  ];

  function terrainY(x, z) {
    if (World.ground && World.ground.userData.heightAt) return World.ground.userData.heightAt(x, z);
    return 0;
  }
  function tag(mesh, ref) { mesh.traverse(function (o) { if (o.isMesh) { o.userData.ref = ref; interactMeshes.push(o); } }); }
  // register a group's meshes as camera occluders (whole group hides together)
  function markOccluder(group) {
    if (!Game.occluders) Game.occluders = [];
    group.traverse(function (o) { if (o.isMesh) { o.userData.occGroup = group; Game.occluders.push(o); } });
  }
  function untag(ref) { interactMeshes = interactMeshes.filter(function (m) { return m.userData.ref !== ref; }); }

  // ---------- hover outline: one reusable back-side silhouette of the hovered object ----------
  var _highlight = null, _highlightSrc = null;
  var _hlV = new THREE.Vector3(), _hlQ = new THREE.Quaternion(), _hlS = new THREE.Vector3();
  function disposeHighlight() {
    if (!_highlight) return;
    scene.remove(_highlight);
    _highlight.traverse(function (o) { if (o.isMesh && o.material) o.material.dispose(); });
    _highlight = null;
  }
  function setHighlight(mesh) {
    if (mesh === _highlightSrc) return;            // hovered thing didn't change
    _highlightSrc = mesh || null;
    disposeHighlight();
    if (!mesh) return;
    var outline = mesh.clone(true);
    outline.traverse(function (o) {
      // invisible hitboxes / lights / point-clouds must not become solid outline shells
      if (o.userData && o.userData.hitbox) { o.visible = false; return; }
      if (o.isLight || o.isPoints) { o.visible = false; return; }
      if (o.isMesh) {
        o.material = new THREE.MeshBasicMaterial({ color: 0xffe6a0, side: THREE.BackSide });
        o.castShadow = false; o.receiveShadow = false;
      }
    });
    mesh.updateWorldMatrix(true, false);
    outline.position.copy(mesh.getWorldPosition(_hlV));
    outline.quaternion.copy(mesh.getWorldQuaternion(_hlQ));
    mesh.getWorldScale(_hlS);
    outline.scale.set(_hlS.x * 1.06, _hlS.y * 1.06, _hlS.z * 1.06);
    scene.add(outline);
    _highlight = outline;
  }

  // ---------- tree (dead / palm styles) ----------
  function makeTree(x, z, tierIdx) {
    var T = TREE_TIERS[tierIdx];
    var g = new THREE.Group();
    var barkMat = new THREE.MeshStandardMaterial({ color: T.bark, roughness: 1, flatShading: true });
    var h = Utils.randRange(T.h[0], T.h[1]);
    var crown = new THREE.Group();   // the "branches" group depletion hides

    if (T.style === 'dead') {
      // gnarled bare trunk + a few dead branches, no leaves
      var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.45, h, 6), barkMat);
      trunk.position.y = h / 2; g.add(trunk);
      var nb = Utils.randInt(3, 5);
      for (var i = 0; i < nb; i++) {
        var b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.13, Utils.randRange(1.0, 1.8), 5), barkMat);
        b.position.y = h * Utils.randRange(0.55, 0.95);
        b.rotation.z = Utils.randRange(-1.2, 1.2);
        b.rotation.y = Utils.randRange(0, Math.PI * 2);
        crown.add(b);
      }
      g.add(crown);
    } else {
      // palm: gently curving trunk + drooping frond crown
      var frondMat = new THREE.MeshStandardMaterial({ color: T.frond, roughness: 1, flatShading: true, side: THREE.DoubleSide });
      var seg = 5, segH = h / seg, topX = 0;
      for (var s = 0; s < seg; s++) {
        topX = Math.sin(s * 0.5) * 0.12 * s;
        var tk = new THREE.Mesh(new THREE.CylinderGeometry(0.32 - s * 0.03, 0.34 - s * 0.03, segH * 1.02, 6), barkMat);
        tk.position.set(topX, segH * (s + 0.5), 0);
        g.add(tk);
      }
      crown.position.set(topX, h, 0);
      var nf = 9;
      for (var f = 0; f < nf; f++) {
        var pivot = new THREE.Group();
        pivot.rotation.y = (f / nf) * Math.PI * 2 + Utils.randRange(-0.1, 0.1);
        var frond = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.55), frondMat);
        frond.position.x = 1.2; frond.rotation.z = -0.55;
        pivot.add(frond);
        crown.add(pivot);
      }
      if (T.dates) {
        var dateMat = new THREE.MeshStandardMaterial({ color: T.dates, roughness: 0.8, flatShading: true });
        for (var d = 0; d < 3; d++) {
          var a = (d / 3) * Math.PI * 2;
          var cl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), dateMat);
          cl.position.set(Math.cos(a) * 0.5, -0.3, Math.sin(a) * 0.5);
          crown.add(cl);
        }
      }
      g.add(crown);
    }
    if (T.scale) g.scale.setScalar(T.scale);
    g.position.set(x, terrainY(x, z), z);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    markOccluder(g);
    var ent = { type: 'tree', name: T.name, reqLevel: T.reqLevel, itemId: T.itemId, xp: T.xp,
      mesh: g, position: g.position, active: true, interactRange: 2.2,
      branches: crown, amount: Utils.randInt(5, 8), maxAmount: 8, respawn: 0 };
    tag(g, ent); return ent;
  }

  // ---------- rock ----------
  function makeRock(x, z, tierIdx) {
    var T = ROCK_TIERS[tierIdx];
    var g = new THREE.Group();
    var rockMat = new THREE.MeshStandardMaterial({ color: T.rock, roughness: 1, flatShading: true });
    var veins = new THREE.Group(), body, oreMat, a, r, i;

    if (tierIdx === 0) {
      // Copper — a jagged SILVERY rock studded with copper crystal flecks
      oreMat = new THREE.MeshStandardMaterial({ color: 0x3a2410, emissive: T.ore, emissiveIntensity: 0.85, roughness: 0.5, metalness: 0.4, flatShading: true });
      body = new THREE.Mesh(new THREE.IcosahedronGeometry(Utils.randRange(1.0, 1.4), 0), rockMat);
      body.position.y = 0.7; body.rotation.set(Utils.randRange(0, 1), Utils.randRange(0, 3), Utils.randRange(0, 1)); g.add(body);
      for (i = 0; i < 7; i++) {
        var fleck = new THREE.Mesh(new THREE.OctahedronGeometry(Utils.randRange(0.12, 0.22), 0), oreMat);
        a = Utils.randRange(0, Math.PI * 2); r = Utils.randRange(0.5, 1.0);
        fleck.position.set(Math.cos(a) * r, 0.7 + Utils.randRange(-0.3, 0.6), Math.sin(a) * r);
        fleck.rotation.set(Utils.rand(), Utils.rand(), Utils.rand());
        veins.add(fleck);
      }
    } else if (tierIdx === 1) {
      // Iron — a big, rounded, LUMPY boulder with dark metallic streaks
      body = new THREE.Mesh(new THREE.DodecahedronGeometry(Utils.randRange(1.3, 1.7), 1), rockMat);
      body.position.y = 0.9; body.scale.set(1.2, 0.9, 1.1); body.rotation.y = Utils.randRange(0, 3); g.add(body);
      for (i = 0; i < 5; i++) { // bumps → boulder texture
        var lump = new THREE.Mesh(new THREE.DodecahedronGeometry(Utils.randRange(0.3, 0.55), 0), rockMat);
        a = Utils.randRange(0, Math.PI * 2); r = Utils.randRange(0.7, 1.2);
        lump.position.set(Math.cos(a) * r, 0.9 + Utils.randRange(-0.4, 0.5), Math.sin(a) * r);
        lump.rotation.set(Utils.rand(), Utils.rand(), Utils.rand()); g.add(lump);
      }
      oreMat = new THREE.MeshStandardMaterial({ color: T.ore, roughness: 0.55, metalness: 0.7, flatShading: true });
      for (i = 0; i < 5; i++) {
        var chunk = new THREE.Mesh(new THREE.IcosahedronGeometry(Utils.randRange(0.18, 0.3), 0), oreMat);
        a = Utils.randRange(0, Math.PI * 2); r = Utils.randRange(0.5, 1.1);
        chunk.position.set(Math.cos(a) * r, 0.9 + Utils.randRange(-0.3, 0.6), Math.sin(a) * r);
        veins.add(chunk);
      }
    } else if (tierIdx === 2) {
      // Silver — a cluster of bright crystal SPIKES on a low rock base
      body = new THREE.Mesh(new THREE.DodecahedronGeometry(Utils.randRange(0.9, 1.2), 0), rockMat);
      body.position.y = 0.5; body.scale.y = 0.65; g.add(body);
      oreMat = new THREE.MeshStandardMaterial({ color: 0x2a3040, emissive: T.ore, emissiveIntensity: 0.55, roughness: 0.2, metalness: 0.85, flatShading: true });
      for (i = 0; i < 7; i++) {
        var spike = new THREE.Mesh(new THREE.ConeGeometry(Utils.randRange(0.11, 0.2), Utils.randRange(0.7, 1.4), 5), oreMat);
        a = Utils.randRange(0, Math.PI * 2); r = Utils.randRange(0.05, 0.6);
        spike.position.set(Math.cos(a) * r, 0.75 + Utils.randRange(0, 0.35), Math.sin(a) * r);
        spike.rotation.z = Utils.randRange(-0.45, 0.45); spike.rotation.x = Utils.randRange(-0.45, 0.45);
        veins.add(spike);
      }
    } else {
      // Gold — a dark rock cracked open with big GLOWING gold nuggets
      body = new THREE.Mesh(new THREE.DodecahedronGeometry(Utils.randRange(1.1, 1.5), 0), rockMat);
      body.position.y = 0.75; body.rotation.set(Utils.randRange(0, 1), Utils.randRange(0, 3), Utils.randRange(0, 1)); g.add(body);
      oreMat = new THREE.MeshStandardMaterial({ color: 0x4a3410, emissive: T.ore, emissiveIntensity: 0.95, roughness: 0.3, metalness: 0.9, flatShading: true });
      for (i = 0; i < 6; i++) {
        var nugget = new THREE.Mesh(new THREE.IcosahedronGeometry(Utils.randRange(0.2, 0.34), 0), oreMat);
        a = Utils.randRange(0, Math.PI * 2); r = Utils.randRange(0.4, 0.95);
        nugget.position.set(Math.cos(a) * r, 0.75 + Utils.randRange(-0.2, 0.6), Math.sin(a) * r);
        veins.add(nugget);
      }
    }

    g.add(veins);
    g.position.set(x, terrainY(x, z), z);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    markOccluder(g);
    var ent = { type: 'rock', name: T.name, reqLevel: T.reqLevel, itemId: T.itemId, xp: T.xp,
      mesh: g, position: g.position, active: true, interactRange: 2.2,
      veins: veins, body: body, amount: Utils.randInt(4, 7), maxAmount: 7, respawn: 0 };
    tag(g, ent); return ent;
  }

  // ---------- fishing ponds (static, tiered) ----------
  // A little pond you fish from the edge: water disc + colored tier ring +
  // rising bubbles. Higher tiers are bigger and gated by Fishing level.
  function makePond(x, z, tierIdx) {
    var T = FISH_TIERS[tierIdx];
    var g = new THREE.Group();
    var rad = 1.4 + tierIdx * 0.6;
    var disc = new THREE.Mesh(
      new THREE.CylinderGeometry(rad, rad * 0.85, 0.25, 20),
      new THREE.MeshStandardMaterial({ color: 0x35a6cf, emissive: 0x1f6f92, emissiveIntensity: 0.4, roughness: 0.1, metalness: 0.25, transparent: true, opacity: 0.9 })
    );
    disc.position.y = 0.1; g.add(disc);
    var rim = new THREE.Mesh(
      new THREE.TorusGeometry(rad + 0.05, 0.18, 6, 20),
      new THREE.MeshStandardMaterial({ color: 0xd8bd85, roughness: 1, flatShading: true })   // sandy oasis rim
    );
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.14; g.add(rim);
    var ring = new THREE.Mesh(
      new THREE.TorusGeometry(rad * 0.55, 0.09, 8, 20),
      new THREE.MeshBasicMaterial({ color: T.color, transparent: true, opacity: 0.6 })
    );
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.3; g.add(ring);
    var pcount = 12, pgeo = new THREE.BufferGeometry(), arr = new Float32Array(pcount * 3);
    for (var i = 0; i < pcount; i++) {
      arr[i * 3] = Utils.randRange(-rad * 0.55, rad * 0.55);
      arr[i * 3 + 1] = Utils.randRange(0.2, 1.2);
      arr[i * 3 + 2] = Utils.randRange(-rad * 0.55, rad * 0.55);
    }
    pgeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    g.add(new THREE.Points(pgeo, new THREE.PointsMaterial({ color: T.color, size: 0.14, transparent: true, opacity: 0.85, depthWrite: false })));
    g.position.set(x, terrainY(x, z), z);
    scene.add(g);
    var ent = { type: 'fishpool', name: T.name, reqLevel: T.reqLevel, itemId: T.itemId, xp: T.xp,
      mesh: g, position: g.position, active: true, interactRange: rad + 1.6,
      parts: pgeo, ring: ring, phase: Utils.randRange(0, 6), _tier: tierIdx };
    tag(g, ent);
    return ent;
  }

  // the camp pond's catch scales with your Fishing level (lvl1 → tier0, lvl3+ → top tier)
  function fishTierForLevel(lvl) { return Utils.clamp(lvl - 1, 0, FISH_TIERS.length - 1); }
  function retierPond(ent, tier) {
    var T = FISH_TIERS[tier];
    ent._tier = tier;
    ent.name = T.name; ent.reqLevel = T.reqLevel; ent.itemId = T.itemId; ent.xp = T.xp;
    if (ent.ring) ent.ring.material.color.setHex(T.color);
  }

  // ---------- player camp: big open canopy (poles + sheet) over the whole base ----------
  function makeCamp(x, z, num, color) {
    var g = new THREE.Group();
    var faceZ = (z < 0) ? 1 : -1;   // camp opens toward the centre of the map
    var cz = faceZ * 3.0, hx = 9.5, hz = 6.0, poleH = 5.2;

    // big woven carpet under the whole camp
    var rug = new THREE.Mesh(new THREE.BoxGeometry(2 * hx - 1, 0.08, 2 * hz - 1),
      new THREE.MeshStandardMaterial({ color: 0x7a2f3a, roughness: 0.9, flatShading: true }));
    rug.position.set(0, 0.05, cz); g.add(rug);
    var rugTrim = new THREE.Mesh(new THREE.BoxGeometry(2 * hx - 4, 0.1, 2 * hz - 4),
      new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.1, roughness: 0.9, flatShading: true }));
    rugTrim.position.set(0, 0.06, cz); g.add(rugTrim);
    var rugCore = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.12, 3.5),
      new THREE.MeshStandardMaterial({ color: 0xd9b26a, roughness: 0.9, flatShading: true }));
    rugCore.position.set(0, 0.07, cz); g.add(rugCore);

    // four corner poles
    var poleMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1c, roughness: 1, flatShading: true });
    var corners = [[-hx, cz - hz], [hx, cz - hz], [-hx, cz + hz], [hx, cz + hz]];
    for (var c = 0; c < 4; c++) {
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, poleH, 6), poleMat);
      pole.position.set(corners[c][0], poleH / 2, corners[c][1]); g.add(pole);
    }

    // cloth roof — hides when the (top-down) camera looks through it, so you can
    // always see the camp underneath. A low central peak gives it a tented shape.
    var roof = new THREE.Group();
    var sheet = new THREE.Mesh(new THREE.BoxGeometry(2 * hx + 1.2, 0.12, 2 * hz + 1.2),
      new THREE.MeshStandardMaterial({ color: 0xe4cf9c, roughness: 1, flatShading: true, side: THREE.DoubleSide }));
    sheet.position.set(0, poleH, cz); roof.add(sheet);
    var peak = new THREE.Mesh(new THREE.ConeGeometry(hz + 1.5, 1.8, 4),
      new THREE.MeshStandardMaterial({ color: 0xc23b3b, roughness: 1, flatShading: true }));
    peak.rotation.y = Math.PI / 4; peak.position.set(0, poleH + 0.9, cz); roof.add(peak);
    var valance = new THREE.Mesh(new THREE.BoxGeometry(2 * hx + 1.2, 0.5, 0.12),
      new THREE.MeshStandardMaterial({ color: color, roughness: 1, flatShading: true }));
    valance.position.set(0, poleH - 0.25, cz + hz + 0.6); roof.add(valance);
    g.add(roof);

    // banner flag on a front corner pole
    var flag = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.95, 0.06),
      new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.35, roughness: 0.6, side: THREE.DoubleSide }));
    flag.position.set(hx - 0.75, poleH - 0.5, cz + hz); g.add(flag);

    g.position.set(x, terrainY(x, z), z);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    markOccluder(roof);
    scene.add(g);
    var camp = { num: num, name: "Player " + num + "'s Camp",
      colorHex: '#' + ('000000' + color.toString(16)).slice(-6),
      mesh: g, position: g.position };
    camps.push(camp);
    return camp;
  }

  // ---------- crafting stations: campfire / furnace / anvil / merchant ----------
  function makeStation(x, z, kind) {
    var g = new THREE.Group();
    var ent = { type: 'station', kind: kind, mesh: g, position: g.position,
      active: true, interactRange: 2.6, lit: false, level: 1,
      maxLevel: (kind === 'campfire') ? 3 : (kind === 'merchant' || kind === 'altar') ? 1 : 4 };
    if (kind === 'altar') {
      ent.name = 'Ancient Altar';
      var sand = new THREE.MeshStandardMaterial({ color: 0xc2a06a, roughness: 1, flatShading: true });
      var b1 = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.4, 2.0), sand); b1.position.y = 0.2; g.add(b1);
      var b2 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.4, 1.5), sand); b2.position.y = 0.6; g.add(b2);
      var pil = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.9, 8), sand); pil.position.y = 1.25; g.add(pil);
      var bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.34, 0.35, 10),
        new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.7, metalness: 0.3, flatShading: true }));
      bowl.position.y = 1.75; g.add(bowl);
      var runes = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 10),
        new THREE.MeshStandardMaterial({ color: 0x2a2036, emissive: 0x7a4ad0, emissiveIntensity: 0.7, roughness: 0.4 }));
      runes.position.y = 1.92; g.add(runes);
    } else if (kind === 'merchant') {
      ent.name = 'Merchant Stand';
      var frame = new THREE.MeshStandardMaterial({ color: 0x6a4a24, roughness: 1, flatShading: true });
      var cloth = new THREE.MeshStandardMaterial({ color: 0xb03b3b, roughness: 1, flatShading: true });
      // wheelbarrow body (tilted box) + a wheel + handles + goods
      var bin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 1.0), frame); bin.position.set(0, 0.75, 0); bin.rotation.x = -0.12; g.add(bin);
      var wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.18, 12), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1, flatShading: true }));
      wheel.rotation.z = Math.PI / 2; wheel.position.set(0, 0.45, 0.75); g.add(wheel);
      for (var hh = -1; hh <= 1; hh += 2) {
        var handle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 6), frame);
        handle.rotation.x = Math.PI / 2 - 0.15; handle.position.set(hh * 0.6, 0.7, -0.9); g.add(handle);
      }
      var awn = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 1.3), cloth); awn.position.set(0, 2.1, 0); awn.rotation.x = 0.15; g.add(awn);
      var post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 6), frame); post.position.set(0.85, 1.4, 0.5); g.add(post);
      var post2 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 6), frame); post2.position.set(-0.85, 1.4, 0.5); g.add(post2);
      var coin = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 12), new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xffb020, emissiveIntensity: 0.4, roughness: 0.4, metalness: 0.7 }));
      coin.position.set(0, 1.25, 0.05); g.add(coin);
    } else if (kind === 'campfire') {
      ent.name = 'Campfire';
      var wood = new THREE.MeshStandardMaterial({ color: 0x5a3d1e, roughness: 1, flatShading: true });
      for (var i = 0; i < 4; i++) {
        var lg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.3, 6), wood);
        lg.rotation.z = Math.PI / 2; lg.rotation.y = i * Math.PI / 4; lg.position.y = 0.18; g.add(lg);
      }
      var pot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.5, 10),
        new THREE.MeshStandardMaterial({ color: 0x24241f, roughness: 0.7, metalness: 0.3, flatShading: true }));
      pot.position.y = 0.72; g.add(pot);
    } else if (kind === 'furnace') {
      ent.name = 'Furnace';
      var stone = new THREE.MeshStandardMaterial({ color: 0x565049, roughness: 1, flatShading: true });
      var body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.0, 1.5), stone); body.position.y = 1.0; g.add(body);
      var chim = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.9, 0.55), stone); chim.position.set(0.45, 2.3, 0); g.add(chim);
      var open = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.25),
        new THREE.MeshStandardMaterial({ color: 0x0a0400, emissive: 0x000000, emissiveIntensity: 0, roughness: 1 }));
      open.position.set(0, 0.85, 0.76); g.add(open);
      ent.opening = open;
    } else { // anvil
      ent.name = 'Anvil';
      var iron = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.5, metalness: 0.6, flatShading: true });
      var stump = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.7, 8),
        new THREE.MeshStandardMaterial({ color: 0x4a3418, roughness: 1, flatShading: true }));
      stump.position.y = 0.35; g.add(stump);
      var abase = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.9), iron); abase.position.y = 0.82; g.add(abase);
      var atop = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 1.15), iron); atop.position.y = 1.02; g.add(atop);
      var horn = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 6), iron);
      horn.rotation.z = -Math.PI / 2; horn.position.set(0.72, 1.02, 0); g.add(horn);
    }
    g.position.set(x, terrainY(x, z), z);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    if (kind === 'merchant') {
      // camel + rider parked beside the stand; departs off-map when you sell
      var cx = x - 3, cz = z;
      var camelG = makeCamel(cx, cz);
      camelG.rotation.y = Math.atan2(x - cx, z - cz);   // face the stand
      var nd = Math.hypot(cx, cz) || 1;
      ent.camel = { group: camelG, home: { x: cx, z: cz },
        exit: { x: cx + cx / nd * 48, z: cz + cz / nd * 48 },   // radially off the map
        faceHome: camelG.rotation.y, state: 'present', t: 0 };
    }
    tag(g, ent);
    return ent;
  }

  // Light a campfire/furnace: add a flame + point light (and glow a furnace mouth).
  function lightStation(ent) {
    ent.lit = true;
    var flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 0.9, 6),
      new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a10, emissiveIntensity: 2.2, transparent: true, opacity: 0.9 })
    );
    if (ent.kind === 'furnace') { flame.position.set(0, 0.85, 0.66); }
    else { flame.position.y = 0.4; }
    ent.mesh.add(flame);
    var light = new THREE.PointLight(0xff7a2a, 2.4, 11, 2); light.position.y = 1.2; ent.mesh.add(light);
    ent.flame = flame; ent.fireLight = light; ent.baseFire = 2.4;
    if (ent.kind === 'furnace' && ent.opening) {
      ent.opening.material.emissive.setHex(0xff5a10);
      ent.opening.material.emissiveIntensity = 1.6;
    }
  }

  // Use a station with whatever is in the bag (item-data flow).
  function useStation(ent) {
    if (!window.Skills) return;
    var msg;
    if (ent.kind === 'furnace') {
      if (!ent.lit) {
        msg = removeFirstItem(WOOD_IDS)
          ? (lightStation(ent), 'You fire up the furnace.')
          : 'You need a log to fire up the furnace.';
      } else {
        // smelt the best ore whose tier the furnace's LEVEL can handle
        var smelted = false, gatedMsg = null;
        for (var si = 0; si < SMELT_PLAN.length; si++) {
          var sp = SMELT_PLAN[si];
          if (!Skills.hasItem(sp.ore)) continue;
          if (ent.level < sp.tier) { gatedMsg = 'Upgrade the furnace to Lv ' + sp.tier + ' to smelt ' + Skills.ITEMS[sp.ore].name + '.'; continue; }
          Skills.removeItem(sp.ore); Skills.addItem(Skills.SMELT[sp.ore]); Skills.addXp('smithing', 6 + sp.tier * 4);
          msg = 'You smelt a ' + Skills.ITEMS[Skills.SMELT[sp.ore]].name + '.'; smelted = true; break;
        }
        if (!smelted) msg = gatedMsg || 'You need ore to smelt (the furnace is lit).';
      }
    } else if (ent.kind === 'campfire') {
      if (!ent.lit) {
        msg = removeFirstItem(WOOD_IDS)
          ? (lightStation(ent), 'You light the campfire.')
          : 'You need a log to light the campfire.';
      } else {
        // cook the best fish whose tier the campfire's LEVEL can handle
        var cooked = null, cgated = null;
        for (var ci = 0; ci < COOK_PLAN.length; ci++) {
          var cp = COOK_PLAN[ci];
          if (!Skills.hasItem(cp.raw)) continue;
          if (ent.level < cp.tier) { cgated = 'Upgrade the campfire to Lv ' + cp.tier + ' to cook ' + Skills.ITEMS[cp.raw].name + '.'; continue; }
          Skills.removeItem(cp.raw); Skills.addItem(Skills.COOK[cp.raw]); Skills.addXp('cooking', 6 + cp.tier * 4); cooked = cp.raw; break;
        }
        msg = cooked ? 'You cook the catch over the fire.' : (cgated || 'You have no raw catch to cook.');
      }
    } else if (ent.kind === 'anvil') {
      if (window.UI && UI.openSmithMenu) UI.openSmithMenu(ent.level);   // pass the anvil level
      else msg = 'You need the smithing menu to forge here.';
    } else if (ent.kind === 'merchant') {
      if (merchantBusy(ent)) msg = 'The caravan is off delivering — come back when it returns.';
      else if (window.UI && UI.openSellMenu) UI.openSellMenu(ent);
      else msg = 'The merchant eyes your goods.';
    } else if (ent.kind === 'altar') {
      // The Heart of the Obelisk: 1 raw fish + 1 ore + 1 Elderwood + 1 Bandit Essence,
      // and the smith must have reached max Prayer.
      var RAW = ['shrimp', 'lobster', 'whale'], ORE = ['ore', 'iron', 'silver', 'pore'];
      var fish = RAW.filter(function (id) { return Skills.hasItem(id); })[0];
      var ore = ORE.filter(function (id) { return Skills.hasItem(id); })[0];
      var haveWood = Skills.hasItem('elderwood'), haveEss = Skills.hasItem('essence');
      var pr = Skills.data.prayer, prayerMax = pr.level >= (pr.max || 12);
      if (Skills.hasItem('orb')) { msg = 'You already carry the Heart of the Obelisk.'; }
      else if (!prayerMax) { msg = 'You must reach max Prayer (Lv ' + (pr.max || 12) + ') to forge the Heart.'; }
      else if (!fish || !ore || !haveWood || !haveEss) {
        msg = 'The altar needs a raw fish, an ore, Elderwood and a Bandit Essence.';
      } else {
        Skills.removeItem(fish); Skills.removeItem(ore); Skills.removeItem('elderwood'); Skills.removeItem('essence');
        Skills.addItem('orb');
        msg = 'The relics fuse into the Heart of the Obelisk!';
      }
    }
    if (window.UI && msg) UI.showActionText(msg);
    Game.log.push('station:' + ent.kind + (ent.lit ? ':lit' : ''));
  }

  // cost to take a station/pond from its current level to the next (null if maxed)
  function upgradeCost(ent) {
    if (!ent || ent.level >= ent.maxLevel) return null;
    var L = ent.level;
    if (ent.type === 'fishpool') return { gold: L * 50 };          // pond: 50, 100 gold
    if (L === 1) return { gold: 50 };
    if (L === 2) return { gold: 100 };
    return { gold: 150, items: (ent.kind === 'furnace') ? { ore: 15 } : { log: 15 } };  // L3→L4
  }
  function upgradeStation(ent) {
    var cost = upgradeCost(ent);
    if (!cost) { if (window.UI) UI.showActionText((ent.name || 'This') + ' is already max level.'); return false; }
    if ((Game.gold || 0) < (cost.gold || 0)) { if (window.UI) UI.showActionText('Need ' + cost.gold + ' gold to upgrade.'); return false; }
    if (cost.items) { for (var id in cost.items) if (Skills.countItem(id) < cost.items[id]) { if (window.UI) UI.showActionText('Need ' + cost.items[id] + '× ' + Skills.ITEMS[id].name + '.'); return false; } }
    if (cost.gold) Skills.spendGold(cost.gold);
    if (cost.items) { for (var id2 in cost.items) { for (var n = 0; n < cost.items[id2]; n++) Skills.removeItem(id2); } }
    ent.level++;
    if (ent.type === 'fishpool') retierPond(ent, Math.min(ent.level - 1, FISH_TIERS.length - 1));
    if (window.UI) UI.showActionText((ent.name || 'Station') + ' upgraded to Lv ' + ent.level + '!');
    Game.log.push('upgrade:' + (ent.kind || 'pond') + ':' + ent.level);
    return true;
  }

  // merchant caravan: sending it off (after a sale) blocks selling until it returns
  function merchantBusy(ent) { return !!(ent && ent.camel && ent.camel.state !== 'present'); }
  function sendCaravan(ent) { if (ent && ent.camel && ent.camel.state === 'present') { ent.camel.state = 'leaving'; Game.log.push('caravan:leave'); } }
  function updateCamel(ent, dt) {
    var c = ent.camel;
    if (!c || c.state === 'present') return;
    if (c.state === 'gone') { c.t -= dt; if (c.t <= 0) c.state = 'returning'; return; }
    var target = (c.state === 'leaving') ? c.exit : c.home;
    var g = c.group, dx = target.x - g.position.x, dz = target.z - g.position.z, dd = Math.hypot(dx, dz);
    if (dd < 0.5) {
      if (c.state === 'leaving') { c.state = 'gone'; c.t = 8; }   // ~8s off delivering
      else { c.state = 'present'; g.rotation.y = c.faceHome; if (window.UI) UI.showActionText('The merchant caravan has returned.'); }
      return;
    }
    var step = Math.min(6 * dt, dd);
    g.position.x += dx / dd * step; g.position.z += dz / dd * step;
    g.position.y = terrainY(g.position.x, g.position.z);
    g.rotation.y = Math.atan2(dx, dz);
  }

  // ---------- the Obelisk (endgame) ----------
  function makeObelisk(x, z) {
    var g = new THREE.Group();
    var stone = new THREE.MeshStandardMaterial({ color: 0xcaa96a, roughness: 1, flatShading: true });
    var dark = new THREE.MeshStandardMaterial({ color: 0x9a7a44, roughness: 1, flatShading: true });
    var base = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.7, 2.8), dark); base.position.y = 0.35; g.add(base);
    var base2 = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.5, 2.1), stone); base2.position.y = 0.95; g.add(base2);
    var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.75, 9, 4), stone); shaft.rotation.y = Math.PI / 4; shaft.position.y = 5.8; g.add(shaft);
    var cap = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.2, 4),
      new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xffb020, emissiveIntensity: 0.4, roughness: 0.4, metalness: 0.7 }));
    cap.rotation.y = Math.PI / 4; cap.position.y = 10.9; g.add(cap);
    var socket = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a1030, emissive: 0x000000, emissiveIntensity: 0, roughness: 0.4 }));
    socket.position.set(0, 1.7, 1.1); g.add(socket);
    var light = new THREE.PointLight(0x8a5ad0, 0, 26, 2); light.position.set(0, 8, 0); g.add(light);
    g.position.set(x, terrainY(x, z), z);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    markOccluder(g);
    obelisk = { type: 'obelisk', name: 'The Obelisk', mesh: g, position: g.position,
      active: true, interactRange: 3.4, socket: socket, cap: cap, light: light, done: false, t: 0 };
    tag(g, obelisk);
    return obelisk;
  }

  // ---------- ceremony plaza: an Egyptian-ruins clearing around the Obelisk ----------
  // A big flat sandstone floor ringed with broken columns + weathered statues, so
  // the centre reads as an ancient ceremony ground (no resources spawn here).
  function makeCeremonyPlaza() {
    var PLAZA_R = 14;
    var g = new THREE.Group();
    var sand = new THREE.MeshStandardMaterial({ color: 0xcdb082, roughness: 1, flatShading: true });
    var sandDark = new THREE.MeshStandardMaterial({ color: 0xb59468, roughness: 1, flatShading: true });
    // flat inlaid stone floor (kept low so the player walks over it, no clipping)
    var floor = new THREE.Mesh(new THREE.CylinderGeometry(PLAZA_R, PLAZA_R, 0.12, 40), sandDark);
    floor.position.y = 0.06; floor.receiveShadow = true; g.add(floor);
    var inner = new THREE.Mesh(new THREE.CylinderGeometry(PLAZA_R - 5, PLAZA_R - 5, 0.14, 40), sand);
    inner.position.y = 0.08; inner.receiveShadow = true; g.add(inner);
    var core = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 0.16, 32), sandDark);
    core.position.y = 0.10; core.receiveShadow = true; g.add(core);
    // ring of columns — some standing (drum-stacked + capital), some toppled
    var cols = 14;
    for (var i = 0; i < cols; i++) {
      var a = (i / cols) * Math.PI * 2, cr = PLAZA_R - 1.5;
      var cx = Math.cos(a) * cr, cz = Math.sin(a) * cr;
      var toppled = (i % 4 === 0);
      var colG = new THREE.Group();
      var h = toppled ? Utils.randRange(2.4, 3.4) : Utils.randRange(4.5, 7.5);
      var drums = Math.max(2, Math.round(h / 1.5));
      for (var d = 0; d < drums; d++) {
        var drum = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, (h / drums) * 0.98, 12), sand);
        drum.position.y = (d + 0.5) * (h / drums); drum.castShadow = true; colG.add(drum);
      }
      if (!toppled) { var cap2 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.5), sandDark); cap2.position.y = h + 0.2; cap2.castShadow = true; colG.add(cap2); }
      colG.position.set(cx, 0.12, cz);
      if (toppled) { colG.rotation.z = (Utils.rand() > 0.5 ? 1 : -1) * Math.PI / 2; colG.rotation.y = a; colG.position.y = 0.6; }
      g.add(colG);
      if (!toppled) markOccluder(colG);
    }
    // two weathered seated statues flanking a N/S gateway
    [{ z: PLAZA_R - 2, ry: Math.PI }, { z: -(PLAZA_R - 2), ry: 0 }].forEach(function (p) {
      var st = new THREE.Group();
      var base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 2.6), sandDark); base.position.y = 0.82; st.add(base);
      var body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 1.4), sand); body.position.set(0, 2.3, -0.2); st.add(body);
      var head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), sand); head.position.set(0, 3.8, -0.2); st.add(head);
      var nemes = new THREE.Mesh(new THREE.ConeGeometry(0.78, 0.8, 4), sandDark); nemes.rotation.y = Math.PI / 4; nemes.position.set(0, 4.25, -0.2); st.add(nemes);
      st.position.set(0, 0.12, p.z); st.rotation.y = p.ry;
      st.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
      g.add(st); markOccluder(st);
    });
    // flat hieroglyph slabs on the floor
    for (var s2 = 0; s2 < 6; s2++) {
      var a2 = Utils.randRange(0, Math.PI * 2), r2 = Utils.randRange(6, PLAZA_R - 5);
      var slab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.16, 2.0), sandDark);
      slab.position.set(Math.cos(a2) * r2, 0.15, Math.sin(a2) * r2); slab.rotation.y = Utils.randRange(0, Math.PI); g.add(slab);
    }
    scene.add(g);
    return PLAZA_R;
  }

  function triggerWin(byMe, winnerName) {
    if (!obelisk || obelisk.done) return;
    obelisk.done = true; obelisk.t = 0;
    obelisk.socket.material.emissive.setHex(0x9a6aff);
    obelisk.socket.material.emissiveIntensity = 2.5;
    obelisk.light.intensity = 4;
    if (window.UI && UI.showVictory) UI.showVictory(winnerName || 'A rival', !!byMe);
    Game.log.push('win:' + (byMe ? 'me' : 'remote'));
  }
  function useObelisk() {
    if (obelisk && obelisk.done) { if (window.UI) UI.showActionText('The Obelisk blazes — the game is won.'); return; }
    if (!Skills.hasItem('orb')) { if (window.UI) UI.showActionText('The Obelisk socket awaits the Heart of the Obelisk.'); return; }
    Skills.removeItem('orb');
    var myName = (window.Net && Net.myName) ? Net.myName : 'You';
    triggerWin(true, myName);
    if (window.Net && Net.sendWin) Net.sendWin();
  }
  function remoteWin(name) { triggerWin(false, name); }

  // ---------- bandit camps (E/W): waves → boss → drop ----------
  // Each tier is a band of 5; clear all 5 and the camp escalates to the next,
  // stronger tier. After the third band, the boss appears.
  var BANDIT_WAVES = [
    { count: 5, tier: 0, name: 'Bandit',           hp: 14, maxHit: 4 },
    { count: 5, tier: 1, name: 'Bandit Raider',    hp: 26, maxHit: 7 },
    { count: 5, tier: 2, name: 'Bandit Marauder',  hp: 44, maxHit: 10 },
    { count: 1, tier: 2, name: 'Mahmut of the Valley', hp: 200, maxHit: 16, scale: 2.0, boss: true }
  ];
  function spawnWave(camp) {
    var w = BANDIT_WAVES[camp.wave];
    camp.alive = [];
    for (var i = 0; i < w.count; i++) {
      var a = Utils.randRange(0, Math.PI * 2), r = Utils.randRange(4, 9);
      var b = makeEnemy(camp.x + Math.cos(a) * r, camp.z + Math.sin(a) * r, w.tier);
      b.name = w.name; b.reqLevel = 1; b.noRespawn = true; b.banditCamp = camp; b.local = true;
      b.hp = b.maxHp = w.hp; b.maxHit = w.maxHit;
      b.home.set(camp.x, 0, camp.z); b.leashRange = 45; b.wanderRadius = 10;
      if (w.scale) { b.mesh.scale.setScalar(w.scale); b.tierScale = w.scale; b.isBoss = true; }
      bandits.push(b); camp.alive.push(b);
    }
  }
  function makeBanditCamp(x, z, side) {
    var g = new THREE.Group();
    var cloth = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1, flatShading: true });
    var pole = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1, flatShading: true });
    for (var i = 0; i < 3; i++) {
      var a = (i / 3) * Math.PI * 2;
      var tent = new THREE.Mesh(new THREE.ConeGeometry(1.9, 2.4, 4), cloth);
      tent.rotation.y = Math.PI / 4; tent.position.set(Math.cos(a) * 6, 1.2, Math.sin(a) * 6); g.add(tent);
    }
    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.22, 6, 12), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 1 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.1; g.add(ring);
    var flame = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.3, 6),
      new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a10, emissiveIntensity: 2, transparent: true, opacity: 0.9 }));
    flame.position.y = 0.8; g.add(flame);
    var light = new THREE.PointLight(0xff7a2a, 2, 16, 2); light.position.y = 1.6; g.add(light);
    var p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.2, 6), pole); p.position.set(2.5, 2.1, 2.5); g.add(p);
    var banner = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.95, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x8a2a2a, roughness: 0.7, side: THREE.DoubleSide }));
    banner.position.set(3.2, 3.4, 2.5); g.add(banner);
    g.position.set(x, terrainY(x, z), z);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    var camp = { x: x, z: z, side: side, mesh: g, flame: flame, light: light,
      wave: 0, alive: [], between: 0, cleared: false };
    banditCamps.push(camp);
    spawnWave(camp);
    return camp;
  }

  function makeDrop(x, z, itemId, name, bone) {
    var g = new THREE.Group();
    var gem;
    if (bone) {
      // a little pile of pale bones — softly self-lit so they read on the sand,
      // but no PointLight (many can litter the ground; keep the light budget sane)
      var boneMat = new THREE.MeshStandardMaterial({ color: 0xe6ddc4, emissive: 0x6a5a3a, emissiveIntensity: 0.4, roughness: 0.9, flatShading: true });
      gem = new THREE.Group();
      for (var i = 0; i < 3; i++) {
        var seg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 5), boneMat);
        seg.rotation.z = Math.PI / 2; seg.rotation.y = (i / 3) * Math.PI; seg.position.y = 0.12 + i * 0.05; gem.add(seg);
      }
      gem.position.y = 0.12; g.add(gem);
    } else {
      gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0),
        new THREE.MeshStandardMaterial({ color: 0xff3a4a, emissive: 0xff2a3a, emissiveIntensity: 1.3, roughness: 0.4 }));
      gem.position.y = 0.7; g.add(gem);
      var light = new THREE.PointLight(0xff4a5a, 2, 9, 2); light.position.y = 0.7; g.add(light);
    }
    // an invisible, oversized hitbox so small drops (esp. bones) are easy to click
    var hit = new THREE.Mesh(new THREE.SphereGeometry(1.3, 8, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.position.y = 0.6; hit.userData.hitbox = true; g.add(hit);
    g.position.set(x, terrainY(x, z), z);
    scene.add(g);
    var ent = { type: 'drop', name: name, itemId: itemId, mesh: g, gem: gem, bone: !!bone,
      position: g.position, active: true, interactRange: 1.8 };
    tag(g, ent); drops.push(ent);
    return ent;
  }
  function pickupDrop(ent) {
    if (!ent || !ent.active) return;
    ent.active = false; untag(ent); scene.remove(ent.mesh);
    Skills.addItem(ent.itemId);
    if (window.UI) UI.showActionText('You pick up the ' + ent.name + '.');
    Game.log.push('pickup:' + ent.itemId);
  }

  function updateBanditCamps(dt, t) {
    for (var c = 0; c < banditCamps.length; c++) {
      var camp = banditCamps[c];
      if (camp.light) camp.light.intensity = 2 * (0.75 + 0.25 * Math.abs(Math.sin(t * 8 + c)));
      if (camp.flame) camp.flame.scale.y = 0.85 + 0.2 * Math.abs(Math.sin(t * 10 + c));
      if (!camp.cleared) {
        var living = 0, lastPos = null;
        for (var i = 0; i < camp.alive.length; i++) {
          var b = camp.alive[i];
          // every slain bandit drops a pile of bones (bury them for Prayer XP)
          if ((b.state === 'dead' || b.state === 'gone') && !b._boned) {
            b._boned = true;
            makeDrop(b.mesh.position.x, b.mesh.position.z, 'bones', 'Pile of Bones', true);
          }
          if (b.active && b.state !== 'dead' && b.state !== 'gone') living++;
          lastPos = b.mesh.position;
        }
        if (living === 0) {
          var cur = BANDIT_WAVES[camp.wave];
          if (cur.boss) {
            camp.cleared = true;
            makeDrop(lastPos ? lastPos.x : camp.x, lastPos ? lastPos.z : camp.z, 'essence', 'Bandit Essence');
            if (window.UI) UI.showActionText('Mahmut of the Valley falls — a Bandit Essence drops!');
          } else {
            camp.between += dt;
            if (camp.between >= 2.5) {
              camp.wave++; camp.between = 0; spawnWave(camp);
              if (window.UI) UI.showActionText(BANDIT_WAVES[camp.wave].boss ? 'Mahmut of the Valley emerges!' : 'A fiercer band of bandits attacks!');
            }
          }
        }
      }
    }
    for (var k = 0; k < bandits.length; k++) if (bandits[k].state !== 'gone') updateEnemy(bandits[k], dt, t);
    for (var d = 0; d < drops.length; d++) if (drops[d].active) { drops[d].gem.rotation.y += dt * 2; drops[d].mesh.position.y = terrainY(drops[d].position.x, drops[d].position.z) + Math.sin(t * 3 + d) * 0.12; }
  }

  // ---------- ambient critters: rats (attackable, tiny XP) + flying birds ----------
  function makeRat(x, z) {
    var g = new THREE.Group();
    var fur = new THREE.MeshStandardMaterial({ color: 0x6a5a48, roughness: 1, flatShading: true });
    var pink = new THREE.MeshStandardMaterial({ color: 0xc98a86, roughness: 1, flatShading: true });
    var body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 7, 6), fur); body.scale.set(1, 0.7, 1.6); body.position.y = 0.26; g.add(body);
    var head = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 6), fur); head.rotation.x = Math.PI / 2; head.position.set(0, 0.26, 0.42); g.add(head);
    for (var e = 0; e < 2; e++) { var ear = new THREE.Mesh(new THREE.CircleGeometry(0.11, 8), pink); ear.position.set(e ? 0.11 : -0.11, 0.44, 0.3); g.add(ear); }
    var tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.01, 0.7, 4), pink); tail.rotation.x = Math.PI / 2.3; tail.position.set(0, 0.22, -0.5); g.add(tail);
    g.scale.setScalar(0.9);
    g.position.set(x, terrainY(x, z), z);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    var ent = { type: 'enemy', name: 'Desert Rat', reqLevel: 1, isRat: true, local: true, tierScale: 0.9,
      mesh: g, position: g.position, active: true, interactRange: 1.3,
      hp: 3, maxHp: 3, def: 0, maxHit: 0, xpAtk: 1, xpStr: 1,
      home: new THREE.Vector3(x, 0, z), wanderRadius: 10,
      state: 'wander', dying: 0, _wt: null, _idle: 0, _phase: Utils.randRange(0, 6) };
    tag(g, ent); rats.push(ent);
    return ent;
  }
  function updateRats(dt, t) {
    for (var i = 0; i < rats.length; i++) {
      var r = rats[i], pos = r.mesh.position;
      if (r.state === 'dead') {
        r.dying -= dt * 1.4;
        r.mesh.scale.setScalar(Math.max(r.dying, 0.01) * 0.9);
        r.mesh.rotation.z += dt * 8;
        if (r.dying <= 0) { r.mesh.visible = false; r.state = 'gone'; }
        continue;
      }
      if (r.state === 'gone') continue;
      // skittish wander around home; scurry away if the player gets very close
      var pp = Game.player && !Game.player.isDead ? Game.player.position : null;
      var flee = pp && Math.hypot(pp.x - pos.x, pp.z - pos.z) < 4;
      var tx, tz, speed;
      if (flee) {
        var ax = pos.x - pp.x, az = pos.z - pp.z, ad = Math.hypot(ax, az) || 1;
        tx = pos.x + ax / ad * 3; tz = pos.z + az / ad * 3; speed = 4.5;
      } else {
        if (!r._wt || r._idle > 0) { r._idle -= dt; if (!r._wt) { var a = Utils.randRange(0, Math.PI * 2), rr = Utils.randRange(1, r.wanderRadius); r._wt = { x: r.home.x + Math.cos(a) * rr, z: r.home.z + Math.sin(a) * rr }; r._idle = 0; } }
        tx = r._wt.x; tz = r._wt.z; speed = 1.9;
      }
      var dx = tx - pos.x, dz = tz - pos.z, d = Math.hypot(dx, dz);
      if (d > 0.2) { var step = Math.min(speed * dt, d); pos.x += dx / d * step; pos.z += dz / d * step; r.mesh.rotation.y = Math.atan2(dx, dz); }
      else if (!flee) { r._wt = null; r._idle = Utils.randRange(0.5, 2.5); }
      pos.y = terrainY(pos.x, pos.z) + Math.abs(Math.sin(t * 12 + r._phase)) * 0.05;   // scurry bob
    }
  }

  function makeBird(cx, cz, radius, y, dir) {
    var g = new THREE.Group();
    var mat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 1, flatShading: true, side: THREE.DoubleSide });
    var wingL = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.5), mat); wingL.position.x = -0.7; g.add(wingL);
    var wingR = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.5), mat); wingR.position.x = 0.7; g.add(wingR);
    var bodyM = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.8, 5), mat); bodyM.rotation.x = Math.PI / 2; g.add(bodyM);
    scene.add(g);
    var bird = { g: g, wingL: wingL, wingR: wingR, cx: cx, cz: cz, radius: radius, y: y,
      ang: Utils.randRange(0, Math.PI * 2), speed: Utils.randRange(0.12, 0.22) * dir, phase: Utils.randRange(0, 6) };
    birds.push(bird);
    return bird;
  }
  function updateBirds(dt, t) {
    for (var i = 0; i < birds.length; i++) {
      var b = birds[i];
      b.ang += b.speed * dt;
      var x = b.cx + Math.cos(b.ang) * b.radius, z = b.cz + Math.sin(b.ang) * b.radius;
      b.g.position.set(x, b.y + Math.sin(t * 0.5 + b.phase) * 1.5, z);
      b.g.rotation.y = -b.ang + (b.speed > 0 ? -Math.PI / 2 : Math.PI / 2);
      var flap = Math.sin(t * 8 + b.phase) * 0.7;
      b.wingL.rotation.z = flap; b.wingR.rotation.z = -flap;
    }
  }
  function updateCritters(dt, t) { updateRats(dt, t); updateBirds(dt, t); }

  // Scatter n points near (cx,cz) within `spread`, honouring min separation.
  function clusterAround(cx, cz, n, spread, avoidList, minSep) {
    var out = [], sep = minSep || 3, guard = 0;
    while (out.length < n && guard < n * 200) {
      guard++;
      if (guard % (n * 40) === 0) sep *= 0.7;
      var a = Utils.randRange(0, Math.PI * 2), r = spread * Math.sqrt(Utils.rand());
      var x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, ok = true;
      var all = out.concat(avoidList || []);
      for (var i = 0; i < all.length; i++) {
        var p = all[i].position || all[i];
        var dx = p.x - x, dz = p.z - z;
        if (dx * dx + dz * dz < sep * sep) { ok = false; break; }
      }
      if (ok) out.push({ x: x, z: z });
    }
    while (out.length < n) {
      var a2 = Utils.randRange(0, Math.PI * 2), r2 = spread * Math.sqrt(Utils.rand());
      out.push({ x: cx + Math.cos(a2) * r2, z: cz + Math.sin(a2) * r2 });
    }
    return out;
  }

  // ---------- hazard barrel ----------
  // A brazier: a metal fire-bowl on legs with a warm flame (desert lighting).
  function makeBarrel(x, z) {
    var g = new THREE.Group();
    var iron = new THREE.MeshStandardMaterial({ color: 0x3a2f26, roughness: 0.8, metalness: 0.3, flatShading: true });
    var emberMat = new THREE.MeshStandardMaterial({ color: 0x3a1a08, emissive: 0xff6a1a, emissiveIntensity: 1.6, roughness: 0.5 });
    // three legs
    for (var i = 0; i < 3; i++) {
      var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 5), iron);
      var a = (i / 3) * Math.PI * 2;
      leg.position.set(Math.cos(a) * 0.32, 0.5, Math.sin(a) * 0.32);
      leg.rotation.z = Math.cos(a) * 0.25; leg.rotation.x = -Math.sin(a) * 0.25;
      g.add(leg);
    }
    var bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.34, 0.5, 10), iron); bowl.position.y = 1.15; g.add(bowl);
    var embers = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.4, 0.18, 10), emberMat); embers.position.y = 1.36; g.add(embers);
    var flame = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.9, 6),
      new THREE.MeshStandardMaterial({ color: 0xff8a1a, emissive: 0xff6a10, emissiveIntensity: 2.0, transparent: true, opacity: 0.9 }));
    flame.position.y = 1.85; g.add(flame);
    var light = new THREE.PointLight(0xff8a3a, 1.6, 13, 2); light.position.y = 2.0; g.add(light);
    g.position.set(x, terrainY(x, z), z); g.rotation.y = Utils.randRange(0, Math.PI);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    var ent = { type: 'barrel', mesh: g, position: g.position, light: light, flame: flame, baseIntensity: 1.6, active: true };
    barrels.push(ent); return ent;
  }

  // ---------- desert decor (non-interactive scenery) ----------
  function makeCactus(x, z) {
    var g = new THREE.Group();
    var mat = new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 1, flatShading: true });
    var h = Utils.randRange(1.6, 2.8);
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, h, 7), mat); body.position.y = h / 2; g.add(body);
    for (var i = 0; i < 2; i++) {
      var side = i ? 1 : -1;
      var arm = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.9, 6), mat);
      arm.position.set(side * 0.4, h * 0.55, 0); arm.rotation.z = side * 0.9; g.add(arm);
      var up = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.7, 6), mat);
      up.position.set(side * 0.62, h * 0.72, 0); g.add(up);
    }
    g.position.set(x, terrainY(x, z), z);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g); markOccluder(g);
  }
  function makeBoulder(x, z) {
    var mat = new THREE.MeshStandardMaterial({ color: Utils.pick([0xb08050, 0x9c6a3c, 0xc0955f]), roughness: 1, flatShading: true });
    var m = new THREE.Mesh(new THREE.DodecahedronGeometry(Utils.randRange(0.8, 1.9), 0), mat);
    m.position.set(x, terrainY(x, z) + 0.3, z);
    m.rotation.set(Utils.rand(), Utils.rand() * 3, Utils.rand());
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m); markOccluder(m);
  }
  function makeBush(x, z) {
    var g = new THREE.Group();
    var mat = new THREE.MeshStandardMaterial({ color: 0x7a6636, roughness: 1, flatShading: true });
    for (var i = 0; i < 4; i++) {
      var s = new THREE.Mesh(new THREE.IcosahedronGeometry(Utils.randRange(0.2, 0.4), 0), mat);
      s.position.set(Utils.randRange(-0.4, 0.4), Utils.randRange(0.12, 0.45), Utils.randRange(-0.4, 0.4)); g.add(s);
    }
    g.position.set(x, terrainY(x, z), z);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
  }

  // ---------- merchant's camel + rider ----------
  function makeCamel(x, z) {
    var g = new THREE.Group();
    var tan = new THREE.MeshStandardMaterial({ color: 0xc9a05c, roughness: 1, flatShading: true });
    var dark = new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: 1, flatShading: true });
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.85, 2.2), tan); body.position.y = 1.5; g.add(body);
    var hump = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), tan); hump.position.set(0, 2.0, 0.05); hump.scale.set(1, 0.8, 1.1); g.add(hump);
    var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.3, 6), tan); neck.position.set(0, 2.15, 1.15); neck.rotation.x = 0.55; g.add(neck);
    var head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.4, 0.7), tan); head.position.set(0, 2.75, 1.7); g.add(head);
    for (var i = 0; i < 4; i++) {
      var lx = (i % 2 ? 1 : -1) * 0.34, lz = (i < 2 ? 1 : -1) * 0.78;
      var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 1.5, 5), dark); leg.position.set(lx, 0.75, lz); g.add(leg);
    }
    // female rider on the hump: flowing abaya + draped hijab
    var robeMat = new THREE.MeshStandardMaterial({ color: 0x4f7a86, roughness: 1, flatShading: true });   // teal abaya
    var scarfMat = new THREE.MeshStandardMaterial({ color: 0x9a4a6a, roughness: 1, flatShading: true });  // magenta hijab
    var rbody = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.44, 0.95, 8), robeMat); rbody.position.set(0, 2.5, -0.15); g.add(rbody);
    var rhead = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), new THREE.MeshStandardMaterial({ color: 0xc9a17a, roughness: 1, flatShading: true })); rhead.position.set(0, 3.06, -0.08); g.add(rhead);
    var hijab = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.72, 8), scarfMat); hijab.position.set(0, 3.16, -0.15); g.add(hijab);
    var veil = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.55, 0.12), scarfMat); veil.position.set(0, 3.0, -0.42); g.add(veil);
    g.position.set(x, terrainY(x, z), z);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    return g;
  }

  // ---------- ruined building + chest ----------
  function makeBuilding(x, z, lootId) {
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
    var chest = makeChest(0, 0, lootId, g);
    return chest;
  }

  function makeChest(localX, localZ, lootId, parent) {
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
      lootId: lootId };
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
    var g = Skills.GEAR[chest.lootId];
    if (g) {
      var got = Skills.addItem(g.id);         // loot goes into the bag; equip from there
      if (window.UI) {
        UI.toast('Looted', g.name);
        var head = new THREE.Vector3(chest.position.x, chest.position.y + 3.0, chest.position.z);
        UI.spawnSpeech(head, got ? 'You found a ' + g.name + '!' : 'Inventory full!');
      }
    }
    Game.log.push('chestOpened:' + chest.lootId);
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

  // Rectangular scatter in the N–S corridor, honouring min separation.
  function scatterRect(n, xMin, xMax, zMin, zMax, avoid, minSep) {
    var out = [], sep = minSep || 4, guard = 0;
    while (out.length < n && guard < n * 200) {
      guard++;
      if (guard % (n * 40) === 0) sep *= 0.7;
      var x = Utils.randRange(xMin, xMax), z = Utils.randRange(zMin, zMax), ok = true;
      var all = out.concat(avoid || []);
      for (var i = 0; i < all.length; i++) {
        var p = all[i].position || all[i];
        var dx = p.x - x, dz = p.z - z;
        if (dx * dx + dz * dz < sep * sep) { ok = false; break; }
      }
      if (ok) out.push({ x: x, z: z });
    }
    while (out.length < n) out.push({ x: Utils.randRange(xMin, xMax), z: Utils.randRange(zMin, zMax) });
    return out;
  }

  function init(sc) {
    scene = sc;
    enemiesLive = ENEMIES_ENABLED || Game.selftest;
    Game.occluders = [];
    var placed = [];
    var C = World.CAMPS;   // north = player 1, south = player 2

    // --- CAMPS: tent + carpet + flag + crafting stations + a personal fishing pond ---
    makeCamp(C.north.x, C.north.z, 1, 0x3ad1ff);   // Player 1 — cyan
    makeCamp(C.south.x, C.south.z, 2, 0xff6a4a);   // Player 2 — red
    [C.north, C.south].forEach(function (cp) {
      var dir = cp.z < 0 ? 1 : -1;   // stations sit on the map-centre side of the tent
      stations.push(makeStation(cp.x - 5, cp.z + 5 * dir, 'furnace'));
      stations.push(makeStation(cp.x + 5, cp.z + 5 * dir, 'campfire'));
      stations.push(makeStation(cp.x + 7, cp.z + 1 * dir, 'anvil'));
      // merchant + fishing spot sit OUTSIDE the canopy, side by side
      stations.push(makeStation(cp.x + 14, cp.z + 3 * dir, 'merchant'));
      var pond = makePond(cp.x + 14, cp.z + 8 * dir, 0);
      pond.name = 'Fishing Spot'; pond.level = 1; pond.maxLevel = 3; pond.upgradable = true;
      pools.push(pond);
      placed.push({ x: cp.x, z: cp.z });
    });
    stations.forEach(function (s) { placed.push({ x: s.position.x, z: s.position.z }); });
    pools.forEach(function (p) { placed.push({ x: p.position.x, z: p.position.z }); });

    // --- ENDGAME: the ceremony plaza (Egyptian ruins) with the Obelisk + Altar ---
    var PLAZA_R = makeCeremonyPlaza();
    makeObelisk(0, 0); placed.push({ x: 0, z: 0 });
    stations.push(makeStation(7, 5, 'altar')); placed.push({ x: 7, z: 5 });
    var clearR = PLAZA_R + 6;   // resources / scenery stay out of the plaza

    // --- BANDIT CAMPS: east and west, with wave combat + a boss ---
    var BC = World.BANDIT_CAMPS;
    makeBanditCamp(BC.east.x, BC.east.z, 'east'); placed.push({ x: BC.east.x, z: BC.east.z });
    makeBanditCamp(BC.west.x, BC.west.z, 'west'); placed.push({ x: BC.west.x, z: BC.west.z });

    // Resources spread evenly around the whole field in concentric rings, richest
    // nearest the plaza. Totals 11 trees / 8 rocks — mirrored in server.js RES.
    scatter(5, 34, 46, placed, 6).forEach(function (p) { trees.push(makeTree(p.x, p.z, 0)); placed.push(trees[trees.length - 1]); });
    scatter(3, 27, 37, placed, 6).forEach(function (p) { trees.push(makeTree(p.x, p.z, 1)); placed.push(trees[trees.length - 1]); });
    scatter(2, 21, 29, placed, 6).forEach(function (p) { trees.push(makeTree(p.x, p.z, 2)); placed.push(trees[trees.length - 1]); });
    scatter(1, clearR, clearR + 5, placed, 6).forEach(function (p) { trees.push(makeTree(p.x, p.z, 3)); placed.push(trees[trees.length - 1]); });
    scatter(4, 34, 46, placed, 6).forEach(function (p) { rocks.push(makeRock(p.x, p.z, 0)); placed.push(rocks[rocks.length - 1]); });
    scatter(2, 27, 37, placed, 6).forEach(function (p) { rocks.push(makeRock(p.x, p.z, 1)); placed.push(rocks[rocks.length - 1]); });
    scatter(1, 21, 29, placed, 6).forEach(function (p) { rocks.push(makeRock(p.x, p.z, 2)); placed.push(rocks[rocks.length - 1]); });
    scatter(1, clearR, clearR + 5, placed, 6).forEach(function (p) { rocks.push(makeRock(p.x, p.z, 3)); placed.push(rocks[rocks.length - 1]); });

    // --- neutral fishing spots + desert scenery, spread around the ring ---
    [ { t: 0, x: -23, z: -18 }, { t: 1, x: 24, z: 17 }, { t: 2, x: 18, z: -22 }, { t: 1, x: -20, z: 24 } ].forEach(function (pp) {
      pools.push(makePond(pp.x, pp.z, pp.t)); placed.push(pools[pools.length - 1]);
    });
    scatter(12, clearR, 50, placed, 5).forEach(function (p) { makeCactus(p.x, p.z); placed.push(p); });
    scatter(16, clearR, 54, placed, 5).forEach(function (p) { makeBoulder(p.x, p.z); placed.push(p); });
    scatter(18, clearR, 56, placed, 3).forEach(function (p) { makeBush(p.x, p.z); });

    // a brazier at each camp for light
    clusterAround(C.north.x, C.north.z, 1, 6, placed, 5).forEach(function (p) { makeBarrel(p.x, p.z); });
    clusterAround(C.south.x, C.south.z, 1, 6, placed, 5).forEach(function (p) { makeBarrel(p.x, p.z); });

    // --- ambient life: skittering rats (attackable, tiny XP) + birds circling overhead ---
    scatter(8, clearR, 50, placed, 6).forEach(function (p) { makeRat(p.x, p.z); });
    makeBird(0, 0, 55, 30, 1); makeBird(20, -15, 40, 26, -1); makeBird(-30, 10, 48, 34, 1);
    makeBird(10, 40, 36, 24, 1); makeBird(-20, -35, 44, 32, -1);

    // enemies still spawn (for the self-test + server alignment) but are hidden
    // in the live game unless ENEMIES_ENABLED. Placed in an outer ring.
    scatter(4, 10, 24, placed, 5).forEach(function (p) { var e = makeEnemy(p.x, p.z, 0); enemies.push(e); placed.push(e); });
    scatter(3, 22, 34, placed, 5).forEach(function (p) { var e = makeEnemy(p.x, p.z, 1); enemies.push(e); placed.push(e); });
    scatter(2, 32, 44, placed, 5).forEach(function (p) { var e = makeEnemy(p.x, p.z, 2); enemies.push(e); placed.push(e); });
    if (!enemiesLive) {
      for (var q = 0; q < enemies.length; q++) {
        var e = enemies[q];
        e.mesh.visible = false; e.active = false; e.state = 'off';
        untag(e);
      }
    }

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
    if (!ent.isRat) makePortal(ent);   // rats just squish — no hell portal
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
    ent.ai.wanderTarget = null; ent.ai.attackTimer = 0; ent.dying = 0; ent._swing = 0;
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
        if (ent.noRespawn) { ent.state = 'gone'; }          // bandits don't return
        else if (Game.online) { ent.state = 'hidden'; }
        else { ent.state = 'respawning'; ent.respawn = Utils.randRange(4, 7); }
      }
      return;
    }
    // client-side entities (bandits, rats) run local AI even in online games
    if (Game.online && !ent.local) { updateEnemyOnline(ent, dt, t); return; }
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
      if (ent.ai.attackTimer >= ent.attackInterval) { ent.ai.attackTimer = 0; Combat.enemyAttack(ent); ent._swing = 1; }
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
  // A strike is a one-shot: ent._swing is set to 1 at the exact moment the
  // enemy lands a hit (offline: when Combat.enemyAttack fires; online: on the
  // server's `enemyAttack` broadcast, so every client's swing is synced to the
  // real hit). It decays to 0 over ~0.35s, driving a windup->slam->recover pose.
  function animateEnemy(ent, dt, t, moving) {
    ent.animPhase += dt * (moving ? 9 : 2);
    var s = Math.sin(ent.animPhase), p = ent.parts;
    if (!p) return;
    if (ent._swing === undefined) ent._swing = 0;
    if (ent._bodyBase === undefined && p.body) ent._bodyBase = p.body.rotation.x; // keep the tier's hunch
    if (ent._swing > 0) ent._swing = Math.max(0, ent._swing - dt / 0.35);
    var k = ent._swing;
    if (k > 0) {
      // _swing is set to 1 the instant damage lands (offline: with Combat.enemyAttack;
      // online: on the server's enemyAttack broadcast), so pr=0 == contact. The arm is
      // thrown forward ON impact and retracts — the strike is synced to the actual hit,
      // not delayed by a post-hit windup.
      var pr = 1 - k;                       // 0 at the hit .. 1 fully recovered
      var ease = pr * pr * (3 - 2 * pr);    // smoothstep recovery
      var ang = 1.4 * (1 - ease);           // slammed forward at contact -> back to rest
      p.armR.rotation.x = ang;
      p.armL.rotation.x = ang * 0.4;
      p.legL.rotation.x = Utils.damp(p.legL.rotation.x, -0.12, 8, dt);
      p.legR.rotation.x = Utils.damp(p.legR.rotation.x, 0.16, 8, dt);
      if (p.body) p.body.rotation.x = ent._bodyBase + 0.22 * (1 - ease); // lunge held on impact, eases back
    } else {
      p.legL.rotation.x = s * 0.6; p.legR.rotation.x = -s * 0.6;
      p.armL.rotation.x = -s * 0.4; p.armR.rotation.x = s * 0.4;
      if (p.body) p.body.rotation.x = Utils.damp(p.body.rotation.x, ent._bodyBase, 6, dt);
    }
  }

  // trigger a synced attack swing on enemy i (called from the server's enemyAttack event)
  function enemyAttackAnim(i) {
    var e = enemies[i];
    if (!e || e.state === 'dead' || e.state === 'hidden') return;
    e._swing = 1;
  }

  function update(dt, t) {
    var i;
    if (!Game.online) {  // server owns resource respawn when connected
      for (i = 0; i < trees.length; i++) if (!trees[i].active && trees[i].respawn > 0) { trees[i].respawn -= dt; if (trees[i].respawn <= 0) restoreResource(trees[i]); }
      for (i = 0; i < rocks.length; i++) if (!rocks[i].active && rocks[i].respawn > 0) { rocks[i].respawn -= dt; if (rocks[i].respawn <= 0) restoreResource(rocks[i]); }
    }
    for (i = 0; i < barrels.length; i++) { var b = barrels[i]; b.light.intensity = b.baseIntensity * (0.7 + 0.5 * Math.abs(Math.sin(t * 3 + i)) + Utils.rand() * 0.1); if (b.flame) b.flame.scale.y = 0.85 + 0.2 * Math.abs(Math.sin(t * 9 + i)); }
    // animate each fishing pond: rising bubbles + a gently pulsing ring
    for (i = 0; i < pools.length; i++) {
      var sp = pools[i];
      var pp = sp.parts.attributes.position;
      for (var k = 0; k < pp.count; k++) {
        var y = pp.getY(k) + dt * 0.5;
        if (y > 1.4) y -= 1.4;
        pp.setY(k, y);
      }
      pp.needsUpdate = true;
      sp.ring.material.opacity = 0.35 + 0.25 * Math.abs(Math.sin(t * 2 + sp.phase));
    }
    // flicker lit station fires
    for (i = 0; i < stations.length; i++) {
      var stn = stations[i];
      if (!stn.lit || !stn.fireLight) continue;
      stn.fireLight.intensity = stn.baseFire * (0.75 + 0.25 * Math.abs(Math.sin(t * 8 + i)));
      if (stn.flame) stn.flame.scale.y = 0.85 + 0.2 * Math.abs(Math.sin(t * 10 + i));
    }
    for (i = 0; i < stations.length; i++) if (stations[i].camel) updateCamel(stations[i], dt);
    if (obelisk && obelisk.done) {   // victory glow: pulsing light, spinning cap
      obelisk.t += dt;
      obelisk.light.intensity = 3.5 + Math.sin(obelisk.t * 4) * 1.5;
      obelisk.cap.rotation.y += dt * 1.5;
      obelisk.socket.material.emissiveIntensity = 2 + Math.abs(Math.sin(obelisk.t * 6));
    }
    updateBanditCamps(dt, t);
    updateCritters(dt, t);
    // lift the roof off whichever building the local player is standing inside
    // (kept from the parallel branch; no-op while the town uses camps, not buildings)
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
    if (enemiesLive) for (i = 0; i < enemies.length; i++) updateEnemy(enemies[i], dt, t);
  }

  // ---------- applied from server (net.js) ----------
  function applyServerEnemies(list) {
    Game.online = true;
    if (!enemiesLive) return;   // enemies deactivated in the live game
    for (var i = 0; i < list.length; i++) {
      var s = list[i], e = enemies[s.i];
      if (!e) continue;
      e._srv = s;
      if (e.state !== 'dead' && e.state !== 'hidden') e.hp = s.hp;
    }
  }
  function serverEnemyHit(i, dmg) {
    if (!enemiesLive) return;
    var e = enemies[i];
    if (!e || !window.UI) return;
    var head = new THREE.Vector3(e.mesh.position.x, e.mesh.position.y + 2.6, e.mesh.position.z);
    UI.spawnHitsplat(head, dmg, dmg > 0 ? 'hit' : 'miss');
  }
  function serverEnemyDead(i, x, z, byMe) {
    if (!enemiesLive) return;
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
    if (!enemiesLive) return;
    var e = enemies[i];
    if (!e) return;
    e.mesh.visible = false; e.active = false; e.state = 'hidden';
    untag(e); removePortal(e);
  }
  function serverEnemyRespawn(i, x, z) {
    if (!enemiesLive) return;
    var e = enemies[i];
    if (!e) return;
    removePortal(e);
    e.mesh.position.set(x, terrainY(x, z), z);
    e.mesh.rotation.set(0, 0, 0);
    e.mesh.scale.setScalar(e.tierScale);
    e.mesh.visible = true;
    e.hp = e.maxHp; e.active = true; e.state = 'wander'; e.dying = 0; e._swing = 0;
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
    if (enemiesLive) for (var k = 0; k < enemies.length; k++) { if (enemies[k].state !== 'wander') respawnEnemy(enemies[k]); }
  }

  // ---------- full round restart (win countdown / new player joined) ----------
  // A fresh competitive round: reset the world state, then wipe skills+inventory
  // and respawn everyone at their camp. Runs even while online (server-driven).
  function newRound() {
    // obelisk win-state
    if (obelisk) {
      obelisk.done = false; obelisk.t = 0;
      obelisk.socket.material.emissive.setHex(0x000000);
      obelisk.socket.material.emissiveIntensity = 0;
      obelisk.light.intensity = 0;
    }
    // tear down every bandit, then re-open each camp at wave 0
    for (var bi = 0; bi < bandits.length; bi++) { untag(bandits[bi]); removePortal(bandits[bi]); scene.remove(bandits[bi].mesh); }
    bandits.length = 0;
    for (var ci = 0; ci < banditCamps.length; ci++) {
      var camp = banditCamps[ci];
      camp.wave = 0; camp.cleared = false; camp.between = 0; camp.alive = [];
      spawnWave(camp);
    }
    // clear ground drops
    for (var di = 0; di < drops.length; di++) { untag(drops[di]); scene.remove(drops[di].mesh); }
    drops.length = 0;
    // revive rats
    for (var ri = 0; ri < rats.length; ri++) {
      var rt = rats[ri];
      rt.state = 'wander'; rt.active = true; rt.hp = rt.maxHp; rt.dying = 0;
      rt.mesh.visible = true; rt.mesh.scale.setScalar(0.9); rt.mesh.rotation.set(0, 0, 0);
      rt.mesh.position.set(rt.home.x, terrainY(rt.home.x, rt.home.z), rt.home.z);
      rt._wt = null; rt._idle = 0;
      untag(rt); tag(rt.mesh, rt);
    }
    // restore resources
    for (var ti = 0; ti < trees.length; ti++) restoreResource(trees[ti]);
    for (var rki = 0; rki < rocks.length; rki++) restoreResource(rocks[rki]);
    // stations back to Lv1 / unlit; merchant caravan present
    for (var si = 0; si < stations.length; si++) {
      var st = stations[si];
      st.level = 1;
      if (st.lit) {
        st.lit = false;
        if (st.flame) { st.mesh.remove(st.flame); st.flame = null; }
        if (st.fireLight) { st.mesh.remove(st.fireLight); st.fireLight = null; }
        if (st.opening) { st.opening.material.emissive.setHex(0x000000); st.opening.material.emissiveIntensity = 0; }
      }
      if (st.camel) {
        st.camel.state = 'present';
        st.camel.group.position.set(st.camel.home.x, terrainY(st.camel.home.x, st.camel.home.z), st.camel.home.z);
        st.camel.group.rotation.y = st.camel.faceHome;
      }
    }
    // camp fishing ponds back to level 1 / lowest tier
    for (var pi = 0; pi < pools.length; pi++) { if (pools[pi].upgradable) { pools[pi].level = 1; retierPond(pools[pi], 0); } }
    // wipe skills/inventory/gold, respawn the player, clear overlays
    if (window.Skills && Skills.init) Skills.init();
    if (window.Player && Player.reset) Player.reset();
    if (window.UI && UI.clearOverlays) UI.clearOverlays();
    setHighlight(null);
    Game.log.push('newRound');
  }

  return {
    init: init, update: update, reset: reset, newRound: newRound, setHighlight: setHighlight,
    depleteResource: depleteResource, killEnemy: killEnemy, openChest: openChest,
    useStation: useStation, upgradeStation: upgradeStation, upgradeCost: upgradeCost,
    sendCaravan: sendCaravan, merchantBusy: merchantBusy,
    useObelisk: useObelisk, remoteWin: remoteWin, get obelisk() { return obelisk; },
    pickupDrop: pickupDrop,
    get bandits() { return bandits; }, get banditCamps() { return banditCamps; },
    get drops() { return drops; }, get rats() { return rats; },
    applyServerEnemies: applyServerEnemies, serverEnemyHit: serverEnemyHit,
    serverEnemyDead: serverEnemyDead, serverEnemyRespawn: serverEnemyRespawn,
    enemyAttackAnim: enemyAttackAnim,
    initDeadEnemy: initDeadEnemy,
    setResourceState: setResourceState, goOffline: goOffline,
    get interactMeshes() { return interactMeshes; },
    get trees() { return trees; }, get rocks() { return rocks; },
    get enemies() { return enemies; }, get barrels() { return barrels; },
    get pools() { return pools; }, get chests() { return chests; }, get buildings() { return buildings; },
    get stations() { return stations; }, get camps() { return camps; }
  };
})();
