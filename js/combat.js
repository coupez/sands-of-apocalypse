// ============================================================
// combat.js — damage rolls, hitsplats, player/enemy attacks
// ============================================================

var Combat = (function () {
  var _v = new THREE.Vector3();

  function playerAttack(enemy) {
    if (!enemy || !enemy.active) return;
    var atk = Skills.data.attack.level;
    var maxHit = 3 + Math.floor(atk * 0.5);
    var hitChance = Utils.clamp(0.62 + atk * 0.02 - enemy.def * 0.03, 0.4, 0.95);
    var dmg = 0, type = 'miss';
    if (Utils.rand() < hitChance) {
      dmg = Utils.randInt(1, maxHit);
      type = (dmg >= maxHit) ? 'crit' : 'hit';
    }
    enemy.hp = Math.max(0, enemy.hp - dmg);

    _v.set(enemy.position.x, enemy.position.y + 2.6, enemy.position.z);
    if (window.UI) UI.spawnHitsplat(_v, dmg, type);

    Skills.addXp('attack', 4 + dmg * 4);
    Game.log.push('playerAttack:' + dmg);

    if (enemy.hp <= 0) {
      Entities.killEnemy(enemy);
      Skills.addXp('attack', 20);
      if (window.UI) UI.showActionText('The mutant collapses into sludge.');
    }
  }

  function enemyAttack(enemy) {
    var player = Game.player;
    if (!player || player.isDead) return;
    // dodge i-frames: attack whiffs entirely
    if (player.isInvulnerable && player.isInvulnerable()) {
      var pp0 = player.position;
      _v.set(pp0.x, pp0.y + 2.6, pp0.z);
      if (window.UI) UI.spawnHitsplat(_v, 'DODGE', 'miss');
      Game.log.push('dodgeAvoided');
      return;
    }
    var dmg = 0, type = 'miss';
    if (Utils.rand() < 0.6) {
      dmg = Utils.randInt(1, enemy.maxHit);
      type = 'hit';
    }
    var p = player.position;
    _v.set(p.x, p.y + 2.6, p.z);
    if (window.UI) UI.spawnHitsplat(_v, dmg, type);
    Game.log.push('enemyAttack:' + dmg);
    if (dmg > 0) player.takeDamage(dmg);
  }

  // ---- PvP ----
  // We attack another player: compute damage locally and send it over the
  // network. The *victim's* client is authoritative over its own HP/death,
  // so we don't apply damage here — we only broadcast the hit.
  function playerAttackPlayer(target) {
    if (!target || !target.active) return;
    var atk = Skills.data.attack.level;
    var maxHit = 3 + Math.floor(atk * 0.5);
    var dmg = 0;
    if (Utils.rand() < 0.75) dmg = Utils.randInt(1, maxHit);
    if (window.Net && Net.sendAttack) Net.sendAttack(target.id, dmg);
    Skills.addXp('attack', 4 + dmg * 4);
    Game.log.push('pvpAttack:' + dmg);
  }

  // Inbound PvP damage aimed at *us*. Respects dodge i-frames.
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
    playerAttackPlayer: playerAttackPlayer, receivePvpDamage: receivePvpDamage
  };
})();
