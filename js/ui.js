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
  function hex6(c) { return '#' + ('000000' + c.toString(16)).slice(-6); }
  // an item's icon: a low-poly rendered image if we have a mesh for it,
  // else the emoji (tinted to its tier colour if it has one).
  function iconHtml(item) {
    if (!item) return '';
    // custom drop-in PNG (itemicons/) wins over the procedural render / model
    var custom = (window.ItemIcons && item.id) ? ItemIcons.get(item.id) : null;
    if (custom) return '<img class="ico" draggable="false" src="' + custom + '" alt="">';
    var url = (typeof Icons !== 'undefined' && Icons.get) ? Icons.get(item) : null;
    if (url) return '<img class="ico" draggable="false" src="' + url + '" alt="">';
    return item.tint ? '<span style="color:' + hex6(item.tint) + '">' + item.icon + '</span>' : item.icon;
  }

  function init() {
    el.hpFill = $('hp-fill');
    el.hpNum = $('hp-num');
    el.hpGlobe = $('hp-globe');
    el.invGrid = $('inventory-grid');
    el.invCount = $('inv-count');
    el.invGoldNum = $('inv-gold-num');
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
    el.goldNum = $('gold-num');
    el.runBtn = $('run-btn');
    el.energyPct = $('energy-pct');
    if (el.runBtn) el.runBtn.addEventListener('click', function () {
      if (window.Player && Game.player) Player.toggleRun();
      updateVitals();
    });
    wireChat();

    buildSkills();
    wireSkillTiles();
    buildInventory();
    buildEquipment();
    wireTabs();
    updateVitals();
    updateSkills();
    updateInventory();
    updateEquipment();
    updateGold();
    setActiveTab('inventory');   // default open panel
    // a couple of greeter lines so the chat box isn't blank (replaces the old hint bar)
    appendChat(null, 'Left-click to move & interact · Middle-drag to orbit · Press Enter to chat.');
  }

  function updateGold() {
    var g = Game.gold || 0;
    if (el.goldNum) el.goldNum.textContent = g;
    if (el.invGoldNum) el.invGoldNum.textContent = g;
  }

  // ---------- versus scoreboard: relic altars + your points ----------
  var _vsHud = null;
  function updateScore() {
    if (Game.headless) return;
    if (Game.mode !== 'versus') { if (_vsHud) _vsHud.style.display = 'none'; return; }
    if (!_vsHud) { _vsHud = document.createElement('div'); _vsHud.id = 'versus-hud'; document.body.appendChild(_vsHud); }
    _vsHud.style.display = 'block';
    var altars = (window.Entities && Entities.essAltars) ? Entities.essAltars : [];
    var html = '<div class="vh-head">RELIC ALTARS <span>' + (Game.score || 0) + ' pts</span></div>';
    for (var i = 0; i < altars.length; i++) {
      var a = altars[i];
      html += '<div class="vh-row' + (a.claimedBy ? ' claimed' : '') + '"><span class="vh-nm">' + String(a.name).replace(/</g, '&lt;') + '</span>' +
        '<span class="vh-st">' + (a.claimedBy ? ('✓ ' + String(a.claimedName || '').replace(/</g, '&lt;')) : 'open') + '</span></div>';
    }
    _vsHud.innerHTML = html;
  }

  // ---------- right-side tab panels ----------
  var _activeTab = null;
  // a pixel-art <img> for a UI glyph, or '' if unavailable (keeps emoji fallback)
  function pixImg(name) { var u = window.PixelIcons && PixelIcons.get(name); return u ? '<img class="pixel-icon" src="' + u + '" alt="">' : ''; }
  var TAB_SPRITE = { inventory: 'bag', skills: 'skills', equipment: 'equip' };

  function wireTabs() {
    var btns = document.querySelectorAll('#tab-bar .tab-btn[data-tab]');
    for (var t = 0; t < btns.length; t++) {   // swap emoji glyphs for pixel art
      var sp = TAB_SPRITE[btns[t].getAttribute('data-tab')], img = sp && pixImg(sp);
      if (img) btns[t].innerHTML = img;
    }
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          // clicking the open tab again closes it
          setActiveTab(btn.getAttribute('data-tab') === _activeTab ? null : btn.getAttribute('data-tab'));
        });
      })(btns[i]);
    }
    // music mute toggle (not a panel tab)
    var mb = document.getElementById('music-btn');
    if (mb) {
      var mi = pixImg('music'); if (mi) mb.innerHTML = mi;
      mb.addEventListener('click', function () {
        var on = window.Ambient ? Ambient.toggle() : false;
        var img = pixImg(on ? 'music' : 'musicoff');
        if (img) mb.innerHTML = img; else mb.textContent = on ? '🔊' : '🔇';
        mb.classList.toggle('muted', !on);
        mb.title = on ? 'Music: on (click to mute)' : 'Music: muted (click to unmute)';
      });
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
        slot.addEventListener('mousemove', function (e) {
          var g = Game.equipment ? Skills.GEAR[Game.equipment[def.slot]] : null;
          if (g) showSkillTip(g.name + bonusText(g), e.clientX, e.clientY); else showSkillTip(def.label + ' (empty)', e.clientX, e.clientY);
        });
        slot.addEventListener('mouseleave', hideSkillTip);
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
        slot.innerHTML = iconHtml(g);
        slot.title = g.name + bonusText(g) + ' — click to unequip';
      } else {
        slot.className = 'equip-slot empty slot-' + def.slot;
        slot.textContent = '';
        slot.title = def.label + ' (empty)';
      }
    }
  }

  // ---------- skills panel (RuneScape-style: 3 category columns of icon tiles) ----------
  // Each skill is a compact tile — just the icon with its level in the corner
  // (no name). Icon priority: custom art (skillicons/) > built-in pixel > emoji.
  function skillIconHtml(k, d) {
    var custom = (window.SkillIcons && SkillIcons.get(k));
    if (custom) return '<img class="tile-ico pixel" src="' + custom + '" alt="">';
    var pu = (window.PixelIcons && PixelIcons.get(k));
    if (pu) return '<img class="tile-ico pixel" src="' + pu + '" alt="">';
    return '<span class="tile-ico">' + d.icon + '</span>';
  }
  function buildSkills() {
    if (!el.skillsList) return;
    el.skillsList.innerHTML = '';
    var cats = Skills.CATEGORIES;
    // all columns fill to the tallest category so the grid is full; short columns
    // get grayed placeholder boxes ("skills still to come").
    var rows = 0;
    for (var r = 0; r < cats.length; r++) rows = Math.max(rows, cats[r].skills.length);
    for (var c = 0; c < cats.length; c++) {
      var cat = cats[c];
      var col = document.createElement('div');
      col.className = 'skill-cat';
      // header is a single line: category name on the left, its total level on the right
      var head =
        '<div class="cat-head">' +
          '<span class="cat-name">' + cat.name + '</span>' +
          '<span class="cat-total" id="cat-' + cat.key + '"' + (cat.key === 'combat' ? ' data-formula="1"' : '') + '>0</span>' +
        '</div>';
      var tiles = '';
      for (var i = 0; i < cat.skills.length; i++) {
        var k = cat.skills[i];
        var d = Skills.data[k];
        if (!d) continue;
        // full-width box: icon on the left, level on the right; clickable + hoverable
        tiles +=
          '<div class="skill-tile' + (d.soon ? ' soon' : '') + '" data-skill="' + k + '">' +
            skillIconHtml(k, d) +
            '<span class="tile-lvl" id="lvl-' + k + '">1</span>' +
          '</div>';
      }
      for (var p = cat.skills.length; p < rows; p++) tiles += '<div class="skill-tile placeholder"></div>';
      col.innerHTML = head + '<div class="cat-grid">' + tiles + '</div>';
      el.skillsList.appendChild(col);
    }
  }

  // thousands separator, e.g. 12345 -> "12,345"
  function fmtXp(n) { return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  // hover text: current xp and xp needed to reach the next level
  function skillTipText(k) {
    var d = Skills.data[k];
    if (!d) return '';
    var cur = Math.floor(d.xp), mx = d.max || 99;
    if (d.level >= mx) return d.name + ' — Lv ' + d.level + ' (MAX)  ·  ' + fmtXp(cur) + ' XP';
    var next = Utils.xpForLevel(d.level + 1);
    return d.name + ' — Lv ' + d.level + '  ·  ' + fmtXp(cur) + ' / ' + fmtXp(next) + ' XP  ·  ' +
      fmtXp(Math.max(0, next - cur)) + ' to next' + (d.soon ? '  (not trainable yet)' : '');
  }
  // click a skill box -> open its (empty for now) panel; hover -> XP tooltip.
  // Delegated on the skills-list container so it survives buildSkills() rebuilds.
  // dedicated tooltip for skill boxes — a SEPARATE element from the world-hover
  // #cursor-tooltip, so the per-frame world hover loop can't hide it (that was the
  // flicker). Sits just above the cursor so it never overlaps the box it describes.
  var _skillTipEl = null;
  function skillTipEl() {
    if (_skillTipEl) return _skillTipEl;
    _skillTipEl = document.createElement('div');
    _skillTipEl.id = 'skill-tip';
    _skillTipEl.style.display = 'none';
    document.body.appendChild(_skillTipEl);
    return _skillTipEl;
  }
  function showSkillTip(text, x, y) {
    if (Game.headless || !text) { hideSkillTip(); return; }
    var t = skillTipEl();
    t.textContent = text;
    t.style.display = 'block';
    var w = t.offsetWidth || 160, h = t.offsetHeight || 24;
    t.style.left = Math.min(Math.max(6, x - w / 2), window.innerWidth - w - 6) + 'px';
    t.style.top = Math.max(6, y - h - 12) + 'px';
  }
  function hideSkillTip() { if (_skillTipEl) _skillTipEl.style.display = 'none'; }

  var _skillTilesWired = false;
  function wireSkillTiles() {
    if (_skillTilesWired || !el.skillsList) return;
    _skillTilesWired = true;
    el.skillsList.addEventListener('click', function (e) {
      var tile = e.target.closest ? e.target.closest('.skill-tile') : null;
      if (tile) openSkillMenu(tile.getAttribute('data-skill'));
    });
    // show on enter/move over any part of a box (or the Combat total → formula);
    // hide only when leaving. placeholders have no data-skill so they show nothing.
    function tipFor(e) {
      var total = e.target.closest ? e.target.closest('.cat-total[data-formula]') : null;
      if (total) return Skills.COMBAT_FORMULA_TEXT;
      var tile = e.target.closest ? e.target.closest('.skill-tile') : null;
      var k = tile && tile.getAttribute('data-skill');
      return k ? skillTipText(k) : null;
    }
    el.skillsList.addEventListener('mouseover', function (e) { var t = tipFor(e); if (t) showSkillTip(t, e.clientX, e.clientY); else hideSkillTip(); });
    el.skillsList.addEventListener('mousemove', function (e) { var t = tipFor(e); if (t) showSkillTip(t, e.clientX, e.clientY); else hideSkillTip(); });
    el.skillsList.addEventListener('mouseleave', function () { hideSkillTip(); });
  }

  // ---------- skill detail panel (opens like the smith menu) ----------
  // Attack lists the weapon tiers you can wield; Defense the armour tiers. Tiers
  // above your level are shown blurred/locked. Other skills are empty for now.
  function buildGearReqList(key) {
    var isAtk = key === 'attack';
    var noun = isAtk ? 'Weaponry' : 'Armour';
    var repType = isAtk ? 'scimitar' : 'platebody';   // representative piece shown per tier
    var lvl = Skills.data[key].level;
    var metals = Skills.METALS || [];
    var wrap = document.createElement('div');
    wrap.className = 'req-list';
    for (var j = 0; j < metals.length; j++) {
      var M = metals[j], unlocked = lvl >= (M.req || 1);
      var gear = Skills.GEAR[M.key + '_' + repType];
      var row = document.createElement('div');
      row.className = 'req-row ' + (unlocked ? 'unlocked' : 'locked');
      // left: required level · centre: tier name · right: the weapon/armour icon
      row.innerHTML = '<span class="req-lvl">' + (M.req || 1) + '</span>' +
        '<span class="req-name">' + M.name + ' ' + noun + '</span>' +
        '<span class="req-ico">' + (gear ? iconHtml(gear) : '') + '</span>';
      wrap.appendChild(row);
    }
    return wrap;
  }
  // gathering skills show WHAT you can harvest at each level (ore/wood/plant tiers),
  // same layout as the gear list: req level · resource name · item icon, locked blurred.
  function skillResourceTiers(key) {
    if (!window.Entities) return null;
    if (key === 'mining') return (Entities.ROCK_TIERS || []).concat([{ name: 'Meteorite (Tin Akal)', reqLevel: 12, itemId: 'tinakal' }]);
    if (key === 'woodcutting') return Entities.TREE_TIERS || null;
    if (key === 'fishing') return Entities.FISH_TIERS || null;
    // Casting = smelt/cast metal bars; each tier needs the SAME level as mining that ore.
    if (key === 'casting') {
      var rocks = Entities.ROCK_TIERS || [], metals = Skills.METALS || [], out = [];
      for (var m = 0; m < metals.length; m++) {
        var M = metals[m], req = (M.key === 'tinakal') ? 12 : (rocks[m] ? rocks[m].reqLevel : 1);
        out.push({ reqLevel: req, name: M.name + ' Bar', itemId: M.bar });
      }
      return out;
    }
    // Herbalism (cooking) = cook harvested foods; req mirrors the harvest level.
    if (key === 'cooking') {
      var fish = Entities.FISH_TIERS || [], COOK = Skills.COOK || {}, foods = [];
      for (var f = 0; f < fish.length; f++) {
        var cooked = COOK[fish[f].itemId], it = Skills.ITEMS[cooked];
        foods.push({ reqLevel: fish[f].reqLevel, name: it ? it.name : cooked, itemId: cooked });
      }
      return foods;
    }
    return null;
  }
  function buildResourceTierList(key, tiers) {
    var lvl = Skills.data[key].level;
    var wrap = document.createElement('div');
    wrap.className = 'req-list';
    for (var i = 0; i < tiers.length; i++) {
      var T = tiers[i], unlocked = lvl >= (T.reqLevel || 1);
      var item = Skills.ITEMS[T.itemId];
      var row = document.createElement('div');
      row.className = 'req-row ' + (unlocked ? 'unlocked' : 'locked');
      row.innerHTML = '<span class="req-lvl">' + (T.reqLevel || 1) + '</span>' +
        '<span class="req-name">' + T.name + '</span>' +
        '<span class="req-ico">' + (item ? iconHtml(item) : '') + '</span>';
      wrap.appendChild(row);
    }
    return wrap;
  }
  function openSkillMenu(key) {
    if (Game.headless) return;
    var d = Skills.data[key];
    if (!d) return;
    _sellSession = null;
    var m = ensureSmithMenu();
    m.innerHTML = '';
    var head = document.createElement('div');
    head.className = 'smith-title skill-title';
    head.textContent = d.name;                 // just the skill name, centred (no Lv x/20)
    m.appendChild(head);
    var body = document.createElement('div');
    body.className = 'skill-menu-body';
    var resTiers = skillResourceTiers(key);
    if (key === 'attack' || key === 'defense') body.appendChild(buildGearReqList(key));
    else if (resTiers) body.appendChild(buildResourceTierList(key, resTiers));
    else body.innerHTML = '<div class="skill-menu-empty">Nothing here yet.</div>';
    m.appendChild(body);
    m.style.display = 'block';
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
  // "use item on item" crafting: the index of the currently-selected item (white outline)
  var _combineSel = null;
  function setCombineSel(index) { _combineSel = index; updateInventory(); }
  function clearCombineSel() { if (_combineSel !== null) { _combineSel = null; updateInventory(); } }
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
    // custom hover tooltip naming the item (+ bonuses for gear)
    slot.addEventListener('mousemove', function (e) {
      var it = Game.inventory[index];
      if (!it) { hideSkillTip(); return; }
      var tip = it.name + (Skills.isGear(it.id) ? bonusText(Skills.GEAR[it.id]) : '');
      showSkillTip(tip, e.clientX, e.clientY);
    });
    slot.addEventListener('mouseleave', hideSkillTip);
    // left-click: primary action (equip/eat/…) OR select-to-combine for items with none
    slot.addEventListener('click', function () {
      var it = Game.inventory[index];
      if (!it) { clearCombineSel(); return; }
      // second click of a combine: use the selected item on this one
      if (_combineSel !== null && _combineSel !== index) {
        var made = Skills.combine(_combineSel, index);
        if (!made && window.UI) UI.showActionText('Nothing interesting happens.');
        clearCombineSel();
        return;
      }
      // items with a primary use act immediately (and cancel any selection)
      if (Skills.hasPrimaryUse(it.id)) {
        clearCombineSel();
        if (Skills.isGear(it.id)) Skills.equipFromInventory(index);
        else if (Skills.isFood(it.id)) Skills.eat(index);
        else if (Skills.isBones(it.id)) Skills.bury(index);
        else if (Skills.isEnchant(it.id)) Skills.useEnchant(index);
        return;
      }
      // no primary use → toggle the white-outline selection so it can be used on another item
      if (_combineSel === index) clearCombineSel();
      else setCombineSel(index);
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
        slot.className = 'inv-slot filled' + (i === poppedIndex ? ' pop' : '') + (i === _combineSel ? ' combine-sel' : '');
        var countTag = (item.count > 1) ? '<span class="count">' + item.count + '</span>' : '';
        slot.innerHTML = countTag + iconHtml(item);
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
    else if (Skills.isBones(item.id)) opts.push({ label: 'Bury ' + item.name + ' (Prayer)', fn: function () { Skills.bury(index); } });
    else if (Skills.isEnchant(item.id)) opts.push({ label: 'Use ' + item.name, fn: function () { Skills.useEnchant(index); } });
    // "Use" starts a combine (works for any item, even ones with a primary use)
    opts.push({ label: 'Use ' + item.name, fn: function () { setCombineSel(index); } });
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
  var _sellSession = null;
  function closeSmithMenu() {
    if (_smithEl) _smithEl.style.display = 'none';
    // if this was a merchant visit and something was sold, send the caravan off
    if (_sellSession && _sellSession.sold && window.Entities) Entities.sendCaravan(_sellSession.ent);
    _sellSession = null;
  }
  // remembers which metal tab you were on between opens
  var _smithMetal = null;
  var _WOOD_IDS = ['log', 'palmwood', 'blog', 'elderwood'];
  function woodCount() { var n = 0; for (var i = 0; i < _WOOD_IDS.length; i++) n += Skills.countItem(_WOOD_IDS[i]); return n; }
  function openSmithMenu(anvilLevel) {
    if (Game.headless) return;
    _sellSession = null;
    anvilLevel = anvilLevel || 1;
    var metals = Skills.METALS;
    if (!_smithMetal) _smithMetal = metals[0].key;
    var m = ensureSmithMenu();
    m.innerHTML = '';
    var head = document.createElement('div');
    head.className = 'smith-title';
    head.innerHTML = 'Smithing <span class="smith-lvl">Anvil Lv ' + anvilLevel + '</span>';
    m.appendChild(head);

    // metal tab bar — pick a metal, see its gear below. Higher metals show a lock
    // until the anvil is upgraded to their tier.
    var tabs = document.createElement('div'); tabs.className = 'smith-tabs';
    for (var mi = 0; mi < metals.length; mi++) {
      (function (M) {
        var locked = anvilLevel < M.level;
        var tab = document.createElement('div');
        tab.className = 'smith-tab' + (M.key === _smithMetal ? ' active' : '') + (locked ? ' locked' : '');
        tab.style.borderColor = hex6(M.color);
        tab.innerHTML = '<span class="mt-dot" style="background:' + hex6(M.color) + '"></span>' + M.name + (locked ? ' 🔒' : '');
        tab.addEventListener('click', function () { _smithMetal = M.key; openSmithMenu(anvilLevel); });
        tabs.appendChild(tab);
      })(metals[mi]);
    }
    m.appendChild(tabs);

    var list = document.createElement('div'); list.className = 'smith-list'; m.appendChild(list);
    var recipes = Skills.SMITH_RECIPES.filter(function (r) { return r.id.indexOf(_smithMetal + '_') === 0; });
    for (var i = 0; i < recipes.length; i++) {
      (function (r) {
        var why = Skills.canSmith(r, anvilLevel);   // null = craftable, else reason
        var have = Skills.countItem(r.bar);
        var row = document.createElement('div');
        row.className = 'smith-item' + (why ? ' disabled' : '');
        // everything above the base (copper) tier stays blurred until you've forged it (no spoilers)
        var hiddenTier = (r.level > 1) && !(Game.craftedWeapons && Game.craftedWeapons[r.id]);
        row.innerHTML = '<span class="si-icon' + (hiddenTier ? ' hidden-tier' : '') + '">' + iconHtml(r) + '</span>' +
          '<span class="si-name">' + r.name + '</span>' +
          '<span class="si-cost">' + r.bars + '× ' + r.barName + ' (' + have + ')' +
            (r.wood ? ' + ' + (r.woodN || 1) + '× ' + r.woodName : '') +
            (r.prev ? ' + ' + r.prevName : '') + '</span>' +
          '<span class="si-note">' + (why || 'Smith') + '</span>';
        if (!why) row.addEventListener('click', function () {
          Skills.smith(r.id, anvilLevel);
          openSmithMenu(anvilLevel);   // refresh counts/availability so you can keep forging
        });
        list.appendChild(row);
      })(recipes[i]);
    }

    // fletching bench: a ranged Desert Longbow from any 2 logs (always available)
    var wc = woodCount();
    var bow = document.createElement('div');
    bow.className = 'smith-item fletch' + (wc < 2 ? ' disabled' : '');
    bow.innerHTML = '<span class="si-icon">🏹</span>' +
      '<span class="si-name">Desert Longbow</span>' +
      '<span class="si-cost">2× Logs (' + wc + ')</span>' +
      '<span class="si-note">' + (wc < 2 ? 'Needs 2 logs' : 'Fletch a ranged bow') + '</span>';
    if (wc >= 2) bow.addEventListener('click', function () { Skills.craftBow(); openSmithMenu(anvilLevel); });
    list.appendChild(bow);

    m.style.display = 'block';
  }

  // ---------- co-op build menu ----------
  function openBuildMenu() {
    if (Game.headless || !window.Coop) return;
    var m = ensureSmithMenu();
    m.innerHTML = '';
    var head = document.createElement('div');
    head.className = 'smith-title';
    head.innerHTML = 'Build <span class="smith-lvl">construct in the world (B)</span>';
    m.appendChild(head);
    var list = document.createElement('div'); list.className = 'smith-list'; m.appendChild(list);
    var bps = Coop.BLUEPRINTS || [];
    for (var i = 0; i < bps.length; i++) {
      (function (bp) {
        var can = Object.keys(bp.cost).every(function (k) { return Skills.countItem(k) >= bp.cost[k]; });
        var costStr = Object.keys(bp.cost).map(function (k) { return bp.cost[k] + '× ' + (Skills.ITEMS[k] ? Skills.ITEMS[k].name : k) + ' (' + Skills.countItem(k) + ')'; }).join(', ');
        var row = document.createElement('div');
        row.className = 'smith-item' + (can ? '' : ' disabled');
        row.innerHTML = '<span class="si-icon">' + bp.icon + '</span><span class="si-name">' + bp.name + '</span>' +
          '<span class="si-cost">' + costStr + '</span><span class="si-note">' + (can ? 'Build' : 'Need materials') + '</span>';
        if (can) row.addEventListener('click', function () { Coop.build(bp.id); closeSmithMenu(); });
        list.appendChild(row);
      })(bps[i]);
    }
    m.style.display = 'block';
  }

  // ---------- merchant sell menu (an inventory-grid you sell from) ----------
  function openSellMenu(merchantEnt) {
    if (Game.headless) return;
    _sellSession = { ent: merchantEnt, sold: false };
    var name = (merchantEnt.camel && merchantEnt.camel.name) || 'the merchant';
    var m = ensureSmithMenu();
    function render() {
      m.innerHTML = '';
      var pending = (merchantEnt.camel && merchantEnt.camel.pending) || 0;
      var head = document.createElement('div');
      head.className = 'smith-title';
      head.innerHTML = 'Sell to ' + name.replace(/</g, '&lt;') +
        ' <span class="smith-lvl">🪙 ' + (Game.gold || 0) + (pending ? '  (+' + pending + ' pending)' : '') + '</span>';
      m.appendChild(head);
      var hint = document.createElement('div');
      hint.className = 'sell-hint';
      hint.textContent = 'Click an item to load it onto the caravan — you are paid when it returns.';
      m.appendChild(hint);
      var grid = document.createElement('div'); grid.id = 'sell-grid'; m.appendChild(grid);
      for (var i = 0; i < Game.invMax; i++) {
        (function (index) {
          var it = Game.inventory[index];
          var v = it ? Skills.sellValue(it.id) : 0;
          var slot = document.createElement('div');
          slot.className = 'inv-slot' + (it ? ' filled' : '') + (v > 0 ? ' sellable' : '');
          if (it) {
            slot.innerHTML = iconHtml(it) + (v > 0 ? '<span class="sell-val">' + v + '</span>' : '');
            slot.title = it.name + (v > 0 ? ' — sell for ' + v + ' gold' : ' — the merchant won\'t buy that');
          }
          if (it && v > 0) slot.addEventListener('click', function () {
            if (Entities.sellToMerchant(merchantEnt, index)) { _sellSession.sold = true; render(); }
          });
          grid.appendChild(slot);
        })(i);
      }
      m.style.display = 'block';
    }
    render();
  }

  // ---------- station upgrade menu (right-click a camp station/pond) ----------
  function openStationMenu(x, y, ent) {
    var cost = Entities.upgradeCost(ent);
    var opts = [];
    if (ent.type === 'station' && ent.kind !== 'merchant') opts.push({ label: 'Use ' + ent.name, fn: function () { if (window.Player && Game.player) Player.interactWith(ent); } });
    if (cost) {
      var costStr = (cost.gold ? cost.gold + ' gold' : '');
      if (cost.items) for (var id in cost.items) costStr += (costStr ? ' + ' : '') + cost.items[id] + '× ' + Skills.ITEMS[id].name;
      opts.push({ label: 'Upgrade to Lv ' + (ent.level + 1) + ' (' + costStr + ')', fn: function () { Entities.upgradeStation(ent); } });
    } else if (ent.maxLevel > 1) {
      opts.push({ label: ent.name + ' — max level', fn: function () {} });
    }
    if (opts.length) showContextMenu(x, y, opts);
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
    // run energy percentage + toggle-button state
    if (el.energyPct && p.maxEnergy) {
      var ep = Utils.clamp(p.energy / p.maxEnergy, 0, 1);
      el.energyPct.textContent = Math.round(ep * 100) + '%';
      el.energyPct.classList.toggle('spent', ep <= 0.05);
    }
    if (el.runBtn) {
      el.runBtn.classList.toggle('active', !!p.running);
      el.runBtn.classList.toggle('empty', (p.energy || 0) <= 1);
    }
  }

  // ---------- skills ----------
  function updateSkills() {
    var s = Skills.data;
    Skills.SKILL_ORDER.forEach(function (k) {
      var d = s[k];
      var lvlEl = $('lvl-' + k);
      if (lvlEl) lvlEl.textContent = d.level;
    });
    // category totals = sum of member skill levels
    Skills.CATEGORIES.forEach(function (cat) {
      var t = $('cat-' + cat.key);
      if (t) t.textContent = Skills.categoryLevel(cat.key);
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

  // ---------- shared cursor tooltip (3D hover + inventory/equipment) ----------
  var _tipEl = null;
  function tipEl() {
    if (_tipEl) return _tipEl;
    _tipEl = document.getElementById('cursor-tooltip');
    if (!_tipEl) { _tipEl = document.createElement('div'); _tipEl.id = 'cursor-tooltip'; document.body.appendChild(_tipEl); }
    return _tipEl;
  }
  function showTip(text, x, y) {
    if (Game.headless || !text) { hideTip(); return; }
    var t = tipEl();
    t.textContent = text;
    t.style.display = 'block';
    var w = t.offsetWidth || 120, h = t.offsetHeight || 24;
    var lx = Math.min(x + 16, window.innerWidth - w - 6);
    var ly = Math.min(y + 18, window.innerHeight - h - 6);
    t.style.left = lx + 'px'; t.style.top = ly + 'px';
  }
  function hideTip() { if (_tipEl) _tipEl.style.display = 'none'; }

  // ---------- round-restart countdown + overlay cleanup ----------
  var _cdEl = null, _cdTimer = null;
  function clearCountdown() {
    if (_cdTimer) { clearInterval(_cdTimer); _cdTimer = null; }
    if (_cdEl && _cdEl.parentNode) _cdEl.parentNode.removeChild(_cdEl);
    _cdEl = null;
  }
  function showCountdown(sec) {
    if (Game.headless) return;
    clearCountdown();
    var remaining = Math.max(1, sec || 10);
    _cdEl = document.createElement('div');
    _cdEl.id = 'countdown';
    document.body.appendChild(_cdEl);
    function render() { _cdEl.innerHTML = 'New round in <b>' + remaining + '</b>…'; }
    render();
    _cdTimer = setInterval(function () {
      remaining--;
      if (remaining <= 0) { clearCountdown(); return; }
      render();
    }, 1000);
  }
  // remove the victory overlay + death screen + countdown (called on a new round)
  function clearOverlays() {
    var v = document.getElementById('victory');
    if (v && v.parentNode) v.parentNode.removeChild(v);
    hideDeathScreen();
    clearCountdown();
  }

  // ---------- global level-up announcements (top-center banner) ----------
  function announce(text, ominous) {
    if (Game.headless) return;
    var layer = $('announce-layer');
    if (!layer) return;
    var d = document.createElement('div');
    d.className = 'announce' + (ominous ? ' ominous' : '');
    d.textContent = (ominous ? '☠ ' : '★ ') + text;
    layer.appendChild(d);
    // fade + remove; ominous messages linger longer
    var life = ominous ? 6000 : 3200;
    setTimeout(function () { d.classList.add('out'); }, life - 500);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, life);
    // keep the stack short
    while (layer.children.length > 4) layer.removeChild(layer.firstChild);
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

  // ---------- XP drop: floats "+N" above the player's head when you gain XP ----------
  // XP from a single action (e.g. a mine tick, or attack+strength+hp on one hit) is
  // batched over a short window into one popup so it's not spammy.
  var _xpAccum = 0, _xpTimer = null;
  function spawnXpGain(amount) {
    if (Game.headless || amount <= 0) return;
    _xpAccum += amount;
    if (_xpTimer) return;
    _xpTimer = setTimeout(flushXpGain, 320);
  }
  function flushXpGain() {
    _xpTimer = null;
    var amt = Math.round(_xpAccum); _xpAccum = 0;
    var p = Game.player;
    if (amt <= 0 || !hitLayer || !p || !p.group) return;
    var s = toScreen(new THREE.Vector3(p.position.x, p.position.y + 2.4, p.position.z));
    if (!s) return;
    var d = document.createElement('div');
    d.className = 'xp-pop';
    d.textContent = '+' + amt;
    d.style.left = s.x + 'px';
    d.style.top = s.y + 'px';
    hitLayer.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 1200);
  }

  // ---------- chat: type in the bottom-left box, text floats over your head ----------
  var _overheadEl = null, _overheadT = 0;
  function chatFocused() { return el.chatInput && document.activeElement === el.chatInput; }
  function dialogueOpen() { return window.Dialogue && Dialogue.isOpen && Dialogue.isOpen(); }
  function wireChat() {
    el.chatInput = $('chat-input');
    el.chatLog = $('chat-log');
    el.chatView = $('chat-view');
    el.npcView = $('npc-view');
    el.npcName = $('npc-name');
    el.npcText = $('npc-text');
    el.npcOptions = $('npc-options');
    if (!el.chatInput) return;
    el.chatInput.addEventListener('keydown', function (e) {
      e.stopPropagation();               // don't let game hotkeys fire while typing
      if (e.key === 'Enter') {
        var t = el.chatInput.value.trim();
        el.chatInput.value = '';
        el.chatInput.blur();
        if (t) { showOverhead(t); appendChat('You', t); if (window.Net && Net.sendChat) Net.sendChat(t); }
      } else if (e.key === 'Escape') { el.chatInput.value = ''; el.chatInput.blur(); }
    });
    // press Enter anywhere (when not already typing, and not mid-conversation) to
    // jump into the chat box
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !chatFocused() && !dialogueOpen() && el.chatInput) { e.preventDefault(); el.chatInput.focus(); }
    });
  }
  // append a line to the scrolling chat log (keeps the last ~40 lines)
  function appendChat(who, text) {
    if (Game.headless || !el.chatLog) return;
    var d = document.createElement('div');
    d.className = 'cl-line' + (who ? '' : ' cl-sys');
    d.innerHTML = who ? ('<b>' + String(who).replace(/</g, '&lt;') + ':</b> ' + String(text).replace(/</g, '&lt;'))
                      : String(text).replace(/</g, '&lt;');
    el.chatLog.appendChild(d);
    while (el.chatLog.children.length > 40) el.chatLog.removeChild(el.chatLog.firstChild);
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
  }

  // ---------- NPC dialogue (swaps the bottom-left box to the conversation) ----------
  // Called by Dialogue.render with { name, text, options:[{text,goto}] }.
  function showDialogue(c) {
    if (Game.headless || !el.npcView || !c) return;
    if (el.chatView) el.chatView.style.display = 'none';
    el.npcView.style.display = 'block';
    if (el.npcName) el.npcName.textContent = c.name || '';
    if (el.npcText) el.npcText.textContent = c.text || '';
    if (!el.npcOptions) return;
    el.npcOptions.innerHTML = '';
    var opts = c.options || [];
    for (var i = 0; i < opts.length; i++) {
      (function (idx) {
        var b = document.createElement('div');
        b.className = 'npc-opt';
        b.innerHTML = '<span class="opt-num">' + (idx + 1) + '.</span>' + String(opts[idx].text || '').replace(/</g, '&lt;');
        b.addEventListener('click', function () { if (window.Dialogue) Dialogue.choose(idx); });
        el.npcOptions.appendChild(b);
      })(i);
    }
  }
  // hide the NPC view and return to the chat box
  function hideDialogue() {
    if (!el.npcView) return;
    el.npcView.style.display = 'none';
    if (el.chatView) el.chatView.style.display = 'block';
  }
  // show text over the local player's head (also used for NPC replies later)
  function showOverhead(text) {
    if (Game.headless || !labelLayer) return;
    if (!_overheadEl) { _overheadEl = document.createElement('div'); _overheadEl.className = 'overhead-chat'; labelLayer.appendChild(_overheadEl); }
    _overheadEl.textContent = text;
    _overheadEl.style.display = 'block';
    _overheadT = 5;                       // seconds visible
  }
  function updateOverheadChat(dt) {
    if (!_overheadEl || _overheadT <= 0) return;
    _overheadT -= dt;
    var p = Game.player;
    if (_overheadT <= 0 || !p || !p.group) { _overheadEl.style.display = 'none'; return; }
    var s = toScreen(new THREE.Vector3(p.position.x, p.position.y + 3.4, p.position.z));
    if (!s) { _overheadEl.style.display = 'none'; return; }
    _overheadEl.style.display = 'block';
    _overheadEl.style.left = s.x + 'px';
    _overheadEl.style.top = s.y + 'px';
    _overheadEl.style.opacity = _overheadT < 1 ? _overheadT : 1;   // fade the last second
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

  // ---------- floating merchant nameplates (above the camel/rider) ----------
  function updateMerchantLabels(stations) {
    if (Game.headless || !labelLayer || !stations) return;
    for (var i = 0; i < stations.length; i++) {
      var s = stations[i];
      if (s.kind !== 'merchant' || !s.camel) continue;
      if (!s._labelEl) {
        var d = document.createElement('div');
        d.className = 'entity-label merchant';
        d.innerHTML = '<div class="nm">🐫 ' + String(s.camel.name || 'Merchant').replace(/</g, '&lt;') + '</div>';
        labelLayer.appendChild(d);
        s._labelEl = d;
      }
      var g = s.camel.group;
      var pt = toScreen(new THREE.Vector3(g.position.x, g.position.y + 3.9, g.position.z));
      if (!pt) { s._labelEl.style.display = 'none'; continue; }
      s._labelEl.style.display = 'block';
      s._labelEl.style.left = pt.x + 'px';
      s._labelEl.style.top = pt.y + 'px';
    }
  }

  // Remove every floating world label/nameplate DOM node (camp, merchant, enemy),
  // keeping the player's own HP bar. Used when entering story mode, which wipes the
  // default world's entities — their label divs would otherwise freeze on screen.
  function clearEntityLabels() {
    if (!labelLayer) return;
    var els = labelLayer.querySelectorAll('.entity-label');
    for (var i = 0; i < els.length; i++) {
      if (els[i].classList && els[i].classList.contains('player')) continue;   // keep the player HP bar
      if (els[i].parentNode) els[i].parentNode.removeChild(els[i]);
    }
  }

  // ---------- floating enemy labels / hp bars ----------
  var _playerBar = null, _playerBarFill = null;
  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function updateLabels(enemies) {
    if (Game.headless || !labelLayer) return;
    var now = nowMs();
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
      // only show while actively fighting — hidden ~4s after the last blow, even if hurt
      var inCombat = e._combatUntil && e._combatUntil > now;
      var visible = e.active && e.state !== 'dead' && e.state !== 'respawning' && inCombat;
      if (!visible) { e._labelEl.style.display = 'none'; continue; }
      var s = toScreen(new THREE.Vector3(e.position.x, e.position.y + 3.0, e.position.z));
      if (!s) { e._labelEl.style.display = 'none'; continue; }
      e._labelEl.style.display = 'block';
      e._labelEl.style.left = s.x + 'px';
      e._labelEl.style.top = s.y + 'px';
      e._hpFill.style.width = Utils.clamp(e.hp / e.maxHp, 0, 1) * 100 + '%';
    }
    updatePlayerBar(now);
  }
  // the player's own HP bar above their head, shown while in combat
  function updatePlayerBar(now) {
    var p = Game.player;
    if (!p) return;
    if (!_playerBar) {
      _playerBar = document.createElement('div');
      _playerBar.className = 'entity-label player';
      _playerBar.innerHTML = '<div class="entity-hpbar"><i></i></div>';
      labelLayer.appendChild(_playerBar);
      _playerBarFill = _playerBar.querySelector('i');
    }
    var inCombat = Game.playerCombatUntil && Game.playerCombatUntil > now;
    var s = (!p.isDead && inCombat) ? toScreen(new THREE.Vector3(p.position.x, p.position.y + 3.4, p.position.z)) : null;
    if (!s) { _playerBar.style.display = 'none'; return; }
    _playerBar.style.display = 'block';
    _playerBar.style.left = s.x + 'px';
    _playerBar.style.top = s.y + 'px';
    _playerBarFill.style.width = Utils.clamp(p.stats.hp / p.stats.maxHp, 0, 1) * 100 + '%';
  }

  // ---------- flashes / screens ----------
  // No red hurt overlay (Lucas's request) — damage feedback is the hitsplat + SFX.
  function flashDamage() {}

  function hideBoot() { if (el.boot) el.boot.classList.add('hidden'); }
  function setBootStatus(t) { if (el.bootStatus) el.bootStatus.textContent = t; }
  function showDeathScreen() { if (el.death) el.death.classList.add('show'); }
  function hideDeathScreen() { if (el.death) el.death.classList.remove('show'); }

  function showVictory(name, byMe, subtitle) {
    if (Game.headless || document.getElementById('victory')) return;
    var esc = String(name).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; });
    var sub = subtitle || (byMe
      ? 'You placed the Heart of the Obelisk and claimed the desert!'
      : esc + ' placed the Heart of the Obelisk and won the game.');
    var d = document.createElement('div');
    d.id = 'victory';
    d.innerHTML = '<div class="vic-inner"><div class="vic-title">' + (byMe ? '★ VICTORY ★' : 'GAME OVER') + '</div>' +
      '<div class="vic-sub">' + sub + '</div></div>';
    document.body.appendChild(d);
  }

  // ---- boss health bar (top-center, big) ----
  var _bossBar = null;
  function showBossBar(name, hp, max) {
    if (Game.headless) return;
    hideBossBar();
    _bossBar = document.createElement('div');
    _bossBar.id = 'boss-bar';
    _bossBar.innerHTML = '<div class="bb-name">' + String(name).replace(/</g, '&lt;') + '</div>' +
      '<div class="bb-track"><div class="bb-fill"></div></div>' +
      '<div class="bb-stagger"><div class="bb-stagger-fill"></div></div>';
    document.body.appendChild(_bossBar);
    updateBossBar(hp, max, 0, 100);
  }
  function updateBossBar(hp, max, stagger, maxStagger) {
    if (!_bossBar) return;
    var f = _bossBar.querySelector('.bb-fill');
    if (f) f.style.width = Utils.clamp(hp / (max || 1), 0, 1) * 100 + '%';
    var s = _bossBar.querySelector('.bb-stagger-fill');
    if (s && typeof stagger === 'number') s.style.width = Utils.clamp(stagger / (maxStagger || 100), 0, 1) * 100 + '%';
  }
  function hideBossBar() { if (_bossBar && _bossBar.parentNode) _bossBar.parentNode.removeChild(_bossBar); _bossBar = null; }

  return {
    init: init,
    updateVitals: updateVitals, updateSkills: updateSkills, buildSkills: buildSkills,
    updateInventory: updateInventory,
    updateEquipment: updateEquipment, setActiveTab: setActiveTab, toast: toast,
    updateGold: updateGold, updateScore: updateScore, openSmithMenu: openSmithMenu, openSellMenu: openSellMenu, openStationMenu: openStationMenu,
    openBuildMenu: openBuildMenu,
    showActionText: showActionText, setTarget: setTarget, announce: announce,
    showTip: showTip, hideTip: hideTip, showCountdown: showCountdown, clearOverlays: clearOverlays,
    spawnHitsplat: spawnHitsplat, spawnXpGain: spawnXpGain, spawnSpeech: spawnSpeech, updateLabels: updateLabels,
    updateCampLabels: updateCampLabels, updateMerchantLabels: updateMerchantLabels, clearEntityLabels: clearEntityLabels,
    showOverhead: showOverhead, updateOverheadChat: updateOverheadChat, chatFocused: chatFocused,
    appendChat: appendChat, showDialogue: showDialogue, hideDialogue: hideDialogue,
    flashDamage: flashDamage, hideBoot: hideBoot, setBootStatus: setBootStatus,
    showDeathScreen: showDeathScreen, hideDeathScreen: hideDeathScreen,
    showVictory: showVictory,
    showBossBar: showBossBar, updateBossBar: updateBossBar, hideBossBar: hideBossBar
  };
})();
