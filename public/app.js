/**
 * Fable Engine client.
 *
 * Flow: hold to talk -> MediaRecorder -> POST /api/stt -> transcript ->
 * POST /api/turn (SSE) -> render text + dice, queue server-synthesized speech.
 */
import { openSetup } from './setup.js'


const $ = (id) => document.getElementById(id)

const els = {
  transcript: $('transcript'),
  welcome: $('welcome'),
  party: $('party'),
  dice: $('dice'),
  scene: $('scene'),
  status: $('status'),
  talk: $('talk'),
  talkLabel: $('talk-label'),
  typeForm: $('type-form'),
  typeInput: $('type-input'),
  begin: $('begin'),
  reset: $('reset'),
  mute: $('mute'),
  model: $('model'),
  editScene: $('edit-scene'),
  player: $('player'),
  test: $('test'),
  editParty: $('edit-party'),
  partyModal: $('party-modal'),
  partyForm: $('party-form'),
  partySave: $('party-save'),
  partyCancel: $('party-cancel'),
  partyStatus: $('party-status'),
  history: $('history'),
  historyDrawer: $('history-drawer'),
  historyClose: $('history-close'),
  historyCurrent: $('history-current'),
  historyList: $('history-list'),
  historyDetail: $('history-detail'),
  endSession: $('end-session'),
}

const state = {
  busy: false,
  recording: false,
  stream: null,
  recorder: null,
  chunks: [],
  startedAt: 0,
  muted: false,
  dmTurn: null,
  dmText: '',
}

/* ------------------------------------------------------------------ utils */

function setStatus(text, isError = false) {
  els.status.textContent = text
  els.status.classList.toggle('err', isError)
}

/**
 * A live elapsed counter. The model can take seconds to produce its first
 * token, and a static "thinking" label is indistinguishable from a hung page.
 */
let busyTimer = null

function startBusyTimer() {
  stopBusyTimer()
  const startedAt = Date.now()
  const tick = () => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000)
    setStatus(`The Dungeon Master is thinking… ${seconds}s`)
  }
  tick()
  busyTimer = setInterval(tick, 500)
}

function stopBusyTimer() {
  if (busyTimer !== null) {
    clearInterval(busyTimer)
    busyTimer = null
  }
}

function setTalk(state_, label) {
  els.talk.dataset.state = state_
  els.talkLabel.textContent = label
}

/**
 * Render [Speaker] tags as chips by building DOM nodes, never by parsing model
 * output as HTML. Text nodes stay inert, so nothing the model writes can turn
 * into markup.
 */
function decorateInto(target, text) {
  target.replaceChildren()
  for (const part of text.split(/(\[[^\]]{1,40}\])/)) {
    if (!part) continue
    if (/^\[[^\]]{1,40}\]$/.test(part)) {
      const chip = document.createElement('span')
      chip.className = 'spk'
      chip.textContent = part
      target.append(chip)
    } else {
      target.append(document.createTextNode(part))
    }
  }
}

function scrollDown() {
  els.transcript.scrollTop = els.transcript.scrollHeight
}

function addTurn(kind, who) {
  const wrap = document.createElement('div')
  wrap.className = `turn ${kind}`
  const label = document.createElement('div')
  label.className = 'turn-who'
  label.textContent = who
  const body = document.createElement('div')
  body.className = 'turn-body'
  wrap.append(label, body)
  els.transcript.append(wrap)
  scrollDown()
  return body
}

/* ---------------------------------------------------------------- party UI */

/** Hit-point bar colour tier. */
function hpClass(pct) {
  if (pct <= 25) return 'bad'
  if (pct <= 60) return 'hurt'
  return ''
}

function renderParty(party) {
  els.party.replaceChildren()

  if (!party?.length) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent = 'No characters in campaign/party.json'
    els.party.append(empty)
    return
  }

  for (const pc of party) {
    const ratio = Number(pc.hp) / Math.max(1, Number(pc.maxHp))
    const pct = Math.max(0, Math.min(100, ratio * 100))
    const cls = hpClass(pct)

    const el = document.createElement('div')
    el.className = 'pc'

    const top = document.createElement('div')
    top.className = 'pc-top'
    const name = document.createElement('span')
    name.className = 'pc-name'
    name.textContent = String(pc.name ?? '')
    const meta = document.createElement('span')
    meta.className = 'pc-meta'
    meta.textContent = `${pc.class ?? ''} ${pc.level ?? ''} · AC ${pc.ac ?? '?'}`
    top.append(name, meta)

    const hp = document.createElement('div')
    hp.className = 'pc-hp'
    const track = document.createElement('div')
    track.className = 'hp-track'
    const fill = document.createElement('div')
    fill.className = `hp-fill ${cls}`.trim()
    fill.style.width = `${pct}%`
    track.append(fill)
    const val = document.createElement('span')
    val.className = 'hp-val'
    val.textContent = `${pc.hp}/${pc.maxHp}`
    hp.append(track, val)

    el.append(top, hp)

    for (const condition of pc.conditions ?? []) {
      const chip = document.createElement('span')
      chip.className = 'cond'
      chip.textContent = String(condition)
      el.append(chip)
    }

    els.party.append(el)
  }
}

function addRoll(roll) {
  const el = document.createElement('div')
  el.className = 'roll'
  if (roll.natural20) el.classList.add('crit')
  else if (roll.natural1) el.classList.add('fumble')
  el.title = roll.reason ?? ''

  const expr = document.createElement('span')
  expr.className = 'roll-expr'
  expr.textContent = String(roll.expression ?? '')

  const total = document.createElement('span')
  total.className = 'roll-total'
  total.textContent = String(roll.total ?? '')

  el.append(expr, total)
  els.dice.prepend(el)
}

/* -------------------------------------------------------------- audio queue */

const queue = []
let playing = false
let currentResolve = null

// WebKit - and iOS especially - only let audio start from a user gesture. The
// DM's reply arrives many seconds later, long after that gesture has expired,
// so unlock the element once on the first interaction and reuse it afterwards.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='
let audioUnlocked = false

function unlockAudio() {
  if (audioUnlocked || playing) return
  els.player.muted = true
  els.player.src = SILENT_WAV
  const started = els.player.play()
  const settle = () => {
    els.player.pause()
    els.player.currentTime = 0
    els.player.muted = false
    audioUnlocked = true
  }
  if (started?.then) started.then(settle).catch(settle)
  else settle()
}

document.addEventListener('pointerdown', unlockAudio)
document.addEventListener('keydown', unlockAudio)

function stopSpeaking() {
  queue.length = 0
  try {
    els.player.pause()
    els.player.currentTime = 0
  } catch {
    /* no-op */
  }
  if (currentResolve) {
    const resolve = currentResolve
    currentResolve = null
    resolve()
  }
}

function playClip(url) {
  return new Promise((resolve) => {
    currentResolve = resolve
    els.player.src = url

    const finish = () => {
      currentResolve = null
      resolve()
    }

    els.player.onended = finish
    els.player.onerror = () => {
      // Silence is the worst possible failure mode: say what went wrong.
      const code = els.player.error?.code ?? '?'
      setStatus(`Audio could not be loaded (media error ${code}).`, true)
      finish()
    }

    const started = els.player.play()
    if (started?.catch) {
      started.catch((error) => {
        if (error?.name === 'NotAllowedError') {
          setStatus('The browser blocked audio. Click anywhere on the page, then try again.', true)
        } else {
          setStatus(`Audio playback failed: ${error?.name || error}`, true)
        }
        finish()
      })
    }
  })
}

async function pumpQueue() {
  if (playing) return
  playing = true
  while (queue.length) {
    const item = queue.shift()
    if (!state.muted && item.url) await playClip(item.url)
  }
  playing = false
  if (!state.busy) setTalk('idle', 'Hold to talk')
}

function enqueueSpeech(ev) {
  if (!ev.url) return
  queue.push(ev)
  pumpQueue()
}

/* ------------------------------------------------------------------- mic */

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

function pickMime() {
  if (!window.MediaRecorder) return ''
  for (const type of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported?.(type)) return type
  }
  return ''
}

async function ensureMic() {
  if (state.stream) return state.stream
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser has no microphone API. Serve over https:// or use localhost.')
  }
  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  return state.stream
}

async function startRecording() {
  if (state.recording || state.busy) return

  // Talking over the DM should cut it off.
  stopSpeaking()

  try {
    const stream = await ensureMic()
    const mimeType = pickMime()
    state.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    state.chunks = []
    state.recorder.ondataavailable = (e) => {
      if (e.data?.size) state.chunks.push(e.data)
    }
    state.recorder.start()
    state.recording = true
    state.startedAt = Date.now()
    setTalk('recording', 'Listening')
    setStatus('Listening… release to send.')
  } catch (error) {
    setStatus(error.message, true)
    setTalk('idle', 'Hold to talk')
  }
}

async function stopRecording() {
  if (!state.recording || !state.recorder) return
  const recorder = state.recorder
  state.recording = false

  const finished = new Promise((resolve) => {
    recorder.onstop = resolve
  })
  recorder.stop()
  await finished

  const held = Date.now() - state.startedAt
  const blob = new Blob(state.chunks, { type: recorder.mimeType || 'audio/webm' })
  state.recorder = null
  state.chunks = []

  if (held < 350 || blob.size < 1200) {
    setTalk('idle', 'Hold to talk')
    setStatus('Too short — hold the button while you speak.')
    return
  }

  setStatus('Transcribing…')
  try {
    const res = await fetch('/api/stt', {
      method: 'POST',
      headers: { 'Content-Type': blob.type },
      body: blob,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Transcription failed')
    const text = (data.text ?? '').trim()
    if (!text) {
      setStatus("Didn't catch that — try again.")
      setTalk('idle', 'Hold to talk')
      return
    }
    await sendTurn(text)
  } catch (error) {
    setStatus(error.message, true)
    setTalk('idle', 'Hold to talk')
  }
}

/* ------------------------------------------------------------------- turn */

async function sendTurn(message) {
  if (state.busy) return
  state.busy = true
  state.dmTurn = null
  state.dmText = ''
  setTalk('thinking', 'Thinking')
  startBusyTimer()

  if (message) {
    // Echo what the player actually said - voice transcript or typed text.
    addTurn('you', 'You').textContent = message
  }

  try {
    const res = await fetch('/api/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, tts: !state.muted }),
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.error || `Server returned ${res.status}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let split
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, split)
        buffer = buffer.slice(split + 2)
        const line = frame.split('\n').find((l) => l.startsWith('data: '))
        if (!line) continue
        try {
          handleEvent(JSON.parse(line.slice(6)))
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  } catch (error) {
    addTurn('error', 'Error').textContent = error.message
    setStatus(error.message, true)
  } finally {
    state.busy = false
    stopBusyTimer()
    if (state.dmTurn) state.dmTurn.classList.remove('cursor')
    if (!playing && queue.length === 0) setTalk('idle', 'Hold to talk')
    else setTalk('thinking', 'Speaking')
    scrollDown()
  }
}

function handleEvent(ev) {
  switch (ev.type) {
    case 'text': {
      if (!state.dmTurn) {
        state.dmTurn = addTurn('dm', 'Dungeon Master')
        state.dmTurn.classList.add('cursor')
      }
      stopBusyTimer()
      state.dmText += ev.delta
      decorateInto(state.dmTurn, state.dmText)
      scrollDown()
      break
    }
    case 'speech':
      enqueueSpeech(ev)
      if (ev.url) setStatus(`Speaking as ${ev.speaker} (${ev.voice})…`)
      break
    case 'roll':
      addRoll(ev)
      break
    case 'party':
      renderParty(ev.party)
      break
    case 'warning':
      setStatus(ev.message)
      break
    case 'error':
      addTurn('error', 'Error').textContent = ev.message
      stopBusyTimer()
      setStatus(ev.message, true)
      break
    case 'done':
      stopBusyTimer()
      setStatus(`Ready. ${ev.usage ? `${ev.usage} tokens this turn.` : ''}`.trim())
      break
    default:
      break
  }
}

/* -------------------------------------------------------- character editor */

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha']
let partyCollectors = []

function makeEl(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function fieldInput(value, type = 'text') {
  const input = document.createElement('input')
  input.type = type
  input.value = value ?? ''
  if (type === 'number') input.step = '1'
  return input
}

function fieldRow(label, input) {
  const wrap = makeEl('label', 'field')
  wrap.append(makeEl('span', 'field-label', label), input)
  return wrap
}

/** "Longsword x2" per line -> [{ name, qty, equipped }], keeping prior flags. */
function parseEquipment(text, previous) {
  const before = new Map((previous ?? []).map((e) => [String(e.name).toLowerCase(), e]))
  const out = []
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = trimmed.match(/^(.*?)(?:\s*[x×]\s*(\d+))?$/)
    const name = (match?.[1] ?? trimmed).trim()
    if (!name) continue
    const qty = match?.[2] ? Number(match[2]) : 1
    const prev = before.get(name.toLowerCase())
    out.push({ name, qty, equipped: prev ? prev.equipped !== false : true })
  }
  return out
}

function equipmentToText(pc) {
  return (pc.equipment ?? []).map((e) => ((e.qty ?? 1) > 1 ? `${e.name} x${e.qty}` : e.name)).join('\n')
}

function buildCharacterCard(pc, index) {
  const inputs = {}
  const add = (parent, key, label, value, type = 'text') => {
    const input = fieldInput(value, type)
    inputs[key] = input
    parent.append(fieldRow(label, input))
  }

  const card = makeEl('div', 'pc-card')
  card.append(makeEl('h3', null, pc.name || `Character ${index + 1}`))

  const basics = makeEl('div', 'field-grid')
  add(basics, 'name', 'Name', pc.name)
  add(basics, 'player', 'Player', pc.player)
  add(basics, 'class', 'Class', pc.class)
  add(basics, 'level', 'Level', pc.level, 'number')
  add(basics, 'species', 'Species', pc.species)
  add(basics, 'background', 'Background', pc.background)
  add(basics, 'ac', 'AC', pc.ac, 'number')
  add(basics, 'hp', 'HP', pc.hp, 'number')
  add(basics, 'maxHp', 'Max HP', pc.maxHp, 'number')
  add(basics, 'speed', 'Speed', pc.speed, 'number')
  add(basics, 'gold', 'Gold', pc.gold, 'number')
  card.append(basics)

  card.append(makeEl('div', 'field-label', 'Abilities'))
  const abilityInputs = {}
  const abilityGrid = makeEl('div', 'field-grid abilities')
  for (const key of ABILITY_KEYS) {
    const input = fieldInput(pc.abilities?.[key] ?? 10, 'number')
    abilityInputs[key] = input
    abilityGrid.append(fieldRow(key.toUpperCase(), input))
  }
  card.append(abilityGrid)

  const lists = makeEl('div', 'field-grid')
  add(lists, 'saves', 'Saves (comma)', (pc.saves ?? []).join(', '))
  add(lists, 'skills', 'Skills (comma)', (pc.skills ?? []).join(', '))
  add(lists, 'conditions', 'Conditions (comma)', (pc.conditions ?? []).join(', '))
  card.append(lists)

  const equip = document.createElement('textarea')
  equip.rows = 4
  equip.value = equipmentToText(pc)
  card.append(fieldRow('Equipment (one per line, "Name x2")', equip))

  const notes = document.createElement('textarea')
  notes.rows = 2
  notes.value = pc.notes ?? ''
  card.append(fieldRow('Notes', notes))

  const collect = () => {
    const commaList = (value) =>
      String(value)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    return {
      ...pc,
      name: inputs.name.value.trim(),
      player: inputs.player.value.trim(),
      class: inputs.class.value.trim(),
      level: Number(inputs.level.value) || 1,
      species: inputs.species.value.trim(),
      background: inputs.background.value.trim(),
      ac: Number(inputs.ac.value) || 10,
      hp: Number(inputs.hp.value) || 0,
      maxHp: Number(inputs.maxHp.value) || 1,
      speed: Number(inputs.speed.value) || 30,
      gold: Number(inputs.gold.value) || 0,
      abilities: Object.fromEntries(
        ABILITY_KEYS.map((k) => [k, Number(abilityInputs[k].value) || 10]),
      ),
      saves: commaList(inputs.saves.value).map((s) => s.toLowerCase()),
      skills: commaList(inputs.skills.value),
      conditions: commaList(inputs.conditions.value).map((s) => s.toLowerCase()),
      equipment: parseEquipment(equip.value, pc.equipment),
      notes: notes.value.trim(),
    }
  }

  return { card, collect }
}

async function openPartyEditor() {
  partyCollectors = []
  els.partyStatus.textContent = ''
  els.partyForm.replaceChildren()
  try {
    const res = await fetch('/api/party')
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    data.party.forEach((pc, index) => {
      const { card, collect } = buildCharacterCard(pc, index)
      partyCollectors.push(collect)
      els.partyForm.append(card)
    })
    els.partyModal.classList.remove('hidden')
  } catch (error) {
    setStatus(`Could not load characters: ${error.message}`, true)
  }
}

async function savePartyEditor() {
  if (!partyCollectors.length) return
  els.partyStatus.textContent = 'Saving…'
  try {
    const party = partyCollectors.map((collect) => collect())
    const res = await fetch('/api/party', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ party }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    renderParty(data.party)
    els.partyModal.classList.add('hidden')
    setStatus('Characters saved. The Dungeon Master will use them next turn.')
  } catch (error) {
    els.partyStatus.textContent = error.message
  }
}

els.editParty.addEventListener('click', openPartyEditor)
els.partySave.addEventListener('click', savePartyEditor)
els.partyCancel.addEventListener('click', () => els.partyModal.classList.add('hidden'))
els.partyModal.addEventListener('click', (event) => {
  if (event.target === els.partyModal) els.partyModal.classList.add('hidden')
})

/* --------------------------------------------------------- session history */

function formatWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

async function openHistory() {
  els.historyDrawer.classList.remove('hidden')
  els.historyDetail.classList.add('hidden')
  els.historyDetail.replaceChildren()
  els.historyCurrent.replaceChildren()
  els.historyList.replaceChildren()

  try {
    const res = await fetch('/api/sessions')
    const data = await res.json()

    const current = makeEl('div', null)
    current.append(
      makeEl('strong', null, `Session in progress`),
      makeEl('span', null, `${data.current.turns} turn${data.current.turns === 1 ? '' : 's'} · started ${formatWhen(data.current.startedAt)}`),
    )
    els.historyCurrent.append(current)

    if (!data.sessions.length) {
      els.historyList.append(makeEl('p', 'empty', 'No finished sessions yet. End one and it will be archived here, with a recap.'))
      return
    }

    for (const entry of data.sessions) {
      const btn = makeEl('button', 'history-item')
      btn.type = 'button'
      btn.append(
        makeEl('strong', null, formatWhen(entry.startedAt) || 'Session'),
        makeEl('span', null, `${entry.turns} turn${entry.turns === 1 ? '' : 's'}${entry.meta?.locationName ? ` · ${entry.meta.locationName}` : ''}`),
        makeEl('p', null, entry.recap ?? ''),
      )
      btn.addEventListener('click', () => showHistoryEntry(entry.id))
      els.historyList.append(btn)
    }
  } catch (error) {
    els.historyList.append(makeEl('p', 'empty', `Could not load sessions: ${error.message}`))
  }
}

async function showHistoryEntry(id) {
  els.historyDetail.replaceChildren()
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)

    els.historyDetail.append(
      makeEl('div', 'field-label', `${formatWhen(data.startedAt)} — ${data.transcript.length} messages`),
    )
    for (const message of data.transcript.slice(-40)) {
      const line = makeEl('div', 'history-line')
      line.append(
        makeEl('b', null, message.role === 'user' ? 'You' : 'DM'),
        document.createTextNode(String(message.text).replace(/\[[^\]]{1,40}\]\s*/g, '')),
      )
      els.historyDetail.append(line)
    }
    els.historyDetail.classList.remove('hidden')
  } catch (error) {
    els.historyDetail.append(makeEl('p', 'empty', error.message))
    els.historyDetail.classList.remove('hidden')
  }
}

async function endSession() {
  if (!window.confirm('End this session? The transcript is saved to history and a new one starts. Your party, gear and progress carry over.')) {
    return
  }
  try {
    const res = await fetch('/api/session/end', { method: 'POST' })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    els.transcript.replaceChildren()
    els.dice.replaceChildren()
    els.historyDrawer.classList.add('hidden')
    els.welcome.classList.remove('hidden')
    setStatus('Session archived. Your campaign carries on where you left it.')
    await beginSession()
  } catch (error) {
    setStatus(error.message, true)
  }
}

els.history.addEventListener('click', openHistory)
els.historyClose.addEventListener('click', () => els.historyDrawer.classList.add('hidden'))
els.endSession.addEventListener('click', endSession)

/* ------------------------------------------------------------------- boot */

async function loadState() {
  const res = await fetch('/api/state')
  const data = await res.json()
  els.model.textContent = data.model
  renderParty(data.party)
  els.scene.textContent = data.scene || '—'
  return data
}

/** Rebuild the transcript from the server, so a reload continues the session. */
async function restoreTranscript() {
  try {
    const res = await fetch('/api/transcript')
    const data = await res.json()
    if (!res.ok || !data.messages?.length) return false
    els.transcript.replaceChildren()
    state.dmTurn = null
    for (const message of data.messages) {
      if (!message.text) continue
      if (message.role === 'user') {
        addTurn('you', 'You').textContent = message.text
      } else {
        // Strip speaker tags for display, keep the prose.
        addTurn('dm', 'Dungeon Master').textContent = message.text.replace(/\[[^\]]{1,40}\]\s*/g, '')
      }
    }
    if (data.startedAt) {
      const when = new Date(data.startedAt)
      const stamp = addTurn('system', 'Session')
      stamp.textContent = `Resumed — started ${when.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}.`
    }
    scrollDown()
    return true
  } catch {
    return false
  }
}

async function openScene() {
  els.welcome.classList.add('hidden')
  await sendTurn('')
}

/** Called once the campaign exists — either fresh from setup or resumed. */
async function beginSession({ fresh = false } = {}) {
  const data = await loadState()
  els.talk.disabled = false
  if (fresh) {
    els.transcript.replaceChildren()
    els.dice.replaceChildren()
    els.welcome.classList.add('hidden')
    const opener = addTurn('system', 'The table is set')
    opener.textContent = `${data.party.map((p) => p.name).join(' and ')} — ${data.locationName ?? 'the Borderlands'}.`
    await sendTurn('')
    return
  }
  if (data.history > 0) {
    els.welcome.classList.add('hidden')
    await restoreTranscript()
  }
}

els.talk.addEventListener('pointerdown', (event) => {
  event.preventDefault()
  els.talk.setPointerCapture?.(event.pointerId)
  startRecording()
})
els.talk.addEventListener('pointerup', (event) => {
  event.preventDefault()
  stopRecording()
})
els.talk.addEventListener('pointercancel', () => stopRecording())
els.talk.addEventListener('lostpointercapture', () => {
  if (state.recording) stopRecording()
})

document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.repeat) return
  if (document.activeElement === els.typeInput) return
  event.preventDefault()
  startRecording()
})
document.addEventListener('keyup', (event) => {
  if (event.code !== 'Space') return
  if (document.activeElement === els.typeInput) return
  event.preventDefault()
  stopRecording()
})

els.typeForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const text = els.typeInput.value.trim()
  if (!text) return
  els.typeInput.value = ''
  els.welcome.classList.add('hidden')
  sendTurn(text)
})

els.begin.addEventListener('click', openScene)

els.reset.addEventListener('click', async () => {
  const ok = window.confirm(
    'Start a brand new campaign? This clears the party, progress and quests, and returns you to character creation. Finished sessions stay in history.',
  )
  if (!ok) return
  stopSpeaking()
  try {
    const res = await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full: true }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    els.transcript.replaceChildren()
    els.dice.replaceChildren()
    els.historyDrawer.classList.add('hidden')
    await loadState()
    await openSetup({ onComplete: () => beginSession({ fresh: true }) })
  } catch (error) {
    setStatus(error.message, true)
  }
})

els.mute.addEventListener('click', () => {
  state.muted = !state.muted
  els.mute.setAttribute('aria-pressed', String(state.muted))
  els.mute.textContent = state.muted ? '🔇 voice off' : '🔊 voice on'
  if (state.muted) stopSpeaking()
  setStatus(state.muted ? 'Voice muted. Text still streams.' : 'Voice on.')
})

els.test.addEventListener('click', async () => {
  setStatus('Sound check…')
  try {
    const res = await fetch('/api/tts-test', { method: 'POST' })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    stopSpeaking()
    els.player.muted = false
    els.player.src = data.url
    await els.player.play()
    setStatus(`Sound check playing — ${data.provider}, ${data.voice}.`)
  } catch (error) {
    setStatus(
      error.name === 'NotAllowedError'
        ? 'Sound check blocked by the browser. Click on the page first, then press test.'
        : `Sound check failed: ${error.message}`,
      true,
    )
  }
})

els.editScene.addEventListener('click', async () => {
  const current = els.scene.textContent === '—' ? '' : els.scene.textContent
  const next = window.prompt('Describe the current scene:', current)
  if (next === null) return
  const res = await fetch('/api/scene', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scene: next }),
  })
  const data = await res.json()
  els.scene.textContent = data.scene || '—'
  setStatus('Scene updated.')
})

const initial = await loadState()
els.talk.disabled = false

if (!initial.started) {
  // First run: build a party and choose where the story opens.
  await openSetup({ onComplete: () => beginSession({ fresh: true }) })
} else {
  await beginSession()
}
