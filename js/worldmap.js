// ============================================================
// worldmap.js — Story Mode custom-world loader.
// Reads "world map/level.glb": every named node becomes a game object at that
// spot (name → spawner, handled in entities.js). No file → the default world.
// ============================================================

var WorldMap = (function () {
  var MAP_FILE = 'world map/level.glb';
  var done = false;

  function load() {
    if (done || typeof THREE === 'undefined' || !THREE.GLTFLoader) return;
    done = true;
    new THREE.GLTFLoader().load(encodeURI(MAP_FILE), function (gltf) {
      var nodes = [], root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
      if (root) root.traverse(function (o) {
        if (o === root || !o.name) return;
        o.updateWorldMatrix(true, false);
        var p = new THREE.Vector3(); o.getWorldPosition(p);
        var q = new THREE.Quaternion(); o.getWorldQuaternion(q);
        var e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
        nodes.push({ name: o.name, x: p.x, z: p.z, ry: e.y });
      });
      var n = (window.Entities && Entities.applyStoryMap) ? Entities.applyStoryMap(nodes) : 0;
      if (window.UI && UI.showActionText) UI.showActionText('Story map loaded — ' + n + ' objects placed.');
    }, undefined, function () {
      // no custom map yet — Story Mode just plays the default world
      if (window.UI && UI.showActionText) UI.showActionText('No "world map/level.glb" found — playing the default world. Build one to make your own map.');
    });
  }

  return { load: load };
})();
