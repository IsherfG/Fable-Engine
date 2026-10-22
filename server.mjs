#!/usr/bin/env node
/**
 * Fable Engine - a voice-driven AI Dungeon Master.
 *
 *   browser (mic)  --webm/opus-->  ffmpeg  --> whisper.cpp  --> transcript
 *                                                                  |
 *                                                        Command Code Provider API
 *                                                                  |  (SSE, with tools)
 *                                                        dice rolled in-process
 *                                                                  |
 *   browser (audio queue)  <--mp3--  ffmpeg  <--  macOS say  <-- sentence split
 *
 * Run:  npm start          (http://localhost:8787)
 *       npm run https      (self-signed TLS, so a phone on your LAN can use the mic)
 */

import http from 'node:http'
import https from 'node:https'
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { networkInterfaces } from 'node:os'

import { runTurn, saveCampaign } from './lib/agent.mjs'
import { resolveApiKey } from './lib/llm.mjs'
import { toWhisperWav, transcribe } from './lib/stt.mjs'
import { availableVoices, warmTts, synthesize, defaultVoiceFor } from './lib/tts.mjs'
import {
  loadWorld,
  saveCampaignState,
  saveLocations,
  saveQuests,
  saveNpcs,
  currentLocation,
  locationById,
} from './lib/campaign.mjs'
import { SessionStore } from './lib/sessions.mjs'
import { ADVENTURES, BONDS, CLASS_KITS, makeCharacter, adventureFor, bondFor } from './lib/onboarding.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const PUBLIC_DIR = join(ROOT, 'public')
const CACHE_DIR = join(ROOT, '.cache')
const TTS_DIR = join(CACHE_DIR, 'tts')
const TMP_DIR = join(CACHE_DIR, 'tmp')
const RULES_DIR = join(ROOT, 'rules')
const CAMPAIGN_PATH = join(ROOT, 'campaign', 'party.json')
const CAMPAIGN_DIR = join(ROOT, 'campaign')

const useHttps = process.argv.includes('--https')

const config = await loadJsonFile(join(ROOT, 'config.json'), 'config.json').catch((error) => {
  console.error(`\n  Cannot start: ${error.message}\n`)
  process.exit(1)
})
const apiKey = await resolveApiKey()

await mkdir(TTS_DIR, { recursive: true })
await mkdir(TMP_DIR, { recursive: true })

let campaign = await loadJsonFile(CAMPAIGN_PATH, 'campaign/party.json').catch((error) => {
  console.error(`\n  Cannot start: ${error.message}\n`)
  process.exit(1)
})
const session = { messages: [], campaign, startedAt: new Date().toISOString() }

// Campaign world: locations, NPCs, quests, and run state. Separate from
// `campaign` above, which is the party file.
let world = await loadWorld(CAMPAIGN_DIR).catch((error) => {
  console.error(`\n  Cannot start: ${error.message}\n`)
  process.exit(1)
})

// Session history. The live transcript comes off disk, so restarting the
// server resumes the conversation instead of losing it.
const store = await new SessionStore(join(CAMPAIGN_DIR, 'sessions')).init()
session.messages = store.messages

// A turn mutates shared session state, so two overlapping turns - a double
// click, or two devices on the LAN - would interleave the transcript.
let turnInFlight = false

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

function readBody(req, limit = 32 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('Request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** Read and parse a JSON file, turning failures into a readable message. */
async function loadJsonFile(path, label) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(`Could not read ${label}: ${error.message}`)
  }
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`)
  }
}

/** Parse a JSON request body. Malformed input is a 400, not a crash. */
async function readJson(req) {
  const raw = (await readBody(req)).toString('utf8').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    const error = new Error('Request body is not valid JSON')
    error.statusCode = 400
    throw error
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

async function serveStatic(res, urlPath) {
  const rel = normalize(urlPath.replace(/^\/+/, '')) || 'index.html'
  const target = join(PUBLIC_DIR, rel)
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden')
    return
  }
  try {
    const data = await readFile(target)
    res.writeHead(200, {
      'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    })
    res.end(data)
  } catch {
    res.writeHead(404).end('Not found')
  }
}

async function serveAudio(res, name) {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '')
  const target = join(TTS_DIR, safe)
  try {
    const data = await readFile(target)
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=3600' })
    res.end(data)
  } catch {
    res.writeHead(404).end('Not found')
  }
}

/** POST /api/stt - raw recorded audio in, transcript out. */
async function handleStt(req, res) {
  const body = await readBody(req)
  if (!body.length) return sendJson(res, 400, { error: 'Empty audio body' })

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const webm = join(TMP_DIR, `${stamp}.webm`)
  const wav = join(TMP_DIR, `${stamp}.wav`)

  try {
    await writeFile(webm, body)
    await toWhisperWav(webm, wav)
    const text = await transcribe(wav, config.stt)
    sendJson(res, 200, { text })
  } catch (error) {
    sendJson(res, 500, { error: error.message })
  } finally {
    await unlink(webm).catch(() => {})
    await unlink(wav).catch(() => {})
  }
}

/** POST /api/turn - one player turn, streamed as Server-Sent Events. */
async function handleTurn(req, res) {
  const body = await readJson(req)

  // Honour the client's mute toggle so a muted table skips synthesis entirely.
  const ttsEnabled = body.tts !== false && Boolean(config.tts?.enabled)
  const turnConfig = ttsEnabled ? config : { ...config, tts: { ...config.tts, enabled: false } }
  const userText = String(body.message ?? '').trim()

  // An empty message is only meaningful as the opening of a fresh session.
  const opening = userText === '' && session.messages.length === 0
  if (!userText && !opening) {
    return sendJson(res, 400, { error: 'Empty message' })
  }
  if (turnInFlight) {
    return sendJson(res, 409, { error: 'A turn is already running' })
  }
  turnInFlight = true

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const controller = new AbortController()
  req.on('close', () => controller.abort())

  const send = (event) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  // Flush an event immediately. Without this the browser receives zero bytes
  // until the model's first token, so a slow turn looks like a hung page.
  send({ type: 'ack' })

  const before = JSON.stringify(campaign.party)

  try {
    for await (const event of runTurn({
      session,
      userText,
      config: turnConfig,
      apiKey,
      cacheDir: TTS_DIR,
      rulesDir: RULES_DIR,
      signal: controller.signal,
      world,
    })) {
      send(event)
    }
  } catch (error) {
    if (!controller.signal.aborted) send({ type: 'error', message: error.message })
  } finally {
    turnInFlight = false
    if (JSON.stringify(campaign.party) !== before) {
      await saveCampaign(CAMPAIGN_PATH, campaign).catch(() => {})
    }
    // World state changes during a turn (location, quests, notes, rests).
    // Persist the transcript after every turn so a crash or restart is survivable.
    await store
      .save(session.messages, {
        day: world.campaign.day,
        locationName: currentLocation(world)?.name ?? null,
      })
      .catch(() => {})
    await saveCampaignState(CAMPAIGN_DIR, world.campaign).catch(() => {})
    await saveLocations(CAMPAIGN_DIR, world.locations).catch(() => {})
    await saveQuests(CAMPAIGN_DIR, world.quests).catch(() => {})
    await saveNpcs(CAMPAIGN_DIR, world.npcs).catch(() => {})
    if (!res.writableEnded) res.end()
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const path = url.pathname

  try {
    if (req.method === 'GET' && path === '/api/state') {
      return sendJson(res, 200, {
        model: config.llm.model,
        scene: campaign.scene,
        party: campaign.party,
        location: world.campaign.partyLocation,
        locationName: currentLocation(world)?.name ?? null,
        history: session.messages.filter((m) => m.role === 'user' || m.role === 'assistant').length,
        started: Boolean(world.campaign.started),
        adventure: world.campaign.adventure ?? null,
        bond: world.campaign.bond ?? null,
        day: world.campaign.day,
        session: {
          id: store.id,
          startedAt: store.current.startedAt,
          turns: session.messages.filter((m) => m.role === 'user').length,
        },
        sessionCount: store.list().length,
        tts: Boolean(config.tts?.enabled),
        voiceCount: (await availableVoices()).length,
      })
    }

    // Diagnostic: exercises synthesis + HTTP + playback without a game turn,
    // so "I hear nothing" can be localised to one of the three.
    if (req.method === 'POST' && path === '/api/tts-test') {
      try {
        const voice = defaultVoiceFor(config)
        const out = await synthesize('Sound check. The Dungeon Master is audible.', voice, config, TTS_DIR)
        return sendJson(res, 200, {
          url: `/audio/${out.id}`,
          voice,
          provider: config.tts?.provider ?? 'say',
        })
      } catch (error) {
        return sendJson(res, 500, { error: error.message })
      }
    }
    // ---- onboarding -------------------------------------------------------

    if (req.method === 'GET' && path === '/api/setup') {
      return sendJson(res, 200, {
        started: Boolean(world.campaign.started),
        classes: Object.entries(CLASS_KITS).map(([name, kit]) => ({
          name,
          hitDie: kit.hitDie,
          ac: kit.ac,
          blurb: kit.blurb,
          abilities: kit.abilities,
        })),
        adventures: Object.values(ADVENTURES),
        bonds: Object.values(BONDS),
      })
    }

    if (req.method === 'POST' && path === '/api/setup') {
      const body = await readJson(req)

      const adventure = adventureFor(body.adventure)
      if (!adventure) return sendJson(res, 400, { error: 'Choose an adventure to begin' })

      const bond = bondFor(body.bond)
      if (!bond) return sendJson(res, 400, { error: 'Choose how the party met' })

      const requested = Array.isArray(body.characters) ? body.characters : []
      if (!requested.length) return sendJson(res, 400, { error: 'Create at least one character' })
      if (requested.length > 4) return sendJson(res, 400, { error: 'The box supports up to four characters' })

      const party = []
      for (const raw of requested) {
        const name = String(raw?.name ?? '').trim()
        if (!name) return sendJson(res, 400, { error: 'Every character needs a name' })
        if (!CLASS_KITS[raw?.charClass]) {
          return sendJson(res, 400, { error: `Unknown class "${raw?.charClass}"` })
        }
        party.push(
          makeCharacter({
            name,
            player: raw.player,
            charClass: raw.charClass,
            species: raw.species,
            background: raw.background,
          }),
        )
      }

      // Party
      campaign.party = party
      campaign.scene = adventure.scene

      // World
      world.campaign.started = true
      world.campaign.adventure = adventure.id
      world.campaign.bond = bond.id
      world.campaign.act = adventure.act
      world.campaign.partyLocation = adventure.locationId
      world.campaign.day = 1
      world.campaign.timeOfDay = 'morning'
      world.campaign.partySize = party.length
      world.campaign.discoveries = [bond.note]
      world.campaign.sessionLog = []
      world.campaign.flags = {
        ...world.campaign.flags,
        metHaldryck: false,
        metBarthoOrGala: false,
        metWinvarle: false,
        pralDefeated: false,
        ironTomeFound: false,
        cultRevealed: false,
        chaosBellDestroyed: false,
      }

      const start = locationById(world, adventure.locationId)
      if (start) start.status = 'visited'

      // Opening quest depends on where they begin.
      for (const q of world.quests.quests) {
        if (q.id === 'reach-the-keep') {
          q.status = adventure.id === 'wilderness' ? 'active' : 'complete'
        } else if (['report-to-winvarle', 'bandits-on-the-trail', 'clear-the-caves'].includes(q.id)) {
          q.status = adventure.id === 'wilderness' ? 'offered' : 'active'
        } else {
          q.status = 'hidden'
        }
      }
      for (const npc of world.npcs.npcs) npc.met = false

      // A new campaign starts a new transcript, and archives anything left over.
      if (session.messages.length) await store.end({ reason: 'new campaign' }).catch(() => {})
      session.messages = store.messages
      session.startedAt = new Date().toISOString()

      await saveCampaign(CAMPAIGN_PATH, campaign)
      await saveCampaignState(CAMPAIGN_DIR, world.campaign)
      await saveLocations(CAMPAIGN_DIR, world.locations)
      await saveQuests(CAMPAIGN_DIR, world.quests)
      await saveNpcs(CAMPAIGN_DIR, world.npcs)

      return sendJson(res, 200, {
        ok: true,
        party: campaign.party,
        scene: campaign.scene,
        adventure: adventure.title,
        bond: bond.title,
      })
    }

    // ---- session history --------------------------------------------------

    if (req.method === 'GET' && path === '/api/sessions') {
      return sendJson(res, 200, {
        current: {
          id: store.id,
          startedAt: store.current.startedAt,
          turns: session.messages.filter((m) => m.role === 'user').length,
        },
        sessions: store.list(),
      })
    }

    if (req.method === 'GET' && path.startsWith('/api/sessions/')) {
      const id = path.slice('/api/sessions/'.length)
      const full = await store.load(id)
      if (!full) return sendJson(res, 404, { error: 'No such session' })
      return sendJson(res, 200, {
        id: full.id,
        startedAt: full.startedAt,
        endedAt: full.endedAt,
        recap: full.recap,
        meta: full.meta,
        transcript: (full.messages ?? [])
          .filter((m) => (m.role === 'user' || m.role === 'assistant') && String(m.content ?? '').trim())
          .map((m) => ({ role: m.role, text: String(m.content) })),
      })
    }

    if (req.method === 'POST' && path === '/api/session/end') {
      if (turnInFlight) return sendJson(res, 409, { error: 'A turn is still running' })
      const entry = await store.end({
        day: world.campaign.day,
        locationName: currentLocation(world)?.name ?? null,
      })
      session.messages = store.messages
      session.startedAt = new Date().toISOString()
      return sendJson(res, 200, { ok: true, archived: entry })
    }
    // The live transcript, so a reload can rebuild the conversation.
    if (req.method === 'GET' && path === '/api/transcript') {
      return sendJson(res, 200, {
        id: store.id,
        startedAt: store.current.startedAt,
        messages: session.messages
          .filter((m) => (m.role === 'user' || m.role === 'assistant') && String(m.content ?? '').trim())
          .map((m) => ({ role: m.role, text: String(m.content) })),
      })
    }


    if (req.method === 'GET' && path === '/api/party') {
      return sendJson(res, 200, { party: campaign.party, scene: campaign.scene })
    }

    if (req.method === 'POST' && path === '/api/party') {
      const body = await readJson(req)
      if (!Array.isArray(body.party)) {
        return sendJson(res, 400, { error: 'party must be an array of characters' })
      }

      const cleaned = []
      for (const raw of body.party) {
        if (!raw || typeof raw !== 'object') continue
        const name = String(raw.name ?? '').trim()
        if (!name) return sendJson(res, 400, { error: 'Every character needs a name' })

        const num = (value, fallback) => {
          const n = Number(value)
          return Number.isFinite(n) ? n : fallback
        }
        const list = (value) =>
          Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : []

        cleaned.push({
          ...raw,
          name,
          level: Math.max(1, num(raw.level, 1)),
          hp: Math.max(0, num(raw.hp, 1)),
          maxHp: Math.max(1, num(raw.maxHp, 1)),
          ac: num(raw.ac, 10),
          speed: num(raw.speed, 30),
          gold: num(raw.gold, 0),
          proficiencyBonus: num(raw.proficiencyBonus, 2),
          conditions: list(raw.conditions),
          skills: list(raw.skills),
          saves: list(raw.saves),
          equipment: Array.isArray(raw.equipment) ? raw.equipment : [],
        })
      }

      if (!cleaned.length) return sendJson(res, 400, { error: 'Party cannot be empty' })

      campaign.party = cleaned
      if (typeof body.scene === 'string') campaign.scene = body.scene
      session.campaign = campaign
      await saveCampaign(CAMPAIGN_PATH, campaign)
      return sendJson(res, 200, { ok: true, party: campaign.party })
    }

    if (req.method === 'POST' && path === '/api/stt') return await handleStt(req, res)
    if (req.method === 'POST' && path === '/api/turn') return await handleTurn(req, res)

    if (req.method === 'POST' && path === '/api/reset') {
      const body = await readJson(req)

      if (body.full) {
        // Start a brand new campaign: archive the transcript, clear progress,
        // and send the operator back through onboarding.
        if (session.messages.length) await store.end({ reason: 'campaign reset' }).catch(() => {})
        session.messages = store.messages
        session.startedAt = new Date().toISOString()

        world.campaign.started = false
        world.campaign.adventure = null
        world.campaign.bond = null
        world.campaign.act = 'wilderness'
        world.campaign.partyLocation = 'wild-trail'
        world.campaign.day = 1
        world.campaign.timeOfDay = 'morning'
        world.campaign.discoveries = []
        world.campaign.sessionLog = []
        for (const loc of world.locations.locations) loc.status = 'unvisited'
        for (const npc of world.npcs.npcs) npc.met = false
        for (const q of world.quests.quests) {
          q.status = q.id === 'reach-the-keep' ? 'active' : q.id === 'clear-the-caves' ? 'hidden' : 'offered'
        }

        campaign = await loadJsonFile(CAMPAIGN_PATH, 'campaign/party.json')
        session.campaign = campaign

        await saveCampaignState(CAMPAIGN_DIR, world.campaign)
        await saveLocations(CAMPAIGN_DIR, world.locations)
        await saveQuests(CAMPAIGN_DIR, world.quests)
        await saveNpcs(CAMPAIGN_DIR, world.npcs)
        return sendJson(res, 200, { ok: true, restarted: true })
      }

      // Plain reset: clear the transcript, keep the campaign.
      session.messages = []
      await store.save(session.messages, { reason: 'reset' }).catch(() => {})
      campaign = await loadJsonFile(CAMPAIGN_PATH, 'campaign/party.json')
      session.campaign = campaign
      return sendJson(res, 200, { ok: true, party: campaign.party })
    }

    if (req.method === 'POST' && path === '/api/scene') {
      const body = await readJson(req)
      campaign.scene = String(body.scene ?? '')
      await saveCampaign(CAMPAIGN_PATH, campaign)
      session.messages.push({ role: 'user', content: `[Scene change] ${campaign.scene}` })
      return sendJson(res, 200, { ok: true, scene: campaign.scene })
    }

    if (req.method === 'GET' && path.startsWith('/audio/')) {
      return await serveAudio(res, path.slice('/audio/'.length))
    }

    if (req.method === 'GET') return await serveStatic(res, path === '/' ? 'index.html' : path)

    res.writeHead(404).end('Not found')
  } catch (error) {
    if (!res.writableEnded) sendJson(res, error.statusCode ?? 500, { error: error.message })
  }
})

function lanAddress() {
  for (const iface of Object.values(networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address
    }
  }
  return 'localhost'
}

const { port } = config
const ttsProvider = (config.tts?.provider ?? 'say') === 'kokoro' ? 'kokoro' : 'say'
// Only the system voices are known synchronously. Kokoro is warmed after we
// start listening, so a 92MB first-run download never blocks the UI.
const voiceCount = ttsProvider === 'say' ? (await availableVoices()).length : 0
const whisperModel = config.stt.model.replace(/^~/, process.env.HOME ?? '~')

let listener = server
if (useHttps) {
  const keyPath = join(ROOT, 'certs', 'key.pem')
  const certPath = join(ROOT, 'certs', 'cert.pem')
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    console.error('Missing certs/. Run: npm run https   (it generates them first)')
    process.exit(1)
  }
  listener = https.createServer(
    { key: await readFile(keyPath), cert: await readFile(certPath) },
    server.listeners('request')[0],
  )
}

// Fire-and-forget: never block the listener on a model load.
warmTts(config).then((info) => {
  if (info.error) console.error(`  voice    *** ${info.error}`)
  else if (info.provider === 'kokoro') {
    console.log(`  voice    Kokoro ready - ${info.voices} neural voices`)
  }
})

const scheme = useHttps ? 'https' : 'http'
listener.listen(port, '0.0.0.0', () => {
  console.log('')
  console.log('  FABLE ENGINE - AI Dungeon Master')
  console.log('  --------------------------------')
  console.log(`  model    ${config.llm.model}`)
  console.log(
    ttsProvider === 'kokoro'
      ? '  voice    Kokoro, local neural (warming up)'
      : `  voice    macOS say, ${voiceCount} English voices`,
  )
  console.log(`  whisper  ${whisperModel}${existsSync(whisperModel) ? '' : '   *** NOT FOUND ***'}`)
  console.log('')
  console.log(`  this Mac   ${scheme}://localhost:${port}`)
  console.log(`  LAN        ${scheme}://${lanAddress()}:${port}`)
  if (!useHttps) {
    console.log('')
    console.log('  Note: the microphone needs a secure context. `localhost` works;')
    console.log('  a phone on your LAN must use `npm run https`.')
  }
  console.log('')
})
