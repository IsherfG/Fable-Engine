/**
 * Session history.
 *
 * A *campaign* is long (many evenings). A *session* is one sitting.
 *
 * `current.json` is the live transcript. It is restored on boot, so restarting
 * the server no longer loses the conversation. Ending a session archives the
 * transcript plus a short recap and starts a fresh one, while the campaign
 * state (party, location, quests, day) carries on untouched.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJson(path, data) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export class SessionStore {
  constructor(dir) {
    this.dir = dir
    this.indexPath = join(dir, 'index.json')
    this.currentPath = join(dir, 'current.json')
    this.index = { version: 1, sessions: [] }
    this.current = null
  }

  async init() {
    await mkdir(this.dir, { recursive: true })

    this.index = await readJson(this.indexPath, { version: 1, sessions: [] })
    if (!Array.isArray(this.index.sessions)) this.index.sessions = []

    this.current = await readJson(this.currentPath, null)
    if (!this.current || !Array.isArray(this.current.messages)) {
      this.current = this.fresh()
      await writeJson(this.currentPath, this.current)
    }
    return this
  }

  fresh() {
    const now = new Date().toISOString()
    return { id: randomUUID(), startedAt: now, updatedAt: now, messages: [], meta: {} }
  }

  /** Live transcript, restored from disk on boot. */
  get messages() {
    return this.current.messages
  }

  get id() {
    return this.current.id
  }

  /** Called after every turn. Cheap: one small JSON write. */
  async save(messages, meta = {}) {
    this.current.messages = messages
    this.current.updatedAt = new Date().toISOString()
    this.current.meta = { ...this.current.meta, ...meta }
    await writeJson(this.currentPath, this.current)
  }

  /**
   * Archive the current session and open a new one.
   * Returns the index entry that was written.
   */
  async end(meta = {}) {
    const messages = this.current.messages ?? []
    const entry = {
      id: this.current.id,
      startedAt: this.current.startedAt,
      endedAt: new Date().toISOString(),
      turns: messages.filter((m) => m.role === 'user').length,
      recap: this.recap(this.current),
      meta: { ...this.current.meta, ...meta },
    }

    await writeJson(join(this.dir, `${entry.id}.json`), {
      ...this.current,
      endedAt: entry.endedAt,
      recap: entry.recap,
      meta: entry.meta,
    })

    this.index.sessions.unshift(entry)
    this.index.sessions = this.index.sessions.slice(0, 100)
    await writeJson(this.indexPath, this.index)

    this.current = this.fresh()
    await writeJson(this.currentPath, this.current)
    return entry
  }

  list() {
    return this.index.sessions
  }

  load(id) {
    if (!/^[a-zA-Z0-9-]+$/.test(String(id))) return Promise.resolve(null)
    return readJson(join(this.dir, `${id}.json`), null)
  }

  /** A deterministic recap: no extra model call, still enough to jog memory. */
  recap(session) {
    const spoken = (session.messages ?? [])
      .filter((m) => m.role === 'user' && typeof m.content === 'string')
      .map((m) => m.content.trim())
      .filter(Boolean)
    if (!spoken.length) return 'Opening session — no turns played.'
    const tail = spoken.slice(-2).join(' … ')
    return tail.length > 170 ? `${tail.slice(0, 167)}…` : tail
  }
}
