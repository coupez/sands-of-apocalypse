// ============================================================
// utils.js — shared state, math helpers, RS-style XP table, SFX
// ============================================================

// Central shared game state (populated by the various modules).
var Game = {
  running: false,
  headless: false,      // true in ?selftest mode (skips heavy rendering assumptions)
  selftest: false,
  time: 0,              // seconds since start
  paused: false,
  scene: null,
  camera: null,
  renderer: null,
  player: null,
  inventory: [],        // array of {id, name, icon, count}
  invMax: 28,
  log: []               // event log for self-test assertions
};

var Utils = (function () {
  // Deterministic-ish RNG so self-test runs are reproducible when seeded.
  var _seed = 1337;
  function seed(s) { _seed = s >>> 0; }
  function rand() {
    // xorshift32
    _seed ^= _seed << 13; _seed >>>= 0;
    _seed ^= _seed >> 17;
    _seed ^= _seed << 5; _seed >>>= 0;
    return (_seed >>> 0) / 4294967296;
  }
  function randRange(a, b) { return a + rand() * (b - a); }
  function randInt(a, b) { return Math.floor(randRange(a, b + 1)); }
  function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function damp(current, target, lambda, dt) {
    return lerp(current, target, 1 - Math.exp(-lambda * dt));
  }

  // ---- RuneScape XP curve ----
  var _xpTable = (function () {
    var table = [0, 0]; // index by level; level 1 -> 0 xp
    var points = 0;
    for (var lvl = 1; lvl < 99; lvl++) {
      points += Math.floor(lvl + 300 * Math.pow(2, lvl / 7));
      table[lvl + 1] = Math.floor(points / 4);
    }
    return table;
  })();
  function xpForLevel(lvl) { return _xpTable[clamp(lvl, 1, 99)]; }
  function levelForXp(xp) {
    for (var lvl = 99; lvl >= 1; lvl--) {
      if (xp >= _xpTable[lvl]) return lvl;
    }
    return 1;
  }

  return {
    seed: seed, rand: rand, randRange: randRange, randInt: randInt, pick: pick,
    clamp: clamp, lerp: lerp, damp: damp,
    xpForLevel: xpForLevel, levelForXp: levelForXp
  };
})();

// ---- Minimal synthesized sound effects (WebAudio, no asset files) ----
var SFX = (function () {
  var ctx = null;
  var enabled = true;
  function ensure() {
    if (Game.headless) return null;
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { enabled = false; }
    }
    if (ctx && ctx.state === 'suspended') { ctx.resume(); }
    return ctx;
  }
  function tone(freq, dur, type, gain, slideTo) {
    if (!enabled || Game.headless) return;
    var c = ensure();
    if (!c) return;
    var o = c.createOscillator();
    var g = c.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
    g.gain.setValueAtTime(gain || 0.08, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + dur);
  }
  return {
    unlock: function () { ensure(); },
    chop: function () { tone(180, 0.12, 'triangle', 0.10, 90); },
    mine: function () { tone(120, 0.10, 'square', 0.08, 70); },
    hit:  function () { tone(220, 0.09, 'sawtooth', 0.07, 110); },
    hurt: function () { tone(140, 0.18, 'square', 0.10, 60); },
    dead: function () { tone(200, 0.5, 'sawtooth', 0.12, 40); },
    dodge: function () { tone(420, 0.22, 'sine', 0.09, 140); },
    level:function () { tone(520, 0.15, 'square', 0.10); setTimeout(function(){tone(780,0.25,'square',0.10);}, 120); },
    pickup: function () { tone(660, 0.07, 'triangle', 0.06, 880); },
    // gritty layer under the voice line so it reads as a scream
    screamFx: function () {
      if (!enabled || Game.headless) return;
      var c = ensure(); if (!c) return;
      var o = c.createOscillator(), g = c.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(520, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(180, c.currentTime + 0.5);
      g.gain.setValueAtTime(0.14, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.55);
      o.connect(g); g.connect(c.destination);
      o.start(); o.stop(c.currentTime + 0.55);
    }
  };
})();

// ---- Voice (browser TTS) — makes the mutant actually shout its line ----
var Voice = (function () {
  var voices = [];
  function refresh() {
    try { voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : []; } catch (e) { voices = []; }
  }
  function init() {
    if (Game.headless || !('speechSynthesis' in window)) return;
    refresh();
    window.speechSynthesis.onvoiceschanged = refresh;
  }
  function scream(text) {
    if (Game.headless || !('speechSynthesis' in window)) return;
    try {
      if (!voices.length) refresh();
      var u = new SpeechSynthesisUtterance(text);
      // prefer a Japanese voice if the OS has one, else default
      var jp = null;
      for (var i = 0; i < voices.length; i++) {
        if (/ja|japanese/i.test(voices[i].lang + ' ' + voices[i].name)) { jp = voices[i]; break; }
      }
      if (jp) u.voice = jp;
      u.lang = jp ? jp.lang : 'ja-JP';
      u.volume = 1.0;   // as loud as allowed
      u.rate = 1.05;
      u.pitch = 1.7;    // strained, screamed delivery
      window.speechSynthesis.cancel(); // don't queue overlaps
      window.speechSynthesis.speak(u);
      SFX.screamFx();
    } catch (e) {}
  }
  return { init: init, scream: scream };
})();
