SANDS OF APOCALYPSE — CUSTOM MODELS
===================================

Drop your own low-poly models here and they'll be used in the game.

FORMAT
  .glb  (binary glTF 2.0)  <- preferred, one self-contained file
  .obj + .mtl also works, but .glb is cleaner (keeps materials + textures)

BLENDER EXPORT SETTINGS
  File > Export > glTF 2.0 (.glb)
  - +Y up
  - Apply modifiers; apply transforms (scale/rotation) before exporting
  - Include: Materials + Textures
  - Keep it low-poly. For the PS1 look: small textures, no smooth shading.
  Scale is auto-normalized on import, but ~1 unit = 1 meter is ideal
  (weapons roughly 1-2 units long).

NAMING  (filename = the item id)
  bronze_dagger.glb       Copper Dagger   (bronze IS the copper-colored tier)
  bronze_scimitar.glb     Copper Scimitar
  bronze_greatsword.glb   Copper Greatsword
  iron_dagger.glb / silver_dagger.glb / gold_dagger.glb   (other metal tiers)
  ... same pattern for: helmet, platebody, platelegs, boots, shield
  bow.glb                 Desert Longbow

  Tiers are bronze / iron / silver / gold. "Copper" = the bronze tier.
  If you'd rather name a file copper_dagger.glb, tell me and I'll add an alias.

Once you drop a file in, tell me the item and I'll wire it up (it becomes both
the inventory icon and the in-hand model; missing items fall back to the
procedural low-poly meshes).
