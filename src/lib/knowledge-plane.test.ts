// 知识图谱下层（主画布 issue #4 落地补全）：布局 / 跨层映射 / 关联集 纯函数校验。
// 断言：
//   1. layoutKnowledgeGraph：全部知识节点落位、连线端点可见、画布尺寸为正；
//   2. buildCrossLayerLinks：INSTANCE_OF 按 resource_type 通用解析（任意 Case 成立），
//      显式 APPLICABLE_FAULT_MODE / EVIDENCE_MAPPING 在 id 命中时并入；
//   3. knowledgeAssociations：拓扑实例 → 对象类型 → 故障模式/证据（含机制）；
//   4. topologyAssociationsForKnowledge：图谱节点 → 关联拓扑实例。
// 只读 model / case 数据；不做诊断计算。
import { describe, expect, it } from 'vitest'
import { loadModelData } from './model-loader'
import { buildLayeredModelData } from './layered-topology'
import {
  KNOWLEDGE_LAYERS,
  buildCrossLayerLinks,
  knowledgeAssociations,
  layoutKnowledgeGraph,
  reachableKnowledgeNodes,
  topologyAssociationsForKnowledge,
  type CrossRelation,
} from './knowledge-plane'

const model = loadModelData()
const knowledgeNodes = model.nodes.filter((n) => n.plane === 'knowledge')
const knowledgeLinks = model.links.filter((l) => l.category === 'knowledge')

function kgNodeId(layer: string, codePrefix: string): string {
  const node = knowledgeNodes.find(
    (n) => n.group === layer && (n.object.properties.code as string)?.startsWith(codePrefix),
  )
  if (!node) throw new Error(`missing knowledge node ${layer}/${codePrefix}`)
  return node.id
}

describe('knowledge-plane 布局', () => {
  it('全部知识节点按分层落位，无重叠列，尺寸为正', () => {
    const layout = layoutKnowledgeGraph(knowledgeNodes, knowledgeLinks)
    expect(layout.nodes.length).toBe(knowledgeNodes.length)
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
    for (const node of layout.nodes) {
      const pos = layout.nodePositions.get(node.id)
      expect(pos, `node ${node.id}`).toBeDefined()
      expect(pos!.x).toBeGreaterThanOrEqual(0)
      expect(pos!.y).toBeGreaterThanOrEqual(0)
    }
    // 每层计数合计 = 节点总数。
    const total = KNOWLEDGE_LAYERS.reduce((sum, l) => sum + (layout.counts[l.code] ?? 0), 0)
    expect(total).toBe(knowledgeNodes.length)
    // 无悬挂边：布局后的可见连线端点都在布局节点内。
    for (const link of layout.links) {
      expect(layout.nodePositions.has(link.source as string)).toBe(true)
      expect(layout.nodePositions.has(link.target as string)).toBe(true)
    }
  })

  it('图谱六层全覆盖（对象类型/现象/模式/机制/证据/案例）', () => {
    const layout = layoutKnowledgeGraph(knowledgeNodes, knowledgeLinks)
    for (const layer of KNOWLEDGE_LAYERS) {
      expect(layout.counts[layer.code] ?? 0, layer.code).toBeGreaterThan(0)
    }
  })
})

describe('knowledge-plane 跨层映射', () => {
  it('INSTANCE_OF 按 resource_type 通用解析（任意分层 Case 成立）', () => {
    for (const caseId of ['layered_topology_demo_001', 'controller_warm_reset_001', 'remote_replication_lag_001']) {
      const topo = buildLayeredModelData(caseId)
      const cross = buildCrossLayerLinks(topo.nodes, knowledgeNodes)
      // 图谱对象类型声明的 resource_types 集合。
      const knownTypes = new Set<string>()
      for (const n of knowledgeNodes) {
        if (n.group !== 'OBJECT_TYPE') continue
        const attrs = n.object.properties.attributes
        if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
          const rts = (attrs as Record<string, unknown>).resource_types
          if (Array.isArray(rts)) for (const t of rts) knownTypes.add(String(t).toUpperCase())
        }
      }
      // 每个可映射 resource_type 的实例都有 INSTANCE_OF（非 S1 兜底误判、无遗漏）。
      const mapped = topo.nodes.filter((n) => knownTypes.has((n.kind ?? '').toUpperCase()))
      expect(mapped.length, `${caseId} 应有可映射实例`).toBeGreaterThan(0)
      for (const node of mapped) {
        const links = cross.filter(
          (l) => l.topologyId === node.id && l.relation === 'INSTANCE_OF',
        )
        expect(links.length, `${caseId} ${node.id} (${node.kind}) → 对象类型`).toBeGreaterThan(0)
      }
    }
    // CONTROLLER 实例 → ot-controller（含分层演示 Case 的 ctl-01a）。
    const topo = buildLayeredModelData('layered_topology_demo_001')
    const cross = buildCrossLayerLinks(topo.nodes, knowledgeNodes)
    for (const c of topo.nodes.filter((n) => n.kind === 'CONTROLLER')) {
      const links = cross.filter((l) => l.topologyId === c.id && l.relation === 'INSTANCE_OF')
      expect(links.length, `${c.id} → ot-controller`).toBeGreaterThan(0)
      expect(links[0].knowledgeId).toBe(kgNodeId('OBJECT_TYPE', 'StorageController'))
    }
  })

  it('显式 APPLICABLE_FAULT_MODE / EVIDENCE_MAPPING 在 id 命中时并入', () => {
    // controller_warm_reset_001 含 controller-0a，与 cross-layer-mappings.json 命中。
    const topo = buildLayeredModelData('controller_warm_reset_001')
    const cross = buildCrossLayerLinks(topo.nodes, knowledgeNodes)
    const fm = cross.filter(
      (l) => l.topologyId === 'controller-0a' && l.relation === 'APPLICABLE_FAULT_MODE',
    )
    expect(fm.length).toBeGreaterThan(0)
    expect(fm.some((l) => l.knowledgeId === kgNodeId('FAULT_MODE', 'CONTROLLER_WARM_RESET'))).toBe(true)
    const em = cross.filter(
      (l) => l.topologyId === 'controller-0a' && l.relation === 'EVIDENCE_MAPPING',
    )
    expect(em.length).toBeGreaterThan(0)
    expect(em.some((l) => l.knowledgeId === kgNodeId('EVIDENCE_RULE', 'reset_alarm_rule'))).toBe(true)
  })

  it('跨层映射端点均存在于对应图内', () => {
    const topo = buildLayeredModelData('layered_topology_demo_001')
    const cross = buildCrossLayerLinks(topo.nodes, knowledgeNodes)
    const topoIds = new Set(topo.nodes.map((n) => n.id))
    const kgIds = new Set(knowledgeNodes.map((n) => n.id))
    for (const l of cross) {
      expect(topoIds.has(l.topologyId), `topology ${l.topologyId}`).toBe(true)
      expect(kgIds.has(l.knowledgeId), `knowledge ${l.knowledgeId}`).toBe(true)
      expect(['INSTANCE_OF', 'APPLICABLE_FAULT_MODE', 'EVIDENCE_MAPPING'] as CrossRelation[]).toContain(l.relation)
    }
  })
})

describe('knowledge-plane 关联集', () => {
  it('拓扑实例 → 对象类型 → 故障模式/证据/机制（深度受限展开）', () => {
    const topo = buildLayeredModelData('controller_warm_reset_001')
    const cross = buildCrossLayerLinks(topo.nodes, knowledgeNodes)
    const assoc = knowledgeAssociations('controller-0a', cross, knowledgeLinks, 3)
    // 对象类型 StorageController
    expect(assoc.has(kgNodeId('OBJECT_TYPE', 'StorageController'))).toBe(true)
    // 故障模式：控制器热复位 / 看门狗超时 / 主备切换
    expect(assoc.has(kgNodeId('FAULT_MODE', 'CONTROLLER_WARM_RESET'))).toBe(true)
    expect(assoc.has(kgNodeId('FAULT_MODE', 'WATCHDOG_TIMEOUT'))).toBe(true)
    expect(assoc.has(kgNodeId('FAULT_MODE', 'CONTROLLER_FAILOVER'))).toBe(true)
    // 机制：主 I/O 短时中断 / 主备切换与接管
    expect(assoc.has(kgNodeId('MECHANISM', 'io_path_interruption'))).toBe(true)
    expect(assoc.has(kgNodeId('MECHANISM', 'failover_switch'))).toBe(true)
    // 证据规则：复位严重告警 / 吞吐归零 / 备用接管
    expect(assoc.has(kgNodeId('EVIDENCE_RULE', 'reset_alarm_rule'))).toBe(true)
    expect(assoc.has(kgNodeId('EVIDENCE_RULE', 'throughput_zero_rule'))).toBe(true)
    expect(assoc.has(kgNodeId('EVIDENCE_RULE', 'takeover_rule'))).toBe(true)
  })

  it('图谱节点 → 关联拓扑实例（直接反向 + 经对象类型可达）', () => {
    const topo = buildLayeredModelData('controller_warm_reset_001')
    const cross = buildCrossLayerLinks(topo.nodes, knowledgeNodes)
    const fm = kgNodeId('FAULT_MODE', 'CONTROLLER_WARM_RESET')
    const topoSet = topologyAssociationsForKnowledge(fm, cross, knowledgeLinks, 3)
    // controller-0a 直接 APPLICABLE_FAULT_MODE；controller-0b 经 ot-controller 可达。
    expect(topoSet.has('controller-0a')).toBe(true)
    expect(topoSet.has('controller-0b')).toBe(true)
  })

  it('reachableKnowledgeNodes 出边 BFS 深度受限、不回流', () => {
    const start = kgNodeId('OBJECT_TYPE', 'StorageController')
    const reached = reachableKnowledgeNodes([start], knowledgeLinks, 1)
    expect(reached.has(start)).toBe(true)
    expect(reached.has(kgNodeId('SYMPTOM', 'CONTROLLER_RESET'))).toBe(true)
    expect(reached.has(kgNodeId('FAULT_MODE', 'CONTROLLER_WARM_RESET'))).toBe(true)
    // 深度 1 不到证据规则（fm → er 是第 2 跳）。
    expect(reached.has(kgNodeId('EVIDENCE_RULE', 'reset_alarm_rule'))).toBe(false)
  })
})
