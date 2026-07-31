import { describe, expect, it } from 'vitest'

import {
  LensId,
  OntologyLinkType,
  OntologyObjectType,
} from '../../schemas/enums'
import type {
  OntologyLink,
  OntologyObject,
  OntologySnapshot,
} from '../../schemas/types'
import { projectLens } from './lenses'

const provenance = { source: 'MODEL' as const, sourceRef: 'test' }
const scenarioId = 'scenario:test'

function object(id: string, type: OntologyObjectType): OntologyObject {
  return {
    id,
    type,
    label: id,
    properties: type === OntologyObjectType.KNOWLEDGE
      ? { knowledgeKind: 'OBJECT_TYPE' }
      : {},
    provenance,
    scenarioId: type === OntologyObjectType.ASSET || type === OntologyObjectType.KNOWLEDGE
      ? undefined
      : scenarioId,
  }
}

function link(
  id: string,
  type: OntologyLinkType,
  sourceId: string,
  targetId: string,
): OntologyLink {
  return { id, type, sourceId, targetId, properties: {}, provenance }
}

const snapshot: OntologySnapshot = {
  objects: [
    object('asset:host', OntologyObjectType.ASSET),
    object('asset:lun', OntologyObjectType.ASSET),
    object('knowledge:host', OntologyObjectType.KNOWLEDGE),
    object('scenario:test', OntologyObjectType.SCENARIO),
    object('call:1', OntologyObjectType.FUNCTION_CALL),
    object('fact:1', OntologyObjectType.FACT),
    object('evidence:1', OntologyObjectType.EVIDENCE),
    object('candidate:1', OntologyObjectType.CANDIDATE),
    object('decision:1', OntologyObjectType.DECISION),
    object('proposal:1', OntologyObjectType.ACTION_PROPOSAL),
  ],
  links: [
    link('topology:1', OntologyLinkType.CONNECTS_TO, 'asset:host', 'asset:lun'),
    link('mapping:1', OntologyLinkType.INSTANCE_OF, 'asset:host', 'knowledge:host'),
    link('call-fact', OntologyLinkType.PRODUCED_BY, 'fact:1', 'call:1'),
    link('fact-evidence', OntologyLinkType.DERIVED_FROM, 'evidence:1', 'fact:1'),
    link('supports', OntologyLinkType.SUPPORTS, 'evidence:1', 'candidate:1'),
    link('decision-lineage', OntologyLinkType.BASED_ON, 'decision:1', 'evidence:1'),
    link('impact', OntologyLinkType.IMPACTS, 'decision:1', 'asset:lun'),
    link('recover', OntologyLinkType.RECOVERS_VIA, 'decision:1', 'asset:host'),
    link('proposal', OntologyLinkType.PROPOSES, 'decision:1', 'proposal:1'),
  ],
}

describe('ontology Lens projections', () => {
  it('TOPOLOGY contains assets and type mappings, never diagnosis state', () => {
    const result = projectLens(snapshot, LensId.TOPOLOGY)
    expect(result.objects.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['asset:host', 'asset:lun', 'knowledge:host']),
    )
    expect(result.objects.some(({ type }) => type === OntologyObjectType.CANDIDATE)).toBe(false)
  })

  it('keeps linked context to one hop so initial projection cannot traverse into Case truth', () => {
    const expanded: OntologySnapshot = {
      objects: [
        ...snapshot.objects,
        {
          ...object('knowledge:historical-hot-reset', OntologyObjectType.KNOWLEDGE),
          properties: { knowledgeKind: 'CASE' },
        },
      ],
      links: [
        ...snapshot.links,
        link(
          'knowledge-chain',
          OntologyLinkType.INSTANCE_OF,
          'knowledge:historical-hot-reset',
          'knowledge:host',
        ),
      ],
    }
    const result = projectLens(expanded, LensId.TOPOLOGY)
    expect(result.objects.map(({ id }) => id)).not.toContain(
      'knowledge:historical-hot-reset',
    )
  })

  it('KNOWLEDGE contains knowledge and linked asset context', () => {
    const result = projectLens(snapshot, LensId.KNOWLEDGE)
    expect(result.objects.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['knowledge:host', 'asset:host']),
    )
    expect(result.links.map(({ id }) => id)).toContain('mapping:1')
  })

  it('DIAGNOSIS exposes evidence convergence but not Action Proposals', () => {
    const result = projectLens(snapshot, LensId.DIAGNOSIS)
    expect(result.objects.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['fact:1', 'evidence:1', 'candidate:1', 'decision:1']),
    )
    expect(result.objects.map(({ id }) => id)).not.toContain('proposal:1')
  })

  it('IMPACT only projects proven impact and recovery paths', () => {
    const result = projectLens(snapshot, LensId.IMPACT)
    expect(result.links.map(({ type }) => type)).toEqual(
      expect.arrayContaining([OntologyLinkType.IMPACTS, OntologyLinkType.RECOVERS_VIA]),
    )
    expect(result.objects.map(({ id }) => id)).not.toContain('fact:1')
  })

  it('AUDIT includes Function Call, raw Fact, Decision and Action Proposal lineage', () => {
    const result = projectLens(snapshot, LensId.AUDIT)
    expect(result.objects.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['call:1', 'fact:1', 'decision:1', 'proposal:1']),
    )
    expect(result.links.map(({ type }) => type)).toEqual(
      expect.arrayContaining([OntologyLinkType.PRODUCED_BY, OntologyLinkType.PROPOSES]),
    )
  })
})
