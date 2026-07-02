import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import React, { useCallback, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Screen from '../../src/components/Screen'
import { getStats } from '../../src/db/repositories'
import { colors, fonts, radius, spacing } from '../../src/styles/theme'

// StatCard — matches the design system's warm number display
function StatCard ({ label, value, unit, highlight }: {
  label: string
  value: number
  unit: string
  highlight?: boolean
}) {
  return (
    <View style={[sc.card, highlight && sc.cardHighlight]}>
      <Text style={sc.label}>{label.toUpperCase()}</Text>
      <Text style={[sc.value, highlight && { color: colors.primary }]}>{value}</Text>
      <Text style={sc.unit}>{unit}</Text>
    </View>
  )
}
const sc = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: 'center',
    gap: 2,
    shadowColor: '#2B2722',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHighlight: { borderColor: colors.primary, borderWidth: 1.5 },
  label: {
    fontFamily: fonts.sans,
    fontSize: 10,
    fontWeight: '800',
    color: colors.mutedLight,
    letterSpacing: 1.2,
  },
  value: {
    fontFamily: fonts.display,
    fontSize: 44,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 52,
  },
  unit: {
    fontFamily: fonts.sans,
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
})

const STATE_PALETTE: Record<string, { bg: string; fg: string }> = {
  new:       { bg: colors.stateNewBg,       fg: colors.stateNewFg },
  learning:  { bg: colors.stateLearningBg,  fg: colors.stateLearningFg },
  review:    { bg: colors.stateReviewBg,    fg: colors.stateReviewFg },
  suspended: { bg: colors.stateSuspendedBg, fg: colors.stateSuspendedFg },
}

export default function StatsScreen () {
  const { deckId } = useLocalSearchParams<{ deckId: string }>()
  const [stats, setStats] = useState<any>(null)

  useFocusEffect(useCallback(() => {
    if (!deckId) return
    getStats(deckId).then(setStats)
  }, [deckId]))

  if (!stats) {
    return <Screen><Text style={styles.loading}>Loading stats…</Text></Screen>
  }

  return (
    <Screen>
      {/* Stat cards side-by-side */}
      <View style={styles.statRow}>
        <StatCard label="Today"       value={stats.reviewsToday}      unit="reviews" highlight />
        <StatCard label="Last 7 days" value={stats.reviewsLast7Days}  unit="reviews" />
      </View>

      {/* Card state breakdown */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>All cards by state</Text>
        <Text style={styles.sectionHint}>Every card in the deck, regardless of when it's next due — this can be higher than the counts on the deck screen, which only show what's due right now.</Text>
        <View style={styles.stateList}>
          {stats.stateCounts.map((row: any, idx: number) => {
            const p = STATE_PALETTE[row.state] ?? { bg: colors.surfaceSecondary, fg: colors.muted }
            return (
              <View
                key={row.state}
                style={[
                  styles.stateRow,
                  idx < stats.stateCounts.length - 1 && styles.stateRowBorder,
                ]}
              >
                <View style={[styles.stateBadge, { backgroundColor: p.bg }]}>
                  <Text style={[styles.stateBadgeText, { color: p.fg }]}>{row.state}</Text>
                </View>
                <Text style={styles.stateCount}>{row.count}</Text>
              </View>
            )
          })}
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  loading: { fontFamily: fonts.sans, color: colors.muted, fontSize: 16 },

  statRow: { flexDirection: 'row', gap: spacing.sm },

  section: { gap: spacing.sm },
  sectionTitle: {
    fontFamily: fonts.sans,
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  sectionHint: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
  },

  stateList: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    shadowColor: '#2B2722',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  stateRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  stateBadge: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: radius.full,
  },
  stateBadgeText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  stateCount: {
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: '600',
    color: colors.text,
  },
})
