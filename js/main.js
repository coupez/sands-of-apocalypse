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
      case 'fishpool': return 'Harvest ' + ref.name;
      case 'chest': return 'Open ' + (ref.name || 'chest');
      case 'station': return 'Use ' + ref.name + (ref.lit === false && (ref.kind === 'furnace' || ref.kind === 'campfire') ? ' (unlit)' : '');
      case 'obelisk': return 'The Central Altar';
      case 'essaltar': return ref.claimedBy ? (ref.name + ' — claimed by ' + (ref.claimedName || 'a rival')) : ('Place your essence at the ' + ref.name);
      case 'drop': return 'Pick up ' + ref.name;
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
    if (!Game.selftest) Player.moveToCamp(1);   // default to P1 (north); net welcome may reassign
    if (!Game.selftest) Net.init();

    bindInput();
    clock = new THREE.Clock();

    if (Game.selftest && Game.headless) {
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

  function bindInput() {
    canvas.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      SFX.unlock();
      if (window.Ambient) Ambient.start();   // start the desert soundtrack on first click
      if (Player.isDead) return;
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
    // Shift = Dark Souls-style dodge roll (i-frames)
    window.addEventListener('keydown', function (e) {
      // while typing in the chat box, don't let game hotkeys fire
      if (window.UI && UI.chatFocused && UI.chatFocused()) return;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (!Player.isDead) Player.dodge();
      }
      // debug: press "2" to unlock everything — max skills, stations, gold + key materials
      if (e.key === '2' && window.Skills) {
        if (Skills.maxAll) Skills.maxAll(); else Skills.addItem('orb');
        if (window.Entities && Entities.debugMaxStations) Entities.debugMaxStations();
        if (window.UI) UI.showActionText('[debug] MAX — all skills & stations maxed, gold + endgame materials granted.');
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
    if (ref.type === 'crystal' && s.mining.level < ref.reqLevel) return 'You need level ' + ref.reqLevel + ' Mining to work the ' + ref.name + '.';
    if (ref.type === 'fishpool' && s.fishing.level < ref.reqLevel) return 'You need level ' + ref.reqLevel + ' Harvesting for ' + ref.name + '.';
    if (ref.type === 'enemy' && s.attack.level < ref.reqLevel) return 'You need level ' + ref.reqLevel + ' Attack to fight the ' + ref.name + '.';
    return null;
  }

  function handleClick() {
    var ref = pickInteractable(ndc);
    if (ref) {
      // no friendly fire in co-op — your fellow wanderers are allies
      if (ref.type === 'player' && Game.mode !== 'versus') { UI.showActionText('You stand with your ally.'); return; }
      var gate = gateMessage(ref);
      if (gate) { UI.showActionText(gate); return; }
      Player.interactWith(ref);
      if (ref.type === 'tree') UI.showActionText('You approach the ' + ref.name + '…');
      else if (ref.type === 'rock') UI.showActionText('You approach the ' + ref.name + '…');
      else if (ref.type === 'fishpool') UI.showActionText('You step up to the ' + ref.name + '…');
      else if (ref.type === 'chest') UI.showActionText('You head for the chest…');
      else if (ref.type === 'station') UI.showActionText('You head to the ' + ref.name + '…');
      else if (ref.type === 'obelisk') UI.showActionText('You approach the Obelisk…');
      else if (ref.type === 'drop') UI.showActionText('You go to pick up the ' + ref.name + '…');
      else if (ref.type === 'enemy') UI.showActionText('You move to attack the ' + ref.name + '!');
      else if (ref.type === 'player') UI.showActionText('You challenge ' + ref.name + '!');
      return;
    }
    // otherwise walk to the ground point
    raycaster.setFromCamera(ndc, Game.camera);
    var gh = raycaster.intersectObject(ground, false);
    if (gh.length) Player.walkTo(gh[0].point);
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
      setCursor('crosshair');
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
