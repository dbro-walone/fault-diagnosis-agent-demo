// 知识图谱下层（主画布 issue #4 落地补全）：布局 / 跨层映射 / 关联集 纯函数校验。
// KnowledgeGraphPackage 3.0.0 四层结构（Domain Root + L1~L4）：
//   1. layoutKnowledgeGraph：全部知识节点落位、连线端点可见、画布尺寸为正；
//   2. buildCrossLayerLinks：阶段3 起只消费 ACTIVE CrossPlaneBinding（docs/19 §6.2），
//      静态 INSTANCE_OF 淡显、候选/证据/根因动态 Binding 跨层点亮；
//      未传 bindings 时回退 INSTANCE_OF 按 resource_type 通用解析；
//   3. knowledgeAssociations：拓扑实例 → 资源类型 → 场景/模式 → 机理/证据要求 → 规则；
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
import {
  activeBindingsOf,
  buildKnowledgePlaneIndex,
  deriveDynamicBindings,
  loadAdaptedCase,
  replayCase,
  resourceTypeResolverOf,
} from '../v2'

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

  it('图谱五层全覆盖（知识域根/L1 类型·场景/L2 模式/L3 现象·机理·证据/L4 规则·模板·案例）', () => {
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
      // 图谱 L1 RESOURCE_TYPE 节点声明的 resource_types 集合（含 code 兜底）。
      const knownTypes = new Set<string>()
      for (const n of knowledgeNodes) {
        if (n.group !== 'L1' || n.object.properties.knowledgeKind !== 'RESOURCE_TYPE') continue
        const attrs = n.object.properties.attributes
        if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
          const rts = (attrs as Record<string, unknown>).resource_types
          if (Array.isArray(rts)) for (const t of rts) knownTypes.add(String(t).toUpperCase())
        }
        const code = n.object.properties.code
        if (typeof code === 'string') knownTypes.add(String(code).toUpperCase())
      }
      // 每个可映射 resource_type 的实例都有 INSTANCE_OF（非 S1 兜底误判、无遗漏）。
      const mapped = topo.nodes.filter((n) => knownTypes.has((n.kind ?? '').toUpperCase()))
      expect(mapped.length, `${caseId} 应有可映射实例`).toBeGreaterThan(0)
      for (const node of mapped) {
        const links = cross.filter(
          (l) => l.topologyId === node.id && l.relation === 'INSTANCE_OF',
        )
        expect(links.length, `${caseId} ${node.id} (${node.kind}) → 资源类型`).toBeGreaterThan(0)
      }
    }
    // CONTROLLER 实例 → ot-controller（含分层演示 Case 的 ctl-01a）。
    const topo = buildLayeredModelData('layered_topology_demo_001')
    const cross = buildCrossLayerLinks(topo.nodes, knowledgeNodes)
    for (const c of topo.nodes.filter((n) => n.kind === 'CONTROLLER')) {
      const links = cross.filter((l) => l.topologyId === c.id && l.relation === 'INSTANCE_OF')
      expect(links.length, `${c.id} → ot-controller`).toBeGreaterThan(0)
      expect(links[0].knowledgeId).toBe(kgNodeId('L1', 'CONTROLLER'))
    }
  })

  it('ACTIVE CrossPlaneBinding：静态 INSTANCE_OF 淡显 + 动态候选/证据/根因点亮', () => {
    // controller_warm_reset_001 完整回放后的 ACTIVE Binding 集（静态 + 动态派生）。
    const topo = buildLayeredModelData('controller_warm_reset_001')
    const adapted = loadAdaptedCase('controller_warm_reset_001')
    const snap = replayCase('controller_warm_reset_001')
    const index = buildKnowledgePlaneIndex()
    const dynamic = deriveDynamicBindings(
      snap,
      resourceTypeResolverOf(adapted.instanceTopology),
      index,
    )
    const cross = buildCrossLayerLinks(topo.nodes, knowledgeNodes, activeBindingsOf([...adapted.staticBindings, ...dynamic]))

    // 静态 INSTANCE_OF：controller-0a → ot-controller（始终存在）。
    expect(
      cross.some(
        (l) =>
          l.topologyId === 'controller-0a' &&
          l.relation === 'INSTANCE_OF' &&
          l.knowledgeId === kgNodeId('L1', 'CONTROLLER'),
      ),
    ).toBe(true)

    // 根因确认：ROOT_CAUSE_CONFIRMED_AS controller-0a → 控制器热复位（动态点亮）。
    expect(
      cross.some(
        (l) =>
          l.topologyId === 'controller-0a' &&
          l.relation === 'ROOT_CAUSE_CONFIRMED_AS' &&
          l.knowledgeId === kgNodeId('L2', 'CONTROLLER_WARM_RESET'),
      ),
    ).toBe(true)

    // 证据命中规则：EVIDENCE_MATCHES_RULE controller-0a → 复位严重告警规则。
    expect(
      cross.some(
        (l) =>
          l.topologyId === 'controller-0a' &&
          l.relation === 'EVIDENCE_MATCHES_RULE' &&
          l.knowledgeId === kgNodeId('L4', 'CONTROLLER_RESET_ALARM_RULE'),
      ),
    ).toBe(true)

    // 被排除候选的 CANDIDATE_* 绑定为 REVOKED，不进入 ACTIVE 连线。
    expect(
      cross.some((l) => l.topologyId === 'storage-pool-01' && l.relation === 'CANDIDATE_OF_FAULT_MODE'),
    ).toBe(false)
  })

  it('跨层映射端点均存在于对应图内，关系为合法 Binding 类型', () => {
    const topo = buildLayeredModelData('layered_topology_demo_001')
    // 浏览态：仅静态 Binding（ACTIVE）。
    const adapted = loadAdaptedCase('layered_topology_demo_001')
    const cross = buildCrossLayerLinks(topo.nodes, knowledgeNodes, adapted.staticBindings)
    const topoIds = new Set(topo.nodes.map((n) => n.id))
    const kgIds = new Set(knowledgeNodes.map((n) => n.id))
    const legalRelations: CrossRelation[] = [
      'INSTANCE_OF',
      'CONFORMS_TO',
      'ENTRY_OBJECT_TYPE',
      'CANDIDATE_ON_RESOURCE',
      'CANDIDATE_OF_FAULT_MODE',
      'EVIDENCE_MATCHES_RULE',
      'ROOT_CAUSE_CONFIRMED_AS',
    ]
    for (const l of cross) {
      expect(topoIds.has(l.topologyId), `topology ${l.topologyId}`).toBe(true)
      expect(kgIds.has(l.knowledgeId), `knowledge ${l.knowledgeId}`).toBe(true)
      expect(legalRelations).toContain(l.relation)
    }
  })
})

describe('knowledge-plane 关联集', () => {
  it('拓扑实例 → 资源类型 → 故障模式/机理/证据要求/规则（深度受限展开）', () => {
    const topo = buildLayeredModelData('controller_warm_reset_001')
    const cross = buildCrossLayerLinks(topo.nodes, knowledgeNodes)
    const assoc = knowledgeAssociations('controller-0a', cross, knowledgeLinks, 3)
    // 资源类型 CONTROLLER
    expect(assoc.has(kgNodeId('L1', 'CONTROLLER'))).toBe(true)
    // 故障模式：控制器热复位 / 看门狗超时 / 主备切换（经传播链）
    expect(assoc.has(kgNodeId('L2', 'CONTROLLER_WARM_RESET'))).toBe(true)
    expect(assoc.has(kgNodeId('L2', 'WATCHDOG_TIMEOUT'))).toBe(true)
    expect(assoc.has(kgNodeId('L2', 'CONTROLLER_FAILOVER'))).toBe(true)
    // 机理：主 I/O 短时中断 / 主备切换与接管（经 LEADS_TO 传播链）
    expect(assoc.has(kgNodeId('L3', 'IO_PATH_INTERRUPTION'))).toBe(true)
    expect(assoc.has(kgNodeId('L3', 'FAILOVER_SWITCH'))).toBe(true)
    // 证据规则：复位严重告警 / 吞吐归零 / 备用接管
    expect(assoc.has(kgNodeId('L4', 'CONTROLLER_RESET_ALARM_RULE'))).toBe(true)
    expect(assoc.has(kgNodeId('L4', 'THROUGHPUT_ZERO_RULE'))).toBe(true)
    expect(assoc.has(kgNodeId('L4', 'TAKEOVER_RULE'))).toBe(true)
  })

  it('图谱节点 → 关联拓扑实例（直接反向 + 经 APPLIES_TO_TYPE 可达）', () => {
    const topo = buildLayeredModelData('controller_warm_reset_001')
    const cross = buildCrossLayerLinks(topo.nodes, knowledgeNodes)
    const fm = kgNodeId('L2', 'CONTROLLER_WARM_RESET')
    const topoSet = topologyAssociationsForKnowledge(fm, cross, knowledgeLinks, 3)
    // controller-0a 直接 APPLICABLE_FAULT_MODE；controller-0b 经 APPLIES_TO_TYPE 可达。
    expect(topoSet.has('controller-0a')).toBe(true)
    expect(topoSet.has('controller-0b')).toBe(true)
  })

  it('reachableKnowledgeNodes 出边 BFS 深度受限、不回流', () => {
    const start = kgNodeId('L2', 'CONTROLLER_WARM_RESET')
    const reached = reachableKnowledgeNodes([start], knowledgeLinks, 1)
    expect(reached.has(start)).toBe(true)
    // 深度 1：症状概念（MANIFESTS_AS）+ 适用资源类型（APPLIES_TO_TYPE）。
    expect(reached.has(kgNodeId('L3', 'CONTROLLER_RESET'))).toBe(true)
    expect(reached.has(kgNodeId('L1', 'CONTROLLER'))).toBe(true)
    // 深度 1 不到证据规则（fm → evreq → er 是第 2 跳）。
    expect(reached.has(kgNodeId('L4', 'CONTROLLER_RESET_ALARM_RULE'))).toBe(false)
  })
})
