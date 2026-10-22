/**
 * Text-to-speech. Two providers, chosen by `tts.provider` in config.json:
 *
 *   kokoro - local neural TTS (Kokoro-82M, ONNX). Free, offline, unlimited, and
 *            far better than `say`. Costs ~529MB of node_modules and synthesizes
 *            at ~2x realtime, which is why speech is done one sentence at a time
 *            and streamed to the browser as it completes.
 *   say    - macOS built-in. Instant, zero dependencies, always the fallback.
 *
 * Both produce cached mp3s so the browser only ever plays one format.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

let cachedVoices = null

// Kokoro must be loaded once and kept in memory. Per-request loading costs
// ~390ms even with the model cached, and the very first load downloads ~92MB.
let kokoroPromise = null
let kokoroFailed = null

export function kokoroEnabled(config) {
  return (config.tts?.provider ?? 'say') === 'kokoro'
}

async function getKokoro(config) {
  if (kokoroFailed) throw new Error(kokoroFailed)
  if (!kokoroPromise) {
    kokoroPromise = (async () => {
      const { KokoroTTS } = await import('kokoro-js')
      const k = config.tts?.kokoro ?? {}
      return KokoroTTS.from_pretrained(k.model ?? 'onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: k.dtype ?? 'q8',
        device: k.device ?? 'cpu',
      })
    })().catch((error) => {
      // Remember the failure so we do not retry a missing install every sentence.
      kokoroFailed = `Kokoro unavailable (${error.message}). Falling back to say.`
      kokoroPromise = null
      throw new Error(kokoroFailed)
    })
  }
  return kokoroPromise
}

/** Load the model before the first turn so it is not paid mid-session. */
export async function warmTts(config) {
  if (!kokoroEnabled(config)) return { provider: 'say' }
  try {
    const tts = await getKokoro(config)
    // Prime onnxruntime: the first inference pays graph-optimisation cost
    // (~3s), which would otherwise land on the session's opening sentence.
    await tts
      .generate('Ready.', { voice: config.tts?.kokoro?.defaultVoice ?? 'bf_emma', speed: 1 })
      .catch(() => {})
    return { provider: 'kokoro', voices: Object.keys(tts.voices ?? {}).length }
  } catch (error) {
    return { provider: 'kokoro', error: error.message }
  }
}

async function toMp3(input, output) {
  await execFileAsync('ffmpeg', [
    '-v', 'error',
    '-y',
    '-i', input,
    '-ar', '22050',
    '-ac', '1',
    '-c:a', 'libmp3lame',
    '-b:a', '64k',
    output,
  ])
}

/** Every installed English voice name, cached for the process lifetime. */
export async function availableVoices() {
  if (cachedVoices) return cachedVoices
  try {
    const { stdout } = await execFileAsync('say', ['-v', '?'], { maxBuffer: 4 << 20 })
    cachedVoices = stdout
      .split('\n')
      .filter((l) => /\ben_(US|GB|AU|IE|ZA|IN)\b/.test(l))
      .map((l) => l.trim().split(/\s{2,}/)[0])
      .filter(Boolean)
  } catch {
    cachedVoices = []
  }
  return cachedVoices
}

/** Only keep voices the machine actually has, so we never emit silence. */
export async function usablePool(pool, fallback) {
  const have = new Set(await availableVoices())
  const filtered = (pool || []).filter((v) => have.has(v))
  if (filtered.length) return filtered
  return have.has(fallback) ? [fallback] : [...have].slice(0, 4)
}

/** The narrator's voice for whichever provider is configured. */
export function defaultVoiceFor(config) {
  if (kokoroEnabled(config)) return config.tts?.kokoro?.defaultVoice ?? 'bf_emma'
  return config.tts?.say?.defaultVoice ?? config.tts?.defaultVoice ?? 'Daniel'
}

/** Voices usable with the configured provider. */
export async function resolveVoicePool(config) {
  if (kokoroEnabled(config)) {
    try {
      const tts = await getKokoro(config)
      const have = new Set(Object.keys(tts.voices ?? {}))
      const wanted = (config.tts?.kokoro?.voicePool ?? []).filter((v) => have.has(v))
      if (wanted.length) return wanted
      return [...have]
    } catch {
      // Kokoro unavailable - fall through to the system voices below.
    }
  }
  return usablePool(config.tts?.say?.voicePool ?? config.tts?.voicePool, defaultVoiceFor(config))
}

/** Deterministic voice assignment so each NPC keeps the same voice forever. */
export function pickVoiceFor(speaker, config, pool) {
  const explicit = config.voices?.[String(speaker).toLowerCase()]
  if (explicit) return explicit

  const narrator = defaultVoiceFor(config)
  if (!speaker || /^(narrator|dm|dungeon master)$/i.test(speaker)) return narrator

  // Keep NPCs off the narrator's voice so the DM never sounds like a character.
  const candidates = pool.length > 1 ? pool.filter((v) => v !== narrator) : pool
  const list = candidates.length ? candidates : pool
  const hash = createHash('sha1').update(String(speaker).toLowerCase()).digest()
  // 64 bits of the digest, so assignment stays even across larger pools.
  return list[Number(hash.readBigUInt64BE(0) % BigInt(list.length))]
}

/** Strip markdown and expand dice notation so it reads naturally aloud. */
export function forSpeech(text) {
  return String(text)
    .replace(/`{1,3}/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/(^|[\s(])\*(?!\s)(.*?)(?<!\s)\*/g, '$1$2')
    .replace(/_{1,2}(.*?)_{1,2}/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/(\d*)[dD](\d+)/g, (_, c, s) => `${c} d ${s}`)
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Synthesize with the macOS system voice. Used directly, and as the fallback. */
async function synthesizeWithSay(spoken, config, cacheDir, voiceOverride) {
  const voice =
    voiceOverride ??
    config.tts?.say?.defaultVoice ??
    config.tts?.defaultVoice ??
    'Daniel'
  const rate = config.tts?.rate ?? 180
  const key = createHash('sha1').update(`say|${voice}|r${rate}|${spoken}`).digest('hex').slice(0, 16)
  const mp3 = join(cacheDir, `${key}.mp3`)

  if (existsSync(mp3)) return { file: mp3, id: `${key}.mp3`, voice, text: spoken }

  const aiff = join(cacheDir, `${key}.aiff`)
  await execFileAsync('say', ['-v', voice, '-r', String(rate), '-o', aiff, spoken])
  await toMp3(aiff, mp3)
  const { unlink } = await import('node:fs/promises')
  await unlink(aiff).catch(() => {})

  return { file: mp3, id: `${key}.mp3`, voice, text: spoken }
}

/**
 * Synthesize speech to a cached mp3.
 * @returns {Promise<{file:string, id:string, voice:string, text:string}>}
 */
export async function synthesize(text, voice, config, cacheDir) {
  const spoken = forSpeech(text)
  if (!spoken) throw new Error('Nothing to synthesize')

  await mkdir(cacheDir, { recursive: true })

  const provider = kokoroEnabled(config) ? 'kokoro' : 'say'
  const speed = config.tts?.kokoro?.speed ?? 1.0
  const rate = config.tts?.rate ?? 180
  const stamp = provider === 'kokoro' ? `s${speed}` : `r${rate}`
  const key = createHash('sha1')
    .update(`${provider}|${voice}|${stamp}|${spoken}`)
    .digest('hex')
    .slice(0, 16)
  const mp3 = join(cacheDir, `${key}.mp3`)

  if (existsSync(mp3)) return { file: mp3, id: `${key}.mp3`, voice, text: spoken }

  if (provider === 'kokoro') {
    try {
      const tts = await getKokoro(config)
      const audio = await tts.generate(spoken, { voice, speed })
      const wav = join(cacheDir, `${key}.wav`)
      await writeFile(wav, Buffer.from(audio.toWav()))
      await toMp3(wav, mp3)
      const { unlink } = await import('node:fs/promises')
      await unlink(wav).catch(() => {})
      return { file: mp3, id: `${key}.mp3`, voice, text: spoken }
    } catch {
      // Never leave the table in silence mid-scene.
      return synthesizeWithSay(spoken, config, cacheDir)
    }
  }

  return synthesizeWithSay(spoken, config, cacheDir, voice)
}

/**
 * Split streamed text into speakable sentences so playback can start before
 * the model has finished generating. This is what hides TTS latency.
 */
export function createSentenceSplitter({ minLength = 12, maxLength = 240 } = {}) {
  let buffer = ''

  function extract(force) {
    const out = []
    for (;;) {
      buffer = buffer.replace(/^\s+/, '')
      if (!buffer) break

      // Prefer a real sentence boundary.
      const match = buffer.match(/^(.*?[.!?…]+)(\s+|$)/s)
      if (match && (match[2].length > 0 || force)) {
        const sentence = match[1].trim()
        const rest = buffer.slice(match[0].length)
        // A short sentence is normally merged into the next one so TTS does not
        // produce a clipped fragment. But when the speaker changes immediately
        // after it, it must stand alone - otherwise the next speaker's voice
        // gets applied to these words.
        const speakerChange = /^\s*\[[^\]]{1,40}\]/.test(rest)
        if (sentence.length >= minLength || speakerChange || force) {
          out.push(sentence)
          buffer = rest
          continue
        }
      }

      // Break very long unpunctuated runs at a clause boundary.
      if (buffer.length >= maxLength) {
        const cut = Math.max(
          buffer.lastIndexOf(', ', maxLength),
          buffer.lastIndexOf('; ', maxLength),
          buffer.lastIndexOf(' — ', maxLength),
        )
        if (cut > minLength) {
          out.push(buffer.slice(0, cut + 1).trim())
          buffer = buffer.slice(cut + 1)
          continue
        }
      }
      break
    }
    if (force && buffer.trim().length >= 2) {
      out.push(buffer.trim())
      buffer = ''
    }
    return out
  }

  return {
    push(delta) {
      buffer += delta
      return extract(false)
    },
    flush() {
      return extract(true)
    },
    get pending() {
      return buffer
    },
  }
}
