// supabase/functions/_shared/mol/index.ts

import type { GenerateRequest, MolResult } from './types.ts'

export async function generateResponse(_req: GenerateRequest): Promise<MolResult> {
  throw new Error('MOL not yet implemented — see Task 16')
}

export * from './types.ts'
