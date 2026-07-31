import { FunctionEffect } from '../../schemas/enums'
import type {
  CatalogSnapshot,
  FunctionDefinition,
  SkillBoundary,
} from '../../schemas/types'

export interface SkillRegistry {
  boundary(skillId: string): SkillBoundary | null
  functionDefinition(skillId: string): FunctionDefinition | null
  canWriteOntology(skillId: string): false
}

/**
 * Skills are fact providers, not ontology writers. Runtime is the only module
 * allowed to materialize a returned payload as a Fact object.
 */
export function createSkillRegistry(
  catalog: CatalogSnapshot,
): SkillRegistry {
  const boundaries = new Map(
    catalog.skills.map((boundary) => [boundary.skillId, boundary]),
  )
  const functions = new Map(
    catalog.functions.map((fn) => [fn.id, fn]),
  )
  return {
    boundary: (skillId) => boundaries.get(skillId) ?? null,
    functionDefinition: (skillId) => {
      const boundary = boundaries.get(skillId)
      if (!boundary) return null
      const fn = functions.get(boundary.functionId) ?? null
      if (fn && fn.effect !== FunctionEffect.READ_ONLY) {
        throw new Error(`[skill] Function ${fn.id} violates the read-only boundary`)
      }
      return fn
    },
    canWriteOntology: () => false,
  }
}
