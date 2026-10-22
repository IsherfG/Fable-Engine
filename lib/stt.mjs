/**
 * Speech-to-text via whisper.cpp.
 *
 * The browser captures the microphone (MediaRecorder -> webm/opus). macOS will
 * NOT give a shell process microphone access, so capture must happen in the
 * browser; ffmpeg is only used here for format conversion, which needs no TCC
 * permission at all.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'

const execFileAsync = promisify(execFile)

export function expandHome(p) {
  return p?.startsWith('~') ? p.replace(/^~/, homedir()) : p
}

/** Convert any input audio into the 16 kHz mono PCM WAV whisper.cpp requires. */
export async function toWhisperWav(inputPath, outputPath) {
  await execFileAsync('ffmpeg', [
    '-v', 'error',
    '-y',
    '-i', inputPath,
    '-ar', '16000',
    '-ac', '1',
    '-c:a', 'pcm_s16le',
    outputPath,
  ])
  return outputPath
}

/** Lines whisper.cpp writes to stdout that are logs, not transcript. */
const LOG_PREFIXES = [
  'whisper_', 'ggml_', 'load_', 'main:', 'system_info', 'init:', 'encode', 'decode',
  'whisper_init', 'memcpy', 'compute', 'mel', 'output_', 'print_', 'fwrite',
]

function isLogLine(line) {
  if (!line.trim()) return true
  if (line.startsWith('[')) return true // timestamped line
  const lower = line.toLowerCase()
  return LOG_PREFIXES.some((p) => lower.startsWith(p.toLowerCase()))
}

/**
 * Transcribe a WAV file.
 * @returns {Promise<string>} the transcript
 */
export async function transcribe(wavPath, sttConfig) {
  const bin = expandHome(sttConfig.bin || 'whisper-cli')
  const model = expandHome(sttConfig.model)

  if (!existsSync(model)) {
    throw new Error(
      `Whisper model not found at ${model}. Download one, e.g.\n` +
        '  curl -L -o ~/.cache/whisper-cpp/ggml-small.en.bin \\\n' +
        '    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
    )
  }

  const baseArgs = [
    '-m', model,
    '-f', wavPath,
    '-l', 'en',
    '-nt',
    '-t', String(sttConfig.threads ?? 4),
  ]
  // --prompt biases recognition toward the campaign's proper nouns. This is
  // where generic STT fails worst on tabletop play ("Beholder" -> "be holder").
  if (sttConfig.bias) baseArgs.push('--prompt', sttConfig.bias)

  let stdout
  try {
    ;({ stdout } = await execFileAsync(bin, ['-np', ...baseArgs], { maxBuffer: 8 << 20 }))
  } catch {
    // Older whisper.cpp builds have no --no-prints.
    ;({ stdout } = await execFileAsync(bin, baseArgs, { maxBuffer: 8 << 20 }))
  }

  return stdout
    .split('\n')
    .filter((line) => !isLogLine(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\[BLANK_AUDIO\]|\(blank_audio\)|\[ Silence \]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}
