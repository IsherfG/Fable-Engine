/**
 * First-run onboarding.
 *
 * Welcome → Characters → Adventure → How you meet → Review.
 * Self-contained: renders into #setup, calls back when the campaign is created.
 * Kept apart from app.js because the play surface is already large.
 */

const SPECIES = ['Human', 'Elf', 'Dwarf', 'Halfling', 'Dragonborn', 'Gnome', 'Tiefling']
const BACKGROUNDS = ['Acolyte', 'Criminal', 'Folk Hero', 'Noble', 'Sage', 'Soldier', 'Wayfarer']

const el = (tag, cls, text) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

const STEP_TITLES = [
  'Who is at the table?',
  'Which adventure?',
  'How did you meet?',
  'Ready to begin',
]

export async function openSetup({ onComplete }) {
  const root = document.getElementById('setup')
  const options = await fetch('/api/setup').then((r) => r.json())

  const draft = {
    characters: [
      { name: '', player: 'Player 1', charClass: 'Fighter', species: 'Human', background: 'Soldier' },
      { name: '', player: 'Player 2', charClass: 'Cleric', species: 'Human', background: 'Acolyte' },
    ],
    adventure: 'wilderness',
    bond: 'hired-together',
  }

  let step = 0
  root.classList.remove('hidden')

  const shell = el('div', 'setup-shell')
  const head = el('div', 'setup-head')
  const brand = el('div', 'setup-brand')
  brand.append(el('span', 'setup-mark', '◆'), el('h1', null, 'Fable Engine'))
  const progress = el('div', 'setup-progress')
  head.append(brand, progress)
  const title = el('h2', 'setup-title')
  const lede = el('p', 'setup-lede')
  const body = el('div', 'setup-body')
  const foot = el('div', 'setup-foot')
  const backBtn = el('button', 'chip-btn', '← Back')
  backBtn.type = 'button'
  const errorLine = el('span', 'setup-error')
  const nextBtn = el('button', 'begin', 'Next →')
  nextBtn.type = 'button'
  const backWrap = el('div', 'setup-foot-left')
  backWrap.append(backBtn)
  const rightWrap = el('div', 'setup-foot-right')
  rightWrap.append(errorLine, nextBtn)
  foot.append(backWrap, rightWrap)

  shell.append(head, title, lede, body, foot)
  root.replaceChildren(shell)

  function fail(message) {
    errorLine.textContent = message || ''
  }

  /* ---------------------------------------------------------- step 1 */

  function characterCard(index) {
    const pc = draft.characters[index]
    const card = el('div', 'setup-card')

    const top = el('div', 'setup-card-head')
    top.append(el('span', 'setup-card-n', `Character ${index + 1}`))
    if (draft.characters.length > 1) {
      const remove = el('button', 'setup-remove', 'Remove')
      remove.type = 'button'
      remove.addEventListener('click', () => {
        draft.characters.splice(index, 1)
        render()
      })
      top.append(remove)
    }
    card.append(top)

    const row = el('div', 'setup-fields')
    const addField = (label, input) => {
      const wrap = el('label', 'field')
      wrap.append(el('span', 'field-label', label), input)
      row.append(wrap)
    }

    const nameInput = el('input')
    nameInput.type = 'text'
    nameInput.placeholder = pc.charClass === 'Fighter' ? 'Kael' : 'Bram'
    nameInput.value = pc.name
    nameInput.addEventListener('input', () => {
      pc.name = nameInput.value
    })
    addField('Name', nameInput)

    const playerInput = el('input')
    playerInput.type = 'text'
    playerInput.value = pc.player
    playerInput.addEventListener('input', () => {
      pc.player = playerInput.value
    })
    addField('Player', playerInput)

    const species = el('select')
    for (const s of SPECIES) {
      const o = el('option', null, s)
      o.value = s
      if (s === pc.species) o.selected = true
      species.append(o)
    }
    species.addEventListener('change', () => {
      pc.species = species.value
    })
    addField('Species', species)

    const background = el('select')
    for (const b of BACKGROUNDS) {
      const o = el('option', null, b)
      o.value = b
      if (b === pc.background) o.selected = true
      background.append(o)
    }
    background.addEventListener('change', () => {
      pc.background = background.value
    })
    addField('Background', background)

    card.append(row)

    const classes = el('div', 'setup-classes')
    for (const kit of options.classes) {
      const btn = el('button', 'setup-class')
      btn.type = 'button'
      btn.classList.toggle('is-on', kit.name === pc.charClass)
      btn.append(
        el('strong', null, kit.name),
        el('span', null, `d${kit.hitDie} · AC ${kit.ac}`),
        el('em', null, kit.blurb),
      )
      btn.addEventListener('click', () => {
        pc.charClass = kit.name
        render()
      })
      classes.append(btn)
    }
    card.append(classes)

    return card
  }

  function renderCharacters() {
    body.replaceChildren()
    const grid = el('div', 'setup-grid')
    draft.characters.forEach((_, i) => grid.append(characterCard(i)))
    body.append(grid)

    if (draft.characters.length < 4) {
      const add = el('button', 'setup-add', '+ Add another character')
      add.type = 'button'
      add.addEventListener('click', () => {
        const used = new Set(draft.characters.map((c) => c.charClass))
        const nextClass = options.classes.map((c) => c.name).find((n) => !used.has(n)) ?? 'Fighter'
        draft.characters.push({
          name: '',
          player: `Player ${draft.characters.length + 1}`,
          charClass: nextClass,
          species: 'Human',
          background: 'Wayfarer',
        })
        render()
      })
      body.append(add)
    }

    const note = el('p', 'setup-note')
    note.textContent =
      draft.characters.length === 1
        ? 'One character is playable, but two is much safer. The box assumes a party.'
        : `${draft.characters.length} characters. Encounters are written for four, so the DM will scale them down.`
    body.append(note)
  }

  /* ---------------------------------------------------------- step 2 */

  function renderAdventure() {
    body.replaceChildren()
    const grid = el('div', 'setup-choices')
    for (const adv of options.adventures) {
      const card = el('button', 'setup-choice')
      card.type = 'button'
      card.classList.toggle('is-on', draft.adventure === adv.id)
      card.append(
        el('strong', null, adv.title),
        el('span', 'setup-choice-sub', adv.subtitle),
        el('p', null, adv.blurb),
        el('em', 'setup-choice-scene', adv.scene),
      )
      card.addEventListener('click', () => {
        draft.adventure = adv.id
        render()
      })
      grid.append(card)
    }
    body.append(grid)
  }

  /* ---------------------------------------------------------- step 3 */

  function renderBond() {
    body.replaceChildren()
    const grid = el('div', 'setup-choices bonds')
    for (const bond of options.bonds) {
      const card = el('button', 'setup-choice')
      card.type = 'button'
      card.classList.toggle('is-on', draft.bond === bond.id)
      card.append(el('strong', null, bond.title), el('p', null, bond.line))
      card.addEventListener('click', () => {
        draft.bond = bond.id
        render()
      })
      grid.append(card)
    }
    body.append(grid)
  }

  /* ---------------------------------------------------------- step 4 */

  function renderReview() {
    body.replaceChildren()
    const list = el('div', 'setup-review')
    for (const pc of draft.characters) {
      const kit = options.classes.find((c) => c.name === pc.charClass)
      const row = el('div', 'setup-review-row')
      row.append(
        el('strong', null, pc.name || '(unnamed)'),
        el('span', null, `${pc.species} ${pc.charClass} · ${pc.background} · ${pc.player}`),
        el('span', 'setup-review-meta', kit ? `d${kit.hitDie} · AC ${kit.ac}` : ''),
      )
      list.append(row)
    }
    body.append(list)

    const adv = options.adventures.find((a) => a.id === draft.adventure)
    const bond = options.bonds.find((b) => b.id === draft.bond)
    const where = el('div', 'setup-review-scene')
    where.append(
      el('span', 'field-label', 'You will open here'),
      el('p', null, adv?.scene ?? ''),
      el('span', 'field-label', 'Why you are together'),
      el('p', null, bond?.line ?? ''),
    )
    body.append(where)
  }

  /* ---------------------------------------------------------- chrome */

  function render() {
    fail('')
    progress.replaceChildren()
    for (let i = 0; i < STEP_TITLES.length; i += 1) {
      const dot = el('span', 'setup-dot')
      if (i < step) dot.classList.add('is-done')
      if (i === step) dot.classList.add('is-now')
      progress.append(dot)
    }

    title.textContent = STEP_TITLES[step]
    lede.textContent = [
      'Pick a class, name them, and choose what they were before the adventure.',
      'Each is a real starting point. You can change location later by playing.',
      'This shapes the opening scene, and the DM will treat it as true.',
      'Check it over. You can still edit character sheets later.',
    ][step]

    backBtn.style.visibility = step === 0 ? 'hidden' : 'visible'
    nextBtn.textContent = step === STEP_TITLES.length - 1 ? 'Begin the adventure' : 'Next →'

    if (step === 0) renderCharacters()
    else if (step === 1) renderAdventure()
    else if (step === 2) renderBond()
    else renderReview()
  }

  backBtn.addEventListener('click', () => {
    if (step > 0) {
      step -= 1
      render()
    }
  })

  nextBtn.addEventListener('click', async () => {
    if (step < STEP_TITLES.length - 1) {
      if (step === 0) {
        const missing = draft.characters.findIndex((c) => !c.name.trim())
        if (missing !== -1) {
          fail(`Give character ${missing + 1} a name.`)
          return
        }
      }
      step += 1
      render()
      return
    }

    nextBtn.disabled = true
    nextBtn.textContent = 'Setting the table…'
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      root.classList.add('hidden')
      onComplete?.(data)
    } catch (error) {
      fail(error.message)
      nextBtn.disabled = false
      nextBtn.textContent = 'Begin the adventure'
    }
  })

  render()
}
