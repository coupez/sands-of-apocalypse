// ============================================================
// worldmap.js — Story Mode custom-level loader.
// Loads "world map/Level_01.glb" (a hand-built Maya scene), auto-fits it into the
// play area, and adds the authored geometry to the world AS the level — the
// imported floor is the floor, the imported cliff walls become real collision.
// Story mode strips the default versus/co-op desert entirely (see
// Entities.applyStoryMap) and overlays game logic wherever a node name is
// recognised: copper ore -> minable rock, the character -> the spawn point.
// ============================================================

var WorldMap = (function () {
  var MAP_FILE = 'world map/Level_01.glb';
  var FIT_SIZE = 100;      // target footprint (world units) for the level's longest ground edge
  // The artist tags solid collision scenery with an "_INV" suffix (walls, big rocks,
  // waterfalls, palm trunks). Those meshes block movement; everything else is walkable.
  // A "_GATE" (cave entrance) is ALSO solid — you walk UP TO it (and interact from an
  // adjacent tile), never through it — so it can't be strolled into like open air.
  var WALL_RE = /_inv|_gate/;
  var WALL_MAX_Y = 3.5;   // only block geometry near the ground (trunk/wall bases), not high canopies/tops
  var ATLAS_FILE = 'Textures/WorldTextureAtlas.png';   // shared texture applied to the whole level
  var atlasTex = null;
  // Troubleshooting toggle: false = strip the atlas off the AREA meshes and render them
  // as a flat neutral colour, to see whether banding comes from the texture or lighting.
  // (Only affects the imported level; character/weapon/rock models are unaffected.)
  var AREA_TEXTURED = true;
  var AREA_FLAT_COLOR = 0xb0a794;   // neutral sandstone shown when textures are off
  var GROUND_TEST = false;          // diagnostic: put a tiled 512 noise texture on the floor only
  var done = false;

  // A 512² sandstone-noise texture, tiled — high-frequency grain masks the smooth
  // lighting-gradient banding (this is why the default desert's tiled sand doesn't band).
  function makeNoiseGroundTex() {
    var S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
    var ctx = cv.getContext('2d'), img = ctx.createImageData(S, S), d = img.data;
    var r = 0xb0, g = 0xa7, b = 0x94;   // AREA_FLAT_COLOR channels
    for (var i = 0; i < d.length; i += 4) {
      var n = (Math.random() * 46 - 23) | 0;
      d[i] = r + n; d[i + 1] = g + n; d[i + 2] = b + n; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 6);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  var PALM_ATLAS_FILE = 'Textures/TextureAtlas_WorldAssets.png';   // palm trees use the "other" atlas
  var palmAtlasTex = null;
  var WATER_TEX_FILE = 'Textures/WaterTexture.png';     // shared water texture: pool surface + waterfalls
  var WATERFALL_SPEED = 0.35;                         // UV units/sec the waterfall scrolls downward
  var WATER_DRIFT = 0.05;                             // the pool surface drifts much slower
  var FOAM_DIST = 1.4;                                // eye-space units: how far from a surface the foam fades out
  var _scrollTextures = [];                           // { t, speed } animated each frame (waterfalls + water)
  var _waterMeshes = [], _foamRT = null;              // depth-based intersection-foam (shoreline foam) state

  // Configure a texture to match the game's pixel-art look (nearest, no mipmaps, sRGB).
  function pixelize(t, repeat) {
    t.flipY = false;                       // glTF UV convention (origin top-left)
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (THREE.sRGBEncoding !== undefined) t.encoding = THREE.sRGBEncoding;
    return t;
  }
  // Lazily load the shared World atlas / palm atlas, filtered for the pixel-art look.
  function getAtlas() {
    if (!atlasTex && THREE.TextureLoader) atlasTex = pixelize(new THREE.TextureLoader().load(ATLAS_FILE));
    return atlasTex;
  }
  function getPalmAtlas() {
    if (!palmAtlasTex && THREE.TextureLoader) palmAtlasTex = pixelize(new THREE.TextureLoader().load(PALM_ATLAS_FILE));
    return palmAtlasTex;
  }
  // Pool surface: the shared water texture on top, gently drifting, PLUS depth-based
  // intersection foam — a white line wherever geometry (the shore, or rocks poking
  // through) is close behind the water surface. Works like Unreal's DepthFade node:
  // a depth pre-pass (see prepFoam) captures the scene depth behind the water, and this
  // shader whitens the surface where that depth is only just beyond the water plane.
  var FOAM_VERT = [
    'varying vec2 vUv;',
    'varying float vViewDist;',
    'void main() {',
    '  vUv = uv;',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  vViewDist = -mv.z;',              // eye-space distance of the water surface at this fragment
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  var FOAM_FRAG = [
    '#include <packing>',
    'uniform sampler2D tWater;',
    'uniform sampler2D tDepth;',
    'uniform vec2 uResolution;',
    'uniform float uNear;',
    'uniform float uFar;',
    'uniform vec2 uOffset;',
    'uniform vec3 uWaterColor;',
    'uniform vec3 uFoamColor;',
    'uniform float uFoamDist;',
    'uniform float uRepeat;',
    'uniform float uOpacity;',
    'varying vec2 vUv;',
    'varying float vViewDist;',
    'float sceneViewDist(vec2 uv) {',
    '  float d = texture2D(tDepth, uv).x;',
    '  return -perspectiveDepthToViewZ(d, uNear, uFar);',   // positive distance from camera
    '}',
    'void main() {',
    '  vec2 suv = gl_FragCoord.xy / uResolution;',
    '  float diff = sceneViewDist(suv) - vViewDist;',       // how much geometry sits behind the surface here
    '  float foam = diff <= 0.0 ? 0.0 : 1.0 - smoothstep(0.0, uFoamDist, diff);',
    '  vec4 tex = texture2D(tWater, vUv * uRepeat + uOffset);',
    '  vec3 col = mix(tex.rgb * uWaterColor, uFoamColor, foam);',
    '  gl_FragColor = vec4(col, mix(uOpacity, 1.0, foam));', // foam is opaque, open water is see-through
    '}'
  ].join('\n');
  var _waterMat = null;
  function whiteTex() { var t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat); t.needsUpdate = true; return t; }
  function getWaterMat() {
    if (_waterMat) return _waterMat;
    _waterMat = new THREE.ShaderMaterial({
      vertexShader: FOAM_VERT, fragmentShader: FOAM_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {
        tWater: { value: whiteTex() }, tDepth: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.1 }, uFar: { value: 1000 },
        uOffset: { value: new THREE.Vector2(0, 0) }, uRepeat: { value: 4.0 },
        uWaterColor: { value: new THREE.Color(0x3f7f92) }, uFoamColor: { value: new THREE.Color(0x8fdce8) },
        uFoamDist: { value: FOAM_DIST }, uOpacity: { value: 0.82 }
      }
    });
    if (THREE.TextureLoader) {
      new THREE.TextureLoader().load(WATER_TEX_FILE, function (t) {
        pixelize(t, true);
        _waterMat.uniforms.tWater.value = t;
      }, undefined, function () {
        if (window.console) console.warn('[Story] no ' + WATER_TEX_FILE + ' — pool keeps a plain tint.');
      });
    }
    return _waterMat;
  }
  // Depth pre-pass: render the scene WITHOUT the water into an offscreen depth buffer,
  // then hand that depth to the water shader so it can foam where geometry is close.
  // Called from World.render() each frame (a no-op unless a story level has water).
  function prepFoam(renderer, scene, camera) {
    if (!_waterMat || !_waterMeshesReady() || !renderer || !THREE.DepthTexture) return;
    var size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (!_foamRT) {
      var dt = new THREE.DepthTexture(size.x, size.y); dt.type = THREE.UnsignedIntType;
      _foamRT = new THREE.WebGLRenderTarget(size.x, size.y,
        { depthTexture: dt, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    } else if (_foamRT.width !== size.x || _foamRT.height !== size.y) {
      _foamRT.setSize(size.x, size.y);
    }
    for (var i = 0; i < _waterMeshes.length; i++) _waterMeshes[i].visible = false;
    var prev = renderer.getRenderTarget();
    renderer.setRenderTarget(_foamRT);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prev);
    for (i = 0; i < _waterMeshes.length; i++) _waterMeshes[i].visible = true;
    var u = _waterMat.uniforms;
    u.tDepth.value = _foamRT.depthTexture;
    u.uResolution.value.set(size.x, size.y);
    u.uNear.value = camera.near; u.uFar.value = camera.far;
  }
  function _waterMeshesReady() { return _waterMeshes.length > 0; }
  // Swap the waterfall meshes to the same scrolling water texture (present-or-atlas).
  function applyWaterfall(mats) {
    if (!mats.length || !THREE.TextureLoader) return;
    new THREE.TextureLoader().load(WATER_TEX_FILE, function (t) {
      pixelize(t, true);
      mats.forEach(function (m) {
        m.map = t; if (m.color) m.color.set(0xffffff);
        // Make waterfalls read like the pool: translucent + self-lit blue so scene
        // lighting doesn't darken them into an opaque sheet (they don't share the
        // pool's foam ShaderMaterial — see getWaterMat — but this matches its tint).
        m.transparent = true; m.opacity = 0.9; m.depthWrite = false;
        if (m.emissive) { m.emissive.set(0x3f7f92); m.emissiveMap = t; }
        if (m.metalness !== undefined) m.metalness = 0;
        if (m.roughness !== undefined) m.roughness = 1;
        m.needsUpdate = true;
      });
      _scrollTextures.push({ t: t, speed: WATERFALL_SPEED });
    }, undefined, function () {
      if (window.console) console.warn('[Story] no ' + WATER_TEX_FILE + ' yet — waterfalls keep the atlas.');
    });
  }
  // Scroll the water textures each frame (called from main.js's step loop).
  function update(dt) {
    for (var i = 0; i < _scrollTextures.length; i++) {
      var s = _scrollTextures[i];
      s.t.offset.y -= s.speed * dt;
      if (s.t.offset.y < -1) s.t.offset.y += 1;
    }
    if (_waterMat && _waterMat.uniforms) {   // drift the shader-based pool surface
      var o = _waterMat.uniforms.uOffset.value;
      o.y -= WATER_DRIFT * dt; if (o.y < -1) o.y += 1;
    }
  }

  function load() {
    if (done || typeof THREE === 'undefined' || !THREE.GLTFLoader) return;
    done = true;
    new THREE.GLTFLoader().load(encodeURI(MAP_FILE), onLoad, undefined, onError);
  }

  function onLoad(gltf) {
    var root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
    if (!root || !Game.scene) { onError(); return; }

    // Story lighting: ACES tone mapping compresses the tonal range so the smooth
    // light falloff across the big surfaces stops stepping (8-bit gradient banding);
    // together with the materials' dithering it clears the banding the texture-off
    // test proved was lighting, not texture. Recompile existing materials so the
    // renderer change takes effect this session (materials read toneMapping at compile).
    if (Game.renderer) {
      Game.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      Game.renderer.toneMappingExposure = 1.1;
      Game.scene.traverse(function (o) {
        if (!o.material) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (mm) { if (mm) mm.needsUpdate = true; });
      });
    }
    // Sharpen the sun shadow — a large area on a 512 shadow map bands/acnes on the floor.
    if (window.World && World.boostShadows) World.boostShadows();

    // The level is authored tiny (≈1.7 units across) and already baked Y-up by the
    // exporter. Fit + centre it on the FLOOR: FLoor_Geo's footprint fills the play
    // area and its TOP surface becomes y = 0, so the character (which walks on the
    // flat y = 0 plane) stands directly on the floor geometry — not above/below it.
    root.updateWorldMatrix(true, true);
    var floorMesh = null;
    root.traverse(function (o) { if (o.isMesh && !floorMesh && /floor/i.test(o.name)) floorMesh = o; });
    var refBox = new THREE.Box3().setFromObject(floorMesh || root);
    var size = refBox.getSize(new THREE.Vector3());
    var mid = refBox.getCenter(new THREE.Vector3());
    var footprint = Math.max(size.x, size.z) || 1;
    var scale = FIT_SIZE / footprint;

    var group = new THREE.Group();
    group.name = 'storyLevel';        // entities.js spares this group when it strips the default world
    group.add(root);
    group.scale.setScalar(scale);
    group.position.set(-mid.x * scale, -refBox.max.y * scale, -mid.z * scale);  // floor centre → origin, floor TOP → y=0
    Game.scene.add(group);
    group.updateWorldMatrix(true, true);   // push the new scale/offset into every child's matrixWorld

    // One pass over the imported meshes: make them lit/shadowed from both sides
    // (Maya exports often have flipped normals), record each named node's FINAL
    // game-world position for entities.js, and collect the wall meshes to collide
    // (never the floor — that would make the whole level unwalkable).
    var atlas = getAtlas(), palmAtlas = getPalmAtlas();
    _waterMeshes.length = 0; _scrollTextures.length = 0;   // fresh per load (re-entering story)
    var nodes = [], walls = [], wfMats = [], p = new THREE.Vector3();
    root.traverse(function (o) {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      var ln = (o.name || '').toLowerCase();
      var isWater = ln.indexOf('water') >= 0 && ln.indexOf('waterfall') < 0;   // the pool surface
      var isPalm = ln.indexOf('palm') >= 0;         // palms default to the props atlas
      var isFall = ln.indexOf('waterfall') >= 0;    // waterfalls get a scrolling texture
      if (isWater) { o.material = getWaterMat(); o.castShadow = false; _waterMeshes.push(o); }   // foam water — see prepFoam
      else {
      // ATLAS SELECTOR: tag a node name with "_A1" (world atlas) or "_A2" (props atlas,
      // e.g. rock/flint piles) to force which sheet it samples. Untagged → world atlas
      // (palms default to props for back-compat). atlas=WorldTextureAtlas, palmAtlas=TextureAtlas.
      var meshAtlas = ln.indexOf('_a2') >= 0 ? palmAtlas
                    : ln.indexOf('_a1') >= 0 ? atlas
                    : (isPalm ? palmAtlas : atlas);
      var hasUV = !!(o.geometry && o.geometry.attributes && o.geometry.attributes.uv);
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
        if (!m) return;
        m.side = THREE.DoubleSide;
        m.dithering = true;    // break up gradient banding across the big flat floor/cliffs
        // Apply the atlas to every UV-mapped mesh (replaces the embedded texture);
        // nearest/no-mipmaps for the game's crisp pixel-art look. Textures OFF → flat colour.
        if (AREA_TEXTURED && meshAtlas && hasUV) { m.map = meshAtlas; if (m.color) m.color.set(0xffffff); }
        else { m.map = null; if (m.color) m.color.set(AREA_FLAT_COLOR); }
        if (m.map) {
          m.map.magFilter = THREE.NearestFilter;
          m.map.minFilter = THREE.NearestFilter;
          m.map.generateMipmaps = false;
          m.map.needsUpdate = true;
        }
        // Force every mesh fully matte — kill the glossy specular highlights the .glb
        // materials ship with (textured meshes used to keep them; now none do).
        if (m.metalness !== undefined) m.metalness = 0;
        if (m.roughness !== undefined) m.roughness = 1;
        if (o === floorMesh) { m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1; }
        if (isFall) wfMats.push(m);   // collected for the scrolling-water swap below
        m.needsUpdate = true;   // dithering / map toggles a shader define — force a recompile
      });
      }
      if (!o.name) return;
      o.getWorldPosition(p);
      nodes.push({ name: o.name, x: p.x, z: p.z, obj: o });
      if (o !== floorMesh && WALL_RE.test(o.name.toLowerCase())) walls.push(o);
    });
    if (AREA_TEXTURED) applyWaterfall(wfMats);   // swap waterfalls to scrolling water if the file exists

    // Diagnostic: give the floor a tiled 512 noise texture and see if its banding clears.
    if (GROUND_TEST && floorMesh && floorMesh.material) {
      var nt = makeNoiseGroundTex();
      (Array.isArray(floorMesh.material) ? floorMesh.material : [floorMesh.material]).forEach(function (m) {
        if (m) { m.map = nt; if (m.color) m.color.set(0xffffff); m.needsUpdate = true; }
      });
    }

    // Precisely seat the floor under the spawn. The floor's bounding-box top can be a
    // raised rim/edge, not the surface you actually stand on, so aligning by max.y can
    // leave the character floating. Instead raycast straight down onto FLoor_Geo at the
    // spawn's x,z and shift the whole level so that exact surface point becomes y = 0.
    var spawnNode = null;
    for (var si = 0; si < nodes.length; si++) {
      if (/character|player|spawn|start/i.test(nodes[si].name)) { spawnNode = nodes[si]; break; }
    }
    var seatX = spawnNode ? spawnNode.x : 0, seatZ = spawnNode ? spawnNode.z : 0;

    // A live world-space height probe: raycast straight down onto the floor at (x,z).
    var _rc = new THREE.Raycaster(), _o = new THREE.Vector3(), _down = new THREE.Vector3(0, -1, 0);
    function floorHeight(x, z) {
      if (!floorMesh) return null;
      _o.set(x, 1000, z); _rc.set(_o, _down);
      var h = _rc.intersectObject(floorMesh, true)[0];
      return h ? h.point.y : null;
    }
    // Seat the level so the floor under the spawn (or, if the spawn isn't over the
    // floor, the floor centre) sits at y = 0 — keeps the camera/shadows framed sanely.
    var seatY = floorHeight(seatX, seatZ);
    if (seatY == null) seatY = floorHeight(0, 0);
    if (seatY != null) { group.position.y -= seatY; group.updateWorldMatrix(true, true); }

    // The real fix for floating/sinking: in story mode the player's ground height IS
    // the imported floor surface, sampled live. So the character always stands exactly
    // on FLoor_Geo, whatever its shape or height — no flat-y=0 guess.
    if (window.World && World.ground && World.ground.userData) {
      World.ground.userData.heightAt = function (x, z) { var h = floorHeight(x, z); return h == null ? 0 : h; };
    }

    // Overlay game objects (this also strips the default desert + resets the grid).
    var placed = (window.Entities && Entities.applyStoryMap) ? Entities.applyStoryMap(nodes) : 0;

    // Confine the player to the floor: block every grid tile that has no floor beneath
    // it (outside the floor's footprint, or a hole in it). This is the hard guarantee
    // you can't leave the level even if a wall mesh has a gap (e.g. the waterfall).
    // Then make the wall meshes solid. BOTH must run AFTER applyStoryMap, which resets
    // the grid when it re-stamps the story resources.
    var confinedTiles = 0;
    if (window.Grid && Grid.blockCircle && floorMesh) {
      var TILE = Grid.TILE || 2, HALF = ((window.World && World.WORLD_SIZE) || 144) / 2;
      var fbox = new THREE.Box3().setFromObject(floorMesh);
      for (var gx = -HALF + TILE / 2; gx < HALF; gx += TILE) {
        for (var gz = -HALF + TILE / 2; gz < HALF; gz += TILE) {
          var inBox = gx >= fbox.min.x && gx <= fbox.max.x && gz >= fbox.min.z && gz <= fbox.max.z;
          if (!inBox || floorHeight(gx, gz) == null) { Grid.blockCircle(gx, gz, TILE * 0.45); confinedTiles++; }
        }
      }
    }
    var blockedTiles = blockColliders(walls);

    // Guarantee every mineable rock/boulder is reachable. Wall + confinement blocking
    // can wall a rock in on all sides (e.g. a boulder wedged in the cave mouth), so the
    // player can never stand next to it to mine. If a rock has NO walkable orthogonal
    // neighbour, open the one facing the spawn (the level's open side).
    var openedTiles = ensureRocksReachable();

    // Drop the player onto the spawn marker the level author placed (else origin).
    var spawn = Game.storySpawn || { x: 0, z: 0 };
    if (window.Player && Player.spawnAt) Player.spawnAt(spawn.x, spawn.z);
    // (No starter pickaxe yet — pickaxe acquisition is still to be designed. The
    //  mining system + Skills.grantStoryStarter() are ready for when we add it.)

    if (window.console) console.log(
      '[Story] Level_01 loaded — fit ' + scale.toFixed(1) + 'x (footprint ' + footprint.toFixed(2) +
      'u), ' + nodes.length + ' nodes, ' + placed + ' game objects, ' + walls.length + ' wall meshes → ' +
      blockedTiles + ' wall tiles, ' + confinedTiles + ' off-floor tiles blocked, spawn (' + spawn.x.toFixed(1) + ', ' + spawn.z.toFixed(1) + ')');
    if (window.console) {
      var fy = floorHeight(spawn.x, spawn.z), py = (window.Player && Player.group) ? Player.group.position.y : null;
      console.log('[Story] heights — seatY ' + (seatY == null ? 'MISS' : seatY.toFixed(3)) +
        ', floorY@spawn ' + (fy == null ? 'MISS' : fy.toFixed(3)) +
        ', playerY ' + (py == null ? '?' : py.toFixed(3)) + ' (gap = character floating above floor if playerY > floorY)');
    }
    if (window.UI && UI.showActionText) UI.showActionText('Story: Level 1 loaded — ' + placed + ' objects placed.');
    Game.storyLoaded = true;   // signal for the ?storytest harness / late-join logic
  }

  // Block the grid tiles the wall geometry stands on, so pathing + straight-line
  // movement both route around them. Samples the mesh vertices (robust for thin
  // vertical walls) and paints a small blocked circle at each, sealing gaps.
  function blockColliders(meshes) {
    if (!window.Grid || !Grid.blockCircle || !meshes || !meshes.length) return 0;
    var TILE = Grid.TILE || 2, v = new THREE.Vector3(), seen = {}, n = 0;
    for (var mi = 0; mi < meshes.length; mi++) {
      var m = meshes[mi], geo = m.geometry;
      if (!geo || !geo.attributes || !geo.attributes.position) continue;
      m.updateWorldMatrix(true, false);
      var pos = geo.attributes.position, step = Math.max(1, Math.floor(pos.count / 4000));
      for (var i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if (v.y > WALL_MAX_Y) continue;   // skip high geometry (palm canopies, wall tops) — only block the base footprint
        var key = Math.round(v.x / TILE) + ',' + Math.round(v.z / TILE);
        if (seen[key]) continue;
        seen[key] = 1;
        Grid.blockCircle(v.x, v.z, TILE * 0.35);   // tighter → walls stop eating the adjacent walkable floor (off-floor confinement is the real boundary)
        n++;
      }
    }
    return n;
  }

  // Make sure each imported mineable rock has at least one walkable orthogonal
  // neighbour to stand on. If fully walled in, unblock the neighbour tile nearest
  // the spawn so the approach opens on the level's field side (not into the cave).
  function ensureRocksReachable() {
    if (!window.Grid || !window.Entities || !Entities.rocks) return 0;
    var spawn = Game.storySpawn || { x: 0, z: 0 };
    var st = Grid.worldToTile(spawn.x, spawn.z), opened = 0;
    var NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    Entities.rocks.forEach(function (rk) {
      if (!rk.position) return;
      var rt = Grid.worldToTile(rk.position.x, rk.position.z);
      var free = NB.some(function (d) { return Grid.walkable(rt.tx + d[0], rt.tz + d[1]); });
      if (free) return;                                    // already reachable
      // open the blocked neighbour that BEST connects to the field: prefer one that
      // already touches a walkable tile, breaking ties by nearness to spawn.
      var best = null, bestScore = Infinity;
      NB.forEach(function (d) {
        var nx = rt.tx + d[0], nz = rt.tz + d[1];
        if (Grid.walkable(nx, nz)) return;                 // already open
        var connects = NB.some(function (e) { return Grid.walkable(nx + e[0], nz + e[1]); });
        var dd = (nx - st.tx) * (nx - st.tx) + (nz - st.tz) * (nz - st.tz);
        var score = (connects ? 0 : 100000) + dd;          // connected tiles win big
        if (score < bestScore) { bestScore = score; best = [nx, nz]; }
      });
      if (best) { Grid.setBlocked(best[0], best[1], false); opened++; }
    });
    return opened;
  }

  function onError(err) {
    if (window.console) console.warn('[Story] could not load "' + MAP_FILE + '" — playing the default world', err || '');
    if (window.UI && UI.showActionText) UI.showActionText('No "' + MAP_FILE + '" found — playing the default world.');
    Game.storyLoaded = true; Game.storyLoadError = true;
  }

  return { load: load, update: update, prepFoam: prepFoam };
})();
