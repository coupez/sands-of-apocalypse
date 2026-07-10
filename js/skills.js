// ============================================================
// skills.js — skills (Woodcutting/Mining/Fishing/Attack/Strength/
// Defence), inventory, items, and equippable weapons.
// ============================================================

var Skills = (function () {
  var SKILL_ORDER = ['attack', 'strength', 'defence', 'woodcutting', 'mining', 'fishing'];
  var data = {
    attack:      { name: 'Attack',      icon: '⚔️', xp: 0, level: 1 },
    strength:    { name: 'Strength',    icon: '💪', xp: 0, level: 1 },
    defence:     { name: 'Defence',     icon: '🛡️', xp: 0, level: 1 },
    woodcutting: { name: 'Woodcutting', icon: '🪓', xp: 0, level: 1 },
    mining:      { name: 'Mining',      icon: '⛏️', xp: 0, level: 1 },
    fishing:     { name: 'Fishing',     icon: '🎣', xp: 0, level: 1 }
  };

  var ITEMS = {
    log:   { id: 'log',   name: 'Irradiated Log', icon: '🪵' },
    blog:  { id: 'blog',  name: 'Blightwood Log', icon: '🎍' },
    ore:   { id: 'ore',   name: 'Uranium Ore',    icon: '☢️' },
    pore:  { id: 'pore',  name: 'Plutonium Ore',  icon: '🟣' },
    fish:  { id: 'fish',  name: 'Mutated Fish',   icon: '🐟' },
    bfish: { id: 'bfish', name: 'Three-Eyed Fish', icon: '🐡' }
  };

  // Equippable weapons. Fanny Pack is the ultimate weapon: it instakills.
  var WEAPONS = {
    fists: { id: 'fists', name: 'Bare Fists',         icon: '👊', maxHit: 0,   acc: 0.00 },
    sword: { id: 'sword', name: 'Scrap Sword',        icon: '🗡️', maxHit: 4,   acc: 0.10 },
    gun:   { id: 'gun',   name: 'Rusty Pistol',       icon: '🔫', maxHit: 8,   acc: 0.20 },
    fanny: { id: 'fanny', name: 'Fanny Pack of Doom', icon: '🎒', maxHit: 999, acc: 1.00, instakill: true }
  };

  function init() {
    for (var k in data) { data[k].xp = 0; data[k].level = 1; }
    Game.inventory = [];
    Game.equipped = WEAPONS.fists;
    if (window.UI) { UI.updateSkills(); UI.updateInventory(); UI.updateWeapon(); }
  }

  function addXp(skill, amount) {
    var s = data[skill];
    if (!s || amount <= 0) return;
    var before = s.level;
    s.xp += amount;
    s.level = Utils.levelForXp(s.xp);
    if (s.level > before) {
      SFX.level();
      if (window.UI) UI.toast(s.name, s.level);
      Game.log.push('levelup:' + skill + ':' + s.level);
    }
    if (window.UI) UI.updateSkills();
  }

  function addItem(id) {
    var def = ITEMS[id];
    if (!def) return false;
    for (var i = 0; i < Game.inventory.length; i++) {
      if (Game.inventory[i].id === id) { Game.inventory[i].count++; if (window.UI) UI.updateInventory(i); SFX.pickup(); return true; }
    }
    if (Game.inventory.length >= Game.invMax) return false;
    Game.inventory.push({ id: id, name: def.name, icon: def.icon, count: 1 });
    if (window.UI) UI.updateInventory(Game.inventory.length - 1);
    SFX.pickup();
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
    if (addItem(pool.itemId || 'fish')) {
      addXp('fishing', pool.xp || 30);
      Game.log.push('fish');
      if (window.UI) UI.showActionText('You catch a ' + (ITEMS[pool.itemId || 'fish'].name) + '.');
      // pools don't deplete; they teem with mutated life
    } else if (window.UI) UI.showActionText('Your inventory is full!');
  }

  // ---- weapons ----
  function equip(id) {
    var w = WEAPONS[id];
    if (!w) return;
    Game.equipped = w;
    if (window.UI) { UI.updateWeapon(); UI.showActionText('Equipped: ' + w.name); }
    Game.log.push('equip:' + id);
  }

  return {
    init: init, addXp: addXp, addItem: addItem,
    doWoodcut: doWoodcut, doMine: doMine, doFish: doFish,
    equip: equip,
    get data() { return data; },
    ITEMS: ITEMS, WEAPONS: WEAPONS, SKILL_ORDER: SKILL_ORDER
  };
})();
