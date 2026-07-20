// ============================================================
// models.js — loads your own low-poly .glb models from models/ and
// makes them available to the game (as item icons + in-hand weapons).
// Any id with no model here falls back to the procedural mesh.
// ============================================================

var Models = (function () {
  // item id -> glb filename in models/. Filled automatically from the models/
  // folder (see idFromFile) so you can just drop a correctly-named .glb in.
  var FILES = {};
  // fallback used if the directory listing can't be fetched (e.g. file://)
  var DEFAULT_FILES = { bronze_dagger: 'Copper_Dagger.glb' };

  var loaded = {};     // id -> THREE.Object3D template | 'error'
  var pending = {};    // id -> true while the XHR is in flight
  var loader = null;
  var inited = false;
  // custom in-world mining-rock models, one per ore tier (0=copper..3=gold)
  var ROCK_FILES = ['MiningRocks/Copper_Rock.glb', 'MiningRocks/Iron_Rock.glb', 'MiningRocks/Silver_Rock.glb', 'MiningRocks/Gold_Rock.glb'];
  var rockLoaded = {};
  // custom player-character model (static; replaces the procedural boxes)
  var CHAR_FILE = 'PlayerCharacter/Player_Character_Test.glb';
  var charLoaded = null;
  var weaponTex = null;                          // shared UV atlas for ALL weapon models
  var WEAPON_TEX = 'Textures/WeaponsTextureSheet.png';
  // used to keep UV-less models visible (tier colour) until they're re-exported with UVs
  var TIER_COLOR = { bronze: 0xc87838, iron: 0x8a8f96, silver: 0xd8dce2, gold: 0xffd24a, tinakal: 0x5fe0d0 };

  // load the shared weapon texture; every weapon's UVs are mapped onto it
  function loadWeaponTex() {
    if (typeof THREE === 'undefined' || !THREE.TextureLoader) return;
    new THREE.TextureLoader().load(WEAPON_TEX, function (t) {
      t.flipY = false;                            // glTF UV convention (origin top-left)
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
      if (THREE.sRGBEncoding !== undefined) t.encoding = THREE.sRGBEncoding;
      weaponTex = t;
      for (var id in loaded) if (loaded.hasOwnProperty(id)) applyTex(loaded[id], id);   // re-skin models loaded first
      for (var id2 in loaded) if (window.Icons && Icons.invalidate) Icons.invalidate(id2);
      if (window.UI) { if (UI.updateInventory) UI.updateInventory(); if (UI.updateEquipment) UI.updateEquipment(); }
      if (window.Player && Player.refreshAppearance) Player.refreshAppearance();
    });
  }
  // Skin a weapon model with the shared atlas — but ONLY if the mesh actually has
  // UVs. Exports without UVs (or with the black "fallback Material") get a neutral
  // tier colour instead, so they're at least visible until re-exported with UVs.
  function applyTex(root, id) {
    if (!root || root === 'error') return;
    var tier = id && id.split('_')[0];
    var tint = (tier && TIER_COLOR[tier]) || 0xb9a06a;
    root.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      var hasUV = o.geometry && o.geometry.attributes && o.geometry.attributes.uv;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
        if (m.map) { if (m.color) m.color.set(0xffffff); }          // model ships its own (embedded) texture → keep it
        else if (weaponTex && hasUV) { m.map = weaponTex; if (m.color) m.color.set(0xffffff); }  // UVs but no texture → shared atlas
        else { if (m.color) m.color.setHex(tint); }                 // no UVs → visible tier colour
        m.side = THREE.DoubleSide;   // some exports have flipped normals → render both sides so they're never invisible
        m.needsUpdate = true;
      });
    });
  }

  // "Copper_Dagger.glb" -> "bronze_dagger", "Tin Akal Scimitar.glb" -> "tinakal_scimitar"
  function idFromFile(fn) {
    var s = fn.replace(/\.glb$/i, '').toLowerCase().replace(/[\s\-]+/g, '_').replace(/_+/g, '_');
    s = s.replace(/tin_?akal/g, 'tinakal');        // Tin Akal / tin-akal -> tinakal
    s = s.replace(/scim+it+ar/g, 'scimitar');      // Scimmitar / Scimitarr -> scimitar
    s = s.replace(/great_?sword/g, 'greatsword');  // Great Sword -> greatsword
    s = s.replace(/^copper(_|$)/, 'bronze$1');     // "Copper" is the game's bronze tier
    return s;
  }

  function init() {
    if (inited || typeof THREE === 'undefined' || !THREE.GLTFLoader) return;
    inited = true;
    loader = new THREE.GLTFLoader();
    loadWeaponTex();
    loadRocks();
    loadCharacter();
    fetch('/__models').then(function (r) { return r.json(); }).then(function (d) {
      (d.files || []).forEach(function (fn) { FILES[idFromFile(fn)] = fn; });
      for (var id in FILES) if (FILES.hasOwnProperty(id)) load(id);
    }).catch(function () {
      FILES = DEFAULT_FILES;
      for (var id in FILES) if (FILES.hasOwnProperty(id)) load(id);
    });
  }

  function load(id) {
    if (loaded[id] || pending[id] || !loader) return;
    pending[id] = true;
    loader.load('models/' + encodeURIComponent(FILES[id]), function (gltf) {
      pending[id] = false;
      var root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
      root.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
      applyTex(root, id);          // skin with the shared weapon atlas (or a tier colour if no UVs yet)
      loaded[id] = root;
      // the model arrived after the UI first rendered — refresh icons now
      if (window.Icons && Icons.invalidate) Icons.invalidate(id);
      if (window.UI) { if (UI.updateInventory) UI.updateInventory(); if (UI.updateEquipment) UI.updateEquipment(); }
      if (window.Player && Player.refreshAppearance) Player.refreshAppearance();
    }, undefined, function (err) {
      pending[id] = false; loaded[id] = 'error';
      if (window.console) console.warn('[Models] failed to load ' + id, err);
    });
  }

  function loadRocks() {
    ROCK_FILES.forEach(function (fn, tier) {
      loader.load('models/' + encodeURI(fn), function (gltf) {
        var root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        root.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
        applyTex(root, 'rock');   // keeps the embedded texture; forces DoubleSide
        rockLoaded[tier] = root;
        if (window.Entities && Entities.applyRockModels) Entities.applyRockModels();
      }, undefined, function () { if (window.console) console.warn('[Models] rock model failed: ' + fn); });
    });
  }
  function loadCharacter() {
    loader.load('models/' + encodeURI(CHAR_FILE), function (gltf) {
      var root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
      root.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
      applyTex(root, 'char');   // keeps the embedded texture; forces DoubleSide
      charLoaded = root;
      if (window.Player && Player.applyCharModel) Player.applyCharModel();
    }, undefined, function () { if (window.console) console.warn('[Models] character model failed'); });
  }

  return {
    init: init,
    has: function (id) { return !!FILES[id]; },
    ready: function (id) { return !!loaded[id] && loaded[id] !== 'error'; },
    // a fresh clone each call, so it can be rendered and/or attached independently
    get: function (id) {
      var t = loaded[id];
      return (t && t !== 'error') ? t.clone(true) : null;
    },
    getRock: function (tier) { var t = rockLoaded[tier]; return t ? t.clone(true) : null; },
    getCharacter: function () { return charLoaded ? charLoaded.clone(true) : null; }
  };
})();

// kick off loading immediately (scripts run at end of <body>, so THREE +
// GLTFLoader are ready); guarded so it's a no-op when GLTFLoader is absent.
Models.init();
