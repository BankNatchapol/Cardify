import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import React, { useCallback, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import Screen from '../../src/components/Screen'
import { deleteCard, listCards, setCardSuspended, updateCardText, type MobileCard } from '../../src/db/repositories'
import { colors } from '../../src/styles/theme'

export default function BrowseScreen () {
  const { deckId } = useLocalSearchParams<{ deckId: string }>()
  const [query, setQuery] = useState('')
  const [cards, setCards] = useState<MobileCard[]>([])

  const refresh = useCallback(async () => {
    if (!deckId) return
    setCards(await listCards(deckId, query))
  }, [deckId, query])

  useFocusEffect(useCallback(() => {
    refresh()
  }, [refresh]))

  const handleSave = async (card: MobileCard, front: string, back: string) => {
    await updateCardText(card.id, front, back)
    await refresh()
  }

  const handleDelete = async (card: MobileCard) => {
    Alert.alert('Delete card?', card.front, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteCard(card.id)
          await refresh()
        }
      }
    ])
  }

  return (
    <Screen>
      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={refresh}
        placeholder="Search front or back"
      />
      {cards.map(card => (
        <EditableCard
          key={card.id}
          card={card}
          onSave={handleSave}
          onSuspend={async () => {
            await setCardSuspended(card.id, !card.suspended)
            await refresh()
          }}
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
    <View style={styles.card}>
      <Text style={styles.meta}>{card.state}{card.suspended ? ' · suspended' : ''}</Text>
      <TextInput style={styles.input} value={front} onChangeText={setFront} multiline />
      <TextInput style={styles.input} value={back} onChangeText={setBack} multiline />
      <View style={styles.row}>
        <Pressable style={styles.secondary} onPress={() => onSave(card, front, back)}><Text style={styles.secondaryText}>Save</Text></Pressable>
        <Pressable style={styles.secondary} onPress={onSuspend}><Text style={styles.secondaryText}>{card.suspended ? 'Unsuspend' : 'Suspend'}</Text></Pressable>
        <Pressable style={styles.danger} onPress={onDelete}><Text style={styles.dangerText}>Delete</Text></Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  search: { padding: 12, borderRadius: 9, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text },
  card: { padding: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 10 },
  meta: { color: colors.muted, fontWeight: '700' },
  input: { minHeight: 58, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: '#f9fafb', color: colors.text },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  secondary: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  secondaryText: { color: colors.text, fontWeight: '700' },
  danger: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#fecaca' },
  dangerText: { color: colors.danger, fontWeight: '700' }
})
