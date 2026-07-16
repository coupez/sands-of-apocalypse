// ============================================================
// pixelicons.js — hand-drawn 16x16 pixel-art sprites for UI glyphs
// (skill icons + tab-bar buttons). Drawn to a canvas and returned as
// nearest-neighbour PNG data-URLs; the CSS upscales them crisply.
// Items keep their 3D low-poly renders (icons.js); the UI gets pixel art.
// ============================================================

var PixelIcons = (function () {
  var PAL = {
    k: '#14100c', w: '#f6efdd', s: '#c6ccd6', S: '#868f9e',
    b: '#8a5a2c', B: '#543318', g: '#f4ca54', G: '#bf922c',
    r: '#d6473a', e: '#57a848', E: '#37702f', t: '#5fe0d0',
    o: '#e2892f', h: '#d8a878', p: '#9a5adf', n: '#3f7ec2',
    c: '#e6d3a0', f: '#ff7a2e', d: '#5a5048'
  };
  var SZ = 16, cache = {};

  var SPR = {
    attack: [   // sword
      '.......kk.......', '......ksSk......', '......ksSk......', '......ksSk......',
      '......ksSk......', '......ksSk......', '......ksSk......', '......ksSk......',
      '....kkgGGgkk....', '......kbBk......', '......kbBk......', '......kbBk......',
      '......kGGk......', '.......kk.......'],
    strength: [ // dumbbell
      '................', '................', '................', '..kk......kk....',
      '.kSSk....kSSk...', '.kSSk....kSSk...', '.kSSkkkkkkSSk...', '.kSSdddddSSk...',
      '.kSSkkkkkkSSk...', '.kSSk....kSSk...', '.kSSk....kSSk...', '..kk......kk....'],
    ranged: [   // bow + arrow
      '....kk..........', '...kBk..........', '..kBk...........', '..kB............',
      '.kB.............', '.kB.....kk......', '.kB....ksk......', '.kB.sssssssk....',
      '.kB....ksk......', '.kB.....kk......', '..kB............', '..kBk...........',
      '...kBk..........', '....kk..........'],
    prayer: [   // ankh (Egyptian)
      '.....kkk........', '....kgGgk.......', '....kg.gk.......', '....kgGgk.......',
      '..kkkgGgkkk.....', '..kgGGGGGgk.....', '..kkkgGgkkk.....', '.....kgGk.......',
      '.....kgGk.......', '.....kgGk.......', '.....kgGk.......', '.....kkk........'],
    woodcutting: [ // hatchet/axe
      '....kkkkk.......', '...ksssssk......', '..kssssssk......', '..ksssssk.......',
      '...kkkbBk.......', '....kbBk........', '....kbBk........', '....kbBk........',
      '....kbBk........', '....kbBk........', '....kbBk........', '....kbBk........',
      '....kkkk........'],
    mining: [   // pickaxe
      '.k..........k..', 'kSk........kSk.', '.kSSSSSSSSSSSk.', '..kSSSSSSSSSk..',
      '......kbBk......', '......kbBk......', '......kbBk......', '......kbBk......',
      '......kbBk......', '......kbBk......', '......kbBk......', '......kbBk......',
      '......kkkk......'],
    fishing: [  // harvest sprig (leaves)
      '................', '........ee......', '.......eEEe.....', '......eEEe......',
      '.....eEEe.ee....', '....eEEe.eEEe...', '...eEEe.eEEe....', '....k..eEEe.....',
      '....k.eEe.......', '....k...........', '...kkk..........'],
    cooking: [  // pot over flame
      '................', '..kkkkkkkkkk....', '.kdddddddddk....', '.kdddddddddk....',
      '.kdddddddddk....', '..kkkkkkkkkk....', '...f..f..f......', '..fff.fff.fff..',
      '...o...o...o...'],
    smithing: [ // hammer
      '................', '...kkkkkkkk.....', '..kSSSSSSSSk....', '..kSSSSSSSSk....',
      '...kkkkkkkk.....', '......kbBk......', '......kbBk......', '......kbBk......',
      '......kbBk......', '......kbBk......', '......kbBk......', '......kbBk......',
      '......kkkk......'],
    merchant: [ // gold coin
      '................', '....kkkkkk......', '...kgGGGGgk.....', '..kgGwwGGGk.....',
      '..kgGGGGGGk.....', '..kgGwGGGGk.....', '..kgGGGGGGk.....', '...kgGGGGgk.....',
      '....kkkkkk......'],
    bag: [      // backpack
      '.....kkkk.......', '.....k..k.......', '...kkkkkkkkk....', '..kBBBBBBBBBk...',
      '..kbbbbbbbbbk...', '.kbbbbbbbbbbbk..', '.kbbbkkkkbbbbk..', '.kbbbkggkbbbbk..',
      '.kbbbkkkkbbbbk..', '.kbbbbbbbbbbbk..', '.kbbbbbbbbbbbk..', '.kbbbbbbbbbbbk..',
      '..kkkkkkkkkkk...'],
    skills: [   // scroll / stat sheet
      '..kkkkkkkkkkkk..', '.kccccccccccck.', '.kc.kkkkkkk.ck.', '.kcccccccccck.',
      '.kc.kkkkkkk.ck.', '.kcccccccccck.', '.kc.kkkkk...ck.', '.kcccccccccck.',
      '.kc.kkkkkkk.ck.', '.kcccccccccck.', '..kkkkkkkkkkkk..'],
    equip: [    // shield
      '..kkkkkkkkkk....', '.kSSSSSSSSSSk...', '.kSSSwwSSSSSk...', '.kSSSSSSSSSSk...',
      '.kSSSSrrSSSSk...', '.kSSSSrrSSSSk...', '..kSSSSSSSSk....', '...kSSSSSSk.....',
      '....kSSSSk......', '.....kSSk.......', '......kk........'],
    music: [    // eighth note
      '..........kk....', '.........kggk...', '..........kgk...', '..........kgk...',
      '..........kgk...', '..........kgk...', '..........kgk...', '......kkk.kgk...',
      '.....knnnkgk...', '.....knnnnk.....', '.....knnnnk.....', '......kkk.......'],
    musicoff: [ // muted note (gray + red slash)
      '.............r..', '..........kk.r..', '.........kddkr..', '..........kdk...',
      '.........r.kdk..', '........r..kdk..', '.......r...kdk..', '......rkkr.kdk..',
      '.....rknddkrk...', '....r.kddddkr...', '...r..kddddk.r..', '..r...kkkk...r..'],
    hand: [     // pointing/grabbing hand (cursors: use / pick up)
      '................', '....kk..........', '...khhk.........', '...khhk.kk......',
      '...khhkkhhk.....', '...khhhhhhk.....', '..kkhhhhhhk.....', '.khhhhhhhhk.....',
      '.khhhhhhhhk.....', '.khhhhhhhk......', '..khhhhhhk......', '...kkkkkk.......'],
    gem: [      // faceted gem (deep sigil)
      '......kk........', '.....knnk.......', '....knttnk......', '...knttttnk.....',
      '..knttttttnk....', '.kntttttttntk...', '.knttttttttnk...', '..knttttttnk....',
      '...knttttnk.....', '....knwtnk......', '.....knnk.......', '......kk........']
  };

  function draw(grid) {
    var cv = document.createElement('canvas'); cv.width = SZ; cv.height = SZ;
    var ctx = cv.getContext('2d');
    for (var y = 0; y < grid.length; y++) {
      var row = grid[y];
      for (var x = 0; x < row.length; x++) {
        var ch = row.charAt(x);
        if (ch === '.' || ch === ' ') continue;
        ctx.fillStyle = PAL[ch] || '#ff00ff';
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return cv.toDataURL('image/png');
  }

  function get(name) {
    if (!SPR[name] || !SPR[name].length) return null;
    if (cache[name] === undefined) {
      try { cache[name] = draw(SPR[name]); } catch (e) { cache[name] = null; }
    }
    return cache[name];
  }
  // an upscaled data-URL (for CSS cursors, which render small at native 16px)
  var scache = {};
  function getScaled(name, scale) {
    scale = scale || 2;
    if (!SPR[name] || !SPR[name].length) return null;
    var key = name + '@' + scale;
    if (scache[key] === undefined) {
      try {
        var grid = SPR[name], S2 = SZ * scale;
        var cv = document.createElement('canvas'); cv.width = S2; cv.height = S2;
        var ctx = cv.getContext('2d');
        for (var y = 0; y < grid.length; y++) for (var x = 0; x < grid[y].length; x++) {
          var ch = grid[y].charAt(x);
          if (ch === '.' || ch === ' ') continue;
          ctx.fillStyle = PAL[ch] || '#ff00ff'; ctx.fillRect(x * scale, y * scale, scale, scale);
        }
        scache[key] = cv.toDataURL('image/png');
      } catch (e) { scache[key] = null; }
    }
    return scache[key];
  }
  function has(name) { return !!(SPR[name] && SPR[name].length); }

  return { get: get, getScaled: getScaled, has: has };
})();
