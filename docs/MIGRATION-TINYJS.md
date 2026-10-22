# Migrating Fable Engine to tinyjs

Target: [`tarwin/tinyjsapp`](https://github.com/tarwin/tinyjsapp) — a **txiki.js backend + a
native webview window**, shipped as a ~6 MB desktop app. No Electron, no Node, no bundled
Chromium, **no HTTP server and no ports**.

This document is the migration plan. It is honest about the two places where the current
code cannot simply be moved.

---

## 1. What tinyjs actually is

```
┌──────────────────────┐  unix socket   ┌──────────────────────────┐
│ backend (txiki.js)   │◄──────────────►│ launcher (C++, ~1–2 MB)  │
│ src/backend/main.js  │  line protocol │ WKWebView / WebView2     │
│ · owns app logic     │  (JSON lines)  │ · native dialogs         │
│ · fs / net / spawn   │                │ · else a dumb forwarder  │
└──────────────────────┘                └──────────┬───────────────┘
                                                   │ bridge
                                        ┌──────────▼────────────┐
                                        │ your page (file://)   │
                                        │ api.call('m', params) │
                                        │ api.on('event', fn)   │
                                        └───────────────────────┘
```

- **Backend** is plain JS on [txiki.js](https://txikijs.org). Not Node — no N-API addons.
  It has `tjs.spawn`, `tjs.readFile/writeFile`, FFI, and `tiny.fetch`.
- **Frontend** is plain HTML/CSS/JS in `src/frontend/`, loaded from `file://` into the
  system WebKit (macOS) or WebView2 (Windows). No dev server in production.
- **Bridge** is two functions: backend `export const api = { ... }` + `export function
  init(app) {}`; page `api.call()` and `api.on()` for push events.
- **Project layout:**
  ```
  tinyjs.json
  assets/icon.png
  resources/                 data your code reads
  executables/               binaries your code spawns (signed as sidecars)
  src/backend/main.js
  src/frontend/              index.html + js/css
  src/shared/                code both sides import
  ```

### What survives the move unchanged

| Current asset | Verdict |
|---|---|
| `lib/dice.mjs` | **Ports as-is.** Pure functions. |
| `lib/prompt.mjs` | **Ports as-is.** Pure functions. |
| `lib/campaign.mjs` | Ports; swap `node:fs` for `tjs`. |
| `lib/onboarding.mjs` | **Ports as-is.** Pure data + one factory. |
| `lib/sessions.mjs` | Ports; swap `node:fs` for `tjs`. |
| `public/*` → `src/frontend/*` | Mostly as-is; replace `fetch('/api/...')` with `api.call()`. |
| whisper.cpp | **Better fit than now** — becomes a signed sidecar in `executables/`. |
| macOS `say` | Works via `tjs.spawn`. |
| Command Code LLM calls | Work via `tiny.fetch(..., { stream: true })`. |
| Campaign JSON data | Moves to the app *data* directory (see §4). |

### What does not survive

| Problem | Why |
|---|---|
| **`kokoro-js` + `onnxruntime-node`** | `onnxruntime-node` is a Node N-API addon. txiki.js does not implement Node's addon ABI. **Kokoro will not load.** |
| `node:http` server, routing, SSE, `/audio/<id>.mp3` | No server, no ports. Everything becomes bridge calls. |
| Writing `campaign/*.json` beside the code | A shipped `.app` has a read-only `Contents/Resources`. Must use the data dir. |
| 487 MB whisper model in the repo | Cannot ship. Download on first run to the data dir. |

---

## 2. The one real decision: what happens to TTS

Kokoro is the best-sounding thing in the app and the operator chose it by ear. Losing it is
not acceptable without a replacement of similar quality. Four options, honestly priced:

### A. Piper as a sidecar — **recommended**
Bundle the `piper` binary in `executables/` plus voice models in `resources/`.
- Fits tinyjs's model exactly (it already signs sidecars).
- Offline, free, unlimited, no quota.
- Voice quality: clearly above `say`, **below Kokoro**. Roughly 20–60 MB per voice.
- Effort: moderate. New voice-mapping config; the TTS interface in `lib/tts.mjs` already
  abstracts provider, so this is a third provider branch.

### B. Kokoro via `onnxruntime-web` **in the frontend**
The webview is WebKit; `onnxruntime-web` runs on WebAssembly and needs no Node addon.
- Keeps the exact voice the operator picked.
- Cost: model load in the page, WASM is slower than native CPU. Measured native was
  ~2× realtime; WASM is plausibly 0.5–1× realtime, which may push first-audio past the
  point where it feels conversational.
- Effort: moderate but **must be benchmarked before committing**. This is a spike, not a plan.

### C. Keep a Node helper just for TTS
Keep `kokoro-js` in a small Node process spawned as a sidecar.
- Guarantees identical audio.
- Breaks the "no Node" promise and adds ~80–150 MB for the Node runtime, defeating the
  ~6 MB premise. **Not recommended.**

### D. `say` only (+ `tiny.say` on Windows)
- Zero cost, instant, already the fallback path, zero new work.
- A real quality regression the operator will notice immediately.

**Recommendation:** ship the port with `say` working end-to-end first (it already is), then
benchmark **B**; if WASM Kokoro cannot hit roughly realtime, land **A**.

---

## 3. API mapping

Each current HTTP route becomes one backend method. Push events replace SSE.

| Current | tinyjs |
|---|---|
| `GET /api/state` | `api.call('state')` |
| `GET/POST /api/party` | `api.call('party')` / `api.call('saveParty', {party})` |
| `GET/POST /api/setup` | `api.call('setup')` / `api.call('createCampaign', draft)` |
| `POST /api/turn` (SSE) | `api.call('turn', {message, tts})` + `api.on('turn', cb)` |
| `POST /api/stt` (audio body) | `api.call('stt', { audio: Uint8Array })` |
| `GET /audio/<id>.mp3` | `api.call('audio', id)` → `Uint8Array` → `Blob` → object URL |
| `GET /api/transcript` | `api.call('transcript')` |
| `GET /api/sessions` | `api.call('sessions')` |
| `GET /api/sessions/<id>` | `api.call('session', id)` |
| `POST /api/session/end` | `api.call('endSession')` |
| `POST /api/reset {full}` | `api.call('reset', { full })` |
| `POST /api/scene` | `api.call('setScene', {scene})` |
| `POST /api/tts-test` | `api.call('soundCheck')` |
| static `/app.js`, `/style.css` | files in `src/frontend/`, loaded directly |

**Streaming a turn.** The current design streams text deltas and one `speech` event per
sentence. Keep that shape: the backend emits `{type:'text'|'speech'|'roll'|...}` events via
the bridge; the page appends them exactly as it does now. The SSE parser in `app.js`
(`buffer.indexOf('\n\n')`) disappears, replaced by a listener — the event payloads stay
identical, which keeps the UI work near zero.

**Audio delivery.** `api.call('audio', id)` returning bytes is simplest and avoids inventing
a custom protocol. Convert to a `Blob` and reuse the existing `<audio>` + `playClip()` code
unchanged.

---

## 4. Storage: the app data directory

Shipped apps must not write next to their own code. Split the two kinds of data:

| Kind | Location | Examples |
|---|---|---|
| **Bundled, read-only** | `resources/` → `app.paths().resources` | equipment lists, class kits, module location/NPC/quest seed data |
| **User data, writable** | `app.paths()` data dir | party sheets, campaign state, sessions, audio cache, downloaded models |

Current code resolves everything from `ROOT`. Add one indirection:

```js
// lib/paths.mjs
export function makePaths({ resources, data }) {
  return {
    equipment: `${resources}/campaign/equipment.json`,
    locations: `${resources}/campaign/locations.json`,
    npcs:      `${resources}/campaign/npcs.json`,
    quests:    `${resources}/campaign/quests.json`,
    party:     `${data}/campaign/party.json`,
    state:     `${data}/campaign/campaign.json`,
    sessions:  `${data}/sessions`,
    audio:     `${data}/tts`,
    models:    `${data}/models`,
  }
}
```

On first run, seed the writable files by copying the read-only templates. That single change
makes the app relocatable and update-safe.

---

## 5. Models and first-run download

The whisper model is **92 MB (whisper `small.en` is ~487 MB on disk)** and any TTS model is
tens to hundreds of MB. Neither belongs in the repository or the installer.

- Ship without models; the app is usable for text-only play immediately.
- First run that needs STT offers "download speech model (487 MB)" with progress and a
  cancel button.
- Store under the data dir; verify byte size after download (this is the exact failure that
  produced `Protobuf parsing failed` earlier — a truncated model looks like a broken app).
- Voice and STT settings become a **Settings** panel rather than hand-edited `config.json`.

---

## 6. Phased plan

### Phase 0 — rename (done)
Package is `fable-engine`, UI and banner read **Fable Engine**.

### Phase 1 — scaffold, no features lost
1. `tinyjs new fable-engine --template vanilla-ts` (or plain JS to start).
2. Move `lib/*` into `src/backend/lib/`, pure modules unchanged.
3. Move `public/*` into `src/frontend/`.
4. Write `src/backend/main.js` exposing the API table in §3, delegating to the same functions.
5. Replace `fetch('/api/x')` in the frontend with `api.call('x')`.
6. Verify: dice, prompt, dice log, party panel, setup wizard, transcript.

**Exit criterion:** a native window opens, character creation works, a turn completes, dice
roll, and `say` speaks.

### Phase 2 — audio without HTTP
1. STT: `api.call('stt', {audio})`; spawn `whisper-cli` from `executables/`.
2. TTS: `api.call('audio', id)` returning bytes → `Blob` → existing player.
3. Mic permission entitlement in `tinyjs.json`.
4. Verify the full voice loop inside the app window.

**Exit criterion:** hold-to-talk → transcript → reply → spoken, all without a server.

### Phase 3 — decide TTS
1. Benchmark `onnxruntime-web` Kokoro in the webview (option B): model load time, realtime
   factor for a 200-character sentence.
2. If ≥ ~1× realtime, ship B. Otherwise build the Piper sidecar (option A).
3. Keep `say` as the always-available fallback throughout.

### Phase 4 — first-run experience
1. Model download with progress, size verification, cancel.
2. Settings panel: model, voice, voice pool, STT bias terms.
3. Move user data to the data dir; seed from templates.

### Phase 5 — ship
1. `assets/icon.png`, `tinyjs.json` metadata.
2. `tinyjs build` → signed `.app`; verify sidecar signing for whisper.
3. `tinyjs publish` for auto-update.
4. Smoke test on a clean macOS user account (no `~/.cache` leftovers).

---

## 7. Risks, ranked

| Risk | Impact | Mitigation |
|---|---|---|
| Kokoro cannot reach realtime in WASM | Voice quality regression, or extra work for a Piper sidecar | Benchmark in Phase 3 **before** committing; `say` fallback always works |
| Sidecar signing / quarantine blocks whisper | STT dead in the shipped app | Build signs sidecars; test a **downloaded** build, not just a local one |
| `tjs` lacks `crypto.randomInt` | Dice must stay honest | Use `crypto.getRandomValues` and derive bounded ints with rejection sampling — never `%` |
| Model download fails mid-way | App looks broken | Verify byte size; keep the existing lesson: a truncated ONNX/GGML file parses as corrupt, not missing |
| Writes next to the app | Crash on a read-only bundle | Data-dir indirection in Phase 1, not later |
| Loss of the HTTP interface | Other tooling that used it stops working | Nothing external depends on it today; the bridge is strictly simpler |

---

## 8. What this buys

- **~6 MB** instead of Electron-sized; no Chromium, no Node.
- **Real desktop app**: dock icon, native menus, no terminal, no `localhost:8787`.
- **No ports** — nothing to collide with, nothing exposed on the LAN by accident.
- Proper install, code signing, and auto-update via `tinyjs publish`.
- Still plain HTML/CSS/JS — the existing frontend, dice engine and prompt work carry over.
