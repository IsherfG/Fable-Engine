/**
 * Dice engine.
 *
 * CRITICAL DESIGN RULE: dice are rolled here, in code, never by the language
 * model. LLMs produce plausible-looking but non-random numbers and will quietly
 * "fix" a total to fit the story. Every roll goes through this module and the
 * result is fed back to the model as a tool result.
 */

import { randomInt } from 'node:crypto'

const MAX_COUNT = 100
const MAX_SIDES = 1000
const TERM_RE = /^(\d*)[dD](\d+)(?:(kh|kl)(\d+))?$/

function rollOne(sides) {
  return randomInt(1, sides + 1)
}

/**
 * Roll a dice expression.
 * Supports: 1d20+5, 2d6+3, d20, 4d6kh3, 2d20kl1 (disadvantage),
 * 1d8+1d6+2, flat modifiers, and mixed positive/negative terms.
 *
 * @param {string} expression
 * @param {string} [reason]
 * @returns {{expression:string, total:number, detail:string, rolls:number[],
 *            natural20:boolean, natural1:boolean, reason:string|undefined}}
 */
/** Format a term with its sign; the leading term never carries a '+'. */
function signed(text, sign, isFirst) {
  if (sign < 0) return `- ${text}`
  return isFirst ? text : `+ ${text}`
}

export function rollDice(expression, reason) {
  const cleaned = String(expression ?? '').replace(/\s+/g, '')
  if (!cleaned) throw new Error('Empty dice expression')

  const terms = cleaned.match(/[+-]?[^+-]+/g)
  if (!terms) throw new Error(`Could not parse dice expression: ${expression}`)

  let total = 0
  const parts = []
  const allRolls = []
  let sawSingleD20 = false
  let d20Face = null

  for (const raw of terms) {
    const sign = raw.startsWith('-') ? -1 : 1
    const body = raw.replace(/^[+-]/, '')

    const m = TERM_RE.exec(body)
    if (!m) {
      if (!/^\d+$/.test(body)) {
        throw new Error(`Invalid dice term "${raw}" in "${expression}"`)
      }
      const v = Number(body)
      total += sign * v
      parts.push(signed(String(v), sign, parts.length === 0))
      continue
    }

    const count = m[1] === '' ? 1 : Number(m[1])
    const sides = Number(m[2])
    const keepMode = m[3] // 'kh' | 'kl' | undefined
    const keepN = m[4] ? Number(m[4]) : count

    if (count < 1 || count > MAX_COUNT) {
      throw new Error(`Dice count out of range (1-${MAX_COUNT}): ${body}`)
    }
    if (sides < 2 || sides > MAX_SIDES) {
      throw new Error(`Dice sides out of range (2-${MAX_SIDES}): ${body}`)
    }

    const rolls = Array.from({ length: count }, () => rollOne(sides))
    allRolls.push(...rolls)

    if (count === 1 && sides === 20) {
      sawSingleD20 = true
      d20Face = rolls[0]
    }

    let kept = rolls
    let keepNote = ''
    if (keepMode) {
      const n = Math.min(Math.max(keepN, 1), count)
      const sorted = [...rolls].sort((a, b) => (keepMode === 'kh' ? b - a : a - b))
      kept = sorted.slice(0, n)
      keepNote = ` keep ${kept.join('+')}`
    }

    const subtotal = kept.reduce((a, b) => a + b, 0)
    total += sign * subtotal

    const rollText = keepMode ? `[${rolls.join(', ')}]${keepNote}` : `[${rolls.join(', ')}]`
    parts.push(signed(`${body}${rollText}`, sign, parts.length === 0))
  }

  const detail = `${parts.join(' ')} = ${total}`

  return {
    expression: cleaned,
    total,
    detail,
    rolls: allRolls,
    natural20: sawSingleD20 && d20Face === 20,
    natural1: sawSingleD20 && d20Face === 1,
    reason: reason || undefined,
  }
}
