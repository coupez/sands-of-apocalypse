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
    { key: 'forge',    name: 'Forge',    icon: '⚒️', color: 0xff7a2a, desc: 'Smith a ritual weapon' },
    { key: 'hunt',     name: 'Hunt',     icon: '⚔️', color: 0xd23a3a, desc: 'Clear both bandit camps' },
    { key: 'plenty',   name: 'Plenty',   icon: '🍲', color: 0x6ac06a, desc: 'Cook a great feast' },
    { key: 'deep',     name: 'Deep',     icon: '🌊', color: 0x3aa6ff, desc: 'Bridge to the sunken shrine' },
    { key: 'devotion', name: 'Devotion', icon: '🙏', color: 0xb98aff, desc: 'Reach the height of Prayer' }
  ];
  var THRESHOLD = 3;
  var state = { sigils: {}, ritualReady: false };
  var braziers = {};    // key -> { group, flame, light }
  var active = false;
  var raidCount = 0;
  var scene = null;

  function sigilDef(k) { for (var i = 0; i < SIGILS.length; i++) if (SIGILS[i].key === k) return SIGILS[i]; return null; }
  function nameOf(k) { var d = sigilDef(k); return d ? d.name : k; }
  function litCount() { var n = 0; for (var i = 0; i < SIGILS.length; i++) if (state.sigils[SIGILS[i].key]) n++; return n; }

  // ---- entry point: mode chosen / applied ----
  function onMode(mode, coop) {
    if (mode !== 'coop') { teardown(); return; }
    if (active) { if (coop) applyState(coop); return; }
    active = true;
    scene = Game.scene;
    buildBraziers();
    if (coop) applyState(coop);
    buildHud();
    refreshBraziers();
    updateHud();
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
    if (active) { refreshBraziers(); updateHud(); }
  }

  // ---- a sigil is confirmed lit (from server, or locally when offline) ----
  function onSigil(which, lit, ritualReady) {
    if (lit && !state.sigils[which]) {
      state.sigils[which] = true;
      lightBrazier(which);
      spawnRaid();
      if (window.UI && UI.announce) UI.announce('The Sigil of ' + nameOf(which) + ' flares to life — the sands stir!', false);
    }
    state.ritualReady = (ritualReady != null) ? ritualReady : (litCount() >= THRESHOLD);
    if (state.ritualReady && window.UI && UI.showActionText) UI.showActionText('The ritual is ready — approach the Obelisk.');
    updateHud();
  }

  // client detected an objective is complete → tell the server (or apply offline)
  function completeSigil(which) {
    if (state.sigils[which]) return;
    if (Game.online && window.Net && Net.sendSigil) Net.sendSigil(which);
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
    animateBraziers(dt);
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
      html += '<div class="ch-row' + (lit ? ' lit' : '') + '">' +
        '<span class="ch-ic">' + s.icon + '</span>' +
        '<span class="ch-nm">' + s.name + '</span>' +
        '<span class="ch-st">' + (lit ? 'lit' : s.desc) + '</span></div>';
    }
    if (state.ritualReady) html += '<div class="ch-ready">✦ The ritual awaits at the Obelisk ✦</div>';
    hudEl.innerHTML = html;
  }

  return {
    onMode: onMode, applyState: applyState, onSigil: onSigil, completeSigil: completeSigil,
    update: update, teardown: teardown,
    get state() { return state; }, get active() { return active; },
    litCount: litCount, THRESHOLD: THRESHOLD, SIGILS: SIGILS
  };
})();
