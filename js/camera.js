// ============================================================
// camera.js — RuneScape-style orbit-follow camera rig
//   A/D or ←/→ : orbit yaw     W/S or ↑/↓ : pull back & up / push in & down
//   Q/E        : rotate yaw     wheel      : zoom
// ============================================================

var CameraRig = (function () {
  var camera;
  var target = new THREE.Vector3(0, 0, 0);   // player's feet position (set each frame)
  var FOCUS_HEIGHT = 1.0; // orbit pivot AND look-at point, this far above the feet (waist-ish, not above the head)
  var yaw = 0.6;         // horizontal angle
  var pitch = 0.9;       // vertical angle (radians from horizon-ish)
  var dist = 22;         // zoom distance
  var minPitch = 0.35, maxPitch = 1.35;
  var minDist = 8, maxDist = 40;

  var keys = {};
  var ORBIT_SPEED = 1.6;   // rad/sec
  var PITCH_SPEED = 1.2;
  var ZOOM_KEY_SPEED = 14;

  // occlusion: hide any object standing between the camera and the player
  var occRay = new THREE.Raycaster();
  var occHidden = [];
  var _fwd = new THREE.Vector3();

  function init(cam) {
    camera = cam;
    window.addEventListener('keydown', function (e) {
      keys[e.code] = true;
      // prevent arrow keys scrolling the page
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].indexOf(e.code) >= 0) e.preventDefault();
    });
    window.addEventListener('keyup', function (e) { keys[e.code] = false; });
    window.addEventListener('wheel', function (e) {
      dist = Utils.clamp(dist + (e.deltaY > 0 ? 1.6 : -1.6), minDist, maxDist);
    }, { passive: true });

    // hold the middle mouse button and drag to orbit around the character
    var dragging = false, lastX = 0, lastY = 0;
    window.addEventListener('mousedown', function (e) { if (e.button === 1) e.preventDefault(); }); // no autoscroll
    window.addEventListener('pointerdown', function (e) {
      if (e.button === 1) { dragging = true; lastX = e.clientX; lastY = e.clientY; }
    });
    window.addEventListener('pointerup', function (e) { if (e.button === 1) dragging = false; });
    window.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      yaw -= dx * 0.008;   // drag right → orbit left
      pitch = Utils.clamp(pitch - dy * 0.006, minPitch, maxPitch);
    });
  }

  function setTarget(v) { target.copy(v); }

  function update(dt) {
    var left  = keys['KeyA'] || keys['ArrowLeft'];
    var right = keys['KeyD'] || keys['ArrowRight'];
    var up    = keys['KeyW'] || keys['ArrowUp'];
    var down  = keys['KeyS'] || keys['ArrowDown'];

    if (left)  yaw -= ORBIT_SPEED * dt;
    if (right) yaw += ORBIT_SPEED * dt;
    if (keys['KeyQ']) yaw -= ORBIT_SPEED * dt;
    if (keys['KeyE']) yaw += ORBIT_SPEED * dt;

    // W/S dolly + subtly change pitch: W pulls back & up, S pushes in & down
    if (up)   { dist = Utils.clamp(dist + ZOOM_KEY_SPEED * dt, minDist, maxDist); pitch = Utils.clamp(pitch + 0.4 * dt, minPitch, maxPitch); }
    if (down) { dist = Utils.clamp(dist - ZOOM_KEY_SPEED * dt, minDist, maxDist); pitch = Utils.clamp(pitch - 0.4 * dt, minPitch, maxPitch); }

    if (!camera) return;
    // orbit around AND look at the same raised focus point above the player
    var fx = target.x, fy = target.y + FOCUS_HEIGHT, fz = target.z;
    var horiz = Math.cos(pitch) * dist;
    var vert = Math.sin(pitch) * dist;
    var desired = new THREE.Vector3(
      fx + Math.sin(yaw) * horiz,
      fy + vert,
      fz + Math.cos(yaw) * horiz
    );
    // smooth follow
    camera.position.x = Utils.damp(camera.position.x, desired.x, 8, dt);
    camera.position.y = Utils.damp(camera.position.y, desired.y, 8, dt);
    camera.position.z = Utils.damp(camera.position.z, desired.z, 8, dt);
    camera.lookAt(fx, fy, fz);

    hideOccluders(fx, fy, fz);
  }

  // Fade out (hide) whatever the camera is looking through to reach the player.
  function hideOccluders(fx, fy, fz) {
    var occ = window.Game && Game.occluders;
    if (!occ || !occ.length) return;
    // reveal everything hidden last frame, then re-hide what still blocks
    for (var r = 0; r < occHidden.length; r++) occHidden[r].visible = true;
    occHidden.length = 0;
    _fwd.set(fx - camera.position.x, fy - camera.position.y, fz - camera.position.z);
    var dist = _fwd.length();
    if (dist < 0.001) return;
    _fwd.multiplyScalar(1 / dist);
    occRay.set(camera.position, _fwd);
    occRay.far = dist - 1.5;   // leave the player (and anything touching them) visible
    var hits = occRay.intersectObjects(occ, false);
    for (var h = 0; h < hits.length; h++) {
      var grp = hits[h].object.userData.occGroup;
      if (grp && grp.visible) { grp.visible = false; occHidden.push(grp); }
    }
  }

  return {
    init: init, update: update, setTarget: setTarget,
    get yaw() { return yaw; }
  };
})();
