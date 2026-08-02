// GitHub issue #4 分层拓扑模型纯函数测试：
// 层级分组 / 聚合摘要（复用 computeGroupSummary 口径）/ 展开收起 / 跨层连线。
// 只读 layered_topology_demo_001 Case 数据；不改 ontologies/case 文件。
import { describe, expect, it } from 'vitest'
import {
  TOPO_DOMAINS,
  TOPO_LAYERS,
  TOPO_SUB_LAYERS,
  buildLayeredActiveGraph,
  buildLayeredModelData,
  computeLayerSummary,
  isLayerAggregateId,
  layerAggregateId,
  resourceToLayer,
  type TopoLayerCode,
} from './layered-topology'
import { computeGroupSummary } from './model-loader'

const model = buildLayeredModelData('layered_topology_demo_001')

describe('层级定义（issue #4 已冻结）', () => {
  it('S1/S2/S3 域 + S1_1..S3_5 共 14 个层级', () => {
    expect(TOPO_DOMAINS.map((d) => d.code)).toEqual(['S1', 'S2', 'S3'])
    expect(TOPO_LAYERS.length).toBe(14)
    expect(TOPO_SUB_LAYERS.length).toBe(11)
  })

  it('每个子层有合法 resource_type 归属', () => {
    const typeToLayer = new Map<string, TopoLayerCode>()
    for (const layer of TOPO_SUB_LAYERS) {
      for (const rt of layer.resourceTypes) {
        expect(typeToLayer.has(rt)).toBe(false)
        typeToLayer.set(rt, layer.code)
      }
    }
    expect(typeToLayer.size).toBeGreaterThan(20)
  })
})

describe('resourceToLayer 映射', () => {
  it('已知类型映射到对应子层', () => {
    expect(resourceToLayer('BUSINESS_APP')).toBe('S1_1')
    expect(resourceToLayer('MOUNT_POINT')).toBe('S1_3')
    expect(resourceToLayer('HOST_INTERFACE')).toBe('S2_1')
    expect(resourceToLayer('NETWORK_FABRIC')).toBe('S2_2')
    expect(resourceToLayer('FC_PORT')).toBe('S3_1')
    expect(resourceToLayer('CACHE')).toBe('S3_2')
    expect(resourceToLayer('REPLICATION_SERVICE')).toBe('S3_3')
    expect(resourceToLayer('RAID')).toBe('S3_4')
    expect(resourceToLayer('BBU')).toBe('S3_5')
  })

  it('未知类型回退 S1 域', () => {
    expect(resourceToLayer('NOT_A_TYPE')).toBe('S1')
  })
})

describe('LayeredModelData 结构', () => {
  it('Case 资源全部成节点，且每层 3~8 个成员（验收约束）', () => {
    expect(model.nodes.length).toBeGreaterThanOrEqual(40)
    const byLayer = model.memberIdsByLayer
    for (const layer of TOPO_SUB_LAYERS) {
      const count = byLayer.get(layer.code)?.length ?? 0
      expect(count).toBeGreaterThanOrEqual(3)
      expect(count).toBeLessThanOrEqual(8)
    }
  })

  it('域层成员数 = 其子层成员数之和', () => {
    for (const domain of TOPO_DOMAINS) {
      const subSum = TOPO_SUB_LAYERS.filter((l) => l.domain === domain.code).reduce(
        (sum, l) => sum + (model.memberIdsByLayer.get(l.code)?.length ?? 0),
        0,
      )
      expect(model.memberIdsByLayer.get(domain.code)?.length).toBe(subSum)
    }
  })

  it('跨层连线存在且端点分属不同子层', () => {
    expect(model.crossLayerLinks.length).toBeGreaterThan(30)
    const layerOf = (id: string) => model.nodesById.get(id)?.group as TopoLayerCode
    for (const link of model.crossLayerLinks) {
      const a = layerOf(link.source as string)
      const b = layerOf(link.target as string)
      expect(a).toBeDefined()
      expect(b).toBeDefined()
      expect(a).not.toBe(b)
    }
  })

  it('所有连线端点均为已知节点（无悬挂边）', () => {
    for (const link of model.links) {
      expect(model.nodesById.has(link.source as string)).toBe(true)
      expect(model.nodesById.has(link.target as string)).toBe(true)
    }
  })
})

describe('computeLayerSummary（复用 computeGroupSummary 口径）', () => {
  it('与 computeGroupSummary 输出完全一致（设备/层级同口径）', () => {
    for (const layer of TOPO_SUB_LAYERS) {
      const memberIds = model.memberIdsByLayer.get(layer.code) ?? []
      const expected = computeGroupSummary(
        memberIds,
        layer.code,
        topoName(layer.code),
        model.nodesById,
      )
      const actual = computeLayerSummary(model, layer.code)
      expect(actual).toEqual(expected)
    }
  })

  it('S3_5 硬件层含 1 个异常（disk-01a FAULT）', () => {
    const summary = computeLayerSummary(model, 'S3_5')
    expect(summary.total).toBe(model.memberIdsByLayer.get('S3_5')!.length)
    expect(summary.anomaly).toBe(1)
    expect(summary.maxSeverity).toBe('CRITICAL')
  })

  it('S3_4 资源层含 3 个异常（WARNING 三件套）', () => {
    const summary = computeLayerSummary(model, 'S3_4')
    expect(summary.anomaly).toBe(3)
    expect(summary.maxSeverity).toBe('WARNING')
  })

  it('关键对象提升严重度（DETACHED 语义计入异常）', () => {
    const normalLayer = computeLayerSummary(model, 'S3_5', {
      criticalIds: new Set(['disk-01a']),
      candidateObjectIds: new Set(['disk-01a']),
    })
    expect(normalLayer.candidate).toBe(1)
    expect(normalLayer.maxSeverity).toBe('CRITICAL')
  })
})

describe('buildLayeredActiveGraph 展开/收起（DETACHED）', () => {
  const collapsed = () => {
    const empty: Record<TopoLayerCode, boolean> = {} as Record<TopoLayerCode, boolean>
    return empty
  }

  it('默认全收起：仅域聚合头 + DETACHED 关键对象，无普通成员', () => {
    const graph = buildLayeredActiveGraph(model, { expandedLayers: collapsed() })
    const aggIds = graph.nodes.filter((n) => isLayerAggregateId(n.id))
    expect(aggIds.map((n) => n.id)).toEqual(TOPO_DOMAINS.map((d) => layerAggregateId(d.code)))
    // 无普通成员节点（未指定关键对象时）。
    expect(graph.nodes.some((n) => !isLayerAggregateId(n.id))).toBe(false)
  })

  it('全收起 + 关键对象：关键成员 DETACHED 保留，其锚点指向自身', () => {
    const graph = buildLayeredActiveGraph(model, {
      expandedLayers: collapsed(),
      criticalObjectIds: new Set(['disk-01a', 'lun-backup-01']),
    })
    expect(graph.nodes.some((n) => n.id === 'disk-01a')).toBe(true)
    expect(graph.nodes.some((n) => n.id === 'lun-backup-01')).toBe(true)
    expect(graph.anchorByObjectId.get('disk-01a')).toBe('disk-01a')
    // 非关键成员锚定到域聚合头。
    expect(graph.anchorByObjectId.get('disk-01b')).toBe(layerAggregateId('S3'))
    expect(graph.anchorByObjectId.get('db-app-01')).toBe(layerAggregateId('S1'))
  })

  it('展开 S3 域：S3_1..S3_5 子层聚合头出现，S3 域聚合头仍保留', () => {
    const graph = buildLayeredActiveGraph(model, {
      expandedLayers: { S3: true } as Record<TopoLayerCode, boolean>,
    })
    const visible = new Set(graph.nodes.map((n) => n.id))
    expect(visible.has(layerAggregateId('S3'))).toBe(true)
    for (const sub of TOPO_SUB_LAYERS) {
      if (sub.domain === 'S3') expect(visible.has(layerAggregateId(sub.code))).toBe(true)
      if (sub.domain !== 'S3') expect(visible.has(layerAggregateId(sub.code))).toBe(false)
    }
    // 普通成员仍隐藏。
    expect(graph.nodes.some((n) => n.id === 'disk-01a')).toBe(false)
  })

  it('展开 S3 域 + S3_5 子层：S3_5 成员全部显露', () => {
    const graph = buildLayeredActiveGraph(model, {
      expandedLayers: { S3: true, S3_5: true } as Record<TopoLayerCode, boolean>,
    })
    const memberIds = model.memberIdsByLayer.get('S3_5')!
    for (const id of memberIds) {
      expect(graph.nodes.some((n) => n.id === id)).toBe(true)
    }
  })

  it('跨层连线在收起时锚定到聚合头，展开后连回成员', () => {
    const collapsedGraph = buildLayeredActiveGraph(model, {
      expandedLayers: { S3: true, S3_4: true, S3_5: true } as Record<TopoLayerCode, boolean>,
    })
    // 展开 S3_4/S3_5：e-pool-raid（pool-01a→raid-01a）应连接两个成员。
    const memberLink = collapsedGraph.links.find((l) => l.id === 'e-pool-raid')
    expect(memberLink).toBeDefined()
    expect(memberLink!.source).toBe('pool-01a')
    expect(memberLink!.target).toBe('raid-01a')

    // S1 收起时：e-backup-app-bs（backup-app-01→bs-backup-01）两端锚定到 S1 聚合头。
    const collapsedGraph2 = buildLayeredActiveGraph(model, { expandedLayers: collapsed() })
    const aggLink = collapsedGraph2.links.find((l) => l.id === 'e-backup-app-bs')
    expect(aggLink).toBeDefined()
    expect(aggLink!.source).toBe(layerAggregateId('S1'))
    expect(aggLink!.target).toBe(layerAggregateId('S1'))
  })

  it('summaries 覆盖全部可见层', () => {
    const graph = buildLayeredActiveGraph(model, {
      expandedLayers: { S1: true, S2: true, S3: true, S1_1: true } as Record<TopoLayerCode, boolean>,
    })
    const aggNodes = graph.nodes.filter((n) => isLayerAggregateId(n.id))
    for (const node of aggNodes) {
      const layerCode = node.id.replace('layer:', '') as TopoLayerCode
      expect(graph.summaries.get(layerCode)).toBeDefined()
    }
    expect(graph.summaries.get('S1')!.total).toBe(model.memberIdsByLayer.get('S1')!.length)
  })
})

function topoName(code: TopoLayerCode): string {
  return TOPO_LAYERS.find((l) => l.code === code)?.name ?? code
}
