// ============================================================
// combat.js — damage rolls, hitsplats, player/enemy/PvP attacks
// Damage scales with Strength + equipped weapon; accuracy with
// Attack + weapon; Defence mitigates incoming hits. The Fanny Pack
// of Doom instakills.
// ============================================================

var Combat = (function () {
  var _v = new THREE.Vector3();

  // combat state: overhead HP bars (enemy + player) only show for a few seconds
  // after a blow is exchanged. markCombat(enemy) refreshes both timers.
  var COMBAT_MS = 4000;
  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function markCombat(enemy) {
    var t = nowMs() + COMBAT_MS;
    Game.playerCombatUntil = t;
    if (enemy) enemy._combatUntil = t;
  }

  // active weapon enchant (e.g. Electric Paper) → bonus elemental damage per hit.
  // Returns the bonus amount (0 if none/expired). Clears the enchant when it lapses.
  function enchantBonus() {
    var we = Game.weaponEnchant;
    if (!we) return 0;
    if (nowMs() > we.until) { Game.weaponEnchant = null; return 0; }
    if (!(Game.equipment && Game.equipment.rhand)) return 0;   // needs a weapon in hand
    return Utils.randInt(1, 6);
  }

  function isRangedAttack() { return !!(Skills.isRanged && Skills.isRanged()); }
  function playerMaxHit() {
    var b = Skills.equipBonus();
    // bows scale with Ranged; melee scales with Strength. Each level adds +2 max hit.
    var lvl = isRangedAttack() ? Skills.data.ranged.level : (Skills.data.strength.level + b.str);
    return 2 + lvl * 2 + b.maxHit;
  }
  function playerAccuracy(targetDef) {
    var b = Skills.equipBonus();
    var lvl = isRangedAttack() ? Skills.data.ranged.level : Skills.data.attack.level;
    return Utils.clamp(0.5 + lvl * 0.02 + b.acc - (targetDef || 0) * 0.03, 0.35, 0.98);
  }
  // award combat XP for a hit/kill, to Ranged for bows or Attack+Strength for melee
  function awardHitXp(dmg) {
    if (isRangedAttack()) Skills.addXp('ranged', 5 + Math.floor(dmg * 2.5));
    else { Skills.addXp('attack', 4 + Math.floor(dmg * 2)); Skills.addXp('strength', 2 + Math.floor(dmg * 2)); }
    Skills.addXp('hitpoints', 2 + Math.floor(dmg * 1.2));   // dealing damage also trains Hit Points (raises max HP)
  }
  function awardKillXp(enemy) {
    var ranged = isRangedAttack();
    if (enemy.xpAtk != null) { Skills.addXp(ranged ? 'ranged' : 'attack', enemy.xpAtk); if (!ranged) Skills.addXp('strength', enemy.xpStr); }
    else if (ranged) Skills.addXp('ranged', 25);
    else { Skills.addXp('attack', 15); Skills.addXp('strength', 10); }
  }

  function playerAttack(enemy) {
    if (!enemy || !enemy.active) return;
    if (window.Player && Player.canAttack && !Player.canAttack()) return; // eating lockout
    var eq = Skills.equipBonus();
    var maxHit = playerMaxHit();
    var dmg = 0, type = 'miss';
    if (eq.instakill) {
      dmg = enemy.hp; type = 'crit';
    } else if (Utils.rand() < playerAccuracy(enemy.def)) {
      dmg = Utils.randInt(1, maxHit);
      type = (dmg >= maxHit) ? 'crit' : 'hit';
    }

    awardHitXp(dmg);
    markCombat(enemy);                 // show HP bars (enemy + player) briefly
    Game.log.push('playerAttack:' + dmg);

    // Server-owned enemies are resolved authoritatively; client-side entities
    // (bandits, rats — flagged `local`) are always resolved locally, even online.
    if (Game.online && !enemy.local) {
      if (window.Net && Net.sendAttackEnemy) Net.sendAttackEnemy(enemy.index, eq.instakill ? 9999 : dmg);
      return;
    }

    // offline / single-player OR a local client-side entity
    enemy.hp = Math.max(0, enemy.hp - dmg);
    _v.set(enemy.position.x, enemy.position.y + 1.4, enemy.position.z);
    if (window.UI) UI.spawnHitsplat(_v, eq.instakill ? '☠' : dmg, type);
    // elemental enchant: extra lightning damage on top of a connecting hit
    if (!eq.instakill && type !== 'miss' && enemy.hp > 0) {
      var ed = enchantBonus();
      if (ed > 0) {
        enemy.hp = Math.max(0, enemy.hp - ed);
        _v.set(enemy.position.x + 0.55, enemy.position.y + 2.0, enemy.position.z);
        if (window.UI) UI.spawnHitsplat(_v, '⚡' + ed, 'lightning');
      }
    }
    if (enemy.hp <= 0) {
      Entities.killEnemy(enemy);
      awardKillXp(enemy);
      if (window.UI) UI.showActionText(enemy.isRat ? 'You squish the rat.' : (enemy.isBoss ? 'Mahmut of the Valley is slain!' : (enemy.banditCamp ? 'The bandit is dragged to hell.' : 'The mutant is dragged to hell.')));
    }
  }

  function enemyAttack(enemy) {
    var player = Game.player;
    if (!player || player.isDead) return;
    if (player.isInvulnerable && player.isInvulnerable()) {
      var pp0 = player.position;
      _v.set(pp0.x, pp0.y + 1.4, pp0.z);
      if (window.UI) UI.spawnHitsplat(_v, 'DODGE', 'miss');
      Game.log.push('dodgeAvoided');
      return;
    }
    // armour alone lowers the enemy's chance to land a blow (Defence skill removed)
    var def = Skills.equipBonus().def;
    var hitChance = Utils.clamp(0.6 - def * 0.02, 0.15, 0.85);
    var dmg = 0, type = 'miss';
    if (Utils.rand() < hitChance) { dmg = Utils.randInt(1, enemy.maxHit); type = 'hit'; }
    var p = player.position;
    _v.set(p.x, p.y + 1.4, p.z);
    if (window.UI) UI.spawnHitsplat(_v, dmg, type);
    markCombat(enemy);
    Game.log.push('enemyAttack:' + dmg);
    if (dmg > 0) player.takeDamage(dmg);
  }

  // ---- boss weak points (Mahrûk): heart = bow only, hand = melee only ----
  function attackBoss(ent) {
    if (!ent || !ent.active) return;
    if (window.Player && Player.canAttack && !Player.canAttack()) return;
    var ranged = isRangedAttack();
    // wrong tool → tell them and stop, so they don't loop uselessly
    if (ent.part === 'heart' && !ranged) { if (window.UI) UI.showActionText("Too high to reach — loose an arrow at the heart!"); if (window.Player && Player.stop) Player.stop(); return; }
    if (ent.part === 'hand' && ranged) { if (window.UI) UI.showActionText('Get in close with a blade to strike the hand!'); if (window.Player && Player.stop) Player.stop(); return; }
    // right tool, but Mahrûk is only vulnerable during a slam → show it's shielded, keep aiming
    if (window.Coop && Coop.bossVulnerable && !Coop.bossVulnerable()) {
      var vv = ent.position; _v.set(vv.x, vv.y + 1.4, vv.z);
      if (window.UI) UI.spawnHitsplat(_v, '⛨', 'miss');
      return;
    }
    var mx = playerMaxHit();
    var dmg = Utils.randInt(Math.max(1, Math.floor(mx * 0.5)), mx);
    awardHitXp(dmg);
    // melee on the hand builds the stagger meter (scaled by weapon speed so all
    // archetypes fill it at a similar rate); bow on the heart deals real HP damage
    var stag = (ent.part === 'hand') ? Math.round(14 * (window.Skills && Skills.weaponSpeed ? Skills.weaponSpeed() : 1)) : 0;
    // sigil empowerments: Devotion boosts heart damage, Forge boosts stagger
    if (window.Coop && Coop.hasSigil) {
      if (ent.part === 'heart' && Coop.hasSigil('devotion')) dmg = Math.round(dmg * 1.3);
      if (ent.part === 'hand' && Coop.hasSigil('forge')) stag = Math.round(stag * 1.3);
    }
    if (window.Coop && Coop.hitBoss) Coop.hitBoss(ent, dmg, stag);
    Game.log.push('bossAttack:' + ent.part + ':' + dmg);
  }

  // ---- ballista: a heavy bolt at the demon heart (built in co-op) ----
  function fireBallista(ent) {
    if (!ent) return;
    if (ent.cooldown > 0) { if (window.UI) UI.showActionText('The ballista is winching back…'); return; }
    ent.cooldown = 2.5;
    if (window.Coop && Coop.bossActive && Coop.bossActive()) {
      if (Coop.bossVulnerable && !Coop.bossVulnerable()) { if (window.UI) UI.showActionText("The bolt glances off Mahrûk's hide — strike during a slam."); return; }
      var deep = Coop.hasSigil && Coop.hasSigil('deep');   // Sigil of the Deep → stronger siege bolts
      Coop.hitBoss({ part: 'heart', ballista: true }, deep ? 65 : 45, deep ? 42 : 30);   // heavy heart damage + big stagger
      if (window.Skills) Skills.addXp('ranged', 8);
      if (window.UI) UI.showActionText('THUNK — a ballista bolt staggers Mahrûk!');
    } else if (window.UI) UI.showActionText('You loose a bolt into the dunes.');
    Game.log.push('ballista:fire');
  }

  // ---- PvP ----
  function playerAttackPlayer(target) {
    if (!target || !target.active) return;
    if (window.Player && Player.canAttack && !Player.canAttack()) return; // eating lockout
    var eq = Skills.equipBonus();
    var maxHit = playerMaxHit();
    var dmg = 0;
    if (eq.instakill) dmg = 99;
    else if (Utils.rand() < playerAccuracy(2)) dmg = Utils.randInt(1, maxHit);
    if (window.Net && Net.sendAttack) Net.sendAttack(target.id, dmg);
    Skills.addXp('attack', 4 + dmg * 2);
    Skills.addXp('strength', 2 + dmg * 2);
    Game.log.push('pvpAttack:' + dmg);
  }

  function receivePvpDamage(dmg) {
    var player = Game.player;
    if (!player || player.isDead) return;
    var p = player.position;
    _v.set(p.x, p.y + 1.4, p.z);
    if (player.isInvulnerable && player.isInvulnerable()) {
      if (window.UI) UI.spawnHitsplat(_v, 'DODGE', 'miss');
      Game.log.push('pvpDodged');
      return;
    }
    if (window.UI) UI.spawnHitsplat(_v, dmg, dmg > 0 ? 'hit' : 'miss');
    markCombat(null);
    Game.log.push('pvpHit:' + dmg);
    if (dmg > 0) player.takeDamage(dmg);
  }

  return {
    playerAttack: playerAttack, enemyAttack: enemyAttack, attackBoss: attackBoss, fireBallista: fireBallista,
    playerAttackPlayer: playerAttackPlayer, receivePvpDamage: receivePvpDamage,
    playerMaxHit: playerMaxHit
  };
})();
