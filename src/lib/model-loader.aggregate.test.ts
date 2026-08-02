// D3 设备级聚合摘要（docs/05 §5）纯函数测试：computeAggregateSummary / healthSeverity
// + buildActiveGraph 的展开/收起/关键子项拆出（BA-GRAPH-009/010/011）。
// 只读 model 静态分组 + 可选运行时上下文；不改 ontologies/case 数据。
import { describe, expect, it } from 'vitest'
import {
  buildActiveGraph,
  computeAggregateSummary,
  healthSeverity,
  loadModelData,
  type GraphFilter,
} from './model-loader'
import { LensId } from '../../schemas'

describe('healthSeverity', () => {
  it('maps FAULT/ABNORMAL → CRITICAL, WARNING → WARNING, else NORMAL', () => {
    expect(healthSeverity('FAULT')).toBe('CRITICAL')
    expect(healthSeverity('ABNORMAL')).toBe('CRITICAL')
    expect(healthSeverity('WARNING')).toBe('WARNING')
    expect(healthSeverity('NORMAL')).toBe('NORMAL')
    expect(healthSeverity(undefined)).toBe('NORMAL')
    expect(healthSeverity('')).toBe('NORMAL')
  })
})

describe('computeAggregateSummary', () => {
  const model = loadModelData()

  it('aggregate node is present with its members (storage-01)', () => {
    const group = model.deviceGroups.find((g) => g.deviceId === 'storage-01')
    expect(group).toBeDefined()
    expect(group!.memberIds.length).toBeGreaterThan(0)
    // 成员不应包含设备自身（buildDeviceGroups 排除 deviceId === id）。
    expect(group!.memberIds).not.toContain('storage-01')
  })

  it('returns null for a non-aggregate device id', () => {
    expect(computeAggregateSummary(model, 'not-a-device')).toBeNull()
  })

  it('reports total members, zero anomaly/candidate at baseline (all NORMAL health)', () => {
    const summary = computeAggregateSummary(model, 'storage-01')
    expect(summary).not.toBeNull()
    expect(summary!.total).toBeGreaterThan(0)
    expect(summary!.anomaly).toBe(0)
    expect(summary!.candidate).toBe(0)
    expect(summary!.maxSeverity).toBe('NORMAL')
    // total 必须与分组成员数一致。
    const group = model.deviceGroups.find((g) => g.deviceId === 'storage-01')!
    expect(summary!.total).toBe(group.memberIds.length)
  })

  it('counts critical/runtime objects as anomaly and lifts max severity (BA-GRAPH-011)', () => {
    const group = model.deviceGroups.find((g) => g.deviceId === 'storage-01')!
    const criticalMember = group.memberIds[0]
    const summary = computeAggregateSummary(model, 'storage-01', {
      criticalIds: new Set([criticalMember]),
    })
    expect(summary!.anomaly).toBe(1)
    expect(summary!.maxSeverity).toBe('CRITICAL')
  })

  it('counts candidate targets and impacted objects', () => {
    const group = model.deviceGroups.find((g) => g.deviceId === 'storage-01')!
    const [memberA, memberB] = [group.memberIds[0], group.memberIds[1]]
    const summary = computeAggregateSummary(model, 'storage-01', {
      candidateObjectIds: new Set([memberA]),
      impactedIds: new Set([memberB]),
    })
    expect(summary!.candidate).toBe(1)
    expect(summary!.anomaly).toBeGreaterThanOrEqual(1)
    expect(summary!.maxSeverity).toBe('WARNING')
  })
})

describe('buildActiveGraph 设备级聚合（BA-GRAPH-009/010/011）', () => {
  const model = loadModelData()
  const baseFilter: GraphFilter = {
    lens: LensId.TOPOLOGY,
    overlay: undefined,
    layerTopology: true,
    layerKnowledge: true,
    visibleDomains: Object.fromEntries(model.domains.map((d) => [d.code, true])),
    visibleKgLayers: Object.fromEntries(model.kgLayers.map((l) => [l.code, true])),
    showCrossLayer: false,
  }

  it('收起设备时隐藏其成员，但设备聚合节点本身保留（BA-GRAPH-010）', () => {
    const graph = buildActiveGraph(model, baseFilter)
    const group = model.deviceGroups.find((g) => g.deviceId === 'storage-01')!
    // 聚合节点（storage-01）仍在图中。
    expect(graph.nodes.some((n) => n.id === 'storage-01')).toBe(true)
    // 任一成员都不应出现（未展开、非关键）。
    expect(graph.nodes.some((n) => group.memberIds.includes(n.id))).toBe(false)
  })

  it('展开设备时成员全部显露（BA-GRAPH-009），固定位置布局由 fx/fy/fz 保证（BA-GRAPH-010）', () => {
    const graph = buildActiveGraph(model, {
      ...baseFilter,
      expandedDeviceIds: new Set(['storage-01']),
    })
    const group = model.deviceGroups.find((g) => g.deviceId === 'storage-01')!
    for (const memberId of group.memberIds) {
      const node = graph.nodes.find((n) => n.id === memberId)
      expect(node).toBeDefined()
      expect(typeof node!.fx).toBe('number')
      expect(typeof node!.fy).toBe('number')
      expect(typeof node!.fz).toBe('number')
    }
  })

  it('收起含关键对象的父组时，关键子项以 DETACHED_CRITICAL 拆出保留（BA-GRAPH-011）', () => {
    const group = model.deviceGroups.find((g) => g.deviceId === 'storage-01')!
    const criticalMember = group.memberIds[0]
    const graph = buildActiveGraph(model, {
      ...baseFilter,
      criticalObjectIds: new Set([criticalMember]),
    })
    // 关键子项仍显示（agent_focus/根因不被隐藏）。
    expect(graph.nodes.some((n) => n.id === criticalMember)).toBe(true)
    // 非关键成员仍被隐藏。
    const otherVisible = group.memberIds.some(
      (id) => id !== criticalMember && graph.nodes.some((n) => n.id === id),
    )
    expect(otherVisible).toBe(false)
  })
})
