'use strict'

const {
  detectGenerationGoal,
  extractGenerationGoalFromClarifications,
  generationGoalQuestion,
  generationGoalStats,
  shouldAskGenerationGoalQuestion
} = require('../src/lib/generationGoal.cjs')

describe('generationGoal', () => {
  test('detects explicit target counts from source or context', () => {
    expect(detectGenerationGoal({
      contextPrompt: 'HSK 1 study',
      parsedText: 'This source has 150 vocabulary entries.'
    })).toMatchObject({
      targetCardCount: 150,
      source: 'detected'
    })

    expect(detectGenerationGoal({
      contextPrompt: 'Create 80 flashcards for exam review',
      parsedText: 'notes'
    })).toMatchObject({
      targetCardCount: 80,
      source: 'detected'
    })
  })

  test('detects reliable numbered source entries', () => {
    const source = Array.from({ length: 12 }, (_item, index) => `${index + 1}. word ${index + 1}`).join('\n')
    expect(detectGenerationGoal({ parsedText: source })).toMatchObject({
      targetCardCount: 12,
      source: 'detected'
    })
  })

  test('returns no target for ambiguous sources and asks clarification', () => {
    const goal = detectGenerationGoal({ parsedText: 'Some study notes without a list count.' })
    expect(goal.targetCardCount).toBeNull()
    expect(shouldAskGenerationGoalQuestion([], [], goal)).toBe(true)
    expect(generationGoalQuestion()).toContain('How many final cards')
  })

  test('extracts target from clarification answers', () => {
    expect(extractGenerationGoalFromClarifications([
      { question: generationGoalQuestion(), answer: 'I want 150 cards total.' }
    ])).toMatchObject({
      targetCardCount: 150,
      source: 'clarified'
    })
  })

  test('accepted samples count toward target through duplicate key count', () => {
    const stats = generationGoalStats({
      batchSize: 10,
      maxBatches: 20,
      generationGoal: { targetCardCount: 150, source: 'detected' }
    }, 3)

    expect(stats.currentCardCount).toBe(3)
    expect(stats.remainingToTarget).toBe(147)
    expect(stats.limit).toBe(200)
  })

  test('current card count drives target progress independently of duplicate keys', () => {
    const stats = generationGoalStats({
      batchSize: 10,
      maxBatches: 20,
      duplicateKeys: Array.from({ length: 50 }, (_item, index) => `key-${index}`),
      generationGoal: { targetCardCount: 150, source: 'detected' }
    }, 165)

    expect(stats.currentCardCount).toBe(165)
    expect(stats.remainingToTarget).toBe(0)
    expect(stats.targetMet).toBe(true)
  })
})
