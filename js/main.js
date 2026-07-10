// ============================================================
// main.js — bootstrap, input, game loop, self-test harness
// ============================================================

var Main = (function () {
  var raycaster = new THREE.Raycaster();
  var ndc = new THREE.Vector2();
  var hoverNdc = new THREE.Vector2();
  var haveHover = false;
  var canvas, ground, clock;
  var hoverAccum = 0;

  function init() {
    var params = new URLSearchParams(location.search);
    Game.selftest = params.has('selftest');
    // headless self-test skips WebGL; ?selftest=visual keeps rendering on-screen
    Game.headless = Game.selftest && params.get('selftest') !== 'visual';

    canvas = document.getElementById('game-canvas');
    var w = World.init(canvas);
    ground = w.ground;

    CameraRig.init(Game.camera);
    Player.build(Game.scene);
    Entities.init(Game.scene);
    UI.init();
    Skills.init();
    Voice.init();
    if (!Game.selftest) Net.init();

    bindInput();
    clock = new THREE.Clock();

    if (Game.selftest && Game.headless) {
      UI.hideBoot();
      // let a frame settle, then run the scripted test
      setTimeout(function () { SelfTest.run(); }, 60);
    } else {
      UI.setBootStatus('entering the zone…');
      setTimeout(UI.hideBoot, 500);
      Game.running = true;
      requestAnimationFrame(frame);
    }
  }

  function bindInput() {
    canvas.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      SFX.unlock();
      if (Player.isDead) return;
      setNdc(ndc, e.clientX, e.clientY);
      handleClick();
    });
    window.addEventListener('mousemove', function (e) {
      setNdc(hoverNdc, e.clientX, e.clientY);
      haveHover = true;
    });
    // Shift = Dark Souls-style dodge roll (i-frames)
    window.addEventListener('keydown', function (e) {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (!Player.isDead) Player.dodge();
      }
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

  function handleClick() {
    var ref = pickInteractable(ndc);
    if (ref) {
      Player.interactWith(ref);
      if (ref.type === 'tree') UI.showActionText('You approach the dead tree…');
      else if (ref.type === 'rock') UI.showActionText('You approach the ore vein…');
      else if (ref.type === 'enemy') UI.showActionText('You move to attack the mutant!');
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
    if (ref) {
      document.body.style.cursor = 'pointer';
      if (ref.type === 'enemy') UI.setTarget(ref.name + '  (' + Math.ceil(ref.hp) + '/' + ref.maxHp + ')');
      else if (ref.type === 'tree') UI.setTarget('Dead Tree');
      else if (ref.type === 'rock') UI.setTarget('Ore Vein');
      else if (ref.type === 'player') UI.setTarget('⚔ ' + ref.name + '  (' + Math.ceil(ref.hp) + ' hp)');
    } else {
      document.body.style.cursor = 'crosshair';
      UI.setTarget(null);
    }
  }

  // one simulation step (shared by live loop and self-test)
  function step(dt, t) {
    CameraRig.update(dt);
    Player.update(dt, t);
    Entities.update(dt, t);
    World.update(dt, t);
    UI.updateLabels(Entities.enemies);
    if (Net.enabled) Net.update(dt);
  }

  function frame() {
    if (!Game.running) return;
    requestAnimationFrame(frame);
    var dt = Math.min(clock.getDelta(), 0.05);
    Game.time += dt;
    step(dt, Game.time);
    updateHover(dt);
    World.render();
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
