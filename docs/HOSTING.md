# Hosting

**Fable Engine runs locally, on purpose.** It is not a web app that happens to be
served from your machine — the machine is part of the design.

This document exists so nobody tries to deploy it again and loses an afternoon.

---

## Can I deploy this to Cloudflare Workers / Pages?

No. It will build the frontend and then every feature will fail.

Cloudflare Workers is a runtime for stateless request handlers. This app needs
four things that runtime does not have:

| The app does | Workers provides |
|---|---|
| `http.createServer` with long-lived SSE for streaming a turn | request → response only |
| `execFile('ffmpeg')` to convert recorded audio | **no subprocesses** |
| `execFile('whisper-cli')` for speech-to-text | **no subprocesses** |
| `execFile('say')` / Kokoro for speech | **no subprocesses** |
| `readFile` / `writeFile` on `campaign/*.json` | **no filesystem** |
| `kokoro-js` + `onnxruntime-node` (native addon) | not supported |

Deploying would serve the HTML shell, and the setup wizard would hang on its first
`fetch('/api/setup')`.

**A practical warning:** Cloudflare's build system auto-detects the project as
**"Static / Hugo"** because `public/` is also Hugo's default output directory. It
then runs `npx hugo`, which is not installed, and the build fails with:

```
npm error could not determine executable to run
```

That error is a red herring. Fixing the build command would not make the app work.

### If you only want a browsable demo

Serve `public/` as static assets with a small mock worker that answers `/api/state`
and `/api/setup` from fixture data. The onboarding wizard, party panel and dice log
render; turns, speech and saving do not work. That is a screenshot-quality demo,
not the game.

---

## Can I run the real server on a VPS / Railway / Fly.io?

Technically yes, and it is the only way to play from two different houses.

What it takes:

1. A host with **Node 20+**, `ffmpeg`, and enough CPU for whisper and Kokoro.
2. **HTTPS**, because the browser microphone requires a secure context. A bare
   LAN IP over HTTP will not get mic access.
3. Persistent disk for `campaign/` and the downloaded models — otherwise every
   restart loses the campaign.
4. Your Command Code API key in the host's environment.

**The honest cost.** Kokoro synthesises at roughly 2× realtime on an M2. On a
shared small vCPU it may drop below realtime, so speech would lag behind the
narration. whisper `small.en` is similarly CPU-bound. A $5/month instance is
likely to feel worse than the laptop you already have.

For two people at one table, local is strictly better: no latency, no monthly
cost, no quota, and the campaign is a folder you can back up by copying.

---

## Recommended setup for two players

**Same room** — `npm start`, both people use the same browser window. This is what
the app assumes.

**Two devices, same network** — `npm run https`, then open the LAN URL on the
second device. The self-signed certificate needs accepting once. The microphone
works because it is HTTPS.

**Different houses** — the options are a VPS (above), or a mesh VPN such as Tailscale
that gives the laptop a stable private hostname with TLS. The second is usually
simpler than deploying, and keeps everything on your own machine.

---

## What *is* deployable

Only the documentation. This repository's `README.md` and `docs/` render fine as a
static site if you want a project page — but that is a landing page, not the app.
