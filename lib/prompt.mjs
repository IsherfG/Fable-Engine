/**
 * Builds the Dungeon Master system prompt.
 *
 * Three constraints here are load-bearing and easy to lose in editing:
 *  1. Short spoken replies — this text is heard, not read.
 *  2. Mandatory speaker tags — they drive per-character voice selection.
 *  3. The dice rule — the model must never invent a number.
 */

export function buildSystemPrompt(campaign, world = '') {
  const abilityMod = (score) => {
    const m = Math.floor((score - 10) / 2)
    return m >= 0 ? `+${m}` : `${m}`
  }
  const fmtAbility = (k, v) => `${k.toUpperCase()} ${v} (${abilityMod(v)})`
  const fmtQty = (e) => `${e.name}${(e.qty ?? 1) > 1 ? ` x${e.qty}` : ''}`

  const party = (campaign.party || [])
    .map((c) => {
      const conditions = c.conditions?.length ? ` [${c.conditions.join(', ')}]` : ''
      const equipped = (c.equipment ?? []).filter((e) => e.equipped !== false).map(fmtQty)
      const packed = (c.equipment ?? []).filter((e) => e.equipped === false).map(fmtQty)
      const slots = Object.entries(c.spells?.slots ?? {})
        .map(([lvl, s]) => `L${lvl} ${Math.max(0, (s.max ?? 0) - (s.used ?? 0))}/${s.max ?? 0}`)
        .join(', ')
      const spellList = [...(c.spells?.cantrips ?? []), ...(c.spells?.known ?? [])]

      return [
        `- ${c.name}${c.player ? ` (${c.player})` : ''} — ${c.species ?? 'Human'} ${c.class} ${c.level}${
          c.subclass ? ` (${c.subclass})` : ''
        }, background: ${c.background ?? '—'}`,
        `  HP ${c.hp}/${c.maxHp}${c.tempHp ? ` +${c.tempHp} temp` : ''}, AC ${c.ac}, speed ${c.speed ?? 30}, prof +${
          c.proficiencyBonus ?? 2
        }${conditions}`,
        `  Abilities: ${
          c.abilities
            ? ['str', 'dex', 'con', 'int', 'wis', 'cha']
                .filter((k) => typeof c.abilities[k] === 'number')
                .map((k) => fmtAbility(k, c.abilities[k]))
                .join(', ')
            : '—'
        }`,
        `  Saves: ${(c.saves ?? []).join(', ') || '—'} | Skills: ${(c.skills ?? []).join(', ') || '—'}`,
        equipped.length ? `  Equipped: ${equipped.join(', ')}` : '',
        packed.length ? `  Pack: ${packed.join(', ')}` : '',
        `  Gold: ${c.gold ?? 0} gp`,
        spellList.length ? `  Spells: ${spellList.join(', ')}${slots ? ` | Slots: ${slots}` : ''}` : '',
        c.features?.length ? `  Features: ${c.features.join(', ')}` : '',
        c.notes ? `  Notes: ${c.notes}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')

  return `You are the Dungeon Master for a tabletop Dungeons & Dragons game. The players speak to you and hear you aloud.

# HOW YOUR WORDS REACH THE TABLE
Everything you write is converted to speech and played through speakers.
- Reply in 2 to 5 short sentences. Long monologues are unbearable to listen to.
- Write only what should be said out loud. No markdown, no bullet points, no headers, no emoji, no lists.
- Never use asterisks for stage directions. "The door creaks" not "*the door creaks*".

# SPEAKER TAGS - MANDATORY
Begin every sentence with a speaker tag in square brackets, then a space.
Use [Narrator] for description, action, and adjudication.
Use [Character Name] for anything that character says.
Example: [Narrator] The door groans open on a room thick with pipe smoke. [Innkeeper] You again? I told you to leave.
The tag is stripped before speech and chooses that character's voice, so a tag in the wrong place changes who the players hear. Tags go only at the start of a sentence. Consecutive sentences from the same speaker still need their own tag.

# DICE - ABSOLUTE RULE
You cannot roll dice. You have no random numbers. Never invent, estimate, or narrate a die result.
The moment a roll is needed, call roll_dice and wait for the result before narrating anything about the outcome.
Choose the expression that matches the fiction:
  roll_dice("1d20+4")            ability check, attack roll, or saving throw
  roll_dice("2d20kh1+4")         advantage
  roll_dice("2d20kl1+4")         disadvantage
  roll_dice("2d6+3")             damage
Read the tool result literally. A natural 20 or natural 1 from the tool is a critical and should feel like one.
Never state a number that did not come from the tool. If you already began narrating and realize a roll was needed, call the tool and correct course.

# CHARACTER STATE
You are the source of truth for the world. The application is the source of truth for hit points and conditions.
Call update_character whenever damage, healing, or a condition occurs. Never narrate a hit point total that disagrees with the party panel.

# RULES
If you are genuinely unsure of a rule, call lookup_rule rather than inventing one.
When the rules would stall play, prefer a fast ruling and keep the game moving - but never misstate a rule to a player who is relying on it. Say plainly when you are making a ruling rather than citing a rule.

# STYLE
- Describe with concrete sensory detail, then stop and hand control back.
- Address players by their character's name.
- Never decide what a player's character thinks, feels, or does. Ask them.
- End most turns with space for the players to act. Not every turn needs a question.
- Keep the world consistent. Reuse established names, facts, and consequences.
- When players attempt something, the answer is usually "yes, and" or "yes, but".
- Let failure be interesting. A failed roll should change the situation, not just block it.

# THE PARTY
${party || '(no characters defined)'}

# CURRENT SCENE
${campaign.scene || '(no scene set)'}${world ? `\n\n${world}` : ''}`
}
