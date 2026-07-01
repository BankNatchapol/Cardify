import { Stack, useLocalSearchParams } from 'expo-router'
import React, { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Markdown from 'react-native-markdown-display'
import { getNextStudyCard, rateCard, type MobileCard } from '../../src/db/repositories'
import { colors, fonts, radius, spacing } from '../../src/styles/theme'

type ReviewRating = 'again' | 'hard' | 'good' | 'easy'

const RATING_CONFIG: { rating: ReviewRating; label: string; color: string; hint: string }[] = [
  { rating: 'again', label: 'Again', color: colors.ratingAgain, hint: '<1m' },
  { rating: 'hard',  label: 'Hard',  color: colors.ratingHard,  hint: '~10m' },
  { rating: 'good',  label: 'Good',  color: colors.ratingGood,  hint: '1d' },
  { rating: 'easy',  label: 'Easy',  color: colors.ratingEasy,  hint: '3d' },
]


export default function StudyScreen () {
  const { deckId, dueCount } = useLocalSearchParams<{ deckId: string; dueCount?: string }>()
  const due = dueCount ? parseInt(dueCount, 10) : 0

  const [card, setCard] = useState<MobileCard | null>(null)
  const [answerShown, setAnswerShown] = useState(false)
  const [startedAt, setStartedAt] = useState(Date.now())
  const [cardsRated, setCardsRated] = useState(0)

  const loadNext = async () => {
    if (!deckId) return
    setCard(await getNextStudyCard(deckId))
    setAnswerShown(false)
    setStartedAt(Date.now())
  }

  useEffect(() => { loadNext() }, [deckId])

  const handleRate = async (rating: ReviewRating) => {
    if (!card) return
    await rateCard(card, rating, Date.now() - startedAt)
    setCardsRated(n => n + 1)
    await loadNext()
  }

  const progressPct = due > 0 ? (cardsRated / due) * 100 : 0

  // Empty / done state
  if (!card) {
    return (
      <>
        <Stack.Screen options={{ headerRight: undefined }} />
        <View style={styles.container}>
          <View style={styles.doneCard}>
            <View style={styles.doneIconWrap}>
              <Text style={styles.doneIcon}>✓</Text>
            </View>
            <Text style={styles.doneTitle}>All caught up.</Text>
            <Text style={styles.doneBody}>
              Come back later for your next review.
            </Text>
          </View>
        </View>
      </>
    )
  }

  return (
    <>
      <Stack.Screen options={{ headerRight: undefined }} />

      <View style={styles.container}>
        {/* Flashcard */}
        <View style={styles.flashcard}>
          {/* Front section */}
          <View style={[styles.cardHalf, !answerShown && styles.cardHalfFull]}>
            <Text style={styles.sectionLabel}>FRONT</Text>
            <Text
              style={styles.frontText}
              adjustsFontSizeToFit
              minimumFontScale={0.2}
              numberOfLines={card.front.length <= 8 ? 1 : 2}
            >
              {card.front}
            </Text>
          </View>

          {/* Back section — revealed after "Show Answer" */}
          {answerShown && (
            <>
              <View style={styles.divider} />
              <View style={styles.cardHalf}>
                <Text style={styles.sectionLabel}>BACK</Text>
                <ScrollView
                  style={styles.backScroll}
                  showsVerticalScrollIndicator={false}
                >
                  <Markdown style={mdStyles}>{card.back}</Markdown>
                </ScrollView>
              </View>
            </>
          )}
        </View>

        {/* Progress bar + count — between card and buttons */}
        {due > 0 && (
          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressPct}%` as any }]} />
            </View>
            <Text style={styles.progressLabel}>{cardsRated} / {due}</Text>
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          {!answerShown ? (
            <Pressable
              style={({ pressed }) => [styles.showBtn, pressed && styles.showBtnPressed]}
              onPress={() => setAnswerShown(true)}
            >
              <Text style={styles.showBtnText}>Show Answer</Text>
            </Pressable>
          ) : (
            <View style={styles.ratingRow}>
              {RATING_CONFIG.map(({ rating, label, color, hint }) => (
                <Pressable
                  key={rating}
                  style={({ pressed }) => [styles.ratingBtn, { backgroundColor: color }, pressed && styles.ratingBtnPressed]}
                  onPress={() => handleRate(rating)}
                >
                  <Text style={styles.ratingLabel}>{label}</Text>
                  <Text style={styles.ratingHint}>{hint}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </View>
    </>
  )
}

const mdStyles = {
  body: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.textBody,
    lineHeight: 34,
    textAlign: 'center' as const,
  },
  strong: { fontWeight: '800' as const, color: colors.text },
  em: { fontStyle: 'italic' as const, color: colors.textBody },
  code_inline: {
    fontFamily: fonts.mono,
    fontSize: 18,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 4,
    color: colors.accent,
    paddingHorizontal: 4,
  },
  fence: {
    fontFamily: fonts.mono,
    fontSize: 15,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 8,
    padding: 12,
    color: colors.text,
  },
  bullet_list: { marginTop: 4 },
  ordered_list: { marginTop: 4 },
  list_item: { flexDirection: 'row' as const, marginBottom: 4 },
  paragraph: { marginBottom: 8 },
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.page,
    gap: spacing.sm,
  },

  // ── Progress row ───────────────────────────────────────────────────────────
  progressRow: {
    gap: 6,
  },
  progressTrack: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceDeep,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  progressLabel: {
    fontFamily: fonts.sans,
    fontSize: 12,
    fontWeight: '700',
    color: colors.mutedLight,
    textAlign: 'right',
  },

  // ── Flashcard ──────────────────────────────────────────────────────────────
  flashcard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1.5,
    borderColor: colors.primaryTint,
    padding: spacing.xl,
    // Warm espresso shadow
    shadowColor: '#2B2722',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 6,
  },
  cardHalf: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardHalfFull: {
    flex: 1,
  },
  sectionLabel: {
    fontFamily: fonts.sans,
    color: colors.mutedLight,
    fontWeight: '800',
    textTransform: 'uppercase',
    fontSize: 11,
    letterSpacing: 1.8,
  },
  frontText: {
    fontFamily: fonts.display,
    fontSize: 140,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    width: '100%',
  },
  backScroll: { flex: 1, width: '100%' },
  divider: {
    height: 1,
    backgroundColor: colors.borderSubtle,
    marginVertical: spacing.md,
  },

  // ── Actions ────────────────────────────────────────────────────────────────
  actions: {
    paddingTop: spacing.xs,
  },
  showBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 18,
    borderRadius: radius.lg,
    alignItems: 'center',
    shadowColor: colors.primaryPress,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 4,
  },
  showBtnPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.97 }],
  },
  showBtnText: {
    fontFamily: fonts.sans,
    color: colors.textOnPrimary,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  ratingRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  ratingBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    gap: 2,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 3,
  },
  ratingBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  ratingLabel: {
    color: '#FFFDF8',
    fontWeight: '800',
    fontSize: 14,
    fontFamily: fonts.sans,
  },
  ratingHint: {
    color: 'rgba(255,253,248,0.72)',
    fontWeight: '600',
    fontSize: 11,
    fontFamily: fonts.sans,
  },

  // ── All caught up ─────────────────────────────────────────────────────────
  doneCard: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  doneIconWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  doneIcon: {
    fontSize: 32,
    color: colors.primary,
  },
  doneTitle: {
    fontFamily: fonts.display,
    fontSize: 28,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  doneBody: {
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 24,
  },
})
