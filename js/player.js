// ============================================================
// player.js — player avatar, click-to-move, actions, death anim
// ============================================================

var Player = (function () {
  var group, rightArm, leftArm, rightLeg, leftLeg, torso, head, weapon, bowModel;
  var weaponModel = null;       // custom imported .glb held in the right hand (if any)
  var _lastApp = null;          // remember the last appearance so models can re-apply on load
  var charModel = null;         // custom imported player-character model (replaces the boxes)
  var bodyMeshes = [];          // the procedural body meshes to hide once a model is in
  var _charApplied = false;
  var _charScale = null;        // world units per model unit (from the character) → sizes weapons to match
  var matHead, matBody, matLegs, matWeapon;   // recoloured by equipped gear tier
  var BASE_HEAD = 0xd8b48a, BASE_BODY = 0xffffff, BASE_LEGS = 0x5a4632;   // desert-nomad skin / robe (white lets the robe texture show) / trousers
  var SPEED = 6.2;

  var state = 'idle';           // idle | moving | acting | dead
  var moveTarget = null;        // THREE.Vector3 ground destination
  var interaction = null;       // { entity, type } — walk to & act on
  var actionTimer = 0;
  var actionKind = null;        // 'chop' | 'mine' | 'fish' | 'attack'
  var animPhase = 0;
  var swingFired = false;       // has this swing's effect fired yet?
  var walkPath = null;          // queued tile-center waypoints (Grid pathfinding)
  var goalKey = null;           // tile-key of the current path goal (for replanning)
  // swing timing (fractions of the action interval)
  var WINDUP_END = 0.48;        // reach the raised/wound-up pose by here
  var IMPACT = 0.72;            // the strike connects here — effect fires now

  var eatAnim = 0;              // eating gesture timer (visual)
  var prayAnim = 0;            // burying/praying gesture timer (visual)
  var eatLock = 0;             // can't attack while > 0 (seconds)
  var EAT_LOCK = 3.0;         // attack lockout after eating
  var mySlot = 1;             // which camp this player belongs to (1 = N, 2 = S)

  var stats = { hp: 15, maxHp: 15, attackTick: 0 };

  // Your base max HP is your Hit Points LEVEL (starts at 15). Equipment adds on top.
  function baseMaxHp() {
    return (window.Skills && Skills.data.hitpoints) ? Skills.data.hitpoints.level : 15;
  }
  // recompute max HP from Hit Points level + equipment bonus; keep current HP in range
  function applyBonuses(b) {
    b = b || {};
    stats.maxHp = baseMaxHp() + (b.hp || 0);
    if (stats.hp > stats.maxHp) stats.hp = stats.maxHp;
  }

  // ---- run / stamina ----
  // A toggleable sprint drains energy while you're actually moving; it refills
  // whenever you're not sprinting. At 0 you can't sprint until it recovers.
  var RUN_MULT = 1.35;         // sprint speed multiplier (a gentle jog, not a blur)
  var ENERGY_MAX = 100;
  var ENERGY_DRAIN = 16;       // per second while sprinting AND moving
  var ENERGY_REGEN = 6;        // per second otherwise (slow refill)
  var ENERGY_MIN_RUN = 1;      // need at least this much to start/keep sprinting
  var energy = ENERGY_MAX, running = false;
  function setRunning(v) { running = !!v && energy > ENERGY_MIN_RUN; }
  function toggleRun() { setRunning(!running); return running; }
  function updateEnergy(dt, moving) {
    if (running && moving) {
      energy = Math.max(0, energy - ENERGY_DRAIN * dt);
      if (energy <= 0) running = false;                 // gassed out — stop sprinting
    } else {
      energy = Math.min(ENERGY_MAX, energy + ENERGY_REGEN * dt);
    }
  }
  function isRunning() { return running && energy > 0; }

  // death sequence
  var death = { active: false, phase: null, t: 0, baseY: 0, onDone: null };

  // A tiny, chunky canvas texture (nearest-filtered, no mipmaps) — the low-res
  // painted look of a PlayStation-1 character skin.
  function ps1Tex(draw, size) {
    var S = size || 32;
    var cv = document.createElement('canvas'); cv.width = cv.height = S;
    draw(cv.getContext('2d'), S);
    var t = new THREE.CanvasTexture(cv);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    return t;
  }
  function robeTexture() {
    return ps1Tex(function (c, S) {
      c.fillStyle = '#d8c49a'; c.fillRect(0, 0, S, S);                 // cloth
      c.fillStyle = '#c7ac78'; c.fillRect(0, 0, S, 3);                 // collar band
      c.fillStyle = '#8a2f2a'; c.fillRect(S * 0.42, 0, S * 0.16, S);   // red sash down the front
      c.fillStyle = '#5a4028'; c.fillRect(0, S * 0.62, S, S * 0.12);   // belt
      c.fillStyle = '#e6d6ac';                                         // cloth highlights
      for (var i = 0; i < 40; i++) c.fillRect((Math.random() * S) | 0, (Math.random() * S) | 0, 1, 1);
    });
  }

  function build(scene) {
    group = new THREE.Group();
    charModel = null; bodyMeshes = []; _charApplied = false;   // reset per (re)build

    // PS1-style: MeshLambert = per-vertex (gouraud) lighting, low-res maps.
    matHead = new THREE.MeshLambertMaterial({ color: BASE_HEAD });
    matBody = new THREE.MeshLambertMaterial({ color: BASE_BODY, map: robeTexture() });
    matLegs = new THREE.MeshLambertMaterial({ color: BASE_LEGS });
    matWeapon = new THREE.MeshLambertMaterial({ color: 0xc87838 });
    var skin = new THREE.MeshLambertMaterial({ color: BASE_HEAD }); // arms stay skin
    var dark = new THREE.MeshLambertMaterial({ color: BASE_LEGS });  // hood

    torso = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.5), matBody);
    torso.position.y = 1.5;
    group.add(torso);

    // head — chunky PS1 block with a painted face + nomad headband
    head = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.62, 0.62), matHead);
    head.position.y = 2.35;
    var eyeMat = new THREE.MeshLambertMaterial({ color: 0x201810 });
    for (var ei = -1; ei <= 1; ei += 2) {
      var eye = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.03), eyeMat);
      eye.position.set(ei * 0.14, 0.03, 0.31); head.add(eye);
    }
    var brow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.03), new THREE.MeshLambertMaterial({ color: 0x6b4a2a }));
    brow.position.set(0, 0.12, 0.31); head.add(brow);
    var band = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.66), new THREE.MeshLambertMaterial({ color: 0xb9483a }));
    band.position.set(0, 0.26, 0); head.add(band);   // red headband
    group.add(head);

    // arms (pivot at shoulder so swings look right)
    rightArm = new THREE.Group();
    rightArm.position.set(0.62, 2.0, 0);
    var rArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.0, 0.26), skin);
    rArmMesh.position.y = -0.5;
    rightArm.add(rArmMesh);
    // weapon in the right hand — a scimitar, hidden until a weapon is equipped
    weapon = new THREE.Group();
    var handle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.5, 0.09),
      new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 1, flatShading: true }));
    handle.position.y = -0.25;
    var guard = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 0.12), matWeapon);
    guard.position.y = -0.5;
    var blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 0.05), matWeapon);
    blade.position.y = -1.2; blade.rotation.z = 0.25;   // slight curve
    weapon.add(handle); weapon.add(guard); weapon.add(blade);
    weapon.position.set(0.05, -0.4, 0.12);
    weapon.rotation.z = 0.18;   // held at the side, blade pointing down
    weapon.visible = false;
    rightArm.add(weapon);

    // bow held in the right hand — shown when a ranged weapon is equipped
    bowModel = new THREE.Group();
    var bowWood = new THREE.MeshStandardMaterial({ color: 0x6a4a24, roughness: 0.8, flatShading: true });
    var bowLimb = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 6, 14, Math.PI * 1.15), bowWood);
    bowLimb.rotation.z = Math.PI * 0.92;   // open side faces forward
    bowModel.add(bowLimb);
    var bowString = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.92, 4),
      new THREE.MeshStandardMaterial({ color: 0xe4d8b8, roughness: 1 }));
    bowString.position.x = 0.34; bowModel.add(bowString);
    var arrow = new THREE.Group();
    var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.85, 5), bowWood);
    shaft.rotation.x = Math.PI / 2; arrow.add(shaft);
    var tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.15, 5),
      new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.4, flatShading: true }));
    tip.rotation.x = Math.PI / 2; tip.position.z = 0.5; arrow.add(tip);
    arrow.position.set(0.28, 0, 0); bowModel.add(arrow);
    bowModel.position.set(0.06, -0.95, 0.16);
    bowModel.rotation.set(0, 0, 0);
    bowModel.visible = false;
    rightArm.add(bowModel);

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
    var rLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.95, 0.3), matLegs);
    rLegMesh.position.y = -0.47;
    rightLeg.add(rLegMesh);
    group.add(rightLeg);

    leftLeg = new THREE.Group();
    leftLeg.position.set(-0.24, 0.95, 0);
    var lLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.95, 0.3), matLegs);
    lLegMesh.position.y = -0.47;
    leftLeg.add(lLegMesh);
    group.add(leftLeg);

    group.traverse(function (o) { if (o.isMesh) { o.castShadow = true; } });

    bodyMeshes = [torso, head, rArmMesh, lArmMesh, rLegMesh, lLegMesh];
    applyCharModel();   // swap in the custom character model if it's loaded

    group.position.set(0, 0, 0);
    scene.add(group);
    Game.player = api;
    return api;
  }

  // Replace the procedural boxes with the imported character model (static).
  // Keeps the limb groups (rightArm etc.) so the equipped weapon still attaches.
  function applyCharModel() {
    if (!group || _charApplied || !window.Models || !Models.getCharacter) return;
    var m = Models.getCharacter();
    if (!m) return;
    m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1);   // exports already Y-up
    m.updateMatrixWorld(true);
    var sz = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
    _charScale = 2.66 / (sz.y || 1);         // world units per model unit (your modelling scale)
    m.scale.setScalar(_charScale);           // match the game's ~2.66u character height
    m.updateMatrixWorld(true);
    var b = new THREE.Box3().setFromObject(m);
    m.position.set(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);   // centre on xz, feet on the ground
    m.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    group.add(m);
    charModel = m;
    for (var i = 0; i < bodyMeshes.length; i++) if (bodyMeshes[i]) bodyMeshes[i].visible = false;
    _charApplied = true;
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
  // snap to look straight at a point — used so the character always faces the
  // rock/tree/enemy it's interacting with, not just eventually.
  function faceInstant(x, z) {
    var dx = x - group.position.x, dz = z - group.position.z;
    if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return;
    group.rotation.y = Math.atan2(dx, dz);
  }

  // snap a world x/z to the centre of its grid tile (falls back to the raw point)
  function snapPoint(x, z) {
    if (window.Grid && Grid.tileCenter) { var t = Grid.worldToTile(x, z); return Grid.tileCenter(t.tx, t.tz); }
    return { x: x, z: z };
  }

  // ---- public commands ----
  function walkTo(point) {
    if (state === 'dead') return;
    var c = snapPoint(point.x, point.z);           // click anywhere in a tile → walk to its centre
    moveTarget = new THREE.Vector3(c.x, 0, c.z);
    interaction = null;
    actionKind = null;
    walkPath = null; goalKey = null;   // force a fresh path
    state = 'moving';
  }

  function interactWith(entity) {
    if (state === 'dead' || !entity) return;
    interaction = { entity: entity, type: entity.type };
    moveTarget = null;
    walkPath = null; goalKey = null;   // force a fresh path
    state = 'moving';
  }

  function stop() {
    moveTarget = null; interaction = null; state = 'idle'; actionKind = null;
    walkPath = null; goalKey = null;
  }

  // (re)plan a tile path to the destination (or to a tile adjacent to `ent`).
  // Replans only when the goal tile changes, so it's cheap per-frame.
  function ensurePath(dest, ent) {
    if (!window.Grid || !Grid.findPath) { walkPath = null; return; }
    var k;
    if (ent) { var e = Grid.worldToTile(ent.position.x, ent.position.z); k = 'e' + e.tx + '_' + e.tz; }
    else { var m = Grid.worldToTile(dest.x, dest.z); k = 'm' + m.tx + '_' + m.tz; }
    if (k === goalKey && walkPath) return;
    goalKey = k;
    walkPath = ent ? Grid.findPathAdj(group.position, ent.position) : Grid.findPath(group.position, dest);
  }

  // ---- update ----
  // Spawn/teleport the player to their camp (slot 1 = north, 2 = south).
  function moveToCamp(slot) {
    if (!group) return;
    mySlot = (slot === 2) ? 2 : 1;
    var C = (window.World && World.CAMPS) ? World.CAMPS : { north: { x: 0, z: 0 }, south: { x: 0, z: 0 } };
    var c = (slot === 2) ? C.south : C.north;
    var cc = snapPoint(c.x, c.z);                 // spawn centred on a tile
    group.position.set(cc.x, terrainY(cc.x, cc.z), cc.z);
    group.rotation.y = Math.atan2(0 - c.x, 0 - c.z); // face the center of the map
    moveTarget = null; interaction = null; state = 'idle'; actionKind = null;
    walkPath = null; goalKey = null;
    CameraRig.setTarget(group.position);
  }

  // Story mode: drop the player onto the hand-placed spawn marker (world x/z).
  function spawnAt(x, z) {
    if (!group) return;
    var cc = snapPoint(x, z);                      // centre on the tile
    if (window.Grid && Grid.worldToTile && Grid.walkable && Grid.nearestWalkable && Grid.tileCenter) {
      var t = Grid.worldToTile(cc.x, cc.z);
      if (!Grid.walkable(t.tx, t.tz)) {            // spawn marker sits in/behind a wall → nudge onto open ground
        var nw = Grid.nearestWalkable(t.tx, t.tz);
        if (nw) { var c = Grid.tileCenter(nw.tx, nw.tz); cc.x = c.x; cc.z = c.z; }
      }
    }
    group.position.set(cc.x, terrainY(cc.x, cc.z), cc.z);
    group.rotation.y = Math.atan2(0 - cc.x, 0 - cc.z);  // face the level centre
    moveTarget = null; interaction = null; state = 'idle'; actionKind = null;
    walkPath = null; goalKey = null;
    if (window.CameraRig && CameraRig.setTarget) CameraRig.setTarget(group.position);
  }

  // A target stops being valid once it's gone — enemies flip active=false, but
  // remote players stay "active" through death/respawn, so check their state too.
  function targetValid(e) {
    if (!e || !e.active) return false;
    if (e.type === 'player' && (e.hp <= 0 || e.state === 'dead')) return false;
    return true;
  }

  function update(dt, t) {
    if (!group) return;

    if (eatAnim > 0) eatAnim = Math.max(0, eatAnim - dt);
    if (prayAnim > 0) prayAnim = Math.max(0, prayAnim - dt);
    if (eatLock > 0) eatLock = Math.max(0, eatLock - dt);
    if (death.active) { updateDeath(dt); return; }

    // Determine where to walk. For interactions, chase the entity's live pos.
    var dest = null, stopDist = 0.15, ent = null;
    if (interaction && targetValid(interaction.entity)) {
      ent = interaction.entity;
      var ep = ent.position;
      dest = new THREE.Vector3(ep.x, 0, ep.z);
      stopDist = ent.interactRange || 2.0;
      // a bow lets you loose arrows from range — stop well short and fire
      if (ent.type === 'enemy' && window.Skills && Skills.isRanged && Skills.isRanged()) stopDist = 14;
    } else if (interaction && !targetValid(interaction.entity)) {
      interaction = null; state = 'idle'; actionKind = null;
    } else if (moveTarget) {
      dest = moveTarget;
    }

    var moving = false;
    if (dest) {
      var dx = dest.x - group.position.x, dz = dest.z - group.position.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d > stopDist) {
        // Follow a tile path around obstacles; fall back to a straight line for
        // the final approach (or if no path was found).
        ensurePath(dest, ent);
        var usingPath = walkPath && walkPath.length > 0;
        if (usingPath) {
          var w0 = walkPath[0];
          var w0d = Math.hypot(w0.x - group.position.x, w0.z - group.position.z);
          if (w0d < 0.16) { walkPath.shift(); usingPath = walkPath.length > 0; }
        }
        var goX, goZ, maxStep = SPEED * (isRunning() ? RUN_MULT : 1) * dt, freeMove = false;
        if (usingPath) { var wp = walkPath[0]; goX = wp.x; goZ = wp.z; }
        else { goX = dest.x; goZ = dest.z; maxStep = Math.min(maxStep, Math.max(0, d - stopDist * 0.9)); freeMove = true; }
        var gdx = goX - group.position.x, gdz = goZ - group.position.z, gd = Math.hypot(gdx, gdz);
        if (gd > 0.0001 && maxStep > 0) {
          var step = Math.min(maxStep, gd);
          var nx = group.position.x + (gdx / gd) * step;
          var nz = group.position.z + (gdz / gd) * step;
          // A* waypoints are always walkable, but the straight-line fallback (no path
          // found — e.g. a click outside the walls) must NOT cross a blocked tile.
          if (freeMove && window.Grid && Grid.worldToTile && Grid.walkable) {
            var nt = Grid.worldToTile(nx, nz);
            if (!Grid.walkable(nt.tx, nt.tz)) { nx = group.position.x; nz = group.position.z; }
          }
          group.position.x = nx;
          group.position.z = nz;
          faceTowards(goX, goZ, dt);
        }
        moving = true;
        state = 'moving';
        actionKind = null; actionTimer = 0; swingFired = false;
      } else {
        // arrived — lock the character's facing onto the target it's interacting with
        if (ent) {
          faceInstant(ent.position.x, ent.position.z);
          if (ent.type === 'chest') {
            Entities.openChest(ent);
            interaction = null; state = 'idle'; actionKind = null;
          } else if (ent.type === 'station') {
            Entities.useStation(ent);
            interaction = null; state = 'idle'; actionKind = null;
          } else if (ent.type === 'obelisk') {
            Entities.useObelisk();
            interaction = null; state = 'idle'; actionKind = null;
          } else if (ent.type === 'drop') {
            Entities.pickupDrop(ent);
            interaction = null; state = 'idle'; actionKind = null;
          } else if (ent.type === 'pick') {
            Entities.pickupImported(ent);   // story-mode "_PICK" object (sticks…)
            interaction = null; state = 'idle'; actionKind = null;
          } else if (ent.type === 'gate') {
            Entities.useGate(ent);          // story-mode "_GATE" (cave entrance placeholder)
            interaction = null; state = 'idle'; actionKind = null;
          } else if (ent.type === 'npc') {
            Entities.talkToNpc(ent);        // story-mode talkable NPC → opens dialogue
            interaction = null; state = 'idle'; actionKind = null;
          } else if (ent.type === 'ballista') {
            Combat.fireBallista(ent);
            interaction = null; state = 'idle'; actionKind = null;
          } else if (ent.type === 'essaltar') {
            Entities.useEssenceAltar(ent);
            interaction = null; state = 'idle'; actionKind = null;
          } else {
            state = 'acting';
            var newKind = ent.type === 'tree' ? 'chop'
                        : (ent.type === 'rock' || ent.type === 'crystal' || ent.type === 'meteorite') ? 'mine'
                        : ent.type === 'fishpool' ? 'fish' : 'attack';
            if (newKind !== actionKind) { actionTimer = 0; swingFired = false; } // fresh swing on a new target/action
            actionKind = newKind;
            doActionTick(dt, ent);
          }
        } else {
          moveTarget = null;
          state = 'idle';
          actionKind = null; actionTimer = 0; swingFired = false;
          walkPath = null; goalKey = null;
          var sc = snapPoint(group.position.x, group.position.z);   // rest exactly on the tile centre
          group.position.x = sc.x; group.position.z = sc.z;
        }
      }
    } else {
      state = state === 'dead' ? 'dead' : 'idle';
    }

    updateEnergy(dt, moving);
    if (window.UI && UI.updateVitals) UI.updateVitals();   // reflect live energy drain/regen

    // keep on the ground
    group.position.y = terrainY(group.position.x, group.position.z);

    animate(dt, t, moving);
    CameraRig.setTarget(group.position);
  }

  function actionInterval() {
    if (actionKind === 'attack') return 1.2 * (window.Skills && Skills.weaponSpeed ? Skills.weaponSpeed() : 1);
    return 1.05;
  }

  // fires the actual game effect exactly at the swing's impact frame
  function fireActionEffect(ent) {
    if (actionKind === 'chop') { Skills.doWoodcut(ent); SFX.chop(); }
    else if (actionKind === 'mine') { if (ent.type === 'crystal' && window.Entities) Entities.mineCrystal(ent); else if (ent.type === 'meteorite' && window.Entities) Entities.mineMeteorite(ent); else Skills.doMine(ent); SFX.mine(); }
    else if (actionKind === 'fish') { Skills.doFish(ent); SFX.mine(); }
    else if (actionKind === 'attack') {
      if (!canAttack()) { if (window.UI) UI.showActionText('You are too full to attack.'); return; }
      if (ent.type === 'player') Combat.playerAttackPlayer(ent);
      else if (ent.type === 'boss') Combat.attackBoss(ent);
      else Combat.playerAttack(ent);
      SFX.hit();
    }
  }

  function doActionTick(dt, ent) {
    actionTimer += dt;
    var interval = actionInterval();
    var prog = actionTimer / interval;
    // the strike lands mid-swing: fire the effect once, at the impact frame,
    // so the hit is synced to the animation (not to the end of the cycle)
    if (!swingFired && prog >= IMPACT) {
      swingFired = true;
      fireActionEffect(ent);
    }
    if (actionTimer >= interval) {   // new swing begins
      actionTimer -= interval;
      swingFired = false;
    }
  }

  // ease helpers
  function smooth(x) { x = Utils.clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function lerp(a, b, x) { return a + (b - a) * x; }

  // windup -> strike(impact) -> recover pose for the swinging arm, per action
  function swingAngle(prog, back, strike) {
    if (prog < WINDUP_END) {
      return lerp(0, back, smooth(prog / WINDUP_END));              // raise/wind up
    } else if (prog < IMPACT) {
      return lerp(back, strike, smooth((prog - WINDUP_END) / (IMPACT - WINDUP_END))); // swing through to contact
    }
    return lerp(strike, 0, smooth((prog - IMPACT) / (1 - IMPACT))); // recover to rest
  }

  // which melee archetype is equipped → drives the attack animation
  function weaponArch() {
    var id = (window.Game && Game.equipment) ? Game.equipment.rhand : null;
    if (!id) return 'scimitar';
    if (id.indexOf('_dagger') >= 0) return 'dagger';
    if (id.indexOf('_greatsword') >= 0) return 'greatsword';
    return 'scimitar';   // scimitars + the bronze 'sword' + fallback
  }

  function animate(dt, t, moving) {
    animPhase += dt * (moving ? 10 : 3);
    if (rightArm) rightArm.rotation.z = Utils.damp(rightArm.rotation.z, 0, 12, dt);   // relax any side-sweep
    if (leftArm) leftArm.rotation.z = Utils.damp(leftArm.rotation.z, 0, 12, dt);
    if (state === 'acting' && actionKind) {
      var prog = Utils.clamp(actionTimer / actionInterval(), 0, 1);
      if (actionKind === 'fish') {
        // gentle rhythmic cast/reel — rod held in both hands, no hard strike
        var f = Math.sin(prog * Math.PI * 2);
        rightArm.rotation.x = -0.55 + f * 0.35;
        leftArm.rotation.x = -0.4 + f * 0.2;
        torso.rotation.x = f * 0.05;
        rightLeg.rotation.x = 0; leftLeg.rotation.x = 0;
      } else {
        var lean = smooth(prog < IMPACT ? prog / IMPACT : 1 - (prog - IMPACT) / (1 - IMPACT));
        if (actionKind === 'attack') {
          var arch = weaponArch();
          if (arch === 'dagger') {                 // quick forward STAB
            var sd = swingAngle(prog, -0.5, -1.5);
            rightArm.rotation.x = sd; leftArm.rotation.x = sd * 0.15;
            torso.rotation.x = lean * 0.12;
          } else if (arch === 'greatsword') {      // heavy overhead SLAM (two-handed)
            var sg = swingAngle(prog, -2.75, 1.65);
            rightArm.rotation.x = sg; leftArm.rotation.x = sg * 0.9;
            torso.rotation.x = lean * 0.34;
          } else {                                  // scimitar: diagonal up→down SWIPE
            var ss = swingAngle(prog, -2.0, 1.15);
            rightArm.rotation.x = ss;
            rightArm.rotation.z = swingAngle(prog, -0.5, 0.7) * 0.7;   // sideways sweep across the body
            leftArm.rotation.x = ss * 0.3;
            torso.rotation.x = lean * 0.2;
          }
          rightLeg.rotation.x = -0.15; leftLeg.rotation.x = 0.2;
        } else {
          // gathering: chop / mine
          var back, strike, la;
          if (actionKind === 'chop') { back = -2.5; strike = 1.15; la = 0.85; }  // big two-handed chop
          else { back = -1.7; strike = 1.05; la = 0.55; }                        // mine: shorter pick strike
          var a = swingAngle(prog, back, strike);
          rightArm.rotation.x = a; leftArm.rotation.x = a * la;
          torso.rotation.x = lean * 0.18;
          rightLeg.rotation.x = -0.15; leftLeg.rotation.x = 0.2;
        }
      }
    } else if (moving) {
      var s2 = Math.sin(animPhase);
      rightLeg.rotation.x = s2 * 0.7;
      leftLeg.rotation.x = -s2 * 0.7;
      rightArm.rotation.x = -s2 * 0.5;
      leftArm.rotation.x = s2 * 0.5;
      torso.rotation.x = Utils.damp(torso.rotation.x, 0, 6, dt);
    } else {
      // idle breathing
      var b = Math.sin(t * 2) * 0.05;
      rightArm.rotation.x = Utils.damp(rightArm.rotation.x, b, 6, dt);
      leftArm.rotation.x = Utils.damp(leftArm.rotation.x, -b, 6, dt);
      rightLeg.rotation.x = Utils.damp(rightLeg.rotation.x, 0, 6, dt);
      leftLeg.rotation.x = Utils.damp(leftLeg.rotation.x, 0, 6, dt);
      torso.rotation.x = Utils.damp(torso.rotation.x, 0, 6, dt);
    }
    // two-handed grip: the off-hand rests on the greatsword when not mid-swing
    if (weaponArch() === 'greatsword' && state !== 'acting' && eatAnim <= 0 && prayAnim <= 0 && leftArm) {
      rightArm.rotation.x = Utils.damp(rightArm.rotation.x, -0.5, 8, dt);
      leftArm.rotation.x = Utils.damp(leftArm.rotation.x, -0.55, 8, dt);
      leftArm.rotation.z = Utils.damp(leftArm.rotation.z, -0.7, 8, dt);
    }
    // eating gesture overrides the arm pose: hand to the mouth with a chew bob
    if (eatAnim > 0 && rightArm) {
      var eb = Math.sin((1.2 - eatAnim) * Math.PI * 5) * 0.14;
      rightArm.rotation.x = -2.25 + eb;
    }
    // praying/burying gesture: both hands raised, a slight reverent bow
    if (prayAnim > 0 && rightArm) {
      rightArm.rotation.x = -2.5; leftArm.rotation.x = -2.5;
      torso.rotation.x = 0.25;
    }
  }

  // ---- damage / death ----
  function takeDamage(dmg) {
    if (state === 'dead' || death.active) return;
    stats.hp = Utils.clamp(stats.hp - dmg, 0, stats.maxHp);
    UI.updateVitals();
    UI.flashDamage();
    SFX.hurt();
    if (stats.hp <= 0) startDeath();
  }

  function heal(n) {
    if (state === 'dead' || death.active || n <= 0) return;
    stats.hp = Utils.clamp(stats.hp + n, 0, stats.maxHp);
    if (window.UI) UI.updateVitals();
  }

  // eating: play a gesture and lock out attacks for a few seconds
  function startEating() {
    eatAnim = 1.2;
    eatLock = EAT_LOCK;
    // cancel any attack in progress
    if (actionKind === 'attack') { actionKind = null; interaction = null; state = 'idle'; }
  }
  function canAttack() { return eatLock <= 0 && !death.active && state !== 'dead'; }
  function startPraying() { prayAnim = 1.4; }

  // scale + seat an imported weapon model into the right hand (procedural weapon
  // sits blade-down at ~(0.05,-0.4,0.12); we match that footprint)
  function detachWeaponModel() {
    if (weaponModel && rightArm) rightArm.remove(weaponModel);
    weaponModel = null;
  }
  // per-archetype in-hand orientation (models are Z-up, origin at the grip).
  // dagger points up out of the fist; scimitar/greatsword face the other way and
  // hang blade-down toward the ground. Tweak these if a weapon sits wrong.
  var WEAPON_POSE = {
    dagger:     { rot: [-Math.PI / 2, 0, 0],             pos: [0, -0.95, 0.18] },
    scimitar:   { rot: [-Math.PI / 2, -Math.PI / 2, 0],  pos: [0, -0.95, 0.2] },    // flipped upside-down, grip at the hand tip
    greatsword: { rot: [Math.PI / 2, Math.PI, 0],        pos: [0, -0.55, 0.22] }
  };
  function fitWeaponModel(m, arch) {
    var P = WEAPON_POSE[arch] || WEAPON_POSE.dagger;
    m.position.set(0, 0, 0);
    m.rotation.set(P.rot[0], P.rot[1], P.rot[2]);
    if (_charScale != null) {
      m.scale.setScalar(_charScale);                       // YOUR exported scale (matched to the character)
    } else {
      m.scale.set(1, 1, 1); m.updateMatrixWorld(true);
      var size = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
      m.scale.setScalar(1.4 / (Math.max(size.x, size.y, size.z) || 1));   // fallback: normalise to a hand-size
    }
    m.position.set(P.pos[0], P.pos[1], P.pos[2]);          // seat the grip at the hand (no recentring)
  }

  // recolour the character to show equipped gear tiers (0/undefined = default)
  function applyAppearance(app) {
    if (!matHead) return;
    app = app || {};
    _lastApp = app;
    matHead.color.setHex(app.head || BASE_HEAD); matHead.metalness = app.head ? 0.6 : 0;
    matBody.color.setHex(app.body || BASE_BODY); matBody.metalness = app.body ? 0.6 : 0;
    matLegs.color.setHex(app.legs || BASE_LEGS); matLegs.metalness = app.legs ? 0.6 : 0;
    // ranged weapon → show the bow; otherwise show a metal scimitar (if any)
    var ranged = !!app.ranged;
    if (bowModel) bowModel.visible = ranged;
    if (app.weapon && !ranged) { matWeapon.color.setHex(app.weapon); weapon.visible = true; }
    else if (weapon) { weapon.visible = false; }

    // a custom imported .glb for the equipped right-hand weapon overrides the above
    detachWeaponModel();
    var rhId = (window.Game && Game.equipment) ? Game.equipment.rhand : null;
    if (rhId && window.Models && Models.ready(rhId) && rightArm) {
      var m = Models.get(rhId);
      if (m) {
        fitWeaponModel(m, weaponArch());
        weaponModel = m; rightArm.add(m);
        if (weapon) weapon.visible = false;
        if (bowModel) bowModel.visible = false;
      }
    }
  }

  // re-apply the last appearance (used when a model finishes loading late)
  function refreshAppearance() { if (_lastApp) applyAppearance(_lastApp); }

  function startDeath(onDone) {
    if (death.active) return;
    state = 'dead';
    interaction = null; moveTarget = null;
    death.active = true;
    death.phase = 'dance';
    death.t = 0;
    death.baseY = group.position.y;
    death.onDone = onDone || null;
    if (window.Coop && Coop.onPlayerDeath) Coop.onPlayerDeath();   // co-op: a death feeds the demon
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
    eatAnim = 0; prayAnim = 0; eatLock = 0;
    state = 'idle';
    interaction = null; moveTarget = null; actionKind = null; actionTimer = 0;
    if (group) {
      // rebuild a fresh mesh FIRST (build() re-centres it at the origin), THEN
      // place it back at your own camp — slot 1 = north, slot 2 = south — and
      // re-apply equipped gear (tier colours + bow) and max HP.
      restoreColors();
      var C = (window.World && World.CAMPS) ? World.CAMPS : null;
      var c = C ? (mySlot === 2 ? C.south : C.north) : { x: 0, z: 0 };
      group.position.set(c.x, terrainY(c.x, c.z), c.z);
      group.rotation.set(0, Math.atan2(0 - c.x, 0 - c.z), 0);
      if (window.Skills && Skills.applyEquipmentToStats) Skills.applyEquipmentToStats();
      if (window.CameraRig) CameraRig.setTarget(group.position);
    }
    stats.hp = stats.maxHp;
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
    takeDamage: takeDamage, heal: heal, startDeath: startDeath, reset: reset,
    applyBonuses: applyBonuses, moveToCamp: moveToCamp, spawnAt: spawnAt,
    startEating: startEating, startPraying: startPraying, canAttack: canAttack, applyAppearance: applyAppearance, refreshAppearance: refreshAppearance, applyCharModel: applyCharModel,
    toggleRun: toggleRun, setRunning: setRunning, isRunning: isRunning,
    get energy() { return energy; }, get maxEnergy() { return ENERGY_MAX; }, get running() { return running; },
    get state() { return state; },
    get position() { return group ? group.position : new THREE.Vector3(); },
    get group() { return group; },
    get stats() { return stats; },
    get isDead() { return state === 'dead'; },
    get interaction() { return interaction; }
  };
  return api;
})();
