import type { LinkObject, NodeObject } from '3d-force-graph'
import projectionJson from '../../model/projection/projection-config.json'
import {
  LensId,
  OntologyLinkType,
  OntologyObjectType,
} from '../../schemas/enums'
import type {
  OntologyLink,
  OntologyObject,
  ScenarioOverlay,
} from '../../schemas/types'
import { LENS_DEFINITIONS } from '../ontology/lenses'
import { loadOntologyRegistry } from '../ontology/model-adapter'
import type { OntologyRegistry } from '../ontology/registry'
import { LINK_COLORS, PLANE_COLORS, STATUS_COLORS } from './utils'

interface Point {
  x: number
  y: number
  z: number
}
interface ProjectionConfig {
  planes: {
    topology: { y: number; label: string }
    knowledge: { y: number; label: string }
  }
  node_positions: Record<string, Point>
  camera_presets: Record<
    string,
    { label: string; position: Point; look_at: Point }
  >
  initial_preset: string
  label_rules: { topology_always: string[]; knowledge_always: string[] }
}

const projection = projectionJson as ProjectionConfig

export type Plane = 'topology' | 'knowledge'
export type LinkCategory =
  | 'topology'
  | 'knowledge'
  | 'cross'
  | 'diagnosis'
  | 'impact'
  | 'audit'

export interface GraphNode extends NodeObject {
  id: string
  object: OntologyObject
  label: string
  plane: Plane
  group: string
  groupName: string
  kind: string
  healthStatus?: string
  val: number
  color: string
  alwaysLabel: boolean
  x: number
  y: number
  z: number
  fx: number
  fy: number
  fz: number
}

export interface GraphLink extends LinkObject<GraphNode> {
  id: string
  source: string
  target: string
  ontologyLink: OntologyLink
  category: LinkCategory
  relation: string
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
  position: Point
  lookAt: Point
}

export interface GraphFilter {
  lens: LensId
  overlay?: ScenarioOverlay
  layerTopology: boolean
  layerKnowledge: boolean
  visibleDomains: Record<string, boolean>
  visibleKgLayers: Record<string, boolean>
  showCrossLayer: boolean
  /** Optional Object Set / Search Around restriction. */
  objectIds?: Set<string>
  /** D3 设备级聚合：已展开的设备 id 集合（默认收起设备成员）。 */
  expandedDeviceIds?: Set<string>
  /** D3 关键对象保留（agent_focus/根因等）：即使所属设备收起仍显示（DETACHED_CRITICAL）。 */
  criticalObjectIds?: Set<string>
}

export interface ActiveGraph {
  nodes: GraphNode[]
  links: GraphLink[]
}

export interface ModelData {
  registry: OntologyRegistry
  nodes: GraphNode[]
  links: GraphLink[]
  nodesById: Map<string, GraphNode>
  domains: DomainInfo[]
  kgLayers: LayerInfo[]
  presets: PresetInfo[]
  initialPreset: string
  counts: { topology: number; knowledge: number; cross: number }
  /** 设备级聚合组（D3/§05）：deviceId → 成员对象 ids，供展开/收起钻取。 */
  deviceGroups: Array<{ deviceId: string; label: string; memberIds: string[] }>
}

/** 聚合摘要最高严重度（docs/05 §5 highest_severity；非概率）。 */
export type SeverityLevel = 'NORMAL' | 'WARNING' | 'CRITICAL'

/** 聚合摘要（docs/05 §5）：至少显示总数、异常数、候选数和最高严重度。 */
export interface AggregateSummary {
  deviceId: string
  label: string
  total: number
  anomaly: number
  candidate: number
  maxSeverity: SeverityLevel
}

/** 聚合摘要的运行时上下文 —— 由 App 从 diagnosis snapshot 推导，注入纯函数。 */
export interface AggregateSummaryContext {
  /** 根因 / agent_focus 关键对象 ids —— 计入异常并提升最高严重度。 */
  criticalIds?: Set<string>
  /** 受影响对象 ids（impact_chain）—— 计入异常。 */
  impactedIds?: Set<string>
  /** 候选根因指向的对象 ids —— 计入候选数。 */
  candidateObjectIds?: Set<string>
}

const SEVERITY_RANK: Record<SeverityLevel, number> = {
  NORMAL: 0,
  WARNING: 1,
  CRITICAL: 2,
}

/** 从 healthStatus 推导聚合严重度等级（FAULT/ABNORMAL → CRITICAL）。 */
export function healthSeverity(status: string | undefined | null): SeverityLevel {
  if (status === 'FAULT' || status === 'ABNORMAL') return 'CRITICAL'
  if (status === 'WARNING') return 'WARNING'
  return 'NORMAL'
}

/**
 * 通用组成员聚合摘要（docs/05 §5）。纯函数：给定成员 id + 标签 + id→node 查找表，
 * 成员异常 = healthStatus 非 NORMAL 或属于关键/受影响对象；候选数 = 候选指向本组成员的数量。
 *
 * computeAggregateSummary（设备级）与分层拓扑 computeLayerSummary（层级级，src/lib/layered-topology）
 * 共用同一计数口径，保证聚合语义一致。
 */
export function computeGroupSummary(
  memberIds: string[],
  groupId: string,
  label: string,
  nodesById: Map<string, GraphNode>,
  ctx: AggregateSummaryContext = {},
): AggregateSummary {
  let anomaly = 0
  let candidate = 0
  let maxSeverity: SeverityLevel = 'NORMAL'
  for (const memberId of memberIds) {
    const node = nodesById.get(memberId)
    const baseSeverity = healthSeverity(node?.healthStatus)
    const isCritical = ctx.criticalIds?.has(memberId) ?? false
    const isImpacted = ctx.impactedIds?.has(memberId) ?? false
    const memberSeverity: SeverityLevel = isCritical
      ? 'CRITICAL'
      : isImpacted
        ? 'WARNING'
        : baseSeverity
    if (SEVERITY_RANK[memberSeverity] > SEVERITY_RANK[maxSeverity]) {
      maxSeverity = memberSeverity
    }
    if (
      isCritical ||
      isImpacted ||
      (node?.healthStatus !== undefined && node.healthStatus !== 'NORMAL')
    ) {
      anomaly += 1
    }
    if (ctx.candidateObjectIds?.has(memberId) ?? false) candidate += 1
  }
  return {
    deviceId: groupId,
    label,
    total: memberIds.length,
    anomaly,
    candidate,
    maxSeverity,
  }
}

/**
 * 计算设备聚合摘要（docs/05 §5）。纯函数：仅依赖 model 的静态分组 + 可选运行时上下文。
 * 返回 null 表示非聚合设备（不在 deviceGroups 中）。
 */
export function computeAggregateSummary(
  model: ModelData,
  deviceId: string,
  ctx: AggregateSummaryContext = {},
): AggregateSummary | null {
  const group = model.deviceGroups.find((g) => g.deviceId === deviceId)
  if (!group) return null
  return computeGroupSummary(group.memberIds, group.deviceId, group.label, model.nodesById, ctx)
}

const TYPE_COLOR: Record<OntologyObjectType, string> = {
  [OntologyObjectType.ASSET]: PLANE_COLORS.topology,
  [OntologyObjectType.BUSINESS_SERVICE]: PLANE_COLORS.topology,
  [OntologyObjectType.HOST]: PLANE_COLORS.topology,
  [OntologyObjectType.FABRIC]: PLANE_COLORS.topology,
  [OntologyObjectType.PORT]: PLANE_COLORS.topology,
  [OntologyObjectType.STORAGE_SYSTEM]: PLANE_COLORS.topology,
  [OntologyObjectType.CONTROLLER]: PLANE_COLORS.topology,
  [OntologyObjectType.SERVICE]: PLANE_COLORS.topology,
  [OntologyObjectType.LUN]: PLANE_COLORS.topology,
  [OntologyObjectType.POOL]: PLANE_COLORS.topology,
  [OntologyObjectType.ENCLOSURE]: PLANE_COLORS.topology,
  [OntologyObjectType.DISK]: PLANE_COLORS.topology,
  [OntologyObjectType.REPLICATION_SESSION]: PLANE_COLORS.topology,
  [OntologyObjectType.REMOTE_DEVICE]: PLANE_COLORS.topology,
  [OntologyObjectType.KNOWLEDGE]: PLANE_COLORS.knowledge,
  [OntologyObjectType.OBSERVATION]: '#38bdf8',
  [OntologyObjectType.FACT]: STATUS_COLORS.evidence,
  [OntologyObjectType.CANDIDATE]: STATUS_COLORS.warning,
  [OntologyObjectType.EVIDENCE]: '#2dd4bf',
  [OntologyObjectType.PLAN]: '#60a5fa',
  [OntologyObjectType.TASK]: '#818cf8',
  [OntologyObjectType.FUNCTION_CALL]: '#22d3ee',
  [OntologyObjectType.ACTION_PROPOSAL]: '#f59e0b',
  [OntologyObjectType.DECISION]: STATUS_COLORS.recovered,
  [OntologyObjectType.SCENARIO]: '#c084fc',
}

/** 资源类 ObjectType 集合（ASSET + 细粒度资源）→ 拓扑平面；其余 → 知识平面。 */
const RESOURCE_OBJECT_TYPES = new Set<OntologyObjectType>([
  OntologyObjectType.ASSET,
  OntologyObjectType.BUSINESS_SERVICE,
  OntologyObjectType.HOST,
  OntologyObjectType.FABRIC,
  OntologyObjectType.PORT,
  OntologyObjectType.STORAGE_SYSTEM,
  OntologyObjectType.CONTROLLER,
  OntologyObjectType.SERVICE,
  OntologyObjectType.LUN,
  OntologyObjectType.POOL,
  OntologyObjectType.ENCLOSURE,
  OntologyObjectType.DISK,
  OntologyObjectType.REPLICATION_SESSION,
  OntologyObjectType.REMOTE_DEVICE,
])

const TYPE_X: Partial<Record<OntologyObjectType, number>> = {
  [OntologyObjectType.SCENARIO]: -220,
  [OntologyObjectType.PLAN]: -160,
  [OntologyObjectType.TASK]: -105,
  [OntologyObjectType.FUNCTION_CALL]: -45,
  [OntologyObjectType.OBSERVATION]: -10,
  [OntologyObjectType.FACT]: 20,
  [OntologyObjectType.EVIDENCE]: 80,
  [OntologyObjectType.CANDIDATE]: 135,
  [OntologyObjectType.DECISION]: 205,
  [OntologyObjectType.ACTION_PROPOSAL]: 255,
}

function stringProperty(object: OntologyObject, key: string, fallback = ''): string {
  const value = object.properties[key]
  return typeof value === 'string' ? value : fallback
}

function numberProperty(object: OntologyObject, key: string, fallback = 0): number {
  const value = object.properties[key]
  return typeof value === 'number' ? value : fallback
}

function hash(value: string): number {
  let result = 0
  for (const char of value) result = (result * 31 + char.charCodeAt(0)) | 0
  return Math.abs(result)
}

function positionFor(object: OntologyObject): Point {
  const configured = projection.node_positions[object.id]
  if (configured) return configured
  const x = TYPE_X[object.type] ?? 0
  const z = (hash(object.id) % 180) - 90
  return { x, y: projection.planes.knowledge.y, z }
}

function nodeWeight(object: OntologyObject): number {
  if (object.type === OntologyObjectType.DECISION) return 3.2
  if (object.type === OntologyObjectType.CANDIDATE) {
    return 1.8 + numberProperty(object, 'supportScore', 0) / 100
  }
  if (
    RESOURCE_OBJECT_TYPES.has(object.type) &&
    ['BUSINESS', 'STORAGE_DEVICE', 'CONTROLLER', 'BLOCK_SERVICE'].includes(
      stringProperty(object, 'assetType'),
    )
  ) {
    return 2.6
  }
  return 1.45
}

function toGraphNode(object: OntologyObject): GraphNode {
  const position = positionFor(object)
  const plane: Plane =
    RESOURCE_OBJECT_TYPES.has(object.type) ? 'topology' : 'knowledge'
  const group =
    plane === 'topology'
      ? stringProperty(object, 'spatialDomain', 'SCENARIO')
      : stringProperty(object, 'layer', object.type)
  return {
    id: object.id,
    object,
    label: object.label,
    plane,
    group,
    groupName: group,
    kind:
      stringProperty(object, 'assetType') ||
      stringProperty(object, 'knowledgeKind') ||
      object.type,
    healthStatus: stringProperty(object, 'healthStatus') || undefined,
    val: nodeWeight(object),
    color: TYPE_COLOR[object.type],
    alwaysLabel:
      object.type === OntologyObjectType.DECISION ||
      object.type === OntologyObjectType.CANDIDATE ||
      projection.label_rules.topology_always.includes(object.id) ||
      projection.label_rules.knowledge_always.includes(object.id),
    x: position.x,
    y: position.y,
    z: position.z,
    fx: position.x,
    fy: position.y,
    fz: position.z,
  }
}

function linkCategory(link: OntologyLink): LinkCategory {
  const plane = link.properties.plane
  if (plane === 'topology') return 'topology'
  if (plane === 'knowledge') return 'knowledge'
  if (plane === 'cross') return 'cross'
  if (
    link.type === OntologyLinkType.IMPACTS ||
    link.type === OntologyLinkType.RECOVERS_VIA
  ) {
    return 'impact'
  }
  if (
    link.type === OntologyLinkType.BASED_ON ||
    link.type === OntologyLinkType.SUPERSEDES ||
    link.type === OntologyLinkType.PROPOSES
  ) {
    return 'audit'
  }
  return 'diagnosis'
}

function toGraphLink(link: OntologyLink): GraphLink {
  return {
    id: link.id,
    source: link.sourceId,
    target: link.targetId,
    ontologyLink: link,
    category: linkCategory(link),
    relation: link.type,
    pathGroup:
      typeof link.properties.pathGroup === 'string'
        ? link.properties.pathGroup
        : null,
    weight:
      typeof link.properties.weight === 'number' ? link.properties.weight : undefined,
  }
}

function buildNodesAndLinks(objects: OntologyObject[], links: OntologyLink[]) {
  return {
    nodes: objects.map(toGraphNode),
    links: links.map(toGraphLink),
  }
}

let cached: ModelData | null = null

export function loadModelData(): ModelData {
  if (cached) return cached
  const registry = loadOntologyRegistry()
  const base = registry.baseSnapshot()
  const graph = buildNodesAndLinks(base.objects, base.links)
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))

  const domainOrder = [
    ['BUSINESS_COMPUTE', '业务与计算', 'external'],
    ['NETWORK_ACCESS', '网络与接入', 'external'],
    ['CONTROL_SERVICE', '控制与服务', 'internal'],
    ['LOGICAL_RESOURCE', '逻辑资源', 'internal'],
    ['PHYSICAL_RESOURCE', '物理资源', 'internal'],
  ] as const
  const domains = domainOrder.map(([code, name, location], order) => ({
    code,
    name,
    order,
    location,
    count: graph.nodes.filter((node) => node.group === code).length,
  }))

  const layers = ['OBJECT_TYPE', 'SYMPTOM', 'FAULT_MODE', 'MECHANISM', 'EVIDENCE_RULE', 'CASE']
  const kgLayers = layers.map((code, order) => ({
    code,
    name: code,
    order,
    count: graph.nodes.filter((node) => node.group === code).length,
  }))

  const deviceGroups = buildDeviceGroups(base.objects)
  cached = {
    registry,
    ...graph,
    nodesById,
    domains,
    kgLayers,
    presets: Object.entries(projection.camera_presets).map(([key, preset]) => ({
      key,
      label: preset.label,
      position: preset.position,
      lookAt: preset.look_at,
    })),
    initialPreset: projection.initial_preset,
    counts: {
      topology: graph.nodes.filter((node) => node.plane === 'topology').length,
      knowledge: graph.nodes.filter((node) => node.plane === 'knowledge').length,
      cross: graph.links.filter((link) => link.category === 'cross').length,
    },
    deviceGroups,
  }
  return cached
}

/** 设备级聚合组构建（D3/§05）：按 object.properties.deviceId 分组（复用现有设备 id，不新增 CMDB ID）。 */
function buildDeviceGroups(objects: OntologyObject[]): ModelData['deviceGroups'] {
  const byDevice = new Map<string, string[]>()
  for (const o of objects) {
    const dev = o.properties.deviceId as string | undefined
    if (dev && dev !== o.id) {
      const arr = byDevice.get(dev) ?? []
      arr.push(o.id)
      byDevice.set(dev, arr)
    }
  }
  const labelById = new Map(objects.map((o) => [o.id, o.label]))
  return [...byDevice.entries()].map(([deviceId, memberIds]) => ({
    deviceId,
    label: labelById.get(deviceId) ?? deviceId,
    memberIds,
  }))
}

function visibleByDomain(node: GraphNode, filter: GraphFilter): boolean {
  if (node.plane === 'topology') {
    return (
      filter.layerTopology &&
      filter.visibleDomains[node.group] !== false
    )
  }
  if (!filter.layerKnowledge) return false
  if (node.object.type !== OntologyObjectType.KNOWLEDGE) return true
  return filter.visibleKgLayers[node.group] !== false
}

export function buildActiveGraph(model: ModelData, filter: GraphFilter): ActiveGraph {
  const snapshot = model.registry.project(filter.lens, filter.overlay)
  const graph = buildNodesAndLinks(snapshot.objects, snapshot.links)
  const objectById = new Map(snapshot.objects.map((object) => [object.id, object]))
  const rootObjectIds = new Set(
    snapshot.objects
      .filter((object) => object.type === OntologyObjectType.DECISION)
      .map((object) => object.properties.rootObjectId)
      .filter((id): id is string => typeof id === 'string'),
  )
  const candidateTargetIds = new Set(
    snapshot.links
      .filter((link) => {
        if (link.type !== OntologyLinkType.TARGETS) return false
        const source = objectById.get(link.sourceId)
        return (
          source?.type === OntologyObjectType.CANDIDATE &&
          source.properties.status !== 'WEAKENED'
        )
      })
      .map((link) => link.targetId),
  )
  const impactedIds = new Set(
    snapshot.links
      .filter((link) => link.type === OntologyLinkType.IMPACTS)
      .flatMap((link) => [link.sourceId, link.targetId]),
  )
  const recoveredIds = new Set(
    snapshot.links
      .filter((link) => link.type === OntologyLinkType.RECOVERS_VIA)
      .flatMap((link) => [link.sourceId, link.targetId]),
  )

  const expandedDevices = filter.expandedDeviceIds ?? new Set<string>()
  const criticalIds = filter.criticalObjectIds ?? new Set<string>()
  const nodes = graph.nodes.map((node) => {
    if (rootObjectIds.has(node.id)) return { ...node, color: STATUS_COLORS.fault }
    if (filter.lens === LensId.IMPACT && recoveredIds.has(node.id)) {
      return { ...node, color: STATUS_COLORS.recovered }
    }
    if (impactedIds.has(node.id)) return { ...node, color: STATUS_COLORS.warning }
    if (candidateTargetIds.has(node.id)) return { ...node, color: STATUS_COLORS.warning }
    return node
  }).filter((node) => {
    if (!visibleByDomain(node, filter)) return false
    if (filter.objectIds?.size && !filter.objectIds.has(node.id)) return false
    // D3 设备级聚合：设备成员在设备收起时隐藏；关键对象（根因/焦点）保留（DETACHED_CRITICAL）。
    const devId = node.object.properties.deviceId as string | undefined
    if (devId && devId !== node.id && !expandedDevices.has(devId) && !criticalIds.has(node.id)) return false
    return true
  })
  const visibleIds = new Set(nodes.map((node) => node.id))
  const links = graph.links.filter((link) => {
    if (!visibleIds.has(link.source) || !visibleIds.has(link.target)) return false
    // Hidden cross-layer truth has already been removed by the Lens projector;
    // a hidden link that survived was explicitly activated by Session lineage.
    return true
  })
  return { nodes, links }
}

export function linkColorFor(
  link: GraphLink,
  ctx: { showCrossLayer: boolean; businessPath: boolean; lens?: LensId },
): string {
  if (
    ctx.businessPath &&
    link.pathGroup?.startsWith('block-path')
  ) {
    return LINK_COLORS.businessPath
  }
  switch (link.category) {
    case 'topology':
      return LINK_COLORS.topology
    case 'knowledge':
      return LINK_COLORS.knowledge
    case 'cross':
      return ctx.showCrossLayer ? LINK_COLORS.crossActive : LINK_COLORS.crossBaseline
    case 'impact':
      return link.relation === OntologyLinkType.RECOVERS_VIA
        ? STATUS_COLORS.recovered
        : STATUS_COLORS.fault
    case 'audit':
      return 'rgba(192,132,252,0.78)'
    case 'diagnosis':
      return 'rgba(45,212,191,0.62)'
  }
}

export { LENS_DEFINITIONS }
