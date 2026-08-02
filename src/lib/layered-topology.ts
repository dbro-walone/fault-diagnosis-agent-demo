/**
 * Layered Topology —— GitHub issue #4 分层拓扑展示（S1→S3 多层条带）。
 *
 * 新增独立分层展示模块：把分层演示 Case 数据包（layered_topology_demo_001）的
 * resources/topology 组织为按 topoLayer 分条的 GraphNode/GraphLink 图，
 * 复用 model-loader 的 GraphNode/GraphLink/ActiveGraph/AggregateSummary 契约与
 * computeGroupSummary 聚合口径。组织维度从“设备分组”扩到“层级分组”（S1→S3.5）。
 *
 * 不替换现有双平面主视图；flat 布局回归不受影响（分层数据由独立 Case 承载，
 * 静态 model/topology 未改动）。
 */

import { OntologyLinkType, OntologyObjectType } from '../../schemas/enums'
import type { JsonValue, OntologyLink, OntologyObject } from '../../schemas/types'
import { loadAdaptedCase } from '../v2'
import {
  computeGroupSummary,
  type ActiveGraph,
  type AggregateSummary,
  type AggregateSummaryContext,
  type GraphLink,
  type GraphNode,
} from './model-loader'

export type { AggregateSummaryContext } from './model-loader'

// ─────────────────────────────────────────────────────────────────────────────
// 层级定义（issue #4 已冻结）
// ─────────────────────────────────────────────────────────────────────────────

/** 顶级条带域。 */
export type TopoDomainCode = 'S1' | 'S2' | 'S3'

/** 分层拓扑层级码：S1/S2/S3 域 + S1_1..S3_5 子层。 */
export type TopoLayerCode =
  | 'S1'
  | 'S2'
  | 'S3'
  | 'S1_1'
  | 'S1_2'
  | 'S1_3'
  | 'S2_1'
  | 'S2_2'
  | 'S2_3'
  | 'S3_1'
  | 'S3_2'
  | 'S3_3'
  | 'S3_4'
  | 'S3_5'

/** 顶级条带（S1 客户业务域 / S2 访问连接域 / S3 存储系统域）。 */
export const TOPO_DOMAINS: ReadonlyArray<{ code: TopoDomainCode; name: string }> = [
  { code: 'S1', name: 'S1 客户业务域' },
  { code: 'S2', name: 'S2 访问连接域' },
  { code: 'S3', name: 'S3 存储系统域' },
]

/** 分层定义：域 + 子层，按展示顺序排列。resourceTypes 为空表示域（聚合其子层）。 */
export interface TopoLayerDef {
  code: TopoLayerCode
  name: string
  /** 所属顶级带。 */
  domain: TopoDomainCode
  /** 父层（域层的 parent == code）。 */
  parent: TopoLayerCode
  /** 属于该层的 resource_type（域层为空）。 */
  resourceTypes: string[]
  /** 条带主题色。 */
  color: string
}

export const TOPO_LAYERS: ReadonlyArray<TopoLayerDef> = [
  { code: 'S1', name: 'S1 客户业务域', domain: 'S1', parent: 'S1', resourceTypes: [], color: '#34d399' },
  { code: 'S1_1', name: 'S1.1 业务应用', domain: 'S1', parent: 'S1', resourceTypes: ['BUSINESS_APP', 'BUSINESS'], color: '#4ade80' },
  { code: 'S1_2', name: 'S1.2 业务服务', domain: 'S1', parent: 'S1', resourceTypes: ['BUSINESS_SERVICE'], color: '#86efac' },
  { code: 'S1_3', name: 'S1.3 存储客户端', domain: 'S1', parent: 'S1', resourceTypes: ['STORAGE_CLIENT', 'CLIENT_OS', 'MOUNT_POINT', 'HOST'], color: '#a7f3d0' },
  { code: 'S2', name: 'S2 访问连接域', domain: 'S2', parent: 'S2', resourceTypes: [], color: '#60a5fa' },
  { code: 'S2_1', name: 'S2.1 主机接口', domain: 'S2', parent: 'S2', resourceTypes: ['HOST_INTERFACE'], color: '#93c5fd' },
  { code: 'S2_2', name: 'S2.2 网络Fabric', domain: 'S2', parent: 'S2', resourceTypes: ['NETWORK_FABRIC', 'SAN_FABRIC', 'NETWORK_DEVICE'], color: '#bfdbfe' },
  { code: 'S2_3', name: 'S2.3 访问链路', domain: 'S2', parent: 'S2', resourceTypes: ['ACCESS_LINK', 'NETWORK_PATH'], color: '#dbeafe' },
  { code: 'S3', name: 'S3 存储系统域', domain: 'S3', parent: 'S3', resourceTypes: [], color: '#c084fc' },
  { code: 'S3_1', name: 'S3.1 接入层', domain: 'S3', parent: 'S3', resourceTypes: ['FC_PORT', 'ETH_PORT', 'LIF', 'REPLICATION_PORT'], color: '#d8b4fe' },
  { code: 'S3_2', name: 'S3.2 控制层', domain: 'S3', parent: 'S3', resourceTypes: ['CONTROLLER', 'CPU', 'MEMORY', 'CACHE'], color: '#e9d5ff' },
  { code: 'S3_3', name: 'S3.3 数据服务层', domain: 'S3', parent: 'S3', resourceTypes: ['BLOCK_SERVICE', 'NAS_SERVICE', 'OBJECT_SERVICE', 'SNAPSHOT_SERVICE', 'QOS_SERVICE', 'REPLICATION_SERVICE', 'REPLICATION_SESSION'], color: '#f5d0fe' },
  { code: 'S3_4', name: 'S3.4 存储资源层', domain: 'S3', parent: 'S3', resourceTypes: ['POOL', 'STORAGE_POOL', 'RAID', 'LUN', 'FILESYSTEM', 'DISK_DOMAIN'], color: '#fbcfe8' },
  { code: 'S3_5', name: 'S3.5 硬件层', domain: 'S3', parent: 'S3', resourceTypes: ['ENCLOSURE', 'DISK_ENCLOSURE', 'STORAGE_DEVICE', 'DISK', 'POWER', 'FAN', 'BBU'], color: '#fecdd3' },
]

/** 子层（含具体资源类型的层；域层资源类型为空）。 */
export const TOPO_SUB_LAYERS: ReadonlyArray<TopoLayerDef> = TOPO_LAYERS.filter(
  (l) => l.parent !== l.code,
)

/** 取层级定义；未知码回退到 S1 域。 */
export function topoLayerDef(code: TopoLayerCode): TopoLayerDef {
  return TOPO_LAYERS.find((l) => l.code === code) ?? TOPO_LAYERS[0]
}

/** 子层 → 其顶级域；域 → 自身。 */
export function domainOf(code: TopoLayerCode): TopoDomainCode {
  return topoLayerDef(code).domain
}

/** resource_type → 所属子层（未知类型回退 S1 域，保证有合法归属）。 */
export function resourceToLayer(resourceType: string): TopoLayerCode {
  const t = (resourceType ?? '').trim().toUpperCase()
  const hit = TOPO_SUB_LAYERS.find((l) => l.resourceTypes.includes(t))
  return hit ? hit.code : 'S1'
}

// ─────────────────────────────────────────────────────────────────────────────
// Case 数据 → GraphNode/GraphLink
// ─────────────────────────────────────────────────────────────────────────────

/** 分层 Case 的 V1 资源/边结构（与 case-adapter 的 V1Resource/V1Edge 结构兼容）。 */
export interface LayeredResource {
  resource_id: string
  resource_type: string
  name: string
  parent_id?: string | null
  device_id?: string | null
  zone?: string
  location?: string
  attributes?: Record<string, unknown>
}
export interface LayeredEdge {
  edge_id: string
  source_id: string
  target_id: string
  relation_type: string
  direction?: string
  path_group?: string | null
  redundancy_group?: string | null
  state?: string | null
  valid_from?: string | null
  valid_to?: string | null
}

/** resource_type → 细粒度 OntologyObjectType（新类型回落 ASSET，颜色由层级决定）。
 * 现有 3 个基线 Case + 分层演示 Case 的 V1 resource_type 全部纳入；
 * 与 src/ontology/model-adapter.ts 的 RESOURCE_TYPE_MAP 对齐。 */
const RESOURCE_TYPE_MAP: Record<string, OntologyObjectType> = {
  BUSINESS_APP: OntologyObjectType.BUSINESS_SERVICE,
  BUSINESS: OntologyObjectType.BUSINESS_SERVICE,
  BUSINESS_SERVICE: OntologyObjectType.BUSINESS_SERVICE,
  STORAGE_CLIENT: OntologyObjectType.HOST,
  CLIENT_OS: OntologyObjectType.HOST,
  MOUNT_POINT: OntologyObjectType.ASSET,
  HOST: OntologyObjectType.HOST,
  HOST_INTERFACE: OntologyObjectType.HOST,
  NETWORK_FABRIC: OntologyObjectType.FABRIC,
  SAN_FABRIC: OntologyObjectType.FABRIC,
  NETWORK_DEVICE: OntologyObjectType.FABRIC,
  ACCESS_LINK: OntologyObjectType.ASSET,
  NETWORK_PATH: OntologyObjectType.ASSET,
  FC_PORT: OntologyObjectType.PORT,
  ETH_PORT: OntologyObjectType.PORT,
  LIF: OntologyObjectType.PORT,
  REPLICATION_PORT: OntologyObjectType.PORT,
  CONTROLLER: OntologyObjectType.CONTROLLER,
  CPU: OntologyObjectType.ASSET,
  MEMORY: OntologyObjectType.ASSET,
  CACHE: OntologyObjectType.ASSET,
  BLOCK_SERVICE: OntologyObjectType.SERVICE,
  NAS_SERVICE: OntologyObjectType.SERVICE,
  OBJECT_SERVICE: OntologyObjectType.SERVICE,
  SNAPSHOT_SERVICE: OntologyObjectType.SERVICE,
  QOS_SERVICE: OntologyObjectType.SERVICE,
  REPLICATION_SERVICE: OntologyObjectType.SERVICE,
  REPLICATION_SESSION: OntologyObjectType.REPLICATION_SESSION,
  POOL: OntologyObjectType.POOL,
  STORAGE_POOL: OntologyObjectType.POOL,
  RAID: OntologyObjectType.ASSET,
  LUN: OntologyObjectType.LUN,
  FILESYSTEM: OntologyObjectType.ASSET,
  DISK_DOMAIN: OntologyObjectType.ASSET,
  ENCLOSURE: OntologyObjectType.ENCLOSURE,
  DISK_ENCLOSURE: OntologyObjectType.ENCLOSURE,
  STORAGE_DEVICE: OntologyObjectType.STORAGE_SYSTEM,
  DISK: OntologyObjectType.DISK,
  POWER: OntologyObjectType.ASSET,
  FAN: OntologyObjectType.ASSET,
  BBU: OntologyObjectType.ASSET,
}

/** relation_type → OntologyLinkType（与 model-adapter 的 TOPOLOGY_LINK_MAP 对齐）。
 * 覆盖 3 个基线 Case + 分层演示 Case 出现的全部 relation_type。 */
const TOPOLOGY_LINK_MAP: Record<string, OntologyLinkType> = {
  ACCESSES: OntologyLinkType.ACCESSES,
  PHYSICAL_CONNECTS: OntologyLinkType.CONNECTS_TO,
  CONNECTS_TO: OntologyLinkType.CONNECTS_TO,
  DEPENDS_ON: OntologyLinkType.DEPENDS_ON,
  HOSTS: OntologyLinkType.HOSTS,
  RUNS_ON: OntologyLinkType.DEPENDS_ON,
  PROVIDES_SERVICE: OntologyLinkType.PROVIDES_SERVICE,
  SERVED_BY: OntologyLinkType.PROVIDES_SERVICE,
  BACKED_BY: OntologyLinkType.BACKED_BY,
  BELONGS_TO: OntologyLinkType.BELONGS_TO,
  CONTAINS: OntologyLinkType.CONTAINS,
  OWNS: OntologyLinkType.CONTAINS,
  PRIMARY_BACKUP_OF: OntologyLinkType.PRIMARY_BACKUP_OF,
  FAILOVER_TO: OntologyLinkType.ACTIVE_STANDBY_WITH,
  SHARES_RESOURCE_WITH: OntologyLinkType.SHARES,
  REPLICATES_TO: OntologyLinkType.REPLICATES_TO,
  ROUTES_THROUGH: OntologyLinkType.CONNECTS_TO,
  SOURCE_OF: OntologyLinkType.CONNECTS_TO,
  SENDS_VIA: OntologyLinkType.CONNECTS_TO,
  RECEIVES_FOR: OntologyLinkType.CONNECTS_TO,
  TARGETS: OntologyLinkType.TARGETS,
}

function stringAttr(attributes: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = attributes?.[key]
  return typeof v === 'string' ? v : undefined
}

/** 任意未知结构 → JsonValue（与 model-adapter 的 json() 相同语义）。 */
function json(value: unknown): JsonValue {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function toGraphNode(resource: LayeredResource): GraphNode {
  const layerCode = resourceToLayer(resource.resource_type)
  const layer = topoLayerDef(layerCode)
  const attributes = resource.attributes ?? {}
  const health = stringAttr(attributes, 'health') ?? 'NORMAL'
  const object: OntologyObject = {
    id: resource.resource_id,
    type: RESOURCE_TYPE_MAP[resource.resource_type] ?? OntologyObjectType.ASSET,
    label: resource.name,
    properties: {
      assetType: resource.resource_type,
      healthStatus: health,
      topoLayer: layerCode,
      spatialDomain: resource.zone ?? '',
      deviceId: resource.device_id ?? null,
      attributes: json(attributes),
      plane: 'topology',
    },
    provenance: { source: 'MODEL', sourceRef: `cases/${resource.resource_id}` },
  }
  return {
    id: resource.resource_id,
    object,
    label: resource.name,
    plane: 'topology',
    group: layerCode,
    groupName: layer.name,
    kind: resource.resource_type,
    healthStatus: health,
    val: 1.45,
    color: layer.color,
    alwaysLabel: false,
    x: 0,
    y: 0,
    z: 0,
    fx: 0,
    fy: 0,
    fz: 0,
  }
}

function toGraphLink(edge: LayeredEdge): GraphLink {
  const type = TOPOLOGY_LINK_MAP[edge.relation_type] ?? OntologyLinkType.CONNECTS_TO
  const ontologyLink: OntologyLink = {
    id: edge.edge_id,
    type,
    sourceId: edge.source_id,
    targetId: edge.target_id,
    properties: {
      sourceRelation: edge.relation_type,
      direction: edge.direction ?? 'directed',
      pathGroup: edge.path_group ?? null,
      redundancyGroup: edge.redundancy_group ?? null,
      plane: 'topology',
    },
    provenance: { source: 'MODEL', sourceRef: `cases/${edge.edge_id}` },
  }
  return {
    id: edge.edge_id,
    source: edge.source_id,
    target: edge.target_id,
    ontologyLink,
    category: 'topology',
    relation: edge.relation_type,
    pathGroup: edge.path_group ?? null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LayeredModelData —— 分层图模型
// ─────────────────────────────────────────────────────────────────────────────

export interface LayeredModelData {
  caseId: string
  nodes: GraphNode[]
  links: GraphLink[]
  nodesById: Map<string, GraphNode>
  /** 全部层级定义（域 + 子层），按展示顺序。 */
  layers: TopoLayerDef[]
  /** layer code → 直接成员 id（子层含其资源；域层含其全部子层成员）。 */
  memberIdsByLayer: Map<TopoLayerCode, string[]>
  /** 跨层物理连线（两端分属不同 topoLayer 子层）。 */
  crossLayerLinks: GraphLink[]
}

function buildMemberIds(nodes: GraphNode[]): Map<TopoLayerCode, string[]> {
  const map = new Map<TopoLayerCode, string[]>()
  for (const layer of TOPO_SUB_LAYERS) {
    map.set(
      layer.code,
      nodes.filter((n) => n.group === layer.code).map((n) => n.id),
    )
  }
  for (const domain of TOPO_DOMAINS) {
    const ids = new Set<string>()
    for (const layer of TOPO_SUB_LAYERS) {
      if (layer.domain === domain.code) for (const id of map.get(layer.code) ?? []) ids.add(id)
    }
    map.set(domain.code, [...ids])
  }
  return map
}

/** 按 caseId 分键的构建缓存（支持任意 Case 分层切换，不复用错 Case）。 */
const cacheByCaseId = new Map<string, LayeredModelData>()

/**
 * 从任意 Case 数据包构建分层拓扑模型（按 caseId 缓存）。
 * 只读 case 数据；组织维度为 topoLayer，不新增 CMDB ID、不写回源。
 * 现有 3 个基线 Case + 分层演示 Case 的实例资源都能映射到 S1~S3.5。
 */
export function buildLayeredModelData(caseId = 'layered_topology_demo_001'): LayeredModelData {
  const cached = cacheByCaseId.get(caseId)
  if (cached) return cached
  const adapted = loadAdaptedCase(caseId)
  const nodes = adapted.resources.map(toGraphNode)
  const links = adapted.edges.map(toGraphLink)
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const memberIdsByLayer = buildMemberIds(nodes)
  const layerOf = (id: string): TopoLayerCode => nodesById.get(id)?.group as TopoLayerCode
  const crossLayerLinks = links.filter((link) => {
    const a = layerOf(link.source as string)
    const b = layerOf(link.target as string)
    return a && b && a !== b
  })
  const data: LayeredModelData = {
    caseId,
    nodes,
    links,
    nodesById,
    layers: [...TOPO_LAYERS],
    memberIdsByLayer,
    crossLayerLinks,
  }
  cacheByCaseId.set(caseId, data)
  return data
}

// ─────────────────────────────────────────────────────────────────────────────
// 聚合摘要（复用 computeGroupSummary 口径，docs/05 §5）
// ─────────────────────────────────────────────────────────────────────────────

/** 计算指定层（域或子层）的聚合摘要。 */
export function computeLayerSummary(
  model: LayeredModelData,
  layerCode: TopoLayerCode,
  ctx: AggregateSummaryContext = {},
): AggregateSummary {
  const layer = topoLayerDef(layerCode)
  const memberIds = model.memberIdsByLayer.get(layerCode) ?? []
  return computeGroupSummary(memberIds, layerCode, layer.name, model.nodesById, ctx)
}

/** 聚合节点 id（synthetic，仅投影层使用，不写入本体）。 */
export function layerAggregateId(layerCode: TopoLayerCode): string {
  return `layer:${layerCode}`
}

/** 是否为合成聚合节点 id。 */
export function isLayerAggregateId(id: string): boolean {
  return id.startsWith('layer:')
}

/** 由聚合节点 id 反解层级码；非聚合 id 返回 null。 */
export function layerCodeOfAggregateId(id: string): TopoLayerCode | null {
  if (!isLayerAggregateId(id)) return null
  return id.slice('layer:'.length) as TopoLayerCode
}

// ─────────────────────────────────────────────────────────────────────────────
// 展开/收起图构建（复用 buildActiveGraph 的 DETACHED 语义）
// ─────────────────────────────────────────────────────────────────────────────

export interface LayeredGraphOptions {
  /** 已展开的层（域或子层）→ true。默认全部收起（仅显示域带聚合头）。 */
  expandedLayers: Partial<Record<TopoLayerCode, boolean>>
  /** 关键对象（agent_focus/根因）——其所在层收起时仍显示（DETACHED_CRITICAL）。 */
  criticalObjectIds?: Set<string>
}

export interface LayeredActiveGraph extends ActiveGraph {
  /** 成员对象 id → 可见锚点 id（成员自身或其层聚合头），供画布连物理线。 */
  anchorByObjectId: Map<string, string>
  /** 各可见层的聚合摘要（layer code → summary）。 */
  summaries: Map<TopoLayerCode, AggregateSummary>
}

/** 计算一个关键对象应锚定的可见层（最近展开的祖先：自身子层 → 域）。 */
function anchoredLayerFor(
  objectId: string,
  model: LayeredModelData,
  expandedLayers: Record<TopoLayerCode, boolean>,
): TopoLayerCode | null {
  const node = model.nodesById.get(objectId)
  if (!node) return null
  const sub = node.group as TopoLayerCode
  if (expandedLayers[sub]) return sub
  const domain = domainOf(sub)
  if (expandedLayers[domain]) return domain
  return null
}

/** 构建分层活动图：域聚合头始终显示；展开的层显示子层头/成员；关键对象 DETACHED。 */
export function buildLayeredActiveGraph(
  model: LayeredModelData,
  options: LayeredGraphOptions,
): LayeredActiveGraph {
  const expandedLayers = options.expandedLayers ?? {}
  const criticalIds = options.criticalObjectIds ?? new Set<string>()
  const nodes: GraphNode[] = []
  const anchorByObjectId = new Map<string, string>()
  const visibleMembers = new Set<string>()
  const visibleLayers = new Set<TopoLayerCode>()

  for (const domain of TOPO_DOMAINS) {
    const domainExpanded = expandedLayers[domain.code] === true
    visibleLayers.add(domain.code)
    if (!domainExpanded) {
      // 域收起：仅域聚合头；域内关键对象 DETACHED 保留。
      for (const id of model.memberIdsByLayer.get(domain.code) ?? []) {
        if (criticalIds.has(id)) {
          visibleMembers.add(id)
          anchorByObjectId.set(id, id)
        } else {
          anchorByObjectId.set(id, layerAggregateId(domain.code))
        }
      }
      continue
    }
    // 域展开：显示子层（收起子层显示其聚合头；展开子层显示成员）。
    for (const sub of TOPO_SUB_LAYERS) {
      if (sub.domain !== domain.code) continue
      const subExpanded = expandedLayers[sub.code] === true
      visibleLayers.add(sub.code)
      for (const id of model.memberIdsByLayer.get(sub.code) ?? []) {
        if (subExpanded) {
          visibleMembers.add(id)
          anchorByObjectId.set(id, id)
        } else if (criticalIds.has(id)) {
          visibleMembers.add(id)
          anchorByObjectId.set(id, id)
        } else {
          anchorByObjectId.set(id, layerAggregateId(sub.code))
        }
      }
    }
  }

  // 成员节点。
  for (const node of model.nodes) {
    if (visibleMembers.has(node.id)) nodes.push(node)
  }
  // 聚合头节点（显示的子层 + 全部域）。
  for (const layerCode of visibleLayers) {
    const layer = topoLayerDef(layerCode)
    nodes.push(aggregateNodeFor(model, layer))
  }

  // 链接：两端可见成员 → 成员间线；否则连到其层聚合头锚点。
  const anchorVisible = (anchor: string): boolean => {
    if (visibleMembers.has(anchor)) return true
    const layerCode = layerCodeOfAggregateId(anchor)
    return layerCode ? visibleLayers.has(layerCode) : false
  }
  const links: GraphLink[] = []
  for (const link of model.links) {
    const sourceAnchor = anchorByObjectId.get(link.source as string)
    const targetAnchor = anchorByObjectId.get(link.target as string)
    if (!sourceAnchor || !targetAnchor) continue
    if (!anchorVisible(sourceAnchor) || !anchorVisible(targetAnchor)) continue
    links.push({ ...link, source: sourceAnchor, target: targetAnchor })
  }

  // 各可见层聚合摘要。
  const summaries = new Map<TopoLayerCode, AggregateSummary>()
  for (const layerCode of visibleLayers) {
    summaries.set(layerCode, computeLayerSummary(model, layerCode))
  }

  return { nodes, links, anchorByObjectId, summaries }
}

/** 合成聚合头节点（docs/05 §5：成员数/异常数/候选数/最高严重度由 summaries 驱动徽标）。 */
function aggregateNodeFor(model: LayeredModelData, layer: TopoLayerDef): GraphNode {
  const id = layerAggregateId(layer.code)
  const summary = computeLayerSummary(model, layer.code)
  const health =
    summary.maxSeverity === 'CRITICAL' ? 'FAULT' : summary.maxSeverity === 'WARNING' ? 'WARNING' : 'NORMAL'
  const object: OntologyObject = {
    id,
    type: OntologyObjectType.ASSET,
    label: layer.name,
    properties: {
      healthStatus: health,
      topoLayer: layer.code,
      plane: 'topology',
    },
    provenance: { source: 'MODEL', sourceRef: `layer:${layer.code}` },
  }
  return {
    id,
    object,
    label: layer.name,
    plane: 'topology',
    group: layer.domain,
    groupName: layer.name,
    kind: 'LAYER_AGGREGATE',
    healthStatus: health,
    val: 2.6,
    color: layer.color,
    alwaysLabel: true,
    x: 0,
    y: 0,
    z: 0,
    fx: 0,
    fy: 0,
    fz: 0,
  }
}
