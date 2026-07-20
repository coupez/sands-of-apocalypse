// ============================================================
// itemicons.js — auto-load custom inventory-item icons from the
// `itemicons/` folder (mirrors skillicons.js / models.js).
//
// Drop a PNG named after an item (its id OR its display name, e.g.
// "raw_fish.png", "Raw Sardine.png", "Copper Ore.png") into itemicons/
// and it replaces that item's icon everywhere in the game — inventory,
// equipment, smith menu, sell menu. See itemicons/README.md.
//
// Priority in ui.js: custom PNG (itemicons/) > procedural 3D render / .glb
// model (icons.js + models.js) > emoji fallback.
// ============================================================

var ItemIcons = (function () {
  var byKey = {};          // item id -> image URL
  var loaded = false;

  // normalize a name/filename to a comparison key: lowercase, letters+digits only
  function norm(s) {
    return String(s).replace(/\.[a-z0-9]+$/i, '')   // strip extension
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '');
  }

  // build alias -> item id from the live item roster (ids + display names).
  // Covers both plain items (Skills.ITEMS) and wearable gear (Skills.GEAR).
  function aliasMap() {
    var m = {};
    function add(table) {
      if (!table) return;
      for (var id in table) {
        if (!table.hasOwnProperty(id)) continue;
        m[norm(id)] = id;                               // internal id, e.g. "raw_fish"
        if (table[id] && table[id].name) m[norm(table[id].name)] = id;   // display name, e.g. "Raw Sardine"
      }
    }
    if (window.Skills) { add(Skills.ITEMS); add(Skills.GEAR); }
    return m;
  }

  function bind(files) {
    var m = aliasMap();
    byKey = {};
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var id = m[norm(f)];
      if (id) byKey[id] = 'itemicons/' + encodeURIComponent(f);
    }
    loaded = true;
    // refresh any UI that shows item icons so custom art swaps in immediately
    if (window.UI) {
      if (UI.updateInventory) UI.updateInventory();
      if (UI.updateEquipment) UI.updateEquipment();
    }
  }

  function init() {
    fetch('/__itemicons', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { bind((j && j.files) || []); })
      .catch(function () { /* offline / file:// — just use the built-in icons */ });
  }

  return {
    init: init,
    get: function (id) { return byKey[id] || null; },
    has: function (id) { return !!byKey[id]; },
    get loaded() { return loaded; }
  };
})();

ItemIcons.init();
