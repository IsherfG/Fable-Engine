/**
 * Onboarding: turning a physical box into a started campaign.
 *
 * The flow is Welcome → Characters → Adventure → How you meet → Play.
 * This module owns the *content* of those steps (class kits, adventure
 * openings, party bonds) so the client only has to render choices.
 */

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8]

/**
 * Class kits for level 1 (2024 rules). Ability scores assign the standard
 * array in an order that makes the class work.
 */
export const CLASS_KITS = {
  Fighter: {
    hitDie: 10,
    abilities: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    saves: ['str', 'con'],
    skills: ['Athletics', 'Perception', 'Intimidation', 'Survival'],
    features: ['Second Wind', 'Weapon Mastery (Longsword)', 'Fighting Style'],
    equipment: [
      { name: 'Chain mail', qty: 1, equipped: true },
      { name: 'Longsword', qty: 1, equipped: true },
      { name: 'Shield', qty: 1, equipped: true },
      { name: 'Javelin', qty: 4, equipped: false },
      { name: "Dungeoneer's pack", qty: 1, equipped: false },
    ],
    ac: 18,
    blurb: 'Front line. Takes the hits so the other one does not have to.',
  },
  Cleric: {
    hitDie: 8,
    abilities: { str: 13, dex: 12, con: 14, int: 8, wis: 15, cha: 10 },
    saves: ['wis', 'cha'],
    skills: ['Religion', 'Insight', 'Medicine', 'Persuasion'],
    features: ['Spellcasting', 'Divine Order (Protector)'],
    equipment: [
      { name: 'Scale mail', qty: 1, equipped: true },
      { name: 'Mace', qty: 1, equipped: true },
      { name: 'Shield', qty: 1, equipped: true },
      { name: 'Holy symbol', qty: 1, equipped: true },
      { name: "Priest's pack", qty: 1, equipped: false },
    ],
    ac: 16,
    spells: {
      cantrips: ['Sacred Flame', 'Guidance', 'Light'],
      known: ['Cure Wounds', 'Bless', 'Guiding Bolt', 'Shield of Faith'],
      slots: { 1: { max: 2, used: 0 } },
    },
    blurb: 'The only healing you will have. Cure Wounds is touch range.',
  },
  Rogue: {
    hitDie: 8,
    abilities: { str: 8, dex: 15, con: 14, int: 12, wis: 13, cha: 10 },
    saves: ['dex', 'int'],
    skills: ['Stealth', 'Sleight of Hand', 'Perception', 'Acrobatics'],
    features: ['Sneak Attack', 'Thieves Cant', 'Weapon Mastery (Shortsword)'],
    equipment: [
      { name: 'Leather armor', qty: 1, equipped: true },
      { name: 'Shortsword', qty: 2, equipped: true },
      { name: 'Shortbow', qty: 1, equipped: true },
      { name: "Thieves' tools", qty: 1, equipped: false },
      { name: "Burglar's pack", qty: 1, equipped: false },
    ],
    ac: 13,
    blurb: 'Locks, traps and sneak attack. Fragile if it fights alone.',
  },
  Wizard: {
    hitDie: 6,
    abilities: { str: 8, dex: 13, con: 14, int: 15, wis: 12, cha: 10 },
    saves: ['int', 'wis'],
    skills: ['Arcana', 'Investigation', 'History', 'Insight'],
    features: ['Spellcasting', 'Arcane Recovery'],
    equipment: [
      { name: 'Quarterstaff', qty: 1, equipped: true },
      { name: 'Spellbook', qty: 1, equipped: false },
      { name: 'Component pouch', qty: 1, equipped: true },
      { name: "Scholar's pack", qty: 1, equipped: false },
    ],
    ac: 11,
    spells: {
      cantrips: ['Fire Bolt', 'Mage Hand', 'Minor Illusion'],
      known: ['Magic Missile', 'Shield', 'Sleep', 'Detect Magic'],
      slots: { 1: { max: 2, used: 0 } },
    },
    blurb: 'Glass cannon. Powerful, but one good hit ends the argument.',
  },
}

export const SPECIES = ['Human', 'Elf', 'Dwarf', 'Halfling', 'Dragonborn', 'Gnome', 'Tiefling']

export const BACKGROUNDS = [
  'Acolyte',
  'Criminal',
  'Folk Hero',
  'Noble',
  'Sage',
  'Soldier',
  'Wayfarer',
]

/** Build a complete level-1 sheet from a class kit. */
export function makeCharacter({ name, player, charClass, species, background }) {
  const kit = CLASS_KITS[charClass]
  if (!kit) throw new Error(`Unknown class "${charClass}"`)

  const conMod = Math.floor((kit.abilities.con - 10) / 2)
  const maxHp = Math.max(1, kit.hitDie + conMod)

  return {
    name: String(name ?? '').trim() || charClass,
    player: String(player ?? '').trim(),
    class: charClass,
    subclass: null,
    level: 1,
    species: species || 'Human',
    background: background || 'Wayfarer',
    abilities: { ...kit.abilities },
    proficiencyBonus: 2,
    saves: [...kit.saves],
    skills: [...kit.skills],
    ac: kit.ac,
    hp: maxHp,
    maxHp,
    tempHp: 0,
    hitDice: `1d${kit.hitDie}`,
    hitDiceRemaining: 1,
    speed: 30,
    initiative: Math.floor((kit.abilities.dex - 10) / 2),
    equipment: kit.equipment.map((e) => ({ ...e })),
    gold: 15,
    conditions: [],
    features: [...kit.features],
    spells: kit.spells
      ? {
          cantrips: [...(kit.spells.cantrips ?? [])],
          known: [...(kit.spells.known ?? [])],
          slots: structuredClone(kit.spells.slots ?? {}),
        }
      : { cantrips: [], known: [], slots: {} },
    notes: kit.blurb,
  }
}

/** The three legitimate ways into the box. */
export const ADVENTURES = {
  wilderness: {
    id: 'wilderness',
    title: 'The Trail',
    subtitle: 'Wilderness booklet · recommended',
    locationId: 'wild-trail',
    act: 'wilderness',
    scene:
      'Rain on the trail south of the Keep. A looted wagon sits ahead where the road bends, one wheel still turning in the wind. The Keep is a grey shape on the hill beyond.',
    blurb: 'Start as intended: a broken wagon, a bandit ambush, then the Keep. Teaches combat, exploration and talk in one sitting.',
  },
  keep: {
    id: 'keep',
    title: 'The Keep',
    subtitle: 'Keep on the Borderlands · social',
    locationId: 'keep-gatehouse',
    act: 'keep',
    scene:
      "Dusk at the Keep's outer gate. Rain runs off the stone. Two guards watch you approach and do not move to open the way yet. Somewhere inside, a tavern is loud.",
    blurb: 'Start inside the safety of the Keep. Heavy on people, rumours and shopping. Best if you want a slow, talky first night.',
  },
  caves: {
    id: 'caves',
    title: 'The Caves of Chaos',
    subtitle: 'Caves booklet · hard mode',
    locationId: 'caves-valley',
    act: 'caves',
    scene:
      'The canyon mouth at first light. Eleven cave mouths gap in the rock above you, some dark, one with the smell of smoke. Nothing moves. Everything is watching.',
    blurb: 'Skip straight to the dungeon. Dangerous at level 1 and skips the build-up, but the fastest route to real stakes.',
  },
}

/** Why these two are travelling together. Seeds the opening and one discovery. */
export const BONDS = {
  'hired-together': {
    id: 'hired-together',
    title: 'Hired together',
    line: 'A contract brought you both to the Borderlands, and neither of you has been paid yet.',
    note: 'The party was hired together for the same contract. Neither has been paid.',
  },
  'old-friends': {
    id: 'old-friends',
    title: 'Old friends',
    line: 'You have known each other long enough to stop being polite about it.',
    note: 'The party are old friends who have travelled together before.',
  },
  'met-on-the-road': {
    id: 'met-on-the-road',
    title: 'Met on the road',
    line: 'You fell in together three days ago, and have not yet decided whether you like each other.',
    note: 'The party met three days ago on the road and is still sizing each other up.',
  },
  'last-survivors': {
    id: 'last-survivors',
    title: 'Last survivors',
    line: 'Something killed the rest of your caravan. You are what walked away from it.',
    note: 'The party are the only survivors of a destroyed caravan.',
  },
}

export function adventureFor(id) {
  return ADVENTURES[id] ?? null
}

export function bondFor(id) {
  return BONDS[id] ?? null
}

export { STANDARD_ARRAY }
