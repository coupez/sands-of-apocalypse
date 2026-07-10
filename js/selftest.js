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
          Game.inventory.some(function (i) { return i.id === 'log'; }),
          JSON.stringify(Game.inventory.map(function (i) { return i.id + 'x' + i.count; })));
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
          Game.inventory.some(function (i) { return i.id === 'ore'; }));
      }

      // -- new skills exist --
      assert('skill: strength', !!Skills.data.strength);
      assert('skill: defence', !!Skills.data.defence);
      assert('skill: fishing', !!Skills.data.fishing);

      // -- fishing --
      var pool = Entities.pools.filter(function (p) { return p.active; })[0];
      assert('found fishing pool', !!pool, Entities.pools.length + ' pools');
      if (pool) {
        var fxp0 = Skills.data.fishing.xp;
        for (var fi = 0; fi < 50; fi++) Skills.doFish(pool);
        assert('fishing xp gained', Skills.data.fishing.xp > fxp0, 'xp=' + Skills.data.fishing.xp);
        assert('fish in inventory', Game.inventory.some(function (i) { return i.id === 'fish'; }));
      }

      assert('inventory populated', Game.inventory.length > 0, Game.inventory.length + ' stacks');

      // -- combat --
      invadeInvulnerable();
      var atkXp0 = Skills.data.attack.xp;
      // nearest active enemy to reduce travel time
      var enemies = Entities.enemies.filter(function (e) { return e.active; });
      enemies.sort(function (a, b) {
        return dist(Player.position, a.position.x, a.position.z) - dist(Player.position, b.position.x, b.position.z);
      });
      var enemy = enemies[0];
      assert('found active enemy', !!enemy);
      if (enemy) {
        var killedBefore = Game.log.filter(function (l) { return l === 'enemy:killed'; }).length;
        Player.interactWith(enemy);
        Main.advance(30);
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

      // -- weapons: Fanny Pack of Doom instakills --
      invadeInvulnerable();
      Skills.equip('fanny');
      assert('fanny pack equipped', Game.equipped && Game.equipped.instakill === true);
      var victim = Entities.enemies.filter(function (e) { return e.active; })[0];
      assert('found a victim for fanny pack', !!victim);
      if (victim) {
        var killsBefore = Game.log.filter(function (l) { return l === 'enemy:killed'; }).length;
        Combat.playerAttack(victim);
        assert('fanny pack instakills in one hit',
          victim.hp <= 0 && Game.log.filter(function (l) { return l === 'enemy:killed'; }).length > killsBefore);
      }
      Skills.equip('fists');

      // -- chests grant weapons --
      var chest = Entities.chests.filter(function (c) { return c.active; })[0];
      assert('supply chest exists', !!chest, Entities.chests.length + ' chests');
      if (chest) {
        var wid = chest.weaponId;
        Entities.openChest(chest);
        assert('chest opens and equips its weapon',
          Game.log.indexOf('chestOpened:' + wid) >= 0 && Game.equipped.id === wid,
          'equipped=' + Game.equipped.id);
        Skills.equip('fists');
      }
      // the strongest weapon must actually exist somewhere in the world
      assert('fanny pack exists in a chest',
        Entities.chests.some(function (c) { return c.weaponId === 'fanny'; }),
        'chest weapons: ' + Entities.chests.map(function (c) { return c.weaponId; }).join(','));
      // counts must match the server's authoritative indices
      assert('entity counts match server indices',
        Entities.trees.length === 17 && Entities.rocks.length === 13 && Entities.enemies.length === 13,
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

      // -- building roof lifts when the player is inside its footprint, restores outside --
      var bld = Entities.buildings[0];
      assert('building has a roof + footprint', !!(bld && bld.roof), 'building0=' + !!bld);
      if (bld) {
        Player.stop();
        Player.group.position.set(bld.position.x, 0, bld.position.z);
        Main.advance(0.1);
        assert('roof hidden while player stands inside building', bld.roof.visible === false, 'visible=' + bld.roof.visible);
        Player.group.position.set(bld.position.x + 50, 0, bld.position.z + 50);
        Main.advance(0.1);
        assert('roof restored when player leaves building', bld.roof.visible === true, 'visible=' + bld.roof.visible);
        Player.group.position.set(0, 0, 0);
      }

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
