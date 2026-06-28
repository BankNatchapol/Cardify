export type CardState = 'new' | 'learning' | 'review' | 'relearning'
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'

export interface DeckOptions {
  dailyNewLimit: number
  dailyReviewLimit: number
  schedulerType: 'simple' | 'fsrs'
  desiredRetention: number
  learningSteps: string[]
  relearningSteps: string[]
}

export interface SchedulerCard {
  id: string
  deckId: string
  state: CardState
  dueAt?: string | null
  intervalDays: number
  stability?: number | null
  difficulty?: number | null
  reps: number
  lapses: number
  suspended: number
}

export interface ReviewInput {
  card: SchedulerCard
  rating: ReviewRating
  reviewedAt: Date
  elapsedMs?: number
  deckOptions: DeckOptions
}

export interface ReviewOutput {
  nextState: CardState
  dueAt: Date
  intervalDays: number
  stability?: number | null
  difficulty?: number | null
  log: {
    previousState: CardState
    nextState: CardState
    previousDueAt?: string
    nextDueAt: string
    previousIntervalDays: number
    nextIntervalDays: number
    schedulerVersion: string
  }
}
