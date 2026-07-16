// ============================================================
// selftest.js — headless end-to-end self-test (?selftest)
// Exercises movement, woodcutting, mining, combat, death & respawn,
// then writes a JSON verdict to #selftest-result, window.__selftestResult,
// document.title and the console for headless capture.
// ============================================================

var SelfTest = (function () {
  var results = [];

  function assert(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || '' });
  }

  function dist(a, bx, bz) { return Math.hypot(a.x - bx, a.z - bz); }

  function invadeInvulnerable() { // survive AI while testing gathering/combat
    Player.stats.maxHp = 100000;
    Player.stats.hp = 100000;
  }

  function run() {
    try {
      Utils.seed(20260710);

      // -- boot sanity --
      assert('scene created', !!Game.scene);
      assert('camera created', !!Game.camera);
      assert('player built', !!Game.player && !!Player.group);
      assert('entities: trees', Entities.trees.length > 0, Entities.trees.length + ' trees');
      assert('entities: rocks', Entities.rocks.length > 0, Entities.rocks.length + ' rocks');
      assert('entities: enemies', Entities.enemies.length > 0, Entities.enemies.length + ' enemies');
      assert('interact meshes', Entities.interactMeshes.length > 0, Entities.interactMeshes.length + ' meshes');

      invadeInvulnerable();

      // -- movement --
      Player.walkTo({ x: 6, z: 3 });
      Main.advance(3.0);
      assert('click-to-move', dist(Player.position, 6, 3) < 2.0,
        'dist=' + dist(Player.position, 6, 3).toFixed(2));

      // -- woodcutting --
      var wcXp0 = Skills.data.woodcutting.xp;
      // pick the nearest reqLevel-1 tree the level-1 player can actually chop
      var wtrees = Entities.trees.filter(function (t) { return t.active && t.reqLevel === 1; });
      wtrees.sort(function (a, b) { return dist(Player.position, a.position.x, a.position.z) - dist(Player.position, b.position.x, b.position.z); });
      var tree = wtrees[0];
      assert('found active tree', !!tree);
      if (tree) {
        Player.interactWith(tree);
        Main.advance(24);
        assert('woodcutting xp gained', Skills.data.woodcutting.xp > wcXp0,
          'xp ' + wcXp0 + ' -> ' + Skills.data.woodcutting.xp);
        assert('log in inventory',
          Game.inventory.some(function (i) { return i && i.id === 'log'; }),
          JSON.stringify(Game.inventory.filter(Boolean).map(function (i) { return i.id + 'x' + i.count; })));
      }

      // -- mining --
      var mnXp0 = Skills.data.mining.xp;
      var mrocks = Entities.rocks.filter(function (r) { return r.active && r.reqLevel === 1; });
      mrocks.sort(function (a, b) { return dist(Player.position, a.position.x, a.position.z) - dist(Player.position, b.position.x, b.position.z); });
      var rock = mrocks[0];
      assert('found active rock', !!rock);
      if (rock) {
        Player.interactWith(rock);
        Main.advance(24);
        assert('mining xp gained', Skills.data.mining.xp > mnXp0,
          'xp ' + mnXp0 + ' -> ' + Skills.data.mining.xp);
        assert('ore in inventory',
          Game.inventory.some(function (i) { return i && i.id === 'ore'; }));
      }

      // -- skill roster --
      assert('skill: strength', !!Skills.data.strength);
      assert('skill: fishing', !!Skills.data.fishing);
      assert('skill: cooking added', !!Skills.data.cooking);
      assert('skill: smithing added', !!Skills.data.smithing);
      assert('skill: prayer added', !!Skills.data.prayer && Skills.data.prayer.max === 12);
      assert('skill: ranged added', !!Skills.data.ranged && Skills.data.ranged.max === 20);
      assert('defence skill removed', !Skills.data.defence);
      assert('combat skills cap at 20', Skills.data.attack.max === 20 && Skills.data.strength.max === 20);
      assert('other skills cap at 12', Skills.data.mining.max === 12 && Skills.data.cooking.max === 12);

      // -- skill categories (Combat / Resource Gathering / Skills), each with a total level --
      assert('three skill categories exist', !!Skills.CATEGORIES && Skills.CATEGORIES.length === 3);
      assert('categories are Combat / Gathering / Skills',
        Skills.CATEGORIES[0].name === 'Combat' && Skills.CATEGORIES[1].name === 'Gathering' && Skills.CATEGORIES[2].name === 'Skills');
      // renamed skills keep their internal keys (so training code is untouched)
      assert('prayer renamed to Faith', Skills.data.prayer.name === 'Faith');
      assert('ranged renamed to Range', Skills.data.ranged.name === 'Range');
      assert('woodcutting renamed to Lumbering', Skills.data.woodcutting.name === 'Lumbering');
      assert('smithing renamed to Crafting', Skills.data.smithing.name === 'Crafting');
      assert('cooking renamed to Medical', Skills.data.cooking.name === 'Medical');
      // new placeholder skills present (not trainable yet)
      assert('new placeholder skills exist', !!Skills.data.defense && !!Skills.data.hitpoints &&
        !!Skills.data.spirit && !!Skills.data.hunting && !!Skills.data.casting);
      assert('placeholder skills are flagged soon', Skills.data.defense.soon === true && Skills.data.casting.soon === true);
      // Gathering / Skills totals = the absolute sum of member levels
      assert('Gathering total = sum of member levels', Skills.categoryLevel('gathering') === Skills.categorySum('gathering'));
      // Combat total is a WEIGHTED formula (damage skills count most), not a raw sum:
      // damage skills (Strength/Range/Spirit) must move it more than defensive ones.
      var cbase = Skills.categoryLevel('combat');
      var s0 = Skills.data.strength.level;
      Skills.data.strength.level = Math.min(s0 + 12, Skills.data.strength.max);
      var cStr = Skills.categoryLevel('combat');
      Skills.data.strength.level = s0;
      var d0 = Skills.data.defense.level;
      Skills.data.defense.level = Math.min(d0 + 12, Skills.data.defense.max);
      var cDef = Skills.categoryLevel('combat');
      Skills.data.defense.level = d0;
      assert('raising a damage skill raises the Combat total', cStr > cbase);
      assert('damage skills weigh more than defensive ones', (cStr - cbase) > (cDef - cbase));
      assert('Merchant dropped from the roster', !Skills.data.merchant);

      // -- Hit Points starts at 15 and IS your base max health --
      assert('Hit Points starts at level 15', Skills.data.hitpoints.start === 15 && Skills.data.hitpoints.level >= 15);

      // -- equip requirements: weapons gate on Attack, armour on Defense, by metal tier --
      assert('copper weapon equips at Attack 1', Skills.equipReq('bronze_dagger').skill === 'attack' && Skills.equipReq('bronze_dagger').level === 1);
      assert('iron weapon needs Attack 5', Skills.equipReq('iron_dagger').level === 5);
      assert('iron armour needs Defense 5', Skills.equipReq('iron_platebody').skill === 'defense' && Skills.equipReq('iron_platebody').level === 5);
      assert('silver weapon needs Attack 8', Skills.equipReq('silver_scimitar').level === 8);
      var _a0 = Skills.data.attack.level;
      Skills.data.attack.level = 1;
      assert('cannot equip an iron weapon below the Attack req', Skills.canEquip('iron_dagger') === false);
      Skills.data.attack.level = 8;
      assert('can equip an iron weapon once Attack is high enough', Skills.canEquip('iron_dagger') === true);
      Skills.data.attack.level = _a0;

      // -- run / energy API --
      assert('run + energy API present', typeof Player.toggleRun === 'function' && Player.maxEnergy > 0 && Player.energy >= 0);

      // -- fishing (a shrimp pond near a camp: reqLevel 1) --
      var pool = Entities.pools.filter(function (p) { return p.active && p.reqLevel === 1; })[0];
      assert('found a level-1 fishing pond', !!pool, Entities.pools.length + ' ponds');
      if (pool) {
        var fxp0 = Skills.data.fishing.xp;
        for (var fi = 0; fi < 10; fi++) Skills.doFish(pool);
        assert('fishing xp gained', Skills.data.fishing.xp > fxp0, 'xp=' + Skills.data.fishing.xp);
        assert('shrimp in inventory', Game.inventory.some(function (i) { return i && i.id === 'shrimp'; }));
      }
      // fishing scales to Lv12: Sardine(1) → Crab(5) → Perch(12, the cap)
      var crabPool = Entities.pools.filter(function (p) { return p.itemId === 'lobster'; })[0];
      var perchPool = Entities.pools.filter(function (p) { return p.itemId === 'whale'; })[0];
      assert('crab pool requires Fishing 5', !!crabPool && crabPool.reqLevel === 5, 'req=' + (crabPool && crabPool.reqLevel));
      assert('perch pool requires Fishing 12 (the cap)', !!perchPool && perchPool.reqLevel === 12, 'req=' + (perchPool && perchPool.reqLevel));

      var invStacks = Game.inventory.filter(Boolean).length;
      assert('inventory populated', invStacks > 0, invStacks + ' stacks');

      // -- combat --
      invadeInvulnerable();
      var atkXp0 = Skills.data.attack.xp;
      // nearest active weak (tier-0) enemy — reliably killable within the window
      var enemies = Entities.enemies.filter(function (e) { return e.active && e.reqLevel === 1; });
      if (!enemies.length) enemies = Entities.enemies.filter(function (e) { return e.active; });
      enemies.sort(function (a, b) {
        return dist(Player.position, a.position.x, a.position.z) - dist(Player.position, b.position.x, b.position.z);
      });
      var enemy = enemies[0];
      assert('found active enemy', !!enemy);
      if (enemy) {
        var killedBefore = Game.log.filter(function (l) { return l === 'enemy:killed'; }).length;
        Player.interactWith(enemy);
        Main.advance(60);
        assert('attack xp gained', Skills.data.attack.xp > atkXp0,
          'xp ' + atkXp0 + ' -> ' + Skills.data.attack.xp);
        var didHit = Game.log.some(function (l) { return l.indexOf('playerAttack:') === 0; });
        assert('player landed attacks', didHit);
        var killedAfter = Game.log.filter(function (l) { return l === 'enemy:killed'; }).length;
        assert('an enemy was killed', killedAfter > killedBefore,
          'kills ' + killedBefore + ' -> ' + killedAfter);
      }

      // -- enemy aggro: enemy chased the player during combat --
      assert('enemy attacked player (aggro)',
        Game.log.some(function (l) { return l.indexOf('enemyAttack:') === 0; }));

      // -- combat trains Strength --
      assert('strength trained by dealing damage', Skills.data.strength.xp > 0, 'xp=' + Skills.data.strength.xp);

      // -- level gating: high-tier tree yields nothing at low level --
      var hardTree = Entities.trees.filter(function (t) { return t.reqLevel > 1; })[0];
      assert('high-tier tree exists', !!hardTree, 'reqLevel ' + (hardTree ? hardTree.reqLevel : '?'));
      if (hardTree) {
        var wcG = Skills.data.woodcutting.xp;
        for (var gi = 0; gi < 25; gi++) Skills.doWoodcut(hardTree);
        assert('gated tree yields no xp when under-levelled', Skills.data.woodcutting.xp === wcG);
      }

      // -- equipment: gear equips from the inventory into its matching slot --
      function invIndexOf(id) {
        for (var q = 0; q < Game.inventory.length; q++) if (Game.inventory[q] && Game.inventory[q].id === id) return q;
        return -1;
      }
      // a headpiece lands in the head slot and raises max HP while worn
      Skills.addItem('gasmask');
      var gmi = invIndexOf('gasmask');
      assert('headpiece entered inventory', gmi >= 0);
      Skills.equipFromInventory(gmi);
      assert('headpiece equips to head slot', Game.equipment.head === 'gasmask');
      var hpWithHelm = Player.stats.maxHp;
      assert('unequip returns gear to the bag', Skills.unequip('head') && invIndexOf('gasmask') >= 0);
      var hpNoHelm = Player.stats.maxHp;
      assert('headpiece raises max HP while worn', hpWithHelm > hpNoHelm, hpNoHelm + ' -> ' + hpWithHelm);

      // weapons: Fanny Pack of Doom instakills, equipped from the inventory
      invadeInvulnerable();
      Skills.addItem('fanny');
      Skills.equipFromInventory(invIndexOf('fanny'));
      assert('fanny pack equips to right hand', Game.equipment.rhand === 'fanny');
      assert('fanny pack grants instakill', Skills.equipBonus().instakill === true);
      var victim = Entities.enemies.filter(function (e) { return e.active; })[0];
      assert('found a victim for fanny pack', !!victim);
      if (victim) {
        var killsBefore = Game.log.filter(function (l) { return l === 'enemy:killed'; }).length;
        Combat.playerAttack(victim);
        assert('fanny pack instakills in one hit',
          victim.hp <= 0 && Game.log.filter(function (l) { return l === 'enemy:killed'; }).length > killsBefore);
      }
      Skills.unequip('rhand');

      // -- crafting stations (replace chests): furnace → bar, anvil → gear, campfire → cook --
      function clearBag() { for (var c = 0; c < Game.invMax; c++) Game.inventory[c] = null; }
      function invCount(id) { return Game.inventory.filter(function (it) { return it && it.id === id; }).length; }
      clearBag();
      var furnace = Entities.stations.filter(function (s) { return s.kind === 'furnace'; })[0];
      assert('furnace exists in town', !!furnace, Entities.stations.length + ' stations');
      if (furnace) {
        Entities.useStation(furnace);                 // no log yet → stays unlit
        assert('furnace needs a log before it lights', furnace.lit === false);
        Skills.addItem('log');
        Entities.useStation(furnace);                 // log lights the furnace
        assert('furnace lights when given a log', furnace.lit === true);
        Skills.addItem('ore');
        Entities.useStation(furnace);                 // copper ore smelts into a bronze bar
        assert('lit furnace smelts copper into a bronze bar', invCount('bronzebar') === 1, 'bars=' + invCount('bronzebar'));
        assert('smelting trains Smithing', Skills.data.smithing.xp > 0, 'xp=' + Skills.data.smithing.xp);
        // higher metals are gated by the furnace's UPGRADE level
        Skills.addItem('silver');
        Entities.useStation(furnace);                 // Lv1 furnace can't smelt silver (needs Lv3)
        assert('silver ore gated by furnace level', invCount('silverbar') === 0 && Skills.hasItem('silver'));
      }
      // -- smithing at the anvil (anvil-level + bar gated) --
      var anvil = Entities.stations.filter(function (s) { return s.kind === 'anvil'; })[0];
      assert('anvil exists in town', !!anvil);
      clearBag();
      Skills.addItem('bronzebar');
      assert('can smith a Copper Helmet (1 bar, Lv1)', Skills.smith('bronze_helmet', 1) === true);
      assert('bronze helmet is in the bag', invCount('bronze_helmet') === 1);
      assert('helmet equips into the head slot', (function () { Skills.equipFromInventory(invIndexOf('bronze_helmet')); return Game.equipment.head === 'bronze_helmet'; })());
      assert('smithing above the anvil level is blocked', Skills.smith('silver_platebody', 1) === false && invCount('silver_platebody') === 0);
      Skills.addItem('bronzebar');                    // only 1 bar; platebody needs 3
      assert('smithing without enough bars is blocked', Skills.smith('bronze_platebody', 1) === false);
      assert('boots go in the new feet slot', (function () { clearBag(); Skills.addItem('bronzebar'); Skills.smith('bronze_boots', 1); Skills.equipFromInventory(invIndexOf('bronze_boots')); return Game.equipment.feet === 'bronze_boots'; })());

      // -- weapons upgrade tier-by-tier (need the previous metal's weapon) --
      clearBag(); Skills.addItem('ironbar');
      assert('iron weapon is blocked without the bronze one', Skills.smith('iron_dagger', 2) === false && invCount('iron_dagger') === 0);
      Skills.addItem('bronze_dagger');
      assert('iron dagger upgrades from an iron bar + a bronze dagger', Skills.smith('iron_dagger', 2) === true && invCount('iron_dagger') === 1 && invCount('bronze_dagger') === 0);
      assert('bronze weapon needs no prior tier', (function () { clearBag(); Skills.addItem('bronzebar'); Skills.addItem('bronzebar'); return Skills.smith('bronze_scimitar', 1) === true; })());

      // -- Tin Akal endgame tier: meteorite (master-gated) → smelt → smith with Elderwood --
      var met = Entities.meteorites && Entities.meteorites[0];
      assert('a fallen meteorite exists', !!met, Entities.meteorites ? Entities.meteorites.length + ' meteorites' : 'none');
      if (met) {
        clearBag();
        Skills.data.mining.level = 1; Skills.data.woodcutting.level = 1;
        Entities.mineMeteorite(met);
        assert('meteorite is gated behind max Mining + Woodcutting', invCount('tinakal') === 0);
        Skills.data.mining.level = 12; Skills.data.woodcutting.level = 12;
        for (var mm = 0; mm < 300 && invCount('tinakal') < 1; mm++) Entities.mineMeteorite(met);
        assert('a master mines Tin Akal from the meteorite', invCount('tinakal') >= 1);
        if (furnace) {
          furnace.level = 4;
          if (!furnace.lit) { Skills.addItem('log'); Entities.useStation(furnace); }
          Entities.useStation(furnace);
          assert('a Lv4 furnace smelts Tin Akal into a bar', invCount('tinakalbar') >= 1, 'bars=' + invCount('tinakalbar'));
        }
        clearBag();
        Skills.addItem('tinakalbar'); Skills.addItem('elderwood');
        assert('Tin Akal weapon is blocked without the prior-tier Gold weapon', Skills.smith('tinakal_dagger', 4) === false && invCount('tinakal_dagger') === 0);
        Skills.addItem('gold_dagger');
        assert('Tin Akal Dagger smiths from bar + Elderwood + a Gold Dagger at Lv4', Skills.smith('tinakal_dagger', 4) === true && invCount('tinakal_dagger') === 1);
      }

      // -- the named merchant + deferred payment (Merchant is no longer a skill) --
      clearBag();
      Game.gold = 0;
      assert('name generator makes "Name of Place" Egyptian names', Utils.egyptianName().indexOf(' of ') > 0);
      assert('Merchant is NOT a trainable skill anymore', !Skills.data.merchant);
      var merchant = Entities.stations.filter(function (s) { return s.kind === 'merchant'; })[0];
      assert('the merchant has a name above the camel', !!(merchant && merchant.camel && merchant.camel.name && merchant.camel.name.indexOf(' of ') > 0));
      if (merchant) {
        Skills.addItem('elderwood');
        Entities.sellToMerchant(merchant, invIndexOf('elderwood'));
        assert('selling loads the caravan — payment is pending, not immediate',
          invIndexOf('elderwood') < 0 && (Game.gold || 0) === 0 && merchant.camel.pending > 0);
        Entities.sendCaravan(merchant);
        assert('caravan departs → merchant is busy', Entities.merchantBusy(merchant) === true);
        invadeInvulnerable();
        Main.advance(32);       // leave (~8s) + deliver (~8s) + return (~8s)
        assert('caravan returns and pays out the pending gold',
          Entities.merchantBusy(merchant) === false && Game.gold > 0 && merchant.camel.pending === 0);
      }
      if (anvil) {
        var lvl0 = anvil.level;
        Game.gold = 0;
        assert('upgrade blocked without gold', Entities.upgradeStation(anvil) === false && anvil.level === lvl0);
        Game.gold = 500;
        assert('upgrade works with gold', Entities.upgradeStation(anvil) === true && anvil.level === lvl0 + 1);
        assert('upgrading spent the gold', Game.gold < 500);
        // now the Lv2 anvil can smith iron
        clearBag(); Skills.addItem('ironbar');
        assert('Lv2 anvil can smith iron gear', Skills.smith('iron_helmet', anvil.level) === true);
        assert('Lv1 anvil still cannot smith iron', Skills.smith('iron_helmet', 1) === false);
      }
      // fishing spot upgrades with gold and raises its catch tier
      var camppond = Entities.pools.filter(function (p) { return p.upgradable; })[0];
      assert('camp fishing spot exists', !!camppond, Entities.pools.length + ' ponds');
      if (camppond) {
        var pl0 = camppond.level;
        Game.gold = 500;
        assert('fishing spot upgrades with gold', Entities.upgradeStation(camppond) === true && camppond.level === pl0 + 1);
        assert('upgraded pond offers a higher catch', camppond.reqLevel > 1);
      }

      // -- bandit camps: waves → boss (Mahmut) → essence + bones drops --
      clearBag();
      invadeInvulnerable();
      assert('two bandit camps stand east & west', Entities.banditCamps.length === 2, Entities.banditCamps.length + ' camps');
      var bcamp = Entities.banditCamps[0];
      assert('camp opens with a band of 5 bandits', !!bcamp && bcamp.alive.length === 5, 'alive=' + (bcamp && bcamp.alive.length));
      assert('bandits are local (fightable while online)', !!bcamp && bcamp.alive[0].local === true);
      function clearBand(camp) { camp.alive.slice().forEach(function (b) { b.hp = 0; Entities.killEnemy(b); }); }
      if (bcamp) {
        var bonesBefore = Entities.drops.filter(function (d) { return d.itemId === 'bones'; }).length;
        clearBand(bcamp); Main.advance(3.2);
        assert('a cleared band drops bones', Entities.drops.filter(function (d) { return d.itemId === 'bones'; }).length > bonesBefore);
        assert('clearing 5 escalates to band 2 (5 raiders)', bcamp.wave === 1 && bcamp.alive.length === 5, 'wave=' + bcamp.wave + ' alive=' + bcamp.alive.length);
        clearBand(bcamp); Main.advance(3.2);
        assert('clearing 5 escalates to band 3 (5 marauders)', bcamp.wave === 2 && bcamp.alive.length === 5, 'wave=' + bcamp.wave + ' alive=' + bcamp.alive.length);
        clearBand(bcamp); Main.advance(3.2);
        assert('clearing band 3 summons the boss Mahmut of the Valley',
          bcamp.wave === 3 && bcamp.alive.length === 1 && bcamp.alive[0].name === 'Mahmut of the Valley',
          'wave=' + bcamp.wave + ' name=' + (bcamp.alive[0] && bcamp.alive[0].name));
        clearBand(bcamp); Main.advance(2.5);
        assert('defeating the boss clears the camp', bcamp.cleared === true);
        assert('the boss drops a Bandit Essence', Entities.drops.some(function (d) { return d.itemId === 'essence' && d.active; }));
      }
      // picking up a drop grants its item
      var essDrop = Entities.drops.filter(function (d) { return d.itemId === 'essence' && d.active; })[0];
      assert('an essence drop lies on the ground', !!essDrop);
      if (essDrop) { Entities.pickupDrop(essDrop); assert('picking up a drop grants the item', Skills.hasItem('essence')); }

      // -- Prayer: burying bandit bones trains the Prayer skill --
      var boneDrop = Entities.drops.filter(function (d) { return d.itemId === 'bones' && d.active; })[0];
      assert('bones lie on the ground to bury', !!boneDrop);
      if (boneDrop) {
        Entities.pickupDrop(boneDrop);
        var prayer0 = Skills.data.prayer.xp;
        Skills.bury(invIndexOf('bones'));
        assert('burying bones trains Prayer', Skills.data.prayer.xp > prayer0, 'xp=' + Skills.data.prayer.xp);
        assert('bones are consumed on burial', invIndexOf('bones') < 0);
      }

      // -- ranged weapon: fletch a Desert Longbow and confirm it reads as ranged --
      clearBag();
      Skills.addItem('log'); Skills.addItem('log');
      assert('fletching a bow from 2 logs works', Skills.craftBow() === true && invIndexOf('bow') >= 0);
      Skills.equipFromInventory(invIndexOf('bow'));
      assert('bow equips to the right hand', Game.equipment.rhand === 'bow');
      assert('the bow reads as a ranged weapon', Skills.isRanged() === true);
      // firing a bow trains the Ranged skill (not Attack/Strength)
      invadeInvulnerable();
      var rangedXp0 = Skills.data.ranged.xp, atkXpBow0 = Skills.data.attack.xp;
      var bowTarget = Entities.enemies.filter(function (e) { return e.active; })[0];
      assert('found a target to shoot', !!bowTarget);
      if (bowTarget) {
        for (var bq = 0; bq < 6; bq++) Combat.playerAttack(bowTarget);
        assert('firing a bow trains Ranged', Skills.data.ranged.xp > rangedXp0, 'ranged xp=' + Skills.data.ranged.xp);
        assert('firing a bow does not train melee Attack', Skills.data.attack.xp === atkXpBow0);
      }
      Skills.unequip('rhand');
      assert('unarmed is not ranged', Skills.isRanged() === false);

      // -- rats: ambient, attackable critters giving tiny XP --
      assert('rats populate the desert', Entities.rats.length > 0, Entities.rats.length + ' rats');
      var rat = Entities.rats.filter(function (r) { return r.active; })[0];
      assert('found a live rat', !!rat);
      assert('rats are local (fightable while online)', !!rat && rat.local === true);
      if (rat) {
        invadeInvulnerable();
        var ratKills0 = Game.log.filter(function (l) { return l === 'enemy:killed'; }).length;
        for (var rk = 0; rk < 10 && rat.active; rk++) Combat.playerAttack(rat);
        assert('a rat can be slain', Game.log.filter(function (l) { return l === 'enemy:killed'; }).length > ratKills0);
      }

      // -- endgame: forge the Heart of the Obelisk at the altar, place it to win --
      clearBag();
      Skills.data.prayer.xp = 0; Skills.data.prayer.level = 1;   // start un-maxed
      var altar = Entities.stations.filter(function (s) { return s.kind === 'altar'; })[0];
      assert('ancient altar exists', !!altar);
      if (altar) {
        Skills.addItem('elderwood'); Skills.addItem('whale'); Skills.addItem('pore'); Skills.addItem('essence');
        Entities.useStation(altar);
        assert('altar is blocked until Prayer is maxed', invCount('orb') === 0);
        Skills.addXp('prayer', 9999999);
        assert('Prayer caps at level 12', Skills.data.prayer.level === 12, 'lvl=' + Skills.data.prayer.level);
        Entities.useStation(altar);
        assert('altar forges the Heart from fish + ore + elderwood + essence at max Prayer', invCount('orb') === 1);
        assert('altar consumed the materials',
          !Skills.hasItem('elderwood') && !Skills.hasItem('whale') && !Skills.hasItem('pore') && !Skills.hasItem('essence'));
      }
      var obel = Entities.obelisk;
      assert('obelisk stands at the centre', !!obel);
      if (obel) {
        assert('obelisk not yet won', obel.done === false);
        Entities.useObelisk();
        assert('placing the Orb wins the game', obel.done === true && invCount('orb') === 0);
      }
      clearBag();
      var campfire = Entities.stations.filter(function (s) { return s.kind === 'campfire'; })[0];
      assert('campfire exists in town', !!campfire);
      if (campfire) {
        Skills.addItem('log');
        Entities.useStation(campfire);                // log lights the campfire
        assert('campfire lights when given a log', campfire.lit === true);
        Skills.addItem('shrimp');
        Entities.useStation(campfire);                // raw shrimp cooks into cooked shrimp
        assert('lit campfire cooks raw shrimp into cooked', invCount('cshrimp') === 1, 'cshrimp=' + invCount('cshrimp'));
        assert('cooking trains Cooking', Skills.data.cooking.xp > 0, 'xp=' + Skills.data.cooking.xp);
      }
      // -- level caps: gathering/production cap at 12, combat at 20 --
      Skills.data.woodcutting.xp = 0; Skills.addXp('woodcutting', 9999999);
      assert('woodcutting caps at level 12', Skills.data.woodcutting.level === 12, 'lvl=' + Skills.data.woodcutting.level);
      Skills.data.attack.xp = 0; Skills.addXp('attack', 1e12);   // L20 needs ~320M xp on the geometric curve
      assert('attack caps at level 20', Skills.data.attack.level === 20, 'lvl=' + Skills.data.attack.level);
      clearBag();

      // -- items: non-stacking, edible fish, dropping --
      function countId(id) { return Game.inventory.filter(function (it) { return it && it.id === id; }).length; }
      var logs0 = countId('log');
      Skills.addItem('log'); Skills.addItem('log');
      assert('logs do not stack (each takes a slot)', countId('log') === logs0 + 2, countId('log') + ' log slots');

      // raw seafood is inedible; only cooked heals — and eating locks out attacks
      assert('raw shrimp is not edible', Skills.isFood('shrimp') === false);
      assert('cooked shrimp is edible', Skills.isFood('cshrimp') === true);
      Player.stats.maxHp = 20; Player.stats.hp = 5;
      Skills.addItem('shrimp');
      Skills.eat(invIndexOf('shrimp'));                 // raw: no effect, not consumed
      assert('eating raw shrimp does nothing', Player.stats.hp === 5 && countId('shrimp') === 1, 'hp=' + Player.stats.hp);
      Skills.addItem('cshrimp');
      var cs0 = countId('cshrimp');
      Skills.eat(invIndexOf('cshrimp'));                // cooked: heals +2 and starts the lockout
      assert('eating cooked shrimp heals +2 HP', Player.stats.hp === 7, 'hp=' + Player.stats.hp);
      assert('cooked shrimp consumed', countId('cshrimp') === cs0 - 1);
      assert('cannot attack right after eating', Player.canAttack() === false);
      invadeInvulnerable();                             // survive the wait while enemies roam
      Main.advance(3.2);                                // wait out the ~3s lockout
      assert('can attack again after the lockout', Player.canAttack() === true);

      Skills.addItem('ore');
      var ore0 = countId('ore');
      Skills.dropItem(invIndexOf('ore'));
      assert('dropping removes one item', countId('ore') === ore0 - 1);
      // counts must match the server's authoritative indices
      assert('entity counts match server indices',
        Entities.trees.length === 11 && Entities.rocks.length === 8 && Entities.enemies.length === 9,
        't' + Entities.trees.length + ' r' + Entities.rocks.length + ' e' + Entities.enemies.length);
      // resources spread across the field but stay OUT of the centre ceremony plaza
      assert('centre plaza is kept clear of resources',
        Entities.trees.concat(Entities.rocks).every(function (e) { return Math.hypot(e.position.x, e.position.z) >= 14; }),
        'min r=' + Math.round(Math.min.apply(null, Entities.trees.concat(Entities.rocks).map(function (e) { return Math.hypot(e.position.x, e.position.z); }))));
      // smithed gear uses distinct per-type icons (not a single '■')
      assert('smithed gear has distinct type icons',
        (function () { var h = Skills.SMITH_RECIPES.filter(function (r) { return r.id === 'bronze_helmet'; })[0]; return !!h && h.icon === '⛑️'; })());

      // -- enemy visuals keep the animatable skeleton the anim system drives --
      var e0 = Entities.enemies[0];
      assert('enemy has animatable parts skeleton',
        !!(e0.parts && e0.parts.armL && e0.parts.armR && e0.parts.legL && e0.parts.legR && e0.parts.body),
        'keys ' + (e0.parts ? Object.keys(e0.parts).join(',') : 'none'));

      // -- enemy attack swing trigger (this is exactly what the server syncs across clients) --
      var eAlive = Entities.enemies.filter(function (e) { return e.active && e.state !== 'dead'; })[0] || Entities.enemies[0];
      eAlive.state = 'wander'; eAlive._swing = 0;
      Entities.enemyAttackAnim(eAlive.index);
      assert('enemyAttackAnim triggers a strike swing', eAlive._swing === 1, 'swing=' + eAlive._swing);

      // (building roof-lift test removed — the town now uses camps + crafting
      // stations instead of ruined buildings; the roof-lift code is retained
      // in entities.js for any future buildings.)

      // -- PvP (player-vs-player) --
      Player.stats.maxHp = 50; Player.stats.hp = 50;
      var sent = null;
      var realSend = Net.sendAttack;
      Net.sendAttack = function (id, dmg) { sent = { id: id, dmg: dmg }; };
      var atkXpP0 = Skills.data.attack.xp;
      Combat.playerAttackPlayer({ id: 'ghost', active: true, type: 'player', name: 'Ghost', position: { x: 0, y: 0, z: 0 } });
      assert('pvp: attack relayed to server', sent && sent.id === 'ghost', JSON.stringify(sent));
      assert('pvp: attacker gains xp', Skills.data.attack.xp > atkXpP0);
      Net.sendAttack = realSend;
      var hpP0 = Player.stats.hp;
      Combat.receivePvpDamage(7);
      assert('pvp: incoming damage applied', Player.stats.hp === hpP0 - 7, 'hp ' + hpP0 + '->' + Player.stats.hp);
      Player.stats.hp = 50;
      Player.dodge();
      var hpP1 = Player.stats.hp;
      Combat.receivePvpDamage(9);
      assert('pvp: damage dodged with i-frames',
        Player.stats.hp === hpP1 && Game.log.indexOf('pvpDodged') >= 0, 'hp=' + Player.stats.hp);
      Main.advance(1.2); // end the roll + cooldown

      // -- dodge roll (i-frames) --
      Player.stats.maxHp = 20;
      Player.stats.hp = 20;
      var freshEnemy = Entities.enemies.filter(function (e) { return e.active; })[0] || Entities.enemies[0];
      Player.dodge();
      assert('dodge started', Game.log.indexOf('dodge') >= 0);
      assert('i-frames active during roll', Player.isInvulnerable());
      var hpPreDodge = Player.stats.hp;
      Combat.enemyAttack(freshEnemy); // should be fully avoided
      assert('dodge avoids all damage',
        Player.stats.hp === hpPreDodge && Game.log.indexOf('dodgeAvoided') >= 0,
        'hp=' + Player.stats.hp);
      Main.advance(1.2); // finish the roll + cooldown
      assert('dodge ends & i-frames drop', !Player.isInvulnerable() && Player.state !== 'dodge',
        'state=' + Player.state);

      // -- death sequence --
      Player.stats.maxHp = 20;
      Player.stats.hp = 5;
      Player.takeDamage(999);
      assert('death started', Game.log.indexOf('death:start') >= 0);
      assert('flemish death line triggered', Game.log.indexOf('deathLine') >= 0);
      Main.advance(5.0);
      assert('player is dead', Player.isDead);
      assert('death animation completed', Game.log.indexOf('death:done') >= 0);
      var deathScreen = document.getElementById('death-screen');
      assert('death screen shown', deathScreen && deathScreen.classList.contains('show'));

      // -- respawn --
      Player.reset();
      Entities.reset();
      assert('respawn restores hp', Player.stats.hp === Player.stats.maxHp,
        'hp=' + Player.stats.hp + '/' + Player.stats.maxHp);
      assert('respawn state idle', !Player.isDead && Player.state === 'idle', 'state=' + Player.state);
      // player respawns at their OWN camp (default test slot = 1 = north)
      assert('respawn returns the player to their camp',
        dist(Player.position, World.CAMPS.north.x, World.CAMPS.north.z) < 1.5,
        'pos=' + Player.position.x.toFixed(1) + ',' + Player.position.z.toFixed(1));

      // -- clearing a target that dies (don't chase a respawned PvP victim) --
      Player.stop();
      Player.interactWith({ type: 'player', active: true, hp: 0, state: 'dead', name: 'Ghost', position: { x: 8, y: 0, z: 8 } });
      Main.advance(0.3);
      assert('a target that dies is cleared', Player.interaction === null, 'interaction=' + (Player.interaction ? 'set' : 'null'));

      // -- full round restart: wipes progress + resets the world --
      Skills.addItem('log'); Skills.addGold(40); Skills.data.mining.xp = 0; Skills.addXp('mining', 400);
      Entities.newRound();
      assert('newRound clears the obelisk win-state', Entities.obelisk.done === false);
      assert('newRound clears ground drops', Entities.drops.length === 0);
      assert('newRound re-opens bandit camps at wave 0',
        Entities.banditCamps[0].wave === 0 && Entities.banditCamps[0].alive.length === 5,
        'wave=' + Entities.banditCamps[0].wave + ' alive=' + Entities.banditCamps[0].alive.length);
      assert('newRound wipes inventory + gold', Game.inventory.filter(Boolean).length === 0 && (Game.gold || 0) === 0);
      assert('newRound resets skills to level 1', Skills.data.mining.level === 1 && Skills.data.attack.level === 1);

      // -- game modes: host chooser applies a chosen mode on the client --
      assert('offline defaults to a coop sandbox', Game.mode === 'coop');
      assert('Mode module present', !!window.Mode && typeof Mode.setMode === 'function');
      Mode.setMode('versus');
      assert('Mode.setMode(versus) applies', Game.mode === 'versus' && Game.log.indexOf('mode:versus') >= 0);
      Mode.setMode('coop');
      assert('Mode.setMode(coop) applies', Game.mode === 'coop');

      // -- co-op: Ritual of Five Sigils (Mode.setMode(coop) activated Coop) --
      assert('Coop module present & active', !!window.Coop && Coop.active === true);
      // weapon archetypes: fast dagger < scimitar < heavy greatsword
      assert('three melee weapon archetypes exist',
        !!Skills.GEAR.bronze_dagger && !!Skills.GEAR.bronze_scimitar && !!Skills.GEAR.bronze_greatsword);
      assert('archetypes have distinct attack speeds',
        Skills.GEAR.bronze_dagger.speed < Skills.GEAR.bronze_scimitar.speed && Skills.GEAR.bronze_scimitar.speed < Skills.GEAR.bronze_greatsword.speed);
      clearBag(); Skills.addItem('bronze_greatsword'); Skills.equipFromInventory(invIndexOf('bronze_greatsword'));
      assert('the equipped weapon sets the attack speed', Skills.weaponSpeed() === Skills.GEAR.bronze_greatsword.speed);
      Skills.unequip('rhand');
      // Forge/Plenty auto-detect (nothing auto-lights yet: camps uncleared, prayer low)
      Game.forgedRitual = true; Coop.update(0.1);
      assert('smithing a greatsword lights the Forge sigil', Coop.state.sigils.forge === true);
      Game.cooked = 3; Coop.update(0.1);
      assert('cooking three fish lights the Plenty sigil', Coop.state.sigils.plenty === true);
      // Deep: mining the deep gold lights it
      Game.minedGold = true; Coop.update(0.1);
      assert('mining the deep gold lights the Deep sigil', Coop.state.sigils.deep === true);
      // Hunt: clearing both bandit camps lights it AND raids the camp
      var raidBefore = Entities.bandits.length;
      Entities.banditCamps.forEach(function (c) { c.cleared = true; });
      Coop.update(0.1);
      assert('clearing both camps lights the Hunt sigil', Coop.state.sigils.hunt === true);
      assert('lighting a sigil raids the camp', Entities.bandits.length > raidBefore, 'bandits ' + raidBefore + '->' + Entities.bandits.length);
      // Devotion: maxing Prayer lights it → ritual ready
      Skills.data.prayer.xp = 0; Skills.addXp('prayer', 9999999);
      Coop.update(0.1);
      assert('maxing Prayer lights the Devotion sigil', Coop.state.sigils.devotion === true);
      assert('three+ sigils ready the ritual', Coop.litCount() >= 3 && Coop.state.ritualReady === true, 'lit=' + Coop.litCount());
      // online: completing a sigil relays to the server rather than applying locally
      Game.online = true;
      Coop.state.sigils.plenty = false;   // pretend not yet lit for the relay check
      var sentSigil = null, realSendSigil = Net.sendSigil;
      Net.sendSigil = function (w) { sentSigil = w; };
      Coop.completeSigil('plenty');
      assert('online sigil completion relays to the server', sentSigil === 'plenty' && !Coop.state.sigils.plenty);
      Net.sendSigil = realSendSigil; Coop.state.sigils.plenty = true; Game.online = false;

      // -- build system: construct a ballista from materials --
      clearBag();
      Skills.addItem('log'); Skills.addItem('log'); Skills.addItem('log'); Skills.addItem('log');
      Skills.addItem('ironbar'); Skills.addItem('ironbar');
      var buildsBefore = Entities.builds.length;
      assert('building a ballista consumes materials', Coop.build('ballista') === true && Entities.builds.length === buildsBefore + 1);
      assert('the ballista is a usable structure', Entities.builds[Entities.builds.length - 1].type === 'ballista');

      // -- co-op finale: summon Mahrûk; asymmetric weak points + stagger --
      assert('the ritual is ready to summon', Coop.state.ritualReady === true);
      Skills.data.strength.xp = 0; Skills.addXp('strength', 1e12);   // max combat for the boss fight
      Skills.data.ranged.xp = 0; Skills.addXp('ranged', 1e12);
      Player.stop();
      Entities.useObelisk();
      assert('summoning begins the boss fight', Coop.bossActive() === true && Coop.boss.hp === Coop.boss.maxHp);
      assert('lit sigils empower the fight (loadout)', Coop.hasSigil('devotion') === true && Coop.hasSigil('forge') === true);
      invadeInvulnerable();
      Main.advance(8.8);       // idle(7) → windup(1.1) → vulnerable
      assert('the boss opens a slam window',
        !!Coop.boss && Coop.boss.stage === 'vuln' && !!Coop.boss.handEnt && Coop.boss.handEnt.active === true,
        'stage=' + (Coop.boss && Coop.boss.stage));
      // meleeing the hand builds the stagger meter (small HP chip only)
      if (Game.equipment.rhand) Skills.unequip('rhand');
      var stag0 = Coop.boss.stagger || 0, hpPreHand = Coop.boss.hp;
      Combat.attackBoss(Coop.boss.handEnt);
      assert('meleeing the hand builds stagger', (Coop.boss.stagger || 0) > stag0);
      var handDmg = hpPreHand - Coop.boss.hp;
      // bowing the heart deals real HP damage — far more than the hand's chip
      clearBag(); Skills.addItem('bow'); Skills.equipFromInventory(invIndexOf('bow'));
      var hpPreHeart = Coop.boss.hp;
      Combat.attackBoss(Coop.boss.heartEnt);
      var heartDmg = hpPreHeart - Coop.boss.hp;
      assert('the heart takes real HP damage, far above the hand chip', heartDmg > handDmg, 'hand=' + handDmg + ' heart=' + heartDmg);
      // filling the stagger meter staggers Mahrûk (a big heart-open window)
      if (Coop.boss && Coop.boss.stage === 'vuln' && Coop.boss.handEnt && Coop.boss.handEnt.active) {
        Coop.boss.stagger = 95; Skills.unequip('rhand');
        Combat.attackBoss(Coop.boss.handEnt);
        assert('a full stagger meter staggers Mahrûk', Coop.boss.stage === 'stagger');
        Skills.addItem('bow'); Skills.equipFromInventory(invIndexOf('bow'));
      }
      // a hero falling mid-fight regenerates the boss (offline)
      Coop.boss.hp = Math.round(Coop.boss.maxHp * 0.5);
      var hp50 = Coop.boss.hp;
      Coop.onPlayerDeath();
      assert('a hero falling regenerates the boss (deters zerging)', Coop.boss.hp > hp50);
      // finish it: bow the heart during windows until Mahrûk is banished
      for (var bx = 0; bx < 600 && Coop.bossActive(); bx++) {
        invadeInvulnerable();
        if (Coop.boss && Coop.boss.heartEnt && (Coop.boss.stage === 'vuln' || Coop.boss.stage === 'stagger')) Combat.attackBoss(Coop.boss.heartEnt);
        Main.advance(0.2);
      }
      assert('bowing the heart during windows defeats Mahrûk',
        Coop.bossActive() === false && Game.log.indexOf('coop:bossDead') >= 0);
      assert('Mahrûk enrages at low health and spawns imps',
        Game.log.some(function (l) { return typeof l === 'string' && l.indexOf('coop:imps') === 0; }));
      assert('the world can shift toward dusk during the ritual', typeof World.setDusk === 'function');
      // victory is final — the ritual can't be re-run
      assert('co-op victory is final', Coop.state.won === true && Coop.state.ritualReady === false);
      Entities.useObelisk();
      assert('Mahrûk cannot be re-summoned after victory', Coop.bossActive() === false);

      // -- late join mid-fight: applyState rebuilds an active server boss --
      Coop.applyState({ sigils: { hunt: true, devotion: true, forge: true }, ritualReady: true,
        boss: { active: true, hp: 300, maxHp: 600, phase: 1, stage: 'idle', hand: 'L', hx: 0, hz: 0 } });
      assert('a mid-fight late joiner reconstructs the boss',
        Coop.bossActive() === true && Coop.boss.hp === 300 && Coop.boss.simLocal === false);

      // -- versus: essence altars (place → score a point + lock out the rival) --
      Game.mode = 'versus';
      assert('three essence altars stand on the central platform', Entities.essAltars.length === 3);
      assert('the Altar of the Rock accepts the Essence of the Rock',
        !!Entities.essAltars.filter(function (a) { return a.key === 'rock' && a.essId === 'rockessence'; })[0]);
      var bAltar = Entities.essAltars.filter(function (a) { return a.key === 'bandit'; })[0];
      assert('the bandit altar awaits a Bandit Essence', !!bAltar && bAltar.essId === 'essence');
      clearBag();
      Entities.useEssenceAltar(bAltar);
      assert('cannot claim an altar without the essence', bAltar.claimedBy === null);
      Skills.addItem('essence'); Game.score = 0;
      Entities.useEssenceAltar(bAltar);
      assert('placing the essence claims the altar + scores a point',
        bAltar.claimedBy !== null && (Game.score || 0) === 1 && !Skills.hasItem('essence'));
      assert('a claimed altar is locked out (not interactable)', bAltar.active === false);
      Skills.addItem('essence');
      Entities.useEssenceAltar(bAltar);
      assert('a claimed altar rejects further placements', Skills.hasItem('essence') === true);
      Game.mode = 'coop';

      // -- resonant crystal pillar: Lv12 mining, 6 cracks → Essence of the Rock --
      var crystal = Entities.crystals[0];
      assert('a resonant crystal pillar rises behind the east camp', !!crystal && crystal.reqLevel === 12);
      if (crystal) {
        var breaks0 = crystal.breaks;
        Skills.data.mining.xp = 0; Skills.data.mining.level = 1;
        Entities.mineCrystal(crystal);   // mining level 1 → rejected
        assert('the crystal needs Lv12 Mining', crystal.breaks === breaks0);
        Skills.addXp('mining', 9999999);
        assert('Mining maxes at level 12', Skills.data.mining.level === 12);
        for (var ci = 0; ci < 300 && crystal.active; ci++) Entities.mineCrystal(crystal);
        assert('six cracks shatter the crystal', crystal.breaks >= crystal.maxBreaks && crystal.active === false);
        assert('the shattered crystal drops the Essence of the Rock',
          Entities.drops.some(function (d) { return d.itemId === 'rockessence'; }));
      }

    } catch (err) {
      assert('NO EXCEPTIONS', false, (err && err.stack) ? err.stack : String(err));
    }

    report();
  }

  function report() {
    var passed = results.filter(function (r) { return r.pass; }).length;
    var total = results.length;
    var ok = passed === total;
    var summary = { ok: ok, passed: passed, total: total, results: results };
    var json = JSON.stringify(summary, null, 2);

    window.__selftestResult = summary;
    var out = document.createElement('pre');
    out.id = 'selftest-result';
    out.textContent = json;
    document.body.appendChild(out);

    document.title = (ok ? 'SELFTEST PASS ' : 'SELFTEST FAIL ') + passed + '/' + total;
    console.log('SELFTEST_BEGIN');
    results.forEach(function (r) {
      console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.detail ? '  — ' + r.detail : ''));
    });
    console.log('SELFTEST_END ' + passed + '/' + total + (ok ? ' ALL PASS' : ' FAILURES'));
  }

  return { run: run };
})();
