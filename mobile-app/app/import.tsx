import { router } from 'expo-router'
import React, { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import Screen from '../src/components/Screen'
import { pickAndImportDeckPackage } from '../src/services/importDeckPackage'
import { colors } from '../src/styles/theme'

export default function ImportScreen () {
  const [busy, setBusy] = useState(false)

  const handleImport = async () => {
    setBusy(true)
    try {
      const result = await pickAndImportDeckPackage()
      if (result.canceled) return
      Alert.alert('Deck imported', `${result.deckName}: ${result.noteCount} cards`)
      router.replace(`/deck/${result.deckId}`)
    } catch (err) {
      Alert.alert('Import failed', err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <View style={styles.card}>
        <Text style={styles.title}>Import Cardify Deck</Text>
        <Text style={styles.copy}>Choose a .cardify.json exported from Cardify Desktop.</Text>
        <Pressable style={styles.button} onPress={handleImport} disabled={busy}>
          <Text style={styles.buttonText}>{busy ? 'Importing...' : 'Choose File'}</Text>
        </Pressable>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  card: { padding: 18, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 12 },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  copy: { color: colors.muted },
  button: { padding: 14, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontWeight: '800' }
})
