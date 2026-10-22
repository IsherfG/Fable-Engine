# Campaign plan — from the starter box to a full campaign

Status of what exists today, then the ordered work to make this a full-fledged
campaign platform. Written for **two players, one AI Dungeon Master**.

## What works now

- **The DM runs the module**: it knows the three booklets, the recommended order,
  the Caves A–K, the Keep areas, the cast, the factions, and the Chaos Bell thread.
- **It keeps records**: `move_party`, `record_quest`, `note`, and `rest` are real
  tools. Location, quest state, discoveries and the day all persist to disk.
- **The long-rest rule is enforced in code.** A long rest outside the Keep is
  refused by the tool, so the party cannot heal for free in the Caves.
- **Dice are rolled in code** and hit points are only changed by tool calls.
- **Two full level-1 sheets** (Kael, fighter; Bram, cleric) with equipment, saves,
  skills, and spell slots.
- **Reference data**: 19 locations, 9 NPCs, 7 quests, and weapon/armour/gear/pack
  lists with prices.

### Known gap that matters most

**There are no monster statblocks yet.** The DM has area names and faction agendas
but no numbers for a goblin, an owlbear, or Ivlis. It will improvise, which is
exactly what the dice rule exists to prevent. This is priority 1 below.

---

## Priority 1 — make combat honest

### 1.1 Seed a bestiary from the SRD (legal, accurate)

The **D&D SRD 5.2 is CC-BY-4.0**, so monster statblocks can be included and
redistributed with attribution. Add `campaign/bestiary.json` with the monsters this
box uses:

`kobold, goblin, hobgoblin, bugbear, gnoll, ogre, minotaur, owlbear, nothic,
mephit (various), animated flying sword, carrion crawler, giant spider, giant
centipede, stirge, mimic, skeleton, zombie, cultist, cult fanatic, bandit,
bandit captain` — plus **Pral, Ivlis, Winvarle, Oggdug, Zurf, Haldryck** as named
NPCs with their own numbers.

Schema per entry: `{ id, name, cr, ac, hp, speed, abilities, saves, skills,
senses, traits[], actions[], reactions[], legendary[] }`.

**Caveat to record in the file:** the starter set's own monster cards may differ
from SRD numbers (scaled for levels 1–3). Where they conflict, the **cards win** —
add an `override` field and correct as you play.

### 1.2 A real combat tool

Add `start_combat(monsters[])`, `attack(attacker, target, weapon)`, `damage(target,
amount)`, `end_combat()`. Store initiative order and current turn in
`campaign/combat.json`. Combat is where an AI DM most easily cheats by accident.

### 1.3 Two-player scaling

Encounters are written for four. Add a rule the DM can apply mechanically:
`scaleForParty(monsters, partySize)` — drop the number of enemies, not their damage.
Record the original and scaled counts in the statblock entry so the table can see it.

---

## Priority 2 — characters that grow

### 2.1 Level up to 3 (the box's ceiling)

`levelUp(pc)` should: add the class hit die (average + CON), raise proficiency at
5 (not needed here), grant subclass at 3, add features, and add spell slots.
Cleric and Fighter both pick a subclass at 3 in the 2024 rules.

### 2.2 Character creation

A guided path rather than a form:

1. **Class** (Fighter / Cleric / Rogue / Wizard — the four the box supports).
2. **Species** and **background** from the modular tiles.
3. **Ability scores** — standard array or point buy, assigned by the app.
4. **Skills** from class + background.
5. **Equipment** from the class's starting kit, or roll for gold.
6. Write the sheet into `campaign/party.json`.

Ship it as `npm run new-character`, and later as a browser wizard.

### 2.3 Inventory and shopping

`equipment.json` already has 24 weapons, 13 armours, 33 gear items and 7 packs
with prices. Add:

- `buy(pc, item)` / `sell(pc, item)` against a Keep merchant's stock.
- Encumbrance (optional rule) — total weight vs STR × 15.
- Ammunition and consumable tracking (arrows, potions, torches).
- Treasure parcels recorded per cave, so loot is not double-counted.

---

## Priority 3 — the table experience

### 3.1 Character sheet panel

The sidebar currently shows name/HP/AC. Extend it to a tabbed sheet: abilities,
saves, skills, features, spells with slot pips, and inventory. A player should never
need to open JSON mid-session.

### 3.2 Quest log and map

- Quest panel reading `quests.json` with status chips.
- A location list showing where they have been, which cave is cleared, and which
  are still unvisited — the players' version of the poster map.

### 3.3 Barge-in

Known limitation from the voice work: the talk button is disabled for the whole
turn because synthesis is serialised. Split "generating" from "speaking" so a
player can interrupt the DM mid-sentence.

### 3.4 Session continuity

The transcript is in memory. Persist `session.messages` to
`campaign/sessions/<date>.jsonl` and offer "resume last session".

---

## Priority 4 — beyond the box (levels 3+)

The box ends at 3. To keep going as a full campaign:

1. **Finish the Chaos Bell** — the box's own ending. Then choose an exit:
   the cult's backers, the road beyond the Borderlands, or the Keep as a home base.
2. **Reuse the sandbox**: the Keep + factions + wilderness is a campaign engine. New
   threats can reuse the same map, which keeps prep cost low.
3. **Pull from the SRD** for monsters and magic items (CC-BY-4.0), so there is no
   content desert after level 3.
4. **Level 3–10 arc**: pick a villain with a *plan* (the cult was mid-plan when the
   Bell broke), give them three moves the party can discover and disrupt.
5. **Downtime**: the Keep gives a natural home base for crafting, carousing,
   factions, and hirelings — important with only two players.

---

## Suggested order of work

| # | Task | Why now |
|---|---|---|
| 1 | Bestiary from SRD | Combat is unplayable without numbers |
| 2 | Combat tool + initiative | Makes combat honest and trackable |
| 3 | Level-up to 3 | The box assumes it; caves are the XP track |
| 4 | Character sheet panel | You need to read your own sheet mid-fight |
| 5 | Shopping + inventory | The Keep is a shopping town |
| 6 | Barge-in | QoL, already diagnosed |
| 7 | Session persistence | Do not lose a session to a restart |
| 8 | Character creation wizard | Only needed for the *next* campaign |
| 9 | Level 3+ arc | After the Bell |

## Data files (current)

```
campaign/party.json      two character sheets        (app writes)
campaign/campaign.json   day, location, factions, flags, discoveries (app writes)
campaign/locations.json  19 locations, status per location (app writes status)
campaign/npcs.json       9 NPCs, met flag, disposition (app writes met)
campaign/quests.json     7 quests with status        (app writes status)
campaign/equipment.json  weapons, armour, gear, packs (reference)
campaign/RESEARCH.md     verified module facts + sources
campaign/bestiary.json   NOT YET — priority 1
```
