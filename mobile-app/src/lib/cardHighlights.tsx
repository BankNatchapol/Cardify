import React from 'react'
import { Text } from 'react-native'
import { MarkdownIt } from 'react-native-markdown-display'
import AudioTagButton from '../components/AudioTagButton'

// Cardify's AI-generated card content embeds a small fixed set of semantic
// HTML spans (see src/lib/claude.js / claudeCode.js prompts) for highlighting:
// <span class="cf-key">, cf-warning, cf-success, cf-muted, and <mark>.
// The desktop app renders these via src/lib/cardMarkdown.js (HTML preview).
// react-native-markdown-display has no concept of raw HTML, so without this
// plugin the literal tags show up as plain text on the study screen.
// This markdown-it inline rule tokenizes the fixed tag pairs into proper
// nested tokens, which react-native-markdown-display can then style via the
// `rules` prop (see mobile-app/app/study/[deckId].tsx and app/browse/[deckId].tsx).

const OPEN_TAGS: Record<string, string> = {
  '<span class="cf-key">': 'cf_key',
  '<span class="cf-warning">': 'cf_warning',
  '<span class="cf-success">': 'cf_success',
  '<span class="cf-muted">': 'cf_muted',
  '<mark>': 'cf_mark'
}

const CLOSE_TAG_FOR_TYPE: Record<string, string> = {
  cf_key: '</span>',
  cf_warning: '</span>',
  cf_success: '</span>',
  cf_muted: '</span>',
  cf_mark: '</mark>'
}

function cfHighlightRule (state: any, silent: boolean): boolean {
  const src: string = state.src
  const pos: number = state.pos

  if (!state.env.__cfSpanStack) state.env.__cfSpanStack = []
  const stack: string[] = state.env.__cfSpanStack

  for (const tag of Object.keys(OPEN_TAGS)) {
    if (src.startsWith(tag, pos)) {
      const type = OPEN_TAGS[tag]
      if (!silent) {
        const token = state.push(`${type}_open`, 'span', 1)
        token.markup = tag
      }
      stack.push(type)
      state.pos = pos + tag.length
      return true
    }
  }

  if (stack.length > 0) {
    const currentType = stack[stack.length - 1]
    const closeTag = CLOSE_TAG_FOR_TYPE[currentType]
    if (src.startsWith(closeTag, pos)) {
      if (!silent) {
        state.push(`${currentType}_close`, 'span', -1)
      }
      stack.pop()
      state.pos = pos + closeTag.length
      return true
    }
  }

  return false
}

export function applyCfHighlights (md: any): void {
  md.inline.ruler.before('html_inline', 'cf_highlights', cfHighlightRule)
}

// Desktop's audio-playback feature embeds `{{audio:slot}}` placeholders
// directly in card text (e.g. `{{audio:front}}`, `{{audio:example_1}}`),
// resolved at render time to a speaker-icon button. Unlike the cf_* spans
// above, this isn't a wrapping container around other text — it's a single
// self-contained token (nesting 0, like markdown-it's own `image` rule).
const AUDIO_TAG_RE = /^\{\{audio:([A-Za-z0-9_-]+)\}\}/

function cfAudioTagRule (state: any, silent: boolean): boolean {
  const src: string = state.src
  const pos: number = state.pos
  const match = AUDIO_TAG_RE.exec(src.slice(pos))
  if (!match) return false

  if (!silent) {
    const token = state.push('audio_tag', 'audio', 0)
    token.attrSet('slot', match[1])
    token.markup = match[0]
  }
  state.pos = pos + match[0].length
  return true
}

export function applyCfAudioTag (md: any): void {
  md.inline.ruler.before('html_inline', 'cf_audio_tag', cfAudioTagRule)
}

// Single shared MarkdownIt instance with the cf-highlight + audio-tag inline
// rules installed. Both Study and Browse screens use this exact instance so
// the tokenization behavior is guaranteed identical everywhere.
export const cfMarkdownIt = MarkdownIt().use(applyCfHighlights).use(applyCfAudioTag)

// Factory for the react-native-markdown-display `rules` object. Callers pass
// their own screen-local `mdStyles` (sizing/fonts differ between Study's
// giant flashcard and Browse's compact row), but the returned rule keys are
// fixed and MUST stay snake_case (cf_key, cf_warning, cf_success, cf_muted,
// cf_mark) — react-native-markdown-display's AstRenderer looks up ancestor
// styles by the raw AST node `type` string produced by markdown-it, not by
// whatever casing you might pick for the style object's keys. A mismatch
// here silently breaks color (while weight still applies via cascade) — see
// the cf_key_open/cf_key_close token types above.
export function createCfMarkdownRules (
  mdStyles: any,
  resolveAudioUri?: (slot: string) => string | null
) {
  return {
    cf_key: (node: any, children: any, _parent: any, styles: any) => (
      <Text key={node.key} style={[styles.text, mdStyles.cf_key]}>{children}</Text>
    ),
    cf_warning: (node: any, children: any, _parent: any, styles: any) => (
      <Text key={node.key} style={[styles.text, mdStyles.cf_warning]}>{children}</Text>
    ),
    cf_success: (node: any, children: any, _parent: any, styles: any) => (
      <Text key={node.key} style={[styles.text, mdStyles.cf_success]}>{children}</Text>
    ),
    cf_muted: (node: any, children: any, _parent: any, styles: any) => (
      <Text key={node.key} style={[styles.text, mdStyles.cf_muted]}>{children}</Text>
    ),
    cf_mark: (node: any, children: any, _parent: any, styles: any) => (
      <Text key={node.key} style={[styles.text, mdStyles.cf_mark]}>{children}</Text>
    ),
    audio_tag: (node: any) => {
      const slot = node.attributes?.slot as string | undefined
      const uri = slot && resolveAudioUri ? resolveAudioUri(slot) : null
      return <AudioTagButton key={node.key} uri={uri} slot={slot} />
    }
  }
}
