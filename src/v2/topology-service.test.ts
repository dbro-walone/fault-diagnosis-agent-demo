// Topology Service 测试（docs/19 §16.2 / §5.10）—— 规范 InstanceTopology 查询。
// 只读 Case 数据；禁止 case_id 特判；路径是查询产物，不进入稳定关系集合。
import { describe, expect, it } from 'vitest'
import { listCases, loadAdaptedCase } from './index'
import {
  createTopologyService,
  find_paths,
  find_shared_resources,
  expand_by_relation,
  query_topology,
  query_topology_events,
} from './topology-service'
import type { InstanceTopologySnapshot } from '../adapters/v1_to_instance_topology'

const snapOf = (caseId: string): InstanceTopologySnapshot => loadAdaptedCase(caseId).instanceTopology

describe('Topology Service —— find_paths（§5.9 查询产物）', () => {
  it('控制器：db-host-01 → storage-01 存在最短路径（经 SAN/控制器）', () => {
    const paths = find_paths(snapOf('controller_warm_reset_001'), 'db-host-01', 'storage-01', { limit: 3 })
    expect(paths.length).toBeGreaterThan(0)
    for (const p of paths) {
      expect(p.source_ref).toBe('db-host-01')
      expect(p.target_ref).toBe('storage-01')
      expect(p.hops.length).toBeGreaterThanOrEqual(1)
      // 路径连续：相邻跳共享至少一个端点（支持双向遍历）。
      for (let i = 1; i < p.hops.length; i++) {
        const prev = p.hops[i - 1]
        const cur = p.hops[i]
        const shared = [prev.source_ref, prev.target_ref].filter(
          (n) => n === cur.source_ref || n === cur.target_ref,
        )
        expect(shared.length).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('same-node 返回零跳路径', () => {
    const paths = find_paths(snapOf('controller_warm_reset_001'), 'storage-01', 'storage-01')
    expect(paths).toHaveLength(1)
    expect(paths[0].length).toBe(0)
  })

  it('悬空端点抛 IT-REF-001（§17.2 禁止静默）', () => {
    expect(() => find_paths(snapOf('controller_warm_reset_001'), 'does-not-exist', 'storage-01'))
      .toThrow(/IT-REF-001/)
  })

  it('relation_types 过滤：REDUNDANT_WITH 直接命中双控', () => {
    const paths = find_paths(snapOf('controller_warm_reset_001'), 'controller-0a', 'controller-0b', {
      relation_types: ['REDUNDANT_WITH'],
    })
    expect(paths.length).toBeGreaterThan(0)
    expect(paths[0].hops.every((h) => h.relation_type === 'REDUNDANT_WITH')).toBe(true)
  })
})

describe('Topology Service —— find_shared_resources（§11.3 反向追溯）', () => {
  it('扰邻：host-a / host-b 共享存储池与 SAN', () => {
    const shared = find_shared_resources(snapOf('noisy_neighbor_io_contention_001'), ['host-a', 'host-b'], { max_depth: 3 })
    const ids = shared.map((s) => s.resource.resource_id)
    expect(ids).toContain('storage-pool-01') // 两个 LUN 都 BACKED_BY 同一池
    expect(ids).toContain('san-fabric-01') // 两个 Host 都 ACCESSES 同一 SAN
    for (const s of shared) {
      for (const consumer of ['host-a', 'host-b']) {
        expect(s.paths[consumer]).toBeDefined()
        expect(s.paths[consumer].target_ref).toBe(s.resource.resource_id)
      }
    }
  })

  it('单消费者返回自身可达集（不含消费者自身）', () => {
    const shared = find_shared_resources(snapOf('controller_warm_reset_001'), ['controller-0a'], { max_depth: 2 })
    const ids = shared.map((s) => s.resource.resource_id)
    expect(ids).not.toContain('controller-0a')
    expect(ids.length).toBeGreaterThan(0)
  })
})

describe('Topology Service —— expand_by_relation / query_topology', () => {
  it('expand 以控制器为锚展开一跳邻居', () => {
    const { resources, relations } = expand_by_relation(snapOf('controller_warm_reset_001'), ['controller-0a'], undefined, 1)
    const ids = resources.map((r) => r.resource_id)
    expect(ids).toContain('controller-0a')
    expect(ids).toContain('fc-port-0a') // DEPENDS_ON 方向
    expect(ids).toContain('block-service-01') // PROVIDES_SERVICE_TO 方向
    expect(relations.length).toBeGreaterThan(0)
  })

  it('query_topology 返回 resources + relations + discovery_delta', () => {
    const result = query_topology({
      topology: snapOf('controller_warm_reset_001'),
      anchor_resource_ids: ['block-service-01'],
      max_depth: 2,
    })
    expect(result.resources.map((r) => r.resource_id)).toContain('lun-db01')
    expect(result.discovery_delta.resources.length).toBeGreaterThan(0)
    expect(result.discovery_delta.resources).not.toContain('block-service-01')
  })

  it('spatial_domains 过滤', () => {
    const result = query_topology({
      topology: snapOf('remote_replication_lag_001'),
      anchor_resource_ids: ['replication-session-rs01'],
      max_depth: 1,
      spatial_domains: ['CROSS_SITE_NETWORK'],
    })
    expect(result.resources.length).toBeGreaterThan(0)
    for (const r of result.resources) expect(r.placement.spatial_domain).toBe('CROSS_SITE_NETWORK')
  })
})

describe('Topology Service —— query_topology_events', () => {
  it('控制器 FAILOVER 事件可查询', () => {
    const events = query_topology_events({
      topology: snapOf('controller_warm_reset_001'),
      resource_refs: ['controller-0a', 'controller-0b'],
    })
    expect(events.some((e) => e.event_type === 'FAILOVER')).toBe(true)
  })

  it('event_types 过滤', () => {
    const events = query_topology_events({
      topology: snapOf('controller_warm_reset_001'),
      resource_refs: ['controller-0a', 'controller-0b'],
      event_types: ['FAILOVER'],
    })
    expect(events.every((e) => e.event_type === 'FAILOVER')).toBe(true)
  })
})

describe('Topology Service —— createTopologyService（§16.2 服务对象）', () => {
  it('服务对象提供五类查询入口', () => {
    const service = createTopologyService(snapOf('controller_warm_reset_001'))
    expect(service.find_paths('controller-0a', 'controller-0b').length).toBeGreaterThan(0)
    expect(service.query_topology({ anchor_resource_ids: ['controller-0a'] }).resources.length).toBeGreaterThan(0)
    expect(service.query_topology_events({ resource_refs: ['controller-0a', 'controller-0b'] }).length).toBe(1)
    expect(service.expand_by_relation(['controller-0a']).resources.length).toBeGreaterThan(0)
    // 共享资源查询使用扰邻快照（host-a/host-b 与 controller 快照无关）。
    const neighborService = createTopologyService(snapOf('noisy_neighbor_io_contention_001'))
    expect(neighborService.find_shared_resources(['host-a', 'host-b'], { max_depth: 3 }).length).toBeGreaterThan(0)
  })

  it('对全部 Case 都可创建服务（统一路径，无 case_id 特判）', () => {
    for (const c of listCases()) {
      const service = createTopologyService(snapOf(c.caseId))
      expect(() => service.query_topology({ anchor_resource_ids: [], max_depth: 1 })).not.toThrow()
    }
  })
})
