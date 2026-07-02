import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import React, { useCallback, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import Screen from '../../src/components/Screen'
import { exportDeckPackage } from '../../src/services/backup'
import { deleteDeck, getDeck, getDeckOptions, getStats, listDecks, resetDeckLearningProgress, shuffleDeck, updateDeck, updateDeckOptions } from '../../src/db/repositories'
import { getWidgetDeckId, setWidgetDeckId } from '../../src/services/widgetSync'
import { colors, fonts, radius, spacing } from '../../src/styles/theme'

function CountPill ({ tone, count, label }: {
  tone: 'new' | 'learning' | 'review'
  count: number
  label: string
}) {
  const palette = {
    new:      { bg: colors.stateNewBg,      fg: colors.stateNewFg },
    learning: { bg: colors.stateLearningBg, fg: colors.stateLearningFg },
    review:   { bg: colors.stateReviewBg,   fg: colors.stateReviewFg },
  }[tone]
  return (
    <View style={[cp.pill, { backgroundColor: palette.bg }]}>
      <Text style={[cp.count, { color: palette.fg }]}>{count}</Text>
      <Text style={[cp.label, { color: palette.fg }]}>{label}</Text>
    </View>
  )
}
const cp = StyleSheet.create({
  pill:  { flexDirection: 'row', alignItems: 'baseline', gap: 4, paddingVertical: 5, paddingHorizontal: 12, borderRadius: radius.full },
  count: { fontFamily: fonts.display, fontSize: 17, fontWeight: '600' },
  label: { fontFamily: fonts.sans, fontSize: 12, fontWeight: '600' },
})

function ProgressBar ({ value }: { value: number }) {
  const clamped = Math.min(Math.max(value, 0), 100)
  return (
    <View style={pb.track}>
      <View style={[pb.fill, { width: `${clamped}%` as any }]} />
    </View>
  )
}
const pb = StyleSheet.create({
  track: { height: 6, borderRadius: radius.full, backgroundColor: colors.primaryTint, overflow: 'hidden' },
  fill:  { height: '100%', borderRadius: radius.full, backgroundColor: colors.primary },
})

export default function DeckScreen () {
  const { deckId } = useLocalSearchParams<{ deckId: string }>()
  const [deck, setDeck] = useState<any>(null)
  const [counts, setCounts] = useState<any>(null)
  const [reviewsToday, setReviewsToday] = useState(0)
  const [deckOptions, setDeckOptions] = useState<any>(null)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editDailyNewLimit, setEditDailyNewLimit] = useState('')
  const [editDailyReviewLimit, setEditDailyReviewLimit] = useState('')
  const [widgetDeckId, setWidgetDeckIdState] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!deckId) return
    const d = await getDeck(deckId)
    setDeck(d)
    if (d) {
      setEditName(d.displayName)
      const desc = d.description
      const purposeText = desc && typeof desc === 'object' && !Array.isArray(desc) ? (desc as any).purpose ?? '' : typeof desc === 'string' ? desc : ''
      setEditDesc(purposeText)
    }
    const [allDecks, stats, options, currentWidgetDeckId] = await Promise.all([listDecks(), getStats(deckId), getDeckOptions(deckId), getWidgetDeckId()])
    setCounts(allDecks.find(item => item.id === deckId))
    setReviewsToday(stats.reviewsToday)
    setDeckOptions(options)
    setEditDailyNewLimit(String(options.dailyNewLimit))
    setEditDailyReviewLimit(String(options.dailyReviewLimit))
    setWidgetDeckIdState(currentWidgetDeckId)
  }, [deckId])

  const handleToggleWidgetDeck = async () => {
    const nextId = widgetDeckId === deckId ? null : deckId
    await setWidgetDeckId(nextId)
    setWidgetDeckIdState(nextId)
  }

  useFocusEffect(useCallback(() => { load() }, [load]))

  const handleSave = async () => {
    if (!editName.trim()) { Alert.alert('Name required', 'Deck name cannot be empty.'); return }
    const dailyNewLimit = parseInt(editDailyNewLimit, 10)
    const dailyReviewLimit = parseInt(editDailyReviewLimit, 10)
    if (!Number.isFinite(dailyNewLimit) || dailyNewLimit < 0 || !Number.isFinite(dailyReviewLimit) || dailyReviewLimit < 0) {
      Alert.alert('Invalid limits', 'Daily new cards and daily review limit must be numbers of 0 or more.')
      return
    }
    await updateDeck(deckId, editName, editDesc || undefined)
    await updateDeckOptions(deckId, { dailyNewLimit, dailyReviewLimit })
    await load()
    setEditing(false)
  }

  const handleShuffle = async () => {
    await shuffleDeck(deckId)
    Alert.alert('Shuffled', 'New cards will now appear in a random order.')
  }

  const handleResetLearning = () => {
    Alert.alert(
      'Reset learning?',
      `This resets every card in "${deck.displayName}" back to new and permanently deletes its review history. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await resetDeckLearningProgress(deckId)
            await load()
          }
        }
      ]
    )
  }

  const handleDelete = () => {
    Alert.alert(
      'Delete deck?',
      `This permanently deletes "${deck.displayName}" and all its cards. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteDeck(deckId)
            router.replace('/')
          }
        }
      ]
    )
  }

  if (!deck) return (
    <Screen><Text style={styles.loading}>Loading deck…</Text></Screen>
  )

  const total = (counts?.newCount ?? 0) + (counts?.learningCount ?? 0) + (counts?.reviewCount ?? 0)
  const goalTotal = deckOptions?.dailyNewLimit ?? 20
  const goalDone = reviewsToday

  return (
    <>
      <Stack.Screen options={{ title: editing ? 'Edit Deck' : deck.displayName }} />
      <Screen>
        {/* Inline edit form */}
        {editing && (
          <View style={styles.editCard}>
            <Text style={styles.editFieldLabel}>DECK NAME</Text>
            <TextInput
              style={styles.editInput}
              value={editName}
              onChangeText={setEditName}
              placeholder="Deck name"
              placeholderTextColor={colors.mutedLight}
              autoFocus
            />
            <Text style={styles.editFieldLabel}>DESCRIPTION</Text>
            <TextInput
              style={[styles.editInput, styles.editInputMulti]}
              value={editDesc}
              onChangeText={setEditDesc}
              placeholder="Optional description"
              placeholderTextColor={colors.mutedLight}
              multiline
            />
            <Text style={styles.editFieldLabel}>DAILY NEW CARDS</Text>
            <TextInput
              style={styles.editInput}
              value={editDailyNewLimit}
              onChangeText={setEditDailyNewLimit}
              placeholder="20"
              placeholderTextColor={colors.mutedLight}
              keyboardType="number-pad"
            />
            <Text style={styles.editFieldLabel}>DAILY REVIEW LIMIT</Text>
            <TextInput
              style={styles.editInput}
              value={editDailyReviewLimit}
              onChangeText={setEditDailyReviewLimit}
              placeholder="200"
              placeholderTextColor={colors.mutedLight}
              keyboardType="number-pad"
            />
            <Pressable
              style={({ pressed }) => [styles.saveBtn, pressed && styles.saveBtnPressed]}
              onPress={handleSave}
            >
              <Text style={styles.saveBtnText}>Save Changes</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryPressed]}
              onPress={handleShuffle}
            >
              <Text style={styles.secondaryBtnText}>Shuffle Deck</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, styles.resetBtn, pressed && styles.secondaryPressed]}
              onPress={handleResetLearning}
            >
              <Text style={[styles.secondaryBtnText, styles.resetBtnText]}>Reset Learning</Text>
            </Pressable>
          </View>
        )}

        {/* Study content — hidden while editing */}
        {!editing && (
          <>
            {/* Description info */}
            {(() => {
              const desc = deck.description
              const purpose = desc && typeof desc === 'object' && !Array.isArray(desc) ? (desc as any).purpose as string | undefined : typeof desc === 'string' ? desc : undefined
              return purpose ? (
                <Text style={styles.descriptionText}>{purpose}</Text>
              ) : null
            })()}

            {/* Count pills */}
            <View style={styles.pillRow}>
              {total === 0 ? (
                <View style={[styles.pill, styles.pillUpToDate]}>
                  <Text style={[styles.pillText, { color: colors.primary }]}>✓ up to date</Text>
                </View>
              ) : (
                <>
                  {(counts?.newCount ?? 0) > 0      && <CountPill tone="new"      count={counts.newCount}      label="new"      />}
                  {(counts?.learningCount ?? 0) > 0 && <CountPill tone="learning" count={counts.learningCount} label="learning" />}
                  {(counts?.reviewCount ?? 0) > 0   && <CountPill tone="review"   count={counts.reviewCount}   label="review"   />}
                </>
              )}
            </View>

            {/* Today's goal card */}
            <View style={styles.goalCard}>
              <View style={styles.goalHeader}>
                <Text style={styles.goalLabel}>TODAY'S GOAL</Text>
                <Text style={styles.goalCount}>{goalDone} / {goalTotal}</Text>
              </View>
              <ProgressBar value={goalTotal > 0 ? (goalDone / goalTotal) * 100 : 100} />
            </View>

            {/* Primary: Study */}
            <Pressable
              style={({ pressed }) => [styles.studyBtn, pressed && styles.studyBtnPressed]}
              onPress={() => router.push({ pathname: `/study/${deckId}`, params: { dueCount: String(total) } })}
            >
              <Text style={styles.studyBtnText}>
                {total > 0 ? `Study  ${total}  card${total === 1 ? '' : 's'}` : 'Study'}
              </Text>
            </Pressable>

            {/* Secondary actions */}
            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, styles.statsBtn, pressed && styles.secondaryPressed]}
              onPress={() => router.push(`/stats/${deckId}`)}
            >
              <Text style={[styles.secondaryBtnText, styles.statsBtnText]}>Stats</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryPressed]}
              onPress={() => router.push(`/browse/${deckId}`)}
            >
              <Text style={styles.secondaryBtnText}>Browse &amp; Edit</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryPressed]}
              onPress={() => setEditing(true)}
            >
              <Text style={styles.secondaryBtnText}>Edit Deck</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.secondaryBtn,
                widgetDeckId === deckId && styles.widgetBtnActive,
                pressed && styles.secondaryPressed
              ]}
              onPress={handleToggleWidgetDeck}
            >
              <Text style={[styles.secondaryBtnText, widgetDeckId === deckId && styles.widgetBtnActiveText]}>
                {widgetDeckId === deckId ? '✓ Lock Screen Widget Deck' : 'Use as Lock Screen Widget'}
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryPressed]}
              onPress={async () => {
                try { await exportDeckPackage(deckId) }
                catch (e) { Alert.alert('Export failed', e instanceof Error ? e.message : 'Unknown error') }
              }}
            >
              <Text style={styles.secondaryBtnText}>Export</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, styles.deleteBtn, pressed && styles.secondaryPressed]}
              onPress={handleDelete}
            >
              <Text style={[styles.secondaryBtnText, styles.deleteBtnText]}>Delete Deck</Text>
            </Pressable>
          </>
        )}
      </Screen>
    </>
  )
}

const styles = StyleSheet.create({
  loading: { fontFamily: fonts.sans, color: colors.muted, fontSize: 16 },

  // ── Header edit button ─────────────────────────────────────────────────────
  editBtn: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    shadowColor: colors.primaryPress,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  editBtnText: {
    fontFamily: fonts.sans,
    color: colors.primary,
    fontWeight: '700',
    fontSize: 16,
  },

  // ── Edit form ──────────────────────────────────────────────────────────────
  editCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    padding: spacing.md,
    gap: spacing.sm,
    shadowColor: '#2B2722',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  editFieldLabel: {
    fontFamily: fonts.sans,
    fontSize: 10,
    fontWeight: '800',
    color: colors.mutedLight,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  editInput: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.text,
    padding: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    minHeight: 44,
  },
  editInputMulti: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radius.lg,
    alignItems: 'center',
    marginTop: spacing.xs,
    shadowColor: colors.primaryPress,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 3,
  },
  saveBtnPressed: { opacity: 0.88, transform: [{ scale: 0.97 }] },
  saveBtnText: {
    fontFamily: fonts.sans,
    color: colors.textOnPrimary,
    fontWeight: '800',
    fontSize: 16,
  },
  cancelText: {
    fontFamily: fonts.sans,
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: spacing.xs,
  },

  descriptionText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
  },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: radius.full },
  pillUpToDate: { backgroundColor: colors.primaryTint },
  pillText: { fontFamily: fonts.sans, fontSize: 13, fontWeight: '700' },

  // ── Today's goal ──────────────────────────────────────────────────────────
  goalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    shadowColor: '#2B2722',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  goalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  goalLabel: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: '800',
    color: colors.mutedLight,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  goalCount: {
    fontFamily: fonts.sans,
    fontSize: 13,
    fontWeight: '700',
    color: colors.textBody,
  },

  // ── Buttons ────────────────────────────────────────────────────────────────
  studyBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 18,
    borderRadius: radius.lg,
    alignItems: 'center',
    shadowColor: colors.primaryPress,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 4,
    marginTop: spacing.xs,
  },
  studyBtnPressed: { opacity: 0.88, transform: [{ scale: 0.97 }] },
  studyBtnText: {
    fontFamily: fonts.sans,
    color: colors.textOnPrimary,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  secondaryBtn: {
    paddingVertical: 15,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    shadowColor: '#2B2722',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  secondaryPressed: { opacity: 0.80 },
  secondaryBtnText: {
    fontFamily: fonts.sans,
    color: colors.textBody,
    fontWeight: '700',
    fontSize: 15,
  },
  statsBtn: {
    borderColor: colors.stateNewFg,
    backgroundColor: colors.stateNewBg,
  },
  statsBtnText: {
    color: colors.stateNewFg,
  },
  widgetBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  widgetBtnActiveText: {
    color: colors.primaryPress,
  },
  resetBtn: {
    borderColor: colors.stateLearningFg,
  },
  resetBtnText: {
    color: colors.stateLearningFg,
  },
  deleteBtn: {
    borderColor: colors.accent,
  },
  deleteBtnText: {
    color: colors.danger,
  },
})
