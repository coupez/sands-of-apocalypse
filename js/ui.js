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

    el.skillsList = $('skills-list');
    el.equipGrid = $('equipment-grid');

    buildSkills();
    buildInventory();
    buildEquipment();
    wireTabs();
    updateVitals();
    updateSkills();
    updateInventory();
    updateEquipment();
    setActiveTab('inventory');   // default open panel
  }

  // ---------- right-side tab panels ----------
  var _activeTab = null;
  function wireTabs() {
    var btns = document.querySelectorAll('#tab-bar .tab-btn');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          // clicking the open tab again closes it
          setActiveTab(btn.getAttribute('data-tab') === _activeTab ? null : btn.getAttribute('data-tab'));
        });
      })(btns[i]);
    }
  }
  function setActiveTab(name) {
    _activeTab = name;
    var panels = document.querySelectorAll('#side-panels .side-panel');
    for (var i = 0; i < panels.length; i++) {
      panels[i].classList.toggle('open', panels[i].getAttribute('data-tab') === name);
    }
    var btns = document.querySelectorAll('#tab-bar .tab-btn');
    for (var j = 0; j < btns.length; j++) {
      btns[j].classList.toggle('active', btns[j].getAttribute('data-tab') === name);
    }
  }

  // ---------- equipment panel (head / body / legs / left+right hand) ----------
  // Empty slots stay blank; click a filled slot to unequip it.
  var EQUIP_UI = [
    { slot: 'head',  label: 'Head' },
    { slot: 'body',  label: 'Body' },
    { slot: 'legs',  label: 'Legs' },
    { slot: 'feet',  label: 'Feet' },
    { slot: 'lhand', label: 'Left Hand' },
    { slot: 'rhand', label: 'Right Hand' }
  ];
  function buildEquipment() {
    if (!el.equipGrid) return;
    el.equipGrid.innerHTML = '';
    el.equipSlots = {};
    for (var i = 0; i < EQUIP_UI.length; i++) {
      (function (def) {
        var slot = document.createElement('div');
        slot.className = 'equip-slot empty slot-' + def.slot;
        slot.title = def.label;
        slot.addEventListener('click', function () { Skills.unequip(def.slot); });
        el.equipGrid.appendChild(slot);
        el.equipSlots[def.slot] = slot;
      })(EQUIP_UI[i]);
    }
    updateEquipment();
  }
  function bonusText(g) {
    var b = g.bonus || {}, parts = [];
    if (g.instakill) parts.push('instakill');
    if (b.maxHit) parts.push('+' + b.maxHit + ' dmg');
    if (b.acc) parts.push('+' + Math.round(b.acc * 100) + '% acc');
    if (b.def) parts.push('+' + b.def + ' def');
    if (b.str) parts.push('+' + b.str + ' str');
    if (b.hp) parts.push('+' + b.hp + ' hp');
    return parts.length ? ' (' + parts.join(', ') + ')' : '';
  }
  function updateEquipment() {
    if (!el.equipSlots) return;
    for (var i = 0; i < EQUIP_UI.length; i++) {
      var def = EQUIP_UI[i];
      var slot = el.equipSlots[def.slot];
      var g = Game.equipment ? Skills.GEAR[Game.equipment[def.slot]] : null;
      if (g) {
        slot.className = 'equip-slot filled slot-' + def.slot;
        slot.textContent = g.icon;
        slot.title = g.name + bonusText(g) + ' — click to unequip';
      } else {
        slot.className = 'equip-slot empty slot-' + def.slot;
        slot.textContent = '';
        slot.title = def.label + ' (empty)';
      }
    }
  }

  // ---------- skills panel (built from Skills.SKILL_ORDER) ----------
  function buildSkills() {
    if (!el.skillsList) return;
    el.skillsList.innerHTML = '';
    var order = Skills.SKILL_ORDER;
    for (var i = 0; i < order.length; i++) {
      var k = order[i];
      var d = Skills.data[k];
      var row = document.createElement('div');
      row.className = 'skill-row';
      row.innerHTML =
        '<span class="skill-icon">' + d.icon + '</span>' +
        '<span class="skill-name">' + d.name + '</span>' +
        '<span class="skill-level"><b id="lvl-' + k + '">1</b>/' + (d.max || 99) + '</span>' +
        '<div class="xp-bar"><div class="xp-fill" id="xp-' + k + '"></div></div>';
      el.skillsList.appendChild(row);
    }
  }

  // ---------- inventory ----------
  function buildInventory() {
    el.invGrid.innerHTML = '';
    el.slots = [];
    for (var i = 0; i < Game.invMax; i++) {
      var slot = document.createElement('div');
      slot.className = 'inv-slot';
      addDragHandlers(slot, i);
      el.invGrid.appendChild(slot);
      el.slots.push(slot);
    }
  }

  // drag-and-drop: rearrange items into whatever slot you want
  var _dragFrom = null;
  function addDragHandlers(slot, index) {
    slot.setAttribute('draggable', 'true');
    slot.addEventListener('dragstart', function (e) {
      if (!Game.inventory[index]) { e.preventDefault(); return; } // nothing to drag
      _dragFrom = index;
      slot.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(index)); } catch (err) {}
      }
    });
    slot.addEventListener('dragend', function () {
      slot.classList.remove('dragging');
      _dragFrom = null;
      for (var i = 0; i < el.slots.length; i++) el.slots[i].classList.remove('drag-over');
    });
    slot.addEventListener('dragover', function (e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      slot.classList.add('drag-over');
    });
    slot.addEventListener('dragleave', function () { slot.classList.remove('drag-over'); });
    // left-click runs the item's primary action (equip gear / eat food)
    slot.addEventListener('click', function () {
      var it = Game.inventory[index];
      if (!it) return;
      if (Skills.isGear(it.id)) Skills.equipFromInventory(index);
      else if (Skills.isFood(it.id)) Skills.eat(index);
    });
    // right-click opens the item's action menu (Use/Equip/Eat + Drop)
    slot.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var it = Game.inventory[index];
      if (it) openItemMenu(e.clientX, e.clientY, index, it);
    });
    slot.addEventListener('drop', function (e) {
      e.preventDefault();
      slot.classList.remove('drag-over');
      var from = _dragFrom;
      if (from === null && e.dataTransfer) {
        var d = e.dataTransfer.getData('text/plain');
        from = (d === '' || d == null) ? null : parseInt(d, 10);
      }
      if (from === null || from === index) return;
      // swap the two slots (dropping onto an empty slot just moves the item)
      var inv = Game.inventory;
      var tmp = inv[index];
      inv[index] = inv[from];
      inv[from] = tmp;
      updateInventory();
    });
  }

  function updateInventory(poppedIndex) {
    if (!el.slots) return;
    var count = 0;
    for (var i = 0; i < Game.invMax; i++) {
      var slot = el.slots[i];
      var item = Game.inventory[i];
      if (item) {
        count++;
        slot.className = 'inv-slot filled' + (i === poppedIndex ? ' pop' : '');
        var countTag = (item.count > 1) ? '<span class="count">' + item.count + '</span>' : '';
        slot.innerHTML = countTag + item.icon;
        slot.title = item.name + (item.count > 1 ? ' x' + item.count : '') + ' — right-click for options';
      } else {
        slot.className = 'inv-slot';
        slot.innerHTML = '';
        slot.title = '';
      }
    }
    el.invCount.textContent = count + '/' + Game.invMax;
  }

  // ---------- right-click item action menu ----------
  var _menuEl = null;
  function ensureMenu() {
    if (_menuEl) return _menuEl;
    _menuEl = document.createElement('div');
    _menuEl.id = 'context-menu';
    _menuEl.style.display = 'none';
    document.body.appendChild(_menuEl);
    document.addEventListener('pointerdown', function (e) {
      if (_menuEl.style.display !== 'none' && !_menuEl.contains(e.target)) closeMenu();
    });
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
    window.addEventListener('blur', closeMenu);
    return _menuEl;
  }
  function closeMenu() { if (_menuEl) _menuEl.style.display = 'none'; }
  function openItemMenu(x, y, index, item) {
    var opts = [];
    // gear can be worn; food can be eaten; everything can be dropped
    if (Skills.isGear(item.id)) opts.push({ label: 'Wield ' + item.name, fn: function () { Skills.equipFromInventory(index); } });
    else if (Skills.isFood(item.id)) opts.push({ label: 'Eat ' + item.name, fn: function () { Skills.eat(index); } });
    opts.push({ label: 'Drop ' + item.name, fn: function () { Skills.dropItem(index); } });
    showContextMenu(x, y, opts);
  }
  function showContextMenu(x, y, opts) {
    var m = ensureMenu();
    m.innerHTML = '';
    for (var i = 0; i < opts.length; i++) {
      (function (o) {
        var b = document.createElement('div');
        b.className = 'ctx-item';
        b.textContent = o.label;
        b.addEventListener('click', function () { o.fn(); closeMenu(); });
        m.appendChild(b);
      })(opts[i]);
    }
    m.style.display = 'block';
    // clamp to stay on-screen
    m.style.left = '0px'; m.style.top = '0px';
    var rect = m.getBoundingClientRect();
    m.style.left = Math.min(x, window.innerWidth - rect.width - 4) + 'px';
    m.style.top = Math.min(y, window.innerHeight - rect.height - 4) + 'px';
  }

  // ---------- smithing menu (anvil) ----------
  var _smithEl = null;
  function ensureSmithMenu() {
    if (_smithEl) return _smithEl;
    _smithEl = document.createElement('div');
    _smithEl.id = 'smith-menu';
    _smithEl.style.display = 'none';
    document.body.appendChild(_smithEl);
    document.addEventListener('pointerdown', function (e) {
      if (_smithEl.style.display !== 'none' && !_smithEl.contains(e.target)) closeSmithMenu();
    });
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSmithMenu(); });
    return _smithEl;
  }
  function closeSmithMenu() { if (_smithEl) _smithEl.style.display = 'none'; }
  function openSmithMenu() {
    if (Game.headless) return;
    var m = ensureSmithMenu();
    m.innerHTML = '';
    var head = document.createElement('div');
    head.className = 'smith-title';
    head.innerHTML = 'What do you want to smith? <span class="smith-lvl">Smithing ' + Skills.data.smithing.level + '</span>';
    m.appendChild(head);
    var list = document.createElement('div'); list.className = 'smith-list'; m.appendChild(list);
    var recipes = Skills.SMITH_RECIPES;
    for (var i = 0; i < recipes.length; i++) {
      (function (r) {
        var why = Skills.canSmith(r);               // null = craftable, else reason
        var have = Skills.countItem(r.bar);
        var row = document.createElement('div');
        row.className = 'smith-item' + (why ? ' disabled' : '');
        row.innerHTML = '<span class="si-icon">' + r.icon + '</span>' +
          '<span class="si-name">' + r.name + '</span>' +
          '<span class="si-cost">' + r.bars + '× ' + r.barName + ' (' + have + ')</span>' +
          '<span class="si-note">' + (why || 'Smith') + '</span>';
        if (!why) row.addEventListener('click', function () {
          Skills.smith(r.id);
          openSmithMenu();   // refresh counts/availability so you can keep forging
        });
        list.appendChild(row);
      })(recipes[i]);
    }
    m.style.display = 'block';
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
    Skills.SKILL_ORDER.forEach(function (k) {
      var d = s[k];
      var lvlEl = $('lvl-' + k);
      var barEl = $('xp-' + k);
      if (lvlEl) lvlEl.textContent = d.level;
      if (barEl) {
        var mx = d.max || 99;
        var frac;
        if (d.level >= mx) { frac = 1; }                 // maxed → full bar
        else {
          var lo = Utils.xpForLevel(d.level);
          var hi = Utils.xpForLevel(Math.min(d.level + 1, mx));
          frac = hi > lo ? (d.xp - lo) / (hi - lo) : 1;
        }
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

  // ---------- floating camp nameplates ----------
  function updateCampLabels(camps) {
    if (Game.headless || !labelLayer || !camps) return;
    for (var i = 0; i < camps.length; i++) {
      var c = camps[i];
      if (!c._labelEl) {
        var d = document.createElement('div');
        d.className = 'entity-label camp';
        d.innerHTML = '<div class="nm" style="color:' + c.colorHex + '">🚩 ' + c.name + '</div>';
        labelLayer.appendChild(d);
        c._labelEl = d;
      }
      var s = toScreen(new THREE.Vector3(c.position.x, c.position.y + 5.2, c.position.z));
      if (!s) { c._labelEl.style.display = 'none'; continue; }
      c._labelEl.style.display = 'block';
      c._labelEl.style.left = s.x + 'px';
      c._labelEl.style.top = s.y + 'px';
    }
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
    updateInventory: updateInventory,
    updateEquipment: updateEquipment, setActiveTab: setActiveTab, toast: toast,
    openSmithMenu: openSmithMenu,
    showActionText: showActionText, setTarget: setTarget,
    spawnHitsplat: spawnHitsplat, spawnSpeech: spawnSpeech, updateLabels: updateLabels,
    updateCampLabels: updateCampLabels,
    flashDamage: flashDamage, hideBoot: hideBoot, setBootStatus: setBootStatus,
    showDeathScreen: showDeathScreen, hideDeathScreen: hideDeathScreen
  };
})();
