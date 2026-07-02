import { Stack } from 'expo-router'
import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { colors } from '../src/styles/theme'
import { syncWidget } from '../src/services/widgetSync'

export default function RootLayout () {
  const appState = useRef(AppState.currentState)

  useEffect(() => {
    syncWidget().catch(() => {})
    const subscription = AppState.addEventListener('change', nextState => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        syncWidget().catch(() => {})
      }
      appState.current = nextState
    })
    return () => subscription.remove()
  }, [])

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: true,
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontWeight: '800',
          fontSize: 17,
          color: colors.text,
        },
contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'My Decks' }} />
      <Stack.Screen name="import" options={{ title: 'Import Deck' }} />
      <Stack.Screen name="deck/[deckId]" options={{ title: '' }} />
      <Stack.Screen name="study/[deckId]" options={{ title: 'Study', headerBackTitle: 'Back' }} />
      <Stack.Screen name="browse/[deckId]" options={{ title: 'Browse' }} />
      <Stack.Screen name="stats/[deckId]" options={{ title: 'Stats' }} />
    </Stack>
  )
}
