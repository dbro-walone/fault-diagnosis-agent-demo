import topologyJson from '../../model/topology/instances.json'
import kgNodesJson from '../../model/knowledge-graph/nodes.json'
import kgEdgesJson from '../../model/knowledge-graph/edges.json'
import mappingsJson from '../../model/mappings/cross-layer-mappings.json'
import projectionJson from '../../model/projection/projection-config.json'
import { OntologyLinkType, OntologyObjectType } from '../../schemas/enums'
import type {
  JsonValue,
  OntologyLink,
  OntologyObject,
} from '../../schemas/types'
import { createOntologyRegistry, type OntologyRegistry } from './registry'
import { BASE_CATALOG } from './catalog'

interface TopologyResource {
  resource_id: string
  resource_type: string
  display_name: string
  health_status: string
  spatial_domain: string
  internal_zone: string | null
  parent_id: string | null
  device_id: string | null
  attributes?: Record<string, unknown>
}
interface TopologyEdge {
  edge_id: string
  source_id: string
  target_id: string
  relation_type: string
  direction: string
  path_group?: string | null
  redundancy_group?: string | null
}
interface KnowledgeNode {
  node_id: string
  node_type: string
  layer: string
  code: string
  name: string
  description?: string
  attributes?: Record<string, unknown>
}
interface KnowledgeEdge {
  edge_id: string
  source_id: string
  target_id: string
  relation_type: string
  weight?: number
}
interface Mapping {
  mapping_id: string
  relation_type: string
  source_id: string
  target_id: string
  visibility: string
  description?: string
}

interface SchemaDocument {
  schema_name?: unknown
  schema_version?: unknown
  [key: string]: unknown
}

export interface ModelDocuments {
  topology: unknown
  knowledgeNodes: unknown
  knowledgeEdges: unknown
  mappings: unknown
  projection: unknown
}

function assertSchemaDocument(
  value: unknown,
  schemaName: string,
  collectionKeys: string[],
): asserts value is SchemaDocument {
  if (
    typeof value !== 'object' || value === null || Array.isArray(value) ||
    (value as SchemaDocument).schema_name !== schemaName ||
    (value as SchemaDocument).schema_version !== '1.0.0' ||
    collectionKeys.some((key) => !Array.isArray((value as SchemaDocument)[key]))
  ) throw new Error(`[model] invalid ${schemaName} schema_name/schema_version or collections`)
}

export function validateModelDocuments(documents: ModelDocuments): void {
  assertSchemaDocument(documents.topology, 'dme-fault-topology', ['resources', 'edges'])
  assertSchemaDocument(documents.knowledgeNodes, 'dme-fault-knowledge-graph', ['nodes'])
  assertSchemaDocument(documents.knowledgeEdges, 'dme-fault-knowledge-graph-edges', ['edges'])
  assertSchemaDocument(documents.mappings, 'dme-fault-cross-layer-mappings', ['mappings'])
  const projection = documents.projection as SchemaDocument
  if (
    typeof projection !== 'object' || projection === null ||
    projection.schema_name !== 'dme-fault-projection-config' ||
    projection.schema_version !== '1.0.0'
  ) throw new Error('[model] invalid projection schema_name/schema_version')
}

/** V1 resource_type → 细粒度 OntologyObjectType（docs/03 §3）；未知资源回落 ASSET。 */
const RESOURCE_TYPE_MAP: Partial<Record<string, OntologyObjectType>> = {
  BUSINESS: OntologyObjectType.BUSINESS_SERVICE,
  HOST: OntologyObjectType.HOST,
  SAN_FABRIC: OntologyObjectType.FABRIC,
  FC_PORT: OntologyObjectType.PORT,
  STORAGE_DEVICE: OntologyObjectType.STORAGE_SYSTEM,
  CONTROLLER: OntologyObjectType.CONTROLLER,
  BLOCK_SERVICE: OntologyObjectType.SERVICE,
  LUN: OntologyObjectType.LUN,
  STORAGE_POOL: OntologyObjectType.POOL,
  DISK_ENCLOSURE: OntologyObjectType.ENCLOSURE,
  DISK: OntologyObjectType.DISK,
}

const TOPOLOGY_LINK_MAP: Record<string, OntologyLinkType> = {
  ACCESSES: OntologyLinkType.ACCESSES,
  PHYSICAL_CONNECTS: OntologyLinkType.CONNECTS_TO,
  DEPENDS_ON: OntologyLinkType.DEPENDS_ON,
  HOSTS: OntologyLinkType.HOSTS,
  PROVIDES_SERVICE: OntologyLinkType.PROVIDES_SERVICE,
  BACKED_BY: OntologyLinkType.BACKED_BY,
  BELONGS_TO: OntologyLinkType.BELONGS_TO,
  PRIMARY_BACKUP_OF: OntologyLinkType.PRIMARY_BACKUP_OF,
}

const KNOWLEDGE_LINK_MAP: Record<string, OntologyLinkType> = {
  APPLIES_TO: OntologyLinkType.APPLICABLE_TO,
  EXHIBITS: OntologyLinkType.EXHIBITS,
  SUSCEPTIBLE_TO: OntologyLinkType.SUSCEPTIBLE_TO,
  CAUSED_BY: OntologyLinkType.CAUSED_BY,
  TRIGGERED_BY: OntologyLinkType.TRIGGERED_BY,
  LEADS_TO: OntologyLinkType.LEADS_TO,
  EVIDENCED_BY: OntologyLinkType.EVIDENCED_BY,
  INSTANCE_OF_CASE: OntologyLinkType.INSTANCE_OF,
  REFERENCES: OntologyLinkType.EVIDENCED_BY,
}

const MAPPING_LINK_MAP: Record<string, OntologyLinkType> = {
  INSTANCE_OF: OntologyLinkType.INSTANCE_OF,
  APPLICABLE_FAULT_MODE: OntologyLinkType.APPLICABLE_TO,
  EVIDENCE_MAPPING: OntologyLinkType.EVIDENCED_BY,
  CASE_MATCH: OntologyLinkType.CASE_MATCH,
}

function mappedRelation(
  mapping: Record<string, OntologyLinkType>,
  relation: string,
  source: string,
): OntologyLinkType {
  const type = mapping[relation]
  if (!type) throw new Error(`[ontology] unknown relation ${relation} in ${source}`)
  return type
}

export function mapKnowledgeRelation(relation: string): OntologyLinkType {
  return mappedRelation(KNOWLEDGE_LINK_MAP, relation, 'knowledge')
}

function json(value: unknown): JsonValue {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function modelProvenance(sourceRef: string) {
  return { source: 'MODEL' as const, sourceRef }
}

function topologyObjects(): OntologyObject[] {
  return (topologyJson.resources as TopologyResource[]).map((resource) => ({
    id: resource.resource_id,
    type: RESOURCE_TYPE_MAP[resource.resource_type] ?? OntologyObjectType.ASSET,
    label: resource.display_name,
    properties: {
      assetType: resource.resource_type,
      healthStatus: resource.health_status,
      spatialDomain: resource.spatial_domain,
      internalZone: resource.internal_zone,
      parentId: resource.parent_id,
      deviceId: resource.device_id,
      attributes: json(resource.attributes),
      plane: 'topology',
    },
    provenance: modelProvenance('model/topology/instances.json'),
  }))
}

function knowledgeObjects(): OntologyObject[] {
  return (kgNodesJson.nodes as KnowledgeNode[]).map((node) => ({
    id: node.node_id,
    type: OntologyObjectType.KNOWLEDGE,
    label: node.name,
    properties: {
      knowledgeKind: node.node_type,
      layer: node.layer,
      code: node.code,
      description: node.description ?? '',
      attributes: json(node.attributes),
      plane: 'knowledge',
    },
    provenance: modelProvenance('model/knowledge-graph/nodes.json'),
  }))
}

function topologyLinks(): OntologyLink[] {
  return (topologyJson.edges as TopologyEdge[]).map((edge) => ({
    id: edge.edge_id,
    type: mappedRelation(TOPOLOGY_LINK_MAP, edge.relation_type, 'topology'),
    sourceId: edge.source_id,
    targetId: edge.target_id,
    properties: {
      sourceRelation: edge.relation_type,
      direction: edge.direction,
      pathGroup: edge.path_group ?? null,
      redundancyGroup: edge.redundancy_group ?? null,
      plane: 'topology',
    },
    provenance: modelProvenance('model/topology/instances.json'),
  }))
}

function knowledgeLinks(): OntologyLink[] {
  return (kgEdgesJson.edges as KnowledgeEdge[]).map((edge) => ({
    id: edge.edge_id,
    type: mapKnowledgeRelation(edge.relation_type),
    sourceId: edge.source_id,
    targetId: edge.target_id,
    properties: {
      sourceRelation: edge.relation_type,
      weight: edge.weight ?? 0.5,
      plane: 'knowledge',
    },
    provenance: modelProvenance('model/knowledge-graph/edges.json'),
  }))
}

function mappingLinks(): OntologyLink[] {
  return (mappingsJson.mappings as Mapping[]).map((mapping) => ({
    id: mapping.mapping_id,
    type: mappedRelation(MAPPING_LINK_MAP, mapping.relation_type, 'cross-layer mappings'),
    sourceId: mapping.source_id,
    targetId: mapping.target_id,
    properties: {
      sourceRelation: mapping.relation_type,
      visibility: mapping.visibility,
      description: mapping.description ?? '',
      plane: 'cross',
    },
    provenance: modelProvenance('model/mappings/cross-layer-mappings.json'),
  }))
}

let registry: OntologyRegistry | null = null

export function loadOntologyRegistry(): OntologyRegistry {
  if (!registry) {
    validateModelDocuments({
      topology: topologyJson,
      knowledgeNodes: kgNodesJson,
      knowledgeEdges: kgEdgesJson,
      mappings: mappingsJson,
      projection: projectionJson,
    })
    registry = createOntologyRegistry({
      objects: [...topologyObjects(), ...knowledgeObjects()],
      links: [...topologyLinks(), ...knowledgeLinks(), ...mappingLinks()],
      catalog: BASE_CATALOG,
    })
  }
  return registry
}
