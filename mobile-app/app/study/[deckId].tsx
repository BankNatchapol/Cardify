import { useLocalSearchParams } from 'expo-router'
import React, { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Screen from '../../src/components/Screen'
import { getNextStudyCard, rateCard, type MobileCard } from '../../src/db/repositories'
import { colors } from '../../src/styles/theme'

type ReviewRating = 'again' | 'hard' | 'good' | 'easy'
const RATINGS: ReviewRating[] = ['again', 'hard', 'good', 'easy']

export default function StudyScreen () {
  const { deckId } = useLocalSearchParams<{ deckId: string }>()
  const [card, setCard] = useState<MobileCard | null>(null)
  const [answerShown, setAnswerShown] = useState(false)
  const [startedAt, setStartedAt] = useState(Date.now())

  const loadNext = async () => {
    if (!deckId) return
    setCard(await getNextStudyCard(deckId))
    setAnswerShown(false)
    setStartedAt(Date.now())
  }

  useEffect(() => {
    loadNext()
  }, [deckId])

  const handleRate = async (rating: ReviewRating) => {
    if (!card) return
    await rateCard(card, rating, Date.now() - startedAt)
    await loadNext()
  }

  if (!card) {
    return (
      <Screen>
        <View style={styles.card}>
          <Text style={styles.title}>All caught up</Text>
          <Text style={styles.muted}>No due or new cards are available for this deck right now.</Text>
        </View>
      </Screen>
    )
  }

  return (
    <Screen contentContainerStyle={styles.screen}>
      <View style={styles.studyCard}>
        <Text style={styles.label}>Front</Text>
        <Text style={styles.front}>{card.front}</Text>
        {answerShown && (
          <>
            <View style={styles.divider} />
            <Text style={styles.label}>Back</Text>
            <Text style={styles.back}>{card.back}</Text>
          </>
        )}
      </View>

      {!answerShown ? (
        <Pressable style={styles.primary} onPress={() => setAnswerShown(true)}>
          <Text style={styles.primaryText}>Show Answer</Text>
        </Pressable>
      ) : (
        <View style={styles.ratingRow}>
          {RATINGS.map(rating => (
            <Pressable key={rating} style={styles.ratingButton} onPress={() => handleRate(rating)}>
              <Text style={styles.ratingText}>{labelForRating(rating)}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  )
}

function labelForRating (rating: ReviewRating) {
  return rating[0].toUpperCase() + rating.slice(1)
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'center' },
  card: { padding: 18, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 8 },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  muted: { color: colors.muted },
  studyCard: { minHeight: 320, padding: 22, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 12 },
  label: { color: colors.muted, fontWeight: '800', textTransform: 'uppercase', fontSize: 12 },
  front: { color: colors.text, fontSize: 28, fontWeight: '750' },
  back: { color: colors.text, fontSize: 22, lineHeight: 30 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
  primary: { padding: 16, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center' },
  primaryText: { color: '#ffffff', fontWeight: '800', fontSize: 16 },
  ratingRow: { flexDirection: 'row', gap: 8 },
  ratingButton: { flex: 1, paddingVertical: 14, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center' },
  ratingText: { color: '#ffffff', fontWeight: '800' }
})
