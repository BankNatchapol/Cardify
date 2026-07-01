import React from 'react'
import { ScrollView, StyleSheet, ViewStyle } from 'react-native'
import { colors, spacing } from '../styles/theme'

export default function Screen ({ children, contentContainerStyle }: { children: React.ReactNode, contentContainerStyle?: ViewStyle }) {
  return (
    <ScrollView
      contentContainerStyle={[styles.content, contentContainerStyle]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: {
    minHeight: '100%',
    padding: spacing.page,
    paddingBottom: 48,
    gap: spacing.gap,
    backgroundColor: colors.background,
  }
})
