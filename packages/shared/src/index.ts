export * from './types'

import { z } from 'zod'

const NoteSchema = z.object({
  id: z.string(),
  noteType: z.string().default('basic'),
  fields: z.object({
    Front: z.string(),
    Back: z.string()
  }),
  tags: z.array(z.string()).optional().default([]),
  source: z.unknown().optional()
})

const AudioMappingSchema = z.object({
  noteId: z.string(),
  slot: z.string(),
  file: z.string()
})

const DeckPackageSchema = z.object({
  packageId: z.string(),
  deck: z.object({
    id: z.string(),
    name: z.string(),
    description: z.unknown().optional()
  }),
  notes: z.array(NoteSchema),
  audio: z.array(AudioMappingSchema).optional()
})

export type DeckPackage = z.infer<typeof DeckPackageSchema>

export function validateDeckPackage (raw: unknown): DeckPackage {
  return DeckPackageSchema.parse(raw)
}
