/**
 * V1 → InstanceTopology Contract 1.0 转换器（docs/19 §5、§9、附录A）。
 *
 * 规范模型（§5.1 五类对象）：
 *   ResourceInstance / TopologyRelation / RelationSet / InstanceState / TopologyEvent，
 *   统一收进 InstanceTopologySnapshot（§5.2）。
 *
 * 设计原则（与阶段1 KnowledgeGraphPackage 3.0.0 一致）：
 * - 新增规范数据源 + 转换器，不修改 Case V1 文件；
 * - 全部映射为统一规则表，禁止 `if (case_id === ...)` 特判；
 * - resource_id / relation_id（沿用 V1 edge_id）保持稳定；
 * - 资源归属统一用 CONTAINS（§5.3），parent_id 只作容器来源；
 * - FAILOVER_TO 转 TopologyEvent、AFFECTS 不进拓扑（§5.8、§9.4）；
 * - path_group 只作查询预期 / View Hint（§5.9、§9.4）；
 * - 下游渲染通过 instanceTopologyToGraph 投影读取规范快照（§5.9 "前端决定如何展示"）。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 冻结注册表（docs/19 §5.4）
// ─────────────────────────────────────────────────────────────────────────────

export const INSTANCE_TOPOLOGY_SCHEMA_NAME = 'dme-instance-topology' as const
export const INSTANCE_TOPOLOGY_SCHEMA_VERSION = '1.0.0' as const

/** 冻结 8 个空间域。 */
export const SPATIAL_DOMAINS = [
  'ENVIRONMENT',
  'SITE',
  'DEVICE_EXTERNAL',
  'STORAGE_CLUSTER',
  'DEVICE_BOUNDARY',
  'DEVICE_INTERNAL',
  'CROSS_SITE_NETWORK',
  'UNRESOLVED',
] as const
export type SpatialDomain = (typeof SPATIAL_DOMAINS)[number]

/** 冻结分层码（§5.4）：S1_1/S1_2/S2/S3_1~S3_5。 */
export const DOC_LAYER_CODES = [
  'S1_1',
  'S1_2',
  'S2',
  'S3_1',
  'S3_2',
  'S3_3',
  'S3_4',
  'S3_5',
] as const
export type DocLayerCode = (typeof DOC_LAYER_CODES)[number]

/** 规范关系注册表（§5.5）中的对称关系 —— 按 resource_id 排序后只保存一次。 */
export const SYMMETRIC_RELATIONS: ReadonlySet<string> = new Set([
  'CONNECTS_TO',
  'SHARES_WITH',
  'REDUNDANT_WITH',
])

/** RelationSet 冻结 set_type（§5.6）。 */
export const RELATION_SET_TYPES = ['REDUNDANCY_SET', 'MULTIPATH_SET'] as const
export type RelationSetType = (typeof RELATION_SET_TYPES)[number]

/** InstanceState 冻结状态维度（§5.7）。 */
export const STATE_DIMENSIONS = [
  'HEALTH',
  'AVAILABILITY',
  'OPERATIONAL_ROLE',
  'LINK_STATE',
  'SERVICE_STATE',
  'PATH_STATE',
] as const
export type StateDimension = (typeof STATE_DIMENSIONS)[number]

// ─────────────────────────────────────────────────────────────────────────────
// 统一映射表（V1 → 规范；禁止 case_id 特判）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * V1 resource_type → KG L1 resource_type_code（§9.3）。V1 细粒度类型映射到
 * KG L1 可用的最近祖先码（如 BUSINESS_SERVICE→BUSINESS、CACHE→CONTROLLER）；
 * 原始细粒度类型保留在 ResourceInstance.properties.original_resource_type。
 */
export const V1_RESOURCE_TYPE_MAP: Readonly<Record<string, string>> = {
  BUSINESS: 'BUSINESS',
  BUSINESS_APP: 'BUSINESS',
  BUSINESS_SERVICE: 'BUSINESS',
  HOST: 'HOST',
  STORAGE_CLIENT: 'HOST',
  CLIENT_OS: 'HOST',
  MOUNT_POINT: 'HOST',
  HOST_INTERFACE: 'HOST',
  SAN_FABRIC: 'SAN_FABRIC',
  NETWORK_FABRIC: 'SAN_FABRIC',
  NETWORK_DEVICE: 'SAN_FABRIC',
  NETWORK_PATH: 'SAN_FABRIC',
  ACCESS_LINK: 'SAN_FABRIC',
  FC_PORT: 'FC_PORT',
  ETH_PORT: 'FC_PORT',
  LIF: 'FC_PORT',
  REPLICATION_PORT: 'FC_PORT',
  CONTROLLER: 'CONTROLLER',
  CPU: 'CONTROLLER',
  MEMORY: 'CONTROLLER',
  CACHE: 'CONTROLLER',
  BLOCK_SERVICE: 'BLOCK_SERVICE',
  NAS_SERVICE: 'BLOCK_SERVICE',
  OBJECT_SERVICE: 'BLOCK_SERVICE',
  SNAPSHOT_SERVICE: 'BLOCK_SERVICE',
  QOS_SERVICE: 'BLOCK_SERVICE',
  REPLICATION_SERVICE: 'BLOCK_SERVICE',
  LUN: 'LUN',
  FILESYSTEM: 'LUN',
  POOL: 'STORAGE_POOL',
  STORAGE_POOL: 'STORAGE_POOL',
  RAID: 'STORAGE_POOL',
  DISK_DOMAIN: 'STORAGE_POOL',
  DISK: 'DISK',
  DISK_ENCLOSURE: 'DISK_ENCLOSURE',
  ENCLOSURE: 'DISK_ENCLOSURE',
  STORAGE_DEVICE: 'STORAGE_DEVICE',
  REPLICATION_SESSION: 'REPLICATION_SESSION',
  WAN_LINK: 'WAN_LINK',
  POWER: 'DISK',
  FAN: 'DISK',
  BBU: 'DISK',
}

/** V1 resource_type → 冻结分层码（§5.4；未知类型回退按类型能力推导）。 */
export const V1_LAYER_CODE_MAP: Readonly<Record<string, DocLayerCode>> = {
  BUSINESS: 'S1_1',
  BUSINESS_APP: 'S1_1',
  BUSINESS_SERVICE: 'S1_1',
  HOST: 'S1_2',
  STORAGE_CLIENT: 'S1_2',
  CLIENT_OS: 'S1_2',
  MOUNT_POINT: 'S1_2',
  HOST_INTERFACE: 'S2',
  SAN_FABRIC: 'S2',
  NETWORK_FABRIC: 'S2',
  NETWORK_DEVICE: 'S2',
  NETWORK_PATH: 'S2',
  ACCESS_LINK: 'S2',
  FC_PORT: 'S3_1',
  ETH_PORT: 'S3_1',
  LIF: 'S3_1',
  REPLICATION_PORT: 'S3_1',
  CONTROLLER: 'S3_2',
  CPU: 'S3_2',
  MEMORY: 'S3_2',
  CACHE: 'S3_2',
  BLOCK_SERVICE: 'S3_3',
  NAS_SERVICE: 'S3_3',
  OBJECT_SERVICE: 'S3_3',
  SNAPSHOT_SERVICE: 'S3_3',
  QOS_SERVICE: 'S3_3',
  REPLICATION_SERVICE: 'S3_3',
  REPLICATION_SESSION: 'S3_3',
  LUN: 'S3_4',
  POOL: 'S3_4',
  STORAGE_POOL: 'S3_4',
  RAID: 'S3_4',
  FILESYSTEM: 'S3_4',
  DISK_DOMAIN: 'S3_4',
  DISK: 'S3_5',
  DISK_ENCLOSURE: 'S3_5',
  ENCLOSURE: 'S3_5',
  STORAGE_DEVICE: 'S3_5',
  POWER: 'S3_5',
  FAN: 'S3_5',
  BBU: 'S3_5',
}

/**
 * V1 relation_type → 规范关系注册表（§5.5、§9.4）。
 * FAILOVER_TO 走事件、AFFECTS 不进拓扑，此处不出现。
 */
export const V1_RELATION_MAP: Readonly<Record<string, string>> = {
  ACCESSES: 'ACCESSES',
  PHYSICAL_CONNECTS: 'CONNECTS_TO',
  CONNECTS_TO: 'CONNECTS_TO',
  DEPENDS_ON: 'DEPENDS_ON',
  RUNS_ON: 'DEPENDS_ON',
  HOSTS: 'HOSTS',
  PROVIDES_SERVICE: 'PROVIDES_SERVICE_TO',
  SERVED_BY: 'PROVIDES_SERVICE_TO',
  BACKED_BY: 'BACKED_BY',
  BELONGS_TO: 'CONTAINS',
  CONTAINS: 'CONTAINS',
  OWNS: 'CONTAINS',
  PRIMARY_BACKUP_OF: 'REDUNDANT_WITH',
  SHARES_RESOURCE_WITH: 'SHARES_WITH',
  REPLICATES_TO: 'REPLICATES_TO',
  SOURCE_OF: 'DEPENDS_ON',
  SENDS_VIA: 'DEPENDS_ON',
  RECEIVES_FOR: 'DEPENDS_ON',
  ROUTES_THROUGH: 'CONNECTS_TO',
  TARGETS: 'DEPENDS_ON',
}

/**
 * 需要交换端点的 V1 关系（规范化到规范方向，§9.4）：
 * - SERVED_BY：LUN 由 Controller 服务 → 规范 PROVIDES_SERVICE_TO provider→consumer；
 * - BELONGS_TO：child BELONGS_TO parent → 规范 CONTAINS container→member；
 * - SOURCE_OF / RECEIVES_FOR：复制会话依赖源端/接收端口 → 规范 DEPENDS_ON 以会话为源。
 */
export const REVERSED_RELATIONS: ReadonlySet<string> = new Set([
  'SERVED_BY',
  'BELONGS_TO',
  'SOURCE_OF',
  'RECEIVES_FOR',
])

/** 合法 OPERATIONAL_ROLE 状态码。V1 attributes.role 只在白名单内才转 InstanceState（§9.3）。 */
export const OPERATIONAL_ROLE_CODES: ReadonlySet<string> = new Set([
  'ACTIVE',
  'STANDBY',
  'PRIMARY',
  'SECONDARY',
  'MASTER',
  'SLAVE',
  'STANDALONE',
])

/**
 * V1 attributes.role 是否可转换为 OPERATIONAL_ROLE 状态。
 * 诊断派生角色（如 noisy 的 aggressor/victim 施压者/受害者，docs/19 §11.3）是
 * RUNTIME_DERIVED 结论，禁止进入初始拓扑。
 */
export function isOperationalRole(role: string | undefined): boolean {
  return OPERATIONAL_ROLE_CODES.has((role ?? '').trim().toUpperCase())
}

/** V1 状态码 → 规范状态维度（§5.7；统一口径，不做 case 特判）。 */
export function stateDimensionForCode(code: string | undefined): StateDimension {
  const s = (code ?? '').trim().toUpperCase()
  if (s === 'UP' || s === 'DOWN' || s === 'DEGRADED') return 'LINK_STATE'
  if (isOperationalRole(s)) return 'OPERATIONAL_ROLE'
  if (s === 'EVENT') return 'PATH_STATE'
  return 'HEALTH'
}

/** relation_set 类型判定（§5.6 冻结两种；其余归 REDUNDANCY_SET 并保留原组标签）。 */
export function relationSetTypeForGroup(group: string): RelationSetType {
  const g = (group ?? '').toLowerCase()
  if (g.includes('mp-') || g.includes('multipath') || g.includes('multi-path')) return 'MULTIPATH_SET'
  return 'REDUNDANCY_SET'
}

// ─────────────────────────────────────────────────────────────────────────────
// 规范类型定义（§5.2~§5.8）
// ─────────────────────────────────────────────────────────────────────────────

/** 时空有效区间。 */
export interface TimeInterval {
  from: string | null
  to: string | null
}

/** §5.3 ResourceInstance —— 身份/类型/稳定配置/空间归属/生命周期。禁止候选/根因/坐标/光晕。 */
export interface ResourceInstance {
  resource_id: string
  resource_type_code: string
  name: string
  external_refs: Array<{ system: string; id: string }>
  placement: {
    spatial_domain: string
    layer_code: string
    zone_code: string | null
  }
  valid_time: TimeInterval
  properties: Record<string, unknown>
  provenance: { source_type: string; source_ref: string }
}

/** §5.5 TopologyRelation —— 稳定实例关系。 */
export interface TopologyRelation {
  relation_id: string
  relation_type: string
  source_ref: string
  target_ref: string
  valid_time: TimeInterval
  properties: {
    original_relation_type?: string
    direction?: string
    path_group?: string | null
    redundancy_group?: string | null
    /** parent_id 派生的 CONTAINS（provenance.source_ref 以 resources.json# 开头）。 */
    derived_from_parent_id?: boolean
    [key: string]: unknown
  }
  provenance: { source_type: string; source_ref: string }
}

/** §5.6 RelationSet —— 冗余/多路径组。当前主备角色由 InstanceState 表达。 */
export interface RelationSet {
  relation_set_id: string
  set_type: RelationSetType
  members: Array<{ member_kind: 'RESOURCE' | 'RELATION' | 'RELATION_SET'; member_ref: string }>
  properties: Record<string, unknown>
  valid_time: TimeInterval
}

/** §5.7 InstanceState —— 某时刻资源/关系/关系组的状态。不含 Evidence/候选/支持分。 */
export interface InstanceState {
  state_id: string
  subject_kind: 'RESOURCE' | 'RELATION' | 'RELATION_SET'
  subject_ref: string
  state_dimension: StateDimension
  state_code: string
  valid_time: TimeInterval
  observed_at: string | null
  /** §9.3：无时间旧状态标记 LEGACY_UNTIMED；可展示基线配置但不能单独证明本次故障。 */
  time_quality?: 'LEGACY_UNTIMED' | 'LEGACY_TIMED'
  evidence_eligible?: boolean
  provenance: { source_type: string; source_ref?: string }
}

/** §5.8 TopologyEvent —— 拓扑变化事件。FAILOVER_TO 必须转换为事件。 */
export interface TopologyEvent {
  event_id: string
  event_type: string
  source_ref: string
  target_ref: string
  occurred_at: string | null
  completed_at: string | null
  event_status: 'PLANNED' | 'ONGOING' | 'COMPLETED'
  provenance: { source_type: string; source_ref: string }
}

/** §5.2 InstanceTopologySnapshot 根结构。 */
export interface InstanceTopologySnapshot {
  schema_name: typeof INSTANCE_TOPOLOGY_SCHEMA_NAME
  schema_version: typeof INSTANCE_TOPOLOGY_SCHEMA_VERSION
  topology_id: string
  environment_id: string
  snapshot_at: string | null
  resources: ResourceInstance[]
  relations: TopologyRelation[]
  relation_sets: RelationSet[]
  states: InstanceState[]
  events: TopologyEvent[]
  provenance: { source_type: 'CASE_MOCK'; source_ref: string; case_id: string }
}

/** Case V1 资源（与 case-adapter 的 V1Resource 结构兼容）。 */
export interface V1Resource {
  resource_id: string
  resource_type: string
  name: string
  parent_id?: string | null
  device_id?: string | null
  zone?: string
  location?: string
  attributes?: Record<string, unknown>
  display?: Record<string, unknown>
}

/** Case V1 边（与 case-adapter 的 V1Edge 结构兼容）。 */
export interface V1Edge {
  edge_id: string
  source_id: string
  target_id: string
  relation_type: string
  direction?: string
  path_group?: string | null
  redundancy_group?: string | null
  state?: string | null
  valid_from?: string | null
  valid_to?: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// V1 → 规范转换
// ─────────────────────────────────────────────────────────────────────────────

/** V1 location → 空间域（§5.4 冻结 8 域）。 */
export function deriveSpatialDomain(r: V1Resource): string {
  const loc = r.location ?? ''
  const t = r.resource_type ?? ''
  if (t === 'STORAGE_DEVICE' || loc === 'boundary') return 'DEVICE_BOUNDARY'
  if (loc === 'internal' || loc === 'internal_boundary') return 'DEVICE_INTERNAL'
  if (t === 'REPLICATION_SESSION') return 'CROSS_SITE_NETWORK'
  if (t === 'NETWORK_PATH' || t === 'NETWORK_DEVICE' || t === 'WAN_LINK') return 'CROSS_SITE_NETWORK'
  if (loc === 'cross_boundary') return 'CROSS_SITE_NETWORK'
  if (loc === 'external') return 'DEVICE_EXTERNAL'
  return 'UNRESOLVED'
}

function resourceTypeCodeOf(type: string): string {
  return V1_RESOURCE_TYPE_MAP[type] ?? type
}

/**
 * 过滤 V1 attributes 中的诊断派生角色（docs/19 §11.3：施压者/受害者等答案
 * RUNTIME_DERIVED，禁止进入初始拓扑）。合法运行角色（active/standby 等）保留
 * 为 View Hint，同时按 §9.3 转 InstanceState。
 */
function sanitizeV1Attributes(attributes: Record<string, unknown>): Record<string, unknown> {
  if (typeof attributes.role !== 'string') return attributes
  if (isOperationalRole(attributes.role)) return attributes
  const sanitized = { ...attributes }
  delete sanitized.role
  return sanitized
}

/** 生成稳定 relation_id（V1 edge_id 保持稳定；parent_id 派生 CONTAINS 用合成 id）。 */
function relationIdFor(edgeId: string): string {
  return edgeId
}

function containsRelationId(parentId: string, childId: string): string {
  return `contains-${parentId}-${childId}`
}

/** 计算快照时刻：取所有边时间（valid_from/valid_to）的最大值；无则 null。 */
export function deriveSnapshotAt(resources: V1Resource[], edges: V1Edge[]): string | null {
  const times: string[] = []
  for (const e of edges) {
    if (e.valid_from) times.push(e.valid_from)
    if (e.valid_to) times.push(e.valid_to)
  }
  if (!times.length) return null
  return [...times].sort().at(-1) ?? null
}

function pushUniqueMember(set: RelationSet, memberRef: string): void {
  if (!set.members.some((m) => m.member_ref === memberRef)) {
    set.members.push({ member_kind: 'RESOURCE', member_ref: memberRef })
  }
}

/**
 * 把 5 个 Case 的 V1 resources/topology 转换为规范 InstanceTopologySnapshot。
 * 纯函数、确定性、禁止 case_id 特判。
 *
 * 关键转换（§9.3/§9.4）：
 * - resource_type → resource_type_code + original_resource_type；
 * - parent_id → CONTAINS（显式 CONTAINS/BELONGS_TO 已表达归属的子资源不再重复派生，
 *   保证"一个资源最多一个直接容器"§5.11-4）；
 * - zone/location → placement.spatial_domain/layer_code/zone_code；
 * - attributes.role/state/health → InstanceState（LEGACY 标记，evidence_eligible=false）；
 * - 关系映射见 V1_RELATION_MAP；FAILOVER_TO → TopologyEvent；AFFECTS 不进拓扑；
 * - path_group → relation.properties.path_group（查询预期 / View Hint）；
 * - redundancy_group → RelationSet。
 */
export function convertV1ToInstanceTopology(
  caseId: string,
  resources: V1Resource[],
  edges: V1Edge[],
): InstanceTopologySnapshot {
  const resourceById = new Map(resources.map((r) => [r.resource_id, r]))

  const instances: ResourceInstance[] = resources.map((r) => ({
    resource_id: r.resource_id,
    resource_type_code: resourceTypeCodeOf(r.resource_type),
    name: r.name,
    external_refs: [{ system: 'DME', id: r.resource_id }],
    placement: {
      spatial_domain: deriveSpatialDomain(r),
      layer_code: V1_LAYER_CODE_MAP[r.resource_type] ?? 'S2',
      zone_code: r.zone ?? null,
    },
    valid_time: { from: null, to: null },
    properties: {
      original_resource_type: r.resource_type,
      device_hint: r.device_id ?? null,
      zone_code: r.zone ?? null,
      attributes: sanitizeV1Attributes(r.attributes ?? {}),
    },
    provenance: { source_type: 'CASE_MOCK', source_ref: `resources.json#${r.resource_id}` },
  }))

  // 被 parent_id/device_id 引用但不在资源清单里的容器（如分层演示 Case 的 storage-01
  // 只作为设备边界引用）。补齐为 STORAGE_DEVICE 边界容器，使 §5.11-5 的 Storage 祖先
  // 校验成立；渲染投影跳过 derived_container（§5.9 前端不重复画归属线）。
  const resourceIds = new Set(resources.map((r) => r.resource_id))
  for (const r of resources) {
    for (const ref of [r.parent_id, r.device_id]) {
      if (ref && !resourceIds.has(ref) && !instances.some((i) => i.resource_id === ref)) {
        instances.push({
          resource_id: ref,
          resource_type_code: 'STORAGE_DEVICE',
          name: ref,
          external_refs: [{ system: 'DME', id: ref }],
          placement: {
            spatial_domain: 'DEVICE_BOUNDARY',
            layer_code: 'S3_5',
            zone_code: null,
          },
          valid_time: { from: null, to: null },
          properties: { derived_container: true },
          provenance: { source_type: 'CASE_MOCK', source_ref: `resources.json#${ref}.derived_device` },
        })
      }
    }
  }

  const relations: TopologyRelation[] = []
  const relationSets = new Map<string, RelationSet>()
  const states: InstanceState[] = []
  const events: TopologyEvent[] = []
  const emittedRelationKeys = new Set<string>()

  // —— 显式边 → 规范关系 / 事件 / 状态 / 关系组 ——
  for (const edge of edges) {
    if (edge.relation_type === 'AFFECTS') continue
    if (edge.relation_type === 'FAILOVER_TO') {
      events.push({
        event_id: `event-${edge.edge_id}`,
        event_type: 'FAILOVER',
        source_ref: edge.source_id,
        target_ref: edge.target_id,
        occurred_at: edge.valid_from ?? null,
        completed_at: edge.valid_to ?? null,
        event_status: edge.valid_to ? 'COMPLETED' : 'ONGOING',
        provenance: { source_type: 'CASE_MOCK', source_ref: `topology.json#${edge.edge_id}` },
      })
      continue
    }

    const canonical = V1_RELATION_MAP[edge.relation_type]
    if (!canonical) continue

    let source = edge.source_id
    let target = edge.target_id
    if (REVERSED_RELATIONS.has(edge.relation_type)) {
      const tmp = source
      source = target
      target = tmp
    }
    // HOSTS 规范化为 host → hosted（§5.5）。
    if (canonical === 'HOSTS') {
      const srcCode = resourceTypeCodeOf(resourceById.get(source)?.resource_type ?? '')
      if (srcCode !== 'HOST') {
        const tmp = source
        source = target
        target = tmp
      }
    }
    // 对称关系按 resource_id 排序后只保存一次（§5.5）。
    if (SYMMETRIC_RELATIONS.has(canonical) && source > target) {
      const tmp = source
      source = target
      target = tmp
    }

    const dupKey = `${canonical}|${source}|${target}`
    if (emittedRelationKeys.has(dupKey)) continue
    emittedRelationKeys.add(dupKey)

    relations.push({
      relation_id: relationIdFor(edge.edge_id),
      relation_type: canonical,
      source_ref: source,
      target_ref: target,
      valid_time: { from: edge.valid_from ?? null, to: edge.valid_to ?? null },
      properties: {
        original_relation_type: edge.relation_type,
        direction: edge.direction ?? 'directed',
        path_group: edge.path_group ?? null,
        redundancy_group: edge.redundancy_group ?? null,
      },
      provenance: { source_type: 'CASE_MOCK', source_ref: `topology.json#${edge.edge_id}` },
    })

    if (edge.redundancy_group) {
      let set = relationSets.get(edge.redundancy_group)
      if (!set) {
        set = {
          relation_set_id: edge.redundancy_group,
          set_type: relationSetTypeForGroup(edge.redundancy_group),
          members: [],
          properties: { original_group: edge.redundancy_group },
          valid_time: { from: null, to: null },
        }
        relationSets.set(edge.redundancy_group, set)
      }
      pushUniqueMember(set, source)
      pushUniqueMember(set, target)
    }

    if (edge.state && edge.state !== 'normal') {
      states.push({
        state_id: `state-${edge.edge_id}`,
        subject_kind: 'RELATION',
        subject_ref: relationIdFor(edge.edge_id),
        state_dimension: stateDimensionForCode(edge.state),
        state_code: (edge.state ?? '').trim().toUpperCase(),
        valid_time: { from: edge.valid_from ?? null, to: edge.valid_to ?? null },
        observed_at: edge.valid_from ?? null,
        time_quality: edge.valid_from || edge.valid_to ? 'LEGACY_TIMED' : 'LEGACY_UNTIMED',
        evidence_eligible: false,
        provenance: { source_type: 'CASE_MOCK', source_ref: `topology.json#${edge.edge_id}` },
      })
    }
  }

  // —— parent_id → CONTAINS（§5.3：资源归属统一用 CONTAINS，不重复保存第二份真值）——
  const explicitContainmentChildren = new Set<string>()
  for (const r of relations) {
    if (r.relation_type === 'CONTAINS') explicitContainmentChildren.add(r.target_ref)
  }
  const instanceIds = new Set(instances.map((i) => i.resource_id))
  for (const resource of resources) {
    // 容器来源：parent_id 优先；无 parent_id 时以 device_id 作为设备边界归属索引（§9.3）。
    const deviceContainer =
      resource.device_id && resource.device_id !== resource.resource_id
        ? resource.device_id
        : null
    const parent = resource.parent_id ?? deviceContainer
    if (!parent) continue
    if (explicitContainmentChildren.has(resource.resource_id)) continue
    if (!instanceIds.has(parent)) continue
    const key = `CONTAINS|${parent}|${resource.resource_id}`
    if (emittedRelationKeys.has(key)) continue
    emittedRelationKeys.add(key)
    relations.push({
      relation_id: containsRelationId(parent, resource.resource_id),
      relation_type: 'CONTAINS',
      source_ref: parent,
      target_ref: resource.resource_id,
      valid_time: { from: null, to: null },
      properties: {
        direction: 'container',
        path_group: null,
        redundancy_group: null,
        derived_from_parent_id: true,
      },
      provenance: { source_type: 'CASE_MOCK', source_ref: `resources.json#${resource.resource_id}.parent_id` },
    })
  }

  // —— attributes.role/state/health → InstanceState（§9.3；LEGACY_UNTIMED）——
  for (const resource of resources) {
    const attrs = resource.attributes ?? {}
    if (typeof attrs.role === 'string' && isOperationalRole(attrs.role)) {
      states.push({
        state_id: `state-${resource.resource_id}-role`,
        subject_kind: 'RESOURCE',
        subject_ref: resource.resource_id,
        state_dimension: 'OPERATIONAL_ROLE',
        state_code: attrs.role.trim().toUpperCase(),
        valid_time: { from: null, to: null },
        observed_at: null,
        time_quality: 'LEGACY_UNTIMED',
        evidence_eligible: false,
        provenance: { source_type: 'CASE_MOCK', source_ref: `resources.json#${resource.resource_id}.attributes.role` },
      })
    }
    if (typeof attrs.state === 'string' && attrs.state && attrs.state !== 'normal') {
      states.push({
        state_id: `state-${resource.resource_id}-state`,
        subject_kind: 'RESOURCE',
        subject_ref: resource.resource_id,
        state_dimension: stateDimensionForCode(attrs.state),
        state_code: attrs.state.trim().toUpperCase(),
        valid_time: { from: null, to: null },
        observed_at: null,
        time_quality: 'LEGACY_UNTIMED',
        evidence_eligible: false,
        provenance: { source_type: 'CASE_MOCK', source_ref: `resources.json#${resource.resource_id}.attributes.state` },
      })
    }
    if (typeof attrs.health === 'string' && attrs.health && attrs.health !== 'NORMAL') {
      states.push({
        state_id: `state-${resource.resource_id}-health`,
        subject_kind: 'RESOURCE',
        subject_ref: resource.resource_id,
        state_dimension: 'HEALTH',
        state_code: attrs.health.trim().toUpperCase(),
        valid_time: { from: null, to: null },
        observed_at: null,
        time_quality: 'LEGACY_UNTIMED',
        evidence_eligible: false,
        provenance: { source_type: 'CASE_MOCK', source_ref: `resources.json#${resource.resource_id}.attributes.health` },
      })
    }
  }

  return {
    schema_name: INSTANCE_TOPOLOGY_SCHEMA_NAME,
    schema_version: INSTANCE_TOPOLOGY_SCHEMA_VERSION,
    topology_id: `topo-${caseId}`,
    environment_id: `env-${caseId}`,
    snapshot_at: deriveSnapshotAt(resources, edges),
    resources: instances,
    relations,
    relation_sets: [...relationSets.values()],
    states,
    events,
    provenance: { source_type: 'CASE_MOCK', source_ref: caseId, case_id: caseId },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 规范快照 → 渲染投影（下游拓扑渲染读取）
// ─────────────────────────────────────────────────────────────────────────────

/** 渲染投影资源（与 layered-topology 的 LayeredResource 结构兼容）。 */
export interface ProjectedResource {
  resource_id: string
  resource_type: string
  name: string
  parent_id?: string | null
  device_id?: string | null
  zone?: string
  location?: string
  attributes?: Record<string, unknown>
}

/** 渲染投影边（与 layered-topology 的 LayeredEdge 结构兼容）。 */
export interface ProjectedEdge {
  edge_id: string
  source_id: string
  target_id: string
  relation_type: string
  direction?: string
  path_group?: string | null
  redundancy_group?: string | null
  state?: string | null
  valid_from?: string | null
  valid_to?: string | null
}

function locationFromSpatialDomain(domain: string): string {
  if (domain === 'DEVICE_BOUNDARY') return 'boundary'
  if (domain === 'DEVICE_INTERNAL') return 'internal'
  return 'external'
}

/**
 * 规范快照 → 渲染图（§5.9 "前端决定如何展示"）。
 *
 * 投影选择"拓扑.json 显式边"（稳定物理/业务关系）作为渲染连线，保留 V1 的
 * relation_type / path_group / direction / relation_id 供现有 3D 分层与路径高亮
 * 消费；parent_id 派生的 CONTAINS（provenance resources.json#）在规范模型中作为
 * 归属真值（供查询/校验），不重复画成连线（归属已由设备/层级聚合可视化表达）。
 *
 * 禁止改动 resource_id / relation_id；坐标与高亮由画布层决定，不写回快照。
 */
export function instanceTopologyToGraph(
  snapshot: InstanceTopologySnapshot,
): { resources: ProjectedResource[]; edges: ProjectedEdge[] } {
  // 跳过派生容器（§5.9：归属由设备/层级聚合可视化表达，不重复画成节点/连线）。
  const resources: ProjectedResource[] = snapshot.resources
    .filter((r) => r.properties.derived_container !== true)
    .map((r) => ({
    resource_id: r.resource_id,
    resource_type: String(r.properties.original_resource_type ?? r.resource_type_code),
    name: r.name,
    parent_id: null,
    device_id: (r.properties.device_hint as string | null | undefined) ?? null,
    zone: r.placement.zone_code ?? '',
    location: locationFromSpatialDomain(r.placement.spatial_domain),
    attributes: (r.properties.attributes ?? {}) as Record<string, unknown>,
  }))

  const stateByRelation = new Map<string, string>()
  for (const st of snapshot.states) {
    if (st.subject_kind !== 'RELATION') continue
    if (!stateByRelation.has(st.subject_ref)) stateByRelation.set(st.subject_ref, st.state_code)
  }

  const edges: ProjectedEdge[] = snapshot.relations
    .filter((r) => r.provenance.source_ref.startsWith('topology.json#'))
    .map((r) => ({
      edge_id: r.relation_id,
      source_id: r.source_ref,
      target_id: r.target_ref,
      relation_type: String(r.properties.original_relation_type ?? r.relation_type),
      direction: String(r.properties.direction ?? 'directed'),
      path_group: (r.properties.path_group as string | null | undefined) ?? null,
      redundancy_group: (r.properties.redundancy_group as string | null | undefined) ?? null,
      state: stateByRelation.get(r.relation_id) ?? null,
      valid_from: r.valid_time.from,
      valid_to: r.valid_time.to,
    }))

  return { resources, edges }
}
