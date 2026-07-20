# Writing NPC dialogue

**This is where you (Lucas) write what NPCs say.** Edit **`dialogue/dialogues.json`**
in this folder. Save the file, refresh the game — no code changes, no server
restart needed. If the file is ever broken/missing, the game falls back to the
built-in test conversation so nothing crashes.

## The shape of the file

The file is one big object. Each **key** is a *dialogue id* (an NPC's script).
Inside it:

- `name` — the NPC's name shown above the text.
- `start` — the key of the first line to show.
- `nodes` — every line the NPC can say, each with the answers you can click.

Each **node** has:

- `npc` — what the NPC says.
- `options` — the list of answers you can click. Each answer has:
  - `text` — the words on the button you click.
  - `goto` — which node to jump to next when you pick it.
    Use `"end"` (or leave it off) to close the conversation.

## Example (the current test wanderer)

```json
{
  "trapped_wanderer": {
    "name": "Trapped Wanderer",
    "start": "intro",
    "nodes": {
      "intro": {
        "npc": "I don't know how to get out of here. I've been trapped here.",
        "options": [
          { "text": "Don't worry — I'll find us a way out of here.", "goto": "hopeful" },
          { "text": "Sounds like your problem. I'm not staying.",     "goto": "bitter"  }
        ]
      },
      "hopeful": {
        "npc": "You'd truly help me? Bless you, stranger.",
        "options": [ { "text": "Count on it.", "goto": "end" } ]
      },
      "bitter": {
        "npc": "...Cold as the night sands.",
        "options": [ { "text": "Whatever. (Leave)", "goto": "end" } ]
      }
    }
  }
}
```

Reading it: the wanderer opens with the `intro` line. Click the **first** answer
and you branch to `hopeful`; click the **second** and you branch to `bitter`.
Each branch has its own reply, then ends. That's the whole "two different
dialogues depending on what you said" test — just add more `options` and more
`nodes` to grow it.

## Tips

- Answers can loop back to earlier nodes (`"goto": "intro"`), branch as deep as
  you like, and a node can have 1, 2, 3+ answers.
- Keep the JSON valid: every `"..."` needs its quotes, items in a list are
  separated by commas, and there's **no trailing comma** after the last item.
  If a save doesn't show up in-game, a stray comma or missing quote is the usual
  cause — paste it into https://jsonlint.com to check.
- Watch apostrophes: inside a `"..."` string a normal apostrophe like `don't` is
  fine, but a straight double-quote must be escaped as `\"`.

## Which NPC uses which dialogue

- The test NPC that auto-spawns next to your Story-mode start uses the id
  **`trapped_wanderer`**.
- When you place your own NPCs in a level (a node named with `_NPC`, e.g.
  `OldHermit_NPC`), the game turns the name into a dialogue id automatically:
  `OldHermit_NPC` → looks up **`old_hermit`**. So add an `old_hermit` entry here
  and that NPC will use it. If there's no matching entry, the NPC falls back to
  the wanderer's lines.
