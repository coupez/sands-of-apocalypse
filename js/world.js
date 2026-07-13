// ============================================================
// world.js — renderer, scene, lights, terrain, skyline
// ============================================================

var World = (function () {
  var scene, camera, renderer;
  var ground, groundMat;
  var sunLight, hemiLight;
  var clock;
  var WORLD_SIZE = 240;

  // Player camps at the N/S poles; bandit camps at the E/W poles.
  var CAMPS = { north: { x: 0, z: -85 }, south: { x: 0, z: 85 } };
  var BANDIT_CAMPS = { east: { x: 85, z: 0 }, west: { x: -85, z: 0 } };

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

  // A ring of great pyramids and giant boulders out past the play area, so you
  // feel like you're deep in the desert surrounded by ancient monuments.
  function buildDesertHorizon() {
    var group = new THREE.Group();
    var sand = new THREE.MeshStandardMaterial({ color: 0xd8b878, roughness: 1, flatShading: true });
    var sand2 = new THREE.MeshStandardMaterial({ color: 0xc9a463, roughness: 1, flatShading: true });
    var rockMat = new THREE.MeshStandardMaterial({ color: 0xb08050, roughness: 1, flatShading: true });
    var N = 18;
    for (var i = 0; i < N; i++) {
      var a = (i / N) * Math.PI * 2 + Utils.randRange(-0.12, 0.12);
      var r = Utils.randRange(132, 178);
      var x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (i % 2 === 0) {
        var h = Utils.randRange(24, 44), w = h * Utils.randRange(0.9, 1.3);
        var p = new THREE.Mesh(new THREE.ConeGeometry(w, h, 4), (i % 4) ? sand : sand2);
        p.rotation.y = Math.PI / 4; p.position.set(x, h / 2 - 3, z);
        group.add(p);
      } else {
        for (var k = 0; k < 3; k++) {
          var rr = new THREE.Mesh(new THREE.DodecahedronGeometry(Utils.randRange(6, 15), 0), rockMat);
          rr.position.set(x + Utils.randRange(-12, 12), Utils.randRange(2, 7), z + Utils.randRange(-12, 12));
          rr.rotation.set(Utils.rand(), Utils.rand() * 3, Utils.rand());
          group.add(rr);
        }
      }
    }
    scene.add(group);
  }

  // Low, wind-blown sand drifting across the whole floor — pure atmosphere.
  var sandDrift = null;
  var DRIFT_R = 130;
  function buildSandDrift() {
    if (Game.headless) return;
    var N = 520;
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(N * 3);
    for (var i = 0; i < N; i++) {
      pos[i * 3]     = Utils.randRange(-DRIFT_R, DRIFT_R);
      pos[i * 3 + 1] = Utils.randRange(0.15, 3.2);
      pos[i * 3 + 2] = Utils.randRange(-DRIFT_R, DRIFT_R);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({ color: 0xdcc79a, size: 0.3, transparent: true,
      opacity: 0.5, depthWrite: false, sizeAttenuation: true });
    sandDrift = new THREE.Points(geo, mat);
    sandDrift.frustumCulled = false;
    scene.add(sandDrift);
  }
  function updateSandDrift(dt, t) {
    if (!sandDrift) return;
    var arr = sandDrift.geometry.attributes.position.array;
    var wx = 9 * dt, wz = 3.4 * dt;   // prevailing wind: toward +x, a touch of +z
    for (var i = 0; i < arr.length; i += 3) {
      arr[i]     += wx + Math.sin(t * 0.7 + arr[i + 1]) * 0.03;
      arr[i + 2] += wz + Math.cos(t * 0.5 + arr[i]) * 0.03;
      arr[i + 1] += Math.sin(t * 2 + i) * 0.006;                  // gentle shimmer
      if (arr[i] > DRIFT_R) arr[i] -= 2 * DRIFT_R;
      if (arr[i + 2] > DRIFT_R) arr[i + 2] -= 2 * DRIFT_R;
      if (arr[i + 1] < 0.1) arr[i + 1] = 0.1;
      if (arr[i + 1] > 3.4) arr[i + 1] = 3.4;
    }
    sandDrift.geometry.attributes.position.needsUpdate = true;
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
    buildDesertHorizon();
    buildSandDrift();

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
    updateSandDrift(dt, t);
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
    WORLD_SIZE: WORLD_SIZE, CAMPS: CAMPS, BANDIT_CAMPS: BANDIT_CAMPS
  };
})();
