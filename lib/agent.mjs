/**
 * The turn loop: stream the DM's reply, roll dice in code when the model asks,
 * feed results back, and synthesize speech sentence by sentence so playback can
 * begin before generation has finished.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { streamChat } from './llm.mjs'
import { rollDice } from './dice.mjs'
import { buildSystemPrompt } from './prompt.mjs'
import { synthesize, createSentenceSplitter, pickVoiceFor, resolveVoicePool } from './tts.mjs'
import { worldBrief, locationById } from './campaign.mjs'

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'roll_dice',
      description:
        'Roll dice. Use this for EVERY roll - ability checks, attacks, saving throws, damage, initiative. ' +
        'Never invent a die result. Examples: "1d20+4", "2d20kh1+4" for advantage, ' +
        '"2d20kl1+4" for disadvantage, "2d6+3" for damage.',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'Dice expression, e.g. 1d20+4, 2d20kh1+5, 2d6+3, 4d6kh3',
          },
          reason: {
            type: 'string',
            description: 'What this roll is for, e.g. "Perception check for Mira"',
          },
        },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_character',
      description:
        'Change a character\'s hit points, conditions, or notes. Use this whenever damage, ' +
        'healing, or a condition occurs so the party panel stays accurate.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Character name' },
          hp_delta: { type: 'number', description: 'Negative for damage, positive for healing' },
          hp_set: { type: 'number', description: 'Set hit points to an exact value' },
          add_condition: { type: 'string', description: 'Condition to add, e.g. "prone", "poisoned"' },
          remove_condition: { type: 'string', description: 'Condition to remove' },
          notes: { type: 'string', description: 'Replace the character notes' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_rule',
      description:
        'Search the loaded rule reference for a term. Use when you are unsure of a rule instead of inventing one.',
      parameters: {
        type: 'object',
        properties: {
          term: { type: 'string', description: 'Rule or spell name, e.g. "grappled", "Fireball"' },
        },
        required: ['term'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_party',
      description:
        'Move the party to another location. Use whenever they actually travel or enter somewhere new. ' +
        'Only use ids that already appear in the location list you were given.',
      parameters: {
        type: 'object',
        properties: {
          locationId: { type: 'string', description: 'e.g. keep-gatehouse, cave-a' },
          travelNote: { type: 'string', description: 'Anything notable about the journey' },
        },
        required: ['locationId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_quest',
      description:
        'Change a quest status when the party hears of it, accepts it, completes it, or fails it.',
      parameters: {
        type: 'object',
        properties: {
          questId: { type: 'string' },
          status: { type: 'string', enum: ['hidden', 'offered', 'active', 'complete', 'failed'] },
          note: { type: 'string' },
        },
        required: ['questId', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'note',
      description:
        'Record a durable fact worth remembering later: a rumour, a promise, a death, an alliance, ' +
        'a door left open, a name. Use it liberally - this is the campaign memory.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rest',
      description:
        'The party rests. Long rests are ONLY possible inside the Keep. Anywhere else, deny it and ' +
        'offer a short rest instead.',
      parameters: {
        type: 'object',
        properties: { kind: { type: 'string', enum: ['short', 'long'] } },
        required: ['kind'],
      },
    },
  },
]

async function lookupRule(term, rulesDir) {
  if (!rulesDir || !existsSync(rulesDir)) {
    return 'No rule reference is loaded. Make a ruling and say that you are making one.'
  }
  const needle = String(term).toLowerCase()
  const files = (await readdir(rulesDir)).filter((f) => f.endsWith('.md') || f.endsWith('.txt'))
  const hits = []

  for (const file of files) {
    const text = await readFile(join(rulesDir, file), 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      if (hits.length >= 6) return
      if (line.toLowerCase().includes(needle)) {
        hits.push(`${file}: ${lines.slice(i, i + 6).join(' ').slice(0, 600)}`)
      }
    })
    if (hits.length >= 6) break
  }

  return hits.length ? hits.join('\n---\n') : `No entry found for "${term}". Make a ruling.`
}

function applyCharacterUpdate(args, campaign) {
  const target = (campaign.party || []).find(
    (c) => c.name.toLowerCase() === String(args.name || '').toLowerCase(),
  )
  if (!target) {
    return { ok: false, error: `No character named "${args.name}"`, party: campaign.party }
  }

  if (typeof args.hp_set === 'number') target.hp = Math.max(0, Math.trunc(args.hp_set))
  if (typeof args.hp_delta === 'number') {
    target.hp = Math.max(0, Math.min(target.maxHp, target.hp + Math.trunc(args.hp_delta)))
  }
  target.conditions ??= []
  if (args.add_condition) {
    const c = String(args.add_condition).toLowerCase()
    if (!target.conditions.includes(c)) target.conditions.push(c)
  }
  if (args.remove_condition) {
    const c = String(args.remove_condition).toLowerCase()
    target.conditions = target.conditions.filter((x) => x !== c)
  }
  if (typeof args.notes === 'string') target.notes = args.notes

  return { ok: true, character: target, party: campaign.party }
}

/**
 * Run one full player turn.
 *
 * @returns {AsyncGenerator<object>} events consumed by the server and forwarded
 *   to the browser over SSE:
 *   text | speech | roll | character | party | warning | done | error
 */
export async function* runTurn({ session, userText, config, apiKey, cacheDir, rulesDir, signal, world }) {
  const { campaign } = session

  if (userText) session.messages.push({ role: 'user', content: userText })

  const voicePool = await resolveVoicePool(config)
  const maxRounds = config.llm?.maxToolRounds ?? 6
  let speechSeq = 0
  let totalUsage = 0

  for (let round = 0; round < maxRounds; round += 1) {
    const messages = [
      { role: 'system', content: buildSystemPrompt(campaign, world ? worldBrief(world) : '') },
      ...session.messages,
    ]

    const splitter = createSentenceSplitter()
    let lastSpeaker = 'Narrator'
    let assistantText = ''
    let endEvent = null

    async function* speak(sentences) {
      for (const raw of sentences) {
        const tag = raw.match(/^\[([^\]]{1,40})\]\s*:?\s*/)
        let speaker = lastSpeaker
        let body = raw
        if (tag) {
          speaker = tag[1].trim()
          lastSpeaker = speaker
          body = raw.slice(tag[0].length).trim()
        }
        if (!body) continue

        if (!config.tts?.enabled) {
          yield { type: 'speech', seq: speechSeq++, speaker, text: body, voice: null, url: null }
          continue
        }
        try {
          const voice = pickVoiceFor(speaker, config, voicePool)
          const out = await synthesize(body, voice, config, cacheDir)
          yield {
            type: 'speech',
            seq: speechSeq++,
            speaker,
            voice,
            text: body,
            url: `/audio/${out.id}`,
          }
        } catch (error) {
          yield { type: 'warning', message: `TTS failed for "${body.slice(0, 40)}…": ${error.message}` }
        }
      }
    }

    for await (const event of streamChat({ messages, tools: TOOLS, llm: config.llm, apiKey, signal })) {
      if (event.type === 'text') {
        assistantText += event.delta
        yield { type: 'text', delta: event.delta }
        yield* speak(splitter.push(event.delta))
      } else if (event.type === 'end') {
        endEvent = event
      }
    }

    yield* speak(splitter.flush())
    if (endEvent?.usage?.total_tokens) totalUsage += endEvent.usage.total_tokens

    const toolCalls = endEvent?.toolCalls ?? []
    if (!toolCalls.length) {
      session.messages.push({ role: 'assistant', content: assistantText })
      yield { type: 'done', usage: totalUsage }
      return
    }

    // Record the assistant turn that requested the tools, then execute them.
    session.messages.push({
      role: 'assistant',
      content: assistantText || null,
      tool_calls: toolCalls,
    })

    for (const call of toolCalls) {
      const name = call.function?.name
      // Some models emit tool arguments as an already-parsed object rather than
      // a JSON string. Handle both, or the call silently degrades to {}.
      let args = {}
      const rawArgs = call.function?.arguments
      if (typeof rawArgs === 'object' && rawArgs !== null) {
        args = rawArgs
      } else if (typeof rawArgs === 'string' && rawArgs.trim()) {
        try {
          args = JSON.parse(rawArgs)
        } catch {
          args = {}
        }
      }

      let result
      try {
        if (name === 'roll_dice') {
          const roll = rollDice(args.expression, args.reason)
          yield { type: 'roll', ...roll }
          result = {
            expression: roll.expression,
            total: roll.total,
            detail: roll.detail,
            natural20: roll.natural20,
            natural1: roll.natural1,
          }
        } else if (name === 'update_character') {
          const applied = applyCharacterUpdate(args, campaign)
          if (applied.ok) yield { type: 'character', character: applied.character }
          yield { type: 'party', party: campaign.party }
          result = applied
        } else if (name === 'lookup_rule') {
          result = { term: args.term, found: await lookupRule(args.term, rulesDir) }
        } else if (name === 'move_party') {
          const target = world ? locationById(world, args.locationId) : null
          if (!target) {
            result = { error: `No location "${args.locationId}". Use an id already listed.` }
          } else {
            world.campaign.partyLocation = target.id
            if (target.status === 'unvisited') target.status = 'visited'
            if (args.travelNote) world.campaign.sessionLog.push(String(args.travelNote))
            yield { type: 'location', location: { id: target.id, name: target.name, safe: target.safe } }
            result = { ok: true, nowAt: target.name, safe: Boolean(target.safe) }
          }
        } else if (name === 'record_quest') {
          const quest = world?.quests.quests.find((q) => q.id === args.questId)
          if (!quest) {
            result = { error: `No quest "${args.questId}".` }
          } else {
            quest.status = args.status
            if (args.note) quest.notes = [quest.notes, args.note].filter(Boolean).join(' | ')
            yield { type: 'quest', quest: { id: quest.id, title: quest.title, status: quest.status } }
            result = { ok: true, quest: quest.title, status: quest.status }
          }
        } else if (name === 'note') {
          if (world) {
            world.campaign.discoveries.push(String(args.text))
            if (world.campaign.discoveries.length > 200) world.campaign.discoveries.shift()
          }
          result = { ok: true, recorded: args.text }
        } else if (name === 'rest') {
          const here = world ? locationById(world, world.campaign.partyLocation) : null
          if (args.kind === 'long' && !here?.safe) {
            result = {
              denied: true,
              reason: 'A long rest is only possible inside the Keep. Offer a short rest instead.',
            }
          } else if (args.kind === 'long') {
            for (const pc of campaign.party ?? []) {
              pc.hp = pc.maxHp
              pc.tempHp = 0
              pc.conditions = []
              if (pc.spells?.slots) for (const slot of Object.values(pc.spells.slots)) slot.used = 0
              if (typeof pc.hitDiceRemaining === 'number') pc.hitDiceRemaining = pc.level ?? 1
            }
            if (world) {
              world.campaign.day += 1
              world.campaign.timeOfDay = 'morning'
            }
            yield { type: 'party', party: campaign.party }
            result = { ok: true, kind: 'long', healed: true }
          } else {
            result = { ok: true, kind: 'short' }
          }
        } else {
          result = { error: `Unknown tool "${name}"` }
        }
      } catch (error) {
        result = { error: error.message }
      }

      session.messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      })
    }
    // Loop again so the model can narrate the outcome with real numbers.
  }

  yield { type: 'warning', message: 'Reached the tool-call limit for this turn.' }
  yield { type: 'done', usage: totalUsage }
}

/** Persist mutable campaign state (hit points, conditions) to disk. */
export async function saveCampaign(campaignPath, campaign) {
  await writeFile(campaignPath, `${JSON.stringify(campaign, null, 2)}\n`, 'utf8')
}
