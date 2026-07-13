// ============================================================
// combat.js — damage rolls, hitsplats, player/enemy/PvP attacks
// Damage scales with Strength + equipped weapon; accuracy with
// Attack + weapon; Defence mitigates incoming hits. The Fanny Pack
// of Doom instakills.
// ============================================================

var Combat = (function () {
  var _v = new THREE.Vector3();

  function playerMaxHit() {
    var b = Skills.equipBonus();
    // each Strength level adds +2 max hit, so even level 2 hits noticeably harder
    return 2 + (Skills.data.strength.level + b.str) * 2 + b.maxHit;
  }
  function playerAccuracy(targetDef) {
    var b = Skills.equipBonus();
    return Utils.clamp(0.5 + Skills.data.attack.level * 0.02 + b.acc - (targetDef || 0) * 0.03, 0.35, 0.98);
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

    Skills.addXp('attack', 4 + Math.floor(dmg * 2));
    Skills.addXp('strength', 2 + Math.floor(dmg * 2));
    Game.log.push('playerAttack:' + dmg);

    if (Game.online) {
      // authoritative: server applies damage + death; splat comes back via enemyHit
      if (window.Net && Net.sendAttackEnemy) Net.sendAttackEnemy(enemy.index, eq.instakill ? 9999 : dmg);
      return;
    }

    // offline / single-player
    enemy.hp = Math.max(0, enemy.hp - dmg);
    _v.set(enemy.position.x, enemy.position.y + 2.6, enemy.position.z);
    if (window.UI) UI.spawnHitsplat(_v, eq.instakill ? '☠' : dmg, type);
    if (enemy.hp <= 0) {
      Entities.killEnemy(enemy);
      Skills.addXp('attack', 15);
      Skills.addXp('strength', 10);
      if (window.UI) UI.showActionText('The mutant is dragged to hell.');
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
    playerAttack: playerAttack, enemyAttack: enemyAttack,
    playerAttackPlayer: playerAttackPlayer, receivePvpDamage: receivePvpDamage,
    playerMaxHit: playerMaxHit
  };
})();
