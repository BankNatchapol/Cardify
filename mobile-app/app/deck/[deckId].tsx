import { Link, useFocusEffect, useLocalSearchParams } from 'expo-router'
import React, { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Screen from '../../src/components/Screen'
import { getDeck, listDecks } from '../../src/db/repositories'
import { colors } from '../../src/styles/theme'

export default function DeckScreen () {
  const { deckId } = useLocalSearchParams<{ deckId: string }>()
  const [deck, setDeck] = useState<any>(null)
  const [counts, setCounts] = useState<any>(null)

  useFocusEffect(useCallback(() => {
    if (!deckId) return
    ;(async () => {
      setDeck(await getDeck(deckId))
      const allDecks = await listDecks()
      setCounts(allDecks.find(item => item.id === deckId))
    })()
  }, [deckId]))

  if (!deck) {
    return <Screen><Text>Loading deck...</Text></Screen>
  }

  return (
    <Screen>
      <Text style={styles.title}>{deck.name}</Text>
      <View style={styles.counts}>
        <Text style={styles.count}>New {counts?.newCount || 0}</Text>
        <Text style={styles.count}>Learning {counts?.learningCount || 0}</Text>
        <Text style={styles.count}>Review {counts?.reviewCount || 0}</Text>
      </View>
      <Link href={`/study/${deckId}`} asChild><Pressable style={styles.primary}><Text style={styles.primaryText}>Study</Text></Pressable></Link>
      <Link href={`/browse/${deckId}`} asChild><Pressable style={styles.secondary}><Text style={styles.secondaryText}>Browse / Edit</Text></Pressable></Link>
      <Link href={`/stats/${deckId}`} asChild><Pressable style={styles.secondary}><Text style={styles.secondaryText}>Stats</Text></Pressable></Link>
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 30, fontWeight: '800', color: colors.text },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  count: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#eef2ff', color: colors.primary, fontWeight: '800' },
  primary: { padding: 16, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center' },
  primaryText: { color: '#ffffff', fontWeight: '800', fontSize: 16 },
  secondary: { padding: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center' },
  secondaryText: { color: colors.text, fontWeight: '750' }
})
