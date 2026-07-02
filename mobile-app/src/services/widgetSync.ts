import AsyncStorage from '@react-native-async-storage/async-storage'
import { ExtensionStorage } from '@bacons/apple-targets'
import { getDeck, getWidgetCandidateCards } from '../db/repositories'
import { extractSubtitleLines } from '../lib/plainText'

// Must match the App Group configured in app.json (ios.entitlements) and
// mirrored into targets/widget/expo-target.config.js.
const APP_GROUP = 'group.com.cardify.mobile.widget'
const WIDGET_DECK_KEY = 'cardify:widgetDeckId'

const storage = new ExtensionStorage(APP_GROUP)

export async function getWidgetDeckId (): Promise<string | null> {
  return AsyncStorage.getItem(WIDGET_DECK_KEY)
}

export async function setWidgetDeckId (deckId: string | null): Promise<void> {
  if (deckId) {
    await AsyncStorage.setItem(WIDGET_DECK_KEY, deckId)
  } else {
    await AsyncStorage.removeItem(WIDGET_DECK_KEY)
  }
  await syncWidget()
}

// Rebuilds the widget's shared data snapshot from the currently-selected
// widget deck and asks WidgetKit to reload — call after anything that could
// change the "weak cards" pool (app launch/foreground, rating a card) or
// after the widget deck selection itself changes.
export async function syncWidget (): Promise<void> {
  const deckId = await getWidgetDeckId()
  if (!deckId) {
    storage.set('deckId', undefined)
    storage.set('deckName', undefined)
    storage.set('candidates', [])
    storage.set('updatedAt', new Date().toISOString())
    ExtensionStorage.reloadWidget()
    return
  }

  const deck = await getDeck(deckId)
  const cards = await getWidgetCandidateCards(deckId)
  const candidates = cards.map(card => {
    const [subtitle1, subtitle2] = extractSubtitleLines(card.back)
    return {
      id: card.id,
      front: card.front,
      subtitle1: subtitle1 || '',
      subtitle2: subtitle2 || ''
    }
  })

  storage.set('deckId', deckId)
  storage.set('deckName', deck?.displayName ?? deck?.name ?? '')
  storage.set('candidates', candidates)
  storage.set('updatedAt', new Date().toISOString())
  ExtensionStorage.reloadWidget()
}
