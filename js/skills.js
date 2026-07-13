// ============================================================
// skills.js — skills (Woodcutting/Mining/Fishing/Attack/Strength/
// Defence), inventory, items, and equippable weapons.
// ============================================================

var Skills = (function () {
  var SKILL_ORDER = ['attack', 'strength', 'woodcutting', 'mining', 'fishing', 'cooking', 'smithing'];
  // combat skills cap at 20; gathering/production skills cap at 12
  var data = {
    attack:      { name: 'Attack',      icon: '⚔️', xp: 0, level: 1, max: 20 },
    strength:    { name: 'Strength',    icon: '💪', xp: 0, level: 1, max: 20 },
    woodcutting: { name: 'Woodcutting', icon: '🪓', xp: 0, level: 1, max: 12 },
    mining:      { name: 'Mining',      icon: '⛏️', xp: 0, level: 1, max: 12 },
    fishing:     { name: 'Fishing',     icon: '🎣', xp: 0, level: 1, max: 12 },
    cooking:     { name: 'Cooking',     icon: '🍳', xp: 0, level: 1, max: 12 },
    smithing:    { name: 'Smithing',    icon: '🔨', xp: 0, level: 1, max: 12 }
  };

  var ITEMS = {
    log:   { id: 'log',   name: 'Palm Timber',   icon: '🪵' },
    blog:  { id: 'blog',  name: 'Ebony Log',     icon: '🟫' },
    ore:   { id: 'ore',   name: 'Copper Ore',    icon: '🟠' },
    pore:  { id: 'pore',  name: 'Gold Ore',      icon: '🟡' },
    shrimp:  { id: 'shrimp',  name: 'Raw Sardine',   icon: '🐟' },
    lobster: { id: 'lobster', name: 'Raw Crab',      icon: '🦀' },
    whale:   { id: 'whale',   name: 'Raw Perch',     icon: '🐠' },
    cshrimp: { id: 'cshrimp', name: 'Grilled Sardine', icon: '🍢' },
    clobster:{ id: 'clobster',name: 'Grilled Crab',    icon: '🦀' },
    cwhale:  { id: 'cwhale',  name: 'Grilled Perch',   icon: '🍖' },
    bar:     { id: 'bar',     name: 'Bronze Bar',    icon: '🟫' }
  };

  // Only COOKED seafood is edible; eat raw and you gain nothing. Cook it at a
  // campfire first. id -> HP healed when eaten.
  var FOOD = { cshrimp: 2, clobster: 4, cwhale: 6 };
  // raw -> cooked mapping used by the campfire
  var COOK = { shrimp: 'cshrimp', lobster: 'clobster', whale: 'cwhale' };
  function isFood(id) { return Object.prototype.hasOwnProperty.call(FOOD, id); }

  // Equipment slots the player has: head, body, legs, and a weapon in each hand.
  var EQUIP_SLOTS = ['head', 'body', 'legs', 'lhand', 'rhand'];

  // Equippable gear. Each piece has a slot and a set of stat bonuses:
  //   maxHit (extra damage), acc (accuracy), def (damage mitigation),
  //   str (added strength), hp (added max HP). The Fanny Pack instakills.
  var GEAR = {
    // right-hand weapons
    sword:   { id: 'sword',   name: 'Bronze Scimitar',    icon: '⚔️', slot: 'rhand', bonus: { maxHit: 4,   acc: 0.10 } },
    gun:     { id: 'gun',     name: 'Hunting Bow',        icon: '🏹', slot: 'rhand', bonus: { maxHit: 8,   acc: 0.20 } },
    fanny:   { id: 'fanny',   name: "Genie's Lamp",       icon: '🪔', slot: 'rhand', bonus: { maxHit: 999, acc: 1.00 }, instakill: true },
    // left-hand off-hand
    shield:  { id: 'shield',  name: 'Round Shield',       icon: '🛡️', slot: 'lhand', bonus: { def: 6, hp: 5 } },
    machete: { id: 'machete', name: 'Jambiya Dagger',     icon: '🗡️', slot: 'lhand', bonus: { maxHit: 3, str: 2 } },
    // head
    gasmask: { id: 'gasmask', name: 'Desert Turban',      icon: '👳', slot: 'head', bonus: { def: 3, hp: 4 } },
    hazhood: { id: 'hazhood', name: 'Nomad Hood',         icon: '🧣', slot: 'head', bonus: { def: 2, str: 2 } },
    // body
    hazvest: { id: 'hazvest', name: 'Padded Tunic',       icon: '🥋', slot: 'body', bonus: { def: 6, hp: 8 } },
    plate:   { id: 'plate',   name: 'Bronze Cuirass',     icon: '🧥', slot: 'body', bonus: { def: 9, hp: 10 } },
    // legs
    greaves: { id: 'greaves', name: 'Leather Greaves',    icon: '👖', slot: 'legs', bonus: { def: 4, hp: 5 } }
  };

  function isGear(id) { return !!GEAR[id]; }

  function init() {
    for (var k in data) { data[k].xp = 0; data[k].level = 1; }
    // fixed-size inventory: 28 slots, each null or an item stack (holes allowed
    // so items can be dragged to any square).
    Game.inventory = [];
    for (var s = 0; s < Game.invMax; s++) Game.inventory[s] = null;
    // equipment slots, all empty to start
    Game.equipment = { head: null, body: null, legs: null, lhand: null, rhand: null };
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
      if (window.UI) UI.toast(s.name, s.level);
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
      if (window.UI) UI.showActionText('You catch ' + (ITEMS[catchId] ? 'a ' + ITEMS[catchId].name : 'something') + '.');
      // fishing spots don't deplete; they teem with mutated life
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
  // Push HP bonus into the player's max HP (other bonuses are read live in combat).
  function applyEquipmentToStats() {
    if (window.Player && Player.applyBonuses) Player.applyBonuses(equipBonus());
    if (window.UI) UI.updateVitals();
  }

  // Equip the gear in inventory slot `index` into its matching equipment slot,
  // sending whatever was already equipped back to the inventory.
  function equipFromInventory(index) {
    var item = Game.inventory[index];
    if (!item) return false;
    var g = GEAR[item.id];
    if (!g) { if (window.UI) UI.showActionText("You can't equip that."); return false; }
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

  return {
    init: init, addXp: addXp, addItem: addItem,
    doWoodcut: doWoodcut, doMine: doMine, doFish: doFish,
    equipFromInventory: equipFromInventory, unequip: unequip,
    eat: eat, dropItem: dropItem, hasItem: hasItem, removeItem: removeItem,
    equipBonus: equipBonus, isGear: isGear, isFood: isFood,
    COOK: COOK,
    get data() { return data; },
    ITEMS: ITEMS, GEAR: GEAR, EQUIP_SLOTS: EQUIP_SLOTS, SKILL_ORDER: SKILL_ORDER
  };
})();
