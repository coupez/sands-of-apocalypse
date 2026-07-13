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

  // Flat desert floor (no dunes → no geometry clipping with objects).
  function buildTerrain() {
    var geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 1, 1);
    geo.rotateX(-Math.PI / 2);
    groundMat = new THREE.MeshStandardMaterial({
      color: 0xceb27f, roughness: 1.0, metalness: 0.0, flatShading: true   // desert sand
    });
    ground = new THREE.Mesh(geo, groundMat);
    ground.receiveShadow = true;
    ground.name = 'ground';
    ground.userData.kind = 'ground';
    scene.add(ground);
    // terrain is flat, so height is always 0
    ground.userData.heightAt = function () { return 0; };
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
