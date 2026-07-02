function defaultAudioManifestCandidates (sourcePath) {
  const value = String(sourcePath || '')
  if (!/\.json$/i.test(value)) return []

  const withoutJson = value.replace(/\.json$/i, '')
  const bases = []
  if (/\.audio-tagged$/i.test(withoutJson)) {
    bases.push(withoutJson.replace(/\.audio-tagged$/i, ''))
  }
  bases.push(withoutJson)

  return Array.from(new Set(
    bases.map(base => `${base}.audio/manifest.json`)
  ))
}

export { defaultAudioManifestCandidates }
