import { Stack } from 'expo-router'

export default function RootLayout () {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#ffffff' },
        headerTintColor: '#111827',
        contentStyle: { backgroundColor: '#f0f4f8' }
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Cardify' }} />
      <Stack.Screen name="import" options={{ title: 'Import Deck' }} />
      <Stack.Screen name="deck/[deckId]" options={{ title: 'Deck' }} />
      <Stack.Screen name="study/[deckId]" options={{ title: 'Study' }} />
      <Stack.Screen name="browse/[deckId]" options={{ title: 'Browse' }} />
      <Stack.Screen name="stats/[deckId]" options={{ title: 'Stats' }} />
    </Stack>
  )
}
