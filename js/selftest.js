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
      var tree = Entities.trees.filter(function (t) { return t.active; })[0];
      assert('found active tree', !!tree);
      if (tree) {
        Player.interactWith(tree);
        Main.advance(16);
        assert('woodcutting xp gained', Skills.data.woodcutting.xp > wcXp0,
          'xp ' + wcXp0 + ' -> ' + Skills.data.woodcutting.xp);
        assert('log in inventory',
          Game.inventory.some(function (i) { return i && i.id === 'log'; }),
          JSON.stringify(Game.inventory.filter(Boolean).map(function (i) { return i.id + 'x' + i.count; })));
      }

      // -- mining --
      var mnXp0 = Skills.data.mining.xp;
      var rock = Entities.rocks.filter(function (r) { return r.active; })[0];
      assert('found active rock', !!rock);
      if (rock) {
        Player.interactWith(rock);
        Main.advance(16);
        assert('mining xp gained', Skills.data.mining.xp > mnXp0,
          'xp ' + mnXp0 + ' -> ' + Skills.data.mining.xp);
        assert('ore in inventory',
          Game.inventory.some(function (i) { return i && i.id === 'ore'; }));
      }

      // -- new skills exist --
      assert('skill: strength', !!Skills.data.strength);
      assert('skill: defence', !!Skills.data.defence);
      assert('skill: fishing', !!Skills.data.fishing);

      // -- fishing (a shrimp pond near a camp: reqLevel 1) --
      var pool = Entities.pools.filter(function (p) { return p.active && p.reqLevel === 1; })[0];
      assert('found a level-1 fishing pond', !!pool, Entities.pools.length + ' ponds');
      if (pool) {
        var fxp0 = Skills.data.fishing.xp;
        for (var fi = 0; fi < 10; fi++) Skills.doFish(pool);
        assert('fishing xp gained', Skills.data.fishing.xp > fxp0, 'xp=' + Skills.data.fishing.xp);
        assert('shrimp in inventory', Game.inventory.some(function (i) { return i && i.id === 'shrimp'; }));
      }

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

      // -- combat trains Strength & Defence --
      assert('strength trained by dealing damage', Skills.data.strength.xp > 0, 'xp=' + Skills.data.strength.xp);
      assert('defence trained by being attacked', Skills.data.defence.xp > 0, 'xp=' + Skills.data.defence.xp);

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
        Entities.useStation(furnace);                 // ore smelts into a bar
        assert('lit furnace smelts ore into a bar', invCount('bar') === 1, 'bars=' + invCount('bar'));
      }
      var anvil = Entities.stations.filter(function (s) { return s.kind === 'anvil'; })[0];
      assert('anvil exists in town', !!anvil);
      if (anvil) {
        var sw0 = invCount('sword');
        Entities.useStation(anvil);                   // bar smiths into a sword
        assert('anvil smiths a bar into gear', invCount('sword') === sw0 + 1);
      }
      var campfire = Entities.stations.filter(function (s) { return s.kind === 'campfire'; })[0];
      assert('campfire exists in town', !!campfire);
      if (campfire) {
        Skills.addItem('log');
        Entities.useStation(campfire);                // log lights the campfire
        assert('campfire lights when given a log', campfire.lit === true);
        Skills.addItem('shrimp');
        Entities.useStation(campfire);                // raw shrimp cooks into cooked shrimp
        assert('lit campfire cooks raw shrimp into cooked', invCount('cshrimp') === 1, 'cshrimp=' + invCount('cshrimp'));
      }
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
