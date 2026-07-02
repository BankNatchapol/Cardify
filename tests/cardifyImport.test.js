'use strict'

const {
  importCardifyJson,
  noteToCard
} = require('../src/lib/cardifyImport.cjs')

describe('cardifyImport', () => {
  test('imports raw card arrays', () => {
    expect(importCardifyJson([
      { type: 'basic', front: '爱', back: 'รัก' }
    ])).toEqual({
      description: { title: '', purpose: '', contents: [] },
      cardFormat: 'basic',
      cards: [{ type: 'basic', front: '爱', back: 'รัก' }]
    })
  })

  test('imports Cardify objects with description and cards', () => {
    const imported = importCardifyJson({
      description: { title: 'HSK 1', purpose: 'Study', contents: ['Words'] },
      cards: [{ type: 'cloze', text: '{{c1::爱}} means love' }]
    })

    expect(imported.description.title).toBe('HSK 1')
    expect(imported.cardFormat).toBe('cloze')
    expect(imported.cards).toEqual([{ type: 'cloze', text: '{{c1::爱}} means love' }])
  })

  test('imports mobile package deck notes', () => {
    const imported = importCardifyJson({
      deck: {
        name: 'Mobile HSK',
        description: { title: 'HSK Mobile', purpose: 'Review', contents: ['Vocab'] }
      },
      notes: [
        { noteType: 'basic', fields: { Front: '爸爸', Back: 'พ่อ' } },
        { noteType: 'cloze', fields: { Text: '{{c1::爸爸}} means father' } }
      ]
    })

    expect(imported.description).toEqual({ title: 'HSK Mobile', purpose: 'Review', contents: ['Vocab'] })
    expect(imported.cardFormat).toBe('basic')
    expect(imported.cards).toEqual([
      { type: 'basic', front: '爸爸', back: 'พ่อ' },
      { type: 'cloze', text: '{{c1::爸爸}} means father' }
    ])
  })

  test('uses deck name as fallback title for package notes', () => {
    const imported = importCardifyJson({
      deck: { name: 'Deck Name' },
      notes: [{ fields: { Front: 'Q', Back: 'A' } }]
    })

    expect(imported.description.title).toBe('Deck Name')
  })

  test('imports a single saved project JSON', () => {
    const imported = importCardifyJson({
      projects: [{
        id: 'p1',
        title: 'Saved Project',
        description: { title: 'Project Deck', purpose: '', contents: [] },
        cards: [{ front: 'Q', back: 'A' }]
      }]
    })

    expect(imported.description.title).toBe('Project Deck')
    expect(imported.cards).toEqual([{ type: 'basic', front: 'Q', back: 'A' }])
  })

  test('requires projectId for multi-project JSON', () => {
    expect(() => importCardifyJson({
      projects: [
        { id: 'p1', cards: [{ front: 'Q1', back: 'A1' }] },
        { id: 'p2', cards: [{ front: 'Q2', back: 'A2' }] }
      ]
    })).toThrow(/multiple projects/)

    expect(importCardifyJson({
      projects: [
        { id: 'p1', cards: [{ front: 'Q1', back: 'A1' }] },
        { id: 'p2', cards: [{ front: 'Q2', back: 'A2' }] }
      ]
    }, { projectId: 'p2' }).cards[0].front).toBe('Q2')
  })

  test('normalizes notes directly', () => {
    expect(noteToCard({ noteType: 'basic', fields: { Front: 'F', Back: 'B' } })).toEqual({
      type: 'basic',
      front: 'F',
      back: 'B'
    })
  })
})
