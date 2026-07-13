// ============================================================
// combat.js — damage rolls, hitsplats, player/enemy/PvP attacks
// Damage scales with Strength + equipped weapon; accuracy with
// Attack + weapon; Defence mitigates incoming hits. The Fanny Pack
// of Doom instakills.
// ============================================================

var Combat = (function () {
  var _v = new THREE.Vector3();

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
    Game.log.push('playerAttack:' + dmg);

    // Server-owned enemies are resolved authoritatively; client-side entities
    // (bandits, rats — flagged `local`) are always resolved locally, even online.
    if (Game.online && !enemy.local) {
      if (window.Net && Net.sendAttackEnemy) Net.sendAttackEnemy(enemy.index, eq.instakill ? 9999 : dmg);
      return;
    }

    // offline / single-player OR a local client-side entity
    enemy.hp = Math.max(0, enemy.hp - dmg);
    _v.set(enemy.position.x, enemy.position.y + 2.6, enemy.position.z);
    if (window.UI) UI.spawnHitsplat(_v, eq.instakill ? '☠' : dmg, type);
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
      _v.set(pp0.x, pp0.y + 2.6, pp0.z);
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
    _v.set(p.x, p.y + 2.6, p.z);
    if (window.UI) UI.spawnHitsplat(_v, dmg, type);
    Game.log.push('enemyAttack:' + dmg);
    if (dmg > 0) player.takeDamage(dmg);
  }

  // ---- boss weak points (Mahrûk): heart = bow only, hand = melee only ----
  function attackBoss(ent) {
    if (!ent || !ent.active) return;
    if (window.Player && Player.canAttack && !Player.canAttack()) return;
    var ranged = isRangedAttack();
    if (ent.part === 'heart' && !ranged) { if (window.UI) UI.showActionText("Too high to reach — loose an arrow at the heart!"); return; }
    if (ent.part === 'hand' && ranged) { if (window.UI) UI.showActionText('Get in close with a blade to strike the hand!'); return; }
    var mx = playerMaxHit();
    var dmg = Utils.randInt(Math.max(1, Math.floor(mx * 0.5)), mx);
    awardHitXp(dmg);
    if (window.Coop && Coop.hitBoss) Coop.hitBoss(ent, dmg);
    var v = ent.position;
    _v.set(v.x, v.y + 1.6, v.z);
    Game.log.push('bossAttack:' + ent.part + ':' + dmg);
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
    _v.set(p.x, p.y + 2.6, p.z);
    if (player.isInvulnerable && player.isInvulnerable()) {
      if (window.UI) UI.spawnHitsplat(_v, 'DODGE', 'miss');
      Game.log.push('pvpDodged');
      return;
    }
    if (window.UI) UI.spawnHitsplat(_v, dmg, dmg > 0 ? 'hit' : 'miss');
    Game.log.push('pvpHit:' + dmg);
    if (dmg > 0) player.takeDamage(dmg);
  }

  return {
    playerAttack: playerAttack, enemyAttack: enemyAttack, attackBoss: attackBoss,
    playerAttackPlayer: playerAttackPlayer, receivePvpDamage: receivePvpDamage,
    playerMaxHit: playerMaxHit
  };
})();
