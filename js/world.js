// ============================================================
// world.js — renderer, scene, lights, toxic fog, terrain, haze
// ============================================================

var World = (function () {
  var scene, camera, renderer;
  var ground, groundMat;
  var haze, hazeGeo;
  var sunLight, hemiLight;
  var clock;
  var WORLD_SIZE = 120;

  // Low-poly displaced terrain, tinted sickly grey-green.
  function buildTerrain() {
    var seg = 60;
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
      color: 0x3a3d2c, roughness: 1.0, metalness: 0.0, flatShading: true
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

  // Drifting toxic particle haze.
  function buildHaze() {
    var count = 400;
    hazeGeo = new THREE.BufferGeometry();
    var arr = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      arr[i * 3]     = Utils.randRange(-WORLD_SIZE / 2, WORLD_SIZE / 2);
      arr[i * 3 + 1] = Utils.randRange(0.5, 10);
      arr[i * 3 + 2] = Utils.randRange(-WORLD_SIZE / 2, WORLD_SIZE / 2);
    }
    hazeGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    var mat = new THREE.PointsMaterial({
      color: 0x8bff5a, size: 0.5, transparent: true, opacity: 0.28,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    haze = new THREE.Points(hazeGeo, mat);
    scene.add(haze);
  }

  // A distant jagged horizon of dead skyline silhouettes.
  function buildHorizon() {
    var group = new THREE.Group();
    var mat = new THREE.MeshBasicMaterial({ color: 0x0a1206, fog: false });
    for (var i = 0; i < 46; i++) {
      var a = (i / 46) * Math.PI * 2;
      var r = 56 + Utils.randRange(-2, 2);
      var w = Utils.randRange(1.5, 5);
      var h = Utils.randRange(3, 14);
      var geo = new THREE.BoxGeometry(w, h, w);
      var m = new THREE.Mesh(geo, mat);
      m.position.set(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
      m.rotation.y = Utils.randRange(0, Math.PI);
      group.add(m);
    }
    scene.add(group);
  }

  function init(canvas) {
    scene = new THREE.Scene();
    // dark sickly greenish sky + dense toxic fog for the moody feel
    scene.background = new THREE.Color(0x0b1408);
    scene.fog = new THREE.Fog(0x14260c, 18, 62);

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
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputEncoding = THREE.sRGBEncoding;
    }

    // Lighting: dim greenish ambient + a cold key light.
    hemiLight = new THREE.HemisphereLight(0x2a4018, 0x0a0a06, 0.55);
    scene.add(hemiLight);
    sunLight = new THREE.DirectionalLight(0xbfd98a, 0.5);
    sunLight.position.set(-30, 40, -20);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 120;
    sunLight.shadow.camera.left = -60;
    sunLight.shadow.camera.right = 60;
    sunLight.shadow.camera.top = 60;
    sunLight.shadow.camera.bottom = -60;
    scene.add(sunLight);

    buildTerrain();
    buildHaze();
    buildHorizon();

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
    // drift the haze slowly, wrapping around the world
    if (hazeGeo) {
      var pos = hazeGeo.attributes.position;
      for (var i = 0; i < pos.count; i++) {
        var x = pos.getX(i) + dt * 0.6;
        if (x > WORLD_SIZE / 2) x -= WORLD_SIZE;
        pos.setX(i, x);
        pos.setY(i, pos.getY(i) + Math.sin(t * 0.5 + i) * dt * 0.15);
      }
      pos.needsUpdate = true;
    }
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
    WORLD_SIZE: WORLD_SIZE
  };
})();
