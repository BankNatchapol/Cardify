import { router } from 'expo-router'
import React, { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import Screen from '../src/components/Screen'
import { pickAndImportDeckPackage } from '../src/services/importDeckPackage'
import { colors, fonts, radius, spacing } from '../src/styles/theme'

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
    <Screen contentContainerStyle={styles.screen}>
      {/* EmptyState card — matches the design system pattern */}
      <View style={styles.emptyCard}>
        {/* Icon well */}
        <View style={styles.iconWell}>
          {/* folder-down glyph approximation */}
          <Text style={styles.iconText}>↓</Text>
        </View>

        <Text style={styles.title}>Import a deck</Text>
        <Text style={styles.body}>
          Choose a .cardify.json or .cardify.zip exported from Cardify Desktop to start studying on your phone.
        </Text>

        <Pressable
          style={({ pressed }) => [styles.chooseBtn, busy && styles.chooseBtnDisabled, pressed && !busy && styles.chooseBtnPressed]}
          onPress={handleImport}
          disabled={busy}
        >
          <Text style={styles.chooseBtnText}>{busy ? 'Importing…' : 'Choose File'}</Text>
        </Pressable>

        {/* Mono filename hint */}
        <Text style={styles.monoHint}>sample-mandarin.cardify.json</Text>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'center', flex: 1 },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    shadowColor: '#2B2722',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 4,
  },
  iconWell: {
    width: 64,
    height: 64,
    borderRadius: radius.xl,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  iconText: { fontSize: 30, color: colors.primary, fontWeight: '700' },

  title: {
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 280,
  },

  chooseBtn: {
    width: '100%',
    marginTop: spacing.sm,
    paddingVertical: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    shadowColor: colors.primaryPress,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 4,
  },
  chooseBtnDisabled: { opacity: 0.55 },
  chooseBtnPressed: { opacity: 0.88, transform: [{ scale: 0.97 }] },
  chooseBtnText: {
    fontFamily: fonts.sans,
    color: colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '800',
  },

  monoHint: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.mutedLight,
    textAlign: 'center',
  },
})
