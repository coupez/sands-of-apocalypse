// ============================================================
// skills.js — skills (Woodcutting/Mining/Fishing/Attack/Strength/
// Defence), inventory, items, and equippable weapons.
// ============================================================

var Skills = (function () {
  // Skills are grouped into three categories; each category shows a TOTAL level
  // (the sum of its member skills' levels) in the panel header. `soon:true` marks
  // a skill that exists in the tree but isn't trainable yet (placeholder Lv 1).
  var CATEGORIES = [
    { key: 'combat',    name: 'Combat',             skills: ['hitpoints', 'attack', 'defense', 'strength', 'ranged', 'spirit', 'prayer'] },
    { key: 'gathering', name: 'Gathering',          skills: ['mining', 'woodcutting', 'fishing', 'hunting'] },
    { key: 'skills',    name: 'Skills',             skills: ['smithing', 'casting', 'cooking'] }
  ];
  // combat skills cap at 20; gathering/production/faith skills cap at 12
  var data = {
    attack:       { name: 'Attack',        icon: '⚔️', xp: 0, level: 1, max: 20 },
    strength:     { name: 'Strength',      icon: '💪', xp: 0, level: 1, max: 20 },
    defense:      { name: 'Defense',       icon: '🛡️', xp: 0, level: 1, max: 20, soon: true },
    ranged:       { name: 'Range',         icon: '🏹', xp: 0, level: 1, max: 20 },
    hitpoints:    { name: 'Hit Points',    icon: '❤️', xp: 0, level: 15, max: 20, start: 15 },  // starts at 15 = your base health; +1 max HP per level
    spirit:       { name: 'Spirit',        icon: '🔮', xp: 0, level: 1, max: 12, soon: true },  // magic (not wired yet)
    prayer:       { name: 'Faith',         icon: '🙏', xp: 0, level: 1, max: 12 },               // key stays 'prayer'; trained by burying bones
    mining:       { name: 'Mining',        icon: '⛏️', xp: 0, level: 1, max: 12 },
    woodcutting:  { name: 'Lumbering',     icon: '🪓', xp: 0, level: 1, max: 12 },
    fishing:      { name: 'Harvesting',    icon: '🌴', xp: 0, level: 1, max: 12 },
    hunting:      { name: 'Hunting',       icon: '🥩', xp: 0, level: 1, max: 12, soon: true },
    smithing:     { name: 'Crafting',      icon: '🔨', xp: 0, level: 1, max: 12 },
    casting:      { name: 'Casting',       icon: '🪄', xp: 0, level: 1, max: 12, soon: true },   // magic (not wired yet)
    cooking:      { name: 'Medical',       icon: '⚕️', xp: 0, level: 1, max: 12 }
  };
  // flat order (all categories concatenated) for any consumer that wants a list
  var SKILL_ORDER = CATEGORIES.reduce(function (a, c) { return a.concat(c.skills); }, []);
  function categorySum(catKey) {
    var cat = null;
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].key === catKey) cat = CATEGORIES[i];
    if (!cat) return 0;
    var t = 0;
    for (var j = 0; j < cat.skills.length; j++) { var d = data[cat.skills[j]]; if (d) t += d.level; }
    return t;
  }

  // ---- category (total) levels ----
  // Combat uses a RuneScape-style weighted formula, NOT a raw sum: your total combat
  // level reflects how hard you actually hit. Your best DAMAGE style dominates —
  // max(Strength, Range, Spirit) — since you only fight in one style at a time; Attack
  // (accuracy) counts less, and Hit Points / Defense / Faith are minor support. Weights
  // are tuned so a fresh character reads ~1 and a fully-maxed one reads ~19.
  var COMBAT_WEIGHTS = { dmg: 0.40, attack: 0.20, hitpoints: 0.15, defense: 0.15, prayer: 0.10 };
  function combatLevel() {
    var dmg = Math.max(data.strength.level, data.ranged.level, data.spirit.level);   // your hardest-hitting style
    var v = COMBAT_WEIGHTS.dmg * dmg
          + COMBAT_WEIGHTS.attack * data.attack.level
          + COMBAT_WEIGHTS.hitpoints * data.hitpoints.level
          + COMBAT_WEIGHTS.defense * data.defense.level
          + COMBAT_WEIGHTS.prayer * data.prayer.level;
    return Math.round(v);
  }
  // Only Combat uses the weighted formula; Gathering / Skills totals are just the
  // absolute sum of their member skills' levels.
  function categoryLevel(catKey) {
    if (catKey === 'combat') return combatLevel();
    return categorySum(catKey);
  }
  // human-readable description of how Combat's total is computed (shown on hover)
  var COMBAT_FORMULA_TEXT = 'Combat = 0.4×best(Str/Range/Spirit) + 0.2×Attack + 0.15×HP + 0.15×Defense + 0.1×Faith';

  var ITEMS = {
    log:      { id: 'log',      name: 'Dead Log',    icon: '🪵' },
    palmwood: { id: 'palmwood', name: 'Palm Wood',   icon: '🪵' },
    blog:     { id: 'blog',     name: 'Ebony Log',   icon: '🟫' },
    elderwood:{ id: 'elderwood',name: 'Elderwood',   icon: '🟤' },
    ore:      { id: 'ore',      name: 'Copper Ore',  icon: '◆', tint: 0xc87838 },
    iron:     { id: 'iron',     name: 'Iron Ore',    icon: '◆', tint: 0x8a8f96 },
    silver:   { id: 'silver',   name: 'Silver Ore',  icon: '◆', tint: 0xd8dce2 },
    pore:     { id: 'pore',     name: 'Gold Ore',    icon: '◆', tint: 0xffd24a },
    shrimp:  { id: 'shrimp',  name: 'Dates',         icon: '🌰' },
    lobster: { id: 'lobster', name: 'Prickly Pear',  icon: '🌵' },
    whale:   { id: 'whale',   name: 'Figs',          icon: '🫐' },
    cshrimp: { id: 'cshrimp', name: 'Honeyed Dates', icon: '🍯' },
    clobster:{ id: 'clobster',name: 'Cactus Jam',    icon: '🍮' },
    cwhale:  { id: 'cwhale',  name: 'Dried Figs',    icon: '🍇' },
    bronzebar: { id: 'bronzebar', name: 'Copper Bar', icon: '▬', tint: 0xc87838 },
    ironbar:   { id: 'ironbar',   name: 'Iron Bar',   icon: '▬', tint: 0x8a8f96 },
    silverbar: { id: 'silverbar', name: 'Silver Bar', icon: '▬', tint: 0xd8dce2 },
    goldbar:   { id: 'goldbar',   name: 'Gold Bar',   icon: '▬', tint: 0xffd24a },
    tinakal:    { id: 'tinakal',    name: 'Tin Akal',     icon: '◆', tint: 0x5fe0d0 },   // raw meteoric ore
    tinakalbar: { id: 'tinakalbar', name: 'Tin Akal Bar', icon: '▬', tint: 0x5fe0d0 },
    essence:   { id: 'essence',   name: 'Bandit Essence',   icon: '🩸' },
    bones:     { id: 'bones',     name: 'Pile of Bones',    icon: '🦴' },
    messence:  { id: 'messence',  name: 'Essence of the Merchant', icon: '💰' },
    rockessence:{ id: 'rockessence', name: 'Essence of the Rock', icon: '🔮' },
    orb:       { id: 'orb',       name: 'Heart of the Obelisk', icon: '❤️' }
  };

  // Only COOKED seafood is edible; eat raw and you gain nothing. Cook it at a
  // campfire first. id -> HP healed when eaten.
  var FOOD = { cshrimp: 2, clobster: 4, cwhale: 6 };
  // raw -> cooked mapping used by the campfire
  var COOK = { shrimp: 'cshrimp', lobster: 'clobster', whale: 'cwhale' };
  function isFood(id) { return Object.prototype.hasOwnProperty.call(FOOD, id); }

  // Equipment slots: head, body, legs, feet, and a weapon/off-hand in each hand.
  var EQUIP_SLOTS = ['head', 'body', 'legs', 'feet', 'lhand', 'rhand'];

  // Equippable gear. Each piece has a slot and a set of stat bonuses:
  //   maxHit (extra damage), acc (accuracy), def (damage mitigation),
  //   str (added strength), hp (added max HP). The Fanny Pack instakills.
  var GEAR = {
    // right-hand weapons
    sword:   { id: 'sword',   name: 'Copper Scimitar',    icon: '⚔️', slot: 'rhand', bonus: { maxHit: 4,   acc: 0.10 } },
    gun:     { id: 'gun',     name: 'Hunting Bow',        icon: '🏹', slot: 'rhand', bonus: { maxHit: 8,   acc: 0.20 }, ranged: true },
    bow:     { id: 'bow',     name: 'Desert Longbow',     icon: '🏹', slot: 'rhand', bonus: { maxHit: 5,   acc: 0.15 }, ranged: true },
    fanny:   { id: 'fanny',   name: "Genie's Lamp",       icon: '🪔', slot: 'rhand', bonus: { maxHit: 999, acc: 1.00 }, instakill: true },
    // left-hand off-hand
    shield:  { id: 'shield',  name: 'Round Shield',       icon: '🛡️', slot: 'lhand', bonus: { def: 6, hp: 5 } },
    machete: { id: 'machete', name: 'Jambiya Dagger',     icon: '🗡️', slot: 'lhand', bonus: { maxHit: 3, str: 2 } },
    // head
    gasmask: { id: 'gasmask', name: 'Desert Turban',      icon: '👳', slot: 'head', bonus: { def: 3, hp: 4 } },
    hazhood: { id: 'hazhood', name: 'Nomad Hood',         icon: '🧣', slot: 'head', bonus: { def: 2, str: 2 } },
    // body
    hazvest: { id: 'hazvest', name: 'Padded Tunic',       icon: '🥋', slot: 'body', bonus: { def: 6, hp: 8 } },
    plate:   { id: 'plate',   name: 'Copper Cuirass',     icon: '🧥', slot: 'body', bonus: { def: 9, hp: 10 } },
    // legs
    greaves: { id: 'greaves', name: 'Leather Greaves',    icon: '👖', slot: 'legs', bonus: { def: 4, hp: 5 } }
  };

  // ---- smithing: metals × gear types → generated equippable gear + recipes ----
  // Each metal has a colour; that colour tags its ore, bar, gear icon, and the
  // wearer's character mesh so other players can see your tier at a glance.
  // `level` here is the STATION level required to work this metal (its tier):
  // furnace/anvil must be upgraded to that level to smelt/smith it.
  // `level` = STATION (anvil/furnace) level needed to WORK this metal.
  // `req`   = ATTACK level (weapons) / DEFENSE level (armor) needed to EQUIP this tier.
  var METALS = [
    { key: 'bronze', name: 'Copper', bar: 'bronzebar', level: 1, req: 1,  color: 0xc87838 },   // display 'Copper'; id stays 'bronze'
    { key: 'iron',   name: 'Iron',   bar: 'ironbar',   level: 2, req: 5,  color: 0x8a8f96 },
    { key: 'silver', name: 'Silver', bar: 'silverbar', level: 3, req: 8,  color: 0xd8dce2 },
    { key: 'gold',   name: 'Gold',   bar: 'goldbar',   level: 4, req: 11, color: 0xffd24a },
    // meteoric endgame tier: bar is smelted from Meteorite ore (mined only at max
    // Mining+Woodcutting) and each piece also needs Elderwood (the highest log).
    { key: 'tinakal', name: 'Tin Akal', bar: 'tinakalbar', level: 4, req: 14, color: 0x5fe0d0, wood: 'elderwood' }
  ];
  var METAL_COLOR = { bronze: 0xc87838, iron: 0x8a8f96, silver: 0xd8dce2, gold: 0xffd24a, tinakal: 0x5fe0d0 };
  // Three melee weapon archetypes give a real "choose your feel": the dagger
  // swings fast for small hits, the greatsword is slow but hits huge, the
  // scimitar sits between. `speed` scales the attack interval (lower = faster).
  var GTYPES = [
    { key: 'helmet',    slot: 'head',  name: 'Helmet',    icon: '⛑️', bars: 1, per: { def: 2, hp: 1 } },
    { key: 'platebody', slot: 'body',  name: 'Platebody', icon: '🦺', bars: 3, per: { def: 4, hp: 3 } },
    { key: 'platelegs', slot: 'legs',  name: 'Platelegs', icon: '👖', bars: 2, per: { def: 3, hp: 2 } },
    { key: 'boots',     slot: 'feet',  name: 'Boots',     icon: '🥾', bars: 1, per: { def: 1, hp: 1 } },
    { key: 'shield',    slot: 'lhand', name: 'Shield',    icon: '🛡️', bars: 2, per: { def: 3, hp: 2 } },
    // attack SPEED scales the swing interval (lower = faster). greatsword swings
    // once per ~4 dagger hits (0.6 → 2.4); scimitar sits in between.
    { key: 'dagger',    slot: 'rhand', name: 'Dagger',    icon: '🗡️', bars: 1, per: { maxHit: 1,  acc: 0.08 }, speed: 0.6 },  // fast, low damage
    { key: 'scimitar',  slot: 'rhand', name: 'Scimitar',  icon: '⚔️', bars: 2, per: { maxHit: 3,  acc: 0.03 }, speed: 1.4 },  // balanced
    { key: 'greatsword',slot: 'rhand', name: 'Greatsword',icon: '🔪', bars: 4, per: { maxHit: 10, acc: 0.0 },  speed: 2.4 }   // very slow, huge hits
  ];
  // ore -> bar produced when smelted (each ore makes its own metal bar)
  var SMELT = { ore: 'bronzebar', iron: 'ironbar', silver: 'silverbar', pore: 'goldbar', tinakal: 'tinakalbar' };

  var SMITH_RECIPES = [];
  (function buildSmithing() {
    for (var mi = 0; mi < METALS.length; mi++) {
      var M = METALS[mi], mult = mi + 1;
      for (var ti = 0; ti < GTYPES.length; ti++) {
        var T = GTYPES[ti], bonus = {};
        for (var k in T.per) bonus[k] = (k === 'acc') ? +(T.per[k] * mult).toFixed(2) : T.per[k] * mult;
        var id = M.key + '_' + T.key;
        // each gear TYPE has its own icon (helmet/sword/…) so pieces are
        // distinguishable at a glance; the metal tint still marks the tier.
        GEAR[id] = { id: id, name: M.name + ' ' + T.name, icon: T.icon, tint: M.color, slot: T.slot, bonus: bonus,
          reqSkill: T.speed ? 'attack' : 'defense', reqLevel: M.req };   // weapons gated by Attack, armour by Defense
        if (T.speed) GEAR[id].speed = T.speed;   // weapon attack-speed (archetype feel)
        var rec = { id: id, name: M.name + ' ' + T.name, icon: T.icon, tint: M.color,
          bar: M.bar, barName: M.name + ' Bar', bars: T.bars, level: M.level };
        if (M.wood) { rec.wood = M.wood; rec.woodN = 1; rec.woodName = (ITEMS[M.wood] ? ITEMS[M.wood].name : M.wood); }
        // weapons upgrade tier-by-tier: to forge this one you must consume the
        // previous metal's weapon of the same kind (bronze needs none).
        if (T.speed && mi > 0) { var pm = METALS[mi - 1]; rec.prev = pm.key + '_' + T.key; rec.prevName = pm.name + ' ' + T.name; }
        SMITH_RECIPES.push(rec);
      }
    }
  })();

  // legacy/basic gear (defined by hand above) has no tier — everything equips at level 1.
  // Weapons (offensive bonus) gate on Attack, everything else on Defense.
  (function defaultEquipReqs() {
    for (var id in GEAR) {
      var g = GEAR[id];
      if (g.reqLevel) continue;
      g.reqLevel = 1;
      g.reqSkill = (g.ranged || g.instakill || (g.bonus && g.bonus.maxHit)) ? 'attack' : 'defense';
    }
  })();
  // the Attack/Defense level needed to equip a piece of gear
  function equipReq(id) { var g = GEAR[id]; return g ? { level: g.reqLevel || 1, skill: g.reqSkill || 'attack' } : { level: 1, skill: 'attack' }; }
  function canEquip(id) { var r = equipReq(id); var d = data[r.skill]; return !d || d.level >= r.level; }

  function isGear(id) { return !!GEAR[id]; }
  function countItem(id) { var n = 0; for (var i = 0; i < Game.inventory.length; i++) if (Game.inventory[i] && Game.inventory[i].id === id) n++; return n; }

  function smithRecipe(id) { for (var i = 0; i < SMITH_RECIPES.length; i++) if (SMITH_RECIPES[i].id === id) return SMITH_RECIPES[i]; return null; }
  // returns null if craftable, else a reason string. Gated by the anvil's level.
  function canSmith(r, stationLevel) {
    if (!r) return 'no recipe';
    if ((stationLevel || 1) < r.level) return 'Needs anvil Lv ' + r.level;
    if (countItem(r.bar) < r.bars) return 'Needs ' + r.bars + ' ' + r.barName;
    if (r.wood && countItem(r.wood) < (r.woodN || 1)) return 'Needs ' + (r.woodN || 1) + ' ' + r.woodName;
    if (r.prev && countItem(r.prev) < 1) return 'Needs a ' + r.prevName + ' to upgrade';
    return null;
  }
  function smith(id, stationLevel) {
    var r = smithRecipe(id), why = canSmith(r, stationLevel);
    if (why) { if (window.UI) UI.showActionText(why); return false; }
    for (var b = 0; b < r.bars; b++) removeItem(r.bar);   // frees slots, so the result always fits
    if (r.wood) for (var w = 0; w < (r.woodN || 1); w++) removeItem(r.wood);
    if (r.prev) removeItem(r.prev);   // consume the lower-tier weapon it's forged from
    addItem(r.id);
    if (!Game.craftedWeapons) Game.craftedWeapons = {};
    Game.craftedWeapons[r.id] = true;   // now revealed in the smith menu
    if (r.id.indexOf('_greatsword') >= 0 && r.id.indexOf('bronze_') !== 0) Game.forgedRitual = true;   // ritual weapon: iron+ greatsword (Forge sigil)
    addXp('smithing', 8 + r.level * 4);
    if (window.UI) UI.showActionText('You smith a ' + r.name + '.');
    Game.log.push('smith:' + r.id);
    return true;
  }

  // ---- gold & the merchant stand ----
  var SELL_VALUE = {
    log: 2, palmwood: 4, blog: 8, elderwood: 16,
    ore: 4, iron: 9, silver: 18, pore: 36,
    shrimp: 3, lobster: 6, whale: 12, cshrimp: 5, clobster: 9, cwhale: 15,
    bronzebar: 10, ironbar: 22, silverbar: 45, goldbar: 90,
    tinakal: 120, tinakalbar: 240
  };
  function sellValue(id) { return SELL_VALUE[id] || 0; }
  function addGold(n) { Game.gold = (Game.gold || 0) + n; if (window.UI) UI.updateGold(); }
  function spendGold(n) { if ((Game.gold || 0) < n) return false; Game.gold -= n; if (window.UI) UI.updateGold(); return true; }
  function sellItem(index) {
    var it = Game.inventory[index];
    if (!it) return false;
    var v = sellValue(it.id);
    if (v <= 0) { if (window.UI) UI.showActionText("The merchant won't buy that."); return false; }
    Game.inventory[index] = null;
    addGold(v);
    if (window.UI) { UI.updateInventory(); UI.showActionText('Sold ' + it.name + ' for ' + v + ' gold.'); }
    Game.log.push('sell:' + it.id);
    return true;
  }

  function init() {
    // most skills start at level 1; Hit Points starts at 15 (its `start`) so you
    // begin with 15 base health. Seed its xp to the threshold for that level.
    for (var k in data) {
      var st = data[k].start || 1;
      data[k].level = st;
      data[k].xp = st > 1 ? Utils.xpForLevel(st) : 0;
    }
    Game.gold = 0;
    Game.craftedWeapons = {};   // which weapons you've forged (reveals the blurred smith-menu icon)
    if (window.UI && UI.updateGold) UI.updateGold();
    // fixed-size inventory: 28 slots, each null or an item stack (holes allowed
    // so items can be dragged to any square).
    Game.inventory = [];
    for (var s = 0; s < Game.invMax; s++) Game.inventory[s] = null;
    // equipment slots, all empty to start
    Game.equipment = { head: null, body: null, legs: null, feet: null, lhand: null, rhand: null };
    applyEquipmentToStats();
    if (window.UI) { UI.updateSkills(); UI.updateInventory(); UI.updateEquipment(); }
  }

  function addXp(skill, amount) {
    var s = data[skill];
    if (!s || amount <= 0) return;
    var before = s.level;
    s.xp += amount;
    s.level = Math.min(Utils.levelForXp(s.xp), s.max || 99);
    if (s.level > before) {
      SFX.level();
      // Hit Points level IS your base max health — recompute it and heal the gain.
      if (skill === 'hitpoints') { applyEquipmentToStats(); if (window.Player && Player.heal) Player.heal(s.level - before); }
      if (window.UI) UI.toast(s.name, s.level);
      // global announcement to every player; a maxed skill gets an ominous one
      var maxed = s.level >= (s.max || 99);
      var nm = (window.Net && Net.myName) ? Net.myName : 'You';
      if (window.UI && UI.announce) UI.announce(nm + ' reached ' + s.name + ' level ' + s.level + (maxed ? '!' : ''), maxed);
      if (window.Net && Net.sendLevel) Net.sendLevel(s.name, s.level, maxed);
      Game.log.push('levelup:' + skill + ':' + s.level);
    }
    if (window.UI) UI.updateSkills();
  }

  // Items don't stack: every item takes its own inventory slot.
  function addItem(id) {
    var def = ITEMS[id] || GEAR[id];
    if (!def) return false;
    var inv = Game.inventory;
    for (var j = 0; j < Game.invMax; j++) {
      if (!inv[j]) { inv[j] = { id: id, name: def.name, icon: def.icon, count: 1 }; if (window.UI) UI.updateInventory(j); SFX.pickup(); return true; }
    }
    return false; // inventory full
  }

  // ---- item helpers (used by crafting stations) ----
  function hasItem(id) {
    for (var i = 0; i < Game.inventory.length; i++) if (Game.inventory[i] && Game.inventory[i].id === id) return true;
    return false;
  }
  // remove one item of `id` (non-stacking, so clears one slot); returns true if removed
  function removeItem(id) {
    for (var i = 0; i < Game.inventory.length; i++) {
      if (Game.inventory[i] && Game.inventory[i].id === id) {
        Game.inventory[i] = null;
        if (window.UI) UI.updateInventory();
        return true;
      }
    }
    return false;
  }

  // Eat a food item in slot `index`, healing the player.
  function eat(index) {
    var it = Game.inventory[index];
    if (!it) return false;
    if (!isFood(it.id)) {
      // raw seafood can't be eaten — must be cooked first
      if (window.UI) UI.showActionText(COOK[it.id] ? 'You must cook the ' + it.name.replace('Raw ', '') + ' first.' : "You can't eat that.");
      return false;
    }
    var heal = FOOD[it.id];
    Game.inventory[index] = null;
    if (window.Player) {
      if (Player.heal) Player.heal(heal);
      if (Player.startEating) Player.startEating();   // eat animation + brief attack lockout
    }
    if (window.SFX && SFX.pickup) SFX.pickup();
    if (window.UI) { UI.updateInventory(); UI.showActionText('You eat the ' + it.name + '. (+' + heal + ' HP)'); }
    Game.log.push('eat:' + it.id);
    return true;
  }

  // Bury a pile of bones for Prayer XP (bandits drop these).
  var BONE_PRAYER_XP = 200;
  function isBones(id) { return id === 'bones'; }
  function bury(index) {
    var it = Game.inventory[index];
    if (!it || !isBones(it.id)) return false;
    Game.inventory[index] = null;
    addXp('prayer', BONE_PRAYER_XP);
    if (window.Player && Player.startPraying) Player.startPraying();
    if (window.UI) { UI.updateInventory(); UI.showActionText('You bury the bones. Your Prayer grows.'); }
    Game.log.push('bury:bones');
    return true;
  }

  // Fletch a Desert Longbow from any 2 logs (worked at the anvil).
  function craftBow() {
    var woods = [];
    for (var i = 0; i < Game.inventory.length && woods.length < 2; i++) {
      var it = Game.inventory[i];
      if (it && WOOD_SET[it.id]) woods.push(i);
    }
    if (woods.length < 2) { if (window.UI) UI.showActionText('Fletching a bow needs 2 logs.'); return false; }
    Game.inventory[woods[0]] = null; Game.inventory[woods[1]] = null;
    addItem('bow');
    addXp('smithing', 18);
    if (window.UI) { UI.updateInventory(); UI.showActionText('You fletch a Desert Longbow.'); }
    Game.log.push('craft:bow');
    return true;
  }
  var WOOD_SET = { log: 1, palmwood: 1, blog: 1, elderwood: 1 };
  // is the equipped right-hand weapon a ranged weapon (bow)?
  function isRanged() { var g = GEAR[Game.equipment && Game.equipment.rhand]; return !!(g && g.ranged); }
  // attack-speed multiplier of the equipped weapon (lower = faster; 1 = default)
  function weaponSpeed() { var g = GEAR[Game.equipment && Game.equipment.rhand]; return (g && g.speed) ? g.speed : 1; }

  // Drop an item out of slot `index`.
  function dropItem(index) {
    var it = Game.inventory[index];
    if (!it) return false;
    Game.inventory[index] = null;
    if (window.UI) { UI.updateInventory(); UI.showActionText('You drop the ' + it.name + '.'); }
    Game.log.push('drop:' + it.id);
    return true;
  }

  function successChance(level, req) {
    // easier when your level is well above the requirement
    return Utils.clamp(0.5 + (level - req) * 0.03 + 0.05, 0.5, 0.95);
  }

  // ---- gathering ----
  function doWoodcut(tree) {
    if (!tree || !tree.active) return;
    if (data.woodcutting.level < (tree.reqLevel || 1)) return;
    if (Utils.rand() > successChance(data.woodcutting.level, tree.reqLevel || 1)) return;
    if (addItem(tree.itemId || 'log')) {
      addXp('woodcutting', tree.xp || 25);
      Game.log.push('woodcut');
      if (window.UI) UI.showActionText('You cut some ' + (ITEMS[tree.itemId || 'log'].name) + '.');
      if (Game.online) { if (window.Net && Net.sendGather) Net.sendGather('tree', tree.index); }
      else { tree.amount--; if (tree.amount <= 0) Entities.depleteResource(tree); }
    } else if (window.UI) UI.showActionText('Your inventory is full!');
  }

  function doMine(rock) {
    if (!rock || !rock.active) return;
    if (data.mining.level < (rock.reqLevel || 1)) return;
    if (Utils.rand() > successChance(data.mining.level, rock.reqLevel || 1)) return;
    if (addItem(rock.itemId || 'ore')) {
      addXp('mining', rock.xp || 35);
      if ((rock.itemId || 'ore') === 'pore') Game.minedGold = true;   // co-op Deep sigil
      Game.log.push('mine');
      if (window.UI) UI.showActionText('You mine some ' + (ITEMS[rock.itemId || 'ore'].name) + '.');
      if (Game.online) { if (window.Net && Net.sendGather) Net.sendGather('rock', rock.index); }
      else { rock.amount--; if (rock.amount <= 0) Entities.depleteResource(rock); }
    } else if (window.UI) UI.showActionText('Your inventory is full!');
  }

  function doFish(pool) {
    if (!pool || !pool.active) return;
    if (data.fishing.level < (pool.reqLevel || 1)) return;
    if (Utils.rand() > successChance(data.fishing.level, pool.reqLevel || 1)) return;
    var catchId = pool.itemId || 'shrimp';
    if (addItem(catchId)) {
      addXp('fishing', pool.xp || 30);
      Game.log.push('fish');
      if (window.UI) UI.showActionText('You harvest ' + (ITEMS[catchId] ? ITEMS[catchId].name : 'something') + '.');
      // harvest plants don't deplete; the desert always provides
    } else if (window.UI) UI.showActionText('Your inventory is full!');
  }

  // ---- equipment ----
  // Sum of every equipped piece's bonuses. Combat reads this live.
  function equipBonus() {
    var b = { maxHit: 0, acc: 0, def: 0, str: 0, hp: 0, instakill: false };
    for (var i = 0; i < EQUIP_SLOTS.length; i++) {
      var g = GEAR[Game.equipment[EQUIP_SLOTS[i]]];
      if (!g) continue;
      if (g.bonus) {
        b.maxHit += g.bonus.maxHit || 0;
        b.acc    += g.bonus.acc    || 0;
        b.def    += g.bonus.def    || 0;
        b.str    += g.bonus.str    || 0;
        b.hp     += g.bonus.hp     || 0;
      }
      if (g.instakill) b.instakill = true;
    }
    return b;
  }
  // The metal colours worn on head / body / legs / weapon (0 = none), used to
  // recolour the character mesh (locally and for other players).
  function tintOf(id) { var g = GEAR[id]; return (g && g.tint) ? g.tint : 0; }
  function appearance() {
    var e = Game.equipment || {};
    return { head: tintOf(e.head), body: tintOf(e.body), legs: tintOf(e.legs), weapon: tintOf(e.rhand), ranged: isRanged() };
  }

  // Push HP bonus into the player's max HP (other bonuses are read live in combat).
  function applyEquipmentToStats() {
    if (window.Player) {
      if (Player.applyBonuses) Player.applyBonuses(equipBonus());
      if (Player.applyAppearance) Player.applyAppearance(appearance());
    }
    if (window.UI) UI.updateVitals();
  }

  // Equip the gear in inventory slot `index` into its matching equipment slot,
  // sending whatever was already equipped back to the inventory.
  function equipFromInventory(index) {
    var item = Game.inventory[index];
    if (!item) return false;
    var g = GEAR[item.id];
    if (!g) { if (window.UI) UI.showActionText("You can't equip that."); return false; }
    // gated by Attack (weapons) or Defense (armour): you must be a high enough level
    if (!canEquip(g.id)) {
      var r = equipReq(g.id), sk = data[r.skill];
      if (window.UI) UI.showActionText('You need ' + (sk ? sk.name : r.skill) + ' level ' + r.level + ' to equip the ' + g.name + '.');
      return false;
    }
    var prev = Game.equipment[g.slot];
    // remove one of the clicked item from its stack
    item.count--;
    if (item.count <= 0) Game.inventory[index] = null;
    Game.equipment[g.slot] = g.id;
    if (prev) addItem(prev);              // return the old piece to the bag
    applyEquipmentToStats();
    if (window.UI) { UI.updateEquipment(); UI.updateInventory(); UI.showActionText('Equipped: ' + g.name); }
    Game.log.push('equip:' + g.id);
    return true;
  }

  // Take a piece off and drop it back into the inventory.
  function unequip(slot) {
    var id = Game.equipment[slot];
    if (!id) return false;
    Game.equipment[slot] = null;
    if (!addItem(id)) { Game.equipment[slot] = id; if (window.UI) UI.showActionText('Inventory full!'); return false; }
    applyEquipmentToStats();
    if (window.UI) { UI.updateEquipment(); UI.updateInventory(); UI.showActionText('Unequipped: ' + GEAR[id].name); }
    Game.log.push('unequip:' + id);
    return true;
  }

  // debug: max every skill + gold + a starter kit of endgame materials
  function maxAll() {
    for (var k in data) { if (!data.hasOwnProperty(k)) continue; data[k].xp = 20000000; data[k].level = data[k].max || 99; }
    Game.gold = (Game.gold || 0) + 100000;
    Game.merchantEssence = true;
    var give = ['elderwood', 'elderwood', 'tinakal', 'tinakalbar', 'tinakalbar',
      'bronzebar', 'ironbar', 'silverbar', 'goldbar', 'essence', 'messence', 'rockessence', 'orb'];
    for (var i = 0; i < give.length; i++) addItem(give[i]);
    if (window.UI) { UI.updateSkills(); if (UI.updateGold) UI.updateGold(); UI.updateInventory(); }
  }

  return {
    init: init, addXp: addXp, addItem: addItem, maxAll: maxAll,
    doWoodcut: doWoodcut, doMine: doMine, doFish: doFish,
    equipFromInventory: equipFromInventory, unequip: unequip,
    eat: eat, dropItem: dropItem, hasItem: hasItem, removeItem: removeItem,
    bury: bury, isBones: isBones, craftBow: craftBow, isRanged: isRanged, weaponSpeed: weaponSpeed,
    equipBonus: equipBonus, isGear: isGear, isFood: isFood,
    smith: smith, canSmith: canSmith, smithRecipe: smithRecipe, countItem: countItem,
    equipReq: equipReq, canEquip: canEquip,
    appearance: appearance,
    sellItem: sellItem, sellValue: sellValue, addGold: addGold, spendGold: spendGold,
    COOK: COOK, SMELT: SMELT, SMITH_RECIPES: SMITH_RECIPES, METALS: METALS,
    get data() { return data; },
    ITEMS: ITEMS, GEAR: GEAR, EQUIP_SLOTS: EQUIP_SLOTS, SKILL_ORDER: SKILL_ORDER,
    CATEGORIES: CATEGORIES, categoryLevel: categoryLevel, categorySum: categorySum,
    COMBAT_FORMULA_TEXT: COMBAT_FORMULA_TEXT
  };
})();
