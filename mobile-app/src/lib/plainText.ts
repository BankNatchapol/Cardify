// Mirrors the plain-text extraction rules in the desktop app's
// src/lib/elevenlabsAudio.js (cleanStudyText/stripMarkdown/stripHtml) —
// that file is desktop-only CommonJS and not importable here, so the same
// stripping rules are reimplemented for the widget's card-preview text.

function stripHtml (value: string): string {
  return value.replace(/<[^>]*>/g, '')
}

function stripMarkdown (value: string): string {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+\.\s+/, '')
}

function cleanLine (value: string): string {
  return stripMarkdown(stripHtml(value))
    .replace(/\{\{audio:[A-Za-z0-9_-]+\}\}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// Reduces a card's markdown `back` text to its first two non-empty plain-text
// lines — used as the widget's two subtitle lines. Deliberately generic (no
// per-deck/per-language label parsing) so it works for any deck's content.
export function extractSubtitleLines (back: string, count = 2): string[] {
  const normalized = String(back || '').replace(/<br\s*\/?>/gi, '\n')
  const lines: string[] = []
  for (const rawLine of normalized.split(/\r?\n/)) {
    const line = cleanLine(rawLine)
    if (!line) continue
    lines.push(line)
    if (lines.length >= count) break
  }
  return lines
}
