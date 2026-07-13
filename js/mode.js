// ============================================================
// mode.js — game-mode selection (Versus vs Co-op)
// The first player to join (the host) chooses; everyone else waits,
// then the choice is applied on every client.
// ============================================================

var Mode = (function () {
  var chooserEl = null, waitEl = null;

  function isHost() { return !!Game._isHost; }

  // ---- host's mode chooser overlay ----
  function showChooser() {
    if (Game.headless) return;
    Game._isHost = true;
    hideWait();
    if (chooserEl) return;
    chooserEl = document.createElement('div');
    chooserEl.id = 'mode-chooser';
    chooserEl.innerHTML =
      '<div class="mc-inner">' +
        '<div class="mc-title">CHOOSE YOUR GAME</div>' +
        '<div class="mc-sub">You are the host — pick how you play.</div>' +
        '<div class="mc-cards">' +
          '<button class="mc-card" data-mode="versus">' +
            '<div class="mc-ic">⚔️</div><div class="mc-name">VERSUS</div>' +
            '<div class="mc-desc">Race your rival. First to forge the Heart of the Obelisk and place it wins the desert. A new challenger joining restarts the race.</div>' +
          '</button>' +
          '<button class="mc-card" data-mode="coop">' +
            '<div class="mc-ic">🤝</div><div class="mc-name">CO-OP</div>' +
            '<div class="mc-desc">Share a camp. Light the sigils together down whatever paths you choose — then survive what you accidentally summon.</div>' +
          '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(chooserEl);
    var btns = chooserEl.querySelectorAll('.mc-card');
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        b.addEventListener('click', function () {
          if (window.Net && Net.sendChooseMode) Net.sendChooseMode(b.getAttribute('data-mode'));
        });
      })(btns[i]);
    }
  }

  // ---- non-host "waiting for the host" overlay ----
  function showWait() {
    if (Game.headless || waitEl || chooserEl) return;
    waitEl = document.createElement('div');
    waitEl.id = 'mode-wait';
    waitEl.innerHTML = '<div class="mc-inner"><div class="mc-title">SANDS OF APOCALYPSE</div>' +
      '<div class="mc-wait">Waiting for the host to choose a game…</div></div>';
    document.body.appendChild(waitEl);
  }

  function hideChooser() { if (chooserEl && chooserEl.parentNode) chooserEl.parentNode.removeChild(chooserEl); chooserEl = null; }
  function hideWait() { if (waitEl && waitEl.parentNode) waitEl.parentNode.removeChild(waitEl); waitEl = null; }

  // ---- apply a chosen/known mode on this client ----
  function setMode(mode, coop) {
    if (!mode || mode === 'pending') return;
    Game.mode = mode;
    if (coop) Game.coop = coop;
    hideChooser(); hideWait();
    // co-op: everyone shares the north camp
    if (mode === 'coop' && window.Player && Player.moveToCamp) Player.moveToCamp(1);
    if (window.UI && UI.showActionText) {
      UI.showActionText(mode === 'coop'
        ? 'Co-op: light the sigils together — and beware what wakes.'
        : 'Versus: race your rival to the Obelisk!');
    }
    if (window.Coop && Coop.onMode) Coop.onMode(mode, coop);
    if (window.UI && UI.updateScore) UI.updateScore();   // show/hide the versus scoreboard
    Game.log.push('mode:' + mode);
  }

  // ---- from net welcome: {mode, isHost} ----
  function onWelcome(mode, host) {
    Game._isHost = !!host;
    if (mode && mode !== 'pending') setMode(mode, Game.coop);
    else if (host) showChooser();
    else showWait();
  }

  return {
    isHost: isHost, showChooser: showChooser, showWait: showWait,
    hideChooser: hideChooser, hideWait: hideWait, setMode: setMode, onWelcome: onWelcome
  };
})();
