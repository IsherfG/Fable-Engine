# Architecture

How a turn actually happens, and why the pieces are shaped this way.

---

## The whole loop

```
┌────────────┐
│  browser   │  hold to talk
│  (mic)     │──────────────┐
└────────────┘              │ webm/opus
                            ▼
                     ┌─────────────┐
                     │   ffmpeg    │  16 kHz mono wav
                     └─────────────┘
                            ▼
                     ┌─────────────┐
                     │ whisper.cpp │  transcript
                     └─────────────┘
                            ▼
                   ┌──────────────────┐
                   │  turn loop       │  lib/agent.mjs
                   │  · build prompt  │
                   │  · stream LLM    │──► Command Code Provider API
                   │  · run tools     │◄──  text deltas + tool calls
                   │  · split speech  │
                   └──────────────────┘
                      │            │
              dice, state      sentences
                      │            ▼
                      │     ┌─────────────┐
                      │     │ Kokoro/say  │──► ffmpeg ──► mp3
                      │     └─────────────┘
                      ▼            ▼
                   disk        browser audio queue
```

Everything below is a consequence of four decisions.

---

## Decision 1 — the model rolls nothing

**`lib/dice.mjs` owns randomness.** `crypto.randomInt`, never `Math.random`, never
the model.

The DM is given a `roll_dice` tool and told, in the prompt, that a number it did
not receive from that tool does not exist. When it calls the tool, the app rolls,
and the result goes back as a tool result. The model then narrates *that* number.

Why: language models produce plausible-looking numbers and quietly bend totals to
fit the story they are telling. In a game where the dice are the tension, that is
the whole game gone. This is the single most important line of code in the project.

Supports `1d20+5`, `2d20kh1` (advantage), `2d20kl1` (disadvantage), `4d6kh3`,
mixed terms, and flat modifiers. Natural 20 / natural 1 are detected for a single
d20 and surfaced to the model.

Verified: 14/14 unit cases, and a nat-20 rate of 5.42% over 4000 rolls.

---

## Decision 2 — state lives in files, not in the model's memory

A model's memory of "you're on 7 HP" drifts. A JSON file does not.

```
campaign/*.json  ──►  compiled into the system prompt every turn
      ▲                                │
      │                                ▼
  written to disk  ◄────  tool calls
```

**What the DM sees each turn** (`lib/prompt.mjs`): for every character —
species, class, level, subclass, background, HP/max/temp, AC, speed, proficiency,
**ability scores with modifiers**, saves, skills, equipped items, packed items,
gold, spells with remaining slots, features, notes. Plus the current location, its
neighbours, places already visited, open quests, NPCs present or met, faction
standing, and what the party has learned.

**What it may change** — only via tools:

| Tool | Effect |
|---|---|
| `roll_dice` | Rolls; returns the total. Cannot be faked. |
| `update_character` | HP, temp HP, conditions, notes |
| `rest` | Short rest; **long rest only if the current location is marked safe** |
| `move_party` | Sets `partyLocation`; marks the location visited |
| `record_quest` | `hidden → offered → active → complete/failed` |
| `note` | Appends a durable fact to `discoveries` |
| `lookup_rule` | Greps `rules/` for a term |

The rest rule is the clearest example of the pattern: the module says long rests
only work inside the Keep, so `rest` **refuses** them elsewhere rather than
trusting the prompt to remember. Verified end to end — the day does not advance and
HP does not change.

**Files are the source of truth, not the transcript.** Restarting the app resumes
the campaign. Only the conversation is session-scoped.

---

## Decision 3 — the prompt is filtered, not dumped

`worldBrief()` in `lib/campaign.mjs` deliberately shows only what the party could
plausibly know:

- the current location, its connections, and places already visited
- NPCs who have been met, or who are standing in this location
- open quests only (`active` / `offered`) — hidden ones stay hidden
- the last ten discoveries

Unvisited caves and unmet NPCs never enter the prompt. That is both a token saving
(~500 tokens per turn, not thousands) and a **spoiler guard**: the model cannot
narrate the inside of a cave the party has not entered, because it has never been
told what is there.

---

## Decision 4 — speech is streamed, sentence by sentence

`lib/tts.mjs` splits the reply as it arrives and speaks each sentence as soon as it
is complete. Playback therefore starts before generation finishes, and stays ahead
of the audio.

```
LLM delta …  "[Narrator] The door groans open on a room thick with pipe smoke."
             ├─ splitter emits sentence
             ├─ Kokoro synthesises (~2× realtime)
             └─ mp3 → browser queue → plays while the next sentence synthesises
```

**Speaker tags drive voice selection.** Every sentence must start with `[Narrator]`
or `[Character Name]`. The tag is stripped before speech and hashed to a voice, so
an NPC sounds the same in every session with no configuration. The narrator's voice
is excluded from the NPC pool so a character never sounds like the DM.

One subtlety worth keeping: a short sentence is normally merged into the next to
avoid clipped TTS fragments, **but not when the speaker changes immediately after**
— otherwise the new speaker's voice gets applied to the previous speaker's words.

---

## The turn loop

`lib/agent.mjs`, `runTurn()`:

```
1  push the player's message
2  compose system prompt (module + party sheets + world brief)
3  stream chat completions with tools
4  on each text delta: forward it, and split out finished sentences → synthesise
5  on end: if the model requested tools, execute them, push results, loop again
6  when it stops calling tools: persist, emit done
```

`maxToolRounds` bounds step 5 so a confused model cannot loop forever. Each tool
result is fed back as a `tool` message, so the model narrates with real numbers.

**Streaming.** The API is OpenAI-compatible on `/chat/completions`. The client is a
hand-rolled SSE reader (`lib/llm.mjs`) — no SDK — which also captures
`stream_options.include_usage` so token counts are real.

**A timeout guard** aborts a stalled upstream request (default 60 s) so it cannot
hold the turn lock forever.

---

## Server and transport

`server.mjs` is a small Node HTTP server:

| Route | Purpose |
|---|---|
| `GET /api/state` | model, party, location, session info |
| `GET/POST /api/setup` | onboarding options / create campaign |
| `GET /api/transcript` | live session messages, for restoring the UI |
| `POST /api/turn` | one turn, streamed as SSE |
| `POST /api/stt` | audio in, transcript out |
| `GET /api/party`, `POST /api/party` | read / replace character sheets |
| `GET /api/sessions`, `/api/sessions/<id>` | session history |
| `POST /api/session/end` | archive and start fresh |
| `POST /api/reset` | `{full:true}` restarts the campaign |
| `GET /audio/<id>.mp3` | synthesised speech |
| `POST /api/tts-test` | sound check |

**Why SSE rather than one JSON response:** the DM's reply must appear and be spoken
as it is generated. A buffered response would add several seconds of silence.

**A no-op `ack` event** is written immediately, because otherwise the browser
receives zero bytes until the first token and a slow turn looks like a hung page.

**Turns are serialised** by a lock. Two overlapping turns would interleave the
transcript, and the app is reachable from a phone on the LAN.

---

## Sessions

A **campaign** is long. A **session** is one sitting.

```
campaign/sessions/current.json    live transcript, restored on boot
campaign/sessions/index.json      archived sessions + recaps
campaign/sessions/<uuid>.json     one file per finished session
```

Ending a session archives the transcript with a deterministic recap (no extra model
call), then starts a fresh one. Party, gear, HP, location, quests and the day are
untouched — they belong to the campaign, not the session.

Archived sessions are git-ignored: they are play data, not project data.

---

## Frontend

Plain HTML/CSS/JS, no framework, no build step. Three files carry the weight:

- `app.js` — transcript, audio queue, mic capture, character editor, session drawer
- `setup.js` — the four-step onboarding wizard, self-contained
- `style.css` — black base, one gold accent, flat edges

**DOM is built with `createTextNode`, not `innerHTML`.** Model output is untrusted
text; building nodes means it can never become markup.

**Audio is unlocked on first interaction.** Browsers only allow playback after a
user gesture, and the DM's speech arrives many seconds later, so the app plays a
silent sample once on first click or keypress and reuses the element thereafter.
Playback failures are reported instead of swallowed.

**Microphone capture happens in the browser**, not in a shell process: macOS will
not give a terminal microphone access, and a browser gets it the normal way.
ffmpeg is then only used for format conversion, which needs no permission.

---

## Module map

```
server.mjs              HTTP, routes, SSE, static files
lib/agent.mjs           turn loop, tool execution, speech scheduling
lib/llm.mjs             Command Code streaming client + auth resolution
lib/dice.mjs            dice engine (crypto random)
lib/prompt.mjs          system prompt: rules, style, party sheets
lib/campaign.mjs        world state, prompt briefing, persistence
lib/onboarding.mjs      class kits, adventures, bonds
lib/sessions.mjs        session archive and restore
lib/stt.mjs             ffmpeg → whisper.cpp
lib/tts.mjs             Kokoro / say → mp3, voices, sentence splitting
public/                 browser client
campaign/               module data + campaign state
rules/                  optional rule reference for lookup_rule
```

---

## Things that are deliberately not here

- **No framework.** The UI is a transcript and a sidebar. React would add a build
  step and a dependency tree for no gain.
- **No database.** The whole campaign is a handful of JSON files a human can read
  and edit between sessions.
- **No streaming audio.** Speech is synthesised per sentence to mp3 rather than
  streamed from a model, because it keeps the player logic trivial and the cache
  effective — repeated lines cost nothing.
- **No server-side session for the browser.** The frontend is stateless; the
  backend holds the state. Reloading re-reads it.
