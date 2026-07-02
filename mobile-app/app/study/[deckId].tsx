import { Stack, useLocalSearchParams } from 'expo-router'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useAudioPlayer } from 'expo-audio'
import Markdown from 'react-native-markdown-display'
import { getCardAudio, getCardById, getNextStudyCard, rateCard, type MobileCard } from '../../src/db/repositories'
import { syncWidget } from '../../src/services/widgetSync'
import { cfMarkdownIt, createCfMarkdownRules } from '../../src/lib/cardHighlights'
import { containsCJK } from '../../src/lib/textScript'
import { colors, fonts, radius, spacing } from '../../src/styles/theme'

const soundAssets = {
  again: require('../../assets/sounds/again.mp3'),
  hard: require('../../assets/sounds/hard.mp3'),
  good: require('../../assets/sounds/good.mp3'),
  easy: require('../../assets/sounds/easy.mp3'),
}

const mdStyles = {
  body: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.textBody,
    lineHeight: 34,
    textAlign: 'left' as const,
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
  cf_key: { color: colors.primaryPress, fontWeight: '700' as const },
  cf_warning: { color: colors.stateLearningFg, fontWeight: '700' as const },
  cf_success: { color: colors.primary, fontWeight: '700' as const },
  cf_muted: { color: colors.muted },
  cf_mark: { color: colors.stateLearningFg, backgroundColor: colors.stateLearningBg },
}

type ReviewRating = 'again' | 'hard' | 'good' | 'easy'

const RATING_CONFIG: { rating: ReviewRating; label: string; color: string; hint: string }[] = [
  { rating: 'again', label: 'Again', color: colors.ratingAgain, hint: '<1m' },
  { rating: 'hard',  label: 'Hard',  color: colors.ratingHard,  hint: '~10m' },
  { rating: 'good',  label: 'Good',  color: colors.ratingGood,  hint: '1d' },
  { rating: 'easy',  label: 'Easy',  color: colors.ratingEasy,  hint: '3d' },
]


export default function StudyScreen () {
  const { deckId, dueCount, cardId } = useLocalSearchParams<{ deckId: string; dueCount?: string; cardId?: string }>()
  const due = dueCount ? parseInt(dueCount, 10) : 0

  const [card, setCard] = useState<MobileCard | null>(null)
  const [answerShown, setAnswerShown] = useState(false)
  const [startedAt, setStartedAt] = useState(Date.now())
  const [cardsRated, setCardsRated] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)

  const activeMdStyles = useMemo(
    () => (card && containsCJK(card.back))
      ? { ...mdStyles, body: { ...mdStyles.body, fontFamily: 'PingFang SC' } }
      : mdStyles,
    [card]
  )

  const [cardAudioMap, setCardAudioMap] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!card) { setCardAudioMap({}); return }
    getCardAudio(card.noteId).then(setCardAudioMap)
  }, [card?.noteId])

  const cfMarkdownRules = useMemo(
    () => createCfMarkdownRules(activeMdStyles, (slot) => cardAudioMap[slot] ?? null),
    [activeMdStyles, cardAudioMap]
  )

  const players = {
    again: useAudioPlayer(soundAssets.again),
    hard: useAudioPlayer(soundAssets.hard),
    good: useAudioPlayer(soundAssets.good),
    easy: useAudioPlayer(soundAssets.easy),
  }

  const translateX = useRef(new Animated.Value(0)).current
  const cardOpacity = useRef(new Animated.Value(1)).current
  const cardScale = useRef(new Animated.Value(1)).current
  const auraOpacity = useRef(new Animated.Value(0)).current
  const [auraColor, setAuraColor] = useState(colors.ratingAgain)

  // Opening Study from the Lock Screen widget should show the exact card the
  // widget displayed, not whatever the due-order queue would pick first —
  // otherwise tapping a card you recognized on the Lock Screen lands you on
  // a different one. Falls back to the normal queue if the card's gone.
  const loadInitial = async () => {
    if (!deckId) return
    const initialCard = cardId ? await getCardById(cardId) : null
    setCard(initialCard ?? await getNextStudyCard(deckId))
    setAnswerShown(false)
    setStartedAt(Date.now())
  }

  // Depends on cardId too: if the app is already sitting on this screen
  // (same deck) and the widget is tapped again for a different card, only
  // the cardId param changes — without it in the deps, the effect wouldn't
  // notice and the screen would keep showing whatever was already loaded.
  useEffect(() => { loadInitial() }, [deckId, cardId])

  const playRatingSound = async (rating: ReviewRating) => {
    const player = players[rating]
    try {
      await player.seekTo(0)
      player.play()
    } catch {
      // Playback is a non-critical nicety — never let a dropped seek/play block rating a card.
    }
  }

  const triggerAura = (rating: ReviewRating) => {
    setAuraColor(RATING_CONFIG.find(r => r.rating === rating)!.color)
    auraOpacity.setValue(0)
    Animated.sequence([
      Animated.timing(auraOpacity, { toValue: 1, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(auraOpacity, { toValue: 0, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start()
  }

  const handleRate = (rating: ReviewRating) => {
    if (!card || isTransitioning) return
    setIsTransitioning(true)
    playRatingSound(rating)
    triggerAura(rating)

    const ratingWork = (async () => {
      await rateCard(card, rating, Date.now() - startedAt)
      // getNextStudyCard is on the critical path for the entrance animation
      // below, which assumes the DB round-trip resolves fast enough to be
      // imperceptible — syncWidget() does its own DB queries, and running it
      // concurrently contends for the same SQLite connection, slowing down
      // getNextStudyCard enough to cause a visible flicker. Firing it only
      // after the next card is already fetched keeps it off that critical path.
      const next = await getNextStudyCard(deckId)
      syncWidget().catch(() => {})
      return next
    })()

    const exit = (rating === 'again' || rating === 'hard')
      ? Animated.parallel([
          Animated.timing(translateX, { toValue: -90, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(cardOpacity, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ])
      : Animated.parallel([
          Animated.timing(cardOpacity, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(cardScale, { toValue: 0.85, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ])

    exit.start(() => {
      translateX.setValue(0)
      cardOpacity.setValue(0)
      cardScale.setValue(0.96)

      ratingWork.then(next => {
        setCard(next)
        setAnswerShown(false)
        setStartedAt(Date.now())
        setCardsRated(n => n + 1)

        // setCard() only *schedules* a re-render — it doesn't mean the new
        // card's view tree (markdown, audio buttons, CJK font logic) has
        // actually committed to screen yet. Starting the native-driven
        // opacity animation synchronously right after setCard races that
        // commit: opacity can start climbing on the UI thread while the JS
        // thread is still mid-render on the OLD view, so the old card is
        // what's actually visible while it fades in — then it jump-cuts to
        // the new content once React catches up. This happens on every
        // rating (the exit animation shape above doesn't matter), because
        // the race is between React's commit and the entrance animation,
        // not anything specific to the slide. Waiting a couple of frames
        // gives React room to actually commit before opacity starts moving.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            Animated.parallel([
              Animated.timing(cardOpacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
              Animated.timing(cardScale, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            ]).start(() => setIsTransitioning(false))
          })
        })
      })
    })
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
        <View style={styles.flashcardWrap}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.aura,
              { backgroundColor: `${auraColor}33`, shadowColor: auraColor, opacity: auraOpacity },
            ]}
          />
          <Animated.View
            style={[
              styles.flashcard,
              { opacity: cardOpacity, transform: [{ translateX }, { scale: cardScale }] },
            ]}
          >
          {/* Front section */}
          <View style={[styles.cardHalf, !answerShown && styles.cardHalfFull]}>
            <Text style={styles.sectionLabel}>FRONT</Text>
            <Text
              style={[styles.frontText, containsCJK(card.front) && styles.frontTextCJK]}
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
                  <Markdown style={activeMdStyles} markdownit={cfMarkdownIt} rules={cfMarkdownRules}>{card.back}</Markdown>
                </ScrollView>
              </View>
            </>
          )}
          </Animated.View>
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
                  disabled={isTransitioning}
                  style={({ pressed }) => [styles.ratingBtn, { backgroundColor: color }, pressed && styles.ratingBtnPressed, isTransitioning && styles.ratingBtnDisabled]}
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
  flashcardWrap: {
    flex: 1,
    position: 'relative',
  },
  aura: {
    position: 'absolute',
    top: -14,
    left: -14,
    right: -14,
    bottom: -14,
    borderRadius: radius.xl + 14,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 30,
    shadowOpacity: 0.9,
    elevation: 20,
  },
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
  frontTextCJK: {
    fontFamily: 'PingFang SC',
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
  ratingBtnDisabled: {
    opacity: 0.5,
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
