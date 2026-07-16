// ============================================================
// world.js — renderer, scene, lights, terrain, skyline
// ============================================================

var World = (function () {
  var scene, camera, renderer;
  var ground, groundMat;
  var sunLight, hemiLight;
  var clock;
  var WORLD_SIZE = 144;   // ~40% smaller playfield

  // Player camps at the N/S poles; bandit camps at the E/W poles.
  var CAMPS = { north: { x: 0, z: -51 }, south: { x: 0, z: 51 } };
  var BANDIT_CAMPS = { east: { x: 51, z: 0 }, west: { x: -51, z: 0 } };

  // The central altar-ruin is a raised rectangular platform with stairs on the
  // four cardinal sides. Terrain height lifts the player onto it via the ramps.
  var PLAZA = { half: 10, height: 1.7, stairRun: 5.5, stairHalf: 4.5 };
  function plazaHeightAt(x, z) {
    var ax = Math.abs(x), az = Math.abs(z);
    if (ax <= PLAZA.half && az <= PLAZA.half) return PLAZA.height;   // platform top
    if (az <= PLAZA.stairHalf && ax > PLAZA.half && ax <= PLAZA.half + PLAZA.stairRun) // E/W stairs
      return PLAZA.height * (1 - (ax - PLAZA.half) / PLAZA.stairRun);
    if (ax <= PLAZA.stairHalf && az > PLAZA.half && az <= PLAZA.half + PLAZA.stairRun) // N/S stairs
      return PLAZA.height * (1 - (az - PLAZA.half) / PLAZA.stairRun);
    return 0;
  }

  // A chunky, low-res sand texture with a subtle grid line on two edges, tiled
  // once per movement tile so the whole floor shows the walkable grid.
  function makeSandTexture() {
    var S = 64;
    var cv = document.createElement('canvas'); cv.width = cv.height = S;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#ceb27f'; ctx.fillRect(0, 0, S, S);
    var pal = ['#c7a771', '#d8bd8a', '#bfa066', '#d0b47f', '#b8965c', '#dcc79a'];
    for (var i = 0; i < 900; i++) {
      ctx.fillStyle = pal[(Math.random() * pal.length) | 0];
      ctx.fillRect((Math.random() * S) | 0, (Math.random() * S) | 0, 1, 1);
    }
    for (var j = 0; j < 30; j++) {   // scattered darker grit/pebbles
      ctx.fillStyle = 'rgba(120,92,54,0.5)';
      ctx.fillRect((Math.random() * S) | 0, (Math.random() * S) | 0, 1, 1);
    }
    // grid lines on the top + left edges → a full grid once the texture tiles
    ctx.fillStyle = 'rgba(84,62,34,0.5)';
    ctx.fillRect(0, 0, S, 3); ctx.fillRect(0, 0, 3, S);
    ctx.fillStyle = 'rgba(232,214,170,0.28)';   // a faint highlight just inside the line
    ctx.fillRect(0, 3, S, 1); ctx.fillRect(3, 0, 1, S);
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    var tile = (window.Grid && Grid.TILE) || 2;
    tex.repeat.set(WORLD_SIZE / tile, WORLD_SIZE / tile);   // one texture cell per movement tile → grid lines align
    return tex;
  }

  // Flat desert floor (no dunes → no geometry clipping with objects).
  function buildTerrain() {
    var geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 1, 1);
    geo.rotateX(-Math.PI / 2);
    groundMat = new THREE.MeshStandardMaterial({
      color: 0xd8bd8a, roughness: 1.0, metalness: 0.0, flatShading: true   // desert sand
    });
    if (!Game.headless) groundMat.map = makeSandTexture();
    ground = new THREE.Mesh(geo, groundMat);
    ground.receiveShadow = true;
    ground.name = 'ground';
    ground.userData.kind = 'ground';
    scene.add(ground);
    // flat desert, except the raised central altar platform
    ground.userData.heightAt = plazaHeightAt;
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
      var r = Utils.randRange(82, 116);
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
  var DRIFT_R = 78;
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

  // ---- Time of day + lighting -----------------------------------------
  // Two independent darkeners feed one lighting pass, so they never fight:
  //   • the natural day/night cycle (`_tod`, a smooth 8-min loop = 4 day/4 night)
  //   • the co-op ritual dusk (`_dusk`, driven by sigils via setDusk)
  // The darker of the two wins; dusk paints the sky blood-red, night deep blue.
  var DAY_SKY   = { r: 0xe3, g: 0xd3, b: 0xa8 };
  var DUSK_SKY  = { r: 0x3a, g: 0x18, b: 0x22 };   // ritual blood-dusk
  var NIGHT_SKY = { r: 0x0c, g: 0x14, b: 0x2c };   // natural night
  var _dusk = 0;
  var _tod = 0;                 // 0 = noon, 0.5 = midnight
  var DAY_LEN = 480;            // seconds for a full day+night (≈4 min each)

  function nightLevel() { return 0.5 - 0.5 * Math.cos(_tod * Math.PI * 2); }

  function applyLighting() {
    var night = nightLevel();
    var useDusk = _dusk >= night;         // ritual dusk overrides natural night when deeper
    var dark = Math.max(night, _dusk);
    var tgt = useDusk ? DUSK_SKY : NIGHT_SKY;
    if (scene && scene.background) {
      var r = Math.round(DAY_SKY.r + (tgt.r - DAY_SKY.r) * dark);
      var g = Math.round(DAY_SKY.g + (tgt.g - DAY_SKY.g) * dark);
      var b = Math.round(DAY_SKY.b + (tgt.b - DAY_SKY.b) * dark);
      scene.background.setRGB(r / 255, g / 255, b / 255);
    }
    if (sunLight) {
      sunLight.intensity = Math.max(0.12, 1.3 - dark * 1.05);
      if (useDusk) sunLight.color.setRGB(1, 0.94 - dark * 0.35, 0.82 - dark * 0.5);
      else sunLight.color.setRGB(1 - night * 0.45, 0.94 - night * 0.30, 0.82 + night * 0.12);
      // sun/moon arcs overhead: high at noon, low at dawn/dusk, below at night
      var sa = _tod * Math.PI * 2;
      sunLight.position.set(Math.sin(sa) * 45, Math.max(4, Math.cos(sa) * 42 + 6), -18);
    }
    if (hemiLight) hemiLight.intensity = Math.max(0.18, 1.0 - dark * 0.62);
  }

  function setDusk(level) { _dusk = Utils.clamp(level, 0, 1); applyLighting(); }

  function update(dt, t) {
    updateSandDrift(dt, t);
    if (dt) { _tod += dt / DAY_LEN; if (_tod >= 1) _tod -= 1; applyLighting(); }
  }

  function render() {
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  return {
    init: init, update: update, render: render, setDusk: setDusk,
    get scene() { return scene; },
    get camera() { return camera; },
    get renderer() { return renderer; },
    get ground() { return ground; },
    WORLD_SIZE: WORLD_SIZE, CAMPS: CAMPS, BANDIT_CAMPS: BANDIT_CAMPS, PLAZA: PLAZA
  };
})();
