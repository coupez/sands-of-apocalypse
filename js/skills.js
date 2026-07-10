// ============================================================
// skills.js — Woodcutting / Mining / Attack XP + inventory
// ============================================================

var Skills = (function () {
  var data = {
    woodcutting: { name: 'Woodcutting', xp: 0, level: 1 },
    mining:      { name: 'Mining',      xp: 0, level: 1 },
    attack:      { name: 'Attack',      xp: 0, level: 1 }
  };

  var ITEMS = {
    log: { id: 'log', name: 'Irradiated Log', icon: '🪵' },
    ore: { id: 'ore', name: 'Uranium Ore',    icon: '☢️' }
  };

  function init() {
    // fresh state
    data.woodcutting.xp = 0; data.woodcutting.level = 1;
    data.mining.xp = 0; data.mining.level = 1;
    data.attack.xp = 0; data.attack.level = 1;
    Game.inventory = [];
    if (window.UI) { UI.updateSkills(); UI.updateInventory(); }
  }

  function addXp(skill, amount) {
    var s = data[skill];
    if (!s) return;
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

  // add item to inventory (stacks). returns true if added.
  function addItem(id) {
    var def = ITEMS[id];
    if (!def) return false;
    for (var i = 0; i < Game.inventory.length; i++) {
      if (Game.inventory[i].id === id) {
        Game.inventory[i].count++;
        if (window.UI) UI.updateInventory(i);
        SFX.pickup();
        return true;
      }
    }
    if (Game.inventory.length >= Game.invMax) return false; // full
    Game.inventory.push({ id: id, name: def.name, icon: def.icon, count: 1 });
    if (window.UI) UI.updateInventory(Game.inventory.length - 1);
    SFX.pickup();
    return true;
  }

  function successChance(level) {
    return Utils.clamp(0.55 + (level - 1) * 0.03, 0.55, 0.95);
  }

  function doWoodcut(tree) {
    if (!tree || !tree.active) return;
    if (Utils.rand() > successChance(data.woodcutting.level)) return; // no log this swing
    if (addItem('log')) {
      addXp('woodcutting', 25);
      tree.amount--;
      Game.log.push('woodcut');
      if (window.UI) UI.showActionText('You get some irradiated logs.');
      if (tree.amount <= 0) Entities.depleteResource(tree);
    } else {
      if (window.UI) UI.showActionText('Your inventory is full!');
    }
  }

  function doMine(rock) {
    if (!rock || !rock.active) return;
    if (Utils.rand() > successChance(data.mining.level)) return;
    if (addItem('ore')) {
      addXp('mining', 35);
      rock.amount--;
      Game.log.push('mine');
      if (window.UI) UI.showActionText('You mine some uranium ore.');
      if (rock.amount <= 0) Entities.depleteResource(rock);
    } else {
      if (window.UI) UI.showActionText('Your inventory is full!');
    }
  }

  return {
    init: init, addXp: addXp, addItem: addItem,
    doWoodcut: doWoodcut, doMine: doMine,
    get data() { return data; },
    ITEMS: ITEMS
  };
})();
