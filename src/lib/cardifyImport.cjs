'use strict'

function importCardifyJson (input, options = {}) {
  const selected = selectDeckPayload(input, options)
  const cards = selected.cards.map(normalizeCard).filter(isReadableCard)
  if (cards.length === 0) throw new Error('Imported JSON does not contain readable cards')

  return {
    description: normalizeDescription(selected.description, selected.fallbackTitle),
    cards,
    cardFormat: cards.every(card => card.type === 'cloze') ? 'cloze' : 'basic'
  }
}

function selectDeckPayload (input, options = {}) {
  if (Array.isArray(input)) {
    return { description: null, fallbackTitle: '', cards: input }
  }

  if (!input || typeof input !== 'object') {
    throw new Error('Input JSON must be an object or card array')
  }

  if (Array.isArray(input.cards)) {
    return {
      description: input.description || input.deck?.description || null,
      fallbackTitle: input.title || input.name || input.deck?.name || input.deck?.title || '',
      cards: input.cards
    }
  }

  if (Array.isArray(input.notes)) {
    return {
      description: input.deck?.description || input.description || null,
      fallbackTitle: input.deck?.name || input.deck?.title || input.title || input.name || '',
      cards: input.notes.map(noteToCard)
    }
  }

  if (Array.isArray(input.projects)) {
    const index = selectProjectIndex(input.projects, options.projectId)
    const project = input.projects[index]
    if (!Array.isArray(project?.cards)) throw new Error('Selected project does not include cards')
    return {
      description: project.description || null,
      fallbackTitle: project.title || project.name || project.fileName || project.id || '',
      cards: project.cards
    }
  }

  throw new Error('Could not find cards in input JSON')
}

function normalizeDescription (description, fallbackTitle = '') {
  const titleFallback = String(fallbackTitle || '').trim()
  if (!description || typeof description !== 'object' || Array.isArray(description)) {
    return {
      title: titleFallback,
      purpose: '',
      contents: []
    }
  }

  return {
    title: String(description.title || titleFallback || '').trim(),
    purpose: String(description.purpose || '').trim(),
    contents: Array.isArray(description.contents)
      ? description.contents.map(item => String(item || '').trim()).filter(Boolean)
      : []
  }
}

function noteToCard (note = {}) {
  const fields = note.fields || {}
  const noteType = String(note.noteType || note.type || '').toLowerCase()
  if (noteType.includes('cloze') || Object.prototype.hasOwnProperty.call(fields, 'Text')) {
    return {
      type: 'cloze',
      text: String(fields.Text || fields.text || note.text || fields.Front || '')
    }
  }

  return {
    type: 'basic',
    front: String(fields.Front || fields.front || note.front || ''),
    back: String(fields.Back || fields.back || note.back || '')
  }
}

function normalizeCard (card = {}) {
  if (String(card.type || '').toLowerCase() === 'cloze' || Object.prototype.hasOwnProperty.call(card, 'text')) {
    return {
      type: 'cloze',
      text: String(card.text || '')
    }
  }

  return {
    type: 'basic',
    front: String(card.front || card.fields?.Front || card.fields?.front || ''),
    back: String(card.back || card.fields?.Back || card.fields?.back || '')
  }
}

function isReadableCard (card) {
  if (card.type === 'cloze') return Boolean(String(card.text || '').trim())
  return Boolean(String(card.front || '').trim() || String(card.back || '').trim())
}

function selectProjectIndex (projects, projectId) {
  if (projectId) {
    const index = projects.findIndex(project => project?.id === projectId)
    if (index < 0) throw new Error(`Project not found: ${projectId}`)
    return index
  }
  if (projects.length === 1) return 0
  throw new Error('Input contains multiple projects; pass projectId')
}

module.exports = {
  importCardifyJson,
  normalizeCard,
  normalizeDescription,
  noteToCard,
  selectDeckPayload
}
