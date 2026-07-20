// ============================================================
// icons.js — procedural low-poly item icons.
// A hidden offscreen Three.js renderer builds a small faceted
// mesh for each item subject (fish, ore rock, log, ingot, …),
// renders it once under a warm desert light rig, and hands back
// a cached PNG data-URL that the UI drops in place of an emoji.
// Metal tiers reuse one base mesh recoloured by the item's tint.
// Falls back silently (returns null) if WebGL is unavailable, so
// the emoji path still works headless.
// ============================================================

var Icons = (function () {
  var S = 48;                  // low render resolution → chunky, PS1-mosaic icons (CSS renders them pixelated)
  var renderer, scene, camera; // lazily created on first use
  var ready = false, broken = false;
  var cache = {};              // key -> dataURL | null

  function ensure() {
    if (renderer || broken) return;
    try {
      var cv = document.createElement('canvas');
      cv.width = S; cv.height = S;
      renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: false, preserveDrawingBuffer: true });
      renderer.setSize(S, S, false);
      if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      // warm desert key + cool rim, so every icon reads as one set
      scene.add(new THREE.HemisphereLight(0xfff2d8, 0x4a3826, 0.95));
      var key = new THREE.DirectionalLight(0xfff1d0, 1.15); key.position.set(5, 8, 6); scene.add(key);
      var rim = new THREE.DirectionalLight(0x9ab4ff, 0.4); rim.position.set(-6, 2, -5); scene.add(rim);
      ready = true;
    } catch (e) { broken = true; }
  }

  // ---- helpers ---------------------------------------------------------
  function mix(a, b, t) { return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex(); }
  // Smooth shading by default (cleaner, stylized). Pass {flat:true} for the
  // pieces that read better faceted — rock, crystals, metal ingots.
  function facetMat(color, o) {
    o = o || {};
    var m = new THREE.MeshStandardMaterial({
      color: color, flatShading: !!o.flat,
      roughness: o.rough != null ? o.rough : 0.7,
      metalness: o.metal != null ? o.metal : 0.1
    });
    if (o.emissive != null) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.emi != null ? o.emi : 0.4; }
    return m;
  }

  // ---- mesh factories --------------------------------------------------
  function logMesh(o) {
    o = o || {}; var bark = o.bark, cut = o.cut, len = o.len || 1.7, r = o.r || 0.42;
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16, 1), facetMat(bark, { rough: 0.9, metal: 0.03 }));
    body.rotation.z = Math.PI / 2; g.add(body);
    for (var s = -1; s <= 1; s += 2) {
      var cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.98, r * 0.98, 0.08, 16, 1), facetMat(cut, { rough: 0.8 }));
      cap.rotation.z = Math.PI / 2; cap.position.x = s * (len / 2 + 0.02); g.add(cap);
      var ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.1, 16, 1), facetMat(mix(cut, bark, 0.5), { rough: 0.85 }));
      ring.rotation.z = Math.PI / 2; ring.position.x = s * (len / 2 + 0.03); g.add(ring);
    }
    return g;
  }

  function oreRock(color) {
    var g = new THREE.Group();
    var geo = new THREE.DodecahedronGeometry(1, 0), p = geo.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var f = 0.82 + Math.random() * 0.36;
      p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f);
    }
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, facetMat(mix(color, 0x5b5148, 0.55), { flat: true, rough: 0.95, metal: 0.05 })));
    for (var k = 0; k < 4; k++) {
      var d = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), facetMat(color, { flat: true, rough: 0.35, metal: 0.6, emissive: color, emi: 0.25 }));
      var a = k / 4 * Math.PI * 2;
      d.position.set(Math.cos(a) * 0.62, (k % 2 ? 0.35 : -0.2), Math.sin(a) * 0.62);
      d.scale.setScalar(0.7 + Math.random() * 0.6);
      g.add(d);
    }
    return g;
  }

  function ingot(color) {
    var geo = new THREE.BoxGeometry(1.5, 0.55, 0.8, 1, 1, 1), p = geo.attributes.position;
    for (var i = 0; i < p.count; i++) { if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.7); p.setZ(i, p.getZ(i) * 0.7); } }
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, facetMat(color, { flat: true, rough: 0.3, metal: 0.85 }));
  }

  function fishMesh(o) {
    o = o || {}; var col = o.col;
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 3), facetMat(col, { rough: o.cooked ? 0.85 : 0.5, metal: o.cooked ? 0.02 : 0.15 }));
    body.scale.set(1.7, 0.85, 0.55); g.add(body);
    var tail = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.6, 4, 1), facetMat(col, { rough: 0.6 }));
    tail.rotation.z = Math.PI / 2; tail.scale.set(1, 1, 0.35); tail.position.x = -1.15; g.add(tail);
    var fin = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.45, 4, 1), facetMat(mix(col, 0x000000, 0.2), { rough: 0.6 }));
    fin.scale.set(1, 1, 0.2); fin.position.set(0.1, 0.5, 0); g.add(fin);
    for (var s = -1; s <= 1; s += 2) {
      var eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), facetMat(0x161616, { rough: 0.4 }));
      eye.position.set(0.8, 0.12, 0.24 * s); g.add(eye);
    }
    if (o.skewer) {
      var stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.7, 6), facetMat(0x8a6a3a, { rough: 0.9 }));
      stick.rotation.z = Math.PI / 2; stick.position.y = -0.05; g.add(stick);
    }
    return g;
  }

  function crabMesh(o) {
    o = o || {}; var col = o.col;
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 3), facetMat(col, { rough: o.cooked ? 0.8 : 0.5, metal: 0.08 }));
    body.scale.set(1.25, 0.55, 1); g.add(body);
    for (var s = -1; s <= 1; s += 2) {
      var arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 5), facetMat(col, { rough: 0.6 }));
      arm.position.set(0.55, -0.02, 0.5 * s); arm.rotation.z = Math.PI / 2.4; g.add(arm);
      var claw = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), facetMat(mix(col, 0xffffff, 0.15), { rough: 0.5 }));
      claw.scale.set(1.2, 0.7, 0.7); claw.position.set(0.95, 0.05, 0.62 * s); g.add(claw);
      for (var l = 0; l < 3; l++) {
        var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 4), facetMat(mix(col, 0x000000, 0.15), { rough: 0.6 }));
        leg.position.set(-0.05 - l * 0.3, -0.12, 0.55 * s);
        leg.rotation.z = Math.PI / 2.6; leg.rotation.x = (0.35 + l * 0.12) * s; g.add(leg);
      }
    }
    return g;
  }

  function bonesMesh() {
    var col = 0xe8e0cc, g = new THREE.Group();
    function bone() {
      var b = new THREE.Group();
      var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.0, 7), facetMat(col, { rough: 0.7 }));
      shaft.rotation.z = Math.PI / 2; b.add(shaft);
      for (var s = -1; s <= 1; s += 2) for (var t = -1; t <= 1; t += 2) {
        var k = new THREE.Mesh(new THREE.SphereGeometry(0.17, 7, 6), facetMat(col, { rough: 0.7 }));
        k.position.set(s * 0.55, t * 0.14, 0); b.add(k);
      }
      return b;
    }
    var b1 = bone(); b1.rotation.z = 0.5; g.add(b1);
    var b2 = bone(); b2.rotation.z = -0.5; g.add(b2);
    return g;
  }

  function gem(shape, col, emi, sy, metalGem) {
    var geo = shape === 'oct' ? new THREE.OctahedronGeometry(0.75, 0)
      : shape === 'dodec' ? new THREE.DodecahedronGeometry(0.7, 0)
      : new THREE.IcosahedronGeometry(0.72, 0);
    var m = new THREE.Mesh(geo, facetMat(col, { flat: true, rough: metalGem ? 0.3 : 0.2, metal: metalGem ? 0.85 : 0.25, emissive: col, emi: emi }));
    if (sy) m.scale.y = sy;
    return m;
  }

  function datesMesh(col) {
    var g = new THREE.Group(), mat = facetMat(col, { rough: 0.5, metal: 0.05 });
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * Math.PI * 2;
      var d = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 1), mat);
      d.scale.set(0.6, 1.0, 0.6);
      d.position.set(Math.cos(a) * 0.32, (i % 2 ? 0.12 : -0.12), Math.sin(a) * 0.32);
      d.rotation.z = Math.cos(a) * 0.3; g.add(d);
    }
    var stem = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 6), facetMat(0x4f7a3a, { rough: 0.8 }));
    stem.position.y = 0.55; g.add(stem);
    return g;
  }
  function pricklyPearMesh(fruitCol) {
    var g = new THREE.Group();
    var pad = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), facetMat(0x4f8a4a, { rough: 0.7 }));
    pad.scale.set(0.9, 1.15, 0.34); g.add(pad);
    for (var i = -1; i <= 1; i++) {
      var f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), facetMat(fruitCol, { rough: 0.5 }));
      f.scale.set(0.85, 1.15, 0.85); f.position.set(i * 0.28, 0.7, 0.02); g.add(f);
    }
    var spineMat = facetMat(0xe9e2c8, { flat: true, rough: 0.6 });
    for (var s = 0; s < 8; s++) {
      var sp = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.14, 4), spineMat);
      var a = (s / 8) * Math.PI * 2;
      sp.position.set(Math.cos(a) * 0.4, (s % 3 - 1) * 0.25, 0.18);
      sp.rotation.x = -Math.PI / 2; g.add(sp);
    }
    return g;
  }
  function figsMesh(col) {
    var g = new THREE.Group(), mat = facetMat(col, { rough: 0.5 });
    for (var i = -1; i <= 1; i += 2) {
      var f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), mat);
      f.scale.set(0.85, 0.95, 0.85); f.position.set(i * 0.3, 0, 0); g.add(f);
      var stem = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 6), facetMat(0x4f7a3a, { rough: 0.8 }));
      stem.position.set(i * 0.3, 0.42, 0); g.add(stem);
    }
    return g;
  }

  // ---- primitive tool-crafting chain meshes ----------------------------
  function stoneMesh(col, sharp) {
    var geo = sharp ? new THREE.TetrahedronGeometry(1.05, 0) : new THREE.DodecahedronGeometry(0.95, 0);
    var p = geo.attributes.position;
    for (var i = 0; i < p.count; i++) { var f = 0.82 + Math.random() * 0.36; p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f); }
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, facetMat(col || 0x8a8175, { flat: true, rough: sharp ? 0.78 : 0.95, metal: 0.05 }));
  }
  // a stick lying along X (so it frames nicely in the icon)
  function stickBar(o) {
    o = o || {};
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.CylinderGeometry(o.r || 0.13, (o.r || 0.13) * (o.taper || 1), o.len || 1.9, o.seg || 8), facetMat(o.col || 0xcaa76a, { rough: 0.85, metal: 0.03 }));
    body.rotation.z = Math.PI / 2; if (o.bend) body.rotation.y = o.bend; g.add(body);
    return g;
  }
  // wrap a few string rings around an X-aligned shaft
  function stringRings(g, x0, n, rad, col) {
    var sm = facetMat(col || 0x9caf5a, { rough: 0.9 });
    for (var i = 0; i < n; i++) { var ring = new THREE.Mesh(new THREE.TorusGeometry(rad, rad * 0.24, 6, 10), sm); ring.rotation.y = Math.PI / 2; ring.position.x = x0 + i * rad * 0.75; g.add(ring); }
    return g;
  }
  function fibersMesh() {
    var g = new THREE.Group(), mat = facetMat(0x9caf5a, { rough: 0.85, metal: 0.02 });
    for (var i = 0; i < 7; i++) { var a = (i / 7) * Math.PI * 2; var s = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 5), mat); s.position.set(Math.cos(a) * 0.18, 0, Math.sin(a) * 0.18); s.rotation.z = Math.cos(a) * 0.28; s.rotation.x = Math.sin(a) * 0.28; g.add(s); }
    return g;
  }
  function reedMesh() {
    var g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 1.9, 6), facetMat(0x7a9a4a, { rough: 0.85 })));
    var tuft = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 6), facetMat(0xbfa85a, { rough: 0.8 })); tuft.position.y = 1.1; g.add(tuft);
    return g;
  }
  function pickedStickMesh() {
    var g = stickBar({ col: 0x9a7a4a, r: 0.11, len: 1.9, bend: 0.14 });
    var twig = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.5, 5), facetMat(0x9a7a4a, { rough: 0.9 })); twig.position.set(0.35, 0.2, 0); twig.rotation.z = -0.6; g.add(twig);
    return g;
  }
  function sturdyHandleMesh(withString) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 2.0, 8), facetMat(0xb98a4a, { rough: 0.8 })); body.rotation.z = Math.PI / 2; g.add(body);
    var knob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 1), facetMat(0xa87a3a, { rough: 0.85 })); knob.position.x = -1.02; g.add(knob);
    if (withString) stringRings(g, 0.45, 3, 0.24);
    return g;
  }
  function primitiveAxeMesh() {
    var g = stickBar({ col: 0xc9a86a, r: 0.12, len: 2.0 });
    var head = new THREE.Mesh(new THREE.TetrahedronGeometry(0.5, 0), facetMat(0x9a9186, { flat: true, rough: 0.8 })); head.position.set(0.85, 0.18, 0); head.rotation.z = 0.7; head.scale.set(1, 1, 0.55); g.add(head);
    stringRings(g, 0.6, 2, 0.17);
    g.rotation.set(0.15, -0.55, 0.9);   // tilt so it reads clearly as an axe in the icon
    return g;
  }
  function primitivePickaxeMesh() {
    var g = new THREE.Group();
    var handle = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 2.0, 8), facetMat(0xb98a4a, { rough: 0.8 })); handle.rotation.z = Math.PI / 2; g.add(handle);
    var head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 1.2), facetMat(0x8a8175, { flat: true, rough: 0.85 })); head.position.set(0.9, 0.12, 0); g.add(head);
    for (var s = -1; s <= 1; s += 2) { var tip = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.36, 5), facetMat(0x9a9186, { flat: true, rough: 0.8 })); tip.position.set(0.9, 0.12, s * 0.72); tip.rotation.x = s * Math.PI / 2; g.add(tip); }
    stringRings(g, 0.35, 2, 0.19);
    g.rotation.set(0.15, -0.4, 0.9);    // tilt so the pick head is clearly visible
    return g;
  }
  function bundleOfSticksMesh() {
    var g = new THREE.Group(), mat = facetMat(0x9a7a4a, { rough: 0.9 });
    for (var i = 0; i < 5; i++) { var a = (i / 5) * Math.PI * 2; var s = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 1.8, 6), mat); s.rotation.z = Math.PI / 2; s.position.set(0, Math.cos(a) * 0.2, Math.sin(a) * 0.2); s.rotation.y = (i - 2) * 0.05; g.add(s); }
    stringRings(g, -0.15, 2, 0.34, 0x8a5a3a);   // tied in the middle
    return g;
  }
  function fishingNetMesh() {
    var g = new THREE.Group();
    var hoop = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.08, 8, 20), facetMat(0xc9a86a, { rough: 0.85 })); g.add(hoop);
    var strMat = facetMat(0x9caf5a, { rough: 0.9 });
    for (var i = -2; i <= 2; i++) {
      var h = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.7, 4), strMat); h.rotation.z = Math.PI / 2; h.position.y = i * 0.32; g.add(h);
      var v = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.7, 4), strMat); v.position.x = i * 0.32; g.add(v);
    }
    return g;
  }

  // id -> factory(color). `color` is the item's tint when it has one.
  var FACT = {
    log:       function () { return logMesh({ bark: 0x8a7a5c, cut: 0xc9b487 }); },
    palmwood:  function () { return logMesh({ bark: 0xb9863f, cut: 0xe4c68a }); },
    blog:      function () { return logMesh({ bark: 0x322a24, cut: 0x6b5a48 }); },
    elderwood: function () { return logMesh({ bark: 0x6e3a22, cut: 0xb5763f }); },
    ore:    function (c) { return oreRock(c != null ? c : 0xc87838); },
    iron:   function (c) { return oreRock(c != null ? c : 0x8a8f96); },
    silver: function (c) { return oreRock(c != null ? c : 0xd8dce2); },
    pore:   function (c) { return oreRock(c != null ? c : 0xffd24a); },
    bronzebar: function (c) { return ingot(c != null ? c : 0xc87838); },
    ironbar:   function (c) { return ingot(c != null ? c : 0x8a8f96); },
    silverbar: function (c) { return ingot(c != null ? c : 0xd8dce2); },
    goldbar:   function (c) { return ingot(c != null ? c : 0xffd24a); },
    tinakal:    function (c) { return oreRock(c != null ? c : 0x5fe0d0); },   // meteoric ore chunk
    tinakalbar: function (c) { return ingot(c != null ? c : 0x5fe0d0); },
    shrimp:   function () { return datesMesh(0x7a4a22); },        // Dates
    lobster:  function () { return pricklyPearMesh(0xc0347a); },  // Prickly Pear
    whale:    function () { return figsMesh(0x6a2f7a); },         // Figs
    cshrimp:  function () { return datesMesh(0x9a6a1a); },        // Honeyed Dates
    clobster: function () { return pricklyPearMesh(0xd0603a); },  // Cactus Jam
    cwhale:   function () { return figsMesh(0x3f2450); },         // Dried Figs
    essence:     function () { return gem('ico', 0xb01818, 0.55); },
    rockessence: function () { return gem('oct', 0x8a4bd6, 0.5, 1.4); },
    messence:    function () { return gem('oct', 0xffd24a, 0.25, 1.0, true); },
    bones:       function () { return bonesMesh(); },
    orb:         function () { return gem('dodec', 0xff2a2a, 0.85); },
    // primitive tool-crafting chain
    rock:         function () { return stoneMesh(0x8a8175, false); },
    flint:        function () { return stoneMesh(0xc0392b, true); },   // red sharp flint
    sharp_rock:   function () { return stoneMesh(0x9a9186, true); },
    reed:         function () { return reedMesh(); },
    reed_fibers:  function () { return fibersMesh(); },
    stick:        function () { return pickedStickMesh(); },
    smooth_stick: function () { return stickBar({ col: 0xcaa76a, r: 0.13, len: 2.0 }); },
    handle_with_string:        function () { var g = stickBar({ col: 0xc9a86a, r: 0.14, len: 1.9 }); stringRings(g, 0.5, 3, 0.2); return g; },
    sturdy_handle:             function () { return sturdyHandleMesh(false); },
    sturdy_handle_with_string: function () { return sturdyHandleMesh(true); },
    primitive_axe:      function () { return primitiveAxeMesh(); },
    primitive_pickaxe:  function () { return primitivePickaxeMesh(); },
    bundle_of_sticks:      function () { return bundleOfSticksMesh(); },
    primitive_fishing_net: function () { return fishingNetMesh(); }
  };

  // ---- render one object to a data-URL --------------------------------
  function disposeTree(o) {
    o.traverse(function (n) {
      if (n.geometry) n.geometry.dispose();
      if (n.material) { (Array.isArray(n.material) ? n.material : [n.material]).forEach(function (m) { m.dispose(); }); }
    });
  }
  function renderObj(obj, roll) {
    scene.add(obj);
    var box = new THREE.Box3().setFromObject(obj);
    var sph = box.getBoundingSphere(new THREE.Sphere());
    obj.position.sub(sph.center);
    var r = sph.radius || 1;
    var dist = r / Math.sin((camera.fov * Math.PI / 180) / 2) * 1.06;
    var dir = new THREE.Vector3(0.55, 0.5, 1).normalize();
    camera.position.copy(dir.multiplyScalar(dist));
    camera.lookAt(0, 0, 0);
    if (roll) camera.rotateZ(roll);                 // tilt the icon in-plane (e.g. weapons 45°)
    camera.near = Math.max(0.0005, dist * 0.01);   // scale clip planes to the model → any export size frames
    camera.far = dist * 100 + 10;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    var blank = isBlankRender();
    var url = blank ? null : renderer.domElement.toDataURL('image/png');
    scene.remove(obj); disposeTree(obj);
    return url;                     // null → caller falls back to the emoji glyph
  }
  // Detect a render that produced (almost) nothing — e.g. a broken/degenerate
  // imported model — so we can fall back to the item's emoji instead of a blank.
  var _probe = null;
  function isBlankRender() {
    try {
      if (!_probe) { _probe = document.createElement('canvas'); _probe.width = _probe.height = 28; }
      var p = _probe.getContext('2d');
      p.clearRect(0, 0, 28, 28);
      p.drawImage(renderer.domElement, 0, 0, 28, 28);
      var d = p.getImageData(0, 0, 28, 28).data;
      for (var i = 3; i < d.length; i += 4) if (d[i] > 8) return false;
      return true;
    } catch (e) { return false; }
  }

  // ---- public ----------------------------------------------------------
  // item: {id, tint?}. Returns a cached PNG data-URL, or null to fall back.
  function get(item) {
    if (!item || !item.id) return null;
    // A custom imported .glb model takes priority over the procedural mesh.
    if (window.Models && Models.has(item.id)) {
      if (!Models.ready(item.id)) return null;         // still loading -> emoji fallback for now
      var mkey = 'model:' + item.id;
      if (cache[mkey] !== undefined) return cache[mkey];
      ensure();
      if (!ready) return null;
      try { cache[mkey] = renderObj(Models.get(item.id), -Math.PI / 4); }   // weapons: tilt the icon 45° to the left
      catch (e) { cache[mkey] = null; }
      return cache[mkey];
    }
    var f = FACT[item.id];
    if (!f) return null;
    var key = item.id + (item.tint != null ? (':' + item.tint) : '');
    if (cache[key] !== undefined) return cache[key];
    ensure();
    if (!ready) { return null; }   // headless / no WebGL -> emoji fallback (don't cache; may init later)
    try { cache[key] = renderObj(f(item.tint)); }
    catch (e) { cache[key] = null; }
    return cache[key];
  }
  function has(id) { return !!FACT[id] || (window.Models && Models.has(id)); }
  function invalidate(id) { delete cache['model:' + id]; }

  return { get: get, has: has, invalidate: invalidate };
})();
