# Sands of Apocalypse — Two Modes + Co-op "Ritual & the Buried Demon"

Design doc for the next big arc. Status: **DRAFT for review**. Keep it aligned with the
engine reality: Three.js r128, classic scripts + shared globals, Bun server relays a
shared world, client runs local sim, self-test must stay green.

## 0. Goals (from Lucas)
- **Two game modes**; the **first player to join chooses**:
  - **Versus** — the existing competitive race to place the Heart in the Obelisk (already built; restart-on-join, full wipe).
  - **Co-op** — shared camp, work together, richer & more dynamic, **non-linear progression with real choice**, buildable structures, pick your combat style (each with trade-offs, none strictly "wrong"), wide smithing/mining, ending in a **summoned demon boss fight**.
- Co-op is the star. Make it feel alive, dynamic, challenging, integrated but **not linear and not all-mandatory** — many paths help, few are required.
- The **main experience is the progression toward the summon moment**, then the boss fight.

## 1. Mode selection & shared architecture
- **Server owns `mode`** (`'pending' | 'versus' | 'coop'`) + a `coop` shared-state object.
- Flow: first socket to connect gets `{type:'chooseMode'}`; everyone else who joins before a choice sees a "waiting for host to pick a mode" overlay. Host picks → server sets `mode`, broadcasts `{type:'mode', mode}` + (for co-op) the current `coop` state. Late joiners get `mode` + `coop` snapshot in `welcome`/`worldInit`.
- **Versus**: unchanged (race, restart on join, full wipe). Restart-on-join is **gated to versus only**.
- **Co-op**: everyone spawns at the **same camp** (north). Joining mid-game does NOT restart — you drop in to help. Shared world progression lives on the server; individual skills/inventory stay per-player (you each grow, but the *world objectives* are shared).
- New client module `Mode` (js/mode.js) holds `Game.mode`, renders the chooser, and routes co-op net messages. `Coop` module (js/coop.js) holds the co-op objective/boss logic and shared-state application.

## 2. Co-op progression — "The Ritual of Five Sigils" (non-linear)
The camp sits before a dormant **Obelisk** ringed by **5 Sigil Braziers**. Lighting a brazier = completing that path's objective. **You only need 3 of 5 lit** to begin the ritual — so players choose which paths to pursue. Each path is a different playstyle; doing more than 3 gives optional buffs for the boss (not required).

The five sigils (each a self-contained mini-system):
1. **Sigil of the Forge (mining/smithing)** — smith a **Ritual Blade** (needs a high-tier bar chain: e.g. 1 Gold Bar + 1 Silver Bar at a Lv4 anvil). Rewards: unlocks the strongest melee weapon.
2. **Sigil of the Hunt (combat)** — clear both bandit camps' wave ladders (reuse existing camps) → collect **2 Bandit Essences**. Rewards: combat XP + essence used elsewhere.
3. **Sigil of Plenty (fishing/cooking/farming)** — cook a **Great Feast** (e.g. 3 cooked high-tier fish) that grants the party a **regen buff**; lighting the sigil requires offering the feast.
4. **Sigil of the Deep (construction/exploration)** — **build a Bridge** across a rift to a **Sunken Shrine** island holding a rare **Moon Ore** node; mine it and offer it.
5. **Sigil of Devotion (prayer)** — reach **max Prayer** (bury bones / pray at 3 wayshrines scattered on the map).

Shared progress: server tracks `sigils: {forge, hunt, plenty, deep, devotion}` booleans + a `ritualReady` flag when ≥3 lit. A co-op HUD panel shows the 5 sigils and who's working what (lightweight presence).

## 3. Constructables (build system)
A new **Build menu** (open at the camp's "Workbench" station or via a hotkey). Blueprints cost resources; building spawns a structure and unlocks access/utility. Server owns built state (shared), broadcasts `build` events. Blueprints:
- **Bridge** (logs + bars) → crosses the rift to the Sunken Shrine (Sigil of the Deep).
- **Ballista** (elderwood + iron/silver bars + rope) → a mannable siege weapon; **essential in the boss fight** to stagger the demon. Building it early lets you practice; it also helps clear bandit waves.
- **Watchtower** (logs + stone) → reveals the map / spawns a passive lookout (dynamic-feel flavor; optional).
- **Furnace/Anvil upgrades** already exist (keep) — construction extends, doesn't replace.
- **Wayshrine repair** (stone) → for Sigil of Devotion.
Not everything is needed: you might light 3 sigils and never build the Watchtower. But the **Ballista is strongly recommended** and the design telegraphs that ("the earth trembles… you'll want a siege weapon").

## 4. Combat styles (trade-offs, not right/wrong)
Two integrated styles today; boss fight rewards using **both** (great for co-op division of labor):
- **Melee** (Attack + Strength, scimitar/greatsword/dagger): highest burst, must be in danger range. Boss: only way to damage the **slammed hands** during stagger windows.
- **Ranged** (Ranged, bow): safe poke from distance, needs **Arrows** (craftable ammo → light economy). Boss: the only way to hit the demon's **high weak points** (eyes/heart) and to feed the Ballista targeting.
Weapon archetypes (wide smithing): **dagger** (fast, low max hit, high accuracy), **scimitar** (balanced), **greatsword** (slow, big max hit), **bow** (ranged), each smithable per metal tier. Stats differ so a player *chooses a feel*, not a strictly-best option. No hard class lock — swap anytime.

## 5. Wide mining & smithing
- **Mining**: add **gem nodes** (rare) dropping gems used for **socketing** gear (small stat boosts / element), plus a boss-gated **Moon Ore** (Sigil of the Deep). Keep copper→gold; gems are the "wide" axis (choice, not linear tier climb).
- **Smithing**: metal × archetype grid (helmet/body/legs/boots/shield + dagger/scimitar/greatsword/bow) already recolor-per-tier; add **gem sockets** and a couple of **set bonuses** (wear 3 of a metal → small party buff). This gives build variety without endless tiers.

## 6. The finale — summoning & the Buried Demon boss
- **Summon**: with ≥3 sigils lit, an **altar rite** at the Obelisk starts a channel. Completing it **cracks the earth** — instead of "winning," you **accidentally summon Mahrûk, the Buried Demon**, a huge figure rising from the plaza. Screen shake, roar, the sky darkens.
- **Boss fight (multi-phase, ~3–5 min):**
  - The demon is **huge** and mostly **invulnerable** except its **weak points**: two **hands** (ground-level, only vulnerable during slams) and a glowing **heart/eye** high on its chest (only hittable by **bow** or **ballista**).
  - **Slam cycle**: every ~8–12s it raises an arm and **slams a hand** onto the plaza (telegraphed shadow → dodge!). After a slam the hand rests, stunned, for ~3s → **melee window** on that hand.
  - **Stagger via Ballista**: firing the **Ballista** at the demon builds a **stagger meter**; a full bar forces an early, longer slam (both hands down) → big combined window. This is the construction-path payoff and the co-op set-piece (one loads/fires ballista, others melee).
  - **Bow weak point**: shooting the heart during a stagger deals the real damage; melee on hands lowers its guard (stagger). So melee + ranged + ballista **interlock**.
  - **Adds/dynamics**: periodically the demon spits **lesser imps** (reuse enemy AI) to pressure the team; environmental hazards (fissures) open.
  - **Optional buffs** from extra sigils: Feast regen, Devotion damage aura, Forge blade — make the fight easier but it's winnable with the minimum.
- **Win**: heart depleted → the demon collapses back into the earth; a proper **co-op VICTORY** overlay ("You banished Mahrûk and saved the sands"). Broadcast to all.

## 7. Dynamic / "alive" touches
- Day → dusk shift as sigils light (sky/lighting warms to ominous as you near the summon).
- Ambient events: sandstorm gusts (brief vision haze), a merchant caravan that restocks, roaming rats/birds already exist; add wandering **dust devils** and occasional bandit raids on the camp before the boss.
- Presence: teammate nameplates + "working on: Forge" tags; shared sigil HUD updates live.

## 8. Technical plan & net messages
- **Server** (`server.js`): `mode`, `coop = { sigils, builds, ritual, boss:{active, phase, hp, stagger, hands} }`. New relays: `chooseMode`, `mode`, `sigil`, `build`, `ritualStart`, `bossState`, `bossHit`, `bossDead`. Boss HP is server-authoritative; clients send `bossHit` (dmg + weakpoint), server validates the current window and applies.
- **Client**: `js/mode.js` (chooser + `Game.mode`), `js/coop.js` (sigils, build menu, boss controller + demon mesh + phases), extend `entities.js` (constructables, ballista, moon ore, gems, wayshrines, rift/bridge, demon), `skills.js` (arrows ammo, weapon archetypes, gems/sockets, set bonuses), `ui.js` (mode chooser, co-op HUD, build menu, boss health bar), `net.js` (route new messages).
- **Self-test**: add coverage per phase — mode routing, sigil completion, build system, arrows/archetypes, boss phase transitions & win. Keep it green each commit.

## 9. Phased build (commit + self-test + independent review each phase)
1. **Mode infra**: server `mode`, chooser UI, versus gating (restart-on-join only in versus), co-op spawns everyone at one camp. Commit.
2. **Co-op sigil framework**: 5 sigil braziers + shared server state + HUD; wire the 2 easiest sigils (Hunt via existing bandit camps, Devotion via Prayer). Commit.
3. **Build system**: Build menu + Ballista + Bridge + Sunken Shrine/Moon Ore (Sigil of the Deep). Commit.
4. **Wide smithing/mining + combat styles**: weapon archetypes, arrows ammo, gems/sockets, set bonuses; Forge & Plenty sigils. Commit.
5. **Demon boss**: summon rite, demon mesh, slam cycle, ballista stagger, bow/melee weak points, imps, win. Commit.
6. **Alive/polish + balance pass**: lighting shift, ambient events, tuning; tester feedback. Commit.

## 10. Verification strategy
- Headless self-test after every phase (target: stays green, grows).
- Screenshot key set-pieces (chooser, sigil HUD, ballista, demon) via the offline `?shot` hook.
- **Independent reviewers** (subagents) after the design and after each major phase: a *game-design* critic (fun/balance/non-linearity/co-op) and a *technical* critic (netcode/feasibility/scope/risk). Fold feedback back in.

---

# v2 — FINALIZED after independent review

Two independent reviewers (game-design + technical) critiqued the draft. Both approved the skeleton; the changes below are folded in. **This section supersedes the draft where they conflict.**

## Design changes (game-design review)
- **Sigils trigger camp raids.** Lighting a brazier spawns a bandit raid at the shared camp (reuse the wave AI, spawned at north camp). Escalating (raid 1 = weak, raid 3 = marauders). This is the #1 change — turns parallel grinding into shared, escalating pressure.
- **Boss needs BOTH melee and bow.** Hands = melee-only (during slam-stun); heart = bow/ballista-only. In 2p that's real role-split; solo you carry both and swap. **Solo-viable:** the heart also opens during the *natural* slam-stun, not only ballista staggers — the ballista is an **accelerant, not a key**.
- **Fix combat math (melee is currently strictly worse).** Invert: melee out-DPS bow at equal tier + cleave 2–3 adds but must be in range; bow lower per-hit but safe + only tool for high weak points + a hold-to-charge "aimed shot" that crits weak points.
- **Arrows are a COUNTER (`Game.arrows`), never inventory items** — the engine's inventory does not stack (28 fixed one-per-slot). Same for feast/gems: counters, not stacks. Fletch ~20 arrows from logs+a bar; running dry is a "go restock" beat, not a spreadsheet.
- **One stagger meter, not three.** Any weak-point hit (melee on stunned hands + ballista bolts) fills ONE meter → full = **heart exposed, big DPS window**. Learnable in one sentence. Phases at 100/66/33% (single slam → double slam + imps → faster + fissures + soft enrage).
- **Sigil rewards are boss-relevant & partly randomized.** Each sigil changes the fight (Forge→faster hand phase, Deep→bigger stagger bolts, Devotion→damage aura, Plenty→regen, Hunt→adds slower). Randomize which 2 sigils are "empowered" (double reward) per session so path choice varies. Picking 3 = choosing a **boss loadout**, not the 3 fastest.
- **De-grind the easy sigils:** Devotion = pray at 3 scattered **wayshrines** (exploration), NOT max Prayer; Plenty = cook 3 mid-tier fish, NOT Perch (fishing 12). Target ritual ~20–25 min, boss 3–5 min.
- **Never gate a required capability behind an optional path.** A plain iron/silver scimitar suffices for the hands; the Forge's Ritual Blade only *speeds* the hand phase.
- **Failure state + revive:** downed → teammate revives (short channel); solo death respawns but the boss **regens some HP** so you can't zerg it.
- **CUTS (scope):** gem sockets (keep **set bonuses only**: 3 of a metal → small party buff); Watchtower = decorative only (no vision/AI systems); weapon grid trimmed to **3 archetypes** (fast dagger / existing scimitar / heavy greatsword), recolored per tier; Moon Ore = one special reward feeding one thing; caravan/dust-devils = lowest priority. Keep sandstorm haze + day→dusk + **widening glowing plaza cracks tied to sigil count** (cheap visible progress).

## Technical changes (technical review)
- **Restart-on-join gated to versus only.** Server tracks `hostId` + `mode` (`pending|versus|coop`), write-once mode. `open()` never auto-restarts; registers, sends `welcome{mode,isHost}` + `worldInit{mode,coop}`, and prompts the host with `chooseMode` while pending. `chooseMode` (host-only, while pending) sets mode; **if versus**, one clean `doRestart()`. Versus join restarts; **coop join never restarts** (drop-in help + coop snapshot).
- **Session lifecycle:** on host `close` while pending → promote oldest remaining player to host + prompt. On `players.size===0` → reset `mode='pending'`, `hostId=null`, clear `coop`, cancel any restart timer. Consider a stale-tab timeout.
- **Boss authority = consistency, not anti-cheat.** Server owns boss HP/phase/windows/clock; client sends `bossHit{part,style,dmg}` mirroring `attackEnemy`; server clamps dmg + applies only if the named window is open (+~100ms grace). Server owns the slam/stagger *timeline* so both clients agree.
- **Don't let local sim hijack a server boss.** On transient disconnect (`goOffline`), pause the fight ("connection lost") rather than animating a frozen boss. Keep every `Coop.*` inbound handler a **pure state-application function** so the offline self-test can call it directly.
- **Adds/imps = `local`** (like bandits/rats) → sidestep the server-enemy index-alignment tax. Reserve server authority for the boss itself.
- **New gatherables get their own resource kind/message** (Moon Ore ≠ a `tree`/`rock` slot). Keep `server.js` `RES` mirror + self-test count asserts in lockstep. All shared placement on **seeded** RNG.
- **PvP gated off in coop** (picker can't target players / `playerAttackPlayer` no-op). Coop spawns everyone at the **north camp** (ignore slot).
- **Coop victory ≠ versus wipe.** Coop win shows overlay + soft-resets world objectives (keep per-player progression) or ends the session.
- **Snapshot piggybacks** `boss:{hp,stagger}` when active; discrete `bossState` only on phase/window transitions; `bossDead` on win.
- **Load order:** `mode.js` + `coop.js` after `ui.js`, before `main.js`; `net.js`→`Coop` routing uses `window.Coop &&` guards.

## MVP (vertical slice proving the co-op spine) + phase order
Reuse-max, content-min; everything cut layers on without changing the spine.
1. **Mode infra** — server `mode`/`hostId`, chooser UI, versus-gated restart, coop single-camp spawn, host-disconnect + empty-session reset, PvP-off-in-coop. (Test with 2 tabs.)
2. **Coop shared-state plumbing** — `Game.coop` object, `worldInit`/snapshot reconciliation, `sigil` message + HUD. Wire 2 reuse sigils: **Hunt** (both bandit camps `cleared`) + **Devotion** (max Prayer for MVP; wayshrines later). Configurable threshold (2 for MVP, 3 final). Add sigil→camp raid.
3. **Thin server boss (pulled forward)** — HP + one slam mechanic + melee hand window + bow heart + `bossHit` validation + `bossDead` → coop victory. Retires the integration risk early.
4. **Build system + Ballista** + Bridge/Sunken-Shrine/Moon-Ore + **Deep** sigil.
5. **Wide smithing/mining + combat styles** — 3 weapon archetypes, arrows counter, set bonuses, combat-math fix; **Forge** + **Plenty** sigils; de-grind Devotion→wayshrines.
6. **Boss depth + polish** — stagger meter, `local` imps, phases, optional-buff integration, day→dusk, cracks, ambient events, balance, revive.

## Message schema (thin server wrappers over pure reducers)
```
C→S {type:'chooseMode', mode}                    // host only, write-once while pending
S→C {type:'mode', mode, coop};  welcome+={mode,isHost};  worldInit+={mode,coop}
C→S {type:'sigil', which}      S→C {type:'sigil', which, lit, ritualReady}
C→S {type:'build', id}         S→C {type:'build', id, by}
C→S {type:'ritualStart'}       S→C {type:'bossState', active,phase,hp,maxHp,stagger,hands,t}
C→S {type:'bossHit', part, style, dmg}   S→C {type:'bossHit', part, dmg}   S→C {type:'bossDead'}
snapshot += {boss:{hp,stagger}} when active
```

## Self-test strategy (offline single client)
- Default `Game.mode='coop'` offline so co-op paths are reachable and the chooser never blocks the headless run.
- Feed inbound messages the server would send (`Mode.setMode`, `Coop.onSigil`, `Coop.onBossState`, `bossDead`) and assert HUD/mesh/HP-bar/victory react.
- Mock outbound (`Net.sendSigil`/`sendBossHit`) and assert the client emits on the right trigger; toggle `Game.online=true` for a block to exercise the online routing branch.
- Highest-value test: feed a **mid-game snapshot** (2 sigils lit, boss at 50%) and assert the client reconstructs it (late-join reconciliation is where bugs live).
- Frequent commits so we never lose a working baseline.
