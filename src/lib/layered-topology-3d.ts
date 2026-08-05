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
  type LayeredActiveGraph,
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

// ─────────────────────────────────────────────────────────────────────────────
// issue#8 自动布局：展开层真实成员在所属子层带内均匀排布（拉均匀、不重叠）
// ─────────────────────────────────────────────────────────────────────────────

/** 子层带内相邻成员的水平间距（世界单位；成员节点半径约 7，46 足够不重叠）。 */
export const MEMBER_X_SPACING = 46
/** 子层带内成员水平排布的最大跨度（保持与旧 hash 分布 [-220,220] 同量级）。 */
export const MEMBER_X_SPAN_MAX = 340
/** DETACHED 关键对象右移避让聚合头的最小水平偏移（聚合头居中 x=0）。 */
export const DETACHED_X_OFFSET = 40

/** 子层成员在带内的均匀 X 坐标（index → 居中对称分布；count<=1 归中）。 */
export function memberBandX(index: number, count: number): number {
  if (count <= 1) return 0
  const span = Math.min(MEMBER_X_SPAN_MAX, (count - 1) * MEMBER_X_SPACING)
  return Math.round(-span / 2 + index * (span / (count - 1)))
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

/**
 * 拓扑节点：域带 Y 固定 + 子层 Z 固定，x 自由（力导向水平排布）。
 * 聚合头居中（x=0，issue#8 自动布局基准）；真实成员的实际 X 由
 * buildLayered3DGraph 按 memberBandX 均匀排布覆盖（此处散列仅作兜底）。
 */
export function topologyNodePosition(node: GraphNode): Node3DPosition {
  const layerCode = isLayerAggregateId(node.id)
    ? (layerCodeOfAggregateId(node.id) as TopoLayerCode)
    : (node.group as TopoLayerCode)
  const def = topoLayerDef(layerCode)
  const y = domainBandY(def.domain)
  const z = def.code === def.domain ? 0 : subLayerZ(def.code)
  const x = isLayerAggregateId(node.id) ? 0 : hashSpread(node.id, -220, 220)
  return { x, y, z, fx: null, fy: y, fz: z }
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
// issue#9 诊断聚焦链路 —— 画布需要的诊断扫描子集（结构类型，避免依赖 v2 模块）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 诊断态聚焦链路视图所需的诊断扫描数据子集（来自 ProjectionStore.diagnosisScan()）。
 * 以结构类型承载，layered-topology-3d 不反向依赖 src/v2，避免循环导入。
 *
 * 诊断态（该值非 null）下画布只展示"诊断走过的链路 + 命中的图谱子图"：
 * - 拓扑：入口业务对象 ∪ examined_objects ∪ path_object_ids ∪ 当前推进节点，
 *   相邻锚点沿物理拓扑 BFS 桥接，非链路节点完全隐藏；
 * - 图谱：只显示命中的知识节点（graph_entry_anchors ∪ graph_lit_knowledge_ids）及其关系边。
 */
export interface DiagnosisFocusScanRef {
  entry_object_refs: string[]
  examined_objects: Array<{ object_id: string }>
  path_object_ids: string[]
  active_query_object_id: string | null
  focus_object_id: string | null
  graph_entry_anchors: string[]
  graph_lit_knowledge_ids: string[]
}

/** 沿物理拓扑邻接表 BFS 桥接 from→to，返回中间节点（含 to、不含 from）。不连通返回空。 */
function bridgeMembers(adj: Map<string, string[]>, from: string, to: string): string[] {
  if (from === to) return []
  const parent = new Map<string, string>()
  const queue = [from]
  const seen = new Set([from])
  let found = false
  while (queue.length && !found) {
    const cur = queue.shift()!
    for (const next of adj.get(cur) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      parent.set(next, cur)
      if (next === to) {
        found = true
        break
      }
      queue.push(next)
    }
  }
  if (!found) return []
  const members: string[] = []
  let cur = to
  while (cur !== from) {
    const p = parent.get(cur)
    if (!p) break
    members.push(cur)
    cur = p
  }
  return members
}

/**
 * 诊断聚焦拓扑子图（issue#9 Q1-A）：
 * 焦点对象 = 入口业务对象 ∪ path_object_ids ∪ examined_objects ∪ active/focus，映射到可见锚点，
 * 相邻锚点沿物理拓扑（category==='topology'）BFS 桥接，得到"诊断链路"节点集。
 * 其余拓扑节点（非链路、非必要桥接）由调用方隐藏。
 */
function computeFocusTopologyVisible(
  graph: LayeredActiveGraph,
  scan: DiagnosisFocusScanRef,
): Set<string> {
  // 焦点对象序：入口业务对象 → PLANNER 路径（seq 序）→ 已排查对象 → 当前推进。
  const focusIds: string[] = []
  const push = (id: string | null | undefined): void => {
    if (id && !focusIds.includes(id)) focusIds.push(id)
  }
  for (const id of scan.entry_object_refs) push(id)
  for (const id of scan.path_object_ids) push(id)
  for (const o of scan.examined_objects) push(o.object_id)
  push(scan.active_query_object_id)
  push(scan.focus_object_id)

  const anchorOf = (id: string): string => graph.anchorByObjectId.get(id) ?? id
  const anchors = focusIds.map(anchorOf)
  const visible = new Set<string>(anchors)

  // 物理拓扑邻接表（锚点级，仅 topology 连线；聚合头代表其收起层成员）。
  const adj = new Map<string, string[]>()
  for (const l of graph.links) {
    if (l.category !== 'topology') continue
    const a = l.source as string
    const b = l.target as string
    if (!adj.has(a)) adj.set(a, [])
    adj.get(a)!.push(b)
    if (!adj.has(b)) adj.set(b, [])
    adj.get(b)!.push(a)
  }

  // 相邻锚点间 BFS 桥接（物理路径中间节点进入链路，形成连续链路）。
  for (let i = 0; i < anchors.length - 1; i++) {
    for (const m of bridgeMembers(adj, anchors[i], anchors[i + 1])) visible.add(m)
  }
  return visible
}

/** 诊断聚焦图谱子图（issue#9 Q2-A）：只显示命中的知识节点（原始点 ∪ 关联点亮）。 */
function computeFocusKnowledgeVisible(scan: DiagnosisFocusScanRef): Set<string> {
  return new Set([...scan.graph_entry_anchors, ...scan.graph_lit_knowledge_ids])
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
  /**
   * issue#9：诊断态聚焦链路视图。非 null 时只展示诊断链路（拓扑）+ 命中图谱子图，
   * 其余节点完全隐藏；诊断结束/非诊断传 null 恢复全拓扑 + 全图谱（浏览态冷冻）。
   */
  diagnosisScan?: DiagnosisFocusScanRef | null
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
  /** issue#9：是否处于诊断聚焦链路态（diagnosisScan != null）。 */
  focusMode: boolean
}

/**
 * 组装 3D 分层活动图：
 *   nodes = 可见拓扑节点（聚合头/展开成员/DETACHED 关键对象，按 S1→S3 定坐标）
 *           + 可见知识节点（按图谱分层定坐标）。
 *   links = 拓扑物理连线（锚点级）+ 知识连线 + 跨层映射线 + F2 红逻辑链。
 */
export function buildLayered3DGraph(input: Layered3DGraphInput): Layered3DGraph {
  const { model, expandedLayers, criticalObjectIds, logicPath, selectedNodeId, diagnosisScan } = input
  const graph = buildLayeredActiveGraph(model, { expandedLayers, criticalObjectIds })

  // issue#9：诊断态聚焦链路 —— 拓扑只显示诊断链路，图谱只显示命中子图。
  const focusMode = diagnosisScan != null
  const focusTopology = focusMode ? computeFocusTopologyVisible(graph, diagnosisScan!) : null
  const focusKnowledge = focusMode ? computeFocusKnowledgeVisible(diagnosisScan!) : null

  // 可见知识节点（按 ModelNavigator 图谱分层显隐 + issue#9 命中子图过滤）。
  const kgNodes = input.knowledgeNodes.filter(
    (n) => (input.visibleKgLayers ?? {})[n.group] !== false,
  )
  const visibleKgNodes = focusKnowledge
    ? kgNodes.filter((n) => focusKnowledge.has(n.id))
    : kgNodes
  const kgNodeIds = new Set(visibleKgNodes.map((n) => n.id))
  const kgLinks = input.knowledgeLinks.filter(
    (l) => kgNodeIds.has(l.source as string) && kgNodeIds.has(l.target as string),
  )

  // 跨层映射 + 选中高亮（阶段3：只消费 ACTIVE CrossPlaneBinding；未传时兼容回退）。
  const crossLinks = buildCrossLayerLinks(model.nodes, visibleKgNodes, input.activeBindings)
  const selectedIsTopology =
    selectedNodeId != null && model.nodesById.has(selectedNodeId)
  const selectedIsKnowledge = selectedNodeId != null && kgNodeIds.has(selectedNodeId)
  const highlightedKnowledge = selectedIsTopology
    ? knowledgeAssociations(selectedNodeId!, crossLinks, kgLinks, 3)
    : new Set<string>()
  const highlightedTopology = selectedIsKnowledge
    ? topologyAssociationsForKnowledge(selectedNodeId!, crossLinks, kgLinks, 3)
    : new Set<string>()

  // 可见拓扑节点（issue#9：诊断态只保留链路节点；浏览态保留聚合语义全部节点）。
  const topoNodes = focusTopology
    ? graph.nodes.filter((n) => focusTopology.has(n.id))
    : graph.nodes

  // 节点坐标：拓扑节点按 S1→S3 域/子层定 Y/Z，成员按子层带均匀排布 X（issue#8 自动布局，
  // 拉均匀、不重叠、层级清晰）；DETACHED 关键对象（层收起但成员可见）右移避让聚合头；
  // 知识节点按图谱分层定 X。
  for (const node of topoNodes) {
    const pos = topologyNodePosition(node)
    if (!isLayerAggregateId(node.id)) {
      const sub = node.group as TopoLayerCode
      const memberIds = model.memberIdsByLayer.get(sub) ?? []
      const idx = memberIds.indexOf(node.id)
      pos.x = memberBandX(idx, memberIds.length)
      if (expandedLayers[sub] !== true) {
        // 层收起仍可见的成员 = DETACHED 关键对象：聚合头居中 x=0，成员右移避让不重叠。
        pos.x = DETACHED_X_OFFSET + (idx % 8) * MEMBER_X_SPACING
      }
    }
    applyNodePosition(node, pos)
  }
  for (const node of visibleKgNodes) applyNodePosition(node, knowledgeNodePosition(node))
  const nodes = [...topoNodes, ...visibleKgNodes]
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

  // 物理 + 知识 + 跨层 + 逻辑 连线（两端都在可见节点内，无悬挂边）。
  const visibleNodeIds = new Set(nodes.map((n) => n.id))
  const topoLinks = graph.links.filter(
    (l) => visibleNodeIds.has(l.source as string) && visibleNodeIds.has(l.target as string),
  )
  const links: GraphLink[] = [
    ...topoLinks,
    ...kgLinks,
    ...crossGraphLinks,
    ...buildLogicLinks(logicPath, graph.anchorByObjectId, visibleNodeIds),
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
    focusMode,
  }
}
