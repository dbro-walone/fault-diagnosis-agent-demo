/**
 * Layered Topology 3D —— issue #4 方向修正：主画布回到 3D 力导向，拓扑内部按 S1→S3 空间分层。
 *
 * 纯函数模块：把 `buildLayeredActiveGraph`（分层聚合/展开语义）与静态知识图谱节点
 * 映射到 3D 坐标，并组装成单个 3d-force-graph 的 ActiveGraph。
 *
 * 布局约定（层次肉眼可辨）：
 *   - 拓扑节点按 topoLayer 在 **Y 轴分层**：S1 客户业务域最高、S2 访问连接域居中、
 *     S3 存储系统域最低；域内子层再按 **Z 轴分带**（S1.1→S1.3、S2.1→S2.3、S3.1→S3.5）。
 *     x 轴交给力导向自由布局（用户可拖拽）。域带 y / 子层 z 固定，层不互混。
 *   - 知识图谱节点在 y = -70 知识平面，按图谱分层（OBJECT_TYPE→…→CASE）在 **X 轴分列**；
 *     x/y 固定，z 交给力导向。
 *   - 跨层映射（拓扑 ↔ 图谱）与 F2 红逻辑链均映射到 3D 连线（虚拟 link，不写回本体）。
 */

import { OntologyLinkType } from '../../schemas/enums'
import {
  TOPO_SUB_LAYERS,
  buildLayeredActiveGraph,
  computeLayerSummary,
  isLayerAggregateId,
  layerAggregateId,
  layerCodeOfAggregateId,
  topoLayerDef,
  type LayeredModelData,
  type TopoDomainCode,
  type TopoLayerCode,
} from './layered-topology'
import {
  buildCrossLayerLinks,
  knowledgeAssociations,
  topologyAssociationsForKnowledge,
  type CrossLayerLink,
} from './knowledge-plane'
import type { CrossPlaneBinding } from '../v2/cross-plane-binding'
import type {
  ActiveGraph,
  AggregateSummary,
  AggregateSummaryContext,
  GraphLink,
  GraphNode,
} from './model-loader'

// ─────────────────────────────────────────────────────────────────────────────
// 3D 布局常量
// ─────────────────────────────────────────────────────────────────────────────

/** 拓扑平面基准 Y（双平面配置 topology=70）。S1/S2/S3 域带在基准上下各偏移一档。 */
export const TOPOLOGY_BASE_Y = 70
/** S1/S2/S3 三个域带之间的垂直间距。 */
export const DOMAIN_BAND_GAP = 64
/** 域内子层沿 Z 轴的带间距。 */
export const SUB_LAYER_Z_GAP = 40
/** 知识平面 Y（双平面配置 knowledge=-70）。 */
export const KNOWLEDGE_PLANE_Y = -70

/** 图谱分层 → X 轴列锚点（与 KNOWLEDGE_LAYERS 展示顺序一致，Domain Root + L1~L4）。 */
export const KNOWLEDGE_LAYER_X: Readonly<Record<string, number>> = {
  ROOT: -220,
  L1: -150,
  L2: -50,
  L3: 40,
  L4: 150,
}

/** S1/S2/S3 域带中心 Y。 */
export function domainBandY(domain: TopoDomainCode): number {
  if (domain === 'S1') return TOPOLOGY_BASE_Y + DOMAIN_BAND_GAP
  if (domain === 'S3') return TOPOLOGY_BASE_Y - DOMAIN_BAND_GAP
  return TOPOLOGY_BASE_Y
}

/** 子层在所属域带内的 Z 带偏移（域层自身居中 z=0）。 */
export function subLayerZ(code: TopoLayerCode): number {
  const def = topoLayerDef(code)
  const subs = TOPO_SUB_LAYERS.filter((l) => l.domain === def.domain)
  const idx = subs.findIndex((l) => l.code === code)
  const offset = idx - (subs.length - 1) / 2
  return Math.round(offset * SUB_LAYER_Z_GAP)
}

/** 稳定散列 → [min, max) 内的初始坐标（确定性，便于视觉复现）。 */
function hashSpread(id: string, min: number, max: number): number {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0
  return min + (Math.abs(h) % (max - min))
}

// ─────────────────────────────────────────────────────────────────────────────
// 节点 3D 坐标
// ─────────────────────────────────────────────────────────────────────────────

export interface Node3DPosition {
  x: number
  y: number
  z: number
  /** 固定轴：number；自由轴：null（力导向 / 用户拖拽）。 */
  fx: number | null
  fy: number | null
  fz: number | null
}

/** 拓扑节点：域带 Y 固定 + 子层 Z 固定，x 自由（力导向水平排布）。 */
export function topologyNodePosition(node: GraphNode): Node3DPosition {
  const layerCode = isLayerAggregateId(node.id)
    ? (layerCodeOfAggregateId(node.id) as TopoLayerCode)
    : (node.group as TopoLayerCode)
  const def = topoLayerDef(layerCode)
  const y = domainBandY(def.domain)
  const z = def.code === def.domain ? 0 : subLayerZ(def.code)
  return { x: hashSpread(node.id, -220, 220), y, z, fx: null, fy: y, fz: z }
}

/** 知识节点：图谱分层 X 列固定 + 平面 Y 固定，z 自由。 */
export function knowledgeNodePosition(node: GraphNode): Node3DPosition {
  const x = KNOWLEDGE_LAYER_X[node.group] ?? hashSpread(node.id, -160, 180)
  return { x, y: KNOWLEDGE_PLANE_Y, z: hashSpread(node.id, -80, 80), fx: x, fy: KNOWLEDGE_PLANE_Y, fz: null }
}

/** 把 3D 坐标写回节点（自由轴写 undefined，3d-force-graph 视为不固定）。 */
export function applyNodePosition(node: GraphNode, pos: Node3DPosition): void {
  node.x = pos.x
  node.y = pos.y
  node.z = pos.z
  // GraphNode 接口把 fx/fy/fz 声明为 number；运行时空值用 undefined 表达"自由"。
  ;(node as unknown as Record<string, number | undefined>).fx = pos.fx ?? undefined
  ;(node as unknown as Record<string, number | undefined>).fy = pos.fy ?? undefined
  ;(node as unknown as Record<string, number | undefined>).fz = pos.fz ?? undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// 虚拟连线（跨层 / 逻辑链）
// ─────────────────────────────────────────────────────────────────────────────

function virtualLink(
  id: string,
  sourceId: string,
  targetId: string,
  relation: string,
  category: GraphLink['category'],
  plane: string,
): GraphLink {
  return {
    id,
    source: sourceId,
    target: targetId,
    ontologyLink: {
      id,
      type: OntologyLinkType.CONNECTS_TO,
      sourceId,
      targetId,
      properties: { relation, plane },
      provenance: { source: 'MODEL', sourceRef: id },
    },
    category,
    relation,
  }
}

/** F2 红逻辑链：逻辑路径对象经 anchorByObjectId 落到可见锚点，相邻锚点成段。 */
export function buildLogicLinks(
  logicPath: string[],
  anchorByObjectId: Map<string, string>,
  visibleNodeIds: Set<string>,
): GraphLink[] {
  const links: GraphLink[] = []
  let prevAnchor: string | null = null
  for (const oid of logicPath) {
    const anchor = anchorByObjectId.get(oid) ?? oid
    if (anchor === prevAnchor) continue
    if (prevAnchor !== null && visibleNodeIds.has(anchor) && visibleNodeIds.has(prevAnchor)) {
      links.push(
        virtualLink(`logic:${prevAnchor}->${anchor}`, prevAnchor, anchor, 'LOGIC_PATH', 'logic', 'logic'),
      )
    }
    prevAnchor = anchor
  }
  return links
}

// ─────────────────────────────────────────────────────────────────────────────
// 3D 图组装
// ─────────────────────────────────────────────────────────────────────────────

export interface Layered3DGraphInput {
  model: LayeredModelData
  expandedLayers: Partial<Record<TopoLayerCode, boolean>>
  criticalObjectIds: Set<string>
  /** 静态 model 的知识平面节点（plane==='knowledge'）。 */
  knowledgeNodes: GraphNode[]
  /** 静态 model 的知识平面连线（category==='knowledge'）。 */
  knowledgeLinks: GraphLink[]
  visibleKgLayers?: Record<string, boolean>
  /** F2 活动逻辑路径（根因 → 证据 → 影响链对象 ids）。 */
  logicPath: string[]
  /** 当前 user_selection 节点 id（驱动跨层高亮）。 */
  selectedNodeId: string | null
  /** 聚合摘要运行时上下文（docs/05 §5）。 */
  aggregateContext: AggregateSummaryContext
  /**
   * 阶段3：当前 ACTIVE CrossPlaneBinding（docs/19 §6.2）。
   * 跨层映射连线只由 ACTIVE Binding 生成；未传时回退通用 INSTANCE_OF 解析。
   */
  activeBindings?: CrossPlaneBinding[]
}

export interface Layered3DGraph extends ActiveGraph {
  nodesById: Map<string, GraphNode>
  /** 聚合头节点 id → 聚合摘要（成员数/异常/候选/最高严重度，docs/05 §5）。 */
  summaries: Map<string, AggregateSummary>
  anchorByObjectId: Map<string, string>
  /** 跨层映射（拓扑实例 ↔ 图谱节点），端点经锚点规整后可能变化。 */
  crossLinks: CrossLayerLink[]
  highlightedTopology: Set<string>
  highlightedKnowledge: Set<string>
  selectedIsTopology: boolean
  selectedIsKnowledge: boolean
}

/**
 * 组装 3D 分层活动图：
 *   nodes = 可见拓扑节点（聚合头/展开成员/DETACHED 关键对象，按 S1→S3 定坐标）
 *           + 可见知识节点（按图谱分层定坐标）。
 *   links = 拓扑物理连线（锚点级）+ 知识连线 + 跨层映射线 + F2 红逻辑链。
 */
export function buildLayered3DGraph(input: Layered3DGraphInput): Layered3DGraph {
  const { model, expandedLayers, criticalObjectIds, logicPath, selectedNodeId } = input
  const graph = buildLayeredActiveGraph(model, { expandedLayers, criticalObjectIds })

  // 可见知识节点（按 ModelNavigator 图谱分层显隐过滤）。
  const kgNodes = input.knowledgeNodes.filter(
    (n) => (input.visibleKgLayers ?? {})[n.group] !== false,
  )
  const kgNodeIds = new Set(kgNodes.map((n) => n.id))
  const kgLinks = input.knowledgeLinks.filter(
    (l) => kgNodeIds.has(l.source as string) && kgNodeIds.has(l.target as string),
  )

  // 跨层映射 + 选中高亮（阶段3：只消费 ACTIVE CrossPlaneBinding；未传时兼容回退）。
  const crossLinks = buildCrossLayerLinks(model.nodes, kgNodes, input.activeBindings)
  const selectedIsTopology =
    selectedNodeId != null && model.nodesById.has(selectedNodeId)
  const selectedIsKnowledge = selectedNodeId != null && kgNodeIds.has(selectedNodeId)
  const highlightedKnowledge = selectedIsTopology
    ? knowledgeAssociations(selectedNodeId!, crossLinks, kgLinks, 3)
    : new Set<string>()
  const highlightedTopology = selectedIsKnowledge
    ? topologyAssociationsForKnowledge(selectedNodeId!, crossLinks, kgLinks, 3)
    : new Set<string>()

  // 节点坐标：拓扑节点按 S1→S3 域/子层定 Y/Z；知识节点按图谱分层定 X。
  for (const node of graph.nodes) applyNodePosition(node, topologyNodePosition(node))
  for (const node of kgNodes) applyNodePosition(node, knowledgeNodePosition(node))
  const nodes = [...graph.nodes, ...kgNodes]
  const nodesById = new Map(nodes.map((node) => [node.id, node]))

  // 聚合摘要：聚合头节点 id → summary（带运行时上下文：候选/受影响/关键对象）。
  const summaries = new Map<string, AggregateSummary>()
  for (const [code] of graph.summaries) {
    summaries.set(
      layerAggregateId(code),
      computeLayerSummary(model, code, input.aggregateContext),
    )
  }

  // 跨层连线端点规整：拓扑端点经 anchorByObjectId 落到可见锚点。
  const anchorOf = (topologyId: string): string =>
    graph.anchorByObjectId.get(topologyId) ?? topologyId
  const crossLinks3d = crossLinks
    .filter(
      (l) => nodesById.has(anchorOf(l.topologyId)) && nodesById.has(l.knowledgeId),
    )
    .map((l) => {
      const source = anchorOf(l.topologyId)
      return {
        ...l,
        topologyId: source,
        id: l.relation === 'INSTANCE_OF' ? l.id : `${l.id}:${source}`,
      }
    })
  const crossGraphLinks = crossLinks3d.map((l) =>
    virtualLink(l.id, l.topologyId, l.knowledgeId, l.relation, 'cross', 'cross'),
  )

  // 物理 + 知识 + 跨层 + 逻辑 连线。
  const links: GraphLink[] = [
    ...graph.links,
    ...kgLinks,
    ...crossGraphLinks,
    ...buildLogicLinks(logicPath, graph.anchorByObjectId, new Set(nodes.map((n) => n.id))),
  ]

  return {
    nodes,
    links,
    nodesById,
    summaries,
    anchorByObjectId: graph.anchorByObjectId,
    crossLinks: crossLinks3d,
    highlightedTopology,
    highlightedKnowledge,
    selectedIsTopology,
    selectedIsKnowledge,
  }
}
