// issue #4 方向修正 —— 3D 分层布局纯函数测试：
// S1→S3 域带 Y 分层 / 子层 Z 分带 / 图谱分层 X 列 / 图组装（展开收起、跨层、红逻辑链）。
// 只读 Case + 静态模型；不改 ontologies/case 文件。
import { describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_LAYER_X,
  KNOWLEDGE_PLANE_Y,
  MEMBER_X_SPAN_MAX,
  buildLayered3DGraph,
  domainBandY,
  knowledgeNodePosition,
  memberBandX,
  subLayerZ,
  topologyNodePosition,
} from './layered-topology-3d'
import {
  TOPO_SUB_LAYERS,
  buildLayeredActiveGraph,
  buildLayeredModelData,
  layerAggregateId,
  type TopoLayerCode,
} from './layered-topology'
import { loadModelData } from './model-loader'
import { createDiagnosisRuntime, loadAdaptedCase, ProjectionStore, replayCase } from '../v2'

const model = buildLayeredModelData('layered_topology_demo_001')
const staticModel = loadModelData()
const knowledgeNodes = staticModel.nodes.filter((n) => n.plane === 'knowledge')
const knowledgeLinks = staticModel.links.filter((l) => l.category === 'knowledge')

const emptyExpanded = {} as Record<TopoLayerCode, boolean>

function input(partial: Partial<Parameters<typeof buildLayered3DGraph>[0]> = {}) {
  return {
    model,
    expandedLayers: emptyExpanded,
    criticalObjectIds: new Set<string>(),
    knowledgeNodes,
    knowledgeLinks,
    visibleKgLayers: undefined,
    logicPath: [],
    selectedNodeId: null,
    aggregateContext: {},
    ...partial,
  }
}

describe('S1→S3 域带 Y 分层', () => {
  it('S1 > S2 > S3 且三者互异（垂直分层肉眼可辨）', () => {
    const y1 = domainBandY('S1')
    const y2 = domainBandY('S2')
    const y3 = domainBandY('S3')
    expect(y1).toBeGreaterThan(y2)
    expect(y2).toBeGreaterThan(y3)
    expect(new Set([y1, y2, y3]).size).toBe(3)
  })
})

describe('子层 Z 分带', () => {
  it('同一域内子层 Z 互异且以域带居中对称', () => {
    expect(subLayerZ('S1_1')).toBe(-40)
    expect(subLayerZ('S1_2')).toBe(0)
    expect(subLayerZ('S1_3')).toBe(40)
    expect(subLayerZ('S2_1')).toBe(-40)
    expect(subLayerZ('S2_3')).toBe(40)
    expect(subLayerZ('S3_1')).toBe(-80)
    expect(subLayerZ('S3_3')).toBe(0)
    expect(subLayerZ('S3_5')).toBe(80)
    for (const domain of ['S1', 'S2', 'S3'] as const) {
      const subs = TOPO_SUB_LAYERS.filter((l) => l.domain === domain)
      const zs = subs.map((l) => subLayerZ(l.code))
      expect(new Set(zs).size).toBe(zs.length)
    }
  })
})

describe('memberBandX 均匀排布（issue#8 自动布局）', () => {
  it('count<=1 居中；多成员均匀、对称、互不重叠', () => {
    expect(memberBandX(0, 1)).toBe(0)
    const xs = [0, 1, 2, 3, 4].map((i) => memberBandX(i, 5))
    expect(new Set(xs).size).toBe(5) // 互不重叠
    expect(xs[2]).toBe(0) // 中间成员居中
    expect(xs[0]).toBe(-xs[4]) // 对称
    expect(Math.abs(xs[1] - xs[0])).toBe(Math.abs(xs[2] - xs[1])) // 均匀
  })
})

describe('topologyNodePosition', () => {
  it('域聚合头居中于域带中心（z=0、x=0）', () => {
    const collapsed = buildLayeredActiveGraph(model, { expandedLayers: emptyExpanded })
    const s3Agg = collapsed.nodes.find((n) => n.id === layerAggregateId('S3'))!
    const pos = topologyNodePosition(s3Agg)
    expect(pos.y).toBe(domainBandY('S3'))
    expect(pos.z).toBe(0)
    expect(pos.x).toBe(0)
    expect(pos.fy).toBe(domainBandY('S3'))
    expect(pos.fz).toBe(0)
    expect(pos.fx).toBeNull()
  })

  it('成员节点落在所属子层带（业务 S1.1 上 / 硬件 S3.5 下）', () => {
    const app = model.nodesById.get('db-app-01')! // BUSINESS_APP → S1_1
    const appPos = topologyNodePosition(app)
    expect(appPos.y).toBe(domainBandY('S1'))
    expect(appPos.z).toBe(subLayerZ('S1_1'))

    const disk = model.nodesById.get('disk-01a')! // DISK → S3_5
    const diskPos = topologyNodePosition(disk)
    expect(diskPos.y).toBe(domainBandY('S3'))
    expect(diskPos.z).toBe(subLayerZ('S3_5'))
    expect(diskPos.y).toBeLessThan(appPos.y)
  })
})

describe('knowledgeNodePosition', () => {
  it('图谱分层 X 列 + 知识平面 Y 固定，z 自由', () => {
    const ot = knowledgeNodes.find((n) => n.id === 'ot-controller')!
    const pos = knowledgeNodePosition(ot)
    expect(pos.y).toBe(KNOWLEDGE_PLANE_Y)
    expect(pos.x).toBe(KNOWLEDGE_LAYER_X.L1)
    expect(pos.fy).toBe(KNOWLEDGE_PLANE_Y)
    expect(pos.fx).toBe(KNOWLEDGE_LAYER_X.L1)
    expect(pos.fz).toBeNull()
  })
})

describe('buildLayered3DGraph', () => {
  it('默认全收起：仅 3 个域聚合头 + 全部知识节点', () => {
    const g = buildLayered3DGraph(input())
    const aggIds = g.nodes.filter((n) => n.id.startsWith('layer:')).map((n) => n.id)
    expect(aggIds).toEqual(['layer:S1', 'layer:S2', 'layer:S3'])
    expect(g.nodes.length).toBe(3 + knowledgeNodes.length)
    expect(g.summaries.has(layerAggregateId('S1'))).toBe(true)
    expect(g.summaries.get(layerAggregateId('S3_5'))).toBeUndefined()
  })

  it('展开 S3+S3_5：S3_5 聚合头隐藏、真实成员显露，无悬挂边（需求1）', () => {
    const g = buildLayered3DGraph(
      input({ expandedLayers: { S3: true, S3_5: true } as Record<TopoLayerCode, boolean> }),
    )
    // 展开的子层聚合头隐藏；展开的域聚合头隐藏；真实成员占据。
    expect(g.nodesById.has(layerAggregateId('S3_5'))).toBe(false)
    expect(g.nodesById.has(layerAggregateId('S3'))).toBe(false)
    expect(g.nodesById.has('disk-01a')).toBe(true)
    for (const link of g.links) {
      expect(g.nodesById.has(link.source as string)).toBe(true)
      expect(g.nodesById.has(link.target as string)).toBe(true)
    }
  })

  it('展开子层：真实成员按子层带均匀排布、互不重叠（issue#8 自动布局）', () => {
    const g = buildLayered3DGraph(
      input({ expandedLayers: { S3: true, S3_5: true } as Record<TopoLayerCode, boolean> }),
    )
    const memberIds = model.memberIdsByLayer.get('S3_5')!
    const xs = memberIds.map((id) => g.nodesById.get(id)!.x)
    expect(new Set(xs).size).toBe(xs.length) // 互不重叠
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(MEMBER_X_SPAN_MAX)
    expect(xs).toEqual([...xs].sort((a, b) => a - b)) // 单调排布（拉均匀）
  })

  it('拓扑节点固定域带 Y + 子层 Z；x 自由（undefined）', () => {
    const g = buildLayered3DGraph(
      input({ expandedLayers: { S3: true, S3_5: true } as Record<TopoLayerCode, boolean> }),
    )
    const disk = g.nodesById.get('disk-01a')!
    expect(disk.fy).toBe(domainBandY('S3'))
    expect(disk.fz).toBe(subLayerZ('S3_5'))
    expect(disk.fx).toBeUndefined()
    // 未展开的 S1 域聚合头仍可见且固定在域带中心。
    const s1Agg = g.nodesById.get(layerAggregateId('S1'))!
    expect(s1Agg.fy).toBe(domainBandY('S1'))
    expect(s1Agg.fz).toBe(0)
  })

  it('知识节点固定图谱分层 X + 平面 Y；z 自由', () => {
    const g = buildLayered3DGraph(input())
    const ot = g.nodesById.get('ot-controller')!
    expect(ot.fx).toBe(KNOWLEDGE_LAYER_X.L1)
    expect(ot.fy).toBe(KNOWLEDGE_PLANE_Y)
    expect(ot.fz).toBeUndefined()
  })

  it('跨层映射端点经锚点规整后全部落在可见节点', () => {
    const g = buildLayered3DGraph(input({ expandedLayers: { S3: true } as Record<TopoLayerCode, boolean> }))
    const cross = g.links.filter((l) => l.category === 'cross')
    expect(cross.length).toBeGreaterThan(0)
    for (const l of cross) {
      expect(g.nodesById.has(l.source as string)).toBe(true)
      expect(g.nodesById.has(l.target as string)).toBe(true)
    }
  })

  it('逻辑链收起态锚定到域聚合头：跨域折叠成一条 3D 红线', () => {
    // db-app-01（S1 收起）→ ctl-01a（S3 收起）：锚点 S1 域头 → S3 域头。
    const g = buildLayered3DGraph(input({ logicPath: ['db-app-01', 'ctl-01a'] }))
    const logic = g.links.filter((l) => l.category === 'logic')
    expect(logic).toHaveLength(1)
    expect(logic[0].source).toBe(layerAggregateId('S1'))
    expect(logic[0].target).toBe(layerAggregateId('S3'))
  })

  it('逻辑链同层折叠：两端同锚点 → 无线段', () => {
    const g = buildLayered3DGraph(input({ logicPath: ['disk-01a', 'enc-01a'] }))
    expect(g.links.filter((l) => l.category === 'logic')).toHaveLength(0)
  })

  it('聚合摘要带运行时上下文（候选计入候选数；展开层聚合头隐藏无摘要）', () => {
    const g = buildLayered3DGraph(
      input({
        expandedLayers: { S3: true } as Record<TopoLayerCode, boolean>,
        aggregateContext: { candidateObjectIds: new Set(['disk-01a']) },
      }),
    )
    // S3_5 收起 → 聚合头保留且候选计入。
    expect(g.summaries.get(layerAggregateId('S3_5'))!.candidate).toBe(1)
    // S3 展开 → 域聚合头隐藏，无对应摘要。
    expect(g.summaries.has(layerAggregateId('S3'))).toBe(false)
  })

  it('DETACHED 关键对象右移避让聚合头（不重叠）', () => {
    const g = buildLayered3DGraph(
      input({
        expandedLayers: { S3: true } as Record<TopoLayerCode, boolean>,
        criticalObjectIds: new Set(['disk-01a']),
      }),
    )
    const header = g.nodesById.get(layerAggregateId('S3_5'))!
    const detached = g.nodesById.get('disk-01a')!
    // 聚合头居中 x=0；DETACHED 成员右移，二者 X 分离。
    expect(header.x).toBe(0)
    expect(detached.x).toBeGreaterThan(header.x + 20)
  })

  it('选中拓扑节点 → 图谱关联子图高亮', () => {
    const g = buildLayered3DGraph(
      input({ selectedNodeId: 'ctl-01a' }),
    )
    expect(g.selectedIsTopology).toBe(true)
    expect(g.selectedIsKnowledge).toBe(false)
    // ctl-01a CONTROLLER → ot-controller 对象类型存在 → 图谱侧有高亮起点。
    expect(g.highlightedKnowledge.has('ot-controller')).toBe(true)
  })

  it('选中图谱节点 → 关联拓扑实例高亮（INSTANCE_OF 反向）', () => {
    const g = buildLayered3DGraph(input({ selectedNodeId: 'ot-controller' }))
    expect(g.selectedIsKnowledge).toBe(true)
    expect(g.highlightedTopology.has('ctl-01a')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// issue#9 诊断聚焦链路视图 —— 诊断态只显示链路（拓扑）+ 命中子图（图谱）
// ─────────────────────────────────────────────────────────────────────────────

describe('issue#9 诊断聚焦链路视图 buildLayered3DGraph(diagnosisScan)', () => {
  // 与 App 一致：从静态 model knowledge 平面取节点/连线参考，供 ProjectionStore 推导。
  const kgNodeIdSet = new Set(
    staticModel.nodes.filter((n) => n.plane === 'knowledge').map((n) => n.id),
  )
  const kgRefs = knowledgeNodes.map((n) => ({
    id: n.id,
    layer: n.group,
    node_type:
      typeof n.object.properties.knowledgeKind === 'string'
        ? (n.object.properties.knowledgeKind as string)
        : null,
    code: typeof n.object.properties.code === 'string' ? (n.object.properties.code as string) : null,
    fault_mode_code:
      (n.object.properties.attributes as Record<string, unknown> | undefined)?.['fault_mode_code'] as
        | string
        | undefined ?? null,
  }))
  const kgLinkRefs = staticModel.links
    .filter((l) => {
      if (l.category === 'knowledge') return true
      if (l.category === 'cross') {
        return kgNodeIdSet.has(l.source as string) && kgNodeIdSet.has(l.target as string)
      }
      return false
    })
    .map((l) => ({ source: l.source as string, target: l.target as string, relation: l.relation }))

  /** controller 终态诊断扫描（带 seed 入口对象，覆盖症状归一化前初始化）。 */
  function controllerScan() {
    const snap = replayCase('controller_warm_reset_001')
    const store = new ProjectionStore()
    store.bind(snap, {
      observationsFacts: loadAdaptedCase('controller_warm_reset_001').facts,
      knowledgeNodes: kgRefs,
      knowledgeLinks: kgLinkRefs,
      entryObjectRefs: ['db-business-01', 'lun-db01'],
    })
    return store.diagnosisScan()
  }

  /** 全部层展开 → 基图无聚合头，只有真实成员，便于断言"链路"与"隐藏"对照。 */
  const allExpanded = {} as Record<TopoLayerCode, boolean>
  for (const layer of TOPO_SUB_LAYERS) allExpanded[layer.code] = true
  for (const d of ['S1', 'S2', 'S3'] as const) allExpanded[d] = true

  function controllerModel() {
    return buildLayeredModelData('controller_warm_reset_001')
  }

  function focusInput(partial: Partial<Parameters<typeof buildLayered3DGraph>[0]> = {}) {
    return {
      model: controllerModel(),
      expandedLayers: allExpanded,
      criticalObjectIds: new Set<string>(),
      knowledgeNodes,
      knowledgeLinks,
      visibleKgLayers: undefined,
      logicPath: [],
      selectedNodeId: null,
      aggregateContext: {},
      ...partial,
    }
  }

  it('非诊断态：focusMode=false，全拓扑+全图谱（浏览态冷冻不改变）', () => {
    const g = buildLayered3DGraph(focusInput({ diagnosisScan: null }))
    expect(g.focusMode).toBe(false)
    // 全展开：全部真实成员 + 全部知识节点。
    const topoCount = controllerModel().nodes.length
    expect(g.nodes.filter((n) => n.plane === 'topology').length).toBe(topoCount)
    expect(g.nodes.filter((n) => n.plane === 'knowledge').length).toBe(knowledgeNodes.length)
    // 非链路节点（未排查）在浏览态可见。
    expect(g.nodesById.has('disk-group-01')).toBe(true)
  })

  it('诊断态：拓扑显示完整最终拓扑并强制全展开', () => {
    const scan = controllerScan()
    const g = buildLayered3DGraph(focusInput({ diagnosisScan: scan }))
    expect(g.focusMode).toBe(true)
    const topoIds = g.nodes.filter((n) => n.plane === 'topology').map((n) => n.id)
    expect(topoIds).toHaveLength(controllerModel().nodes.length)
    for (const node of controllerModel().nodes) expect(topoIds).toContain(node.id)
    expect(topoIds).toContain('disk-group-01')
  })

  it('诊断终态：图谱只显示命中子图（原始点∪关联点亮），非命中图谱节点隐藏', () => {
    const scan = controllerScan()
    const g = buildLayered3DGraph(focusInput({ diagnosisScan: scan }))
    const kgIds = g.nodes.filter((n) => n.plane === 'knowledge').map((n) => n.id)
    // 全部命中节点可见。
    for (const id of [...scan.graph_entry_anchors, ...scan.graph_lit_knowledge_ids]) {
      expect(kgIds).toContain(id)
    }
    // 非命中图谱节点（已排除候选的故障模式）隐藏。
    expect(kgIds).not.toContain('fm-fc-link-flap')
    expect(kgIds).not.toContain('fm-pool-bottleneck')
    // 命中子图全部落在已知命中集内（不显示未命中节点）。
    for (const id of kgIds) {
      expect(scan.graph_lit_knowledge_ids).toContain(id)
    }
  })

  it('诊断态：链路与命中子图连线无悬挂（两端都在可见节点内）', () => {
    const scan = controllerScan()
    const g = buildLayered3DGraph(focusInput({ diagnosisScan: scan }))
    expect(g.links.length).toBeGreaterThan(0)
    for (const link of g.links) {
      expect(g.nodesById.has(link.source as string)).toBe(true)
      expect(g.nodesById.has(link.target as string)).toBe(true)
    }
  })

  it('诊断推进：拓扑只显示完整排查路径（Planner targets ∪ 入口 ∪ 桥接，无关节点隐藏）', () => {
    let rt = createDiagnosisRuntime('controller_warm_reset_001')
    let guard = 0
    while (
      !rt.liveSnapshot.tasks.some(
        (t) => t.task_id === 'task-query-controller-alarm' && t.status === 'RUNNING',
      ) &&
      !rt.complete &&
      guard++ < 1000
    ) {
      rt = rt.advance()
    }
    const store = new ProjectionStore()
    store.bind(rt.liveSnapshot, {
      observationsFacts: loadAdaptedCase('controller_warm_reset_001').facts,
      knowledgeNodes: kgRefs,
      knowledgeLinks: kgLinkRefs,
      entryObjectRefs: ['db-business-01', 'lun-db01'],
    })
    const scan = store.diagnosisScan()
    const g = buildLayered3DGraph(focusInput({ diagnosisScan: scan }))
    const topoIds = g.nodes.filter((n) => n.plane === 'topology').map((n) => n.id)
    expect(scan.is_terminal).toBe(false)
    expect(g.nodes.filter((n) => n.plane === 'knowledge')).toHaveLength(0)
    expect(g.links.filter((l) => l.category === 'knowledge' || l.category === 'cross')).toHaveLength(0)
    // issue#16：全部 Planner 排查目标 + 入口业务对象可见。
    for (const id of scan.planner_path_ids) expect(topoIds).toContain(id)
    for (const id of scan.entry_object_refs) expect(topoIds).toContain(id)
    expect(topoIds).toContain('db-business-01')
    expect(topoIds).toContain('controller-0a')
    expect(topoIds).toContain('san-fabric-a') // BFS 桥接中间节点
    // 未排查也非桥接的拓扑节点（disk-group-01）不在排查路径上。
    expect(topoIds).not.toContain('disk-group-01')
  })

  it('issue#10 聚合展开复查：聚焦视图下展开层真实成员可见、聚合头隐藏（storage-pool/S3_4）', () => {
    // 诊断推进到 storage-pool-01（S3_4 成员，非关键对象）查询态。
    let rt = createDiagnosisRuntime('controller_warm_reset_001')
    let guard = 0
    while (
      !rt.liveSnapshot.tasks.some((t) => t.status === 'RUNNING' && (t.target_object_refs ?? []).includes('storage-pool-01')) &&
      !rt.complete &&
      guard++ < 2000
    ) {
      rt = rt.advance()
    }
    const store = new ProjectionStore()
    store.bind(rt.liveSnapshot, {
      observationsFacts: loadAdaptedCase('controller_warm_reset_001').facts,
      knowledgeNodes: kgRefs,
      knowledgeLinks: kgLinkRefs,
      entryObjectRefs: ['db-business-01', 'lun-db01'],
    })
    const scan = store.diagnosisScan()
    expect(scan.focus_object_id ?? scan.active_query_object_id).toBe('storage-pool-01')

    // 诊断态忽略浏览态折叠输入，始终全展开。
    const collapsed = buildLayered3DGraph(focusInput({ diagnosisScan: scan, expandedLayers: {} }))
    expect(collapsed.nodesById.has('storage-pool-01')).toBe(true)
    expect(collapsed.nodesById.has(layerAggregateId('S3'))).toBe(false)

    // 仅展开 S3 域（第一步）：成员仍收起 → 锚到 S3_4 子层聚合头。
    const domainOnly = buildLayered3DGraph(
      focusInput({ diagnosisScan: scan, expandedLayers: { S3: true } }),
    )
    expect(domainOnly.nodesById.has('storage-pool-01')).toBe(true)
    expect(domainOnly.nodesById.has(layerAggregateId('S3_4'))).toBe(false)

    // 自动展开 S3 域 + S3_4 子层（issue#8 展开逻辑）：成员在聚焦视图可见、子层聚合头隐藏。
    const expanded = buildLayered3DGraph(
      focusInput({ diagnosisScan: scan, expandedLayers: { S3: true, S3_4: true } }),
    )
    expect(expanded.nodesById.has('storage-pool-01')).toBe(true)
    expect(expanded.nodesById.has('lun-db01')).toBe(true)
    expect(expanded.nodesById.has(layerAggregateId('S3_4'))).toBe(false)
    // issue#16：非排查路径节点（disk-group-01）在诊断中隐藏。
    expect(expanded.nodesById.has('disk-group-01')).toBe(false)
  })
})
