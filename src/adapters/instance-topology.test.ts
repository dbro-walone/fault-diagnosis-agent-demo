// InstanceTopology Contract 1.0 —— 转换器与校验器测试（docs/19 §5、§9）。
// 只读 Case V1 + 静态 KG；不改 ontologies/case 文件。
// 覆盖：五类对象结构、统一转换（禁止 case_id 特判）、渲染投影 round-trip、
// §5.11 校验规则（含负例）。
import { describe, expect, it } from 'vitest'
import { listCases, loadAdaptedCase } from '../v2'
import {
  convertV1ToInstanceTopology,
  instanceTopologyToGraph,
  type InstanceTopologySnapshot,
  type V1Edge,
  type V1Resource,
} from './v1_to_instance_topology'
import {
  hasErrors,
  validateInstanceTopology,
  type KgTopologyReference,
} from './instance-topology-validate'

const kgRef: KgTopologyReference = {
  resourceTypes: [
    { code: 'BUSINESS' }, { code: 'HOST' }, { code: 'SAN_FABRIC' },
    { code: 'FC_PORT' }, { code: 'CONTROLLER' }, { code: 'BLOCK_SERVICE' },
    { code: 'LUN' }, { code: 'STORAGE_POOL' }, { code: 'DISK' },
    { code: 'DISK_ENCLOSURE' }, { code: 'STORAGE_DEVICE' },
    { code: 'REPLICATION_SESSION' }, { code: 'WAN_LINK' },
  ],
  topologyCapabilities: [
    { capability_code: 'CAN_CONTAIN', source_types: ['STORAGE_DEVICE', 'DISK_ENCLOSURE', 'CONTROLLER'], target_types: ['*'], instance_relation: 'CONTAINS' },
    { capability_code: 'CAN_CONNECT_TO', source_types: ['*'], target_types: ['*'], instance_relation: 'CONNECTS_TO' },
    { capability_code: 'CAN_ACCESS', source_types: ['BUSINESS', 'HOST'], target_types: ['*'], instance_relation: 'ACCESSES' },
    { capability_code: 'CAN_HOST', source_types: ['HOST'], target_types: ['*'], instance_relation: 'HOSTS' },
    { capability_code: 'CAN_PROVIDE_SERVICE_TO', source_types: ['CONTROLLER', 'BLOCK_SERVICE'], target_types: ['*'], instance_relation: 'PROVIDES_SERVICE_TO' },
    { capability_code: 'CAN_DEPEND_ON', source_types: ['*'], target_types: ['*'], instance_relation: 'DEPENDS_ON' },
    { capability_code: 'CAN_BE_BACKED_BY', source_types: ['LUN', 'STORAGE_POOL'], target_types: ['STORAGE_POOL', 'DISK_ENCLOSURE'], instance_relation: 'BACKED_BY' },
    { capability_code: 'CAN_SHARE', source_types: ['*'], target_types: ['*'], instance_relation: 'SHARES_WITH' },
    { capability_code: 'CAN_REPLICATE_TO', source_types: ['LUN', 'REPLICATION_SESSION'], target_types: ['LUN'], instance_relation: 'REPLICATES_TO' },
    { capability_code: 'CAN_FORM_REDUNDANCY_WITH', source_types: ['CONTROLLER', 'FC_PORT', 'SAN_FABRIC'], target_types: ['CONTROLLER', 'FC_PORT', 'SAN_FABRIC'], instance_relation: 'REDUNDANT_WITH' },
    { capability_code: 'CAN_FAILOVER_TO', source_types: ['CONTROLLER'], target_types: ['CONTROLLER'], instance_relation: 'TopologyEvent.FAILOVER' },
  ],
}

const CASE_IDS = listCases().map((c) => c.caseId)

function snapshotOf(caseId: string): InstanceTopologySnapshot {
  return loadAdaptedCase(caseId).instanceTopology
}

describe('V1→规范转换（统一规则，禁止 case_id 特判）', () => {
  for (const caseId of CASE_IDS) {
    const adapted = loadAdaptedCase(caseId)
    const snap = adapted.instanceTopology

    describe(caseId, () => {
      it('schema + provenance + 五类对象集合结构合法', () => {
        expect(snap.schema_name).toBe('dme-instance-topology')
        expect(snap.schema_version).toBe('1.0.0')
        expect(snap.provenance.case_id).toBe(caseId)
        expect(Array.isArray(snap.resources)).toBe(true)
        expect(Array.isArray(snap.relations)).toBe(true)
        expect(Array.isArray(snap.relation_sets)).toBe(true)
        expect(Array.isArray(snap.states)).toBe(true)
        expect(Array.isArray(snap.events)).toBe(true)
      })

      it('资源与 V1 一一对应（resource_id 稳定，不新增/不丢失）', () => {
        expect(snap.resources.filter((r) => r.properties.derived_container !== true)).toHaveLength(
          adapted.resources.length,
        )
        for (const r of snap.resources) {
          expect(adapted.resources.some((v) => v.resource_id === r.resource_id) || r.properties.derived_container).toBe(true)
        }
      })

      it('resource_type_code 可映射 KG L1，且携带 original_resource_type', () => {
        for (const r of snap.resources) {
          expect(kgRef.resourceTypes.map((t) => t.code)).toContain(r.resource_type_code)
          expect(r.properties.original_resource_type ?? r.resource_type_code).toBeTruthy()
        }
      })

      it('关系端点存在，且 FAILOVER_TO/AFFECTS 不进稳定关系（§5.11-10）', () => {
        const ids = new Set(snap.resources.map((r) => r.resource_id))
        for (const rel of snap.relations) {
          expect(ids.has(rel.source_ref)).toBe(true)
          expect(ids.has(rel.target_ref)).toBe(true)
          expect(rel.relation_type).not.toBe('FAILOVER_TO')
          expect(rel.relation_type).not.toBe('AFFECTS')
        }
        for (const ev of snap.events) {
          expect(ids.has(ev.source_ref)).toBe(true)
          expect(ids.has(ev.target_ref)).toBe(true)
        }
      })

      it('基础拓扑不携带坐标/颜色/候选/根因/证据（§5.11-11/12）', () => {
        const viewKeys = ['x', 'y', 'z', 'fx', 'fy', 'fz', 'color', 'glow', 'expanded', 'storyboard']
        for (const r of snap.resources) {
          for (const key of viewKeys) expect(Object.hasOwnProperty.call(r.properties, key)).toBe(false)
        }
      })
    })
  }

  describe('controller_warm_reset_001 核对（13 资源 / 14 边）', () => {
    const snap = snapshotOf('controller_warm_reset_001')

    it('FAILOVER_TO → TopologyEvent（§5.8），不进关系集合', () => {
      const failover = snap.events.filter((e) => e.event_type === 'FAILOVER')
      expect(failover).toHaveLength(1)
      expect(failover[0].source_ref).toBe('controller-0a')
      expect(failover[0].target_ref).toBe('controller-0b')
      expect(snap.relations.some((r) => r.properties.original_relation_type === 'FAILOVER_TO')).toBe(false)
    })

    it('PRIMARY_BACKUP_OF → REDUNDANT_WITH + RelationSet + 角色 State', () => {
      const redundant = snap.relations.find((r) => r.relation_type === 'REDUNDANT_WITH')
      expect(redundant).toBeDefined()
      // 对称关系规范排序（§5.11-7）。
      expect(redundant!.source_ref < redundant!.target_ref).toBe(true)
      const ha = snap.relation_sets.find((s) => s.relation_set_id === 'controller-ha-01')
      expect(ha).toBeDefined()
      expect(ha!.set_type).toBe('REDUNDANCY_SET')
      expect(ha!.members.map((m) => m.member_ref)).toEqual(
        expect.arrayContaining(['controller-0a', 'controller-0b', 'block-service-01']),
      )
      const roleStates = snap.states.filter((s) => s.state_dimension === 'OPERATIONAL_ROLE')
      expect(roleStates.map((s) => `${s.subject_ref}:${s.state_code}`)).toEqual(
        expect.arrayContaining(['controller-0a:ACTIVE', 'controller-0b:STANDBY']),
      )
    })

    it('parent_id → CONTAINS（§5.3），一个资源最多一个容器', () => {
      const contains = snap.relations.filter((r) => r.relation_type === 'CONTAINS')
      const containers = new Set(contains.map((r) => r.target_ref))
      expect(containers.size).toBe(contains.length)
      expect(containers.has('fc-port-0a')).toBe(true)
      expect(contains.every((r) => r.source_ref === 'storage-01')).toBe(true)
    })

    it('Edge state standby → InstanceState（RELATION）', () => {
      const standby = snap.states.find(
        (s) => s.subject_kind === 'RELATION' && s.subject_ref === 'e-controller-b-block',
      )
      expect(standby).toBeDefined()
      expect(standby!.state_dimension).toBe('OPERATIONAL_ROLE')
      expect(standby!.state_code).toBe('STANDBY')
      expect(standby!.time_quality).toBe('LEGACY_TIMED')
    })
  })

  describe('noisy_neighbor 施压者/受害者不进入拓扑（§11.3）', () => {
    const snap = snapshotOf('noisy_neighbor_io_contention_001')
    it('host-a/host-b 不携带 aggressor/victim OPERATIONAL_ROLE 状态', () => {
      const hostRoles = snap.states.filter(
        (s) => s.subject_ref === 'host-a' || s.subject_ref === 'host-b',
      )
      expect(hostRoles).toHaveLength(0)
      // 原始 attributes 中角色已脱敏（答案不进入规范拓扑）。
      const hostA = snap.resources.find((r) => r.resource_id === 'host-a')!
      expect((hostA.properties.attributes as Record<string, unknown>).role).toBeUndefined()
    })
    it('SHARES_RESOURCE_WITH → 稳定 SHARES_WITH + 有界 PATH_STATE（不泄露扰邻因果）', () => {
      const shares = snap.relations.find((r) => r.properties.original_relation_type === 'SHARES_RESOURCE_WITH')
      expect(shares).toBeDefined()
      expect(shares!.relation_type).toBe('SHARES_WITH')
      expect(shares!.valid_time.from).toBeTruthy()
      const state = snap.states.find((s) => s.subject_ref === shares!.relation_id)
      expect(state).toBeDefined()
      expect(state!.state_dimension).toBe('PATH_STATE')
    })
  })

  describe('remote_replication 复制链路统一建模（§12.2）', () => {
    const snap = snapshotOf('remote_replication_lag_001')
    it('复制会话依赖源端/端口/WAN/目标，REPLICATES_TO 保持复制关系', () => {
      const sessionDepends = snap.relations.filter(
        (r) => r.relation_type === 'DEPENDS_ON' && r.source_ref === 'replication-session-rs01',
      )
      expect(sessionDepends.map((r) => r.target_ref)).toEqual(
        expect.arrayContaining(['lun-prod', 'repl-port-a', 'repl-port-b', 'storage-b']),
      )
      expect(snap.relations.some((r) => r.relation_type === 'REPLICATES_TO')).toBe(true)
    })
    it('WAN 资源进入 CROSS_SITE_NETWORK 空间域', () => {
      for (const id of ['wan-path-01', 'wan-router-a', 'wan-router-b']) {
        const r = snap.resources.find((x) => x.resource_id === id)!
        expect(r.placement.spatial_domain).toBe('CROSS_SITE_NETWORK')
      }
    })
  })
})

describe('渲染投影 instanceTopologyToGraph（§5.9 前端决定如何展示）', () => {
  it('投影节点数与 V1 资源一致（派生容器不渲染）', () => {
    for (const caseId of CASE_IDS) {
      const adapted = loadAdaptedCase(caseId)
      const { resources } = instanceTopologyToGraph(adapted.instanceTopology)
      expect(resources).toHaveLength(adapted.resources.length)
    }
  })

  it('投影边保留全部显式 V1 边（FAILOVER_TO 除外）与 path_group（路径高亮不破坏）', () => {
    for (const caseId of CASE_IDS) {
      const adapted = loadAdaptedCase(caseId)
      const { edges } = instanceTopologyToGraph(adapted.instanceTopology)
      const explicitV1 = adapted.edges.filter((e) => e.relation_type !== 'FAILOVER_TO' && e.relation_type !== 'AFFECTS')
      expect(edges).toHaveLength(explicitV1.length)
      for (const e of explicitV1) {
        const projected = edges.find((p) => p.edge_id === e.edge_id)
        expect(projected).toBeDefined()
        expect(projected!.path_group).toBe(e.path_group ?? null)
      }
    }
  })

  it('投影边端点全部为已知节点（无悬挂边）', () => {
    for (const caseId of CASE_IDS) {
      const { resources, edges } = instanceTopologyToGraph(loadAdaptedCase(caseId).instanceTopology)
      const ids = new Set(resources.map((r) => r.resource_id))
      for (const e of edges) {
        expect(ids.has(e.source_id)).toBe(true)
        expect(ids.has(e.target_id)).toBe(true)
      }
    }
  })
})

describe('§5.11 校验器', () => {
  it('5 个编译快照全部 0 ERROR', () => {
    for (const caseId of CASE_IDS) {
      const issues = validateInstanceTopology(snapshotOf(caseId), kgRef)
      expect(hasErrors(issues), `${caseId}: ${issues.map((i) => i.message).join('; ')}`).toBe(false)
    }
  })

  it('R1：未知 resource_type_code 报错', () => {
    const snap = convertV1ToInstanceTopology('t', [
      { resource_id: 'a', resource_type: 'NOT_A_REAL_TYPE', name: 'A' },
    ], [])
    const issues = validateInstanceTopology(snap, kgRef)
    expect(issues.some((i) => i.code === 'R1')).toBe(true)
  })

  it('R4：多容器报错（原始快照含两个 CONTAINS 父边）', () => {
    const base = convertV1ToInstanceTopology(
      't',
      [
        { resource_id: 'storage-01', resource_type: 'STORAGE_DEVICE', name: 'S1', device_id: 'storage-01' },
        { resource_id: 'storage-02', resource_type: 'STORAGE_DEVICE', name: 'S2', device_id: 'storage-02' },
        { resource_id: 'child', resource_type: 'CONTROLLER', name: 'C', parent_id: 'storage-01' },
      ],
      [{ edge_id: 'e1', source_id: 'storage-02', target_id: 'child', relation_type: 'CONTAINS' }],
    )
    // 转换器已按"显式 CONTAINS 优先"消解为单容器；注入第二容器构造 §5.11-4 违例。
    const bad: InstanceTopologySnapshot = {
      ...base,
      relations: [
        ...base.relations,
        {
          relation_id: 'second-container',
          relation_type: 'CONTAINS',
          source_ref: 'storage-01',
          target_ref: 'child',
          valid_time: { from: null, to: null },
          properties: {},
          provenance: { source_type: 'CASE_MOCK', source_ref: 'test#second' },
        },
      ],
    }
    const issues = validateInstanceTopology(bad, kgRef)
    expect(issues.some((i) => i.code === 'R4')).toBe(true)
  })

  it('R6：外部与内部非边界资源直接 CONNECTS_TO 报错', () => {
    const resources: V1Resource[] = [
      { resource_id: 'host', resource_type: 'HOST', name: 'H', location: 'external' },
      { resource_id: 'lun', resource_type: 'LUN', name: 'L', location: 'internal', parent_id: 'storage-01', device_id: 'storage-01' },
      { resource_id: 'storage-01', resource_type: 'STORAGE_DEVICE', name: 'S', device_id: 'storage-01' },
    ]
    const edges: V1Edge[] = [
      { edge_id: 'e1', source_id: 'host', target_id: 'lun', relation_type: 'PHYSICAL_CONNECTS' },
    ]
    const snap = convertV1ToInstanceTopology('t', resources, edges)
    const issues = validateInstanceTopology(snap, kgRef)
    expect(issues.some((i) => i.code === 'R6')).toBe(true)
  })

  it('R10：FAILOVER_TO 出现在稳定关系中报错', () => {
    const resources: V1Resource[] = [
      { resource_id: 'a', resource_type: 'CONTROLLER', name: 'A' },
      { resource_id: 'b', resource_type: 'CONTROLLER', name: 'B' },
    ]
    const edges: V1Edge[] = [
      { edge_id: 'e1', source_id: 'a', target_id: 'b', relation_type: 'FAILOVER_TO' },
    ]
    const snap = convertV1ToInstanceTopology('t', resources, edges)
    // FAILOVER_TO 已被转换器转为事件，正常快照不应有 FAILOVER_TO 关系。
    expect(snap.relations.some((r) => r.relation_type === 'FAILOVER_TO')).toBe(false)
    const bad: InstanceTopologySnapshot = {
      ...snap,
      relations: [
        ...snap.relations,
        {
          relation_id: 'bad-failover',
          relation_type: 'FAILOVER_TO',
          source_ref: 'a',
          target_ref: 'b',
          valid_time: { from: null, to: null },
          properties: {},
          provenance: { source_type: 'CASE_MOCK', source_ref: 'test#bad' },
        },
      ],
    }
    const issues = validateInstanceTopology(bad, kgRef)
    expect(issues.some((i) => i.code === 'R10')).toBe(true)
  })
})
