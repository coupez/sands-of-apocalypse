// ============================================================
// net.js — real-time multiplayer client (WebSocket)
// Connects to the Bun server, streams the local player's pose,
// receives snapshots, and renders remote players as tinted
// survivors with floating nameplates.
// ============================================================

var Net = (function () {
  var enabled = false;
  var ws = null;
  var myId = null;
  var myName, myColor, myColorHex;
  var others = {};          // id -> avatar record
  var remoteMeshes = [];    // clickable meshes tagged with userData.ref
  var sendAccum = 0;
  var SEND_INTERVAL = 0.08; // ~12 Hz
  var statusEl = null;
  var connected = false;
  var reconnectT = 0;

  var COLORS = [0x8dff3a, 0x3ad1ff, 0xff6ad5, 0xffd23f, 0xff7a3a, 0xa678ff, 0x6dffa0, 0xff5252];

  function init() {
    if (location.protocol === 'file:') return; // no server available
    // network identity uses Math.random (NOT the seeded world RNG) so each
    // client is unique even though the world layout is identical.
    myColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    myColorHex = '#' + ('000000' + myColor.toString(16)).slice(-6);
    myName = 'Wanderer-' + (100 + Math.floor(Math.random() * 900));
    enabled = true;

    statusEl = document.createElement('div');
    statusEl.id = 'net-status';
    statusEl.innerHTML = '<span class="dot"></span> connecting…';
    document.getElementById('hud').appendChild(statusEl);

    connect();
  }

  function connect() {
    try {
      var proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(proto + '://' + location.host + '/ws');
    } catch (e) { scheduleReconnect(); return; }

    ws.onopen = function () {
      connected = true;
      setStatus();
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'welcome') {
        myId = msg.id;
        if (window.Player && Player.moveToCamp && msg.slot) Player.moveToCamp(msg.slot);
      }
      else if (msg.type === 'worldInit') {
        // reconcile the current shared-world state before the first snapshot
        Game.online = true;
        var d;
        if (msg.deadEnemies) for (d = 0; d < msg.deadEnemies.length; d++) Entities.initDeadEnemy(msg.deadEnemies[d]);
        if (msg.resources) {
          if (msg.resources.tree) for (d = 0; d < msg.resources.tree.length; d++) if (!msg.resources.tree[d]) Entities.setResourceState('tree', d, false);
          if (msg.resources.rock) for (d = 0; d < msg.resources.rock.length; d++) if (!msg.resources.rock[d]) Entities.setResourceState('rock', d, false);
        }
      }
      else if (msg.type === 'snapshot') {
        sync(msg.players);
        if (msg.enemies) Entities.applyServerEnemies(msg.enemies);
      }
      else if (msg.type === 'leave') { removeOther(msg.id); }
      else if (msg.type === 'hit') { onHit(msg); }
      else if (msg.type === 'enemyAttack') { Entities.enemyAttackAnim(msg.i); }
      else if (msg.type === 'enemyHit') { Entities.serverEnemyHit(msg.i, msg.dmg); }
      else if (msg.type === 'enemyDead') { Entities.serverEnemyDead(msg.i, msg.x, msg.z, msg.by === myId); }
      else if (msg.type === 'enemyRespawn') { Entities.serverEnemyRespawn(msg.i, msg.x, msg.z); }
      else if (msg.type === 'resource') { Entities.setResourceState(msg.kind, msg.i, msg.active); }
      else if (msg.type === 'chat') { /* reserved */ }
    };
    ws.onclose = function () { connected = false; if (window.Entities) Entities.goOffline(); setStatus(); scheduleReconnect(); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  function scheduleReconnect() { reconnectT = 1.5; }

  function setStatus() {
    if (!statusEl) return;
    var n = Object.keys(others).length + 1;
    statusEl.className = connected ? 'ok' : 'off';
    statusEl.innerHTML = '<span class="dot"></span> ' +
      (connected ? ('online: ' + n) : 'reconnecting…');
  }

  // ---- remote avatar mesh ----
  function buildAvatar(color) {
    var g = new THREE.Group();
    var matBody = new THREE.MeshStandardMaterial({ color: color, roughness: 0.85, flatShading: true });
    var matHead = new THREE.MeshStandardMaterial({ color: color, roughness: 0.85, flatShading: true });
    var matLegs = new THREE.MeshStandardMaterial({ color: 0x20261a, roughness: 1, flatShading: true });
    var matWeapon = new THREE.MeshStandardMaterial({ color: 0xc87838, roughness: 0.4, metalness: 0.7, flatShading: true });
    var arms = new THREE.MeshStandardMaterial({ color: color, roughness: 0.85, flatShading: true });
    var dark = new THREE.MeshStandardMaterial({ color: 0x20261a, roughness: 1, flatShading: true });
    var torso = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.5), matBody); torso.position.y = 1.5; g.add(torso);
    var head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), matHead); head.position.y = 2.35; g.add(head);
    var hood = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.6, 5), dark); hood.position.y = 2.75; g.add(hood);
    var legL = new THREE.Group(); legL.position.set(-0.24, 0.95, 0);
    var lm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.95, 0.3), matLegs); lm.position.y = -0.47; legL.add(lm); g.add(legL);
    var legR = new THREE.Group(); legR.position.set(0.24, 0.95, 0);
    var rm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.95, 0.3), matLegs); rm.position.y = -0.47; legR.add(rm); g.add(legR);
    var armL = new THREE.Group(); armL.position.set(-0.62, 2.0, 0);
    var alm = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.0, 0.26), arms); alm.position.y = -0.5; armL.add(alm); g.add(armL);
    var armR = new THREE.Group(); armR.position.set(0.62, 2.0, 0);
    var arm2 = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.0, 0.26), arms); arm2.position.y = -0.5; armR.add(arm2); g.add(armR);
    // weapon in right hand — hidden until they equip one
    var weapon = new THREE.Group();
    var wh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.5, 0.09), new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 1, flatShading: true })); wh.position.y = -0.25;
    var wb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 0.05), matWeapon); wb.position.y = -1.2; wb.rotation.z = 0.25;
    weapon.add(wh); weapon.add(wb); weapon.position.set(0, -0.5, 0); weapon.visible = false; armR.add(weapon);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    return { group: g, legL: legL, legR: legR, armL: armL, armR: armR,
      matBody: matBody, matHead: matHead, matLegs: matLegs, matWeapon: matWeapon, weapon: weapon, baseColor: color };
  }

  // recolour a remote avatar to reflect the gear tiers it's wearing
  function applyAvatarAppearance(o, app) {
    if (!o.matHead) return;
    app = app || {};
    o.matHead.color.setHex(app.head || o.baseColor); o.matHead.metalness = app.head ? 0.6 : 0;
    o.matBody.color.setHex(app.body || o.baseColor); o.matBody.metalness = app.body ? 0.6 : 0;
    o.matLegs.color.setHex(app.legs || 0x20261a);    o.matLegs.metalness = app.legs ? 0.6 : 0;
    if (app.weapon) { o.matWeapon.color.setHex(app.weapon); o.weapon.visible = true; }
    else o.weapon.visible = false;
  }

  function makeLabel(rec) {
    var d = document.createElement('div');
    d.className = 'entity-label net';
    d.innerHTML = '<div class="nm" style="color:' + rec.colorHex + '">' + escapeHtml(rec.name) + '</div>';
    document.getElementById('label-layer').appendChild(d);
    rec.labelEl = d;
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  function removeOther(id) {
    var o = others[id];
    if (!o) return;
    o.active = false;
    if (o.group && Game.scene) Game.scene.remove(o.group);
    if (o.labelEl && o.labelEl.parentNode) o.labelEl.parentNode.removeChild(o.labelEl);
    remoteMeshes = remoteMeshes.filter(function (m) { return m.userData.ref !== o; });
    delete others[id];
    setStatus();
  }

  // inbound PvP hit relayed by the server
  function onHit(msg) {
    var dmg = msg.dmg | 0;
    if (msg.target === myId) {
      // we are the victim — our client is authoritative over our HP
      if (window.Combat) Combat.receivePvpDamage(dmg);
    } else {
      // show a splat over the target's avatar for everyone else
      var o = others[msg.target];
      if (o && o.group && window.UI) {
        var head = new THREE.Vector3(o.group.position.x, o.group.position.y + 2.7, o.group.position.z);
        UI.spawnHitsplat(head, dmg, dmg > 0 ? 'hit' : 'miss');
      }
    }
  }

  function sendAttack(targetId, dmg) {
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'attack', target: targetId, dmg: dmg | 0 }));
  }
  function sendAttackEnemy(i, dmg) {
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'attackEnemy', i: i | 0, dmg: dmg | 0 }));
  }
  function sendGather(kind, i) {
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'gather', kind: kind, i: i | 0 }));
  }

  function sync(list) {
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var pl = list[i];
      if (pl.id === myId) continue;
      seen[pl.id] = true;
      var o = others[pl.id];
      if (!o) {
        var colorInt = parseInt((pl.color || '#8dff3a').replace('#', ''), 16) || 0x8dff3a;
        var av = buildAvatar(colorInt);
        o = { group: av.group, legL: av.legL, legR: av.legR, armL: av.armL, armR: av.armR,
              matBody: av.matBody, matHead: av.matHead, matLegs: av.matLegs, matWeapon: av.matWeapon,
              weapon: av.weapon, baseColor: av.baseColor,
              phase: 0, target: { x: pl.x, z: pl.z, ry: pl.ry }, state: pl.state,
              name: pl.name, colorHex: pl.color || '#8dff3a', hp: pl.hp,
              // fields that let player.js treat this as an attackable target
              id: pl.id, type: 'player', active: true, interactRange: 1.9,
              position: av.group.position };
        av.group.position.set(pl.x, 0, pl.z);
        av.group.rotation.y = pl.ry;
        if (Game.scene) Game.scene.add(av.group);
        others[pl.id] = o;
        // tag meshes so raycasting can pick this player
        (function (rec) {
          av.group.traverse(function (m) { if (m.isMesh) { m.userData.ref = rec; remoteMeshes.push(m); } });
        })(o);
        makeLabel(o);
      }
      o.target.x = pl.x; o.target.z = pl.z; o.target.ry = pl.ry;
      o.state = pl.state; o.hp = pl.hp; o.name = pl.name;
      applyAvatarAppearance(o, pl.app);   // reflect their equipped gear tiers
    }
    for (var id in others) if (!seen[id]) removeOther(id);
    setStatus();
  }

  function terrainY(x, z) {
    if (World.ground && World.ground.userData.heightAt) return World.ground.userData.heightAt(x, z);
    return 0;
  }

  function update(dt) {
    if (!enabled) return;

    if (!connected) {
      reconnectT -= dt;
      if (reconnectT <= 0 && (!ws || ws.readyState === WebSocket.CLOSED)) { reconnectT = 1.5; connect(); }
    }

    // interpolate + animate remotes
    for (var id in others) {
      var o = others[id];
      o.group.position.x = Utils.damp(o.group.position.x, o.target.x, 12, dt);
      o.group.position.z = Utils.damp(o.group.position.z, o.target.z, 12, dt);
      var baseY = terrainY(o.group.position.x, o.group.position.z);
      var cur = o.group.rotation.y;
      var diff = Math.atan2(Math.sin(o.target.ry - cur), Math.cos(o.target.ry - cur));
      o.group.rotation.y = cur + diff * Utils.clamp(10 * dt, 0, 1);

      var moving = o.state === 'moving';
      var dead = o.state === 'dead';
      o.phase += dt * (moving ? 10 : 3);
      var s = Math.sin(o.phase);
      if (dead) {
        o.group.rotation.x = Utils.damp(o.group.rotation.x, -Math.PI / 2, 8, dt);
        o.group.position.y = baseY;
      } else {
        o.group.rotation.x = Utils.damp(o.group.rotation.x, 0, 8, dt);
        o.group.position.y = baseY;
        if (o.state === 'acting') {
          // repeated windup -> strike -> recover overhead swing
          var cyc = (o.phase * 0.5) % 1;
          var ang = cyc < 0.5 ? (-2.0 + 3.0 * (cyc / 0.5)) : (1.0 - 1.0 * ((cyc - 0.5) / 0.5));
          o.armR.rotation.x = ang; o.armL.rotation.x = ang * 0.4;
          o.legL.rotation.x = 0; o.legR.rotation.x = 0;
        } else {
          o.legL.rotation.x = moving ? s * 0.7 : 0;
          o.legR.rotation.x = moving ? -s * 0.7 : 0;
          o.armL.rotation.x = moving ? -s * 0.5 : 0;
          o.armR.rotation.x = moving ? s * 0.5 : 0;
        }
      }
      positionLabel(o);
    }

    // stream my state
    sendAccum += dt;
    if (sendAccum >= SEND_INTERVAL) {
      sendAccum = 0;
      sendState();
    }
  }

  function positionLabel(o) {
    if (!o.labelEl || !Game.camera) return;
    var top = new THREE.Vector3(o.group.position.x, o.group.position.y + 3.1, o.group.position.z);
    var v = top.clone().project(Game.camera);
    if (v.z > 1) { o.labelEl.style.display = 'none'; return; }
    o.labelEl.style.display = 'block';
    o.labelEl.style.left = ((v.x * 0.5 + 0.5) * window.innerWidth) + 'px';
    o.labelEl.style.top = ((-v.y * 0.5 + 0.5) * window.innerHeight) + 'px';
  }

  function sendState() {
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) return;
    var p = Game.player;
    if (!p || !p.group) return;
    ws.send(JSON.stringify({
      type: 'state',
      name: myName, color: myColorHex,
      x: +p.position.x.toFixed(2),
      z: +p.position.z.toFixed(2),
      ry: +p.group.rotation.y.toFixed(3),
      state: p.state,
      hp: Math.ceil(p.stats.hp),
      app: (window.Skills && Skills.appearance) ? Skills.appearance() : null
    }));
  }

  return {
    init: init, update: update, sendAttack: sendAttack,
    sendAttackEnemy: sendAttackEnemy, sendGather: sendGather,
    get enabled() { return enabled; },
    get myName() { return myName; },
    get remoteMeshes() { return remoteMeshes; }
  };
})();
