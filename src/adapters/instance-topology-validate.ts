/**
 * InstanceTopology Contract 1.0 校验器（docs/19 §5.11 十二条规则）。
 *
 * 纯函数：validateInstanceTopology(snapshot, kg) → issues[]。
 * 由 scripts/validate-instance-topology.mjs（Vite SSR 加载）与单元测试共用，
 * 保证运行时与编译快照同一套校验口径。
 *
 * §5.11 规则编号：
 *  1  resource_type_code 可映射 KG L1；
 *  2  关系端点 / 状态主体 / RelationSet 成员全部存在；
 *  3  每条实例关系和事件端点均有 L1 类型能力支持；
 *  4  CONTAINS 有向无环 + 一个资源最多一个直接容器；
 *  5  DEVICE_INTERNAL 资源必须存在 Storage Device 祖先；
 *  6  外部资源不得直接连接设备内部非边界资源（仅物理 CONNECTS_TO）；
 *  7  对称关系规范排序且不得重复；
 *  8  状态时间不超出主体生命周期，同维度时间不重叠；
 *  9  Snapshot 不包含 snapshot_at 之后才成立的状态；
 *  10 FAILOVER_TO、AFFECTS 禁止进入稳定关系集合；
 *  11 资源和关系禁止携带候选、根因、证据和最终影响结论；
 *  12 基础拓扑禁止携带坐标、颜色、光晕、展开状态和 Storyboard 幕次。
 */

import {
  SYMMETRIC_RELATIONS,
  type InstanceTopologySnapshot,
} from './v1_to_instance_topology'

/** KnowledgeGraphPackage L1 类型能力参考（docs/19 §4.7）。 */
export interface KgTopologyReference {
  resourceTypes: Array<{ code: string; name?: string; placement_domains?: string[] }>
  topologyCapabilities: Array<{
    capability_code: string
    source_types: string[]
    target_types: string[]
    instance_relation: string
  }>
}

export interface InstanceTopologyIssue {
  code: string
  severity: 'ERROR' | 'WARNING'
  message: string
}

const FORBIDDEN_RUNTIME_KEYS = [
  'candidate',
  'candidate_id',
  'root_cause',
  'root_cause_id',
  'evidence',
  'evidence_id',
  'impact',
  'support_score',
  'diagnosis_support_score',
]
const FORBIDDEN_VIEW_KEYS = [
  'x',
  'y',
  'z',
  'fx',
  'fy',
  'fz',
  'color',
  'glow',
  'expanded',
  'storyboard',
  'scene_id',
]

export function validateInstanceTopology(
  snapshot: InstanceTopologySnapshot,
  kg: KgTopologyReference,
): InstanceTopologyIssue[] {
  const issues: InstanceTopologyIssue[] = []
  const fail = (code: string, message: string): void => {
    issues.push({ code, severity: 'ERROR', message })
  }
  const warn = (code: string, message: string): void => {
    issues.push({ code, severity: 'WARNING', message })
  }

  const resourcesById = new Map(snapshot.resources.map((r) => [r.resource_id, r]))
  const relationsById = new Map(snapshot.relations.map((r) => [r.relation_id, r]))
  const setsById = new Map(snapshot.relation_sets.map((s) => [s.relation_set_id, s]))

  const rtCodes = new Set(kg.resourceTypes.map((rt) => rt.code))
  const capByRel = new Map<string, { source: Set<string>; target: Set<string> }>()
  for (const c of kg.topologyCapabilities) {
    capByRel.set(c.instance_relation, {
      source: new Set(c.source_types),
      target: new Set(c.target_types),
    })
  }

  // §5.11-1 resource_type_code 可映射 KG L1。
  for (const r of snapshot.resources) {
    if (!rtCodes.has(r.resource_type_code)) {
      fail('R1', `资源 ${r.resource_id} resource_type_code=${r.resource_type_code} 无法映射 KG L1 ResourceType`)
    }
  }

  // §5.11-2 端点 / 状态主体 / 成员存在。
  for (const rel of snapshot.relations) {
    if (!resourcesById.has(rel.source_ref)) fail('R2', `关系 ${rel.relation_id} 源端点悬空：${rel.source_ref}`)
    if (!resourcesById.has(rel.target_ref)) fail('R2', `关系 ${rel.relation_id} 目标端点悬空：${rel.target_ref}`)
  }
  for (const st of snapshot.states) {
    const exists =
      st.subject_kind === 'RESOURCE'
        ? resourcesById.has(st.subject_ref)
        : st.subject_kind === 'RELATION'
          ? relationsById.has(st.subject_ref)
          : setsById.has(st.subject_ref)
    if (!exists) fail('R2', `状态 ${st.state_id} 主体悬空：${st.subject_kind}:${st.subject_ref}`)
  }
  for (const set of snapshot.relation_sets) {
    for (const m of set.members) {
      if (!resourcesById.has(m.member_ref) && !relationsById.has(m.member_ref) && !setsById.has(m.member_ref)) {
        fail('R2', `RelationSet ${set.relation_set_id} 成员悬空：${m.member_ref}`)
      }
    }
  }

  // §5.11-3 每条实例关系 / 事件端点均有 L1 类型能力支持。
  for (const rel of snapshot.relations) {
    const cap = capByRel.get(rel.relation_type)
    if (!cap) {
      fail('R3', `关系类型 ${rel.relation_type} 无 L1 类型能力（topology_capabilities）`)
      continue
    }
    const src = resourcesById.get(rel.source_ref)
    const tgt = resourcesById.get(rel.target_ref)
    if (!src || !tgt) continue
    const srcOk = cap.source.has('*') || cap.source.has(src.resource_type_code)
    const tgtOk = cap.target.has('*') || cap.target.has(tgt.resource_type_code)
    if (!srcOk || !tgtOk) {
      fail(
        'R3',
        `关系 ${rel.relation_id} (${rel.relation_type}) 类型能力不符：` +
          `${src.resource_id}(${src.resource_type_code}) → ${tgt.resource_id}(${tgt.resource_type_code})`,
      )
    }
  }
  for (const ev of snapshot.events) {
    const cap = capByRel.get(`TopologyEvent.${ev.event_type}`)
    if (!cap) {
      fail('R3', `事件类型 TopologyEvent.${ev.event_type} 无 L1 类型能力`)
      continue
    }
    const src = resourcesById.get(ev.source_ref)
    const tgt = resourcesById.get(ev.target_ref)
    if (!src || !tgt) continue
    if (!cap.source.has('*') && !cap.source.has(src.resource_type_code)) {
      fail('R3', `事件 ${ev.event_id} 源端点类型能力不符：${src.resource_type_code}`)
    }
    if (!cap.target.has('*') && !cap.target.has(tgt.resource_type_code)) {
      fail('R3', `事件 ${ev.event_id} 目标端点类型能力不符：${tgt.resource_type_code}`)
    }
  }

  // §5.11-4 CONTAINS 有向无环 + 单容器。
  const containerOf = new Map<string, string>() // child → parent
  for (const rel of snapshot.relations) {
    if (rel.relation_type !== 'CONTAINS') continue
    const prev = containerOf.get(rel.target_ref)
    if (prev !== undefined && prev !== rel.source_ref) {
      fail('R4', `资源 ${rel.target_ref} 有多个直接容器：${prev} 与 ${rel.source_ref}`)
    }
    containerOf.set(rel.target_ref, rel.source_ref)
  }
  for (const child of containerOf.keys()) {
    const seen = new Set<string>()
    let cur = child
    let guard = 0
    while (containerOf.has(cur) && guard++ < 1000) {
      if (seen.has(cur)) {
        fail('R4', `CONTAINS 形成环：${[...seen, cur].join(' → ')}`)
        break
      }
      seen.add(cur)
      cur = containerOf.get(cur)!
    }
  }

  // §5.11-5 DEVICE_INTERNAL 资源必须存在 Storage Device 祖先。
  for (const r of snapshot.resources) {
    if (r.placement.spatial_domain !== 'DEVICE_INTERNAL') continue
    let cur = r.resource_id
    let hasStorageAncestor = false
    let guard = 0
    while (containerOf.has(cur) && guard++ < 1000) {
      const parent = containerOf.get(cur)!
      const pRes = resourcesById.get(parent)
      if (pRes && pRes.resource_type_code === 'STORAGE_DEVICE') {
        hasStorageAncestor = true
        break
      }
      cur = parent
    }
    if (!hasStorageAncestor) {
      fail('R5', `DEVICE_INTERNAL 资源 ${r.resource_id} 缺少 Storage Device 祖先`)
    }
  }

  // §5.11-6 外部资源不得直接 CONNECTS_TO 设备内部非边界资源（边界 = 前端层 S3_1）。
  for (const rel of snapshot.relations) {
    if (rel.relation_type !== 'CONNECTS_TO') continue
    const a = resourcesById.get(rel.source_ref)
    const b = resourcesById.get(rel.target_ref)
    if (!a || !b) continue
    const aExternal = a.placement.spatial_domain === 'DEVICE_EXTERNAL'
    const bExternal = b.placement.spatial_domain === 'DEVICE_EXTERNAL'
    if (aExternal === bExternal) continue
    const internal = aExternal ? b : a
    if (internal.placement.layer_code !== 'S3_1') {
      fail(
        'R6',
        `外部资源与内部非边界资源直接 CONNECTS_TO：${a.resource_id} ↔ ${b.resource_id} ` +
          `（内部端点 ${internal.resource_id} 分层 ${internal.placement.layer_code} 非前端边界）`,
      )
    }
  }

  // §5.11-7 对称关系规范排序且不得重复。
  const seenRelations = new Set<string>()
  for (const rel of snapshot.relations) {
    if (SYMMETRIC_RELATIONS.has(rel.relation_type)) {
      if (rel.source_ref > rel.target_ref) {
        fail('R7', `对称关系 ${rel.relation_id} (${rel.relation_type}) 未按 resource_id 规范排序`)
      }
    }
    const key = `${rel.relation_type}|${rel.source_ref}|${rel.target_ref}`
    if (seenRelations.has(key)) {
      fail('R7', `重复稳定关系：${rel.relation_id}（${key}）`)
    }
    seenRelations.add(key)
  }

  // §5.11-8 状态时间不超出主体生命周期，同维度时间不重叠。
  for (const st of snapshot.states) {
    if (st.subject_kind === 'RESOURCE') {
      const res = resourcesById.get(st.subject_ref)
      if (res && st.valid_time.from && res.valid_time.to && st.valid_time.from > res.valid_time.to) {
        fail('R8', `状态 ${st.state_id} 起始晚于主体生命周期结束`)
      }
    }
  }
  const stateBuckets = new Map<string, InstanceTopologySnapshot['states']>()
  for (const st of snapshot.states) {
    const key = `${st.subject_kind}:${st.subject_ref}:${st.state_dimension}`
    const bucket = stateBuckets.get(key) ?? []
    bucket.push(st)
    stateBuckets.set(key, bucket)
  }
  for (const bucket of stateBuckets.values()) {
    if (bucket.length < 2) continue
    const timed = bucket.filter((s) => s.valid_time.from !== null)
    for (let i = 0; i < timed.length; i++) {
      for (let j = i + 1; j < timed.length; j++) {
        const a = timed[i]
        const b = timed[j]
        const aStart = a.valid_time.from!
        const aEnd = a.valid_time.to ?? null
        const bStart = b.valid_time.from!
        const bEnd = b.valid_time.to ?? null
        const overlap =
          (aEnd === null || bStart <= aEnd) && (bEnd === null || aStart <= bEnd)
        if (overlap) {
          fail('R8', `状态 ${a.state_id} 与 ${b.state_id} 同维度有效时间重叠`)
        }
      }
    }
  }

  // §5.11-9 Snapshot 不包含 snapshot_at 之后才成立的状态。
  if (snapshot.snapshot_at) {
    for (const st of snapshot.states) {
      if (st.valid_time.from && st.valid_time.from > snapshot.snapshot_at) {
        fail('R9', `状态 ${st.state_id} 起始 ${st.valid_time.from} 晚于 snapshot_at ${snapshot.snapshot_at}`)
      }
    }
  }

  // §5.11-10 FAILOVER_TO / AFFECTS 禁止进入稳定关系集合。
  for (const rel of snapshot.relations) {
    if (rel.relation_type === 'FAILOVER_TO' || rel.relation_type === 'AFFECTS') {
      fail('R10', `稳定关系集合禁止出现 ${rel.relation_type}：${rel.relation_id}`)
    }
  }

  // §5.11-11 资源和关系禁止携带候选、根因、证据和最终影响结论。
  for (const r of snapshot.resources) {
    const clash = Object.keys(r.properties).filter((k) =>
      FORBIDDEN_RUNTIME_KEYS.some((f) => k.toLowerCase().includes(f)),
    )
    if (clash.length) fail('R11', `资源 ${r.resource_id} 携带运行时诊断语义字段：${clash.join(',')}`)
  }
  for (const rel of snapshot.relations) {
    const clash = Object.keys(rel.properties).filter((k) =>
      FORBIDDEN_RUNTIME_KEYS.some((f) => k.toLowerCase().includes(f)),
    )
    if (clash.length) fail('R11', `关系 ${rel.relation_id} 携带运行时诊断语义字段：${clash.join(',')}`)
  }

  // §5.11-12 基础拓扑禁止携带坐标、颜色、光晕、展开状态和 Storyboard 幕次。
  for (const r of snapshot.resources) {
    const clash = Object.keys(r.properties).filter((k) => FORBIDDEN_VIEW_KEYS.includes(k))
    if (clash.length) fail('R12', `资源 ${r.resource_id} 携带投影字段：${clash.join(',')}`)
  }
  for (const rel of snapshot.relations) {
    const clash = Object.keys(rel.properties).filter((k) => FORBIDDEN_VIEW_KEYS.includes(k))
    if (clash.length) fail('R12', `关系 ${rel.relation_id} 携带投影字段：${clash.join(',')}`)
  }

  // 提示：V1 display.* 投影提示不进入规范模型。
  for (const r of snapshot.resources) {
    const attrs = (r.properties.attributes ?? {}) as Record<string, unknown>
    if (attrs && Object.prototype.hasOwnProperty.call(attrs, 'display')) {
      warn('W-DISPLAY', `资源 ${r.resource_id} attributes.display 应拆分到 View Projection Hint（§9.3）`)
    }
  }

  return issues
}

export function hasErrors(issues: InstanceTopologyIssue[]): boolean {
  return issues.some((i) => i.severity === 'ERROR')
}
