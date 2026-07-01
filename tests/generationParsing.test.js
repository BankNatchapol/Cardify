'use strict'

const {
  parseJsonFromText,
  unwrapClaudePayload,
  cardsCandidateFromPayload
} = require('../src/lib/generationParsing')

describe('generationParsing', () => {
  test('parses direct JSON and fenced JSON', () => {
    expect(parseJsonFromText('{"cards":[]}')).toEqual({ cards: [] })
    expect(parseJsonFromText('```json\n{"cards":[{"front":"Q","back":"A"}]}\n```')).toEqual({
      cards: [{ front: 'Q', back: 'A' }]
    })
  })

  test('recovers prose with balanced JSON', () => {
    expect(parseJsonFromText('Here you go:\n{"sampleCards":[{"front":"Q","back":"A"}]}\nThanks')).toEqual({
      sampleCards: [{ front: 'Q', back: 'A' }]
    })
  })

  test('unwraps Claude Code result and structured output wrappers', () => {
    expect(unwrapClaudePayload({
      result: '{"cards":[{"front":"Q","back":"A"}]}'
    })).toEqual({ cards: [{ front: 'Q', back: 'A' }] })

    expect(unwrapClaudePayload({
      structured_output: { cards: [{ front: 'Q', back: 'A' }] }
    })).toEqual({ cards: [{ front: 'Q', back: 'A' }] })
  })

  test('accepts sample card aliases', () => {
    expect(cardsCandidateFromPayload({ sampleCards: [{ front: 'Q', back: 'A' }] })).toEqual([
      { front: 'Q', back: 'A' }
    ])
    expect(cardsCandidateFromPayload({ samples: [{ front: 'Q2', back: 'A2' }] })).toEqual([
      { front: 'Q2', back: 'A2' }
    ])
  })

  test('throws for malformed output', () => {
    expect(() => parseJsonFromText('not json')).toThrow(/No balanced JSON/)
  })
})
