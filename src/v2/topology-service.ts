/**
 * Topology Service —— 规范 InstanceTopology 数据的可查询入口（docs/19 §16.2、§5.10）。
 *
 * 职责边界（docs/19 §13.2）：
 * - 只读查询：返回已知拓扑子图 / 路径 / 共享资源 / 事件，不写回实例、不改变诊断状态；
 * - 路径不是基础拓扑事实（§5.9）：find_paths 的结果是查询产物，不进入稳定关系集合；
 * - 本服务不裁决根因、不解释证据：find_shared_resources 只返回共享资源候选，
 *   是否施压者是 Reasoning 的职责。
 *
 * 全部为纯函数：输入 InstanceTopologySnapshot，输出查询结果。任一资源/关系/事件
 * 引用悬空时显式抛 IT-REF-* 错误，禁止静默跳过（§17.2 不可静默修复项）。
 */

import { errorCode, ErrorPrefix } from './error-codes'
import type {
  InstanceState,
  InstanceTopologySnapshot,
  ResourceInstance,
  TopologyEvent,
  TopologyRelation,
} from '../adapters/v1_to_instance_topology'

// ─────────────────────────────────────────────────────────────────────────────
// 查询协议（docs/19 §5.10）
// ─────────────────────────────────────────────────────────────────────────────

/** 通用拓扑查询请求。topology 为数据源（规范快照）。 */
export interface TopologyQueryRequest {
  topology: InstanceTopologySnapshot
  /** 查询锚点资源（空 = 从 Known 起始集展开）。 */
  anchor_resource_ids?: string[]
  /** 关系类型白名单（空 = 全部关系）。 */
  relation_types?: string[]
  /** 空间域过滤（空 = 全部）。 */
  spatial_domains?: string[]
  /** 最大展开深度（默认 3，BFS 层数）。 */
  max_depth?: number
}

/** 单条拓扑路径（§5.9 查询产物，非基础拓扑事实）。 */
export interface TopologyPath {
  path_id: string
  source_ref: string
  target_ref: string
  hops: Array<{
    relation_id: string
    relation_type: string
    source_ref: string
    target_ref: string
  }>
  length: number
}

/** 查询结果：resources + relations + states + paths + discovery_delta（§16.2）。 */
export interface TopologyQueryResult {
  resources: ResourceInstance[]
  relations: TopologyRelation[]
  states: InstanceState[]
  paths: TopologyPath[]
  /** 本次查询新进入 Known 子图的资源/关系 id（与传入锚点求差）。 */
  discovery_delta: { resources: string[]; relations: string[] }
}

/** find_paths 选项。 */
export interface PathQueryOptions {
  /** 关系类型白名单（空 = 全部）。 */
  relation_types?: string[]
  /** 返回路径条数上限（默认 5）。 */
  limit?: number
  /** 最大路径长度（默认 8 跳）。 */
  max_hops?: number
}

/** find_shared_resources 选项。 */
export interface SharedResourceQueryOptions {
  /** 关系类型白名单（空 = 全部）。 */
  relation_types?: string[]
  /** BFS 深度（默认 3）。 */
  max_depth?: number
  /** 结果上限（默认 20）。 */
  limit?: number
}

/** 共享资源结果：被所有消费者（在深度内）可达的资源。 */
export interface SharedResourceResult {
  resource: ResourceInstance
  /** 该共享资源到每个消费者的最短路径。 */
  paths: Record<string, TopologyPath>
}

/** expand_by_relation 结果：诱导子图（资源 + 关系 + 状态）。 */
export interface ExpandResult {
  resources: ResourceInstance[]
  relations: TopologyRelation[]
  states: InstanceState[]
}

/** query_topology_events 请求（§16.2）。 */
export interface TopologyEventsQuery {
  topology: InstanceTopologySnapshot
  resource_refs: string[]
  /** 时间窗（ISO 字符串；null 端点表示开放）。 */
  time_range?: { start: string | null; end: string | null }
  /** 事件类型白名单（空 = 全部）。 */
  event_types?: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// 内部工具：邻接表 / 引用校验
// ─────────────────────────────────────────────────────────────────────────────

function adjacencyOf(
  snapshot: InstanceTopologySnapshot,
  relationTypes?: string[],
): Map<string, Array<{ to: string; relation: TopologyRelation }>> {
  const adj = new Map<string, Array<{ to: string; relation: TopologyRelation }>>()
  const allow = relationTypes && relationTypes.length > 0 ? new Set(relationTypes) : null
  for (const r of snapshot.relations) {
    if (allow && !allow.has(r.relation_type)) continue
    const arr = adj.get(r.source_ref) ?? []
    arr.push({ to: r.target_ref, relation: r })
    adj.set(r.source_ref, arr)
    const back = adj.get(r.target_ref) ?? []
    back.push({ to: r.source_ref, relation: r })
    adj.set(r.target_ref, back)
  }
  return adj
}

/** 引用必须存在；悬空端点显式抛 IT-REF-001（§17.2 不可静默修复）。 */
function requireResource(snapshot: InstanceTopologySnapshot, id: string, what: string): void {
  if (!snapshot.resources.some((r) => r.resource_id === id)) {
    throw new Error(
      `${errorCode(ErrorPrefix.IT_REF, 1)} ${what}引用悬空资源 ${id}（topology=${snapshot.topology_id}）`,
    )
  }
}

/** BFS 单源最短路径；返回 from → to 的全部等长最短路径（limit 上限）。 */
function shortestPaths(
  snapshot: InstanceTopologySnapshot,
  adj: Map<string, Array<{ to: string; relation: TopologyRelation }>>,
  from: string,
  to: string,
  opts: Required<Pick<PathQueryOptions, 'max_hops' | 'limit'>>,
): TopologyPath[] {
  if (from === to) {
    return [{
      path_id: `path-${from}-${to}`,
      source_ref: from,
      target_ref: to,
      hops: [],
      length: 0,
    }]
  }
  const queue: Array<{ node: string; hops: Array<TopologyRelation> }> = [{ node: from, hops: [] }]
  const visited = new Map<string, number>() // node → 已访问层数（≤ max_hops）
  visited.set(from, 0)
  const found: TopologyPath[] = []
  while (queue.length > 0 && found.length < opts.limit) {
    const { node, hops } = queue.shift()!
    if (hops.length >= opts.max_hops) continue
    for (const { to: next, relation } of adj.get(node) ?? []) {
      const nextHops = [...hops, relation]
      if (next === to) {
        found.push({
          path_id: `path-${from}-${to}-${found.length + 1}`,
          source_ref: from,
          target_ref: to,
          hops: nextHops,
          length: nextHops.length,
        })
        if (found.length >= opts.limit) break
        continue
      }
      const nextLevel = visited.get(next)
      if (nextLevel !== undefined && nextLevel <= nextHops.length) continue
      visited.set(next, nextHops.length)
      queue.push({ node: next, hops: nextHops })
    }
  }
  return found
}

// ─────────────────────────────────────────────────────────────────────────────
// 查询函数（§16.2 / §5.10）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 在指定资源之间查找最短路径（§5.9：路径是查询产物，不进入稳定关系集合）。
 * 数据驱动，禁止 case_id 特判。
 */
export function find_paths(
  topology: InstanceTopologySnapshot,
  from: string,
  to: string,
  opts: PathQueryOptions = {},
): TopologyPath[] {
  requireResource(topology, from, 'find_paths.from')
  requireResource(topology, to, 'find_paths.to')
  const adj = adjacencyOf(topology, opts.relation_types)
  return shortestPaths(topology, adj, from, to, {
    max_hops: opts.max_hops ?? 8,
    limit: opts.limit ?? 5,
  })
}

/**
 * 反向追溯：找出被全部消费者（consumerIds）在深度内共享的资源。
 * 典型用途：扰邻场景从受害者 Host-B 反向定位共享存储池/带宽资源（docs/19 §11.3），
 * 本函数只返回共享资源候选，施压者裁决属于 Reasoning。
 * 数据驱动，禁止 case_id 特判。
 */
export function find_shared_resources(
  topology: InstanceTopologySnapshot,
  consumerIds: string[],
  opts: SharedResourceQueryOptions = {},
): SharedResourceResult[] {
  if (consumerIds.length === 0) return []
  for (const id of consumerIds) requireResource(topology, id, 'find_shared_resources.consumer')
  const adj = adjacencyOf(topology, opts.relation_types)
  const depth = opts.max_depth ?? 3
  const limit = opts.limit ?? 20

  // 每个消费者的可达集（BFS ≤ depth 层，含自身）。
  const reachableByConsumer = consumerIds.map((c) => {
    const reach = new Map<string, Array<TopologyRelation>>()
    reach.set(c, [])
    const queue: Array<{ node: string; hops: Array<TopologyRelation> }> = [{ node: c, hops: [] }]
    while (queue.length > 0) {
      const { node, hops } = queue.shift()!
      if (hops.length >= depth) continue
      for (const { to: next, relation } of adj.get(node) ?? []) {
        const nextHops = [...hops, relation]
        const prev = reach.get(next)
        if (prev !== undefined && prev.length <= nextHops.length) continue
        reach.set(next, nextHops)
        queue.push({ node: next, hops: nextHops })
      }
    }
    return reach
  })

  // 交集 = 被所有消费者共享的可达资源（排除消费者自身）。
  const consumers = new Set(consumerIds)
  const candidates: string[] = []
  for (const [id] of reachableByConsumer[0]) {
    if (consumers.has(id)) continue
    if (reachableByConsumer.every((r) => r.has(id))) candidates.push(id)
  }
  candidates.sort()
  return candidates.slice(0, limit).map((id) => {
    const paths: Record<string, TopologyPath> = {}
    for (const c of consumerIds) {
      const hops = reachableByConsumer[consumerIds.indexOf(c)].get(id) ?? []
      paths[c] = {
        path_id: `shared-${c}-${id}`,
        source_ref: c,
        target_ref: id,
        hops,
        length: hops.length,
      }
    }
    return { resource: topology.resources.find((r) => r.resource_id === id)!, paths }
  })
}

/**
 * 按关系类型从指定资源扩展（诱导子图）。返回命中的资源 + 关系 + 相关状态。
 * 复用为 query_topology 的展开内核。
 */
export function expand_by_relation(
  topology: InstanceTopologySnapshot,
  resourceIds: string[],
  relationTypes: string[] | undefined,
  maxDepth = 3,
): ExpandResult {
  for (const id of resourceIds) requireResource(topology, id, 'expand_by_relation.anchor')
  const adj = adjacencyOf(topology, relationTypes)
  const seenResources = new Set<string>(resourceIds)
  const seenRelations = new Set<string>()
  const queue: Array<{ node: string; depth: number }> = resourceIds.map((id) => ({ node: id, depth: 0 }))
  while (queue.length > 0) {
    const { node, depth } = queue.shift()!
    if (depth >= maxDepth) continue
    for (const { to: next, relation } of adj.get(node) ?? []) {
      seenRelations.add(relation.relation_id)
      if (seenResources.has(next)) continue
      seenResources.add(next)
      queue.push({ node: next, depth: depth + 1 })
    }
  }
  const resources = topology.resources.filter((r) => seenResources.has(r.resource_id))
  const relations = topology.relations.filter((r) => seenRelations.has(r.relation_id))
  const states = topology.states.filter(
    (s) =>
      (s.subject_kind === 'RESOURCE' && seenResources.has(s.subject_ref)) ||
      (s.subject_kind === 'RELATION' && seenRelations.has(s.subject_ref)),
  )
  return { resources, relations, states }
}

/** 通用拓扑查询（§16.2 query_topology）：锚点展开 + 路径 + discovery_delta。 */
export function query_topology(request: TopologyQueryRequest): TopologyQueryResult {
  const { topology, anchor_resource_ids, relation_types, spatial_domains, max_depth } = request
  const anchors = anchor_resource_ids && anchor_resource_ids.length > 0 ? anchor_resource_ids : []
  const expanded = expand_by_relation(topology, anchors, relation_types, max_depth ?? 3)

  let resources = expanded.resources
  let relations = expanded.relations
  if (spatial_domains && spatial_domains.length > 0) {
    const allow = new Set(spatial_domains)
    resources = resources.filter((r) => allow.has(r.placement.spatial_domain))
  }

  // 路径：请求显式给出目标时返回；否则对锚点内部可达两两求最短路径（前 5 条）。
  const paths: TopologyPath[] = []
  if (anchors.length >= 2) {
    for (let i = 0; i < anchors.length - 1 && paths.length < 5; i++) {
      for (let j = i + 1; j < anchors.length && paths.length < 5; j++) {
        const found = find_paths(topology, anchors[i], anchors[j], {
          relation_types,
          limit: 1,
          max_hops: max_depth ?? 8,
        })
        paths.push(...found)
      }
    }
  }

  return {
    resources,
    relations,
    states: expanded.states,
    paths,
    discovery_delta: {
      resources: resources.map((r) => r.resource_id).filter((id) => !anchors.includes(id)),
      relations: relations.map((r) => r.relation_id),
    },
  }
}

/** 拓扑事件查询（§16.2 query_topology_events）。 */
export function query_topology_events(request: TopologyEventsQuery): TopologyEvent[] {
  const { topology, resource_refs, time_range, event_types } = request
  const refs = new Set(resource_refs)
  for (const id of resource_refs) requireResource(topology, id, 'query_topology_events.resource_ref')
  const allowTypes = event_types && event_types.length > 0 ? new Set(event_types) : null
  return topology.events.filter((e) => {
    if (!refs.has(e.source_ref) && !refs.has(e.target_ref)) return false
    if (allowTypes && !allowTypes.has(e.event_type)) return false
    if (time_range) {
      const at = e.occurred_at
      if (at == null) return time_range.start == null && time_range.end == null
      if (time_range.start != null && at < time_range.start) return false
      if (time_range.end != null && at > time_range.end) return false
    }
    return true
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// §16.2 服务对象入口（可注入规范快照后多次查询）
// ─────────────────────────────────────────────────────────────────────────────

export interface TopologyService {
  query_topology(request: Omit<TopologyQueryRequest, 'topology'>): TopologyQueryResult
  query_topology_events(request: Omit<TopologyEventsQuery, 'topology'>): TopologyEvent[]
  find_paths(from: string, to: string, opts?: PathQueryOptions): TopologyPath[]
  find_shared_resources(consumerIds: string[], opts?: SharedResourceQueryOptions): SharedResourceResult[]
  expand_by_relation(resourceIds: string[], relationTypes?: string[], maxDepth?: number): ExpandResult
}

/** 以规范 InstanceTopologySnapshot 构造可查询服务（§16.2）。 */
export function createTopologyService(topology: InstanceTopologySnapshot): TopologyService {
  return {
    query_topology: (request) => query_topology({ topology, ...request }),
    query_topology_events: (request) => query_topology_events({ topology, ...request }),
    find_paths: (from, to, opts) => find_paths(topology, from, to, opts),
    find_shared_resources: (consumerIds, opts) => find_shared_resources(topology, consumerIds, opts),
    expand_by_relation: (resourceIds, relationTypes, maxDepth) =>
      expand_by_relation(topology, resourceIds, relationTypes, maxDepth),
  }
}
