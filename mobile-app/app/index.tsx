import { router, useFocusEffect } from 'expo-router'
import React, { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Screen from '../src/components/Screen'
import { listDecks, seedSampleDeck, type MobileDeck } from '../src/db/repositories'
import { colors, fonts, radius, spacing } from '../src/styles/theme'

// CountPill — warm state-tinted chips matching the design system
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
    <View style={[cpStyles.pill, { backgroundColor: palette.bg }]}>
      <Text style={[cpStyles.count, { color: palette.fg }]}>{count}</Text>
      <Text style={[cpStyles.label, { color: palette.fg }]}>{label}</Text>
    </View>
  )
}
const cpStyles = StyleSheet.create({
  pill:  { flexDirection: 'row', alignItems: 'baseline', gap: 4, paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.full },
  count: { fontFamily: fonts.display, fontSize: 15, fontWeight: '600' },
  label: { fontFamily: fonts.sans, fontSize: 12, fontWeight: '600' },
})

export default function DecksScreen () {
  const [decks, setDecks] = useState<MobileDeck[]>([])

  const refresh = useCallback(async () => {
    setDecks(await listDecks())
  }, [])

  useFocusEffect(useCallback(() => { refresh() }, [refresh]))

  const handleSeed = async () => { await seedSampleDeck(); await refresh() }

  return (
    <>
      <Screen>

      {/* Import button */}
      <Pressable
        style={({ pressed }) => [styles.importBtn, pressed && styles.pressed]}
        onPress={() => router.push('/import')}
      >
        <Text style={styles.importBtnText}>+ Import Deck</Text>
      </Pressable>

      {/* Empty state */}
      {decks.length === 0 && (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIcon}>
            <Text style={styles.emptyIconGlyph}>⊕</Text>
          </View>
          <Text style={styles.emptyTitle}>No decks yet.</Text>
          <Text style={styles.emptyBody}>
            Import a .cardify.json from Cardify Desktop, or try sample cards to explore.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.seedBtn, pressed && styles.pressed]}
            onPress={handleSeed}
          >
            <Text style={styles.seedBtnText}>Load Sample Deck</Text>
          </Pressable>
        </View>
      )}

      {/* Deck list */}
      {decks.map(deck => {
        const total = deck.newCount + deck.learningCount + deck.reviewCount
        return (
          <Pressable
            key={deck.id}
            style={({ pressed }) => [styles.deckCard, pressed && styles.deckCardPressed]}
            onPress={() => router.push(`/deck/${deck.id}`)}
          >
            <View style={styles.deckCardInner}>
              <View style={styles.deckCardLeft}>
                <Text style={styles.deckName} numberOfLines={2}>{deck.displayName}</Text>
                <View style={styles.pillRow}>
                  {deck.newCount > 0      && <CountPill tone="new"      count={deck.newCount}      label="new"      />}
                  {deck.learningCount > 0 && <CountPill tone="learning" count={deck.learningCount} label="learning" />}
                  {deck.reviewCount > 0   && <CountPill tone="review"   count={deck.reviewCount}   label="review"   />}
                  {total === 0 && (
                    <View style={styles.upToDate}>
                      <Text style={styles.upToDateText}>✓ up to date</Text>
                    </View>
                  )}
                </View>
              </View>
              <Text style={styles.chevron}>›</Text>
            </View>
          </Pressable>
        )
      })}

      </Screen>
    </>
  )
}

const styles = StyleSheet.create({
  importBtn: {
    paddingVertical: 15,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    shadowColor: colors.primaryPress,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 3,
  },
  importBtnText: {
    fontFamily: fonts.sans,
    color: colors.textOnPrimary,
    fontWeight: '800',
    fontSize: 16,
  },
  pressed: { opacity: 0.80, transform: [{ scale: 0.97 }] },

  // ── Empty state ────────────────────────────────────────────────────────────
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    shadowColor: '#2B2722',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.xl,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyIconGlyph: { fontSize: 30, color: colors.primary },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 22,
  },
  seedBtn: {
    marginTop: spacing.xs,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  seedBtnText: {
    fontFamily: fonts.sans,
    color: colors.primary,
    fontWeight: '700',
    fontSize: 15,
  },

  // ── Deck cards ─────────────────────────────────────────────────────────────
  deckCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: '#CEC4B4',
    shadowColor: '#2B2722',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  deckCardPressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  deckCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  deckCardLeft: { flex: 1, gap: 8 },
  deckName: {
    fontFamily: fonts.display,
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  upToDate: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.full,
    backgroundColor: colors.primaryTint,
  },
  upToDateText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  chevron: {
    fontSize: 22,
    color: colors.mutedLight,
    fontWeight: '300',
  },

})
