SANDS OF APOCALYPSE — CUSTOM STORY-MODE MAP
============================================

Design your world here and pick "STORY MODE" on the game's start screen to play it.

SCALE
  Import grid_reference_cube.obj — it's exactly ONE grid tile
  (2 x 2 units on the floor, 2 tall). The whole game runs on a 2-unit grid,
  so lay objects out on a 2-unit spacing and keep each one centred in its tile.

HOW IT WORKS
  Put a marker (a dummy/point helper, or any small placeholder) where you want
  each thing, and NAME it by type. Export the whole layout as ONE file:
      world map/level.glb
  On Story Mode the game reads that file, and wherever it finds a known name it
  spawns the real, fully-playable object at that spot (snapped to the grid).

NAMES the game understands  (case-insensitive; a trailing number is ignored,
so copper_ore, copper_ore_001, "Copper Ore 12" all work)
  Ore (mineable):    copper_ore  iron_ore  silver_ore  gold_ore
  Trees (choppable): tree  palm  dead_tree  ebony  elder
  Plants (harvest):  date_bush  prickly_pear  fig_tree
  Special:           meteorite   crystal
  Stations:          furnace  anvil  campfire  merchant
  Structure:         camp_p1  camp_p2  bandit_camp_east  bandit_camp_west  obelisk
  Player start:      spawn
  Anything else      -> ignored for now (or kept as static decor later)

  (Ask me to add more names any time — each maps to an existing game object.)

NOTES
  * glTF is Y-up, same as the game. 1 unit in your 3D app = 1 game unit.
  * Only the NAME + POSITION (+ rotation) of each marker matters; the placeholder
    mesh itself isn't shown — the game builds its own object there.
  * Drop even a tiny test level.glb (a few named markers) and I'll finish wiring
    the loader to your exact names and confirm it end-to-end.
