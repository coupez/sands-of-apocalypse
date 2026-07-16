// ============================================================
// coop.js — co-op mode controller
//   * the "Ritual of Five Sigils": light any 3 of 5 to ready the ritual
//   * lighting a sigil raids the shared camp (escalating)
//   * shared, server-authoritative state; reconciles on late join
// Phase 2 wires the two reuse sigils (Hunt, Devotion); the rest arrive
// with their systems (Forge/Plenty/Deep) in later phases.
// ============================================================

var Coop = (function () {
  var SIGILS = [
    { key: 'forge',    name: 'Forge',    icon: '⚒️', color: 0xff7a2a, desc: 'Smith a greatsword' },
    { key: 'hunt',     name: 'Hunt',     icon: '⚔️', color: 0xd23a3a, desc: 'Clear both bandit camps' },
    { key: 'plenty',   name: 'Plenty',   icon: '🍲', color: 0x6ac06a, desc: 'Cook three dishes' },
    { key: 'deep',     name: 'Deep',     icon: '💎', color: 0x3aa6ff, desc: 'Mine the deep gold' },
    { key: 'devotion', name: 'Devotion', icon: '🙏', color: 0xb98aff, desc: 'Reach the height of Prayer' }
  ];
  var THRESHOLD = 3;
  // pixel-art sprite per sigil (falls back to the emoji if unavailable)
  var SIGIL_SPRITE = { forge: 'smithing', hunt: 'attack', plenty: 'cooking', deep: 'gem', devotion: 'prayer' };
  var state = { sigils: {}, ritualReady: false };
  var braziers = {};    // key -> { group, flame, light }
  var active = false;
  var raidCount = 0;
  var scene = null;
  var _regenT = 0;
  function hasSigil(k) { return !!state.sigils[k]; }

  // ---- Buried Demon boss (Mahrûk) ----
  // Shared tuning; the server owns the authoritative sim online, the client sims
  // it offline (single-player co-op sandbox / self-test). Keep the two in step.
  var BOSS = { maxHp: 600, slamInterval: 7.0, windup: 1.1, vuln: 3.0, reach: 9, slamRadius: 6, slamDmg: 11, maxStagger: 100, staggerDur: 5.0 };
  var boss = null;      // { active, hp, maxHp, phase, stage, hand, hx, hz, vulnT, timer, mesh, parts, heartEnt, handEnt, rise }

  function sigilDef(k) { for (var i = 0; i < SIGILS.length; i++) if (SIGILS[i].key === k) return SIGILS[i]; return null; }
  function nameOf(k) { var d = sigilDef(k); return d ? d.name : k; }
  function litCount() { var n = 0; for (var i = 0; i < SIGILS.length; i++) if (state.sigils[SIGILS[i].key]) n++; return n; }

  // ---- entry point: mode chosen / applied ----
  function onMode(mode, coop) {
    if (mode !== 'coop') { teardown(); return; }
    if (active) { if (coop) applyState(coop); return; }
    active = true;
    scene = Game.scene;
    Game.cooked = 0;   // Plenty counts only fish cooked during this co-op run
    buildBraziers();
    if (coop) applyState(coop);
    buildHud();
    refreshBraziers();
    updateHud();
    updateAtmosphere();
    Game.log.push('coop:active');
  }
  function teardown() {
    active = false;
    if (hudEl && hudEl.parentNode) hudEl.parentNode.removeChild(hudEl);
    hudEl = null;
  }

  // ---- shared-state reconciliation (late join / server broadcast) ----
  function applyState(coop) {
    if (!coop) return;
    state.sigils = coop.sigils || {};
    state.ritualReady = !!coop.ritualReady;
    Game.coop = state;
    state.won = !!coop.won;
    // reconstruct any shared builds we haven't spawned yet (late join)
    if (coop.builds && window.Entities && Entities.spawnBuild) {
      for (var i = builtCount; i < coop.builds.length; i++) Entities.spawnBuild(coop.builds[i].id, coop.builds[i].x, coop.builds[i].z);
      builtCount = coop.builds.length;
    }
    if (active) { refreshBraziers(); updateHud(); }
    // reconstruct an in-progress boss for a mid-fight late joiner
    if (coop.boss && coop.boss.active && (!boss || !boss.active)) onBossState(coop.boss);
  }

  // ---- a sigil is confirmed lit (from server, or locally when offline) ----
  function onSigil(which, lit, ritualReady) {
    _pendingSigil[which] = false;
    if (lit && !state.sigils[which]) {
      state.sigils[which] = true;
      lightBrazier(which);
      spawnRaid();
      if (window.UI && UI.announce) UI.announce('The Sigil of ' + nameOf(which) + ' flares to life — the sands stir!', false);
    }
    state.ritualReady = (ritualReady != null) ? ritualReady : (litCount() >= THRESHOLD);
    if (state.ritualReady && window.UI && UI.showActionText) UI.showActionText('The ritual is ready — approach the Obelisk.');
    updateHud();
    updateAtmosphere();
  }

  // client detected an objective is complete → tell the server (or apply offline)
  var _pendingSigil = {};
  function completeSigil(which) {
    if (state.sigils[which] || _pendingSigil[which]) return;
    if (Game.online && window.Net && Net.sendSigil) { _pendingSigil[which] = true; Net.sendSigil(which); }
    else onSigil(which, true, (litCount() + 1) >= THRESHOLD);
  }

  // ---- per-frame objective detection (Phase 2: Hunt + Devotion) ----
  function update(dt) {
    if (!active) return;
    if (!state.sigils.hunt && window.Entities) {
      var camps = Entities.banditCamps;
      if (camps && camps.length >= 2 && camps.every(function (c) { return c.cleared; })) completeSigil('hunt');
    }
    if (!state.sigils.devotion && window.Skills) {
      var pr = Skills.data.prayer;
      if (pr && pr.level >= (pr.max || 12)) completeSigil('devotion');
    }
    if (!state.sigils.forge && Game.forgedRitual) completeSigil('forge');         // smithed an iron+ greatsword
    if (!state.sigils.plenty && (Game.cooked || 0) >= 3) completeSigil('plenty'); // cooked a feast this run
    if (!state.sigils.deep && Game.minedGold) completeSigil('deep');              // mined the deep gold
    animateBraziers(dt);
    // Sigil of Plenty empowers the party with regen during the boss fight
    if (bossActive() && state.sigils.plenty && window.Player && Player.heal) {
      _regenT += dt;
      if (_regenT >= 2) { _regenT = 0; Player.heal(3); }
    }
    // Only ever locally-sim a boss WE started (offline sandbox). A server-born
    // boss (simLocal false) is never taken over by local sim, even if the socket
    // drops — that would run its undefined timers to NaN and freeze/cheat it.
    if (boss && boss.active) { if (!Game.online && boss.simLocal) simBoss(dt); animateDemon(dt); }
  }

  function spawnRaid() {
    if (window.Entities && Entities.spawnRaid) {
      Entities.spawnRaid(3 + raidCount, Math.min(raidCount, 2));
      raidCount++;
    }
  }

  // ---- sigil braziers ringing the plaza ----
  function buildBraziers() {
    if (!scene) scene = Game.scene;
    if (!scene) return;
    for (var i = 0; i < SIGILS.length; i++) {
      var s = SIGILS[i];
      var a = (i / SIGILS.length) * Math.PI * 2 - Math.PI / 2;
      var x = Math.cos(a) * 10, z = Math.sin(a) * 10;
      var g = new THREE.Group();
      var stone = new THREE.MeshStandardMaterial({ color: 0x6a5a44, roughness: 1, flatShading: true });
      var col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 1.4, 8), stone); col.position.y = 0.7; g.add(col);
      var bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.3, 0.4, 10), stone); bowl.position.y = 1.55; g.add(bowl);
      var embers = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.34, 0.14, 10),
        new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 1 }));
      embers.position.y = 1.72; g.add(embers);
      g.position.set(x, 0, z);
      g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
      scene.add(g);
      braziers[s.key] = { group: g, flame: null, light: null, embers: embers, color: s.color };
    }
  }
  function lightBrazier(key) {
    var b = braziers[key];
    if (!b || b.flame) return;
    var flame = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.0, 6),
      new THREE.MeshStandardMaterial({ color: b.color, emissive: b.color, emissiveIntensity: 2.2, transparent: true, opacity: 0.92 }));
    flame.position.y = 2.05; b.group.add(flame); b.flame = flame;
    var light = new THREE.PointLight(b.color, 2.2, 14, 2); light.position.y = 2.3; b.group.add(light); b.light = light;
    b.embers.material.emissive = new THREE.Color(b.color); b.embers.material.emissiveIntensity = 1.2;
  }
  function refreshBraziers() { for (var k in state.sigils) if (state.sigils[k]) lightBrazier(k); }
  function animateBraziers(dt) {
    var t = Game.time;
    for (var k in braziers) {
      var b = braziers[k];
      if (b.flame) { b.flame.scale.y = 0.85 + 0.25 * Math.abs(Math.sin(t * 9 + b.color)); if (b.light) b.light.intensity = 2.2 * (0.75 + 0.25 * Math.abs(Math.sin(t * 8))); }
    }
  }

  // ---- co-op HUD (top-left): the five sigils + ritual progress ----
  var hudEl = null;
  function buildHud() {
    if (Game.headless) return;
    if (hudEl) return;
    hudEl = document.createElement('div');
    hudEl.id = 'coop-hud';
    document.body.appendChild(hudEl);
    updateHud();
  }
  function updateHud() {
    if (!hudEl) return;
    var n = litCount();
    var html = '<div class="ch-head">RITUAL OF SIGILS <span class="ch-count">' + n + '/' + THRESHOLD + '</span></div>';
    for (var i = 0; i < SIGILS.length; i++) {
      var s = SIGILS[i], lit = !!state.sigils[s.key];
      var pu = (window.PixelIcons && PixelIcons.get(SIGIL_SPRITE[s.key]));
      html += '<div class="ch-row' + (lit ? ' lit' : '') + '">' +
        '<span class="ch-ic">' + (pu ? '<img class="pixel-icon" src="' + pu + '" alt="">' : s.icon) + '</span>' +
        '<span class="ch-nm">' + s.name + '</span>' +
        '<span class="ch-st">' + (lit ? 'lit' : s.desc) + '</span></div>';
    }
    if (state.ritualReady) html += '<div class="ch-ready">✦ The ritual awaits at the Obelisk ✦</div>';
    hudEl.innerHTML = html;
  }

  // ---- constructables (build menu) ----
  var BLUEPRINTS = [
    { id: 'ballista', name: 'Ballista', icon: '🏹', cost: { log: 4, ironbar: 2 }, desc: 'A siege weapon that batters the demon during the fight.' }
  ];
  var builtCount = 0;   // shared builds spawned locally (late-join dedup)
  function blueprint(id) { for (var i = 0; i < BLUEPRINTS.length; i++) if (BLUEPRINTS[i].id === id) return BLUEPRINTS[i]; return null; }
  function build(id) {
    var bp = blueprint(id); if (!bp || !window.Skills) return false;
    for (var k in bp.cost) if (Skills.countItem(k) < bp.cost[k]) { if (window.UI) UI.showActionText('You lack the materials for the ' + bp.name + '.'); return false; }
    for (var k2 in bp.cost) for (var n = 0; n < bp.cost[k2]; n++) Skills.removeItem(k2);
    var p = Game.player && Game.player.position ? Game.player.position : { x: 0, z: 20 };
    var sx = Math.round(p.x), sz = Math.round(p.z);
    if (Game.online && window.Net && Net.sendBuild) Net.sendBuild(id, sx, sz);
    else onBuild(id, sx, sz);
    Game.log.push('coop:build:' + id);
    return true;
  }
  function onBuild(id, x, z) {
    builtCount++;
    if (window.Entities && Entities.spawnBuild) Entities.spawnBuild(id, x, z);
    if (window.UI && UI.showActionText) UI.showActionText('You raise a ' + id + '!');
  }

  // ---- summoning the ritual (from the Obelisk when ready) ----
  function startRitual() {
    if (!active || !state.ritualReady || (boss && boss.active)) return;
    if (window.UI && UI.announce) UI.announce('The ritual completes… the earth splits open!', true);
    if (Game.online && window.Net && Net.sendRitualStart) Net.sendRitualStart();
    else startBossLocal();
    Game.log.push('coop:ritualStart');
  }
  function startBossLocal() {
    boss = { active: true, hp: BOSS.maxHp, maxHp: BOSS.maxHp, stagger: 0, maxStagger: BOSS.maxStagger, phase: 1, simLocal: true,
      stage: 'idle', hand: 'L', hx: 0, hz: 0, vulnT: 0, timer: BOSS.slamInterval, rise: 0 };
    buildDemon();
    updateAtmosphere();
    announceBoons();
    if (window.UI && UI.showBossBar) UI.showBossBar('Mahrûk, the Buried Demon', boss.hp, boss.maxHp);
    Game.log.push('coop:bossStart');
  }

  // ---- the demon mesh ----
  function buildDemon() {
    if (!scene) scene = Game.scene;
    if (!scene || (boss && boss.mesh)) return;
    var g = new THREE.Group();
    var flesh = new THREE.MeshStandardMaterial({ color: 0x2a1420, roughness: 1, flatShading: true });
    var dark = new THREE.MeshStandardMaterial({ color: 0x160a12, roughness: 1, flatShading: true });
    var horn = new THREE.MeshStandardMaterial({ color: 0x3a2a2a, roughness: 0.8, flatShading: true });
    var torso = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.6, 8, 8), flesh); torso.position.y = 6; g.add(torso);
    var chest = new THREE.Mesh(new THREE.DodecahedronGeometry(3.0, 0), flesh); chest.position.set(0, 8.5, 0.6); chest.scale.set(1.3, 1.0, 0.9); g.add(chest);
    var head = new THREE.Mesh(new THREE.DodecahedronGeometry(1.7, 0), flesh); head.position.set(0, 12.2, 0.4); g.add(head);
    for (var h = 0; h < 2; h++) {
      var hn = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.4, 5), horn);
      hn.position.set(h ? 1.0 : -1.0, 13.4, 0.2); hn.rotation.z = h ? -0.5 : 0.5; hn.rotation.x = -0.3; g.add(hn);
    }
    // glowing eyes
    var eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a0000, emissive: 0xff5a10, emissiveIntensity: 2 });
    for (var e = 0; e < 2; e++) { var ey = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), eyeMat); ey.position.set(e ? 0.6 : -0.6, 12.4, 1.5); g.add(ey); }
    // the HEART weak point — a glowing orb on the chest (bow-only)
    var heartMat = new THREE.MeshStandardMaterial({ color: 0x3a0000, emissive: 0xff2a2a, emissiveIntensity: 1.4, roughness: 0.3 });
    var heart = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 0), heartMat); heart.position.set(0, 8.6, 2.6); g.add(heart);
    var heartLight = new THREE.PointLight(0xff3a2a, 1.5, 20, 2); heartLight.position.set(0, 8.6, 3); g.add(heartLight);
    // arms (shoulder-pivoted), each with a clawed hand
    function arm(side) {
      var pivot = new THREE.Group(); pivot.position.set(side * 3.2, 9.5, 0);
      var upper = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 5.5, 6), flesh); upper.position.y = -2.75; pivot.add(upper);
      var hand = new THREE.Mesh(new THREE.DodecahedronGeometry(1.5, 0), dark); hand.position.y = -6; pivot.add(hand);
      for (var c = 0; c < 4; c++) { var cl = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.3, 4), horn); cl.position.set((c - 1.5) * 0.5, -7, 0.4); cl.rotation.x = 2.4; pivot.add(cl); }
      g.add(pivot); return { pivot: pivot, hand: hand };
    }
    var armL = arm(-1), armR = arm(1);
    g.position.set(0, -14, 0);   // starts buried; rises during the summon
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    boss.mesh = g; boss.heart = heart; boss.heartMat = heartMat; boss.heartLight = heartLight;
    boss.armL = armL; boss.armR = armR;

    // slam telegraph decal — a red ground ring at the impact point during windup
    var decal = new THREE.Mesh(new THREE.RingGeometry(1.2, BOSS.slamRadius, 28),
      new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }));
    decal.rotation.x = -Math.PI / 2; decal.position.y = 0.07; decal.visible = false;
    scene.add(decal); boss.decal = decal;

    // HEART interactable (bow-only, always present; only damages during a window)
    boss.heartEnt = { type: 'boss', part: 'heart', name: "Mahrûk's Heart", ranged: true,
      mesh: heart, position: new THREE.Vector3(0, 8.6, 2.6), active: true, interactRange: 16 };
    if (window.Entities && Entities.tagExternal) Entities.tagExternal(heart, boss.heartEnt);
  }

  // per-frame demon animation (rise + slam poses + heart pulse)
  function animateDemon(dt) {
    var b = boss; if (!b || !b.mesh) return;
    b.rise = Math.min(1, (b.rise || 0) + dt * 0.5);
    b.mesh.position.y = -14 + b.rise * 14;   // rise out of the earth
    var t = Game.time;
    if (b.heartMat) b.heartMat.emissiveIntensity = (b.stage === 'vuln') ? (2.4 + Math.abs(Math.sin(t * 8))) : 1.0;
    // idle sway
    b.mesh.rotation.y = Math.sin(t * 0.4) * 0.08;
    // arm slam pose: the active hand swings down during windup→vuln, retracts after
    var reachAng = { L: b.armL, R: b.armR };
    for (var s in reachAng) {
      var a = reachAng[s]; if (!a) continue;
      var target = 0;
      if (b.stage === 'stagger') target = 1.5;                        // both hands down, reeling
      else if (b.hand === s && b.stage === 'windup') target = -0.8;   // raised
      else if (b.hand === s && b.stage === 'vuln') target = 1.5;      // slammed down
      a.pivot.rotation.x = Utils.damp(a.pivot.rotation.x, target, 10, dt);
    }
    // reel the whole body while staggered
    b.mesh.rotation.z = Utils.damp(b.mesh.rotation.z, b.stage === 'stagger' ? 0.18 * Math.sin(t * 6) : 0, 8, dt);
    // keep the heart entity's world position current (it barely moves, but sway shifts it)
    if (b.heartEnt) b.heart.getWorldPosition(b.heartEnt.position);
    // slam telegraph decal
    if (b.decal) {
      if (b.stage === 'windup') { b.decal.visible = true; b.decal.position.set(b.hx, 0.07, b.hz); b.decal.material.opacity = 0.25 + 0.45 * Math.abs(Math.sin(t * 12)); }
      else if (b.stage === 'vuln') { b.decal.visible = true; b.decal.position.set(b.hx, 0.07, b.hz); b.decal.material.opacity = Math.max(0, b.decal.material.opacity - dt * 0.9); }
      else b.decal.visible = false;
    }
  }

  // announce which sigil boons are active for the fight (your 3 = a boss loadout)
  function announceBoons() {
    if (!window.UI || !UI.announce) return;
    var b = [];
    if (state.sigils.forge) b.push('Forge (+stagger)');
    if (state.sigils.devotion) b.push('Devotion (+heart dmg)');
    if (state.sigils.plenty) b.push('Plenty (regen)');
    if (state.sigils.deep) b.push('Deep (siege bolts)');
    if (state.sigils.hunt) b.push('Hunt (fewer imps)');
    if (b.length) UI.announce('Your sigils empower you — ' + b.join(', '), false);
  }
  // day → dusk as the ritual advances; full blood-dusk during the boss
  function updateAtmosphere() {
    if (!window.World || !World.setDusk) return;
    var d = (litCount() / SIGILS.length) * 0.75;
    if (bossActive()) d = Math.max(d, 0.95);
    else if (state.won) d = 0.25;
    World.setDusk(d);
  }
  // slam cadence + phase quicken as Mahrûk's health falls
  function slamIntervalFor(b) {
    var f = b.hp / b.maxHp;
    return f > 0.66 ? BOSS.slamInterval : f > 0.33 ? 5.3 : 4.0;
  }
  function updateBossPhase() {
    var b = boss; if (!b) return;
    var f = b.hp / b.maxHp;
    var ph = f > 0.66 ? 1 : f > 0.33 ? 2 : 3;
    if (ph !== b.phase) {
      b.phase = ph;
      if (ph === 3 && !b._imped) {
        b._imped = true;
        // Sigil of the Hunt eases the enrage (fewer imps)
        if (window.Entities && Entities.spawnImps) Entities.spawnImps(state.sigils.hunt ? 2 : 3);
        if (window.UI && UI.announce) UI.announce('Mahrûk shrieks — imps claw up from the cracks!', false);
      }
    }
  }

  // ---- offline sim (mirrors the server; online is server-authoritative) ----
  function simBoss(dt) {
    var b = boss; if (!b || !b.active) return;
    if (b.stage === 'idle' || b.stage === 'recover') {
      b.timer -= dt;
      if (b.timer <= 0) {
        var p = Game.player && Game.player.position ? Game.player.position : { x: 0, z: 0 };
        var d = Math.hypot(p.x, p.z) || 1;
        b.hx = p.x / d * BOSS.reach; b.hz = p.z / d * BOSS.reach;
        b.hand = (Utils.rand() < 0.5) ? 'L' : 'R';
        b.stage = 'windup'; b.timer = BOSS.windup;
        onBossSlam({ stage: 'windup', hand: b.hand, x: b.hx, z: b.hz, windup: BOSS.windup });
      }
    } else if (b.stage === 'windup') {
      b.timer -= dt;
      if (b.timer <= 0) { b.stage = 'vuln'; b.vulnT = BOSS.vuln; openWindow(); onBossSlam({ stage: 'impact', hand: b.hand, x: b.hx, z: b.hz, radius: BOSS.slamRadius, dmg: BOSS.slamDmg }); }
    } else if (b.stage === 'vuln' || b.stage === 'stagger') {
      b.vulnT -= dt;
      if (b.vulnT <= 0) {
        if (b.stage === 'stagger') b.stagger = 0;
        b.stage = 'idle'; closeWindow(); b.timer = slamIntervalFor(b);
      }
    }
  }
  // Mahrûk reels when the stagger meter fills: a long window, both hands + heart open
  function enterStagger() {
    var b = boss; if (!b) return;
    b.stage = 'stagger'; b.vulnT = BOSS.staggerDur;
    if (typeof b.hx !== 'number' || (b.hx === 0 && b.hz === 0)) { b.hx = 0; b.hz = BOSS.reach; }
    openWindow();
    if (window.UI && UI.announce) UI.announce('Mahrûk is STAGGERED — unload on the heart!', false);
  }

  // ---- weak-point windows: tag/untag the slammed hand target ----
  function openWindow() {
    var b = boss; if (!b) return;
    // a ground hand target at (hx,hz) — melee only
    if (!b.handEnt) {
      var hm = new THREE.Mesh(new THREE.OctahedronGeometry(1.4, 0),
        new THREE.MeshStandardMaterial({ color: 0x2a0000, emissive: 0xff3a1a, emissiveIntensity: 1.6, roughness: 0.4 }));
      b.handMesh = hm; scene.add(hm);
      b.handEnt = { type: 'boss', part: 'hand', name: "Mahrûk's Hand", mesh: hm, position: new THREE.Vector3(), active: true, interactRange: 3.2 };
    }
    b.handMesh.visible = true;
    b.handMesh.position.set(b.hx, 0.8, b.hz);
    b.handEnt.position.set(b.hx, 0.8, b.hz);
    b.handEnt.active = true;
    if (window.Entities && Entities.tagExternal) Entities.tagExternal(b.handMesh, b.handEnt);
  }
  function closeWindow() {
    var b = boss; if (!b || !b.handEnt) return;
    b.handEnt.active = false;
    if (b.handMesh) b.handMesh.visible = false;
    if (window.Entities && Entities.untagExternal) Entities.untagExternal(b.handEnt);
  }

  // ---- inbound (server-driven, online) ----
  function onBossState(s) {
    if (!s) return;
    if (s.active && (!boss || !boss.active)) startBossFromServer(s);
    if (!boss) return;
    boss.hp = s.hp; boss.maxHp = s.maxHp; boss.phase = s.phase;
    if (typeof s.stagger === 'number') boss.stagger = s.stagger;
    if (typeof s.maxStagger === 'number') boss.maxStagger = s.maxStagger;
    var was = boss.stage; boss.stage = s.stage; boss.hand = s.hand || boss.hand;
    if (typeof s.hx === 'number') { boss.hx = s.hx; boss.hz = s.hz; }
    var openNow = (boss.stage === 'vuln' || boss.stage === 'stagger');
    var wasOpen = (was === 'vuln' || was === 'stagger');
    if (openNow && !wasOpen) openWindow();
    if (!openNow && wasOpen) closeWindow();
    updateBossPhase();
    if (window.UI && UI.updateBossBar) UI.updateBossBar(boss.hp, boss.maxHp, boss.stagger, boss.maxStagger);
    if (!s.active) onBossDead();
  }
  function startBossFromServer(s) {
    boss = { active: true, hp: s.hp, maxHp: s.maxHp, stagger: s.stagger || 0, maxStagger: s.maxStagger || BOSS.maxStagger,
      phase: s.phase, simLocal: false, timer: 0, vulnT: 0,
      stage: s.stage, hand: s.hand || 'L', hx: s.hx || 0, hz: s.hz || 0, rise: 0 };
    buildDemon();
    updateAtmosphere();
    announceBoons();
    if (window.UI && UI.showBossBar) UI.showBossBar('Mahrûk, the Buried Demon', boss.hp, boss.maxHp);
  }
  function onBossSlam(msg) {
    var b = boss; if (!b) return;
    if (msg.stage === 'impact') {
      // damage the local player if caught in the slam and not dodging
      var p = Game.player;
      if (p && p.position && !p.isDead) {
        var d = Math.hypot(p.position.x - msg.x, p.position.z - msg.z);
        if (d <= (msg.radius || BOSS.slamRadius) && !(p.isInvulnerable && p.isInvulnerable())) p.takeDamage(msg.dmg || BOSS.slamDmg);
      }
      if (window.UI && UI.spawnHitsplat) { /* dust puff via hitsplat omitted */ }
    }
  }
  function onBossHit(part, dmg, hp, stagger) {
    var b = boss; if (!b) return;
    if (typeof hp === 'number') b.hp = hp;
    if (typeof stagger === 'number') b.stagger = stagger;
    updateBossPhase();
    var pos = (part === 'heart') ? b.heartEnt && b.heartEnt.position : b.handEnt && b.handEnt.position;
    if (pos && window.UI && UI.spawnHitsplat) UI.spawnHitsplat(new THREE.Vector3(pos.x, pos.y + 1.5, pos.z), dmg, part === 'heart' ? 'crit' : 'hit');
    if (window.UI && UI.updateBossBar) UI.updateBossBar(b.hp, b.maxHp, b.stagger, b.maxStagger);
  }
  function onBossDead() {
    var b = boss; if (!b) return;
    b.active = false;
    closeWindow();
    if (b.mesh && scene) scene.remove(b.mesh);
    if (b.decal && scene) scene.remove(b.decal);
    if (b.handMesh && scene) scene.remove(b.handMesh);   // don't leak the hand target
    if (b.heartEnt && window.Entities && Entities.untagExternal) Entities.untagExternal(b.heartEnt);
    if (window.Entities && Entities.clearRaiders) Entities.clearRaiders();   // clear leftover raiders/imps
    // victory is final — the ritual can't be re-run (no re-summon loop)
    state.ritualReady = false; state.won = true;
    updateAtmosphere();   // dawn returns
    if (window.UI) { if (UI.hideBossBar) UI.hideBossBar(); if (UI.showVictory) UI.showVictory('The party', true, 'You banished Mahrûk and saved the sands!'); }
    Game.log.push('coop:bossDead');
    boss = null;
  }
  function bossVulnerable() { return !!(boss && boss.active && (boss.stage === 'vuln' || boss.stage === 'stagger')); }
  // a fallen hero feeds the demon — Mahrûk regenerates a little (deters zerging).
  // Online the server owns this; offline we apply it locally.
  function onPlayerDeath() {
    if (Game.online || !boss || !boss.active) return;
    boss.hp = Math.min(boss.maxHp, boss.hp + Math.round(boss.maxHp * 0.05));
    if (window.UI) { if (UI.updateBossBar) UI.updateBossBar(boss.hp, boss.maxHp, boss.stagger, boss.maxStagger); if (UI.announce) UI.announce('Mahrûk feeds on the fallen — its wounds knit shut.', false); }
  }

  // ---- player struck a weak point (called from combat) ----
  // heart = real HP damage (bow/ballista); hand = a chip + `stagAmt` on the stagger meter (melee)
  function hitBoss(ent, dmg, stagAmt) {
    var b = boss; if (!b || !b.active) return;
    var part = ent.part;
    if (Game.online && window.Net && Net.sendBossHit) Net.sendBossHit(part, part === 'heart' ? 'ranged' : 'melee', dmg, stagAmt || 0);
    else applyBossHitLocal(part, dmg, stagAmt || 0);
  }
  function applyBossHitLocal(part, dmg, stagAmt) {
    var b = boss; if (!b || !b.active) return;
    if (b.stage !== 'vuln' && b.stage !== 'stagger') return;   // window closed
    var d = Math.max(0, Math.min(80, Math.floor(dmg)));
    if (part === 'heart') b.hp = Math.max(0, b.hp - d);
    else b.hp = Math.max(0, b.hp - Math.floor(d * 0.25));
    if (stagAmt > 0 && b.stage !== 'stagger') b.stagger = Math.min(b.maxStagger, (b.stagger || 0) + Math.min(50, Math.floor(stagAmt)));
    onBossHit(part, d, b.hp, b.stagger);
    updateBossPhase();
    if (b.stagger >= b.maxStagger && b.stage !== 'stagger') enterStagger();
    if (b.hp <= 0) onBossDead();
  }

  function bossActive() { return !!(boss && boss.active); }
  function onBossHp(hp, stagger) {
    if (!boss) return;
    if (typeof hp === 'number') boss.hp = hp;
    if (typeof stagger === 'number') boss.stagger = stagger;
    updateBossPhase();
    if (window.UI && UI.updateBossBar) UI.updateBossBar(boss.hp, boss.maxHp, boss.stagger, boss.maxStagger);
  }

  return {
    onMode: onMode, applyState: applyState, onSigil: onSigil, completeSigil: completeSigil,
    update: update, teardown: teardown, startRitual: startRitual,
    build: build, onBuild: onBuild, BLUEPRINTS: BLUEPRINTS,
    onBossState: onBossState, onBossSlam: onBossSlam, onBossHit: onBossHit, onBossDead: onBossDead,
    onBossHp: onBossHp, hitBoss: hitBoss, bossActive: bossActive, bossVulnerable: bossVulnerable, hasSigil: hasSigil, onPlayerDeath: onPlayerDeath,
    get state() { return state; }, get active() { return active; }, get boss() { return boss; },
    litCount: litCount, THRESHOLD: THRESHOLD, SIGILS: SIGILS
  };
})();
