// ============================================================
// ui.js — HUD wiring: vitals, skills, inventory, hitsplats,
// floating entity labels/hp bars, toasts, action text, death screen
// ============================================================

var UI = (function () {
  var el = {};
  var hitLayer, labelLayer;
  var _actionTimer = null;
  var _targetTimer = null;

  function $(id) { return document.getElementById(id); }

  function init() {
    el.hpFill = $('hp-fill');
    el.hpNum = $('hp-num');
    el.hpGlobe = $('hp-globe');
    el.invGrid = $('inventory-grid');
    el.invCount = $('inv-count');
    el.actionText = $('action-text');
    el.target = $('target-readout');
    el.toastLayer = $('toast-layer');
    el.boot = $('boot');
    el.bootStatus = $('boot-status');
    el.death = $('death-screen');
    el.gameRoot = $('game-root');
    hitLayer = $('hitsplat-layer');
    labelLayer = $('label-layer');

    buildInventory();
    updateVitals();
    updateSkills();
    updateInventory();
  }

  // ---------- inventory ----------
  function buildInventory() {
    el.invGrid.innerHTML = '';
    el.slots = [];
    for (var i = 0; i < Game.invMax; i++) {
      var slot = document.createElement('div');
      slot.className = 'inv-slot';
      el.invGrid.appendChild(slot);
      el.slots.push(slot);
    }
  }

  function updateInventory(poppedIndex) {
    if (!el.slots) return;
    for (var i = 0; i < Game.invMax; i++) {
      var slot = el.slots[i];
      var item = Game.inventory[i];
      if (item) {
        slot.className = 'inv-slot filled' + (i === poppedIndex ? ' pop' : '');
        slot.innerHTML = '<span class="count">' + item.count + '</span>' + item.icon;
        slot.title = item.name + ' x' + item.count;
      } else {
        slot.className = 'inv-slot';
        slot.innerHTML = '';
        slot.title = '';
      }
    }
    el.invCount.textContent = Game.inventory.length + '/' + Game.invMax;
  }

  // ---------- vitals ----------
  function updateVitals() {
    var p = Game.player;
    if (!p) return;
    var hp = p.stats.hp, max = p.stats.maxHp;
    var pct = Utils.clamp(hp / max, 0, 1);
    el.hpFill.style.height = (pct * 100) + '%';
    el.hpNum.textContent = Math.ceil(hp);
    if (pct <= 0.34) el.hpGlobe.classList.add('low'); else el.hpGlobe.classList.remove('low');
  }

  // ---------- skills ----------
  function updateSkills() {
    var s = Skills.data;
    ['woodcutting', 'mining', 'attack'].forEach(function (k) {
      var d = s[k];
      var lvlEl = $('lvl-' + k);
      var barEl = $('xp-' + k);
      if (lvlEl) lvlEl.textContent = d.level;
      if (barEl) {
        var lo = Utils.xpForLevel(d.level);
        var hi = Utils.xpForLevel(Math.min(d.level + 1, 99));
        var frac = hi > lo ? (d.xp - lo) / (hi - lo) : 1;
        barEl.style.width = Utils.clamp(frac, 0, 1) * 100 + '%';
      }
    });
  }

  function toast(skillName, level) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = 'LEVEL UP!<small>' + skillName + ' &rarr; level ' + level + '</small>';
    el.toastLayer.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2700);
  }

  // ---------- action / target text ----------
  function showActionText(txt) {
    if (!el.actionText) return;
    el.actionText.textContent = txt;
    el.actionText.classList.add('show');
    clearTimeout(_actionTimer);
    _actionTimer = setTimeout(function () { el.actionText.classList.remove('show'); }, 1600);
  }

  function setTarget(txt) {
    if (!el.target) return;
    if (txt) {
      el.target.textContent = txt;
      el.target.classList.add('show');
    } else {
      el.target.classList.remove('show');
    }
  }

  // ---------- hitsplats ----------
  function toScreen(vec) {
    var cam = Game.camera;
    if (!cam) return null;
    var v = vec.clone().project(cam);
    if (v.z > 1) return null; // behind camera
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight
    };
  }

  function spawnHitsplat(worldVec, amount, type) {
    if (Game.headless || !hitLayer) return;
    var s = toScreen(worldVec);
    if (!s) return;
    var d = document.createElement('div');
    d.className = 'hitsplat ' + (type || 'hit');
    d.textContent = amount;
    d.style.left = s.x + 'px';
    d.style.top = s.y + 'px';
    hitLayer.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 1100);
  }

  // ---------- floating speech bubble (world-anchored, one-shot) ----------
  function spawnSpeech(worldVec, text) {
    if (Game.headless || !labelLayer) return;
    var s = toScreen(worldVec);
    if (!s) return;
    var d = document.createElement('div');
    d.className = 'speech-bubble';
    d.textContent = text;
    d.style.left = s.x + 'px';
    d.style.top = s.y + 'px';
    labelLayer.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 2200);
  }

  // ---------- floating enemy labels / hp bars ----------
  function updateLabels(enemies) {
    if (Game.headless || !labelLayer) return;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (!e._labelEl) {
        var lab = document.createElement('div');
        lab.className = 'entity-label';
        lab.innerHTML = '<div class="nm">' + e.name + '</div><div class="entity-hpbar"><i></i></div>';
        labelLayer.appendChild(lab);
        e._labelEl = lab;
        e._hpFill = lab.querySelector('i');
      }
      var visible = e.active && e.state !== 'dead' && e.state !== 'respawning';
      if (!visible) { e._labelEl.style.display = 'none'; continue; }
      var top = new THREE.Vector3(e.position.x, e.position.y + 3.0, e.position.z);
      var s = toScreen(top);
      if (!s) { e._labelEl.style.display = 'none'; continue; }
      e._labelEl.style.display = 'block';
      e._labelEl.style.left = s.x + 'px';
      e._labelEl.style.top = s.y + 'px';
      e._hpFill.style.width = Utils.clamp(e.hp / e.maxHp, 0, 1) * 100 + '%';
    }
  }

  // ---------- flashes / screens ----------
  function flashDamage() {
    if (!el.gameRoot) return;
    el.gameRoot.classList.remove('damage-flash');
    void el.gameRoot.offsetWidth; // reflow to restart animation
    el.gameRoot.classList.add('damage-flash');
  }

  function hideBoot() { if (el.boot) el.boot.classList.add('hidden'); }
  function setBootStatus(t) { if (el.bootStatus) el.bootStatus.textContent = t; }
  function showDeathScreen() { if (el.death) el.death.classList.add('show'); }
  function hideDeathScreen() { if (el.death) el.death.classList.remove('show'); }

  return {
    init: init,
    updateVitals: updateVitals, updateSkills: updateSkills,
    updateInventory: updateInventory, toast: toast,
    showActionText: showActionText, setTarget: setTarget,
    spawnHitsplat: spawnHitsplat, spawnSpeech: spawnSpeech, updateLabels: updateLabels,
    flashDamage: flashDamage, hideBoot: hideBoot, setBootStatus: setBootStatus,
    showDeathScreen: showDeathScreen, hideDeathScreen: hideDeathScreen
  };
})();
