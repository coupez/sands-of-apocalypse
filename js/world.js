// ============================================================
// world.js — renderer, scene, lights, terrain, skyline
// ============================================================

var World = (function () {
  var scene, camera, renderer;
  var ground, groundMat;
  var sunLight, hemiLight;
  var clock;
  var WORLD_SIZE = 120;

  // Two player camps at the north and south poles. Player 1 spawns north,
  // player 2 south. Shared with entities.js (flags/stations) and player.js (spawn).
  var CAMPS = { north: { x: 0, z: -45 }, south: { x: 0, z: 45 } };

  // Low-poly displaced terrain, tinted sickly grey-green.
  function buildTerrain() {
    var seg = 40;   // fewer segments → cheaper mesh + faster height raycasts
    var geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
    geo.rotateX(-Math.PI / 2);
    var pos = geo.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), z = pos.getZ(i);
      // gentle rolling dunes; keep the central spawn area flatter
      var d = Math.sqrt(x * x + z * z);
      var h = Math.sin(x * 0.08) * Math.cos(z * 0.07) * 1.6
            + Math.sin(x * 0.21 + z * 0.13) * 0.5;
      h *= Utils.clamp((d - 6) / 20, 0, 1); // flatten near center
      pos.setY(i, h);
    }
    geo.computeVertexNormals();
    groundMat = new THREE.MeshStandardMaterial({
      color: 0xceb27f, roughness: 1.0, metalness: 0.0, flatShading: true   // desert sand
    });
    ground = new THREE.Mesh(geo, groundMat);
    ground.receiveShadow = true;
    ground.name = 'ground';
    ground.userData.kind = 'ground';
    scene.add(ground);

    // sample terrain height at (x,z) via a raycast helper
    var _ray = new THREE.Raycaster();
    var _down = new THREE.Vector3(0, -1, 0);
    ground.userData.heightAt = function (x, z) {
      _ray.set(new THREE.Vector3(x, 40, z), _down);
      var hits = _ray.intersectObject(ground, false);
      return hits.length ? hits[0].point.y : 0;
    };
  }

  // A ring of jagged sandstone cliffs enclosing the arena — you're in a canyon.
  function buildCanyon() {
    var group = new THREE.Group();
    var geo = new THREE.BoxGeometry(1, 1, 1);
    var tones = [0x9c5a34, 0xb06a3c, 0x86482a, 0xa85f38];  // sandstone reds/browns
    var mats = tones.map(function (c) { return new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true, fog: false }); });
    // two staggered rings for depth
    for (var ring = 0; ring < 2; ring++) {
      var N = 34, baseR = 56 + ring * 7;
      for (var i = 0; i < N; i++) {
        var a = (i / N) * Math.PI * 2 + ring * 0.09;
        var h = Utils.randRange(12, 30) + ring * 6;
        var w = Utils.randRange(7, 13);
        var r = baseR + Utils.randRange(-3, 3);
        var m = new THREE.Mesh(geo, mats[i % mats.length]);
        m.scale.set(w, h, w);
        m.position.set(Math.cos(a) * r, h / 2 - 3, Math.sin(a) * r);
        m.rotation.y = Utils.randRange(0, Math.PI);
        m.castShadow = true; m.receiveShadow = true;
        group.add(m);
      }
    }
    scene.add(group);
  }

  function init(canvas) {
    scene = new THREE.Scene();
    // warm, hazy desert sky (no fog)
    scene.background = new THREE.Color(0xe3d3a8);

    camera = new THREE.PerspectiveCamera(
      55, window.innerWidth / window.innerHeight, 0.1, 400
    );
    camera.position.set(0, 18, 20);
    camera.lookAt(0, 0, 0);

    // Renderer — guarded so ?selftest can run even if WebGL is unavailable.
    if (!Game.headless) {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas, antialias: true, powerPreference: 'high-performance'
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.outputEncoding = THREE.sRGBEncoding;
    }

    // Lighting: hot desert sun — warm sky ambient + a strong golden key light.
    hemiLight = new THREE.HemisphereLight(0xf2e2b0, 0x8a6a40, 1.0);
    scene.add(hemiLight);
    sunLight = new THREE.DirectionalLight(0xfff0d0, 1.3);
    sunLight.position.set(-30, 40, -20);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(512, 512);
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 120;
    sunLight.shadow.camera.left = -60;
    sunLight.shadow.camera.right = 60;
    sunLight.shadow.camera.top = 60;
    sunLight.shadow.camera.bottom = -60;
    scene.add(sunLight);

    buildTerrain();
    buildCanyon();

    clock = new THREE.Clock();

    Game.scene = scene;
    Game.camera = camera;
    Game.renderer = renderer;

    window.addEventListener('resize', onResize);
    return { scene: scene, camera: camera, renderer: renderer, ground: ground };
  }

  function onResize() {
    if (!camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    if (renderer) renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function update(dt, t) {
    // nothing animated in the world layer now that the haze is gone
  }

  function render() {
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  return {
    init: init, update: update, render: render,
    get scene() { return scene; },
    get camera() { return camera; },
    get renderer() { return renderer; },
    get ground() { return ground; },
    WORLD_SIZE: WORLD_SIZE, CAMPS: CAMPS
  };
})();
