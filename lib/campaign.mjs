/**
 * Campaign world state: locations, NPCs, quests, and runtime progress.
 *
 * Design rule: the prompt only ever sees what the party could plausibly know.
 * Unvisited caves and unmet NPCs stay out of it, both to save tokens and so the
 * model cannot accidentally spoil the module by narrating places it has not been.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const FILES = {
  campaign: 'campaign.json',
  locations: 'locations.json',
  npcs: 'npcs.json',
  quests: 'quests.json',
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return fallback
  }
}

export async function loadWorld(dir) {
  const [campaign, locations, npcs, quests] = await Promise.all([
    readJson(join(dir, FILES.campaign), null),
    readJson(join(dir, FILES.locations), { locations: [] }),
    readJson(join(dir, FILES.npcs), { npcs: [] }),
    readJson(join(dir, FILES.quests), { quests: [] }),
  ])
  if (!campaign) throw new Error(`Missing or unreadable ${FILES.campaign}`)
  return { campaign, locations, npcs, quests }
}

export async function saveCampaignState(dir, campaign) {
  await writeFile(join(dir, FILES.campaign), `${JSON.stringify(campaign, null, 2)}\n`, 'utf8')
}

export function locationById(world, id) {
  return world.locations.locations.find((l) => l.id === id) ?? null
}

export function currentLocation(world) {
  return locationById(world, world.campaign.partyLocation)
}

/** Write a mutable location's status back into the locations file. */
export async function saveLocations(dir, locations) {
  await writeFile(join(dir, FILES.locations), `${JSON.stringify(locations, null, 2)}\n`, 'utf8')
}

export async function saveNpcs(dir, npcs) {
  await writeFile(join(dir, FILES.npcs), `${JSON.stringify(npcs, null, 2)}\n`, 'utf8')
}

export async function saveQuests(dir, quests) {
  await writeFile(join(dir, FILES.quests), `${JSON.stringify(quests, null, 2)}\n`, 'utf8')
}

/**
 * Compact briefing for the DM prompt. Deliberately filtered: current location,
 * its neighbours, NPCs the party has met (or who are standing here), open quests,
 * faction standing, and what they have learned.
 */
export function worldBrief(world) {
  const { campaign } = world
  const here = currentLocation(world)
  const lines = []

  lines.push('# WHERE THE PARTY IS')
  if (here) {
    lines.push(`${here.name} (${here.booklet}, ${here.safe ? 'safe' : 'unsafe'})`)
    if (here.summary) lines.push(here.summary)
    const next = (here.connections ?? [])
      .map((id) => locationById(world, id))
      .filter(Boolean)
      .map((l) => `${l.id}=${l.name.replace(/^The Keep — /, '')}`)
    if (next.length) lines.push(`Connected to: ${next.join('; ')}`)
  }
  lines.push(`Day ${campaign.day}, ${campaign.timeOfDay}. Weather: ${campaign.weather}.`)

  const known = world.locations.locations.filter(
    (l) => l.status !== 'unvisited' && l.id !== campaign.partyLocation,
  )
  if (known.length) {
    lines.push('', '# PLACES THE PARTY HAS BEEN')
    for (const l of known.slice(0, 12)) lines.push(`- ${l.name}${l.status === 'cleared' ? ' (cleared)' : ''}`)
  }

  const openQuests = world.quests.quests.filter((q) => q.status === 'active' || q.status === 'offered')
  if (openQuests.length) {
    lines.push('', '# QUESTS')
    for (const q of openQuests) {
      lines.push(`- [${q.id}] ${q.status.toUpperCase()}: ${q.title}${q.giver ? ` (from ${q.giver})` : ''}`)
      const step = q.steps?.[0]
      if (step) lines.push(`  next: ${step}`)
    }
  }

  const relevantNpcs = world.npcs.npcs.filter(
    (n) => n.met || n.location === campaign.partyLocation,
  )
  if (relevantNpcs.length) {
    lines.push('', '# PEOPLE')
    for (const n of relevantNpcs.slice(0, 10)) {
      lines.push(`- [${n.id}] ${n.name}, ${n.role} — ${n.met ? 'met' : 'present'}, ${n.disposition}`)
      if (n.wants) lines.push(`  wants: ${n.wants}`)
    }
  }

  const factions = Object.entries(campaign.factions ?? {})
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`)
  if (factions.length) {
    lines.push('', `# FACTION STANDING (players do not see numbers, only your portrayal)`)
    lines.push(factions.join(', '))
  }

  if (campaign.discoveries?.length) {
    lines.push('', '# WHAT THE PARTY HAS LEARNED')
    for (const d of campaign.discoveries.slice(-10)) lines.push(`- ${d}`)
  }

  lines.push(
    '',
    '# BOOKKEEPING - DO THIS AS PART OF PLAY, NOT AFTER',
    'You are the record keeper as well as the narrator. If you narrate it but do not record it, the world drifts and later turns contradict you.',
    '- The party travels or enters anywhere new: call move_party BEFORE narrating the arrival.',
    '- A quest is accepted, finished, or failed: call record_quest.',
    '- They learn a name, make a deal, leave a door open, kill someone who mattered: call note.',
    '- They rest: call rest. It will refuse a long rest outside the Keep.',
    '- Every die roll: roll_dice. Every hit point or condition change: update_character.',
    '',
    '# MODULE RULES THAT MATTER',
    '- Long rests are ONLY possible inside the Keep. Outside it, at most a short rest.',
    '- Clearing a cave is the level-up track. Award the level when a cave is finished, not per monster.',
    '- The caves hold factions with their own agendas. They can be allied with, bribed, or set against each other — they are not just targets.',
    '- The encounter numbers in the book assume four characters. With two, reduce the NUMBER of enemies, never their damage.',
  )

  return lines.join('\n')
}
