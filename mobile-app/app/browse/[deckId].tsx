import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import React, { useCallback, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import Screen from '../../src/components/Screen'
import { deleteCard, listCards, setCardSuspended, updateCardText, type MobileCard } from '../../src/db/repositories'
import { colors, fonts, radius, spacing } from '../../src/styles/theme'

// State badge — uses design-system tone tokens
function StateBadge ({ state, suspended }: { state: string; suspended?: boolean }) {
  const palette = {
    new:       { bg: colors.stateNewBg,        fg: colors.stateNewFg },
    learning:  { bg: colors.stateLearningBg,   fg: colors.stateLearningFg },
    review:    { bg: colors.stateReviewBg,     fg: colors.stateReviewFg },
    suspended: { bg: colors.stateSuspendedBg,  fg: colors.stateSuspendedFg },
  } as Record<string, { bg: string; fg: string }>

  const p = palette[state] ?? { bg: colors.surfaceSecondary, fg: colors.muted }
  return (
    <View style={[sb.badge, { backgroundColor: p.bg }]}>
      <Text style={[sb.text, { color: p.fg }]}>{state}</Text>
    </View>
  )
}
const sb = StyleSheet.create({
  badge: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: radius.full },
  text:  { fontFamily: fonts.sans, fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
})

export default function BrowseScreen () {
  const { deckId } = useLocalSearchParams<{ deckId: string }>()
  const [query, setQuery] = useState('')
  const [cards, setCards] = useState<MobileCard[]>([])

  const refresh = useCallback(async () => {
    if (!deckId) return
    setCards(await listCards(deckId, query))
  }, [deckId, query])

  useFocusEffect(useCallback(() => { refresh() }, [refresh]))

  const handleSave = async (card: MobileCard, front: string, back: string) => {
    await updateCardText(card.id, front, back)
    await refresh()
  }

  const handleDelete = async (card: MobileCard) => {
    Alert.alert('Delete card?', card.front, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteCard(card.id); await refresh() } },
    ])
  }

  return (
    <Screen>
      {/* Search bar */}
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={refresh}
          placeholder="Search cards…"
          placeholderTextColor={colors.mutedLight}
          returnKeyType="search"
        />
      </View>

      {cards.length === 0 && (
        <View style={styles.emptyHint}>
          <Text style={styles.emptyHintText}>No cards found</Text>
        </View>
      )}

      {cards.map(card => (
        <EditableCard
          key={card.id}
          card={card}
          onSave={handleSave}
          onSuspend={async () => { await setCardSuspended(card.id, !card.suspended); await refresh() }}
          onDelete={() => handleDelete(card)}
        />
      ))}
    </Screen>
  )
}

function EditableCard ({ card, onSave, onSuspend, onDelete }: {
  card: MobileCard
  onSave: (card: MobileCard, front: string, back: string) => Promise<void>
  onSuspend: () => Promise<void>
  onDelete: () => void
}) {
  const [front, setFront] = useState(card.front)
  const [back, setBack] = useState(card.back)

  return (
    <View style={[styles.card, card.suspended && styles.cardSuspended]}>
      {/* State badges */}
      <View style={styles.badgeRow}>
        <StateBadge state={card.state} />
        {!!card.suspended && <StateBadge state="suspended" />}
      </View>

      {/* Front / back inputs */}
      <TextInput
        style={styles.cardInput}
        value={front}
        onChangeText={setFront}
        multiline
        placeholder="Front"
        placeholderTextColor={colors.mutedLight}
      />
      <TextInput
        style={styles.cardInput}
        value={back}
        onChangeText={setBack}
        multiline
        placeholder="Back"
        placeholderTextColor={colors.mutedLight}
      />

      {/* Actions */}
      <View style={styles.cardActions}>
        <Pressable style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.75 }]} onPress={() => onSave(card, front, back)}>
          <Text style={styles.actionBtnText}>Save</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.75 }]} onPress={onSuspend}>
          <Text style={styles.actionBtnText}>{card.suspended ? 'Unsuspend' : 'Suspend'}</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.actionBtn, styles.deleteBtn, pressed && { opacity: 0.75 }]} onPress={onDelete}>
          <Text style={styles.deleteBtnText}>Delete</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // ── Search ─────────────────────────────────────────────────────────────────
  searchWrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#2B2722',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  searchInput: {
    fontFamily: fonts.sans,
    padding: spacing.md,
    fontSize: 15,
    color: colors.text,
  },
  emptyHint: { paddingVertical: spacing.xl, alignItems: 'center' },
  emptyHintText: { fontFamily: fonts.sans, color: colors.mutedLight, fontSize: 15 },

  // ── Card ──────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    shadowColor: '#2B2722',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardSuspended: { opacity: 0.6 },
  badgeRow: { flexDirection: 'row', gap: 6 },
  cardInput: {
    fontFamily: fonts.sans,
    minHeight: 52,
    padding: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: spacing.xs },
  actionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  actionBtnText: { fontFamily: fonts.sans, color: colors.textBody, fontWeight: '700', fontSize: 13 },
  deleteBtn: { borderColor: colors.accentTint, backgroundColor: colors.accentTint, marginLeft: 'auto' },
  deleteBtnText: { fontFamily: fonts.sans, color: colors.danger, fontWeight: '700', fontSize: 13 },
})
