# Custom inventory-item icons — drop-in folder

Drop a **PNG** in this `itemicons/` folder named after an item, and it replaces
that item's icon **everywhere** in the game (inventory, equipment paperdoll,
smith menu, sell menu). No code editing — exactly like `skillicons/` and
`models/`.

- The server must be restarted after adding the very first file to a brand-new
  folder (`bun server.js`). Adding more PNGs afterward just needs a browser
  refresh.
- Priority in-game: **your PNG here → built-in 3D render / `.glb` model → emoji**.

## How to name the file

Name it after the item's **id** *or* its **display name**. Matching ignores
case, spaces, underscores and the file extension. So any of these work for the
raw sardine:

```
raw_fish.png     Raw Sardine.png     rawfish.png     RAW_FISH.PNG
```

## Icon size (what to draw)

- **Recommended: 64 × 64 px PNG, transparent background.**
- It's displayed small (~44–48 px in an inventory slot) and rendered with
  `image-rendering: pixelated` (crisp, no blur) to match the PS1 look.
- The built-in procedural icons render at **48 × 48 px**, so 48 or 64 both look
  right. Square is best (non-square is letterboxed to fit).
- You can use any of `.png .gif .jpg .jpeg .webp` — PNG with transparency is best.

---

## Full item list

### Plain items (`Skills.ITEMS`)

| id | Display name | current icon |
|----|--------------|--------------|
| `log` | Dead Log | 🪵 |
| `palmwood` | Palm Wood | 🪵 |
| `blog` | Ebony Log | 🟫 |
| `elderwood` | Elderwood | 🟤 |
| `stick` | Stick | 🥢 |
| `ore` | Copper Ore | ◆ (orange) |
| `iron` | Iron Ore | ◆ (grey) |
| `silver` | Silver Ore | ◆ (white) |
| `pore` | Gold Ore | ◆ (gold) |
| `shrimp` | Dates | 🌰 |
| `lobster` | Prickly Pear | 🌵 |
| `whale` | Figs | 🫐 |
| `cshrimp` | Honeyed Dates | 🍯 |
| `clobster` | Cactus Jam | 🍮 |
| `cwhale` | Dried Figs | 🍇 |
| `bronzebar` | Copper Bar | ▬ (orange) |
| `ironbar` | Iron Bar | ▬ (grey) |
| `silverbar` | Silver Bar | ▬ (white) |
| `goldbar` | Gold Bar | ▬ (gold) |
| `tinakal` | Tin Akal | ◆ (teal) |
| `tinakalbar` | Tin Akal Bar | ▬ (teal) |
| `essence` | Bandit Essence | 🩸 |
| `bones` | Pile of Bones | 🦴 |
| `messence` | Essence of the Merchant | 💰 |
| `rockessence` | Essence of the Rock | 🔮 |
| `electricpaper` | Electric Paper | ⚡ |
| `orb` | Heart of the Obelisk | ❤️ |
| `pickaxe_bronze` | Copper Pickaxe | ⛏️ |
| `pickaxe_iron` | Iron Pickaxe | ⛏️ |
| `pickaxe_silver` | Silver Pickaxe | ⛏️ |
| `pickaxe_gold` | Gold Pickaxe | ⛏️ |
| `axe_bronze` | Copper Axe | 🪓 |
| `axe_iron` | Iron Axe | 🪓 |
| `axe_silver` | Silver Axe | 🪓 |
| `axe_gold` | Gold Axe | 🪓 |
| `reed` | Reed | 🌾 |
| `rope` | Rope | 🪢 |
| `rock` | Rock | 🪨 |
| `flint` | Flint | 🪨 (red) |
| `sharp_rock` | Sharp Rock | 🔪 |
| `reed_fibers` | Reed Fibers | 🧵 |
| `smooth_stick` | Smooth Stick | 🎋 |
| `handle_with_string` | Handle with String | 🪄 |
| `primitive_axe` | Primitive Axe | 🪓 |
| `sturdy_handle` | Sturdy Handle | 🦯 |
| `sturdy_handle_with_string` | Sturdy Handle with String | 🎣 |
| `primitive_pickaxe` | Primitive Pickaxe | ⛏️ |
| `bundle_of_sticks` | Bundle of Sticks | 🎋 |
| `fire_starter` | Fire Starter | 🔥 |
| `primitive_fishing_net` | Primitive Fishing Net | 🕸️ |
| `raw_fish` | Raw Sardine | 🐟 |
| `cooked_fish` | Cooked Sardine | 🍢 |

### Wearable gear (`Skills.GEAR`)

Hand-made pieces:

| id | Display name |
|----|--------------|
| `sword` | Copper Scimitar |
| `gun` | Hunting Bow |
| `bow` | Desert Longbow |
| `fanny` | Genie's Lamp |
| `shield` | Round Shield |
| `machete` | Jambiya Dagger |
| `gasmask` | Desert Turban |
| `hazhood` | Nomad Hood |
| `hazvest` | Padded Tunic |
| `plate` | Copper Cuirass |
| `greaves` | Leather Greaves |

**Smithed metal gear** is generated as `<metal>_<piece>`:

- metals: `bronze` (shown as **Copper**), `iron`, `silver`, `gold`, `tinakal`
- pieces: `helmet`, `platebody`, `platelegs`, `boots`, `shield`, `dagger`,
  `scimitar`, `greatsword`

So the ids are e.g. `bronze_helmet`, `iron_scimitar`, `silver_platebody`,
`gold_greatsword`, `tinakal_dagger`, … (name them by id or by display name like
`Iron Scimitar.png`). These weapons already use your `.glb` models from
`models/` when present — a PNG here overrides the icon (not the in-hand 3D model).
