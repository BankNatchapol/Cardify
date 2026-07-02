import React, { useEffect, useState } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import * as FileSystem from 'expo-file-system'
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import Svg, { Path } from 'react-native-svg'
import { colors } from '../styles/theme'

// Ported from the desktop app's src/assets/speaker-2-svgrepo-com.svg — same
// path data, so the icon matches exactly.
function SpeakerIcon ({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M19 6C20.5 7.5 21 10 21 12C21 14 20.5 16.5 19 18M16 8.99998C16.5 9.49998 17 10.5 17 12C17 13.5 16.5 14.5 16 15M3 10.5V13.5C3 14.6046 3.5 15.5 5.5 16C7.5 16.5 9 21 12 21C14 21 14 3 12 3C9 3 7.5 7.5 5.5 8C3.5 8.5 3 9.39543 3 10.5Z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export default function AudioTagButton ({ uri, slot }: { uri: string | null; slot?: string }) {
  // "Playing" is derived straight from the player's own live status rather
  // than tracked separately — if it were tracked separately and the
  // "finished" event ever failed to fire, the button would get stuck
  // disabled/blue forever. Deriving it means the button self-corrects the
  // moment the real player state changes, no matter what caused it to stop.
  const [errorFlash, setErrorFlash] = useState(false)
  // Short TTS clips (a word or two) can be under a second — the default
  // 500ms status-poll interval can miss the entire "playing" window for
  // clips that short, so the icon never appears to turn blue even though
  // audio genuinely played. A tighter interval catches it reliably.
  const player = useAudioPlayer(uri ? { uri } : null, 50)
  const status = useAudioPlayerStatus(player)

  // expo-audio doesn't reliably flip `playing` back to false on its own once
  // a one-shot clip reaches the end — without this the icon stays stuck on
  // the "playing" color forever after the clip finishes.
  useEffect(() => {
    if (status.didJustFinish) {
      player.pause()
      player.seekTo(0)
    }
  }, [status.didJustFinish])

  const flashError = () => {
    setErrorFlash(true)
    setTimeout(() => setErrorFlash(false), 1600)
  }

  const handlePress = async () => {
    if (!uri) {
      flashError()
      return
    }
    try {
      const info = await FileSystem.getInfoAsync(uri)
      if (!info.exists) {
        flashError()
        return
      }
      await player.seekTo(0)
      player.play()
    } catch (err) {
      console.error('[AudioTagButton] playback failed', err)
      flashError()
    }
  }

  // A softer, pastel take on desktop's playing-state blue (desktop uses a
  // vivid #2563eb) — this app's palette is muted throughout, and the app's
  // own "info" token (colors.stateNewFg) reads too close to green/gray at
  // icon size to register as a distinct "playing" state.
  const color = errorFlash
    ? colors.danger
    : status.playing
      ? '#6E9BD6'
      : colors.primaryPress

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={8}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel={slot ? `Play ${slot.replace(/_/g, ' ')} audio` : 'Play audio'}
    >
      <SpeakerIcon color={color} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 3,
  },
})
