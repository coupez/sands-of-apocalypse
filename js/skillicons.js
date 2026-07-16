// ============================================================
// skillicons.js — auto-load custom pixel-art skill icons from the
// `skillicons/` folder (mirrors how models.js binds the models/ folder).
//
// Drop a PNG named after a skill (display name OR internal key, e.g.
// "Hit Points.png", "hitpoints.png", "faith.png") and it replaces that
// skill's icon in the Skills panel. See skillicons/README.md.
// ============================================================

var SkillIcons = (function () {
  var byKey = {};          // skill key -> image URL
  var loaded = false;

  // normalize a name/filename to a comparison key: lowercase, letters+digits only
  function norm(s) {
    return String(s).replace(/\.[a-z0-9]+$/i, '')   // strip extension
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '');
  }

  // extra synonyms an artist might use (alias -> skill key)
  var SYNONYMS = {
    defence: 'defense',
    hp: 'hitpoints', hitpoint: 'hitpoints', life: 'hitpoints', constitution: 'hitpoints',
    soul: 'spirit', mythical: 'spirit', mythicalfate: 'spirit', fate: 'spirit',
    foundry: 'casting', smelting: 'casting',
    woodcut: 'woodcutting', wc: 'woodcutting',
    fish: 'fishing', gather: 'fishing',
    smith: 'smithing', craft: 'smithing',
    cook: 'cooking', heal: 'cooking',
    range: 'ranged', archery: 'ranged',
    faith: 'prayer', pray: 'prayer'
  };

  // build alias -> skill key from the live skill roster (keys + display names)
  function aliasMap() {
    var m = {};
    if (window.Skills && Skills.data) {
      for (var k in Skills.data) {
        if (!Skills.data.hasOwnProperty(k)) continue;
        m[norm(k)] = k;                       // internal key, e.g. "prayer"
        m[norm(Skills.data[k].name)] = k;     // display name,  e.g. "faith"
      }
    }
    for (var a in SYNONYMS) if (SYNONYMS.hasOwnProperty(a)) m[norm(a)] = SYNONYMS[a];
    return m;
  }

  function bind(files) {
    var m = aliasMap();
    byKey = {};
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var key = m[norm(f)];
      if (key) byKey[key] = 'skillicons/' + encodeURIComponent(f);
    }
    loaded = true;
    // re-render the skills panel so custom icons swap in (if UI is up)
    if (window.UI && UI.buildSkills) { UI.buildSkills(); if (UI.updateSkills) UI.updateSkills(); }
  }

  function init() {
    fetch('/__skillicons', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { bind((j && j.files) || []); })
      .catch(function () { /* offline / file:// — just use built-in icons */ });
  }

  return {
    init: init,
    get: function (key) { return byKey[key] || null; },
    has: function (key) { return !!byKey[key]; },
    get loaded() { return loaded; }
  };
})();

SkillIcons.init();
