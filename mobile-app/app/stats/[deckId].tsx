import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import React, { useCallback, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Screen from '../../src/components/Screen'
import { getStats } from '../../src/db/repositories'
import { colors } from '../../src/styles/theme'

export default function StatsScreen () {
  const { deckId } = useLocalSearchParams<{ deckId: string }>()
  const [stats, setStats] = useState<any>(null)

  useFocusEffect(useCallback(() => {
    if (!deckId) return
    getStats(deckId).then(setStats)
  }, [deckId]))

  if (!stats) return <Screen><Text>Loading stats...</Text></Screen>

  return (
    <Screen>
      <View style={styles.card}>
        <Text style={styles.title}>Reviews today</Text>
        <Text style={styles.number}>{stats.reviewsToday}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Reviews last 7 days</Text>
        <Text style={styles.number}>{stats.reviewsLast7Days}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Card states</Text>
        {stats.stateCounts.map((row: any) => (
          <Text key={row.state} style={styles.line}>{row.state}: {row.count}</Text>
        ))}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 6 },
  title: { color: colors.muted, fontWeight: '800' },
  number: { color: colors.text, fontSize: 34, fontWeight: '900' },
  line: { color: colors.text, fontSize: 16 }
})
