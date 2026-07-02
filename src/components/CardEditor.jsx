import React, { useEffect, useState } from 'react'
import { renderCardMarkdown } from '../lib/cardMarkdown'
import { buildAudioResolver } from '../lib/audioTags'

/**
 * CardEditor — renders one flashcard with inline editing and delete.
 *
 * Props:
 *   card      — { type: 'basic', front, back } | { type: 'cloze', text }
 *   onUpdate(updatedCard) — called on blur with the new card value
 *   onDelete()           — called when the Delete button is clicked
 */
export default function CardEditor ({ card, cardIndex = 0, audioManifest = null, onUpdate, onDelete }) {
  const [localCard, setLocalCard] = useState({ ...card })
  const audioResolver = audioManifest ? buildAudioResolver(audioManifest) : null

  useEffect(() => {
    setLocalCard({ ...card })
  }, [card])

  const handleBlur = () => {
    onUpdate(localCard)
  }

  const handleChange = (field, value) => {
    setLocalCard(prev => ({ ...prev, [field]: value }))
  }

  return (
    <div className="card-editor" data-testid="card-editor">
      {card.type === 'cloze' ? (
        <div className="card-field">
          <label className="field-label">Cloze text</label>
          <textarea
            className="card-textarea"
            value={localCard.text ?? ''}
            onChange={e => handleChange('text', e.target.value)}
            onBlur={handleBlur}
            rows={3}
            aria-label="Cloze text"
          />
          <MarkdownPreview source={localCard.text} label="Cloze preview" cardIndex={cardIndex} audioResolver={audioResolver} />
        </div>
      ) : (
        <>
          <div className="card-field">
            <label className="field-label">Front</label>
            <textarea
              className="card-textarea"
              value={localCard.front ?? ''}
              onChange={e => handleChange('front', e.target.value)}
              onBlur={handleBlur}
              rows={2}
              aria-label="Card front"
            />
            <MarkdownPreview source={localCard.front} label="Front preview" cardIndex={cardIndex} audioResolver={audioResolver} />
          </div>
          <div className="card-field">
            <label className="field-label">Back</label>
            <textarea
              className="card-textarea"
              value={localCard.back ?? ''}
              onChange={e => handleChange('back', e.target.value)}
              onBlur={handleBlur}
              rows={2}
              aria-label="Card back"
            />
            <MarkdownPreview source={localCard.back} label="Back preview" cardIndex={cardIndex} audioResolver={audioResolver} />
          </div>
        </>
      )}
      <button
        type="button"
        className="delete-btn"
        onClick={onDelete}
        aria-label="Delete card"
      >
        Delete
      </button>
    </div>
  )
}

async function resolveAudioSource (button) {
  const filePath = button.getAttribute('data-audio-path')
  if (filePath && window.ipc?.invoke) {
    const result = await window.ipc.invoke('read-audio-file', { path: filePath })
    if (result?.dataUrl) return result.dataUrl
  }
  return button.getAttribute('data-audio-src')
}

async function playAudioUntilFinished (src) {
  const audio = new Audio(src)
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
    }
    const handleEnded = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(new Error('Audio playback failed'))
    }
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)
    audio.play().catch(err => {
      cleanup()
      reject(err)
    })
  })
}

function MarkdownPreview ({ source, label, cardIndex, audioResolver }) {
  const handleClick = async (event) => {
    const button = event.target.closest?.('[data-audio-src], [data-audio-path]')
    if (!button) return
    try {
      button.disabled = true
      button.classList.remove('audio-tag-button--error')
      button.classList.add('audio-tag-button--playing')
      const src = await resolveAudioSource(button)
      if (!src) throw new Error('Audio source is missing')
      await playAudioUntilFinished(src)
    } catch {
      button.classList.add('audio-tag-button--error')
      window.setTimeout(() => {
        button.classList.remove('audio-tag-button--error')
      }, 1600)
    } finally {
      button.classList.remove('audio-tag-button--playing')
      button.disabled = false
    }
  }

  return (
    <div className="markdown-preview" aria-label={label} onClick={handleClick}>
      <div className="markdown-preview-label">{label}</div>
      <div
        className="markdown-preview-body"
        dangerouslySetInnerHTML={{
          __html: renderCardMarkdown(source, {
            target: 'preview',
            resolveAudioTag: slot => audioResolver?.(cardIndex, slot)
          }) || '<p class="markdown-preview-empty">No preview</p>'
        }}
      />
    </div>
  )
}
