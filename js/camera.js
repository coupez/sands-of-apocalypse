// ============================================================
// camera.js — RuneScape-style orbit-follow camera rig
//   A/D or ←/→ : orbit yaw     W/S or ↑/↓ : pitch
//   Q/E        : rotate yaw     wheel      : zoom
// ============================================================

var CameraRig = (function () {
  var camera;
  var target = new THREE.Vector3(0, 1, 0);   // point the camera looks at (player)
  var yaw = 0.6;         // horizontal angle
  var pitch = 0.9;       // vertical angle (radians from horizon-ish)
  var dist = 22;         // zoom distance
  var minPitch = 0.35, maxPitch = 1.35;
  var minDist = 8, maxDist = 40;

  var keys = {};
  var ORBIT_SPEED = 1.6;   // rad/sec
  var PITCH_SPEED = 1.2;
  var ZOOM_KEY_SPEED = 14;

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
  }

  function setTarget(v) { target.copy(v); }

  function update(dt) {
    var left  = keys['KeyA'] || keys['ArrowLeft'];
    var right = keys['KeyD'] || keys['ArrowRight'];
    var up    = keys['KeyW'] || keys['ArrowUp'];
    var down  = keys['KeyS'] || keys['ArrowDown'];

    if (left)  yaw += ORBIT_SPEED * dt;
    if (right) yaw -= ORBIT_SPEED * dt;
    if (keys['KeyQ']) yaw += ORBIT_SPEED * dt;
    if (keys['KeyE']) yaw -= ORBIT_SPEED * dt;

    // W/S dolly + subtly change pitch for a cinematic push-in
    if (up)   { dist = Utils.clamp(dist - ZOOM_KEY_SPEED * dt, minDist, maxDist); pitch = Utils.clamp(pitch - 0.4 * dt, minPitch, maxPitch); }
    if (down) { dist = Utils.clamp(dist + ZOOM_KEY_SPEED * dt, minDist, maxDist); pitch = Utils.clamp(pitch + 0.4 * dt, minPitch, maxPitch); }

    if (!camera) return;
    var horiz = Math.cos(pitch) * dist;
    var vert = Math.sin(pitch) * dist;
    var desired = new THREE.Vector3(
      target.x + Math.sin(yaw) * horiz,
      target.y + vert,
      target.z + Math.cos(yaw) * horiz
    );
    // smooth follow
    camera.position.x = Utils.damp(camera.position.x, desired.x, 8, dt);
    camera.position.y = Utils.damp(camera.position.y, desired.y, 8, dt);
    camera.position.z = Utils.damp(camera.position.z, desired.z, 8, dt);
    camera.lookAt(target.x, target.y + 1.2, target.z);
  }

  return {
    init: init, update: update, setTarget: setTarget,
    get yaw() { return yaw; }
  };
})();
