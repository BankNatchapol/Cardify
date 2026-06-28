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

const DeckPackageSchema = z.object({
  packageId: z.string(),
  deck: z.object({
    id: z.string(),
    name: z.string(),
    description: z.unknown().optional()
  }),
  notes: z.array(NoteSchema)
})

export type DeckPackage = z.infer<typeof DeckPackageSchema>

export function validateDeckPackage (raw: unknown): DeckPackage {
  return DeckPackageSchema.parse(raw)
}
