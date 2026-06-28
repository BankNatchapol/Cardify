import { Link, useFocusEffect } from 'expo-router'
import React, { useCallback, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import Screen from '../src/components/Screen'
import { exportBackup, importBackup } from '../src/services/backup'
import { listDecks, seedSampleDeck, type MobileDeck } from '../src/db/repositories'
import { colors } from '../src/styles/theme'

export default function DecksScreen () {
  const [decks, setDecks] = useState<MobileDeck[]>([])

  const refresh = useCallback(async () => {
    setDecks(await listDecks())
  }, [])

  useFocusEffect(useCallback(() => {
    refresh()
  }, [refresh]))

  const handleSeed = async () => {
    await seedSampleDeck()
    await refresh()
  }

  const handleExportBackup = async () => {
    const uri = await exportBackup()
    Alert.alert('Backup exported', uri)
  }

  const handleImportBackup = async () => {
    const result = await importBackup()
    if (!result.canceled) {
      await refresh()
      Alert.alert('Backup imported')
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Decks</Text>
        <Link href="/import" asChild>
          <Pressable style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Import</Text>
          </Pressable>
        </Link>
      </View>

      {decks.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No decks yet</Text>
          <Text style={styles.muted}>Import a .cardify.json file or seed sample cards for testing.</Text>
          <Pressable style={styles.secondaryButton} onPress={handleSeed}>
            <Text style={styles.secondaryButtonText}>Seed Sample Deck</Text>
          </Pressable>
        </View>
      ) : decks.map(deck => (
        <Link key={deck.id} href={`/deck/${deck.id}`} asChild>
          <Pressable style={styles.deckCard}>
            <Text style={styles.deckTitle}>{deck.name}</Text>
            <Text style={styles.deckCounts}>
              New {deck.newCount} · Learning {deck.learningCount} · Review {deck.reviewCount}
            </Text>
          </Pressable>
        </Link>
      ))}

      <View style={styles.backupRow}>
        <Pressable style={styles.secondaryButton} onPress={handleExportBackup}>
          <Text style={styles.secondaryButtonText}>Export Backup</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={handleImportBackup}>
          <Text style={styles.secondaryButtonText}>Import Backup</Text>
        </Pressable>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 32, fontWeight: '800', color: colors.text },
  empty: { padding: 18, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '750', color: colors.text },
  muted: { color: colors.muted },
  deckCard: { padding: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, gap: 6 },
  deckTitle: { fontSize: 18, fontWeight: '750', color: colors.text },
  deckCounts: { color: colors.muted },
  primaryButton: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, backgroundColor: colors.primary },
  primaryButtonText: { color: '#ffffff', fontWeight: '700' },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#ffffff', borderWidth: 1, borderColor: colors.border },
  secondaryButtonText: { color: colors.text, fontWeight: '700' },
  backupRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }
})
