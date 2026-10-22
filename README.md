# Fable Engine

A voice-driven AI Dungeon Master that runs on your own machine.

You talk. It listens, rolls the dice honestly, narrates, and speaks back with a
different voice for every character. It is built to run **Dungeons & Dragons:
Heroes of the Borderlands** for two players, and it keeps the campaign on disk
between sessions.

No accounts. No cloud services beyond the language model you already pay for.
Nothing leaves the machine except the chat completion.

```
you: "I check the miller's door for traps."
      → whisper transcribes it
      → the DM calls roll_dice("1d20+4")
      → the app rolls 7, for real
      → the DM narrates a failure and speaks it in a mature female voice
```

---

## What it does

| | |
|---|---|
| **Talks and listens** | Hold to talk. Local speech-to-text, local neural text-to-speech. |
| **Rolls real dice** | Every roll happens in code with cryptographic randomness. The model never invents a number. |
| **Runs the module** | Knows Heroes of the Borderlands: three booklets, the Keep, the Caves A–K, the cast, the factions, the Chaos Bell. |
| **Keeps the books** | Location, day, quests, faction standing, discoveries and hit points persist to disk after every turn. |
| **Remembers the rules** | Long rests only work inside the Keep — enforced in code, not by hoping. |
| **Voices the cast** | Deterministic voices per NPC; the narrator's voice is never reused by a character. |
| **Sessions** | One sitting per session. Ending one archives the transcript with a recap; the campaign carries on. |

---

## Requirements

- **macOS** with Node 20+ (the current build; a Windows/Linux desktop port is planned)
- **A Command Code account** with Provider API access — this is the language model
- `ffmpeg` (`brew install ffmpeg`)

Optional, for speech:

- **Speech-to-text:** `whisper-cli` plus a `ggml` model (see [Setup](docs/SETUP.md))
- **Speech-to-speech:** either macOS `say` (zero install) or Kokoro-js (neural, ~500 MB)

---

## Quickstart

```sh
git clone <this repo> fable-engine
cd fable-engine
npm install
npm start
```

Open <http://localhost:8787>. The first run walks you through character
creation, choosing an adventure, and how your characters met.

To play from a phone on the same network, use `npm run https` — the microphone
requires a secure context, and a LAN IP over plain HTTP is not one.

Full setup, including the speech models, is in **[docs/SETUP.md](docs/SETUP.md)**.

---

## The flow

**First run**

```
1  Who is at the table?   class · species · background · name · player
2  Which adventure?       The Trail / The Keep / The Caves of Chaos
3  How did you meet?      hired together / old friends / met on the road / last survivors
4  Ready to begin         review, then the DM opens the scene
```

**Every launch** — you land straight in play, and the transcript is rebuilt from
disk, so a reload or a restart continues the conversation.

**Sessions** — `☰ sessions` shows the live session and every past one with a
recap. `End this session` archives the transcript and starts a fresh one; party,
gear, HP, location, quests and the day all carry over.

---

## How it works

```
browser (mic)  → webm/opus → ffmpeg → whisper.cpp → transcript
                                                       │
                                          Command Code Provider API
                                              (SSE + tool calls)
                                                       │
                                            dice rolled in-process
                                                       │
browser (audio queue) ← mp3 ← ffmpeg ← Kokoro / say ← sentence split
```

The backend is a small Node HTTP server. The frontend is plain HTML/CSS/JS — no
framework, no build step. The DM is given a tool set (`roll_dice`,
`update_character`, `move_party`, `record_quest`, `note`, `rest`, `lookup_rule`)
and the application executes those tools, so game state is never a matter of the
model's memory.

Details: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**

---

## Configuration

Everything lives in `config.json` — model, voice, speech-to-text bias terms.

```jsonc
{
  "llm":  { "model": "deepseek/deepseek-v4.1-flash", "reasoningEffort": "low" },
  "tts":  { "provider": "kokoro", "kokoro": { "defaultVoice": "bf_isabella" } },
  "stt":  { "threads": 8, "bias": "…campaign names…" }
}
```

Three settings are worth knowing:

- **`reasoningEffort` must not be `"off"`.** With it off, the model stops calling
  the bookkeeping tools and the world drifts out of sync with the fiction. `"low"`
  is the right default; `"medium"` for a heavy fight.
- **`stt.bias`** biases speech recognition toward your campaign's proper nouns.
  Edit it with your character, spell and place names — it matters more than any
  other speech setting.
- **`maxTokens` ≥ 800** when reasoning is on, or thinking tokens eat the reply.

---

## Campaign data

The DM reads these files and writes the state back as you play:

| File | Contents |
|---|---|
| `campaign/party.json` | Character sheets — abilities, saves, skills, AC, HP, gear, gold, spell slots |
| `campaign/campaign.json` | Day, time, weather, location, faction standing, flags, discoveries |
| `campaign/locations.json` | 19 locations across the Wilderness, Keep and Caves A–K |
| `campaign/npcs.json` | The cast — role, wants, knows, secrets, whether you have met them |
| `campaign/quests.json` | Quest state: hidden → offered → active → complete/failed |
| `campaign/equipment.json` | Weapons, armour, gear and packs with prices |
| `campaign/RESEARCH.md` | Every verified fact about the box, with sources |

**The files are the source of truth, not the transcript.** Restarting the app does
not reset the campaign. Finished sessions are archived to `campaign/sessions/`
(git-ignored — that is your play data, not the project's).

---

## Two players, one DM

The box targets 2–4 characters, so a duo is in range. The app tells the DM to
**reduce the number of enemies rather than their damage**, and the module's social
half — the Keep, factions, allies like Haldryck and Oggdug — becomes far more
valuable than it would be with four.

---

## Project status

Working end to end today: onboarding, character sheets, the campaign module,
dice, all seven DM tools, sessions with history, whisper speech-to-text, Kokoro
and `say` voices.

Known gaps, in order:

1. **No monster statblocks yet.** Combat numbers are the one thing the DM still
   improvises. Seeding `campaign/bestiary.json` from the CC-BY-4.0 SRD 5.2 is the
   next task.
2. **No automated level-up.** Clear a cave, then edit the sheet.
3. **No barge-in.** The talk button is disabled for the whole turn, including
   synthesis.

See **[docs/ROADMAP.md](docs/ROADMAP.md)** for the full plan, and
**[docs/MIGRATION-TINYJS.md](docs/MIGRATION-TINYJS.md)** for the planned move to
a ~6 MB native desktop app (no Node, no HTTP server).

---

## Documentation

| Document | Covers |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Installation, speech models, microphone permissions, troubleshooting |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Turn loop, tools, data model, why each piece exists |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What is next, and what "a full campaign" requires |
| [docs/MIGRATION-TINYJS.md](docs/MIGRATION-TINYJS.md) | Port to a native desktop window |
| [campaign/RESEARCH.md](campaign/RESEARCH.md) | Verified Heroes of the Borderlands facts and sources |

---

## Legal

This project is a personal tool. It ships **no** copyrighted game content.

- **D&D SRD 5.1 and 5.2** are licensed **CC-BY-4.0** and may be included with
  attribution — that is the intended source for rules text and monsters.
- The core rulebooks, adventures and setting material are **not** redistributable.
  Do not commit scanned or transcribed booklet text.
- `campaign/RESEARCH.md` deliberately records structured facts (names, areas,
  relationships) and sources, not rulebook prose.

## License

MIT. See [LICENSE](LICENSE).
