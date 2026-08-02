/**
 * Knowledge Plane —— 主画布下层「故障知识图谱」的纯函数模块（issue #4 落地补全）。
 *
 * 上层分层拓扑条带（src/lib/layered-topology）与下层知识图谱共用同一 GraphNode/
 * GraphLink 契约（src/lib/model-loader），本模块提供：
 *   - layoutKnowledgeGraph：按图谱分层（OBJECT_TYPE → SYMPTOM → FAULT_MODE/MECHANISM
 *     → EVIDENCE_RULE/CASE）把知识节点排成纵向列布局，返回节点坐标/画布尺寸；
 *   - buildCrossLayerLinks：拓扑实例 ↔ 图谱节点的跨层映射。INSTANCE_OF 按
 *     resource_type（图谱节点 attributes.resource_types）通用解析（不依赖具体 Case 的
 *     实例 id，任意分层 Case 都成立）；再叠加 cross-layer-mappings.json 中与当前
 *     拓扑实例 id 命中的 APPLICABLE_FAULT_MODE / EVIDENCE_MAPPING 显式映射。
 *   - knowledgeAssociations / topologyAssociationsForKnowledge：点选一侧时求另一侧
 *     关联集（经知识图谱出边 BFS），驱动跨层高亮。
 *
 * 全部为纯函数：只读 model 数据，不写回本体；不做诊断计算。
 */

import type { GraphLink, GraphNode } from './model-loader'
import crossMappingsJson from '../../model/mappings/cross-layer-mappings.json'

// ─────────────────────────────────────────────────────────────────────────────
// 图谱分层定义（与 model/knowledge-graph/nodes.json layers 对齐）
// ─────────────────────────────────────────────────────────────────────────────

export interface KnowledgeLayerDef {
  code: string
  name: string
  color: string
}

export const KNOWLEDGE_LAYERS: ReadonlyArray<KnowledgeLayerDef> = [
  { code: 'OBJECT_TYPE', name: '对象类型', color: '#a78bfa' },
  { code: 'SYMPTOM', name: '故障现象', color: '#fbbf24' },
  { code: 'FAULT_MODE', name: '故障模式', color: '#f472b6' },
  { code: 'MECHANISM', name: '触发机制', color: '#38bdf8' },
  { code: 'EVIDENCE_RULE', name: '证据规则', color: '#2dd4bf' },
  { code: 'CASE', name: '历史案例', color: '#c084fc' },
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
// 跨层映射：拓扑实例 ↔ 图谱节点
// ─────────────────────────────────────────────────────────────────────────────

export type CrossRelation =
  | 'INSTANCE_OF'
  | 'APPLICABLE_FAULT_MODE'
  | 'EVIDENCE_MAPPING'

export interface CrossLayerLink {
  id: string
  /** 拓扑实例节点 id（分层模型）。 */
  topologyId: string
  /** 图谱节点 id。 */
  knowledgeId: string
  relation: CrossRelation
}

interface CrossMappingEntry {
  mapping_id: string
  relation_type: string
  source_id: string
  target_id: string
}

interface CrossMappingsDoc {
  mappings: CrossMappingEntry[]
}

const CROSS_MAPPINGS = (crossMappingsJson as CrossMappingsDoc).mappings ?? []

/** 图谱 OBJECT_TYPE 节点 attributes.resource_types → 节点 id（大写规整）。 */
function resourceTypeToObjectType(nodes: GraphNode[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const node of nodes) {
    if (node.group !== 'OBJECT_TYPE') continue
    const attrs = node.object.properties.attributes
    if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
      const types = (attrs as Record<string, unknown>).resource_types
      if (Array.isArray(types)) {
        for (const t of types) map.set(String(t).trim().toUpperCase(), node.id)
      }
    }
  }
  return map
}

/**
 * 构建拓扑 ↔ 图谱跨层映射连线：
 *   - INSTANCE_OF：按实例 resource_type → 图谱对象类型（通用，任意 Case 成立）；
 *   - APPLICABLE_FAULT_MODE / EVIDENCE_MAPPING：取 cross-layer-mappings.json 中与
 *     当前拓扑实例 id 命中的显式映射（如 controller-0a → 控制器热复位/证据规则）。
 */
export function buildCrossLayerLinks(
  topologyNodes: GraphNode[],
  knowledgeNodes: GraphNode[],
): CrossLayerLink[] {
  const result: CrossLayerLink[] = []
  const topoById = new Set(topologyNodes.map((n) => n.id))
  const kgById = new Set(knowledgeNodes.map((n) => n.id))
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

  for (const m of CROSS_MAPPINGS) {
    if (!topoById.has(m.source_id) || !kgById.has(m.target_id)) continue
    if (m.relation_type === 'APPLICABLE_FAULT_MODE' || m.relation_type === 'EVIDENCE_MAPPING') {
      result.push({
        id: m.mapping_id,
        topologyId: m.source_id,
        knowledgeId: m.target_id,
        relation: m.relation_type,
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
 */
export function knowledgeAssociations(
  topologyId: string,
  crossLinks: CrossLayerLink[],
  knowledgeLinks: GraphLink[],
  depth = 3,
): Set<string> {
  const startIds = crossLinks
    .filter((l) => l.topologyId === topologyId)
    .map((l) => l.knowledgeId)
  return reachableKnowledgeNodes(startIds, knowledgeLinks, depth)
}

/**
 * 图谱节点 → 关联拓扑实例集：直接反向映射 + 经对象类型可达（如选中
 * fm-controller-warm-reset 时，ot-controller 的两个控制器实例都关联）。
 */
export function topologyAssociationsForKnowledge(
  knowledgeId: string,
  crossLinks: CrossLayerLink[],
  knowledgeLinks: GraphLink[],
  depth = 3,
): Set<string> {
  const out = new Set<string>()
  for (const l of crossLinks) {
    if (l.knowledgeId === knowledgeId) {
      out.add(l.topologyId)
      continue
    }
    if (
      l.relation === 'INSTANCE_OF' &&
      reachableKnowledgeNodes([l.knowledgeId], knowledgeLinks, depth).has(knowledgeId)
    ) {
      out.add(l.topologyId)
    }
  }
  return out
}
