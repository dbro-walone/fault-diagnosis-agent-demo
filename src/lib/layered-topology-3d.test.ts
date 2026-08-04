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
