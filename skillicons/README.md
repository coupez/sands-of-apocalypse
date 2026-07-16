# Custom skill icons

Drop a **PNG** (or gif/jpg/webp) here named after a skill and it will automatically
replace that skill's icon in the Skills panel. No code changes needed — just drop the
file and reload the browser (the game reloads client files automatically).

Pixel art is ideal: icons render with `image-rendering: pixelated` and are shown ~24px,
so a **16×16, 24×24, or 32×32** sprite looks crisp. Square images work best.

## Naming

Name the file after the skill — either its **display name** or its **internal key**.
Case, spaces, underscores and hyphens are ignored, so `Hit Points.png`, `hit_points.png`
and `hitpoints.png` all map to the same skill.

| Skill (as shown in game) | Accepted file names (any of) |
|--------------------------|------------------------------|
| Attack        | `attack.png` |
| Strength      | `strength.png` |
| Defense       | `defense.png`, `defence.png` |
| Range         | `range.png`, `ranged.png` |
| Hit Points    | `hit_points.png`, `hitpoints.png`, `hp.png` |
| Spirit        | `spirit.png`, `soul.png` |
| Faith         | `faith.png`, `prayer.png` |
| Mining        | `mining.png` |
| Lumbering     | `lumbering.png`, `woodcutting.png` |
| Harvesting    | `harvesting.png`, `fishing.png` |
| Hunting       | `hunting.png` |
| Crafting      | `crafting.png`, `smithing.png` |
| Casting       | `casting.png`, `magic.png` |
| Medical       | `medical.png`, `cooking.png` |

Anything that doesn't match a skill name is ignored. Skills without a custom icon fall
back to the built-in pixel icon, then an emoji.
