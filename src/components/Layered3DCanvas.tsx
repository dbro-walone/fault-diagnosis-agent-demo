import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { ScanSearch } from 'lucide-react'

import { LensId } from '../../schemas'
import { isStaticCrossRelation, KNOWLEDGE_LAYERS } from '@/lib/knowledge-plane'
import {
  isLayerAggregateId,
  layerCodeOfAggregateId,
  topoLayerDef,
  type LayeredModelData,
  type TopoLayerCode,
} from '@/lib/layered-topology'
import {
  buildLayered3DGraph,
  knowledgeNodePosition,
  topologyNodePosition,
} from '@/lib/layered-topology-3d'
import type {
  ActiveGraph,
  AggregateSummary,
  AggregateSummaryContext,
  GraphLink,
  GraphNode,
} from '@/lib/model-loader'
import {
  NODE_REL_SIZE,
  DOUBLE_CLICK_MS,
  brighten,
  nodeLabelHtml,
  labelSprite,
  haloSprite,
  rootHaloSprite,
  impactedRingSprite,
  highlightRingSprite,
  countBadgeSprite,
  detachedLayerTagSprite,
  linkWidthFor,
  linkParticlesFor,
  applyLogicLinkDistance,
  graphOriginSprite,
  neighborHintSprite,
  scanningVisual,
  verdictRingSprite,
  patchOrbitControlsPointerDesync,
  VERDICT_COLORS,
  PATH_COLORS,
  pathRingSprite,
  getVerdictRingTexture,
  type NodeLabelContext,
  type VerdictKey,
  type MetricChip,
} from '@/lib/three-visuals'
import { LINK_COLORS, STATUS_COLORS, cn } from '@/lib/utils'
import {
  CameraPhase,
  type CrossPlaneBinding,
  type DiagnosisPresentationVM,
  type DiagnosisScanVM,
  type ExaminedVerdict,
  type PresentationSubject,
} from '../v2'

// ---------------------------------------------------------------------------
// 相机预设（分层 3D：S1 顶带 y≈134 … S3 底带 y≈6，知识平面 y=-70）
// ---------------------------------------------------------------------------

interface CameraPreset {
  position: { x: number; y: number; z: number }
  lookAt: { x: number; y: number; z: number }
}

const LAYERED_PRESETS: Record<'OVERVIEW' | 'TOPOLOGY' | 'KNOWLEDGE', CameraPreset> = {
  OVERVIEW: { position: { x: 70, y: 30, z: 440 }, lookAt: { x: 0, y: 0, z: 0 } },
  TOPOLOGY: { position: { x: 0, y: 120, z: 350 }, lookAt: { x: 0, y: 70, z: 0 } },
  KNOWLEDGE: { position: { x: 0, y: -60, z: 280 }, lookAt: { x: 0, y: -70, z: 0 } },
}

function presetForLens(lens: LensId | undefined): CameraPreset {
  if (lens === LensId.TOPOLOGY) return LAYERED_PRESETS.TOPOLOGY
  if (lens === LensId.KNOWLEDGE) return LAYERED_PRESETS.KNOWLEDGE
  return LAYERED_PRESETS.OVERVIEW
}

// ---------------------------------------------------------------------------
// issue#6 阶段C —— 诊断循环判定标记常量
// ---------------------------------------------------------------------------

/** 已判断对象非焦点时的暗化节点色（保留结果但降低突显，"推进"后变暗）。 */
const VERDICT_DIM_COLOR: Record<ExaminedVerdict, string> = {
  ABNORMAL: '#7f1d1d',
  NORMAL: '#166534',
  IMPACTED: '#7c2d12',
  CANDIDATE: '#713f12',
}

/** 聚合锚点多对象判定时取最高优先（异常 > 候选 > 受影响 > 正常）。 */
const VERDICT_PRIORITY: Record<ExaminedVerdict, number> = {
  ABNORMAL: 4,
  CANDIDATE: 3,
  IMPACTED: 2,
  NORMAL: 1,
}

/** 扫描态（查询中）节点色。 */
const SCAN_COLOR = '#22d3ee'

/** P1：节点点击不被视为用户接管的判定窗口（pointerdown → click 同一手势内）。 */
const NODE_CLICK_GUARD_MS = 300

// ---------------------------------------------------------------------------
// P2 —— 阶段驱动视觉常量/辅助
// ---------------------------------------------------------------------------

/** ROUTE 阶段：下一调查路径预览节点高亮色（黄）。 */
const ROUTE_HIGHLIGHT_COLOR = '#facc15'

/** 稳定的空 id 集（非 ROUTE 阶段 routeHighlightIds 复用，避免每次渲染新建引用）。 */
const EMPTY_ID_SET: Set<string> = new Set()

/** P2: 近距离目标小幅平移判定 —— 目标相机位置与当前相机位置的世界距离 <50 → 短动画。 */
function shouldMicroMove(
  current: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
): boolean {
  const dx = target.x - current.x
  const dy = target.y - current.y
  const dz = target.z - current.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz) < 50
}

/** P2: ROUTE 下一路径预览黄色环（形态 + 颜色，不只靠颜色；复用判定环纹理生成）。 */
function routeRingSprite(node: GraphNode): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getVerdictRingTexture(ROUTE_HIGHLIGHT_COLOR),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  const scale = 15 + node.val * 4
  sprite.scale.set(scale, scale, 1)
  return sprite
}

/**
 * P3：多主体相机构图 —— 一屏一主体按语义主体类型取相机目标（LUI 避让 offset 已含）：
 * - node：现有 z+180 单节点构图（P1 保持）；
 * - path：路径包围盒 —— 全部 node_ids 可见节点坐标，中心 + max(diag*0.8, 180)；
 * - relation_group：成员包围球 —— primary 坐标权重 ×2（偏向主节点）；shared_resource
 *   共享资源垂直展开 → 镜头略上抬，peer 平视；
 * - terminal：根因链 + 影响链共同 fit，镜头更远（diag*1.0）让全链可见。
 * 任一主体无可解析坐标时返回 null（调用方跳过飞行，防 NaN/undefined 空白画面）。
 */
function subjectCameraTarget(
  subject: PresentationSubject,
  model: LayeredModelData,
  safeOffsetX: number,
): { cameraPos: { x: number; y: number; z: number }; lookAt: { x: number; y: number; z: number } } | null {
  if (subject.kind === 'node') {
    const n = model.nodesById.get(subject.primary_id)
    if (!n) return null
    const tx = n.fx ?? n.x
    const ty = n.fy ?? n.y
    const tz = n.fz ?? n.z
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || !Number.isFinite(tz)) return null
    return {
      cameraPos: { x: tx + safeOffsetX, y: ty, z: tz + 180 },
      lookAt: { x: tx, y: ty, z: tz },
    }
  }

  // path / relation_group / terminal：包围盒构图。
  const ids = subject.kind === 'relation_group' ? subject.member_ids : subject.node_ids
  const weightOf = (id: string): number =>
    subject.kind === 'relation_group' && id === subject.primary_id ? 2 : 1
  const coords = ids
    .map((id) => model.nodesById.get(id))
    .filter((n): n is GraphNode => !!n)
    .map((n) => ({ x: n.fx ?? n.x, y: n.fy ?? n.y, z: n.fz ?? n.z, w: weightOf(n.id) }))
    .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z))
  if (coords.length === 0) return null

  const totalW = coords.reduce((s, c) => s + c.w, 0)
  const cx = coords.reduce((s, c) => s + c.x * c.w, 0) / totalW
  const cy = coords.reduce((s, c) => s + c.y * c.w, 0) / totalW
  const cz = coords.reduce((s, c) => s + c.z * c.w, 0) / totalW
  const minX = coords.reduce((s, c) => Math.min(s, c.x), coords[0].x)
  const maxX = coords.reduce((s, c) => Math.max(s, c.x), coords[0].x)
  const minY = coords.reduce((s, c) => Math.min(s, c.y), coords[0].y)
  const maxY = coords.reduce((s, c) => Math.max(s, c.y), coords[0].y)
  const minZ = coords.reduce((s, c) => Math.min(s, c.z), coords[0].z)
  const maxZ = coords.reduce((s, c) => Math.max(s, c.z), coords[0].z)
  const diag = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2)
  // 终态：全链可见，镜头更远（diag*1.0）；path/relation_group：0.8 倍对角线（下限 180）。
  const zScale = subject.kind === 'terminal' ? 1.0 : 0.8
  // relation_group：shared_resource 共享资源垂直展开 → 镜头略上抬（斜俯视），peer 平视。
  const yBias =
    subject.kind === 'relation_group' && subject.relation === 'shared_resource'
      ? (maxY - minY) * 0.5
      : 0
  return {
    cameraPos: { x: cx + safeOffsetX, y: cy + yBias, z: cz + Math.max(diag * zScale, 180) },
    lookAt: { x: cx, y: cy, z: cz },
  }
}

/**
 * BFS 沿物理拓扑邻接表桥接 from→to，返回路径中间节点 + 链路无序 key（含 to，不含 from）。
 * 找不到连通路径返回 null。供排查证据路径（已走过 trail / 当前入边）复用。
 */
function bridgePath(
  adj: Map<string, string[]>,
  from: string,
  to: string,
  linkKeyOf: (a: string, b: string) => string,
): { members: string[]; edges: string[] } | null {
  if (from === to) return null
  const parent = new Map<string, string>()
  const queue = [from]
  const seen = new Set([from])
  let found = false
  while (queue.length && !found) {
    const cur = queue.shift()!
    for (const next of adj.get(cur) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      parent.set(next, cur)
      if (next === to) {
        found = true
        break
      }
      queue.push(next)
    }
  }
  if (!found) return null
  const members: string[] = []
  const edges: string[] = []
  let cur = to
  while (cur !== from) {
    const p = parent.get(cur)
    if (!p) break
    members.push(cur)
    edges.push(linkKeyOf(cur, p))
    cur = p
  }
  return { members, edges }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface Layered3DCanvasProps {
  /** 分层拓扑模型（buildLayeredModelData 产物，任意 Case）。 */
  model: LayeredModelData
  /** 层展开状态（域/子层 code → expanded）。 */
  expandedLayers: Partial<Record<TopoLayerCode, boolean>>
  /** 点击聚合头/双击聚合节点切换展开。 */
  onToggleLayer: (code: TopoLayerCode) => void
  /** 聚合摘要运行时上下文（docs/05 §5：候选/受影响/关键对象）。 */
  aggregateContext: AggregateSummaryContext
  /** 关键对象 ids（agent_focus ∪ 根因，DETACHED 保留）。 */
  criticalObjectIds: Set<string>
  /** agent_focus 高亮 ids（Runtime 驱动）。 */
  agentFocusIds: Set<string>
  /** 已确认根因 ids。 */
  rootCauseIds: Set<string>
  /** 受影响 ids（impact_chain）。 */
  impactedIds: Set<string>
  /** F2 活动逻辑路径（根因 → 证据 → 影响链）：渲染红色 3D 逻辑链。 */
  logicPath: string[]
  selectedNodeId: string | null
  /** F0：左侧 Object Explorer 是否收起（收起时画布左起点移到边缘）。 */
  navigatorCollapsed: boolean
  /** issue#7 D：右侧 LUI 占用宽度（px）→ 画布右边界左移避让，不被 LUI 遮挡。0 表示不避让。 */
  rightInset?: number
  /** 当前透镜（驱动相机：TOPOLOGY/KNOWLEDGE/其余→OVERVIEW）。 */
  activeLens?: LensId
  onNodeSelect: (id: string | null) => void
  /** 下层故障知识图谱节点（plane==='knowledge'，来自静态 knowledge-graph 模型）。 */
  knowledgeNodes: GraphNode[]
  /** 下层故障知识图谱连线（category==='knowledge'）。 */
  knowledgeLinks: GraphLink[]
  /** 图谱分层显隐（layer code → visible；与 ModelNavigator Knowledge layers 分区联动）。 */
  visibleKgLayers?: Record<string, boolean>
  /** issue#6 阶段C：逐对象诊断循环 view-model（聚焦→查询→判断→推进 + 图谱点亮）。 */
  diagnosisScan?: DiagnosisScanVM | null
  /**
   * 阶段3：当前 ACTIVE CrossPlaneBinding（docs/19 §6.2）。
   * 跨平面光柱/曲线只由 ACTIVE Binding 生成；诊断推进时动态绑定激活即点亮。
   */
  activeBindings?: CrossPlaneBinding[]
  /** P1: PresentationVM 的语义主体——变化时驱动相机飞行。 */
  presentationSubject?: PresentationSubject | null
  /** P1: focus_signature——变化才触发 Travel（同节点多 Skill 合并为一次停留）。 */
  focusSignature?: string | null
  /** P1: 是否跟随 Agent（false = 用户已接管，相机不动）。 */
  followAgent?: boolean
  /** P1: 用户接管相机（画布拖拽/滚轮）通知 App（设为 MANUAL，停止跟随）。 */
  onUserInteract?: () => void
  /** P2: 当前镜头阶段（驱动 FOCUS 淡化 / CONTEXT 拉远 / ROUTE 高亮）。 */
  cameraPhase?: CameraPhase
  /** P2: 播放速度（2x/4x 时压缩或跳过 CONTEXT/ROUTE 低价值阶段视觉）。 */
  playbackSpeed?: number
  /** P2: PresentationVM 完整数据（route_object_ids / context_object_ids 驱动阶段视觉）。 */
  presentation?: DiagnosisPresentationVM | null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Layered3DCanvas(props: Layered3DCanvasProps) {
  const {
    model,
    expandedLayers,
    onToggleLayer,
    aggregateContext,
    criticalObjectIds,
    agentFocusIds,
    rootCauseIds,
    impactedIds,
    logicPath,
    selectedNodeId,
    navigatorCollapsed,
    rightInset,
    activeLens,
    onNodeSelect,
    knowledgeNodes,
    knowledgeLinks,
    visibleKgLayers,
    diagnosisScan,
    activeBindings,
    presentationSubject,
    focusSignature,
    followAgent,
    onUserInteract,
    cameraPhase,
    playbackSpeed,
    presentation,
  } = props

  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)
  /** P4.6：调试面板开关（默认隐藏，按 D 切换）。 */
  const [debugPanel, setDebugPanel] = useState(false)
  /** issue#6 阶段C：当前扫描态扫掠精灵（nodeId → sweep），RAF 循环旋转。 */
  const scanningSweepsRef = useRef<Map<string, THREE.Sprite>>(new Map())
  /** issue#6 阶段C：最新诊断循环 view-model（RAF 循环只读，避免闭包捕获旧值）。 */
  const diagnosisScanRef = useRef<DiagnosisScanVM | null>(diagnosisScan ?? null)
  /** issue#7 C3：排查推进时自动展开的层 code（信息条徽标；effect 先写、渲染后读）。 */
  const autoExpandedLayerRef = useRef<TopoLayerCode | null>(null)
  /** P1：程序化相机运动标记（区分 cameraPosition 程序化飞行 vs 用户 OrbitControls 输入）。 */
  const programmaticMoveRef = useRef(false)
  /** P2：程序化飞行令牌 —— 每次飞行递增（flyCameraTo 统一管理），防止旧动画/旧阶段
   *  效果覆盖新主体；'start' 处理器只消费最新飞行的程序化标志。 */
  const animationTokenRef = useRef(0)
  /** P1：已飞到的 focus_signature（同主体不重复 Travel；用户接管时清空以便返回重飞）。 */
  const flewSignatureRef = useRef<string | null>(null)
  /** P1：用户接管回调 / LUI 避让宽度最新值 ref（相机飞行 effect 闭包只读 ref，避免过期捕获）。 */
  const onUserInteractRef = useRef(onUserInteract)
  const rightInsetRef = useRef(rightInset)

  // Latest-value refs so the once-created graph instance never captures stale state.
  const selectedRef = useRef<string | null>(selectedNodeId)
  const hoverRef = useRef<string | null>(null)
  const agentFocusRef = useRef<Set<string>>(agentFocusIds)
  const rootCauseRef = useRef<Set<string>>(rootCauseIds)
  const impactedRef = useRef<Set<string>>(impactedIds)
  const summariesRef = useRef<Map<string, AggregateSummary>>(new Map())
  const expandedLayersRef = useRef<Partial<Record<TopoLayerCode, boolean>>>(expandedLayers)
  const highlightKnowledgeRef = useRef<Set<string>>(new Set())
  const highlightTopologyRef = useRef<Set<string>>(new Set())
  const selectedIsTopologyRef = useRef(false)
  const selectedIsKnowledgeRef = useRef(false)
  const onSelectRef = useRef(onNodeSelect)
  const onToggleLayerRef = useRef(onToggleLayer)
  const lastNodeClickRef = useRef<{ id: string; time: number } | null>(null)

  // issue #5 B0：节点缓存按 id 复用，保留力导向已布局位置，避免每 tick 全量重排。
  const nodeCacheRef = useRef<Map<string, GraphNode>>(new Map())
  const dataSignatureRef = useRef('')

  selectedRef.current = selectedNodeId
  agentFocusRef.current = agentFocusIds
  rootCauseRef.current = rootCauseIds
  impactedRef.current = impactedIds
  expandedLayersRef.current = expandedLayers
  onSelectRef.current = onNodeSelect
  onToggleLayerRef.current = onToggleLayer
  diagnosisScanRef.current = diagnosisScan ?? null
  onUserInteractRef.current = onUserInteract
  rightInsetRef.current = rightInset

  /**
   * P2：统一程序化飞行入口 —— 递增动画令牌 + 置程序化运动标志。所有阶段驱动的
   * 相机移动（lens 预设 / focus flight / CONTEXT 拉远 / ROUTE 重规划拉远）都经此，保证：
   * - 新飞行总是覆盖旧飞行（令牌递增，旧效果不残留标志）；
   * - OrbitControls 'start' 处理器能区分"程序化飞行中" vs "用户接管"。
   * P4.1：程序化标志清理移到 token 校验定时器 —— 动画完成后检查令牌，只有仍是最新
   * 飞行的定时器才清除标志；旧飞行的清零定时器（token 不匹配）直接跳过，不再在
   * 新飞行尚未完成时误吞用户接管信号。
   * P4.5：prefers-reduced-motion 时动画时长为 0（直接跳转，不播动画）。
   */
  const flyCameraTo = useCallback(
    (
      graphInstance: any,
      pos: { x: number; y: number; z: number },
      lookAt: { x: number; y: number; z: number },
      duration: number,
    ): void => {
      const token = ++animationTokenRef.current
      programmaticMoveRef.current = true
      const reducedMotion =
        (typeof window !== 'undefined' &&
          window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) ||
        false
      const actualDuration = reducedMotion ? 0 : duration
      graphInstance.cameraPosition(pos, lookAt, actualDuration)
      window.setTimeout(() => {
        if (animationTokenRef.current === token) {
          programmaticMoveRef.current = false
        }
      }, actualDuration + 200)
    },
    [],
  )

  /** 3D 分层活动图：拓扑（S1→S3 分层）+ 图谱（分层 X 列）+ 跨层 + 红逻辑链。
   *  issue#9：诊断态（diagnosisScan != null）聚焦链路 —— 拓扑只显示诊断链路、
   *  图谱只显示命中子图；非诊断恢复全拓扑+全图谱（浏览态冷冻）。 */
  const graph = useMemo(
    () =>
      buildLayered3DGraph({
        model,
        expandedLayers,
        criticalObjectIds,
        knowledgeNodes,
        knowledgeLinks,
        visibleKgLayers,
        logicPath,
        selectedNodeId,
        aggregateContext,
        activeBindings,
        diagnosisScan,
      }),
    [
      model,
      expandedLayers,
      criticalObjectIds,
      knowledgeNodes,
      knowledgeLinks,
      visibleKgLayers,
      logicPath,
      selectedNodeId,
      aggregateContext,
      activeBindings,
      diagnosisScan,
    ],
  )

  // 同步派生集到 refs（访问器只读 refs，保持图实例稳定）。
  summariesRef.current = graph.summaries
  highlightKnowledgeRef.current = graph.highlightedKnowledge
  highlightTopologyRef.current = graph.highlightedTopology
  selectedIsTopologyRef.current = graph.selectedIsTopology
  selectedIsKnowledgeRef.current = graph.selectedIsKnowledge

  /**
   * issue#6 阶段C：被排查对象判定 → 可见锚点判定。
   * 对象经 anchorByObjectId 映射到可见锚点（成员/聚合头）；聚合锚点多对象取最高优先判定。
   */
  const verdictByAnchorId = useMemo(() => {
    const map = new Map<string, ExaminedVerdict>()
    if (!diagnosisScan) return map
    for (const obj of diagnosisScan.examined_objects) {
      if (!obj.verdict) continue
      const anchor = graph.anchorByObjectId.get(obj.object_id) ?? obj.object_id
      const existing = map.get(anchor)
      if (!existing || VERDICT_PRIORITY[obj.verdict] > VERDICT_PRIORITY[existing]) {
        map.set(anchor, obj.verdict)
      }
    }
    return map
  }, [diagnosisScan, graph])

  /** 聚焦对象上下游一跳相关锚点（聚焦态弱提示，docs/07 §6）。 */
  const focusNeighborAnchors = useMemo(() => {
    const set = new Set<string>()
    const focusId = diagnosisScan?.active_query_object_id ?? diagnosisScan?.focus_object_id ?? null
    if (!focusId) return set
    const anchorOf = (id: string) => graph.anchorByObjectId.get(id) ?? id
    for (const link of model.links) {
      const a = link.source as string
      const b = link.target as string
      if (a === focusId) set.add(anchorOf(b))
      else if (b === focusId) set.add(anchorOf(a))
    }
    set.delete(anchorOf(focusId))
    return set
  }, [diagnosisScan, model, graph])

  /** 连线端点的稳定无序 key（A↔B，跨 source/target 方向一致）。 */
  const linkKeyOf = (a: string, b: string): string => (a < b ? `${a}↔${b}` : `${b}↔${a}`)
  /**
   * 3d-force-graph 对 graphData 的 link source/target 做了节点对象化（graphData().links 里
   * source/target 是 node 引用而非 id）。访问器里必须取回 id 再参与 linkKeyOf，否则 key 恒为
   * `[object Object]↔…`，与 pathVisual.edgeKeys（id 键）永不匹配，排查路径边高亮/细线失效。
   */
  const idOf = (x: unknown): string => {
    if (typeof x === 'object' && x !== null && 'id' in (x as Record<string, unknown>)) {
      return (x as { id: string }).id
    }
    return x as string
  }
  const linkEndpoints = (link: GraphLink): [string, string] => {
    return [idOf(link.source), idOf(link.target)]
  }

  /**
   * 排查证据路径（本轮优化 #2/#4 + 对齐点①/②，issue#10 单点聚焦收严）：
   * 已排查（path_object_ids）拓扑节点按序累积，相邻节点沿物理拓扑 BFS 桥接，形成"排查证据路径"：
   * - walked：已走过目标锚点（PLANNER seq 序，与右侧 PLANNER 一一对应）→ 弱化灰 trail；
   * - members：walked ∪ 物理链桥接中间节点；
   * - edgeKeys：已走过链路（含桥接段）的无序 key → 弱化灰一档；
   * - activeEdgeKeys：当前推进节点（activeQuery/focus，尚未入 walked）到上一已走过锚点的
   *   入边 → 淡青（推进方向）；当前节点本身用扫描视觉做唯一活动高亮；
   * - currentAnchor：当前推进节点锚点（无论是否已入 walked，均为"当前"——单点聚焦主体）。
   */
  const pathVisual = useMemo(() => {
    // 当前推进节点（activeQuery > focus）锚点——"当前"是单点聚焦主体，不入"已走过"trail。
    const currentRaw =
      diagnosisScan?.active_query_object_id ?? diagnosisScan?.focus_object_id ?? null
    const currentAnchor = currentRaw
      ? (graph.anchorByObjectId.get(currentRaw) ?? currentRaw)
      : null

    // 已走过 trail：path_object_ids 含"当前正在验证"的目标（Planner active），需剔除以保证
    // 当前节点是唯一活动点；其余按 PLANNER seq 序累积。
    const walked: string[] = []
    for (const oid of diagnosisScan?.path_object_ids ?? []) {
      const anchor = graph.anchorByObjectId.get(oid) ?? oid
      if (anchor === currentAnchor) continue
      if (!walked.includes(anchor)) walked.push(anchor)
    }
    const walkedSet = new Set<string>(walked)
    const members = new Set<string>(walked)
    const edgeKeys = new Set<string>()
    const activeEdgeKeys = new Set<string>()

    // 仅物理拓扑连线参与桥接（跨层/知识/逻辑链不算排查路径）。
    const adj = new Map<string, string[]>()
    for (const l of graph.links) {
      if (l.category !== 'topology') continue
      const [a, b] = linkEndpoints(l)
      if (!adj.has(a)) adj.set(a, [])
      adj.get(a)!.push(b)
      if (!adj.has(b)) adj.set(b, [])
      adj.get(b)!.push(a)
    }

    for (let i = 0; i < walked.length - 1; i++) {
      const r = bridgePath(adj, walked[i], walked[i + 1], linkKeyOf)
      if (!r) continue
      for (const m of r.members) members.add(m)
      for (const e of r.edges) edgeKeys.add(e)
    }

    // 当前推进节点 → 上一已走过锚点的入边点亮（推进方向，淡青）；当前节点本体用扫描视觉。
    if (currentAnchor) {
      const from = walked[walked.length - 1]
      if (from !== undefined) {
        const r = bridgePath(adj, from, currentAnchor, linkKeyOf)
        if (r) {
          for (const m of r.members) members.add(m)
          for (const e of r.edges) activeEdgeKeys.add(e)
        }
      }
    }
    return { walked: walkedSet, members, edgeKeys, activeEdgeKeys, currentAnchor }
  }, [diagnosisScan, graph])

  /**
   * P2：FOCUS/INSPECT 淡化集 —— 非主体（subject 成员 ∪ context_object_ids）且非诊断
   * 上下文（图谱命中/扫描锚点）的节点在 nodeColorFor 兜底降透明度。null 表示不淡化
   * （非 FOCUS/INSPECT 阶段或浏览态）。语义高亮（扫描/路径/判定/选中）优先于淡化。
   */
  const p2DimmedIds = useMemo(() => {
    if (cameraPhase !== CameraPhase.FOCUS && cameraPhase !== CameraPhase.INSPECT) return null
    if (!presentationSubject) return null
    const keep = new Set<string>()
    const subject = presentationSubject
    if (subject.kind === 'node') {
      keep.add(subject.primary_id)
    } else if (subject.kind === 'path') {
      for (const id of subject.node_ids) keep.add(id)
    } else if (subject.kind === 'relation_group') {
      for (const id of subject.member_ids) keep.add(id)
    } else {
      for (const id of subject.node_ids) keep.add(id)
    }
    for (const id of presentation?.context_object_ids ?? []) keep.add(id)
    // 诊断取证上下文（图谱命中/扫描锚点）保持可见。
    if (diagnosisScan) {
      for (const id of diagnosisScan.graph_entry_anchors) keep.add(id)
      for (const id of diagnosisScan.graph_lit_knowledge_ids) keep.add(id)
    }
    return keep
  }, [cameraPhase, presentationSubject, presentation, diagnosisScan])

  /**
   * P2：ROUTE 阶段下一调查路径预览节点（黄色高亮）。2x/4x 倍速跳过低价值视觉
   * （倍速策略合并 Context+Route）；非 ROUTE 阶段复用稳定空集避免无谓重渲染。
   */
  const routeHighlightIds = useMemo(() => {
    if (cameraPhase !== CameraPhase.ROUTE || !presentation || (playbackSpeed ?? 1) >= 2) {
      return EMPTY_ID_SET
    }
    return new Set(presentation.route_object_ids)
  }, [cameraPhase, presentation, playbackSpeed])

  /** 已排查节点 → 指标（名称+数值+分级着色，最多 3 个；聚合锚点多对象合并）。
   *  不常显 sprite（3D 里过小看不清），改为节点悬浮 tooltip 呈现（hoverMetrics）。 */
  const chipsByAnchorId = useMemo(() => {
    const map = new Map<string, MetricChip[]>()
    const rank: Record<MetricChip['tone'], number> = { critical: 0, warning: 1, normal: 2 }
    for (const obj of diagnosisScan?.examined_objects ?? []) {
      if (!obj.metrics || obj.metrics.length === 0) continue
      const anchor = graph.anchorByObjectId.get(obj.object_id) ?? obj.object_id
      const merged = [...(map.get(anchor) ?? []), ...obj.metrics]
        .sort((a, b) => rank[a.tone] - rank[b.tone])
        .slice(0, 3)
      map.set(anchor, merged)
    }
    return map
  }, [diagnosisScan, graph])

  /** 指标悬浮只读 ref：tooltip 的 nodeLabel 访问器在画布创建时绑定一次，闭包经 ref
   *  读最新指标映射（与 summariesRef 等既有 Latest-value ref 模式一致）。 */
  const chipsByAnchorRef = useRef<Map<string, MetricChip[]>>(new Map())
  chipsByAnchorRef.current = chipsByAnchorId

  /** 结构签名：节点 id 集 + 连线(source→target:category)。仅结构变化时重绑。 */
  const graphDataSignature = (gd: ActiveGraph): string => {
    const nodeIds = gd.nodes.map((n) => n.id).sort().join(',')
    const linkSig = gd.links
      .map((l) => `${l.source}->${l.target}:${l.category}`)
      .sort()
      .join(',')
    return `${nodeIds}|${linkSig}`
  }

  /**
   * issue#8 浏览态冷冻（需求2①）：浏览态与诊断态都锁层高/节点位置 —— 把拓扑/知识节点
   * 的自由轴（拓扑 x / 知识 z）钉到当前坐标，d3 力导向无法再把节点推走，节点位置稳定不闪。
   * 保留相机视角切换、展开/聚合、放大缩小；节点拖拽关闭（enableNodeDrag(false)），
   * 不允许浏览态拖拽把层/节点拉散。展开聚合层是一次性主动动作：成员节点首次出现即按
   * memberBandX 均匀排布（buildLayered3DGraph 已定坐标），随后恢复稳定。
   * 只解除"由冻结打上的钉"（__frozenByDiagnosis 标记），不干扰用户拖拽后 rePinNode
   * 停留的自由轴钉（当前拖拽关闭，rePinNode 保留为防御）。
   */
  const freezeLayout = true
  const freezeFreeAxis = (node: GraphNode): void => {
    const raw = node as unknown as Record<string, unknown>
    if (node.plane === 'topology') {
      if (node.x !== undefined) {
        raw.fx = node.x
        raw.__frozenByDiagnosis = true
      }
    } else if (node.z !== undefined) {
      raw.fz = node.z
      raw.__frozenByDiagnosis = true
    }
  }
  const unfreezeFreeAxis = (node: GraphNode): void => {
    const raw = node as unknown as Record<string, unknown>
    if (raw.__frozenByDiagnosis !== true) return
    if (node.plane === 'topology') raw.fx = undefined
    else raw.fz = undefined
    raw.__frozenByDiagnosis = false
    // 零速度，避免解除冻结瞬间 d3 惯性把节点弹走。
    raw.vx = 0
    raw.vy = 0
    raw.vz = 0
  }

  /** 按 id 复用节点：保留已布局自由轴（拓扑 x / 知识 z）与拖拽停留位置，刷新固定轴。 */
  const stabilizeNodes = (nodes: GraphNode[], freeze: boolean): GraphNode[] => {
    const cache = nodeCacheRef.current
    return nodes.map((node) => {
      const cached = cache.get(node.id)
      if (!cached) {
        cache.set(node.id, node)
        if (freeze) freezeFreeAxis(node)
        return node
      }
      cached.label = node.label
      cached.color = node.color
      cached.healthStatus = node.healthStatus
      cached.alwaysLabel = node.alwaysLabel
      cached.val = node.val
      cached.kind = node.kind
      cached.group = node.group
      cached.groupName = node.groupName
      cached.object = node.object
      // 固定轴随新节点刷新（层归属稳定）；自由轴保留（未固定则维持 undefined / 拖拽停留值）。
      if (node.fx !== undefined) cached.fx = node.fx
      if (node.fy !== undefined) cached.fy = node.fy
      if (node.fz !== undefined) cached.fz = node.fz
      // issue#7 P0：缓存复用节点坐标必须是 number（3d-force-graph 布局/d3-force
      // 读取 node.x；undefined 会被 isNaN 覆盖成随机位置，导致节点"跳走"或渲染 NaN）。
      // 任一坐标缺失时按新节点所属平面补位（拓扑 x 自由取散列，知识 z 自由取散列）。
      if (
        cached.x === undefined ||
        cached.y === undefined ||
        cached.z === undefined
      ) {
        const pos =
          node.plane === 'topology'
            ? topologyNodePosition(node)
            : knowledgeNodePosition(node)
        if (cached.x === undefined) cached.x = pos.x
        if (cached.y === undefined) cached.y = pos.y
        if (cached.z === undefined) cached.z = pos.z
      }
      if (freeze) freezeFreeAxis(cached)
      else unfreezeFreeAxis(cached)
      return cached
    })
  }

  const stableNodes = useMemo(
    () => stabilizeNodes(graph.nodes, freezeLayout),
    [graph, freezeLayout],
  )
  const graphData = useMemo<ActiveGraph>(
    () => ({ nodes: stableNodes, links: graph.links }),
    [stableNodes, graph.links],
  )

  /** 拖拽结束后把节点拉回所属层带：拓扑 x 停留 + 域带 Y/子层 Z 归位；知识 z 停留 + 图谱列/平面归位。 */
  const rePinNode = (node: GraphNode): void => {
    if (node.plane === 'topology') {
      const pos = topologyNodePosition(node)
      node.fx = node.x
      node.fy = pos.fy!
      node.fz = pos.fz!
    } else {
      const pos = knowledgeNodePosition(node)
      node.fx = pos.fx!
      node.fy = pos.fy!
      node.fz = node.z
    }
  }

  /**
   * 节点颜色（docs/04 §8 优先级：ROOT_CAUSE > IMPACTED > AGENT_FOCUS > 选中/悬停 > 跨层关联 > 基础层色）。
   * issue#6 阶段C 追加：扫描态（查询中）最高优先；已判断对象按判定暗化；聚焦上下游一跳弱提示；
   * 下层图谱原始点金色、关联知识点 teal。
   * issue#10 单点聚焦：诊断态只有"当前推进节点"一个活动高亮（SCAN_COLOR 青白）；
   * 已走过节点弱化灰、判定/异常保留暗色小标记，均不与当前节点抢主体。
   */
  const nodeColorFor = (node: GraphNode): string => {
    const scan = diagnosisScan
    if (node.plane === 'knowledge') {
      if (scan?.graph_entry_anchors.includes(node.id)) return VERDICT_COLORS.CANDIDATE
      if (scan?.graph_lit_knowledge_ids.includes(node.id)) return '#2dd4bf'
      if (node.id === selectedRef.current || node.id === hoverRef.current) return brighten(node.color)
      if (highlightKnowledgeRef.current.has(node.id)) return '#2dd4bf'
      return node.color
    }
    if (scan) {
      // 诊断态单点聚焦：当前推进节点是唯一活动高亮（即使已入 walked 也优先）。
      if (pathVisual.currentAnchor === node.id) return SCAN_COLOR
      // 已走过排查路径节点：弱化灰（非活动背景形态，保留"已排查"累积信息）。
      if (pathVisual.walked.has(node.id)) return PATH_COLORS.node
    } else {
      // 浏览态：root/impacted/agent_focus 语义保留（诊断中收敛为单点，不叠加多类高亮）。
      if (rootCauseRef.current.has(node.id)) return STATUS_COLORS.fault
      if (impactedRef.current.has(node.id)) return STATUS_COLORS.warning
      if (agentFocusRef.current.has(node.id)) return STATUS_COLORS.active
    }
    // P2：ROUTE 阶段下一路径预览节点黄色高亮（低于当前推进节点/已走过路径优先级）。
    if (routeHighlightIds.has(node.id)) return ROUTE_HIGHLIGHT_COLOR
    // 判定/异常标记：暗色小标记（诊断中不与当前节点抢主体；浏览态保留形态语义）。
    const verdict = verdictByAnchorId.get(node.id)
    if (verdict) return VERDICT_DIM_COLOR[verdict]
    if (node.id === selectedRef.current || node.id === hoverRef.current) return brighten(node.color)
    if (focusNeighborAnchors.has(node.id)) return 'rgba(103, 232, 249, 0.65)'
    if (highlightTopologyRef.current.has(node.id)) return '#2dd4bf'
    // P2：FOCUS/INSPECT —— 非主体非上下文的中性节点淡化（语义高亮优先，仅兜底）。
    if (p2DimmedIds && !p2DimmedIds.has(node.id)) return 'rgba(100, 116, 139, 0.35)'
    return node.color
  }

  /** 成员节点因层收起而 DETACHED 时，给出所属层标签。 */
  const detachedLayerLabelFor = (node: GraphNode): string | null => {
    if (isLayerAggregateId(node.id)) return null
    const layerCode = node.group as TopoLayerCode
    const def = topoLayerDef(layerCode)
    if (expandedLayersRef.current[layerCode] === true) return null
    if (expandedLayersRef.current[def.domain] === true) return def.name
    return topoLayerDef(def.domain).name
  }

  /** Tooltip context：聚合摘要优先，其次 DETACHED 关键成员所属层；已排查节点附关键指标。 */
  const labelContextFor = (node: GraphNode): NodeLabelContext => {
    const summary = summariesRef.current.get(node.id)
    if (summary) return { summary, metrics: chipsByAnchorRef.current.get(node.id) }
    const detachedLayer = detachedLayerLabelFor(node)
    if (detachedLayer) return { detachedLayerLabel: detachedLayer, metrics: chipsByAnchorRef.current.get(node.id) }
    const metrics = chipsByAnchorRef.current.get(node.id)
    return metrics ? { metrics } : {}
  }

  /**
   * 常显名称标签：浏览态沿用模型配置；诊断态为全部真实拓扑节点显示资源名称。
   * 聚合头与知识节点不额外放开，避免标签密度过高。node.label 由 LayeredResource.name 派生。
   */
  const shouldShowNodeLabel = (node: GraphNode): boolean =>
    node.alwaysLabel ||
    (diagnosisScan != null && node.plane === 'topology' && !isLayerAggregateId(node.id))

  /** Per-node 3D object：聚合头徽标、DETACHED 层标签、跨层关联环、agent/根因光晕、
   *  issue#6 阶段C：扫描雷达、判定环、上下游一跳提示、图谱原始点/关联点亮。 */
  const nodeThreeObjectFor = (node: GraphNode): THREE.Object3D => {
    const group = new THREE.Group()
    const scan = diagnosisScan

    if (node.plane === 'knowledge') {
      if (scan?.graph_entry_anchors.includes(node.id)) group.add(graphOriginSprite(node))
      else if (scan?.graph_lit_knowledge_ids.includes(node.id)) group.add(highlightRingSprite(node))
      if (highlightKnowledgeRef.current.has(node.id)) group.add(highlightRingSprite(node))
    } else {
      const isCurrent = pathVisual.currentAnchor === node.id
      if (isCurrent) {
        // 当前推进节点：唯一活动高亮（雷达底座 + 扫掠；focus 非 activeQuery 亦用扫描视觉）。
        const visual = scanningVisual(node)
        scanningSweepsRef.current.set(node.id, visual.sweep)
        group.add(visual)
      }
      if (!scan) {
        // 浏览态：root/impacted/agent_focus 光环语义保留；诊断中收敛为单点不叠加。
        if (rootCauseRef.current.has(node.id)) group.add(rootHaloSprite(node))
        else if (impactedRef.current.has(node.id)) group.add(impactedRingSprite(node))
        if (agentFocusRef.current.has(node.id) && !isCurrent) group.add(haloSprite(node))
      }
      // 已走过路径的桥接中间节点（物理链上非目标）：弱化 trail 环，形成连续证据路径。
      if (
        !isCurrent &&
        pathVisual.members.has(node.id) &&
        !pathVisual.walked.has(node.id)
      ) {
        group.add(pathRingSprite(node))
      }
      // P2：ROUTE 阶段下一路径预览黄色环（形态 + 颜色组合，不只靠颜色）。
      if (!isCurrent && routeHighlightIds.has(node.id)) {
        group.add(routeRingSprite(node))
      }
      const verdict = verdictByAnchorId.get(node.id)
      if (verdict && !isCurrent) {
        group.add(verdictRingSprite(node, verdict as VerdictKey))
      }
      if (focusNeighborAnchors.has(node.id) && !isCurrent) group.add(neighborHintSprite(node))
      if (highlightTopologyRef.current.has(node.id)) group.add(highlightRingSprite(node))
      // 指标不再常显为 3D 小标签（过小/视角遮挡看不清）——由节点悬浮 tooltip 呈现。
    }
    const summary = summariesRef.current.get(node.id)
    if (summary) {
      group.add(countBadgeSprite(summary))
      if (shouldShowNodeLabel(node)) group.add(labelSprite(node))
      return group
    }
    const detachedLayer = detachedLayerLabelFor(node)
    if (detachedLayer) group.add(detachedLayerTagSprite(node, detachedLayer))
    if (shouldShowNodeLabel(node)) group.add(labelSprite(node))
    return group
  }

  /** 跨层连线是否命中当前选中（点选拓扑 → 其图谱映射；点选图谱 → 关联拓扑）。 */
  const isCrossLinkActive = (link: GraphLink): boolean => {
    const sel = selectedRef.current
    if (!sel) return false
    const [srcId, tgtId] = linkEndpoints(link)
    if (selectedIsTopologyRef.current) return srcId === sel || tgtId === sel
    if (selectedIsKnowledgeRef.current) {
      return tgtId === sel || highlightTopologyRef.current.has(srcId)
    }
    return false
  }

  const linkColorFor = (link: GraphLink): string => {
    if (link.category === 'logic') return LINK_COLORS.logic
    const key = linkKeyOf(...linkEndpoints(link))
    // 排查证据路径：当前推进节点的入边全亮（对齐点①），已走过链路低亮一档（对齐点②）。
    if (pathVisual.activeEdgeKeys.has(key)) return PATH_COLORS.edgeActive
    if (pathVisual.edgeKeys.has(key)) return PATH_COLORS.edge
    if (link.category === 'cross') {
      if (isCrossLinkActive(link)) return 'rgba(20, 184, 166, 0.95)'
      // 阶段3：静态 Binding（INSTANCE_OF 等）淡显；动态 Binding（候选/证据/根因
      // 激活的 ACTIVE）跨层点亮为 teal。
      return isStaticCrossRelation(link.relation)
        ? 'rgba(148, 163, 184, 0.22)'
        : 'rgba(20, 184, 166, 0.5)'
    }
    if (link.category === 'topology') return LINK_COLORS.topology
    if (link.category === 'knowledge') return LINK_COLORS.knowledge
    return 'rgba(45, 212, 191, 0.5)'
  }

  /** 路径链路（issue#10 单点聚焦：当前入边略粗以显推进方向；已走过链路细线弱化，不抢主体）。 */
  const linkWidthAccessor = (link: GraphLink): number => {
    const key = linkKeyOf(...linkEndpoints(link))
    if (pathVisual.activeEdgeKeys.has(key)) return 2.4
    if (pathVisual.edgeKeys.has(key)) return 1.2
    return linkWidthFor(link, false)
  }

  /** Re-apply node/link style accessors. Fresh instances force re-eval. */
  const refreshAppearance = (): void => {
    const graphInstance = graphRef.current
    if (!graphInstance) return
    graphInstance.nodeColor((node: GraphNode) => nodeColorFor(node))
    graphInstance.nodeThreeObject((node: GraphNode) => nodeThreeObjectFor(node))
    graphInstance
      .linkColor((link: GraphLink) => linkColorFor(link))
      .linkWidth((link: GraphLink) => linkWidthAccessor(link))
      .linkDirectionalParticles((link: GraphLink) => linkParticlesFor(link, false))
  }

  // --- create the graph instance once -------------------------------------

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let graphInstance: any
    let ro: ResizeObserver | undefined
    let nodeClickGuardTimer = 0
    const controlCleanups: Array<() => void> = []

    ;(async () => {
      const { default: ForceGraph3D } = await import('3d-force-graph')
      if (cancelled) return

      graphInstance = new ForceGraph3D(container, {
        controlType: 'orbit',
        rendererConfig: { antialias: true, alpha: false },
      })
      graphRef.current = graphInstance

      // 调试钩子：暴露 3d-force-graph 实例 + THREE，供浏览器实测投影节点坐标、定位悬浮点
      // （与 v2/main.ts 暴露 window.v2 同属探查/验收通道）。
      ;(window as any).__FAULT_GRAPH__ = graphInstance
      ;(window as any).__FAULT_THREE__ = THREE

      // issue#7 P0：修补 OrbitControls 多指针位置记录缺失（防诊断中白屏崩溃）。
      patchOrbitControlsPointerDesync(graphInstance.controls())

      // P1：用户接管检测 —— OrbitControls 拖拽/滚轮派发 'start' → onUserInteract（App 设 MANUAL）。
      // 程序化 cameraPosition 不派发 'start'，programmaticMoveRef 标记用于防御边界（飞行中用户抓取）。
      const controls = graphInstance.controls()
      if (controls) {
        controls.autoRotate = false // P1 确认：诊断中不自动旋转（维持镜头稳定，聚焦语义主体）
        const onUserInput = () => {
          if (programmaticMoveRef.current) {
            programmaticMoveRef.current = false
            return
          }
          // 节点点击（保持原有 onNodeClick 选中逻辑）不视为用户接管：OrbitControls 的
          // 'start' 在 pointerdown 派发、onNodeClick 在 click 才触发，故推迟一拍判定。
          window.clearTimeout(nodeClickGuardTimer)
          nodeClickGuardTimer = window.setTimeout(() => {
            const last = lastNodeClickRef.current
            if (last && Date.now() - last.time < NODE_CLICK_GUARD_MS) return
            onUserInteractRef.current?.()
          }, 0)
          programmaticMoveRef.current = false
        }
        controls.addEventListener('start', onUserInput)
        controlCleanups.push(() => controls.removeEventListener('start', onUserInput))
      }

      graphInstance
        .backgroundColor('#0f1117')
        .showNavInfo(false)
        // issue#8 需求2①：浏览态严格冷冻，关闭节点拖拽（不把节点/层拉散）。
        // 相机旋转/缩放与双击展开/收起保留。
        .enableNodeDrag(false)
        .nodeRelSize(NODE_REL_SIZE)
        .nodeVal((node: GraphNode) => node.val)
        .nodeOpacity(0.85)
        .nodeColor((node: GraphNode) => nodeColorFor(node))
        .nodeLabel((node: GraphNode) => nodeLabelHtml(node, labelContextFor(node)))
        .nodeThreeObject((node: GraphNode) => nodeThreeObjectFor(node))
        .nodeThreeObjectExtend(true)
        .linkOpacity(0.9)
        .linkCurvature((link: GraphLink) => (link.category === 'cross' ? 0.18 : 0))
        .linkDirectionalParticleWidth(0.8)
        .linkDirectionalParticleSpeed(0.004)
        .linkDirectionalParticleColor((link: GraphLink) =>
          link.category === 'logic' ? '#ef4444' : '#38bdf8',
        )
        .onNodeClick((node: GraphNode) => {
          const id = node.id
          // 双击聚合头 → 展开/收起该层（BA-GRAPH-009）；单击 → 纯选中（BA-GRAPH-008）。
          const now = Date.now()
          const last = lastNodeClickRef.current
          const isDouble = !!last && last.id === id && now - last.time < DOUBLE_CLICK_MS
          lastNodeClickRef.current = { id, time: now }
          if (isDouble) {
            const layerCode = layerCodeOfAggregateId(id)
            if (layerCode) onToggleLayerRef.current(layerCode)
            onSelectRef.current(id)
          } else {
            onSelectRef.current(id)
          }
        })
        .onNodeHover((node: GraphNode | null) => {
          hoverRef.current = node?.id ?? null
          refreshAppearance()
        })
        .onNodeDragEnd((node: GraphNode) => {
          rePinNode(node)
        })
        .onBackgroundClick(() => {
          onSelectRef.current(null)
        })

      graphInstance
        .linkColor((link: GraphLink) => linkColorFor(link))
        .linkWidth((link: GraphLink) => linkWidthAccessor(link))
        .linkDirectionalParticles((link: GraphLink) => linkParticlesFor(link, false))
      applyLogicLinkDistance(graphInstance)

      const applySize = () => {
        const { width, height } = container.getBoundingClientRect()
        graphInstance.width(width).height(height)
      }
      applySize()
      ro = new ResizeObserver(applySize)
      ro.observe(container)

      graphInstance.graphData({ nodes: stableNodes, links: graphData.links })

      const preset = LAYERED_PRESETS.OVERVIEW
      graphInstance.cameraPosition(preset.position, preset.lookAt, 0)
    })()

    return () => {
      cancelled = true
      window.clearTimeout(nodeClickGuardTimer)
      ro?.disconnect()
      for (const fn of controlCleanups) fn()
      if (graphInstance) {
        graphInstance._destructor()
        graphRef.current = null
        if ((window as any).__FAULT_GRAPH__ === graphInstance) {
          ;(window as any).__FAULT_GRAPH__ = null
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- bind data (structure change only; appearance change just re-evals) ---

  useEffect(() => {
    const graphInstance = graphRef.current
    if (!graphInstance) return
    const signature = graphDataSignature(graphData)
    if (dataSignatureRef.current === signature) {
      refreshAppearance()
      return
    }
    dataSignatureRef.current = signature
    graphInstance.graphData({ nodes: graphData.nodes, links: graphData.links })
    applyLogicLinkDistance(graphInstance)
    refreshAppearance()
  }, [graphData])

  // --- camera driven by lens ------------------------------------------------

  useEffect(() => {
    const graphInstance = graphRef.current
    if (!graphInstance) return
    const preset = presetForLens(activeLens)
    flyCameraTo(graphInstance, preset.position, preset.lookAt, 900)
  }, [activeLens, flyCameraTo])

  // --- appearance refresh on selection / runtime highlight / scan changes ----

  useEffect(() => {
    refreshAppearance()
  }, [
    selectedNodeId,
    agentFocusIds,
    rootCauseIds,
    impactedIds,
    diagnosisScan,
    verdictByAnchorId,
    focusNeighborAnchors,
    pathVisual,
    chipsByAnchorId,
    // P2：阶段驱动视觉（FOCUS 淡化 / ROUTE 黄色高亮）随镜头阶段刷新。
    cameraPhase,
    p2DimmedIds,
    routeHighlightIds,
  ])

  // --- issue#7 C3 / issue#8 需求2③：诊断聚焦目标真实节点 —— 自动展开其聚合层 ----
  // 诊断推进时，若 focus 目标（activeQuery > focus）处于被收起的聚合层内，画布自动展开到
  // 该真实节点（域收起 → 先展开域，再展开子层；子层收起 → 展开子层）。展开后聚合头隐藏
  // （需求1），真实成员占据并沿用 issue#7 的扫描/路径高亮/跟随。以 expandedLayers 为依赖，
  // 逐层展开收敛（两次渲染展开两级），幂等；诊断结束 diagnosisScan 为空即停。
  useEffect(() => {
    const focusId =
      diagnosisScan?.active_query_object_id ?? diagnosisScan?.focus_object_id ?? null
    if (!focusId) return
    const node = model.nodesById.get(focusId)
    if (!node) return
    const sub = node.group as TopoLayerCode
    const domain = topoLayerDef(sub).domain
    const expanded = expandedLayersRef.current
    if (expanded[domain] !== true) {
      autoExpandedLayerRef.current = domain
      onToggleLayerRef.current(domain)
    } else if (expanded[sub] !== true) {
      autoExpandedLayerRef.current = sub
      onToggleLayerRef.current(sub)
    }
  }, [
    diagnosisScan?.active_query_object_id,
    diagnosisScan?.focus_object_id,
    expandedLayers,
    model,
  ])

  // --- P1: 语义相机跟随（focus_signature 变化 → 飞到当前主体节点） ------------
  // 与上面 issue#7 C3 自动展开 effect 同源：目标真实节点处于收起聚合层内时先展开再飞。
  // 核心规则：
  // - focus_signature 不变 → 不移动相机（同节点多 Skill 合并为一次停留）；
  // - followAgent === false → 不移动相机（用户接管；返回 Agent 视角时强制重飞当前主体）；
  // - 目标层与 diagnosisScan 焦点同层时由上面的自动展开 effect 展开，本 effect 不重复
  //   toggle（避免同一 commit 内两次翻转把层又收回）。
  useEffect(() => {
    const graphInstance = graphRef.current
    if (!graphInstance || !presentationSubject) {
      // 无主体（浏览态/会话切换）：重置已飞签名，避免跨会话同签名误去重（不飞首目标）。
      flewSignatureRef.current = null
      return
    }

    // 用户接管：清空已飞签名 → 恢复跟随（followAgent=true）时重飞当前主体。
    if (!followAgent) {
      flewSignatureRef.current = null
      return
    }

    const signature = focusSignature ?? null
    if (signature === flewSignatureRef.current) return

    const targetId = presentationSubject.primary_id
    const node = model.nodesById.get(targetId)
    if (!node) return

    // 节点不在当前可见图内（buildLayered3DGraph 产物）→ 其层被收起，先展开。
    // DETACHED 关键对象即使层收起也可见，这里直接飞行（不误展开其层）。
    if (!graph.nodesById.has(targetId)) {
      const sub = node.group as TopoLayerCode
      const domain = topoLayerDef(sub).domain
      const expanded = expandedLayersRef.current
      // diagnosisScan 焦点所在层由自动展开 effect 收敛，本 effect 只补足未覆盖的层
      //（不同层/无诊断扫描态），避免同一 commit 内两次翻转把层又收回。
      const scanFocus =
        diagnosisScan?.active_query_object_id ?? diagnosisScan?.focus_object_id ?? null
      const scanNode = scanFocus ? model.nodesById.get(scanFocus) : null
      const scanSub = scanNode ? (scanNode.group as TopoLayerCode) : null
      const scanDomain = scanNode ? topoLayerDef(scanSub!).domain : null

      if (expanded[domain] !== true) {
        if (scanDomain !== domain) onToggleLayerRef.current(domain)
        return
      }
      if (expanded[sub] !== true) {
        if (scanSub !== sub) onToggleLayerRef.current(sub)
        return
      }
    }

    // 右侧 LUI 避让：相机右移 safeOffsetX，使目标在去掉 LUI 的可视区居中。
    const safeOffsetX = (rightInsetRef.current ?? 0) / 2
    // P3：多主体构图 —— path 包围盒 / relation_group 成员包围球(primary 权重×2) /
    // terminal 根因+影响链 fit / node 固定 z+180。
    const target = subjectCameraTarget(presentationSubject, model, safeOffsetX)
    if (!target) return
    const { cameraPos, lookAt } = target

    flewSignatureRef.current = signature
    // P2：近距离目标小幅平移（世界距离 < DIST 阈值 → 短促动画，不做大幅拉远）。
    // 目标已接近时，200-350ms 短促平移比 900ms 完整飞行观感更顺滑。
    const cam = graphInstance.camera()
    const cur = cam?.position ?? { x: 0, y: 0, z: 0 }
    const dur = shouldMicroMove(cur, cameraPos) ? 250 : 900
    flyCameraTo(graphInstance, cameraPos, lookAt, dur)
    // 程序化标志清理统一由 flyCameraTo 的 token 定时器负责（P4.1），此处不再无条件清除，
    // 避免旧飞行的清零定时器在后续飞行（如 CONTEXT 拉远）尚未完成时误吞用户接管信号。
  }, [
    focusSignature,
    followAgent,
    presentationSubject,
    expandedLayers,
    diagnosisScan,
    model,
    graph,
  ])

  // --- P2/P3.4: CONTEXT 拉远 + ROUTE 重规划拉远 —— 恢复关键邻居可见度 ------------------
  // CONTEXT：仅当进入 CONTEXT 且处于跟随态时，对"新签名"执行一次短促拉远（从 FOCUS 的
  // 近视角回到带邻居的广视角）。用 ref 记录已拉远的签名，同一签名只拉远一次；不写 Runtime。
  // P4.2：2x/4x 倍速跳过低价值 CONTEXT 拉远视觉（倍速策略合并 Context+Route）。
  // P3.4：phase 从非-ROUTE 跳到 ROUTE 且候选有显著变化（candidate_deltas 非空）时，
  // 复用同一拉远逻辑先做一次 ORIENT/CONTEXT 拉远，再沿路径路由。
  const contextZoomedRef = useRef<string | null>(null)
  const routeZoomRef = useRef<string | null>(null)
  const prevPhaseRef = useRef<CameraPhase | null>(cameraPhase ?? null)

  /** P2/P3.4 共用：对当前主体 primary 节点做一次 CONTEXT 拉远（返回是否实际飞行）。 */
  const zoomOutToContext = useCallback((): boolean => {
    const graphInstance = graphRef.current
    if (!graphInstance || !presentationSubject) return false
    const targetId = presentationSubject.primary_id
    const node = model.nodesById.get(targetId)
    if (!node) return false
    const tx = node.fx ?? node.x
    const ty = node.fy ?? node.y
    const tz = node.fz ?? node.z
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || !Number.isFinite(tz)) return false
    const safeOffsetX = (rightInsetRef.current ?? 0) / 2
    // 拉远到能看到一跳邻居的广视角（比 Focus 的 z+180 更远）。
    flyCameraTo(
      graphInstance,
      { x: tx + safeOffsetX, y: ty, z: tz + 300 },
      { x: tx, y: ty, z: tz },
      600,
    )
    return true
  }, [presentationSubject, model, flyCameraTo])

  useEffect(() => {
    if (!followAgent || cameraPhase !== CameraPhase.CONTEXT) return
    if ((playbackSpeed ?? 1) >= 2) return // P4.2：2x/4x 跳过 CONTEXT 拉远
    if (!presentationSubject) return
    const sig = focusSignature ?? ''
    if (contextZoomedRef.current === sig) return // 已对这一签名拉远过
    if (zoomOutToContext()) contextZoomedRef.current = sig
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraPhase, focusSignature, followAgent, presentationSubject, playbackSpeed, zoomOutToContext])

  // P3.4：重规划 → ROUTE 且候选有显著变化时，先做一次 CONTEXT 拉远再路由。
  useEffect(() => {
    const current = cameraPhase ?? null
    const prev = prevPhaseRef.current
    prevPhaseRef.current = current
    if (prev === current) return
    if (current !== CameraPhase.ROUTE) return
    if (!followAgent) return
    const hasDelta = (presentation?.candidate_deltas?.length ?? 0) > 0
    if (!hasDelta) return
    const sig = focusSignature ?? ''
    if (routeZoomRef.current === sig) return
    if (zoomOutToContext()) routeZoomRef.current = sig
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraPhase, focusSignature, followAgent, presentation, zoomOutToContext])

  // P4.3：离开 CONTEXT 阶段重置 contextZoomedRef；离开 ROUTE 重置 routeZoomRef
  // （重新进入该阶段时允许对新签名/新候选再次拉远）。
  useEffect(() => {
    if (cameraPhase !== CameraPhase.CONTEXT) contextZoomedRef.current = null
    if (cameraPhase !== CameraPhase.ROUTE) routeZoomRef.current = null
  }, [cameraPhase])

  // --- issue#6 阶段C：扫描雷达扫掠 RAF 动画（仅旋转当前扫描对象的扫掠精灵） ---

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const delta = Math.min(0.05, (now - last) / 1000)
      last = now
      // issue#10 单点聚焦：旋转"当前推进节点"（activeQuery > focus）的扫掠雷达。
      const current =
        diagnosisScanRef.current?.active_query_object_id ??
        diagnosisScanRef.current?.focus_object_id ??
        null
      for (const [id, sweep] of scanningSweepsRef.current) {
        if (id !== current) continue
        const material = sweep.material as THREE.SpriteMaterial
        material.rotation = (material.rotation ?? 0) + delta * 2.2
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- legend colors ---------------------------------------------------------

  const layerColors = [
    { code: 'S1', name: 'S1 业务域', color: '#34d399' },
    { code: 'S2', name: 'S2 连接域', color: '#60a5fa' },
    { code: 'S3', name: 'S3 存储域', color: '#c084fc' },
  ]

  return (
    <div
      className={cn(
        'absolute bottom-0 top-0 bg-[#0f1117]',
        navigatorCollapsed ? 'left-4' : 'left-[308px]',
      )}
      style={{ right: rightInset && rightInset > 0 ? rightInset : 0 }}
    >
      {/* 3D 力导向画布 */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* 诊断扫描态（issue#6 阶段C / issue#7 C3）：聚焦查询对象 + 图谱原始点 + 自动展开层。
          首屏顶部控件已精简，扫描徽标移至左下角，不占画布顶部空间。 */}
      {diagnosisScan && (
        <div className="pointer-events-none absolute bottom-12 left-3 z-10 flex items-center gap-2">
          <span
            data-testid="scan-query"
            className="flex items-center gap-1 rounded bg-status-active/15 px-2 py-0.5 text-[10px] text-status-active"
          >
            <ScanSearch className="h-3 w-3" />
            查询 {diagnosisScan.active_query_object_id ?? '—'}
          </span>
          <span
            data-testid="scan-kg"
            className="flex items-center gap-1 rounded bg-amber-400/15 px-2 py-0.5 text-[10px] text-amber-300"
          >
            图谱原始点 {diagnosisScan.graph_entry_anchors.length}
          </span>
          {autoExpandedLayerRef.current && (
            <span
              data-testid="scan-expand"
              className="flex items-center gap-1 rounded bg-emerald-400/15 px-2 py-0.5 text-[10px] text-emerald-300"
              title="排查推进时自动展开的聚合层"
            >
              展开 {autoExpandedLayerRef.current}
            </span>
          )}
        </div>
      )}

      {/* 交互提示（issue#8：浏览态冷冻，节点位置锁定不可拖拽） */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-white/5 bg-[#11141c]/70 px-3 py-1.5 text-[10px] text-[#64748b] backdrop-blur-sm">
        滚轮缩放 · 拖拽旋转 · 双击聚合层展开/收起 · 单击查看关联
      </div>

      {/* 层图例（右侧，S1→S3 域带 + 图谱分层列） */}
      <div className="pointer-events-none absolute right-3 top-1/2 z-10 -translate-y-1/2 space-y-1.5 rounded-xl border border-white/10 bg-[#11141c]/85 px-3 py-2.5 text-[10px] backdrop-blur-md">
        <div className="mb-1 font-semibold tracking-wide text-[#94a3b8]">拓扑 S1→S3</div>
        {layerColors.map((l) => (
          <div key={l.code} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
            <span className="text-[#cbd5e1]">{l.name}</span>
          </div>
        ))}
        <div className="mb-1 mt-2 font-semibold tracking-wide text-[#94a3b8]">故障知识图谱</div>
        {KNOWLEDGE_LAYERS.map((l) => (
          <div key={l.code} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
            <span className="text-[#cbd5e1]">{l.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
