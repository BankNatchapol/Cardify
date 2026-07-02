'use strict'

const path = require('path')
const { cleanStudyText } = require('./elevenlabsAudio')

const AUDIO_TAG_RE = /\{\{audio:([A-Za-z0-9_-]+)\}\}/g

function audioTargetIdForSlot (cardIndex, slot) {
  const note = `note-${String(Number(cardIndex) + 1).padStart(4, '0')}`
  if (slot === 'front') return `${note}-front`
  const example = String(slot || '').match(/^example_(\d+)$/)
  if (example) return `${note}-example-${String(Number(example[1])).padStart(2, '0')}`
  return ''
}

function audioSlotForTarget (target = {}) {
  if (target.kind === 'front') return 'front'
  const match = String(target.id || '').match(/-example-(\d+)$/)
  if (target.kind === 'example' && match) return `example_${Number(match[1])}`
  return ''
}

function buildAudioResolver (manifest = {}, options = {}) {
  const byId = new Map()
  for (const target of Array.isArray(manifest.targets) ? manifest.targets : []) {
    if (target?.status !== 'success') continue
    byId.set(target.id, target)
  }
  const basePath = options.basePath || manifest.basePath || ''
  return (cardIndex, slot) => {
    const id = audioTargetIdForSlot(cardIndex, slot)
    if (!id) return null
    const target = byId.get(id)
    if (!target) return null
    const file = target.file || target.relativeFile || ''
    if (!file) return null
    return {
      ...target,
      id,
      slot,
      file,
      fileName: path.basename(file),
      filePath: target.filePath || (basePath ? path.join(basePath, file) : ''),
      fileUrl: target.fileUrl || ''
    }
  }
}

function tagAudioInInput (input, manifest) {
  if (Array.isArray(input)) {
    return input.map((card, index) => tagCard(card, index, manifest))
  }

  if (!input || typeof input !== 'object') throw new Error('Input JSON must be an object or card array')

  if (Array.isArray(input.notes)) {
    return {
      ...input,
      notes: input.notes.map((note, index) => tagNote(note, index, manifest))
    }
  }

  if (Array.isArray(input.cards)) {
    return {
      ...input,
      cards: input.cards.map((card, index) => tagCard(card, index, manifest))
    }
  }

  if (Array.isArray(input.projects)) {
    return {
      ...input,
      projects: input.projects.map(project => ({
        ...project,
        cards: Array.isArray(project.cards)
          ? project.cards.map((card, index) => tagCard(card, index, manifest))
          : project.cards
      }))
    }
  }

  throw new Error('Could not find cards in input JSON')
}

function tagNote (note = {}, index, manifest) {
  const fields = note.fields || {}
  return {
    ...note,
    fields: {
      ...fields,
      Front: tagFrontText(fields.Front || fields.front || note.front || ''),
      Back: tagBackText(fields.Back || fields.back || note.back || '', index, manifest, { includeFrontAudio: true })
    }
  }
}

function tagCard (card = {}, index, manifest) {
  if (card.type === 'cloze' || Object.prototype.hasOwnProperty.call(card, 'text')) {
    return {
      ...card,
      text: tagBackText(card.text || '', index, manifest, { includeFrontAudio: false })
    }
  }
  return {
    ...card,
    front: tagFrontText(card.front || ''),
    back: tagBackText(card.back || '', index, manifest, { includeFrontAudio: true })
  }
}

function tagFrontText (front) {
  return removeAudioSlot(front, 'front').trim()
}

function tagBackText (back, index, manifest, options = {}) {
  let text = String(back || '')
  if (options.includeFrontAudio && hasSuccessfulAudioTarget(manifest, index, 'front')) {
    text = tagFrontAudioInBack(text)
  }

  const examples = successfulTargetsForIndex(manifest, index)
    .filter(target => target.kind === 'example')
    .map(target => ({ ...target, slot: audioSlotForTarget(target) }))
    .filter(target => target.slot)
  if (examples.length === 0) return text

  const taggedSlots = new Set()
  const lines = text.split(/\r?\n/)
  const nextLines = lines.map(line => {
    const cleaned = cleanStudyText(line)
    const target = examples.find(candidate => (
      !taggedSlots.has(candidate.slot) &&
      !hasAudioSlot(text, candidate.slot) &&
      cleaned === cleanStudyText(candidate.text)
    ))
    if (!target) return line
    taggedSlots.add(target.slot)
    return line.trim() ? `${line} {{audio:${target.slot}}}` : line
  })
  return nextLines.join('\n')
}

function tagFrontAudioInBack (back) {
  const text = String(back || '')
  if (hasAudioSlot(text, 'front')) return text
  if (!text.trim()) return '{{audio:front}}'

  const lines = text.split(/\r?\n/)
  const preferredIndex = lines.findIndex(line => /พินอิน|pinyin|pronunciation|คำอ่าน/i.test(line))
  const fallbackIndex = lines.findIndex(line => line.trim())
  const index = preferredIndex >= 0 ? preferredIndex : fallbackIndex
  if (index < 0) return `${text}\n{{audio:front}}`
  lines[index] = lines[index].trim() ? `${lines[index]} {{audio:front}}` : '{{audio:front}}'
  return lines.join('\n')
}

function hasSuccessfulAudioTarget (manifest, index, slot) {
  const id = audioTargetIdForSlot(index, slot)
  return successfulTargetsForIndex(manifest, index).some(target => target.id === id)
}

function successfulTargetsForIndex (manifest = {}, index) {
  return (Array.isArray(manifest.targets) ? manifest.targets : [])
    .filter(target => target?.status === 'success' && Number(target.noteIndex) === Number(index))
}

function hasAudioSlot (text, slot) {
  return new RegExp(`\\{\\{audio:${escapeRegExp(slot)}\\}\\}`).test(String(text || ''))
}

function stripAudioTags (text) {
  return String(text || '').replace(AUDIO_TAG_RE, '')
}

function removeAudioSlot (text, slot) {
  return String(text || '')
    .replace(new RegExp(`\\s*\\{\\{audio:${escapeRegExp(slot)}\\}\\}`, 'g'), '')
}

function escapeRegExp (value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

module.exports = {
  AUDIO_TAG_RE,
  audioSlotForTarget,
  audioTargetIdForSlot,
  buildAudioResolver,
  hasAudioSlot,
  stripAudioTags,
  tagAudioInInput,
  tagBackText,
  tagFrontText
}
