'use strict'

const DEFAULT_GENERATION_GOAL = {
  targetCardCount: null,
  source: 'unknown',
  reason: '',
  shortfallRepairAttempted: false
}

function normalizeGenerationGoal (goal = {}) {
  const target = Number.parseInt(goal.targetCardCount, 10)
  return {
    targetCardCount: Number.isFinite(target) && target > 0 ? target : null,
    source: ['detected', 'clarified', 'manual', 'unknown'].includes(goal.source) ? goal.source : 'unknown',
    reason: String(goal.reason || '').trim(),
    shortfallRepairAttempted: Boolean(goal.shortfallRepairAttempted)
  }
}

function detectGenerationGoal (parts = {}) {
  const contextPrompt = String(parts.contextPrompt || '')
  const parsedText = String(parts.parsedText || parts.sourceText || '')
  const explicitContext = detectExplicitCount(contextPrompt)
  if (explicitContext) return explicitContext
  const numbered = detectNumberedListCount(parsedText)
  if (numbered) return numbered
  const explicit = detectExplicitCount(parsedText.slice(0, 240000))
  if (explicit) return explicit
  return normalizeGenerationGoal()
}

function needsGenerationTargetClarification (goal) {
  return !normalizeGenerationGoal(goal).targetCardCount
}

function generationGoalQuestion () {
  return 'How many final cards should this deck contain?'
}

function extractGenerationGoalFromClarifications (history = []) {
  for (const item of Array.isArray(history) ? history : []) {
    const question = String(item?.question || '').toLowerCase()
    const answer = String(item?.answer || '')
    if (!/how many final cards|how many cards|card count|final cards/.test(question)) continue
    const match = answer.match(/\b(\d{1,5})\b/)
    if (!match) continue
    const target = Number.parseInt(match[1], 10)
    if (target > 0) {
      return normalizeGenerationGoal({
        targetCardCount: target,
        source: 'clarified',
        reason: `User clarified target card count: ${target}`
      })
    }
  }
  return normalizeGenerationGoal()
}

function generationGoalStats (progress = {}, currentCardCount = 0) {
  const goal = normalizeGenerationGoal(progress.generationGoal)
  const current = Math.max(0, Number.parseInt(currentCardCount, 10) || 0)
  const limit = (Number(progress.batchSize) || 10) * (Number(progress.maxBatches) || 20)
  const target = goal.targetCardCount || null
  return {
    goal,
    currentCardCount: current,
    targetCardCount: target,
    limit,
    remainingToTarget: target ? Math.max(0, target - current) : null,
    targetMet: target ? current >= target : false
  }
}

function shouldAskGenerationGoalQuestion (questions = [], history = [], goal = {}) {
  if (!needsGenerationTargetClarification(goal)) return false
  const targetQuestion = generationGoalQuestion().toLowerCase()
  const hasQuestion = (questions || []).some(question => String(question || '').trim().toLowerCase() === targetQuestion)
  const hasAnswer = (history || []).some(item => String(item?.question || '').trim().toLowerCase() === targetQuestion && String(item?.answer || '').trim())
  return !hasQuestion && !hasAnswer
}

function detectExplicitCount (text) {
  const patterns = [
    /\b(\d{1,5})\s+(?:cards?|flashcards?)\b/i,
    /\b(\d{1,5})\s+(?:words?|terms?|vocab(?:ulary)?(?:\s+entries?)?)\b/i,
    /\b(?:words?|terms?|vocab(?:ulary)?(?:\s+entries?)?)\D{0,30}\b(\d{1,5})\b/i,
    /\bHSK\s*\d\b[^\n]{0,80}\b(\d{1,5})\b/i
  ]
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern)
    if (!match) continue
    const target = Number.parseInt(match[1], 10)
    if (target > 0) {
      return normalizeGenerationGoal({
        targetCardCount: target,
        source: 'detected',
        reason: `Detected explicit target count: ${target}`
      })
    }
  }
  return null
}

function detectNumberedListCount (text) {
  const numbers = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*(\d{1,5})[\).、．\s-]+/)
    if (match) numbers.push(Number.parseInt(match[1], 10))
  }
  if (numbers.length < 10) return null
  const unique = [...new Set(numbers)].sort((a, b) => a - b)
  if (unique[0] !== 1) return null
  const last = unique[unique.length - 1]
  if (last >= 10 && unique.length / last >= 0.8) {
    return normalizeGenerationGoal({
      targetCardCount: last,
      source: 'detected',
      reason: `Detected numbered source entries 1-${last}`
    })
  }
  return null
}

module.exports = {
  DEFAULT_GENERATION_GOAL,
  normalizeGenerationGoal,
  detectGenerationGoal,
  needsGenerationTargetClarification,
  generationGoalQuestion,
  extractGenerationGoalFromClarifications,
  generationGoalStats,
  shouldAskGenerationGoalQuestion
}
