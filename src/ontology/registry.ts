import {
  LensId,
  OntologyLinkType,
  OntologyObjectType,
} from '../../schemas/enums'
import type {
  ActionDefinition,
  CatalogSnapshot,
  FunctionDefinition,
  ObjectSet,
  ObjectSetQuery,
  ObjectView,
  OntologyLink,
  OntologyObject,
  OntologySnapshot,
  ScenarioOverlay,
} from '../../schemas/types'
import { projectLens } from './lenses'

export interface OntologyRegistry {
  baseSnapshot(): OntologySnapshot
  snapshot(overlay?: ScenarioOverlay): OntologySnapshot
  objectSet(query: ObjectSetQuery, overlay?: ScenarioOverlay): ObjectSet
  searchAround(
    objectId: string,
    depth: number,
    lens: LensId,
    overlay?: ScenarioOverlay,
  ): OntologySnapshot
  objectView(
    objectId: string,
    lens: LensId,
    overlay?: ScenarioOverlay,
    catalog?: CatalogSnapshot,
  ): ObjectView | null
  project(lens: LensId, overlay?: ScenarioOverlay): OntologySnapshot
}

export interface OntologyRegistrySeed extends OntologySnapshot {
  catalog: CatalogSnapshot
}

function assertUnique<T>(items: T[], idOf: (item: T) => string, label: string): void {
  const seen = new Set<string>()
  for (const item of items) {
    const id = idOf(item)
    if (!id || seen.has(id)) throw new Error(`[ontology] duplicate or empty ${label} id: ${id}`)
    seen.add(id)
  }
}

export function validateOntologySnapshot(snapshot: OntologySnapshot): void {
  if (!snapshot || !Array.isArray(snapshot.objects) || !Array.isArray(snapshot.links)) {
    throw new Error('[ontology] malformed snapshot')
  }
  assertUnique(snapshot.objects, (object) => object.id, 'object')
  assertUnique(snapshot.links, (link) => link.id, 'link')
  for (const object of snapshot.objects) {
    if (
      !Object.values(OntologyObjectType).includes(object.type) ||
      typeof object.label !== 'string' || !object.properties ||
      !['MODEL', 'SCENARIO', 'RUNTIME'].includes(object.provenance?.source) ||
      typeof object.provenance?.sourceRef !== 'string' || !object.provenance.sourceRef
    ) throw new Error(`[ontology] invalid Object type/provenance: ${object.id}`)
  }
  for (const link of snapshot.links) {
    if (
      !Object.values(OntologyLinkType).includes(link.type) ||
      link.type === OntologyLinkType.UNKNOWN || !link.properties ||
      !['MODEL', 'SCENARIO', 'RUNTIME'].includes(link.provenance?.source) ||
      typeof link.provenance?.sourceRef !== 'string' || !link.provenance.sourceRef
    ) throw new Error(`[ontology] invalid Link type/provenance: ${link.id}`)
  }
  const objectIds = new Set(snapshot.objects.map((object) => object.id))
  for (const link of snapshot.links) {
    if (!objectIds.has(link.sourceId) || !objectIds.has(link.targetId)) {
      throw new Error(
        `[ontology] dangling link ${link.id}: ${link.sourceId} -> ${link.targetId}`,
      )
    }
  }
}

export function validateScenarioIsolation(
  base: OntologySnapshot,
  overlay: ScenarioOverlay,
): void {
  const baseIds = new Set(base.objects.map((object) => object.id))
  for (const object of overlay.objects) {
    if (baseIds.has(object.id)) {
      throw new Error(`[scenario] overlay shadows base object identity: ${object.id}`)
    }
    if (object.scenarioId !== overlay.scenarioId) {
      throw new Error(`[scenario] object ${object.id} is outside ${overlay.scenarioId}`)
    }
  }
  for (const link of overlay.links) {
    if (link.scenarioId !== overlay.scenarioId) {
      throw new Error(`[scenario] link ${link.id} is outside ${overlay.scenarioId}`)
    }
  }
}

function mergeSnapshot(base: OntologySnapshot, overlay?: ScenarioOverlay): OntologySnapshot {
  if (!overlay) return base
  validateScenarioIsolation(base, overlay)
  const snapshot = {
    objects: [...base.objects, ...overlay.objects],
    links: [...base.links, ...overlay.links],
  }
  validateOntologySnapshot(snapshot)
  return snapshot
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function searchableText(object: OntologyObject): string {
  return normalize(
    `${object.id} ${object.label} ${object.type} ${JSON.stringify(object.properties)}`,
  )
}

export function createOntologyRegistry(seed: OntologyRegistrySeed): OntologyRegistry {
  validateOntologySnapshot(seed)
  const base: OntologySnapshot = {
    objects: seed.objects.map((object) => ({ ...object, properties: { ...object.properties } })),
    links: seed.links.map((link) => ({ ...link, properties: { ...link.properties } })),
  }

  const objectSet = (query: ObjectSetQuery, overlay?: ScenarioOverlay): ObjectSet => {
    const source = query.lens ? projectLens(mergeSnapshot(base, overlay), query.lens) : mergeSnapshot(base, overlay)
    const text = normalize(query.text ?? '')
    const objects = source.objects.filter((object) => {
      if (query.scenarioId && object.scenarioId !== query.scenarioId) return false
      if (query.types?.length && !query.types.includes(object.type)) return false
      return !text || searchableText(object).includes(text)
    })
    return {
      id: `object-set:${query.lens ?? 'ALL'}:${text || '*'}`,
      label: text ? `“${query.text}” 的对象集` : '当前对象集',
      query,
      objects,
    }
  }

  const objectView = (
    objectId: string,
    lens: LensId,
    overlay?: ScenarioOverlay,
    catalog: CatalogSnapshot = seed.catalog,
  ): ObjectView | null => {
    const merged = mergeSnapshot(base, overlay)
    const projected = projectLens(merged, lens)
    const mergedObjectById = new Map(merged.objects.map((object) => [object.id, object]))
    const projectedObjectById = new Map(
      projected.objects.map((object) => [object.id, object]),
    )
    // Keep the selected stable identity available across Lens switches, but
    // derive every neighbour exclusively from the Lens' security projection.
    const object = mergedObjectById.get(objectId)
    if (!object) return null
    const outgoing = projected.links
      .filter((link) => link.sourceId === objectId)
      .map((link) => ({ link, object: projectedObjectById.get(link.targetId)! }))
    const incoming = projected.links
      .filter((link) => link.targetId === objectId)
      .map((link) => ({ link, object: projectedObjectById.get(link.sourceId)! }))
    const availableFunctions = catalog.functions.filter(
      (definition) =>
        definition.reads.includes(object.type) ||
        (object.type === OntologyObjectType.ASSET &&
          definition.reads.includes(OntologyObjectType.OBSERVATION)),
    )
    const availableActions = catalog.actions.filter((definition) =>
      definition.targetTypes.includes(object.type),
    )
    return { object, incoming, outgoing, availableFunctions, availableActions }
  }

  return {
    baseSnapshot: () => base,
    snapshot: (overlay) => mergeSnapshot(base, overlay),
    objectSet,
    project: (lens, overlay) => projectLens(mergeSnapshot(base, overlay), lens),
    objectView,
    searchAround: (objectId, depth, lens, overlay) => {
      const projected = projectLens(mergeSnapshot(base, overlay), lens)
      const selected = new Set<string>([objectId])
      let frontier = new Set<string>([objectId])
      for (let hop = 0; hop < Math.max(0, depth); hop++) {
        const next = new Set<string>()
        for (const link of projected.links) {
          if (frontier.has(link.sourceId) && !selected.has(link.targetId)) {
            next.add(link.targetId)
          }
          if (frontier.has(link.targetId) && !selected.has(link.sourceId)) {
            next.add(link.sourceId)
          }
        }
        for (const id of next) selected.add(id)
        frontier = next
        if (!frontier.size) break
      }
      return {
        objects: projected.objects.filter((object) => selected.has(object.id)),
        links: projected.links.filter(
          (link) => selected.has(link.sourceId) && selected.has(link.targetId),
        ),
      }
    },
  }
}
