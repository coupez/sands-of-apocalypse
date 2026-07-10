// ============================================================
// player.js — player avatar, click-to-move, actions, death anim
// ============================================================

var Player = (function () {
  var group, rightArm, leftArm, rightLeg, leftLeg, torso, head, weapon;
  var SPEED = 6.2;

  var state = 'idle';           // idle | moving | acting | dead
  var moveTarget = null;        // THREE.Vector3 ground destination
  var interaction = null;       // { entity, type } — walk to & act on
  var actionTimer = 0;
  var actionKind = null;        // 'chop' | 'mine' | 'attack'
  var animPhase = 0;
  var swing = 0;

  var stats = { hp: 20, maxHp: 20, attackTick: 0 };

  // death sequence
  var death = { active: false, phase: null, t: 0, baseY: 0, onDone: null };

  // dodge roll (Dark Souls-style)
  var dodge = { active: false, t: 0, dur: 0.5, cooldown: 0, dir: { x: 0, z: 1 } };

  function build(scene) {
    group = new THREE.Group();

    var skin = new THREE.MeshStandardMaterial({ color: 0x7fa86a, roughness: 0.9, flatShading: true });
    var cloth = new THREE.MeshStandardMaterial({ color: 0x3b4a2a, roughness: 1.0, flatShading: true });
    var dark = new THREE.MeshStandardMaterial({ color: 0x232b18, roughness: 1.0, flatShading: true });
    var metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.6, flatShading: true });

    torso = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.5), cloth);
    torso.position.y = 1.5;
    group.add(torso);

    // a ragged hood/head
    head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), skin);
    head.position.y = 2.35;
    group.add(head);
    var hood = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.6, 5), dark);
    hood.position.y = 2.75;
    group.add(hood);

    // arms (pivot at shoulder so swings look right)
    rightArm = new THREE.Group();
    rightArm.position.set(0.62, 2.0, 0);
    var rArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.0, 0.26), skin);
    rArmMesh.position.y = -0.5;
    rightArm.add(rArmMesh);
    // weapon held in right hand (a scrap pickaxe/wrench)
    weapon = new THREE.Group();
    var handle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 0.1), dark);
    handle.position.y = -0.4;
    var headBar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.16), metal);
    headBar.position.y = -0.95;
    weapon.add(handle); weapon.add(headBar);
    weapon.position.set(0, -0.9, 0);
    rightArm.add(weapon);
    group.add(rightArm);

    leftArm = new THREE.Group();
    leftArm.position.set(-0.62, 2.0, 0);
    var lArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.0, 0.26), skin);
    lArmMesh.position.y = -0.5;
    leftArm.add(lArmMesh);
    group.add(leftArm);

    // legs
    rightLeg = new THREE.Group();
    rightLeg.position.set(0.24, 0.95, 0);
    var rLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.95, 0.3), dark);
    rLegMesh.position.y = -0.47;
    rightLeg.add(rLegMesh);
    group.add(rightLeg);

    leftLeg = new THREE.Group();
    leftLeg.position.set(-0.24, 0.95, 0);
    var lLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.95, 0.3), dark);
    lLegMesh.position.y = -0.47;
    leftLeg.add(lLegMesh);
    group.add(leftLeg);

    group.traverse(function (o) { if (o.isMesh) { o.castShadow = true; } });

    group.position.set(0, 0, 0);
    scene.add(group);
    Game.player = api;
    return api;
  }

  function terrainY(x, z) {
    if (World.ground && World.ground.userData.heightAt) {
      return World.ground.userData.heightAt(x, z);
    }
    return 0;
  }

  function faceTowards(x, z, dt) {
    var dx = x - group.position.x, dz = z - group.position.z;
    if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return;
    var want = Math.atan2(dx, dz);
    var cur = group.rotation.y;
    var diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
    group.rotation.y = cur + diff * Utils.clamp(12 * dt, 0, 1);
  }

  // ---- public commands ----
  function walkTo(point) {
    if (state === 'dead') return;
    moveTarget = new THREE.Vector3(point.x, 0, point.z);
    interaction = null;
    actionKind = null;
    state = 'moving';
  }

  function interactWith(entity) {
    if (state === 'dead' || !entity) return;
    interaction = { entity: entity, type: entity.type };
    moveTarget = null;
    state = 'moving';
  }

  function stop() {
    moveTarget = null; interaction = null; state = 'idle'; actionKind = null;
  }

  // ---- dodge roll ----
  function dodge_() {
    if (state === 'dead' || death.active || dodge.active || dodge.cooldown > 0) return;
    dodge.active = true;
    dodge.t = 0;
    dodge.cooldown = 0.9;
    // roll in the current facing direction
    dodge.dir.x = Math.sin(group.rotation.y);
    dodge.dir.z = Math.cos(group.rotation.y);
    // interrupt whatever we were doing
    interaction = null; moveTarget = null; actionKind = null;
    state = 'dodge';
    SFX.dodge();
    if (window.UI) UI.showActionText('Roll!');
    Game.log.push('dodge');
  }

  function isInvulnerable() { return dodge.active && dodge.t < 0.42; }

  function updateDodge(dt) {
    dodge.t += dt;
    var p = Utils.clamp(dodge.t / dodge.dur, 0, 1);
    var speed = 15 * (1 - p * 0.65);         // fast burst, easing out
    group.position.x += dodge.dir.x * speed * dt;
    group.position.z += dodge.dir.z * speed * dt;
    group.rotation.x = -p * Math.PI * 2;      // full forward roll
    var face = Math.atan2(dodge.dir.x, dodge.dir.z);
    group.rotation.y = face;
    group.position.y = terrainY(group.position.x, group.position.z) + Math.sin(p * Math.PI) * 0.3;
    if (p >= 1) { dodge.active = false; group.rotation.x = 0; state = 'idle'; }
    CameraRig.setTarget(group.position);
  }

  // ---- update ----
  function update(dt, t) {
    if (!group) return;

    if (dodge.cooldown > 0) dodge.cooldown = Math.max(0, dodge.cooldown - dt);
    if (death.active) { updateDeath(dt); return; }
    if (dodge.active) { updateDodge(dt); return; }

    // Determine where to walk. For interactions, chase the entity's live pos.
    var dest = null, stopDist = 0.15, ent = null;
    if (interaction && interaction.entity && interaction.entity.active) {
      ent = interaction.entity;
      var ep = ent.position;
      dest = new THREE.Vector3(ep.x, 0, ep.z);
      stopDist = ent.interactRange || 2.0;
    } else if (interaction && interaction.entity && !interaction.entity.active) {
      interaction = null; state = 'idle'; actionKind = null;
    } else if (moveTarget) {
      dest = moveTarget;
    }

    var moving = false;
    if (dest) {
      var dx = dest.x - group.position.x, dz = dest.z - group.position.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d > stopDist) {
        var step = Math.min(SPEED * dt, d - stopDist * 0.9);
        group.position.x += (dx / d) * step;
        group.position.z += (dz / d) * step;
        faceTowards(dest.x, dest.z, dt);
        moving = true;
        state = 'moving';
        actionKind = null;
      } else {
        // arrived
        if (ent) {
          faceTowards(ent.position.x, ent.position.z, dt);
          if (ent.type === 'chest') {
            Entities.openChest(ent);
            interaction = null; state = 'idle'; actionKind = null;
          } else {
            state = 'acting';
            actionKind = ent.type === 'tree' ? 'chop'
                       : ent.type === 'rock' ? 'mine'
                       : ent.type === 'fishpool' ? 'fish' : 'attack';
            doActionTick(dt, ent);
          }
        } else {
          moveTarget = null;
          state = 'idle';
          actionKind = null;
        }
      }
    } else {
      state = state === 'dead' ? 'dead' : 'idle';
    }

    // keep on the ground
    group.position.y = terrainY(group.position.x, group.position.z);

    animate(dt, t, moving);
    CameraRig.setTarget(group.position);
  }

  function doActionTick(dt, ent) {
    actionTimer += dt;
    var interval = (actionKind === 'attack') ? 1.2 : 1.05;
    swing = Math.min(1, swing + dt * 6);
    if (actionTimer >= interval) {
      actionTimer = 0;
      swing = 0;
      if (actionKind === 'chop') { Skills.doWoodcut(ent); SFX.chop(); }
      else if (actionKind === 'mine') { Skills.doMine(ent); SFX.mine(); }
      else if (actionKind === 'fish') { Skills.doFish(ent); SFX.mine(); }
      else if (actionKind === 'attack') {
        if (ent.type === 'player') Combat.playerAttackPlayer(ent);
        else Combat.playerAttack(ent);
        SFX.hit();
      }
    }
  }

  function animate(dt, t, moving) {
    animPhase += dt * (moving ? 10 : 3);
    if (state === 'acting' && actionKind) {
      // big swing on the arm + weapon
      var s = Math.sin(actionTimer * 10) * 0.9 - 0.5;
      rightArm.rotation.x = s;
      leftArm.rotation.x = -s * 0.3;
      rightLeg.rotation.x = 0; leftLeg.rotation.x = 0;
    } else if (moving) {
      var s2 = Math.sin(animPhase);
      rightLeg.rotation.x = s2 * 0.7;
      leftLeg.rotation.x = -s2 * 0.7;
      rightArm.rotation.x = -s2 * 0.5;
      leftArm.rotation.x = s2 * 0.5;
    } else {
      // idle breathing
      var b = Math.sin(t * 2) * 0.05;
      rightArm.rotation.x = Utils.damp(rightArm.rotation.x, b, 6, dt);
      leftArm.rotation.x = Utils.damp(leftArm.rotation.x, -b, 6, dt);
      rightLeg.rotation.x = Utils.damp(rightLeg.rotation.x, 0, 6, dt);
      leftLeg.rotation.x = Utils.damp(leftLeg.rotation.x, 0, 6, dt);
    }
  }

  // ---- damage / death ----
  function takeDamage(dmg) {
    if (state === 'dead' || death.active) return;
    if (isInvulnerable()) return; // i-frames during dodge
    stats.hp = Utils.clamp(stats.hp - dmg, 0, stats.maxHp);
    UI.updateVitals();
    UI.flashDamage();
    SFX.hurt();
    if (stats.hp <= 0) startDeath();
  }

  function startDeath(onDone) {
    if (death.active) return;
    state = 'dead';
    interaction = null; moveTarget = null;
    death.active = true;
    death.phase = 'dance';
    death.t = 0;
    death.baseY = group.position.y;
    death.onDone = onDone || null;
    SFX.dead();
    // dying words — Flemish (West-Flanders flavored)
    Game.log.push('deathLine');
    Voice.speak('o nee godverdomme ik ben dood', {
      langs: ['nl-be', 'vlaams', 'flemish', 'nl', 'dutch'], lang: 'nl-BE',
      volume: 1.0, rate: 0.98, pitch: 0.82
    });
    if (window.UI) {
      UI.spawnSpeech(new THREE.Vector3(group.position.x, group.position.y + 3.2, group.position.z),
        'o nee godverdomme ik ben dood…');
    }
    Game.log.push('death:start');
  }

  function updateDeath(dt) {
    death.t += dt;
    var g = group;
    if (death.phase === 'dance') {
      // little dance: side-to-side wiggle + spin + arm waving
      g.rotation.y += dt * 6;
      g.position.x = death._cx !== undefined ? death._cx : (death._cx = g.position.x);
      var wig = Math.sin(death.t * 14) * 0.35;
      g.rotation.z = wig;
      rightArm.rotation.x = Math.sin(death.t * 16) * 1.4;
      leftArm.rotation.x = Math.cos(death.t * 16) * 1.4;
      rightLeg.rotation.x = Math.sin(death.t * 18) * 0.5;
      leftLeg.rotation.x = -Math.sin(death.t * 18) * 0.5;
      g.position.y = death.baseY + Math.abs(Math.sin(death.t * 12)) * 0.25;
      if (death.t >= 2.2) { death.phase = 'backflip'; death.t = 0; g.rotation.z = 0; }
    } else if (death.phase === 'backflip') {
      // full backflip with an arc hop
      var p = Utils.clamp(death.t / 0.9, 0, 1);
      g.rotation.x = -p * Math.PI * 2;
      g.position.y = death.baseY + Math.sin(p * Math.PI) * 3.2;
      g.rotation.y += dt * 3;
      rightArm.rotation.x = -1.2; leftArm.rotation.x = -1.2;
      rightLeg.rotation.x = 0.6; leftLeg.rotation.x = 0.6;
      if (p >= 1) { death.phase = 'collapse'; death.t = 0; g.rotation.x = 0; }
    } else if (death.phase === 'collapse') {
      // fall flat and go grey
      var q = Utils.clamp(death.t / 0.6, 0, 1);
      g.rotation.x = -q * Math.PI / 2;
      g.position.y = death.baseY + (1 - q) * 0.2;
      if (q >= 1 && death.phase !== 'done') {
        death.phase = 'done';
        greyOut();
        Game.log.push('death:done');
        if (death.onDone) death.onDone();
        UI.showDeathScreen();
      }
    }
  }

  function greyOut() {
    group.traverse(function (o) {
      if (o.isMesh && o.material) {
        o.material = o.material.clone();
        o.material.color.setHex(0x555b52);
      }
    });
  }

  function reset() {
    death.active = false; death.phase = null; death.t = 0; death._cx = undefined;
    dodge.active = false; dodge.t = 0; dodge.cooldown = 0;
    state = 'idle';
    interaction = null; moveTarget = null; actionKind = null; actionTimer = 0;
    stats.hp = stats.maxHp;
    if (group) {
      group.position.set(0, terrainY(0, 0), 0);
      group.rotation.set(0, 0, 0);
      // restore original materials by rebuilding colors
      restoreColors();
    }
    UI.updateVitals();
  }

  function restoreColors() {
    // simplest robust restore: rebuild from scratch
    var scene = group.parent;
    scene.remove(group);
    build(scene);
  }

  var api = {
    build: build, update: update,
    walkTo: walkTo, interactWith: interactWith, stop: stop,
    takeDamage: takeDamage, startDeath: startDeath, reset: reset,
    dodge: dodge_, isInvulnerable: isInvulnerable,
    get state() { return state; },
    get position() { return group ? group.position : new THREE.Vector3(); },
    get group() { return group; },
    get stats() { return stats; },
    get isDead() { return state === 'dead'; },
    get interaction() { return interaction; }
  };
  return api;
})();
