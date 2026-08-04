/**
 * Knowledge Plane —— 主画布下层「故障知识图谱」的纯函数模块（issue #4 落地补全）。
 *
 * 上层分层拓扑条带（src/lib/layered-topology）与下层知识图谱共用同一 GraphNode/
 * GraphLink 契约（src/lib/model-loader），本模块提供：
 *   - layoutKnowledgeGraph：按图谱分层（OBJECT_TYPE → SYMPTOM → FAULT_MODE/MECHANISM
 *     → EVIDENCE_RULE/CASE）把知识节点排成纵向列布局，返回节点坐标/画布尺寸；
 *   - buildCrossLayerLinks：拓扑实例 ↔ 图谱节点的跨层映射。阶段3 起只消费
 *     ACTIVE CrossPlaneBinding（docs/19 §6.2，跨平面光柱/曲线只允许 ACTIVE），
 *     不再按同名字符串/静态文件猜测；未传 bindings 时回退按 resource_type 通用
 *     INSTANCE_OF 解析（兼容旧画布）。
 *   - knowledgeAssociations / topologyAssociationsForKnowledge：点选一侧时求另一侧
 *     关联集（经知识图谱出边 BFS），驱动跨层高亮。
 *
 * 全部为纯函数：只读 model 数据，不写回本体；不做诊断计算。
 */

import type { GraphLink, GraphNode } from './model-loader'
import type { CrossPlaneBinding } from '../v2/cross-plane-binding'
import { STATIC_BINDING_TYPES } from '../v2/cross-plane-binding'

// ─────────────────────────────────────────────────────────────────────────────
// 图谱分层定义（KnowledgeGraphPackage 3.0.0：Domain Root + L1~L4，docs/19 §4.3）
// ─────────────────────────────────────────────────────────────────────────────

export interface KnowledgeLayerDef {
  code: string
  name: string
  color: string
}

export const KNOWLEDGE_LAYERS: ReadonlyArray<KnowledgeLayerDef> = [
  { code: 'ROOT', name: '知识域根', color: '#fca5a5' },
  { code: 'L1', name: 'L1 类型·场景', color: '#a78bfa' },
  { code: 'L2', name: 'L2 故障模式', color: '#f472b6' },
  { code: 'L3', name: 'L3 现象·机理·证据', color: '#38bdf8' },
  { code: 'L4', name: 'L4 规则·模板·案例', color: '#2dd4bf' },
]

/** 图谱分层展示顺序 code 列表。 */
export const KNOWLEDGE_LAYER_CODES = KNOWLEDGE_LAYERS.map((l) => l.code)

/** 取图谱分层定义；未知码回退 OBJECT_TYPE。 */
export function knowledgeLayerDef(code: string): KnowledgeLayerDef {
  return KNOWLEDGE_LAYERS.find((l) => l.code === code) ?? KNOWLEDGE_LAYERS[0]
}

// ─────────────────────────────────────────────────────────────────────────────
// 布局：每层一列，节点纵向堆叠
// ─────────────────────────────────────────────────────────────────────────────

const COL_W = 200
const NODE_W = 168
const NODE_H = 34
const NODE_GAP = 12
const HEADER_H = 26
const PAD_TOP = 12
const PAD_SIDE = 20
const PAD_BOTTOM = 20

/** 布局度量（供画布绘制层标题等复用，避免魔法数散落）。 */
export const KNOWLEDGE_LAYOUT_METRICS = {
  colW: COL_W,
  nodeW: NODE_W,
  nodeH: NODE_H,
  nodeGap: NODE_GAP,
  headerH: HEADER_H,
  padTop: PAD_TOP,
  padSide: PAD_SIDE,
  padBottom: PAD_BOTTOM,
} as const

export interface KnowledgeLayout {
  nodes: GraphNode[]
  links: GraphLink[]
  nodePositions: Map<string, { x: number; y: number }>
  width: number
  height: number
  counts: Record<string, number>
}

/**
 * 把知识图谱节点排成按分层分列的纵向布局（轻量，几十个节点）。
 * 只保留两端都可见的连线；布局坐标仅本模块/画布使用，不写入本体。
 */
export function layoutKnowledgeGraph(
  nodes: GraphNode[],
  links: GraphLink[],
): KnowledgeLayout {
  const byLayer = new Map<string, GraphNode[]>()
  for (const node of nodes) {
    const arr = byLayer.get(node.group) ?? []
    arr.push(node)
    byLayer.set(node.group, arr)
  }

  const nodePositions = new Map<string, { x: number; y: number }>()
  const counts: Record<string, number> = {}
  let maxColHeight = 0

  KNOWLEDGE_LAYERS.forEach((layer, i) => {
    const members = byLayer.get(layer.code) ?? []
    counts[layer.code] = members.length
    const colX = PAD_SIDE + i * COL_W + COL_W / 2
    const firstY = PAD_TOP + HEADER_H
    members.forEach((node, j) => {
      nodePositions.set(node.id, {
        x: colX,
        y: firstY + j * (NODE_H + NODE_GAP),
      })
    })
    const colHeight = HEADER_H + members.length * NODE_H + Math.max(0, members.length - 1) * NODE_GAP
    if (colHeight > maxColHeight) maxColHeight = colHeight
  })

  const height = PAD_TOP + maxColHeight + PAD_BOTTOM
  const width = PAD_SIDE * 2 + KNOWLEDGE_LAYERS.length * COL_W

  const visibleIds = new Set(nodes.map((n) => n.id))
  const visibleLinks = links.filter(
    (l) => visibleIds.has(l.source as string) && visibleIds.has(l.target as string),
  )

  return { nodes, links: visibleLinks, nodePositions, width, height, counts }
}

// ─────────────────────────────────────────────────────────────────────────────
// 跨层映射：拓扑实例 ↔ 图谱节点（阶段3：只基于 ACTIVE CrossPlaneBinding）
// ─────────────────────────────────────────────────────────────────────────────

/** 跨层映射关系（与 CrossPlaneBindingType 对齐；保留旧语义命名以便兼容）。 */
export type CrossRelation =
  | 'INSTANCE_OF'
  | 'CONFORMS_TO'
  | 'ENTRY_OBJECT_TYPE'
  | 'CANDIDATE_ON_RESOURCE'
  | 'CANDIDATE_OF_FAULT_MODE'
  | 'EVIDENCE_MATCHES_RULE'
  | 'ROOT_CAUSE_CONFIRMED_AS'

export interface CrossLayerLink {
  id: string
  /** 拓扑实例节点 id（分层模型）。 */
  topologyId: string
  /** 图谱节点 id。 */
  knowledgeId: string
  relation: CrossRelation
}

/** 静态跨层关系（淡显）；其余为动态诊断点亮关系。 */
export function isStaticCrossRelation(relation: string): boolean {
  return STATIC_BINDING_TYPES.has(relation as CrossRelation)
}

/** 图谱 L1 RESOURCE_TYPE 节点（properties.resource_types ∪ code）→ 节点 id（大写规整）。 */
function resourceTypeToObjectType(nodes: GraphNode[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const node of nodes) {
    if (node.group !== 'L1') continue
    if (node.object.properties.knowledgeKind !== 'RESOURCE_TYPE') continue
    const attrs = node.object.properties.attributes
    const types = new Set<string>()
    if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
      const resourceTypes = (attrs as Record<string, unknown>).resource_types
      if (Array.isArray(resourceTypes)) {
        for (const t of resourceTypes) types.add(String(t).trim().toUpperCase())
      }
    }
    const code = node.object.properties.code
    if (typeof code === 'string') types.add(code.trim().toUpperCase())
    for (const t of types) if (!map.has(t)) map.set(t, node.id)
  }
  return map
}

/**
 * 构建拓扑 ↔ 图谱跨层映射连线（docs/19 §6.2：前端只绘制 ACTIVE Binding）。
 *
 * 传入 ACTIVE CrossPlaneBinding 时：把每个 Binding 的 source/target 端点落到
 * 拓扑/知识节点（CONFORMS_TO 指向 `kg:capability:*` 无可见节点，自动跳过）；
 * 同一端点对去重（CANDIDATE_ON_RESOURCE 与 CANDIDATE_OF_FAULT_MODE 共享端点）。
 *
 * 未传 bindings（旧画布兼容）：回退按实例 resource_type → 图谱对象类型的
 * INSTANCE_OF 通用解析（任意 Case 成立，不再读取静态映射文件）。
 */
export function buildCrossLayerLinks(
  topologyNodes: GraphNode[],
  knowledgeNodes: GraphNode[],
  bindings?: CrossPlaneBinding[],
): CrossLayerLink[] {
  const result: CrossLayerLink[] = []

  if (bindings) {
    const topoById = new Set(topologyNodes.map((n) => n.id))
    const kgById = new Set(knowledgeNodes.map((n) => n.id))
    const seenPairs = new Set<string>()
    for (const b of bindings) {
      if (b.status !== 'ACTIVE') continue
      let topologyId: string | null = null
      let knowledgeId: string | null = null
      if (b.source_plane === 'TOPOLOGY') topologyId = b.source_ref
      else knowledgeId = b.source_ref
      if (b.target_plane === 'TOPOLOGY') topologyId = b.target_ref
      else knowledgeId = b.target_ref
      if (!topologyId || !knowledgeId) continue
      if (!topoById.has(topologyId) || !kgById.has(knowledgeId)) continue
      const key = `${topologyId}|${knowledgeId}`
      if (seenPairs.has(key)) continue
      seenPairs.add(key)
      result.push({
        id: b.binding_id,
        topologyId,
        knowledgeId,
        relation: b.binding_type,
      })
    }
    return result
  }

  // —— 无 bindings 的兼容回退：INSTANCE_OF 通用解析 ——
  const byResourceType = resourceTypeToObjectType(knowledgeNodes)
  for (const topo of topologyNodes) {
    const otId = byResourceType.get((topo.kind ?? '').trim().toUpperCase())
    if (otId) {
      result.push({
        id: `x-inst-${topo.id}`,
        topologyId: topo.id,
        knowledgeId: otId,
        relation: 'INSTANCE_OF',
      })
    }
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// 关联集：点选一侧 → 另一侧高亮
// ─────────────────────────────────────────────────────────────────────────────

/** 知识图谱出边邻接表（id → 出边目标 ids）。 */
function outgoingAdjacency(links: GraphLink[]): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  for (const link of links) {
    const s = link.source as string
    const t = link.target as string
    const arr = adj.get(s) ?? []
    arr.push(t)
    adj.set(s, arr)
  }
  return adj
}

/** 从 startIds 沿知识图谱出边 BFS（depth 层），返回可达节点 id 集。 */
export function reachableKnowledgeNodes(
  startIds: string[],
  links: GraphLink[],
  depth = 3,
): Set<string> {
  const adj = outgoingAdjacency(links)
  const out = new Set(startIds)
  const queue = [...startIds]
  let level = 0
  while (queue.length && level < depth) {
    const size = queue.length
    for (let i = 0; i < size; i++) {
      const id = queue.shift()!
      for (const next of adj.get(id) ?? []) {
        if (out.has(next)) continue
        out.add(next)
        queue.push(next)
      }
    }
    level += 1
  }
  return out
}

/**
 * 拓扑实例 → 其下层图谱关联节点集：从该实例的跨层映射目标（对象类型/故障模式/
 * 证据规则）沿知识图谱出边展开（覆盖 现象 → 模式 → 机制 → 证据 → 案例）。
 *
 * 阶段3：静态 INSTANCE_OF 目标（L1 RESOURCE_TYPE）的反向 APPLIES_TO_TYPE 前驱
 * 提供"该类型适用哪些故障模式/场景"——旧 cross-layer-mappings.json 里
 * APPLICABLE_FAULT_MODE 静态映射的数据驱动等价（任意 Case 成立，无 case_id 特判）。
 * 诊断态下动态 Binding（CANDIDATE / EVIDENCE_MATCHES_RULE / ROOT_CAUSE）的
 * 目标直接入起点，点亮范围随诊断推进。
 */
export function knowledgeAssociations(
  topologyId: string,
  crossLinks: CrossLayerLink[],
  knowledgeLinks: GraphLink[],
  depth = 3,
): Set<string> {
  const start = new Set(
    crossLinks
      .filter((l) => l.topologyId === topologyId)
      .map((l) => l.knowledgeId),
  )
  // 反向 APPLIES_TO_TYPE：fm/scenario --APPLIES_TO_TYPE→ RESOURCE_TYPE 节点。
  for (const l of crossLinks) {
    if (l.topologyId !== topologyId || l.relation !== 'INSTANCE_OF') continue
    for (const link of knowledgeLinks) {
      if (link.relation === 'APPLIES_TO_TYPE' && link.target === l.knowledgeId) {
        start.add(link.source as string)
      }
    }
  }
  return reachableKnowledgeNodes([...start], knowledgeLinks, depth)
}

/**
 * 图谱节点 → 关联拓扑实例集：直接反向映射 + 沿图谱出边可达的对象类型
 * （如选中 fm-controller-warm-reset 时，其 APPLIES_TO_TYPE 到的 ot-controller
 * 的两个控制器实例都关联；选中 ot-controller 时由其直接 INSTANCE_OF 反向命中）。
 */
export function topologyAssociationsForKnowledge(
  knowledgeId: string,
  crossLinks: CrossLayerLink[],
  knowledgeLinks: GraphLink[],
  depth = 3,
): Set<string> {
  const out = new Set<string>()
  const reachableFrom = reachableKnowledgeNodes([knowledgeId], knowledgeLinks, depth)
  for (const l of crossLinks) {
    if (l.knowledgeId === knowledgeId) {
      out.add(l.topologyId)
      continue
    }
    if (l.relation === 'INSTANCE_OF' && reachableFrom.has(l.knowledgeId)) {
      out.add(l.topologyId)
    }
  }
  return out
}
