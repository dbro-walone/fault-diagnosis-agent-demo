import { describe, expect, it } from 'vitest'

import {
  FunctionEffect,
  LensId,
  OntologyLinkType,
  OntologyObjectType,
} from '../../schemas/enums'
import type {
  OntologyLink,
  OntologyObject,
  OntologyScenarioDefinition,
  ScenarioOverlay,
} from '../../schemas/types'
import scenarioJson from '../../cases/controller_warm_reset_001/scenario.json'
import topologyJson from '../../model/topology/instances.json'
import kgNodesJson from '../../model/knowledge-graph/nodes.json'
import kgEdgesJson from '../../model/knowledge-graph/edges.json'
import mappingsJson from '../../model/mappings/cross-layer-mappings.json'
import projectionJson from '../../model/projection/projection-config.json'
import {
  loadOntologyRegistry,
  mapKnowledgeRelation,
  validateModelDocuments,
} from './model-adapter'
import { resolveScenarioCatalog } from './catalog'
import { createSkillRegistry } from '../runtime/skill-executor'
import { replayEvents } from '../runtime/diagnosis-engine'
import {
  createOntologyRegistry,
  validateOntologySnapshot,
  validateScenarioIsolation,
} from './registry'

const provenance = { source: 'MODEL' as const, sourceRef: 'test' }

function object(id: string, type = OntologyObjectType.ASSET): OntologyObject {
  return { id, type, label: id, properties: {}, provenance: { ...provenance } }
}

function link(id: string, sourceId: string, targetId: string): OntologyLink {
  return {
    id,
    type: OntologyLinkType.CONNECTS_TO,
    sourceId,
    targetId,
    properties: {},
    provenance: { ...provenance },
  }
}

describe('ontology registry invariants', () => {
  it('rejects duplicate identities and dangling links', () => {
    expect(() =>
      validateOntologySnapshot({
        objects: [object('asset:1'), object('asset:1')],
        links: [],
      }),
    ).toThrow(/duplicate/)

    expect(() =>
      validateOntologySnapshot({
        objects: [object('asset:1')],
        links: [link('link:1', 'asset:1', 'asset:missing')],
      }),
    ).toThrow(/dangling/)
  })

  it('keeps Scenario objects isolated and prevents base-object shadowing', () => {
    const base = { objects: [object('asset:1')], links: [] }
    const escaped: ScenarioOverlay = {
      scenarioId: 'scenario:1',
      objects: [
        {
          ...object('candidate:1', OntologyObjectType.CANDIDATE),
          scenarioId: 'scenario:other',
        },
      ],
      links: [],
    }
    expect(() => validateScenarioIsolation(base, escaped)).toThrow(/outside/)

    const shadow: ScenarioOverlay = {
      scenarioId: 'scenario:1',
      objects: [{ ...object('asset:1'), scenarioId: 'scenario:1' }],
      links: [],
    }
    expect(() => validateScenarioIsolation(base, shadow)).toThrow(/shadows/)
  })

  it('reuses stable object identity in Object Set, Search Around and Object View', () => {
    const registry = createOntologyRegistry({
      objects: [
        object('asset:host'),
        object('asset:lun'),
        object('knowledge:host', OntologyObjectType.KNOWLEDGE),
      ],
      links: [
        link('link:path', 'asset:host', 'asset:lun'),
        {
          ...link('link:type', 'asset:host', 'knowledge:host'),
          type: OntologyLinkType.INSTANCE_OF,
        },
      ],
      catalog: { functions: [], skills: [], actions: [] },
    })

    const set = registry.objectSet({
      text: 'asset:host',
      lens: LensId.TOPOLOGY,
    })
    const around = registry.searchAround('asset:host', 1, LensId.TOPOLOGY)
    const view = registry.objectView('asset:host', LensId.TOPOLOGY)

    expect(set.objects[0]).toBe(registry.baseSnapshot().objects[0])
    expect(around.objects.map(({ id }) => id)).toContain('asset:host')
    expect(view?.object).toBe(registry.baseSnapshot().objects[0])
  })

  it('loads the shipped model as one valid ontology snapshot', () => {
    const registry = loadOntologyRegistry()
    const snapshot = registry.baseSnapshot()
    expect(() => validateOntologySnapshot(snapshot)).not.toThrow()
    expect(snapshot.objects.some(({ type }) => type === OntologyObjectType.ASSET)).toBe(true)
    expect(
      snapshot.objects.some(({ type }) => type === OntologyObjectType.KNOWLEDGE),
    ).toBe(true)
    const initialProjection = JSON.stringify(
      registry.project(LensId.TOPOLOGY),
    ).toLocaleLowerCase()
    expect(initialProjection).not.toContain('watchdog')
    expect(initialProjection).not.toContain('热复位')
  })

  it('preserves explicit knowledge relation semantics and never silently downgrades', () => {
    const snapshot = loadOntologyRegistry().baseSnapshot()
    expect(snapshot.links.find(({ id }) => id === 'kg-ctrl-sus-warmreset')?.type)
      .toBe(OntologyLinkType.SUSCEPTIBLE_TO)
    expect(snapshot.links.find(({ id }) => id === 'kg-warmreset-trig-watchdog')?.type)
      .toBe(OntologyLinkType.TRIGGERED_BY)
    expect(snapshot.links.some(
      (link) => link.properties.sourceRelation === 'SUSCEPTIBLE_TO' && link.type === OntologyLinkType.DEPENDS_ON,
    )).toBe(false)
    expect(() => mapKnowledgeRelation('TYPO_RELATION')).toThrow(/unknown relation/)
  })

  it('rejects invalid model schema_name/schema_version and ontology enums/provenance', () => {
    const documents = {
      topology: structuredClone(topologyJson),
      knowledgeNodes: structuredClone(kgNodesJson),
      knowledgeEdges: structuredClone(kgEdgesJson),
      mappings: structuredClone(mappingsJson),
      projection: structuredClone(projectionJson),
    }
    ;(documents.topology as { schema_name: string }).schema_name = 'EVIL'
    expect(() => validateModelDocuments(documents)).toThrow(/schema_name/)

    const evilObject = object('evil')
    evilObject.type = 'EVIL' as never
    expect(() => validateOntologySnapshot({ objects: [evilObject], links: [] }))
      .toThrow(/Object type\/provenance/)

    const evilLink = link('evil-link', 'a', 'b')
    evilLink.provenance.source = 'MALICIOUS' as never
    expect(() => validateOntologySnapshot({ objects: [object('a'), object('b')], links: [evilLink] }))
      .toThrow(/Link type\/provenance/)
  })

  it('makes a Case-local Function visible to Registry Object View and Runtime from one catalog', () => {
    const definition: OntologyScenarioDefinition = {
      scenarioId: 'scenario:catalog-test',
      caseId: 'catalog-test',
      label: 'catalog test',
      schemaVersion: '2.0.0',
      catalog: {
        functionIds: ['fn.case-local'],
        skillIds: ['case_local_query'],
        actionIds: [],
        overlay: {
          functions: [{
            id: 'fn.case-local',
            label: 'Case-local query',
            effect: FunctionEffect.READ_ONLY,
            reads: [OntologyObjectType.ASSET],
            returns: 'FACT_PAYLOAD',
          }],
          skills: [{
            skillId: 'case_local_query',
            functionId: 'fn.case-local',
            ontologyReads: [OntologyObjectType.ASSET],
            ontologyWrites: [],
            resultMaterializedBy: 'RUNTIME',
          }],
        },
      },
      events: [],
    }
    const catalog = resolveScenarioCatalog(definition)
    const view = loadOntologyRegistry().objectView(
      'db-business-01',
      LensId.TOPOLOGY,
      undefined,
      catalog,
    )
    const skills = createSkillRegistry(catalog)
    expect(view?.availableFunctions.map(({ id }) => id)).toContain('fn.case-local')
    expect(skills.functionDefinition('case_local_query')?.id).toBe('fn.case-local')
  })

  it.each(Object.values(LensId))(
    'keeps controller-0a Object View free of hidden root-cause truth in %s without a Session',
    (lens) => {
      const view = loadOntologyRegistry().objectView('controller-0a', lens)
      const serialized = JSON.stringify(view).toLocaleLowerCase()

      expect(serialized).not.toContain('visibility":"hidden')
      expect(serialized).not.toContain('watchdog')
      expect(serialized).not.toContain('热复位')
      expect(serialized).not.toContain('evidence_rule')
      expect(serialized).not.toContain('证据规则')
    },
  )

  it('shows an activated hidden mapping in Object View only after its Evidence is reached', () => {
    const definition = scenarioJson as OntologyScenarioDefinition
    const sequence = objectEventSequence(definition, 'evidence.direct-reset')
    const overlay = replayEvents(definition, sequence).overlay
    const view = loadOntologyRegistry().objectView(
      'controller-0a',
      LensId.KNOWLEDGE,
      overlay,
    )

    expect(view?.outgoing.map(({ link }) => link.id)).toContain('xm-afm-0a-warmreset')
    expect(view?.outgoing.map(({ link }) => link.id)).not.toContain('xm-afm-0a-watchdog')
  })

  it('uses an immutable frontier for exact Search Around depth in unordered cyclic graphs', () => {
    const registry = createOntologyRegistry({
      objects: ['a', 'b', 'c', 'd'].map((id) => object(id)),
      links: [
        link('c-d', 'c', 'd'),
        link('b-c', 'b', 'c'),
        link('a-b', 'a', 'b'),
        link('c-a', 'c', 'a'),
      ],
      catalog: { functions: [], skills: [], actions: [] },
    })

    expect(registry.searchAround('a', 0, LensId.TOPOLOGY).objects.map(({ id }) => id))
      .toEqual(['a'])
    expect(registry.searchAround('a', 1, LensId.TOPOLOGY).objects.map(({ id }) => id))
      .toEqual(['a', 'b', 'c'])
    expect(registry.searchAround('a', 2, LensId.TOPOLOGY).objects.map(({ id }) => id))
      .toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns only a and b at depth 1 for the a-b-c chain', () => {
    const registry = createOntologyRegistry({
      objects: ['a', 'b', 'c'].map((id) => object(id)),
      links: [link('a-b', 'a', 'b'), link('b-c', 'b', 'c')],
      catalog: { functions: [], skills: [], actions: [] },
    })

    expect(registry.searchAround('a', 1, LensId.TOPOLOGY).objects.map(({ id }) => id))
      .toEqual(['a', 'b'])
  })
})

function objectEventSequence(definition: OntologyScenarioDefinition, objectId: string): number {
  return definition.events.find((event) =>
    event.mutation.upsertObjects?.some((object) => object.id === objectId),
  )!.sequence
}
