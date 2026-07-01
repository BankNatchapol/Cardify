// Cardify Design System — warm · nature · chill · modern
// Sand & cream grounds, moss-green primary, terracotta accent, warm-stone neutrals.

export const colors = {
  // ── Surfaces ──────────────────────────────────────────────────────────────
  background:        '#F5EFE3', // warm sand — screen ground
  surface:           '#FFFDF8', // cream — cards / raised surfaces
  surfaceSecondary:  '#FBF8F2', // sand-50 — sunken / input
  surfaceDeep:       '#ECE3D2', // sand-200

  // ── Text ──────────────────────────────────────────────────────────────────
  text:              '#2B2722', // espresso — strongest text
  textBody:          '#4B453B', // stone-700 — body text
  muted:             '#7C7363', // stone-500
  mutedLight:        '#9C9384', // stone-400
  textOnPrimary:     '#FFFDF8', // cream on moss button

  // ── Lines ─────────────────────────────────────────────────────────────────
  border:            '#E7E0D3', // stone-200 — hairline
  borderSubtle:      '#F1ECE1', // stone-100 — faint divider

  // ── Primary — moss green ──────────────────────────────────────────────────
  primary:           '#497254', // moss-600
  primaryPress:      '#3B5F45', // moss-700
  primaryHover:      '#5C8A68', // moss-500
  primaryTint:       '#E5EFE4', // moss-100
  primaryTint2:      '#F0F6EE', // moss-50

  // ── Accent — terracotta (for emphasis only, not primary action) ────────────
  accent:            '#D0764C', // clay-500
  accentTint:        '#F8E6DA', // clay-100

  // ── Rating buttons — solid earthy fills, white labels ─────────────────────
  ratingAgain:       '#C05A3B', // clay
  ratingHard:        '#B27F2C', // ochre
  ratingGood:        '#527A5E', // moss
  ratingEasy:        '#45828B', // water

  // ── Card state pills ──────────────────────────────────────────────────────
  stateNewFg:        '#3C7A82', // water-600
  stateNewBg:        '#DFEDED', // water-100
  stateLearningFg:   '#9A6B1E', // ochre-600
  stateLearningBg:   '#F7EDD6', // ochre-100
  stateReviewFg:     '#3B5F45', // moss-700
  stateReviewBg:     '#E5EFE4', // moss-100
  stateSuspendedFg:  '#7C7363', // stone-500
  stateSuspendedBg:  '#ECE3D2', // sand-200

  // ── Semantic ──────────────────────────────────────────────────────────────
  danger:            '#BF5E39', // clay-600
  dangerTint:        '#F8E6DA', // clay-100
}

export const fonts = {
  display: 'Georgia',  // warm serif — card fronts, deck names, big numbers
  sans:    undefined,  // system default (SF Pro on iOS)
  mono:    'Menlo',
}

export const spacing = {
  xs:   4,
  sm:   8,
  md:   16,
  lg:   24,
  xl:   32,
  page: 20,  // screen horizontal gutter
  gap:  12,  // default vertical rhythm
}

export const radius = {
  xs:   6,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   22,
  xxl:  28,
  full: 999,
}
