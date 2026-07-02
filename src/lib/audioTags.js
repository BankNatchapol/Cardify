function audioTargetIdForSlot (cardIndex, slot) {
  const note = `note-${String(Number(cardIndex) + 1).padStart(4, '0')}`
  if (slot === 'front') return `${note}-front`
  const example = String(slot || '').match(/^example_(\d+)$/)
  if (example) return `${note}-example-${String(Number(example[1])).padStart(2, '0')}`
  return ''
}

function buildAudioResolver (manifest = {}) {
  const byId = new Map()
  for (const target of Array.isArray(manifest.targets) ? manifest.targets : []) {
    if (target?.status !== 'success') continue
    byId.set(target.id, target)
  }
  return (cardIndex, slot) => {
    const id = audioTargetIdForSlot(cardIndex, slot)
    if (!id) return null
    const target = byId.get(id)
    if (!target) return null
    const file = target.file || target.relativeFile || ''
    return {
      ...target,
      id,
      slot,
      file,
      fileName: basename(file),
      filePath: target.filePath || '',
      fileUrl: target.fileUrl || ''
    }
  }
}

function basename (value) {
  return String(value || '').split(/[\\/]/).pop()
}

export { audioTargetIdForSlot, buildAudioResolver }
