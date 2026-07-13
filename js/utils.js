// ============================================================
// utils.js — shared state, math helpers, RS-style XP table, SFX
// ============================================================

// Central shared game state (populated by the various modules).
var Game = {
  running: false,
  headless: false,      // true in ?selftest mode (skips heavy rendering assumptions)
  selftest: false,
  online: false,        // true once the server is driving the shared world
  mode: 'coop',         // 'pending' | 'versus' | 'coop' — offline defaults to a coop sandbox
  coop: null,           // shared co-op state (sigils, ritual, boss) when in co-op
  _isHost: false,       // this client is the session host (chooses the mode)
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

  // A name in the style "Amira of Luxor" — a popular Egyptian given name (male or
  // female) + an Egyptian place. Uses Math.random (identity, not the world seed).
  var EGY_NAMES = ['Ahmed', 'Mohamed', 'Mahmoud', 'Youssef', 'Omar', 'Khaled', 'Amir', 'Karim', 'Hassan', 'Tarek', 'Mostafa', 'Ali', 'Ibrahim', 'Sayed',
    'Fatma', 'Aisha', 'Mariam', 'Nour', 'Salma', 'Yasmin', 'Layla', 'Hana', 'Amira', 'Dalia', 'Rania', 'Zeinab', 'Farida', 'Habiba'];
  var EGY_PLACES = ['Luxor', 'Aswan', 'Giza', 'Cairo', 'Alexandria', 'Saqqara', 'Karnak', 'Memphis', 'Thebes', 'Dahshur', 'Faiyum', 'Siwa', 'Rosetta', 'Edfu', 'Abydos', 'Dendera', 'Minya', 'Sohag'];
  function egyptianName() {
    var f = EGY_NAMES[Math.floor(Math.random() * EGY_NAMES.length)];
    var p = EGY_PLACES[Math.floor(Math.random() * EGY_PLACES.length)];
    return f + ' of ' + p;
  }

  return {
    seed: seed, rand: rand, randRange: randRange, randInt: randInt, pick: pick,
    clamp: clamp, lerp: lerp, damp: damp,
    xpForLevel: xpForLevel, levelForXp: levelForXp, egyptianName: egyptianName
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

// ---- Ambient soundtrack (WebAudio) — sandy wind + a subtle sitar drone/plucks ----
// Fully synthesized (no asset files). Started on the first user gesture so the
// browser lets audio play. Deliberately very quiet — atmosphere, not music.
var Ambient = (function () {
  var ctx = null, started = false, master = null, alive = false, muted = false;
  var LEVEL = 0.55;
  var SCALE = [220.0, 246.94, 293.66, 329.63, 392.0, 440.0];  // A minor pentatonic-ish

  function noiseBuffer(c) {
    var len = c.sampleRate * 2, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0), last = 0;
    for (var i = 0; i < len; i++) { var w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
    return b;
  }
  function start() {
    if (started || Game.headless) return;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    started = true; alive = true;
    if (ctx.state === 'suspended') ctx.resume();
    master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.setTargetAtTime(muted ? 0.0001 : LEVEL, ctx.currentTime, muted ? 0.1 : 4);   // slow fade-in
    master.connect(ctx.destination);

    // --- wind: filtered noise with slow gusts on cutoff + gain ---
    var wind = ctx.createBufferSource(); wind.buffer = noiseBuffer(ctx); wind.loop = true;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 480;
    var wg = ctx.createGain(); wg.gain.value = 0.11;
    wind.connect(lp); lp.connect(wg); wg.connect(master);
    var gust = ctx.createOscillator(); gust.frequency.value = 0.05;
    var gustAmt = ctx.createGain(); gustAmt.gain.value = 280;
    gust.connect(gustAmt); gustAmt.connect(lp.frequency); gust.start();
    var gust2 = ctx.createOscillator(); gust2.frequency.value = 0.08;
    var gust2Amt = ctx.createGain(); gust2Amt.gain.value = 0.055;
    gust2.connect(gust2Amt); gust2Amt.connect(wg.gain); gust2.start();
    wind.start();

    // --- sitar drone: a few detuned saws through a soft lowpass ---
    var drone = ctx.createGain(); drone.gain.value = 0.028; drone.connect(master);
    var dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 700; dlp.connect(drone);
    [110.0, 110.55, 164.81].forEach(function (f) {
      var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      var g = ctx.createGain(); g.gain.value = 0.5; o.connect(g); g.connect(dlp); o.start();
    });

    schedulePluck();
  }
  function pluck(freq) {
    if (!alive || !ctx) return;
    var t = ctx.currentTime;
    var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    var o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = freq * 2.01;
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq * 3; bp.Q.value = 5;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    o.connect(bp); o2.connect(bp); bp.connect(g); g.connect(master);
    o.start(t); o2.start(t); o.stop(t + 1.8); o2.stop(t + 1.8);
  }
  function schedulePluck() {
    if (!alive) return;
    pluck(SCALE[Math.floor(Math.random() * SCALE.length)]);
    setTimeout(schedulePluck, 3200 + Math.random() * 4500);
  }
  function stop() { alive = false; if (master && ctx) master.gain.setTargetAtTime(0.0001, ctx.currentTime, 1); }
  // mute/unmute — ramps the master gain; starts the audio if it isn't running yet
  function setMuted(m) {
    muted = !!m;
    if (started && master && ctx) master.gain.setTargetAtTime(muted ? 0.0001 : LEVEL, ctx.currentTime, 0.35);
    return !muted;
  }
  function toggle() {
    muted = !muted;
    if (!started) start();   // start() reads `muted` for its initial gain (this is a user gesture)
    else if (master && ctx) master.gain.setTargetAtTime(muted ? 0.0001 : LEVEL, ctx.currentTime, 0.35);
    return !muted;           // true = music now ON
  }
  function isOn() { return !muted; }
  return { start: start, stop: stop, toggle: toggle, setMuted: setMuted, isOn: isOn };
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
  // pick the first installed voice whose lang/name matches a preference
  function pickVoice(prefs) {
    if (!prefs) return null;
    for (var p = 0; p < prefs.length; p++) {
      var pref = prefs[p].toLowerCase();
      for (var i = 0; i < voices.length; i++) {
        if ((voices[i].lang + ' ' + voices[i].name).toLowerCase().indexOf(pref) >= 0) return voices[i];
      }
    }
    return null;
  }

  function speak(text, opts) {
    if (Game.headless || !('speechSynthesis' in window)) return;
    try {
      opts = opts || {};
      if (!voices.length) refresh();
      var u = new SpeechSynthesisUtterance(text);
      var v = pickVoice(opts.langs);
      if (v) { u.voice = v; u.lang = v.lang; }
      else if (opts.lang) { u.lang = opts.lang; }
      u.volume = opts.volume == null ? 1.0 : opts.volume;
      u.rate = opts.rate == null ? 1.0 : opts.rate;
      u.pitch = opts.pitch == null ? 1.0 : opts.pitch;
      window.speechSynthesis.cancel(); // don't queue overlaps
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  // mutant's screamed thank-you
  function scream(text) {
    speak(text, { langs: ['ja', 'japanese'], lang: 'ja-JP', volume: 1.0, rate: 1.05, pitch: 1.7 });
    SFX.screamFx();
  }

  return { init: init, speak: speak, scream: scream };
})();
