import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import React, { useCallback, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Screen from '../../src/components/Screen'
import { getDailyRatingStats, getStats, type DailyRatingStats } from '../../src/db/repositories'
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

const CHART_HEIGHT = 120

const RATING_LEGEND: { key: 'again' | 'hard' | 'good' | 'easy'; label: string; color: string }[] = [
  { key: 'again', label: 'Again', color: colors.ratingAgain },
  { key: 'hard',  label: 'Hard',  color: colors.ratingHard },
  { key: 'good',  label: 'Good',  color: colors.ratingGood },
  { key: 'easy',  label: 'Easy',  color: colors.ratingEasy },
]

// A single day's stacked bar — plain colored Views rather than SVG, since a
// stack of solid rectangles doesn't need anything SVG offers and this avoids
// any width-measurement bookkeeping (Flexbox sizes each column on its own).
function DayBar ({ day, maxTotal, isToday }: { day: DailyRatingStats; maxTotal: number; isToday: boolean }) {
  const total = day.again + day.hard + day.good + day.easy
  const segments = RATING_LEGEND
    .map(r => ({ value: day[r.key], color: r.color }))
    .filter(s => s.value > 0)

  return (
    <View style={dbc.column}>
      <Text style={dbc.totalLabel}>{total > 0 ? total : ''}</Text>
      <View style={dbc.track}>
        {total > 0 ? (
          <View style={[dbc.fill, { height: `${Math.max((total / maxTotal) * 100, 4)}%` }]}>
            {segments.map((seg, i) => (
              <View key={i} style={{ flex: seg.value, backgroundColor: seg.color }} />
            ))}
          </View>
        ) : (
          <View style={dbc.emptyBar} />
        )}
      </View>
      <Text style={[dbc.dayLabel, isToday && dbc.dayLabelToday]}>{day.label}</Text>
    </View>
  )
}
const dbc = StyleSheet.create({
  column: { flex: 1, alignItems: 'center', gap: 4 },
  totalLabel: { fontFamily: fonts.sans, fontSize: 11, fontWeight: '700', color: colors.muted, height: 14 },
  track: { height: CHART_HEIGHT, width: 22, justifyContent: 'flex-end' },
  fill: { width: '100%', borderRadius: radius.xs, overflow: 'hidden', flexDirection: 'column-reverse' },
  emptyBar: { width: '100%', height: 3, borderRadius: 1.5, backgroundColor: colors.borderSubtle },
  dayLabel: { fontFamily: fonts.sans, fontSize: 11, fontWeight: '600', color: colors.muted },
  dayLabelToday: { color: colors.primary, fontWeight: '800' },
})

function DailyRatingChart ({ data, allTimeTotal, allTimeByRating }: {
  data: DailyRatingStats[]
  allTimeTotal: number
  allTimeByRating: Record<'again' | 'hard' | 'good' | 'easy', number>
}) {
  const maxTotal = Math.max(...data.map(d => d.again + d.hard + d.good + d.easy), 1)
  const todayKey = data[data.length - 1]?.date

  return (
    <View style={styles.chartCard}>
      <View style={styles.chartHeader}>
        <Text style={styles.chartHeaderLabel}>Total since start</Text>
        <Text style={styles.chartHeaderValue}>{allTimeTotal}</Text>
      </View>
      <View style={styles.chartRow}>
        {data.map(day => (
          <DayBar key={day.date} day={day} maxTotal={maxTotal} isToday={day.date === todayKey} />
        ))}
      </View>
      <View style={styles.legendRow}>
        {RATING_LEGEND.map(item => (
          <View key={item.key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: item.color }]} />
            <Text style={styles.legendLabel}>{item.label}</Text>
            <Text style={styles.legendCount}>{allTimeByRating[item.key]}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

export default function StatsScreen () {
  const { deckId } = useLocalSearchParams<{ deckId: string }>()
  const [stats, setStats] = useState<any>(null)
  const [dailyStats, setDailyStats] = useState<DailyRatingStats[] | null>(null)

  useFocusEffect(useCallback(() => {
    if (!deckId) return
    getStats(deckId).then(setStats)
    getDailyRatingStats(deckId).then(setDailyStats)
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

      {/* Daily rating breakdown */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Daily reviews</Text>
        <Text style={styles.sectionHint}>How each day's reviews broke down by rating, most recent 7 days.</Text>
        {dailyStats && (
          <DailyRatingChart
            data={dailyStats}
            allTimeTotal={stats.reviewsAllTime}
            allTimeByRating={stats.ratingTotalsAllTime}
          />
        )}
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

  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
    shadowColor: '#2B2722',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  chartHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  chartHeaderLabel: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: '800',
    color: colors.mutedLight,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  chartHeaderValue: {
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: '600',
    color: colors.text,
  },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'center',
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontFamily: fonts.sans, fontSize: 11, color: colors.muted, fontWeight: '600' },
  legendCount: { fontFamily: fonts.sans, fontSize: 11, color: colors.text, fontWeight: '700' },

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
