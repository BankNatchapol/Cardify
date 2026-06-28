import React from 'react'
import { ScrollView, StyleSheet, ViewStyle } from 'react-native'
import { colors, spacing } from '../styles/theme'

export default function Screen ({ children, contentContainerStyle }: { children: React.ReactNode, contentContainerStyle?: ViewStyle }) {
  return (
    <ScrollView contentContainerStyle={[styles.content, contentContainerStyle]}>
      {children}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: {
    minHeight: '100%',
    padding: spacing.page,
    gap: spacing.gap,
    backgroundColor: colors.background
  }
})
