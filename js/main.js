// ============================================================
// main.js — bootstrap, input, game loop, self-test harness
// ============================================================

var Main = (function () {
  var raycaster = new THREE.Raycaster();
  var ndc = new THREE.Vector2();
  var hoverNdc = new THREE.Vector2();
  var haveHover = false;
  var hoverClientX = 0, hoverClientY = 0;
  var canvas, ground, clock;
  var hoverAccum = 0;
  var _lastCursor = '', CURSORS = {};

  // per-interaction mouse cursors (emoji rasterised into an SVG cursor image)
  function emojiCursor(glyph, hx, hy) {
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><text y='28' font-size='28'>" + glyph + "</text></svg>";
    return "url(\"data:image/svg+xml;utf8," + encodeURIComponent(svg) + "\") " + hx + " " + hy + ", pointer";
  }
  // pixel-art cursor (falls back to an emoji SVG cursor if pixel art is unavailable)
  function pixCursor(sprite, emoji, hx, hy) {
    var url = window.PixelIcons && PixelIcons.getScaled ? PixelIcons.getScaled(sprite, 2) : null;
    return url ? ('url(' + url + ') ' + hx + ' ' + hy + ', auto') : emojiCursor(emoji, 4, 4);
  }
  function cursorFor(type) {
    if (!CURSORS.tree) {
      CURSORS.tree = pixCursor('woodcutting', '🪓', 4, 2);
      CURSORS.rock = pixCursor('mining', '⛏️', 4, 2);
      CURSORS.crystal = CURSORS.rock;
      CURSORS.meteorite = CURSORS.rock;
      CURSORS.fishpool = pixCursor('fishing', '🌿', 6, 4);
      CURSORS.enemy = pixCursor('attack', '⚔️', 14, 2);
      CURSORS.drop = pixCursor('hand', '🫳', 8, 4);
      CURSORS.use = pixCursor('hand', '👆', 8, 4);
      CURSORS.pick = CURSORS.drop;   // story "_PICK" (sticks)
      CURSORS.gate = CURSORS.use;    // story "_GATE" (cave)
      CURSORS.npc = emojiCursor('💬', 4, 2);   // story talkable NPC
    }
    if (type === 'player' || type === 'boss') return CURSORS.enemy;
    if (type === 'station' || type === 'obelisk' || type === 'chest' || type === 'essaltar') return CURSORS.use;
    return CURSORS[type] || 'pointer';
  }
  function setCursor(c) { if (c !== _lastCursor) { document.body.style.cursor = c; _lastCursor = c; } }
  function verbFor(ref) {
    switch (ref.type) {
      case 'tree': return 'Chop ' + ref.name;
      case 'rock': return 'Mine ' + ref.name;
      case 'crystal': return 'Mine the ' + ref.name + ' (Lv ' + ref.reqLevel + ')';
      case 'meteorite': return 'Mine the ' + ref.name + ' (max Mining + Woodcutting)';
      case 'fishpool': return ref.reqTool === 'net' ? 'Fish' : ('Harvest ' + ref.name);
      case 'chest': return 'Open ' + (ref.name || 'chest');
      case 'station': return 'Use ' + ref.name + (ref.lit === false && (ref.kind === 'furnace' || ref.kind === 'campfire') ? ' (unlit)' : '');
      case 'obelisk': return 'The Central Altar';
      case 'essaltar': return ref.claimedBy ? (ref.name + ' — claimed by ' + (ref.claimedName || 'a rival')) : ('Place your essence at the ' + ref.name);
      case 'drop': return 'Pick up ' + ref.name;
      case 'pick': return ref.name;                 // hovering the tile just names it (e.g. "Stick")
      case 'gate': return ref.name || 'Cave Entrance';
      case 'npc': return 'Talk to ' + ref.name;
      case 'enemy': return 'Attack ' + ref.name + ' (Lv ' + ref.reqLevel + ')';
      case 'player': return 'Attack ' + ref.name;
      case 'boss': return ref.part === 'heart' ? 'Loose an arrow at the Heart' : 'Strike the Hand';
    }
    return ref.name || '';
  }

  // frame-rate cap + FPS meter — locked to a steady 30 for consistent pacing
  var FPS_CAP = 30;
  var frameInterval = 1 / FPS_CAP;
  var frameAccum = 0;
  var fpsAccum = 0, fpsFrames = 0, fpsEl;

  function init() {
    var params = new URLSearchParams(location.search);
    Game.selftest = params.has('selftest');
    // ?storytest=1 → dev harness: load Level_01 in story mode and report cave collision.
    // Keeps WebGL ON (the story-load path touches the renderer, e.g. shadow boost).
    Game.storytest = params.has('storytest');
    Game.storytestMode = params.get('storytest') || '1';   // '1'/'visual' = top-down + markers, 'foam' = angled at water
    // headless self-test skips WebGL; ?selftest=visual keeps rendering on-screen
    Game.headless = Game.selftest && params.get('selftest') !== 'visual';

    canvas = document.getElementById('game-canvas');
    fpsEl = document.getElementById('fps-counter');
    var w = World.init(canvas);
    ground = w.ground;

    CameraRig.init(Game.camera);
    Player.build(Game.scene);
    Entities.init(Game.scene);
    UI.init();
    Skills.init();
    Voice.init();
    if (!Game.selftest && !Game.storytest) Player.moveToCamp(1);   // default to P1 (north); net welcome may reassign
    if (!Game.selftest && !Game.storytest) Net.init();   // storytest stays offline so nothing overrides the map

    bindInput();
    clock = new THREE.Clock();

    if (Game.storytest) {
      UI.hideBoot();
      runStoryCollisionTest();
    } else if (Game.selftest && Game.headless) {
      UI.hideBoot();
      // let a frame settle, then run the scripted test
      setTimeout(function () { SelfTest.run(); }, 60);
    } else {
      UI.setBootStatus('entering the canyon…');
      setTimeout(UI.hideBoot, 500);
      Game.running = true;
      requestAnimationFrame(frame);
    }
  }

  // Dev harness (?storytest=1): load Level_01 in story mode, then check the cave
  // entrance actually blocks movement. Writes STORYTEST PASS/FAIL to the page title
  // + #selftest-result so a headless Chrome --dump-dom can read it.
  function runStoryCollisionTest() {
    Game.mode = 'story';
    Game._isHost = true;
    if (!window.WorldMap || !WorldMap.load) { finishStoryTest('WorldMap missing', false); return; }
    WorldMap.load();
    var waited = 0;
    var iv = setInterval(function () {
      waited += 100;
      if (Game.storyLoaded || waited > 15000) { clearInterval(iv); reportStoryTest(); }
    }, 100);
  }
  function _tileBlocked(x, z) {
    if (!window.Grid) return null;
    var t = Grid.worldToTile(x, z);
    return !Grid.walkable(t.tx, t.tz);
  }
  function reportStoryTest() {
    if (Game.storyLoadError) { finishStoryTest('LOAD ERROR — Level_01.glb failed to load', false); return; }
    var pass = true, lines = [], gate = null, fishing = null;
    var meshes = Entities.interactMeshes || [];
    for (var i = 0; i < meshes.length; i++) {
      var ref = meshes[i].userData && meshes[i].userData.ref;
      if (!ref) continue;
      if (ref.type === 'gate' && !gate) gate = ref;
      if (ref.type === 'fishpool' && ref.reqTool === 'net' && !fishing) fishing = ref;
    }
    lines.push((gate ? 'PASS' : 'FAIL') + ' cave-gate present'); if (!gate) pass = false;
    if (gate) {
      var gx = gate.position.x, gz = gate.position.z;
      var gBlocked = _tileBlocked(gx, gz);
      lines.push((gBlocked ? 'PASS' : 'FAIL') + ' gate tile solid'); if (!gBlocked) pass = false;
      var TILE = (window.Grid && Grid.TILE) || 2, blk = 0, tot = 0;
      for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) { tot++; if (_tileBlocked(gx + dx * TILE, gz + dz * TILE)) blk++; }
      lines.push('INFO ' + blk + '/' + tot + ' footprint tiles blocked');
    }
    lines.push((fishing ? 'PASS' : 'INFO') + ' net-fishing spot' + (fishing ? ' "' + fishing.name + '"' : ' (none placed yet)'));
    // flood-fill the walkable tiles reachable from spawn; every rock must border it
    var rocks = Entities.rocks || [], NB = [[1, 0], [-1, 0], [0, 1], [0, -1]], unreachable = 0;
    var sp = Game.storySpawn || { x: 0, z: 0 }, s0 = Grid.worldToTile(sp.x, sp.z);
    var start = Grid.nearestWalkable ? (Grid.nearestWalkable(s0.tx, s0.tz) || s0) : s0;
    var reach = {}, q = [[start.tx, start.tz]]; reach[start.tx + ',' + start.tz] = 1;
    while (q.length && Object.keys(reach).length < 30000) {
      var c = q.shift();
      for (var d = 0; d < NB.length; d++) {
        var nx = c[0] + NB[d][0], nz = c[1] + NB[d][1], k = nx + ',' + nz;
        if (!reach[k] && Grid.walkable(nx, nz)) { reach[k] = 1; q.push([nx, nz]); }
      }
    }
    rocks.forEach(function (rk) {
      if (!rk.position) return;
      var t = Grid.worldToTile(rk.position.x, rk.position.z);
      if (!NB.some(function (e) { return reach[(t.tx + e[0]) + ',' + (t.tz + e[1])]; })) unreachable++;
    });
    lines.push((unreachable === 0 ? 'PASS' : 'FAIL') + ' all ' + rocks.length + ' rocks reachable from spawn' + (unreachable ? ' (' + unreachable + ' cut off)' : ''));
    if (unreachable) pass = false;
    finishStoryTest(lines.join(' | '), pass);
  }
  function finishStoryTest(summary, pass) {
    var ok = pass !== false && summary.indexOf('FAIL') < 0 && summary.indexOf('ERROR') < 0;
    var title = 'STORYTEST ' + (ok ? 'PASS' : 'FAIL');
    document.title = title;
    var el = document.getElementById('selftest-result') || document.createElement('pre');
    el.id = 'selftest-result'; el.textContent = title + ' :: ' + summary + '\n\n' + buildStoryGridMap();
    if (!el.parentNode) document.body.appendChild(el);
    if (window.console) console.log('[StoryTest] ' + title + ' :: ' + summary);
    // ?storytest=visual → render the level TOP-DOWN (no camera follow) so we can screenshot it
    if (!Game.headless && Game.renderer && Game.scene && Game.camera) {
      var hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';   // clear view for the diagnostic shot
      el.style.cssText = 'position:fixed;left:0;bottom:0;z-index:9;background:rgba(0,0,0,0.6);color:#fff;font:10px monospace;margin:0';
      var mm = Entities.interactMeshes || [], foamMode = (Game.storytestMode === 'foam');
      if (!foamMode) {
        // top-down layout shot: bright pillars mark the key objects
        var marker = function (p, hex) {
          if (!p) return;
          var m = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 30, 8), new THREE.MeshBasicMaterial({ color: hex }));
          m.position.set(p.x, 15, p.z); Game.scene.add(m);
        };
        (Entities.rocks || []).forEach(function (r) { marker(r.position, r.permanent ? 0xff2020 : 0xff8800); });
        for (var mi = 0; mi < mm.length; mi++) {
          var rf = mm[mi].userData && mm[mi].userData.ref; if (!rf) continue;
          if (rf.type === 'gate') marker(rf.position, 0xff00ff);
          else if (rf.type === 'fishpool' && rf.reqTool === 'net') marker(rf.position, 0x00ffff);
        }
        marker(Game.storySpawn, 0xffff00);
        Game.camera.position.set(0, 100, 0.01);
        Game.camera.lookAt(0, 0, 0);
      } else {
        // foam shot: overhead-ish over the water (net-fishing spots sit on it), daylight, small locator dots
        if (window.World && World.update) World.update(0.001);   // story → force high-noon lighting
        var fps = [];
        for (var fi = 0; fi < mm.length; fi++) {
          var fr = mm[fi].userData && mm[fi].userData.ref;
          if (fr && fr.type === 'fishpool' && fr.reqTool === 'net' && fps.indexOf(fr) < 0) fps.push(fr);
        }
        var cx = 0, cz = 0;
        if (fps.length) {
          fps.forEach(function (f) {
            cx += f.position.x; cz += f.position.z;
            var d = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), new THREE.MeshBasicMaterial({ color: 0x00ffff }));
            d.position.set(f.position.x, 0.6, f.position.z); Game.scene.add(d);
          });
          cx /= fps.length; cz /= fps.length;
        }
        Game.camera.position.set(cx + 0.01, 16, cz);
        Game.camera.lookAt(cx, 0, cz);
      }
      if (Game.camera.updateProjectionMatrix) Game.camera.updateProjectionMatrix();
      var frames = 0;
      var draw = function () {
        if (window.WorldMap && WorldMap.prepFoam) WorldMap.prepFoam(Game.renderer, Game.scene, Game.camera);
        Game.renderer.render(Game.scene, Game.camera);
        if (++frames < 40) setTimeout(draw, 30);
      };
      draw();
    }
  }
  // ASCII dump of the grid around every story object: '#'=blocked '.'=walkable,
  // letters mark objects. Lets us see reachability + collision gaps at a glance.
  function buildStoryGridMap() {
    if (!window.Grid || !Entities) return '(no grid)';
    var marks = {}, pts = [];
    function put(p, ch) { if (!p) return; var t = Grid.worldToTile(p.x, p.z); marks[t.tx + ',' + t.tz] = ch; pts.push(p); }
    (Entities.rocks || []).forEach(function (r) { put(r.position, r.permanent ? 'B' : 'R'); });
    (Entities.trees || []).forEach(function (t) { put(t.position, 'T'); });
    var meshes = Entities.interactMeshes || [];
    for (var i = 0; i < meshes.length; i++) {
      var ref = meshes[i].userData && meshes[i].userData.ref; if (!ref) continue;
      if (ref.type === 'gate') put(ref.position, 'G');
      else if (ref.type === 'fishpool' && ref.reqTool === 'net') put(ref.position, 'F');
      else if (ref.type === 'fishpool') put(ref.position, 'h');
      else if (ref.type === 'pick') put(ref.position, ref.itemId === 'flint' ? 'L' : 'k');
    }
    (Entities.npcs || []).forEach(function (nc) { put(nc.position, 'N'); });
    put(Game.storySpawn, 'S');
    if (!pts.length) return '(no objects placed)';
    var xs = pts.map(function (p) { return p.x; }), zs = pts.map(function (p) { return p.z; });
    var a = Grid.worldToTile(Math.min.apply(null, xs), Math.min.apply(null, zs));
    var b = Grid.worldToTile(Math.max.apply(null, xs), Math.max.apply(null, zs));
    var pad = 4, x0 = a.tx - pad, x1 = b.tx + pad, z0 = a.tz - pad, z1 = b.tz + pad;
    if ((x1 - x0) > 70 || (z1 - z0) > 70) return '(region too large: ' + (x1 - x0) + 'x' + (z1 - z0) + ')';
    var lines = [];
    for (var tz = z0; tz <= z1; tz++) {
      var row = '';
      for (var tx = x0; tx <= x1; tx++) {
        var k = tx + ',' + tz;
        row += marks[k] ? marks[k] : (Grid.walkable(tx, tz) ? '.' : '#');
      }
      lines.push(row);
    }
    return 'GRID x[' + x0 + '..' + x1 + '] z[' + z0 + '..' + z1 + '] (row=+z down)\n' +
           'R=ore B=boulder G=gate F=fish h=reed L=flint k=pick T=tree N=npc S=spawn #=blocked .=walk\n' +
           lines.join('\n');
  }

  function bindInput() {
    canvas.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      SFX.unlock();
      if (window.Ambient) Ambient.start();   // start the desert soundtrack on first click
      if (Player.isDead) return;
      _clickPX = e.clientX; _clickPY = e.clientY;   // for the screen-space click X
      setNdc(ndc, e.clientX, e.clientY);
      handleClick();
    });
    window.addEventListener('mousemove', function (e) {
      setNdc(hoverNdc, e.clientX, e.clientY);
      hoverClientX = e.clientX; hoverClientY = e.clientY;
      haveHover = true;
    });
    // right-click a camp station / fishing spot → upgrade menu
    canvas.addEventListener('contextmenu', function (e) {
      setNdc(ndc, e.clientX, e.clientY);
      var ref = pickInteractable(ndc);
      if (ref && (ref.type === 'station' || (ref.type === 'fishpool' && ref.upgradable))) {
        e.preventDefault();
        UI.openStationMenu(e.clientX, e.clientY, ref);
      }
    });
    window.addEventListener('keydown', function (e) {
      // while typing in the chat box or mid-conversation, don't let game hotkeys fire
      if (window.UI && UI.chatFocused && UI.chatFocused()) return;
      if (window.Dialogue && Dialogue.isOpen && Dialogue.isOpen()) return;
      // debug: press "2" to unlock everything — max skills, stations, gold + key materials
      if (e.key === '2' && window.Skills) {
        if (Skills.maxAll) Skills.maxAll(); else Skills.addItem('orb');
        if (window.Entities && Entities.debugMaxStations) Entities.debugMaxStations();
        if (window.UI) UI.showActionText('[debug] MAX — all skills & stations maxed, gold + endgame materials granted.');
      }
      // debug: press "3" for a Copper Scimitar
      if (e.key === '3' && window.Skills && Skills.addItem) {
        Skills.addItem('bronze_scimitar');
        if (window.UI) UI.showActionText('[debug] A Copper Scimitar appears in your bag.');
      }
      // debug: press "4" for Electric Paper (click it in the bag to enchant your weapon)
      if (e.key === '4' && window.Skills && Skills.addItem) {
        Skills.addItem('electricpaper');
        if (window.UI) UI.showActionText('[debug] Electric Paper added — click it in your bag to charge your weapon.');
      }
      // "B" opens the co-op build menu
      if ((e.key === 'b' || e.key === 'B') && Game.mode === 'coop' && window.UI && UI.openBuildMenu) UI.openBuildMenu();
    });
    var btn = document.getElementById('respawn-btn');
    if (btn) btn.addEventListener('click', function () {
      Player.reset();
      Entities.reset();
      UI.hideDeathScreen();
      UI.showActionText('You claw your way back from the dead.');
    });
  }

  function setNdc(target, cx, cy) {
    target.x = (cx / window.innerWidth) * 2 - 1;
    target.y = -(cy / window.innerHeight) * 2 + 1;
  }

  function pickInteractable(nd) {
    raycaster.setFromCamera(nd, Game.camera);
    var meshes = Entities.interactMeshes;
    if (Net.enabled && Net.remoteMeshes.length) meshes = meshes.concat(Net.remoteMeshes);
    var hits = raycaster.intersectObjects(meshes, false);
    for (var i = 0; i < hits.length; i++) {
      var ref = hits[i].object.userData.ref;
      if (ref && ref.active) return ref;
    }
    return null;
  }

  // returns null if allowed, or a "need level" message if gated
  function gateMessage(ref) {
    var s = Skills.data;
    if (ref.type === 'tree' && s.woodcutting.level < ref.reqLevel) return 'You need level ' + ref.reqLevel + ' Woodcutting for ' + ref.name + '.';
    if (ref.type === 'rock' && s.mining.level < ref.reqLevel) return 'You need level ' + ref.reqLevel + ' Mining for ' + ref.name + '.';
    if (ref.type === 'rock' && Game.mode === 'story' && window.Skills && Skills.bestPickaxePower && Skills.bestPickaxePower() <= 0) return 'You need a pickaxe to mine.';
    if (ref.type === 'tree' && Game.mode === 'story' && window.Skills && Skills.bestAxePower && Skills.bestAxePower() <= 0) return 'You need an axe to chop.';
    if (ref.type === 'crystal' && s.mining.level < ref.reqLevel) return 'You need level ' + ref.reqLevel + ' Mining to work the ' + ref.name + '.';
    if (ref.type === 'fishpool' && ref.reqTool === 'net' && window.Skills && !Skills.hasItem('primitive_fishing_net')) return 'You need a fishing net to fish here.';
    if (ref.type === 'fishpool') {
      var fsk = (ref.skill && s[ref.skill]) ? ref.skill : 'fishing';
      if (s[fsk].level < ref.reqLevel) return 'You need level ' + ref.reqLevel + ' ' + s[fsk].name + ' for ' + ref.name + '.';
    }
    if (ref.type === 'enemy' && s.attack.level < ref.reqLevel) return 'You need level ' + ref.reqLevel + ' Attack to fight the ' + ref.name + '.';
    return null;
  }

  // ---- click marker: a screen-space X where you clicked (white=move, red=interact) ----
  var _clickPX = 0, _clickPY = 0, _clickXEl = null;
  function showClickX(kind) {
    if (Game.headless) return;
    if (!_clickXEl) { _clickXEl = document.createElement('div'); _clickXEl.id = 'click-x'; _clickXEl.textContent = '✕'; document.body.appendChild(_clickXEl); }
    _clickXEl.className = kind;                 // 'move' (white) or 'act' (red)
    _clickXEl.style.left = _clickPX + 'px';
    _clickXEl.style.top = _clickPY + 'px';
    _clickXEl.style.animation = 'none';         // restart the fade each click
    void _clickXEl.offsetWidth;                 // force reflow
    _clickXEl.style.animation = '';
  }

  function handleClick() {
    var ref = pickInteractable(ndc);
    if (ref) {
      // no friendly fire in co-op — your fellow wanderers are allies
      if (ref.type === 'player' && Game.mode !== 'versus') { UI.showActionText('You stand with your ally.'); return; }
      var gate = gateMessage(ref);
      if (gate) { UI.showActionText(gate); return; }
      Player.interactWith(ref);
      showClickX('act');   // red X where you clicked
      if (ref.type === 'tree') UI.showActionText('You approach the ' + ref.name + '…');
      else if (ref.type === 'rock') UI.showActionText('You approach the ' + ref.name + '…');
      else if (ref.type === 'fishpool') UI.showActionText('You step up to the ' + ref.name + '…');
      else if (ref.type === 'chest') UI.showActionText('You head for the chest…');
      else if (ref.type === 'station') UI.showActionText('You head to the ' + ref.name + '…');
      else if (ref.type === 'obelisk') UI.showActionText('You approach the Obelisk…');
      else if (ref.type === 'drop') UI.showActionText('You go to pick up the ' + ref.name + '…');
      else if (ref.type === 'npc') UI.showActionText('You walk over to ' + ref.name + '…');
      else if (ref.type === 'enemy') UI.showActionText('You move to attack the ' + ref.name + '!');
      else if (ref.type === 'player') UI.showActionText('You challenge ' + ref.name + '!');
      return;
    }
    // otherwise walk to the ground point
    raycaster.setFromCamera(ndc, Game.camera);
    var gh = raycaster.intersectObject(ground, false);
    if (gh.length) { Player.walkTo(gh[0].point); showClickX('move'); }   // white X where you clicked
  }

  function updateHover(dt) {
    hoverAccum += dt;
    if (hoverAccum < 0.08 || !haveHover) return;
    hoverAccum = 0;
    var ref = pickInteractable(hoverNdc);
    // outline the hovered object (works for entity .mesh or a remote player's .group)
    Entities.setHighlight(ref ? (ref.mesh || ref.group) : null);
    if (ref) {
      setCursor(cursorFor(ref.type));
      if (window.UI && UI.showTip) UI.showTip(verbFor(ref), hoverClientX, hoverClientY);
      // the top readout keeps the richer combat info; everything else is on the cursor tip
      if (ref.type === 'enemy') UI.setTarget(ref.name + ' (Lv ' + ref.reqLevel + ')  ' + Math.ceil(ref.hp) + '/' + ref.maxHp + ' hp');
      else if (ref.type === 'player') UI.setTarget('⚔ ' + ref.name + '  (' + Math.ceil(ref.hp) + ' hp)');
      else UI.setTarget(null);
    } else {
      setCursor('default');
      if (window.UI && UI.hideTip) UI.hideTip();
      UI.setTarget(null);
    }
  }

  // one simulation step (shared by live loop and self-test)
  function step(dt, t) {
    CameraRig.update(dt);
    // refresh the camera's world matrix now so DOM overlays projected this frame
    // (overhead chat, name labels, HP bars) track the mesh instead of lagging a frame
    if (Game.camera) Game.camera.updateMatrixWorld();
    Player.update(dt, t);
    Entities.update(dt, t);
    World.update(dt, t);
    if (window.WorldMap && WorldMap.update) WorldMap.update(dt);   // scroll waterfall textures
    if (window.Coop && Coop.update) Coop.update(dt);
    UI.updateLabels(Entities.enemies);
    UI.updateMerchantLabels(Entities.stations);
    UI.updateOverheadChat(dt);
    if (Net.enabled) Net.update(dt);
  }

  function frame() {
    if (!Game.running) return;
    requestAnimationFrame(frame);

    var elapsed = clock.getDelta();
    fpsAccum += elapsed; // real wall-clock time, every animation tick

    // throttle to FPS_CAP: skip the tick until a full frame interval has elapsed
    frameAccum += elapsed;
    if (frameAccum < frameInterval) return;
    // consume whole intervals only; carry the sub-interval remainder for pacing
    var remainder = frameAccum % frameInterval;
    var dt = Math.min(frameAccum - remainder, 0.05);
    frameAccum = remainder;

    Game.time += dt;
    step(dt, Game.time);
    updateHover(dt);
    World.render();

    // rolling average FPS, refreshed twice a second
    fpsFrames++;
    if (fpsEl && fpsAccum >= 0.5) {
      fpsEl.textContent = Math.round(fpsFrames / fpsAccum) + ' FPS';
      fpsAccum = 0;
      fpsFrames = 0;
    }
  }

  // deterministic fixed-step advance for the self-test
  function advance(seconds) {
    var dt = 0.05;
    var n = Math.max(1, Math.round(seconds / dt));
    for (var i = 0; i < n; i++) {
      Game.time += dt;
      step(dt, Game.time);
    }
  }

  return { init: init, advance: advance, step: step };
})();

window.addEventListener('DOMContentLoaded', function () {
  try {
    Main.init();
  } catch (err) {
    console.error('BOOT ERROR', err);
    var b = document.getElementById('boot-status');
    if (b) b.textContent = 'BOOT ERROR: ' + err.message;
  }
});
