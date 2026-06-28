import type { CardState, DeckOptions, ReviewInput, ReviewOutput, SchedulerCard } from '../../shared/src/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseStepMs (step: string): number {
  const m = step.match(/^(\d+)(m|h|d)$/)
  if (!m) return 10 * 60 * 1000
  const n = parseInt(m[1], 10)
  if (m[2] === 'm') return n * 60 * 1000
  if (m[2] === 'h') return n * 60 * 60 * 1000
  return n * 24 * 60 * 60 * 1000
}

function addMs (date: Date, ms: number): Date {
  return new Date(date.getTime() + ms)
}

function addDays (date: Date, days: number): Date {
  return new Date(date.getTime() + Math.max(1, days) * 86_400_000)
}

// ─── Simple scheduler ─────────────────────────────────────────────────────────

const SIMPLE_VERSION = 'simple-1.0'
const DEFAULT_EASE = 2.5
const MIN_EASE = 1.3
const MAX_EASE = 2.5
const EASY_BONUS = 1.3

export function review (params: ReviewInput): ReviewOutput {
  const { card, rating, reviewedAt, deckOptions } = params
  const lSteps = deckOptions.learningSteps ?? ['1m', '10m']
  const rSteps = deckOptions.relearningSteps ?? ['10m']
  const ease = card.difficulty ?? DEFAULT_EASE
  const prevState = card.state
  const prevInterval = card.intervalDays

  let nextState: CardState
  let dueAt: Date
  let nextIntervalDays: number
  let nextDifficulty = ease

  if (card.state === 'new' || card.state === 'learning') {
    if (rating === 'again' || rating === 'hard') {
      nextState = 'learning'
      dueAt = addMs(reviewedAt, parseStepMs(lSteps[0]))
      nextIntervalDays = parseStepMs(lSteps[0]) / 86_400_000
    } else if (rating === 'good') {
      nextState = 'review'
      nextIntervalDays = 1
      dueAt = addDays(reviewedAt, 1)
    } else {
      nextState = 'review'
      nextIntervalDays = 4
      dueAt = addDays(reviewedAt, 4)
    }
  } else if (card.state === 'relearning') {
    if (rating === 'again') {
      nextState = 'relearning'
      dueAt = addMs(reviewedAt, parseStepMs(rSteps[0]))
      nextIntervalDays = parseStepMs(rSteps[0]) / 86_400_000
    } else if (rating === 'easy') {
      nextState = 'review'
      nextIntervalDays = Math.max(1, Math.ceil(prevInterval * 1.5))
      dueAt = addDays(reviewedAt, nextIntervalDays)
    } else {
      nextState = 'review'
      nextIntervalDays = Math.max(1, Math.ceil(prevInterval * 1.2))
      dueAt = addDays(reviewedAt, nextIntervalDays)
    }
  } else {
    if (rating === 'again') {
      nextDifficulty = Math.max(MIN_EASE, ease - 0.2)
      nextState = 'relearning'
      dueAt = addMs(reviewedAt, parseStepMs(rSteps[0]))
      nextIntervalDays = parseStepMs(rSteps[0]) / 86_400_000
    } else if (rating === 'hard') {
      nextDifficulty = Math.max(MIN_EASE, ease - 0.15)
      nextState = 'review'
      nextIntervalDays = Math.max(1, Math.ceil(prevInterval * 1.2))
      dueAt = addDays(reviewedAt, nextIntervalDays)
    } else if (rating === 'good') {
      nextState = 'review'
      nextIntervalDays = Math.max(1, Math.ceil(prevInterval * ease))
      dueAt = addDays(reviewedAt, nextIntervalDays)
    } else {
      nextDifficulty = Math.min(MAX_EASE, ease + 0.15)
      nextState = 'review'
      nextIntervalDays = Math.max(1, Math.ceil(prevInterval * ease * EASY_BONUS))
      dueAt = addDays(reviewedAt, nextIntervalDays)
    }
  }

  return {
    nextState,
    dueAt,
    intervalDays: nextIntervalDays,
    stability: card.stability,
    difficulty: nextDifficulty,
    log: {
      previousState: prevState,
      nextState,
      previousDueAt: card.dueAt ?? undefined,
      nextDueAt: dueAt.toISOString(),
      previousIntervalDays: prevInterval,
      nextIntervalDays,
      schedulerVersion: SIMPLE_VERSION
    }
  }
}

// ─── FSRS scheduler ───────────────────────────────────────────────────────────

const FSRS_VERSION = 'fsrs-4.5'

export function reviewWithFsrs (params: ReviewInput): ReviewOutput {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { fsrs, Rating, State } = require('ts-fsrs')
  const f = fsrs()
  const { card, rating, reviewedAt } = params

  const toState: Record<CardState, number> = {
    new: State.New, learning: State.Learning,
    review: State.Review, relearning: State.Relearning
  }
  const fromState: Record<number, CardState> = {
    [State.New]: 'new', [State.Learning]: 'learning',
    [State.Review]: 'review', [State.Relearning]: 'relearning'
  }
  const toRating: Record<string, number> = {
    again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy
  }

  const fsrsCard = {
    due: card.dueAt ? new Date(card.dueAt) : reviewedAt,
    stability: card.stability ?? 0,
    difficulty: card.difficulty ?? 0,
    elapsed_days: card.intervalDays,
    scheduled_days: card.intervalDays,
    reps: card.reps,
    lapses: card.lapses,
    state: toState[card.state],
    last_review: card.dueAt ? new Date(card.dueAt) : undefined
  }

  const results = f.repeat(fsrsCard, reviewedAt)
  const next = results[toRating[rating]].card
  const nextState: CardState = fromState[next.state] ?? 'new'

  return {
    nextState,
    dueAt: next.due,
    intervalDays: next.scheduled_days,
    stability: next.stability,
    difficulty: next.difficulty,
    log: {
      previousState: card.state,
      nextState,
      previousDueAt: card.dueAt ?? undefined,
      nextDueAt: next.due.toISOString(),
      previousIntervalDays: card.intervalDays,
      nextIntervalDays: next.scheduled_days,
      schedulerVersion: FSRS_VERSION
    }
  }
}

// ─── Queue builder ────────────────────────────────────────────────────────────

export type ReviewQueue = {
  learning: SchedulerCard[]
  review: SchedulerCard[]
  new: SchedulerCard[]
}

export function buildReviewQueue (
  cards: SchedulerCard[],
  now: Date,
  options: DeckOptions
): ReviewQueue {
  const nowStr = now.toISOString()
  const active = cards.filter(c => !c.suspended)

  const learning = active.filter(c =>
    (c.state === 'learning' || c.state === 'relearning') &&
    (!c.dueAt || c.dueAt <= nowStr)
  )

  const review = active.filter(c =>
    c.state === 'review' &&
    (!c.dueAt || c.dueAt <= nowStr)
  ).slice(0, options.dailyReviewLimit)

  const newCards = active
    .filter(c => c.state === 'new')
    .slice(0, options.dailyNewLimit)

  return { learning, review, new: newCards }
}

export function flattenReviewQueue (queue: ReviewQueue): SchedulerCard[] {
  return [...queue.learning, ...queue.review, ...queue.new]
}
