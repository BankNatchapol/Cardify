'use strict'

const ALLOWED_SPAN_CLASSES = new Set(['cf-key', 'cf-warning', 'cf-success', 'cf-muted'])

const ANKI_CLASS_STYLES = {
  'cf-key': 'color:#4338ca;font-weight:700;',
  'cf-warning': 'color:#b45309;font-weight:700;',
  'cf-success': 'color:#047857;font-weight:700;',
  'cf-muted': 'color:#6b7280;'
}

function renderCardMarkdown (source, options = {}) {
  const target = options.target === 'anki' ? 'anki' : 'preview'
  const text = String(source ?? '').replace(/\r\n?/g, '\n')
  if (!text.trim()) return ''

  const safeText = text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  const tokens = []
  const openTags = []
  let tokenized = safeText.replace(/<\/?mark\b[^>]*>|<\/?span\b[^>]*>/gi, tag => {
    const name = tag.match(/^<\/?\s*(mark|span)\b/i)?.[1]?.toLowerCase()
    const closing = /^<\//.test(tag)
    if (closing) {
      const openIndex = name ? openTags.lastIndexOf(name) : -1
      if (openIndex < 0) return ''
      openTags.splice(openIndex, 1)
      const token = `\u0000CARDIFY_HTML_${tokens.length}\u0000`
      tokens.push(`</${name}>`)
      return token
    }

    const safeTag = sanitizeAllowedTag(tag, target)
    if (!safeTag) return ''
    if (name) openTags.push(name)
    const token = `\u0000CARDIFY_HTML_${tokens.length}\u0000`
    tokens.push(safeTag)
    return token
  })

  tokenized = tokenized.replace(/\{\{audio:([A-Za-z0-9_-]+)\}\}/g, (_match, slot) => {
    const rendered = renderAudioTag(slot, target, options)
    return rendered ? pushHtmlToken(tokens, rendered) : ''
  }).replace(/<[^>]+>/g, '')

  const html = renderBlocks(tokenized, tokens)
  return restoreTokens(html, tokens)
}

function renderAudioTag (slot, target, options = {}) {
  const resolved = typeof options.resolveAudioTag === 'function'
    ? options.resolveAudioTag(slot)
    : null
  if (!resolved) return ''

  if (target === 'anki') {
    const fileName = resolved.fileName || resolved.file || ''
    return fileName ? `[sound:${pathBasename(fileName)}]` : ''
  }

  const src = resolved.fileUrl || resolved.src || ''
  const filePath = resolved.filePath || ''
  if (!src && !filePath) return ''
  const label = resolved.label || `Play ${slot.replace(/_/g, ' ')} audio`
  const sourceAttribute = src ? ` data-audio-src="${escapeAttributeValue(src)}"` : ''
  const pathAttribute = filePath ? ` data-audio-path="${escapeAttributeValue(filePath)}"` : ''
  return `<button type="button" class="audio-tag-button"${sourceAttribute}${pathAttribute} aria-label="${escapeAttributeValue(label)}" title="${escapeAttributeValue(label)}"><span class="audio-tag-icon" aria-hidden="true"></span></button>`
}

function pushHtmlToken (tokens, html) {
  const token = `\u0000CARDIFY_HTML_${tokens.length}\u0000`
  tokens.push(html)
  return token
}

function sanitizeAllowedTag (tag, target) {
  const closing = /^<\//.test(tag)
  const nameMatch = tag.match(/^<\/?\s*(mark|span)\b/i)
  if (!nameMatch) return ''
  const name = nameMatch[1].toLowerCase()
  if (closing) return `</${name}>`
  if (name === 'mark') return '<mark>'

  const classMatch = tag.match(/\bclass\s*=\s*["']([^"']+)["']/i)
  const className = (classMatch?.[1] || '').split(/\s+/).find(cls => ALLOWED_SPAN_CLASSES.has(cls))
  if (!className) return ''

  if (target === 'anki') {
    return `<span class="${className}" style="${ANKI_CLASS_STYLES[className]}">`
  }
  return `<span class="${className}">`
}

function renderBlocks (text, tokens) {
  const lines = text.split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }

    const fence = line.match(/^\s*```([\w-]+)?\s*$/)
    if (fence) {
      const code = []
      i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        code.push(lines[i])
        i++
      }
      if (i < lines.length) i++
      const lang = fence[1] ? ` class="language-${escapeAttribute(fence[1])}"` : ''
      blocks.push(`<pre><code${lang}>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }

    if (isTableStart(lines, i)) {
      const header = splitTableRow(lines[i])
      const aligns = splitTableRow(lines[i + 1]).map(cell => {
        const trimmed = cell.trim()
        if (/^:-+:$/.test(trimmed)) return 'center'
        if (/^-+:$/.test(trimmed)) return 'right'
        if (/^:-+$/.test(trimmed)) return 'left'
        return ''
      })
      i += 2
      const rows = []
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]))
        i++
      }
      blocks.push(renderTable(header, aligns, rows, tokens))
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      blocks.push(`<h${level}>${renderInline(heading[2], tokens)}</h${level}>`)
      i++
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push(`<blockquote>${renderInline(quote.join('\n'), tokens)}</blockquote>`)
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      blocks.push(`<ul>${items.map(item => `<li>${renderInline(item, tokens)}</li>`).join('')}</ul>`)
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      blocks.push(`<ol>${items.map(item => `<li>${renderInline(item, tokens)}</li>`).join('')}</ol>`)
      continue
    }

    const paragraph = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*```/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !isTableStart(lines, i)
    ) {
      paragraph.push(lines[i])
      i++
    }
    blocks.push(`<p>${renderInline(paragraph.join('\n'), tokens)}</p>`)
  }

  return blocks.join('\n')
}

function renderInline (text, tokens) {
  const codeTokens = []
  let html = escapeHtml(text)
    .replace(/`([^`\n]+)`/g, (_m, code) => {
      const token = `\u0000CARDIFY_CODE_${codeTokens.length}\u0000`
      codeTokens.push(`<code>${code}</code>`)
      return token
    })
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])_([^_\n]+)_/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\n/g, '<br>')

  codeTokens.forEach((code, index) => {
    html = html.replace(`\u0000CARDIFY_CODE_${index}\u0000`, code)
  })

  return restoreTokens(html, tokens)
}

function renderTable (header, aligns, rows, tokens) {
  const alignAttr = align => align ? ` style="text-align:${align}"` : ''
  const head = header.map((cell, index) =>
    `<th${alignAttr(aligns[index])}>${renderInline(cell.trim(), tokens)}</th>`
  ).join('')
  const body = rows.map(row =>
    `<tr>${row.map((cell, index) =>
      `<td${alignAttr(aligns[index])}>${renderInline(cell.trim(), tokens)}</td>`
    ).join('')}</tr>`
  ).join('')
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

function isTableStart (lines, index) {
  return (
    index + 1 < lines.length &&
    /\|/.test(lines[index]) &&
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])
  )
}

function splitTableRow (line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
}

function restoreTokens (html, tokens) {
  let restored = html
  tokens.forEach((value, index) => {
    restored = restored.split(`\u0000CARDIFY_HTML_${index}\u0000`).join(value)
  })
  return restored
}

function escapeHtml (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute (value) {
  return String(value).replace(/[^\w-]/g, '')
}

function escapeAttributeValue (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function pathBasename (value) {
  return String(value).split(/[\\/]/).pop()
}

module.exports = { renderCardMarkdown }
