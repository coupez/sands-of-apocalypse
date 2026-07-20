// ============================================================
// dialogue.js — NPC conversation system.
//
// Talking to an NPC (Entities.talkToNpc) opens a branching dialogue in the
// bottom-left box: the NPC speaks a line, you click one of several answers,
// and each answer jumps to another line (its own branch) or ends the chat.
//
// The actual words live in an EDITABLE data file — `dialogue/dialogues.json`
// — so the writing can be changed without touching code. See
// dialogue/README.md for the format. A copy of the default tree is embedded
// below so the game still works if that file is missing (e.g. offline).
// ============================================================

var Dialogue = (function () {
  // Embedded fallback = the same content shipped in dialogue/dialogues.json.
  // If the JSON file loads, it REPLACES this. Keys are dialogue ids; each tree
  // has { name, start, nodes:{ key:{ npc, options:[{text, goto}] } } }.
  // `goto: "end"` (or a missing/unknown key) closes the conversation.
  var DEFAULT_TREES = {
    trapped_wanderer: {
      name: 'Trapped Wanderer',
      start: 'intro',
      nodes: {
        intro: {
          npc: "I don't know how to get out of here. I've been trapped here.",
          options: [
            { text: "Don't worry — I'll find us a way out of here.", goto: 'hopeful' },
            { text: "Sounds like your problem. I'm not staying.", goto: 'bitter' }
          ]
        },
        hopeful: {
          npc: "You'd truly help me? Bless you, stranger. Together, maybe we can break through the cave.",
          options: [
            { text: "Count on it. Sit tight.", goto: 'end' }
          ]
        },
        bitter: {
          npc: "...Cold as the night sands. May they show you the same mercy you showed me.",
          options: [
            { text: "Whatever. (Leave)", goto: 'end' }
          ]
        }
      }
    }
  };

  var trees = DEFAULT_TREES;
  var active = null;   // { id, tree, nodeKey, npcName }

  // Load the writer-editable dialogue file; merge over the embedded defaults so a
  // partial/malformed file can't wipe the working test conversation.
  function init() {
    if (typeof fetch !== 'function') return;
    fetch('dialogue/dialogues.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && typeof j === 'object') {
          var merged = {};
          for (var k in DEFAULT_TREES) if (DEFAULT_TREES.hasOwnProperty(k)) merged[k] = DEFAULT_TREES[k];
          for (var k2 in j) if (j.hasOwnProperty(k2)) merged[k2] = j[k2];
          trees = merged;
        }
      })
      .catch(function () { /* no file / offline — keep the embedded defaults */ });
  }

  function has(id) { return !!trees[id]; }

  // Begin a conversation. Unknown id falls back to the test wanderer so a
  // mis-named NPC still says something instead of silently failing.
  function start(id, npcName) {
    var tree = trees[id] || trees.trapped_wanderer;
    if (!tree || !tree.nodes) return false;
    active = {
      id: id, tree: tree,
      nodeKey: tree.start || Object.keys(tree.nodes)[0],
      npcName: npcName || tree.name || 'Stranger'
    };
    Game.log.push('dlg:start:' + id);
    render();
    return true;
  }

  // The current line + its answer options (null if nothing is open).
  function current() {
    if (!active) return null;
    var node = active.tree.nodes[active.nodeKey];
    if (!node) return null;
    return { name: active.npcName || active.tree.name, text: node.npc || '', options: node.options || [] };
  }

  function render() {
    var c = current();
    if (!c) { close(); return; }
    if (window.UI && UI.showDialogue) UI.showDialogue(c);
  }

  // Pick answer i → follow its branch, or end the conversation.
  function choose(i) {
    if (!active) return;
    var node = active.tree.nodes[active.nodeKey];
    if (!node || !node.options || !node.options[i]) { close(); return; }
    Game.log.push('dlg:choose:' + i);
    var next = node.options[i].goto;
    if (!next || next === 'end' || !active.tree.nodes[next]) { close(); return; }
    active.nodeKey = next;
    render();
  }

  function close() {
    if (!active) return;
    active = null;
    Game.log.push('dlg:close');
    if (window.UI && UI.hideDialogue) UI.hideDialogue();
  }

  function isOpen() { return !!active; }

  init();

  return {
    init: init, has: has, start: start, current: current,
    choose: choose, close: close, isOpen: isOpen
  };
})();
