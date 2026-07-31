// Model loader: turns the JSON model assets (instance topology, fault knowledge
// graph, cross-layer mappings, projection config) into a single graph-data shape
// that 3d-force-graph can render directly.
//
// Design notes (see docs/实例拓扑视图展示与交互规格_V1.0.md):
//   - Both planes share ONE 3d-force-graph scene. The topology plane sits at the
//     configured upper Y, the knowledge graph at the lower Y. Coordinates come
//     from projection-config.json's `node_positions` (the authoritative,
//     offline-baked "半固定坐标"); a deterministic fallback is computed from the
//     domain / layer anchors if a position is ever missing.
//   - Positions are pinned (fx/fy/fz) so the force simulation never disturbs the
//     contract layout — local anti-overlap is handled by the offline coordinates.
//   - Cross-layer mappings: INSTANCE_OF is structural ("Controller-0A is a
//     StorageController") and non-diagnosis-revealing, so it is shown faintly as a
//     baseline mapping. APPLICABLE_FAULT_MODE / EVIDENCE_MAPPING / CASE_MATCH are
//     hidden by default (they would leak the root cause) and surface only via the
//     navigator's cross-layer toggle. This honors 铁律 #4 (no early root-cause leak)
//     and §8.1 (少量基线映射, 禁止初始全量发光).

import type { NodeObject, LinkObject } from '3d-force-graph'

// The model JSON lives at the project root (model/), while this module sits in
// src/lib — so reach it with a root-relative path rather than the `@/` alias
// (which maps to src/).
import topologyJson from '../../model/topology/instances.json'
import kgNodesJson from '../../model/knowledge-graph/nodes.json'
import kgEdgesJson from '../../model/knowledge-graph/edges.json'
import mappingsJson from '../../model/mappings/cross-layer-mappings.json'
import projectionJson from '../../model/projection/projection-config.json'

import { PLANE_COLORS, LINK_COLORS } from './utils'

// ---------------------------------------------------------------------------
// Raw JSON shapes (only the fields the loader consumes; extra fields are ignored)
// ---------------------------------------------------------------------------

interface RawSpatialDomain {
  code: string
  name: string
  order: number
  location: 'external' | 'internal'
}
interface RawTopologyResource {
  resource_id: string
  resource_type: string
  name: string
  display_name: string
  health_status: string
  parent_id: string | null
  device_id: string | null
  cluster_id: string | null
  spatial_domain: string
  internal_zone: string | null
  aggregation_key: string | null
  order: number
  attributes?: Record<string, unknown>
  display?: { label?: string; default_expanded?: boolean; aggregate_group?: string | null }
}
interface RawTopologyEdge {
  edge_id: string
  source_id: string
  target_id: string
  relation_type: string
  direction: string
  path_group: string | null
  redundancy_group: string | null
  state: string
}
interface RawTopology {
  spatial_domains: RawSpatialDomain[]
  resources: RawTopologyResource[]
  edges: RawTopologyEdge[]
}
interface RawKgLayer {
  code: string
  name: string
  order: number
}
interface RawKgNode {
  node_id: string
  node_type: string
  layer: string
  code: string
  name: string
  order: number
  description?: string
  attributes?: Record<string, unknown>
}
interface RawKgEdge {
  edge_id: string
  source_id: string
  target_id: string
  relation_type: string
  direction: string
  weight?: number
}
interface RawKgNodes {
  layers: RawKgLayer[]
  nodes: RawKgNode[]
}
interface RawKgEdges {
  edges: RawKgEdge[]
}
type CrossRelationType =
  | 'INSTANCE_OF'
  | 'APPLICABLE_FAULT_MODE'
  | 'EVIDENCE_MAPPING'
  | 'CASE_MATCH'
interface RawMapping {
  mapping_id: string
  relation_type: CrossRelationType
  source_layer: 'instance' | 'knowledge'
  source_id: string
  target_layer: 'instance' | 'knowledge'
  target_id: string
  visibility: 'contextual' | 'hidden'
  description?: string
}
interface RawMappings {
  visibility_policy: Record<CrossRelationType, 'contextual' | 'hidden'>
  mappings: RawMapping[]
}
interface RawPoint {
  x: number
  y: number
  z: number
}
interface CameraPreset {
  label: string
  position: RawPoint
  look_at: RawPoint
}
interface RawProjection {
  planes: {
    topology: { y: number; label: string }
    knowledge: { y: number; label: string }
  }
  domain_anchors: Record<string, { x: number; z?: number; name: string }>
  knowledge_layer_anchors: Record<string, { x: number; name: string }>
  node_positions: Record<string, RawPoint>
  label_rules: {
    topology_always: string[]
    knowledge_always: string[]
  }
  camera_presets: Record<string, CameraPreset>
  initial_preset: string
}

const topology = topologyJson as RawTopology
const kgNodes = kgNodesJson as RawKgNodes
const kgEdges = kgEdgesJson as RawKgEdges
const mappings = mappingsJson as RawMappings
const projection = projectionJson as RawProjection

// ---------------------------------------------------------------------------
// Graph data shapes (what 3d-force-graph consumes)
// ---------------------------------------------------------------------------

export type Plane = 'topology' | 'knowledge'

export type CrossRelation = CrossRelationType

/**
 * A renderable node. Extends three-forcegraph's NodeObject so it can be passed
 * straight to 3d-force-graph. `fx/fy/fz` pin the position.
 */
export interface GraphNode extends NodeObject {
  id: string
  /** Human-readable label shown on the sphere / in lists. */
  label: string
  plane: Plane
  /** spatial_domain (topology) or layer (knowledge). Drives filtering. */
  group: string
  /** Human name of the group (domain name / layer name). */
  groupName: string
  /** resource_type (topology) or node_type (knowledge). */
  kind: string
  description?: string
  healthStatus?: string
  /** Node size weight in [1, ~3]; bigger for key objects. */
  val: number
  /** Base neutral color (blue/purple) — diagnosis overlays override later. */
  color: string
  /** Whether the label is always visible regardless of zoom. */
  alwaysLabel: boolean
  // Position (pinned)
  x: number
  y: number
  z: number
  fx: number
  fy: number
  fz: number
}

export type LinkCategory = 'topology' | 'knowledge' | 'cross'

export interface GraphLink extends LinkObject<GraphNode> {
  /** Source node id (string until 3d-force-graph binds it). */
  source: string
  target: string
  category: LinkCategory
  /** Relation type within the source model (ACCESSES, CAUSED_BY, …). */
  relation: string
  /** Only present on cross-layer links. */
  crossRelation?: CrossRelation
  /** visibility policy from the mapping (contextual | hidden). */
  crossVisibility?: 'contextual' | 'hidden'
  /** Human description (cross-layer mappings carry one). */
  description?: string
  /** Topology path_group (e.g. block-path-a) used by the business-path view. */
  pathGroup?: string | null
  weight?: number
}

export interface DomainInfo {
  code: string
  name: string
  order: number
  location: 'external' | 'internal'
  count: number
}

export interface LayerInfo {
  code: string
  name: string
  order: number
  count: number
}

export interface PresetInfo {
  key: string
  label: string
  position: RawPoint
  lookAt: RawPoint
}

/** Options passed to {@link buildActiveGraph} to filter the visible subgraph. */
export interface GraphFilter {
  layerTopology: boolean
  layerKnowledge: boolean
  /** visibleDomains[code] / visibleKgLayers[code] === true → keep. */
  visibleDomains: Record<string, boolean>
  visibleKgLayers: Record<string, boolean>
  /** Master toggle: when true, every cross-layer mapping is drawn. */
  showCrossLayer: boolean
}

export interface ActiveGraph {
  nodes: GraphNode[]
  links: GraphLink[]
}

export interface ModelData {
  nodes: GraphNode[]
  links: GraphLink[]
  nodesById: Map<string, GraphNode>
  /** id → neighbor ids across ALL links (used for hover/selection highlight). */
  adjacency: Map<string, Set<string>>
  domains: DomainInfo[]
  kgLayers: LayerInfo[]
  presets: PresetInfo[]
  initialPreset: string
  counts: { topology: number; knowledge: number; cross: number }
}

// ---------------------------------------------------------------------------
// Transform helpers
// ---------------------------------------------------------------------------

/** Resource types rendered larger because they carry the scene's focal weight. */
const BIG_KINDS = new Set(['STORAGE_DEVICE', 'CONTROLLER', 'BUSINESS', 'BLOCK_SERVICE'])
const MID_KINDS = new Set([
  'LUN',
  'STORAGE_POOL',
  'HOST',
  'SAN_FABRIC',
  'OBJECT_TYPE',
  'SYMPTOM',
  'FAULT_MODE',
])

function nodeWeight(plane: Plane, kind: string): number {
  if (BIG_KINDS.has(kind)) return 2.6
  if (MID_KINDS.has(kind)) return 1.9
  if (plane === 'knowledge' && (kind === 'CASE' || kind === 'EVIDENCE_RULE')) return 1.5
  return 1.3
}

/** Resolve a node's 3D position: prefer the baked coordinates, else anchor-based. */
function resolveTopologyPosition(res: RawTopologyResource): RawPoint {
  const baked = projection.node_positions[res.resource_id]
  if (baked) return baked
  const anchor = projection.domain_anchors[res.spatial_domain]
  const baseX = anchor?.x ?? 0
  const z = (res.order ?? 0) * 26 - 30
  return { x: baseX, y: projection.planes.topology.y, z }
}

function resolveKnowledgePosition(node: RawKgNode): RawPoint {
  const baked = projection.node_positions[node.node_id]
  if (baked) return baked
  const anchor = projection.knowledge_layer_anchors[node.layer]
  const baseX = anchor?.x ?? 0
  const z = (node.order ?? 0) * 22 - 20
  return { x: baseX, y: projection.planes.knowledge.y, z }
}

function buildTopologyNodes(): GraphNode[] {
  const domainByName = new Map(topology.spatial_domains.map((d) => [d.code, d]))
  const alwaysSet = new Set(projection.label_rules.topology_always)
  return topology.resources.map((res): GraphNode => {
    const pos = resolveTopologyPosition(res)
    const domain = domainByName.get(res.spatial_domain)
    return {
      id: res.resource_id,
      label: res.display?.label ?? res.display_name ?? res.name,
      plane: 'topology',
      group: res.spatial_domain,
      groupName: domain?.name ?? res.spatial_domain,
      kind: res.resource_type,
      description: undefined,
      healthStatus: res.health_status,
      val: nodeWeight('topology', res.resource_type),
      color: PLANE_COLORS.topology,
      alwaysLabel: alwaysSet.has(res.resource_id),
      x: pos.x,
      y: pos.y,
      z: pos.z,
      fx: pos.x,
      fy: pos.y,
      fz: pos.z,
    }
  })
}

function buildKnowledgeNodes(): GraphNode[] {
  const layerByName = new Map(kgNodes.layers.map((l) => [l.code, l]))
  const alwaysSet = new Set(projection.label_rules.knowledge_always)
  return kgNodes.nodes.map((node): GraphNode => {
    const pos = resolveKnowledgePosition(node)
    const layer = layerByName.get(node.layer)
    return {
      id: node.node_id,
      label: node.name,
      plane: 'knowledge',
      group: node.layer,
      groupName: layer?.name ?? node.layer,
      kind: node.node_type,
      description: node.description,
      val: nodeWeight('knowledge', node.node_type),
      color: PLANE_COLORS.knowledge,
      alwaysLabel: alwaysSet.has(node.node_id),
      x: pos.x,
      y: pos.y,
      z: pos.z,
      fx: pos.x,
      fy: pos.y,
      fz: pos.z,
    }
  })
}

function buildTopologyLinks(): GraphLink[] {
  return topology.edges.map(
    (e): GraphLink => ({
      source: e.source_id,
      target: e.target_id,
      category: 'topology',
      relation: e.relation_type,
      pathGroup: e.path_group,
    }),
  )
}

function buildKnowledgeLinks(): GraphLink[] {
  return kgEdges.edges.map(
    (e): GraphLink => ({
      source: e.source_id,
      target: e.target_id,
      category: 'knowledge',
      relation: e.relation_type,
      weight: e.weight,
    }),
  )
}

function buildCrossLinks(): GraphLink[] {
  return mappings.mappings.map(
    (m): GraphLink => ({
      source: m.source_id,
      target: m.target_id,
      category: 'cross',
      relation: m.relation_type,
      crossRelation: m.relation_type,
      crossVisibility: m.visibility,
      description: m.description,
    }),
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let cached: ModelData | null = null

/**
 * Load and transform the model assets into graph data. Pure and synchronous
 * (the JSON is imported at module time by the bundler), so the result is cached
 * for the lifetime of the app.
 */
export function loadModelData(): ModelData {
  if (cached) return cached

  const nodes = [...buildTopologyNodes(), ...buildKnowledgeNodes()]
  const links = [...buildTopologyLinks(), ...buildKnowledgeLinks(), ...buildCrossLinks()]

  const nodesById = new Map(nodes.map((n) => [n.id, n]))

  // Adjacency across every link (neighbor lookup for highlight).
  const adjacency = new Map<string, Set<string>>()
  for (const n of nodes) adjacency.set(n.id, new Set())
  for (const l of links) {
    if (!nodesById.has(l.source) || !nodesById.has(l.target)) continue
    adjacency.get(l.source)!.add(l.target)
    adjacency.get(l.target)!.add(l.source)
  }

  const domains: DomainInfo[] = topology.spatial_domains
    .map((d) => ({
      code: d.code,
      name: d.name,
      order: d.order,
      location: d.location,
      count: nodes.filter((n) => n.plane === 'topology' && n.group === d.code).length,
    }))
    .sort((a, b) => a.order - b.order)

  // Preserve the configured knowledge-layer order; MECHANISM shares order 2 with
  // FAULT_MODE in the source, so we keep file order via a stable secondary key.
  const layerOrder = new Map(kgNodes.layers.map((l, i) => [l.code, i]))
  const kgLayers: LayerInfo[] = kgNodes.layers
    .map((l) => ({
      code: l.code,
      name: l.name,
      order: l.order,
      count: nodes.filter((n) => n.plane === 'knowledge' && n.group === l.code).length,
    }))
    .sort((a, b) => (layerOrder.get(a.code) ?? 0) - (layerOrder.get(b.code) ?? 0))

  const presets: PresetInfo[] = Object.entries(projection.camera_presets).map(
    ([key, p]) => ({
      key,
      label: p.label,
      position: p.position,
      lookAt: p.look_at,
    }),
  )

  cached = {
    nodes,
    links,
    nodesById,
    adjacency,
    domains,
    kgLayers,
    presets,
    initialPreset: projection.initial_preset,
    counts: {
      topology: nodes.filter((n) => n.plane === 'topology').length,
      knowledge: nodes.filter((n) => n.plane === 'knowledge').length,
      cross: links.filter((l) => l.category === 'cross').length,
    },
  }
  return cached
}

/**
 * Project the full model through a {@link GraphFilter} into the subgraph that
 * should currently render. Returns shallow clones so 3d-force-graph may bind
 * link source/target to node objects without mutating the cached master data.
 */
export function buildActiveGraph(model: ModelData, filter: GraphFilter): ActiveGraph {
  const nodeVisible = (n: GraphNode): boolean => {
    if (n.plane === 'topology') {
      return filter.layerTopology && filter.visibleDomains[n.group] !== false
    }
    return filter.layerKnowledge && filter.visibleKgLayers[n.group] !== false
  }

  const visibleNodes = model.nodes.filter(nodeVisible)
  const visibleIds = new Set(visibleNodes.map((n) => n.id))

  const linkVisible = (l: GraphLink): boolean => {
    if (!visibleIds.has(l.source) || !visibleIds.has(l.target)) return false
    if (l.category === 'cross') {
      // Baseline structural INSTANCE_OF mappings stay faint; everything else
      // (fault mode / evidence / case) is gated behind the master toggle so the
      // root cause is never leaked before diagnosis.
      if (l.crossRelation === 'INSTANCE_OF' && l.crossVisibility === 'contextual') {
        return true
      }
      return filter.showCrossLayer
    }
    return true
  }

  return {
    // Clone so fixed-position fields are pristine on every filter change.
    nodes: visibleNodes.map((n) => ({ ...n })),
    links: model.links.filter(linkVisible).map((l) => ({ ...l })),
  }
}

/** Resolve the CSS link color for a link given the current view context. */
export function linkColorFor(
  link: GraphLink,
  ctx: { showCrossLayer: boolean; businessPath: boolean },
): string {
  if (ctx.businessPath && link.pathGroup && link.pathGroup.startsWith('block-path')) {
    return LINK_COLORS.businessPath
  }
  switch (link.category) {
    case 'topology':
      return LINK_COLORS.topology
    case 'knowledge':
      return LINK_COLORS.knowledge
    case 'cross':
      return ctx.showCrossLayer ? LINK_COLORS.crossActive : LINK_COLORS.crossBaseline
  }
}
