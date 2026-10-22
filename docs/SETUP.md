# Setup

Fable Engine runs on your own machine. This covers install, the optional speech
models, and the things that go wrong.

---

## 1. Requirements

| | |
|---|---|
| OS | macOS (the current build) |
| Node | 20 or newer |
| ffmpeg | required — converts recorded audio and synthesised speech |
| Account | a **Command Code** account with Provider API access |

```sh
brew install ffmpeg
```

> **If `brew install` fails with `SSL_ERROR_SYSCALL`**, the Homebrew bottle CDN is
> unreachable on your network. That affects every bottle, not just this one. Build
> from source instead where a source build is offered (see whisper below), or use
> a different network.

---

## 2. Install

```sh
cd ~/dnd-dm          # or wherever you cloned it
npm install
npm start
```

`npm install` pulls `kokoro-js` and its ONNX runtime (~500 MB). If you intend to
use the macOS system voice instead, you can skip installing entirely and set:

```jsonc
// config.json
"tts": { "provider": "say" }
```

…but the module still needs to be absent-proofed; the app falls back to `say`
automatically if Kokoro cannot load.

Open <http://localhost:8787>.

---

## 3. Microphone

The microphone needs a **secure context**:

- `http://localhost` — works
- `http://192.168.x.x` — **does not work**, the browser blocks the mic
- a LAN IP over HTTPS — works

For phone or tablet play, generate a self-signed certificate:

```sh
npm run https
```

It creates `certs/key.pem` and `certs/cert.pem` including your LAN IP, then serves
over TLS. Accept the browser warning once.

`certs/` is git-ignored — it contains a private key.

> macOS will not give a **shell** process microphone access. Recording therefore
> happens in the browser, and ffmpeg is only used for format conversion, which
> needs no permission. This is deliberate.

---

## 4. Speech-to-text (whisper.cpp)

Optional. Without it you can still type your turns.

You need the `whisper-cli` binary and a model file.

**Build from source** if Homebrew is unavailable:

```sh
mkdir -p ~/.local/src ~/.cache/whisper-cpp
git clone --depth 1 https://github.com/ggml-org/whisper.cpp ~/.local/src/whisper.cpp
cmake -S ~/.local/src/whisper.cpp -B ~/.local/src/whisper.cpp/build \
  -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF
cmake --build ~/.local/src/whisper.cpp/build -j"$(sysctl -n ncpu)"
```

**Download the model** (~487 MB on disk):

```sh
curl -L -o ~/.cache/whisper-cpp/ggml-small.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
```

Then point `config.json` at both:

```jsonc
"stt": {
  "bin":   "~/.local/src/whisper.cpp/build/bin/whisper-cli",
  "model": "~/.cache/whisper-cpp/ggml-small.en.bin",
  "threads": 8
}
```

**Verify the size.** A truncated download parses as a *corrupt* model, not a
missing one, and fails in a confusing way. `ggml-small.en.bin` should be
**487,601,967 bytes**.

### Tuning recognition: `stt.bias`

This is the highest-value speech setting. It primes the model with your campaign's
vocabulary, which is where generic speech recognition fails worst:

```jsonc
"bias": "Dungeons and Dragons tabletop session. Terms: Eldritch Blast, Beholder,
         owlbear, initiative, saving throw, Ashfen, Winvarle, Oggdug."
```

Put your **character names, spell names and place names** in there.

### Expected speed

- First transcription after a reboot: ~10 s (whisper compiles its Metal kernels once)
- Every one after: **under 1 second**

If the first one looks hung, it is not.

---

## 5. Text-to-speech

Two providers. Switch with `tts.provider`.

### `kokoro` — local neural (default)

Free, offline, unlimited. 28 voices, ~2× realtime on an M2.

```jsonc
"tts": {
  "provider": "kokoro",
  "kokoro": {
    "defaultVoice": "bf_isabella",
    "voicePool": ["bf_emma", "af_heart", "am_michael", "…"]
  }
}
```

- First run downloads an **86 MB** model and takes ~30 s. Later starts take ~400 ms.
- Narrator voice is `bf_isabella` by default; every NPC gets a stable voice by name,
  and the narrator's voice is excluded from the NPC pool.
- Female voices worth auditioning: `bf_emma`, `bf_alice`, `bf_isabella`, `af_heart`,
  `af_nicole`, `af_sarah`.

**Do not kill the app while it is warming up.** That truncates the model download
and produces `Protobuf parsing failed`. Fix by deleting the cache and restarting:

```sh
rm -rf node_modules/@huggingface/transformers/.cache/onnx-community/Kokoro-82M-v1.0-ONNX
```

### `say` — macOS system voice

Zero install, instant, lower quality. 45 English voices.

```jsonc
"tts": { "provider": "say", "say": { "defaultVoice": "Daniel" } }
```

Downloading the free **Enhanced / Premium** voices in System Settings →
Accessibility → Spoken Content → Manage Voices is a large quality jump.

### Cost of the better voice

| | `say` | Kokoro |
|---|---|---|
| First audio | ~3.4 s | ~6.7 s |
| Full turn | ~5.7 s | ~16–20 s |
| Disk | 0 | ~500 MB |

Kokoro synthesises one sentence at a time and playback stays ahead of the audio,
so you wait longer for the *first* line but hear no gaps.

---

## 6. The language model

The API key is read from, in order:

1. `COMMAND_CODE_API_KEY` environment variable
2. `~/.commandcode/auth.json` → `apiKey`
3. `~/.pi/agent/auth.json`
4. `~/.omp/agent/auth.json`

The key is **never** written into the repo or `config.json`.

```jsonc
"llm": {
  "model": "deepseek/deepseek-v4.1-flash",
  "reasoningEffort": "low",
  "maxTokens": 1200,
  "timeoutMs": 60000
}
```

- **`reasoningEffort: "low"`** — do not use `"off"`. With it off the model stops
  calling the bookkeeping tools, so location and quests drift from the fiction.
  `"medium"` only for a heavy fight.
- **`maxTokens` ≥ 800** — reasoning tokens are billed against the same budget and
  will truncate a reply mid-sentence.
- Avoid the `-fast` model variants for long sessions: their *cached-input* rate is
  5–23× higher, and the whole transcript is re-sent every turn.

---

## Troubleshooting

**The page loads but the talk button is disabled.**
A turn is still running. Wait, or restart the app.

**"Too short — hold the button while you speak."**
The recording was under 350 ms.

**No sound at all.**
Press **🔉 test** in the header. It plays a fixed phrase through the real path.
- Status says "blocked by the browser" → click once anywhere on the page, then retry.
- Status shows a media error → the audio file is bad; check the app log.

**`whisper  …/ggml-small.en.bin  *** NOT FOUND ***`**
Download the model (step 4). The startup banner reports this.

**`Command Code 401`**
The key is missing or expired. Set `COMMAND_CODE_API_KEY` or refresh
`~/.commandcode/auth.json`.

**A reply stops mid-sentence.**
Raise `llm.maxTokens`.

**Speech sounds robotic.**
You are on `say`. Switch `tts.provider` to `kokoro`, or download the Enhanced voices.

**`Kokoro unavailable … Protobuf parsing failed`**
Truncated model download. Delete the cache (step 5) and restart without interrupting.

**The first transcription after a reboot takes 10 seconds.**
Expected — whisper compiles Metal kernels once.
