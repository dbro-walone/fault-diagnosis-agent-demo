import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { ScanSearch } from 'lucide-react'

import { LensId } from '../../schemas'
import { KNOWLEDGE_LAYERS } from '@/lib/knowledge-plane'
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
  type NodeLabelContext,
  type VerdictKey,
} from '@/lib/three-visuals'
import { LINK_COLORS, STATUS_COLORS, cn } from '@/lib/utils'
import type { DiagnosisScanVM, ExaminedVerdict } from '../v2'

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
  } = props

  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)
  /** issue#6 阶段C：当前扫描态扫掠精灵（nodeId → sweep），RAF 循环旋转。 */
  const scanningSweepsRef = useRef<Map<string, THREE.Sprite>>(new Map())
  /** issue#6 阶段C：最新诊断循环 view-model（RAF 循环只读，避免闭包捕获旧值）。 */
  const diagnosisScanRef = useRef<DiagnosisScanVM | null>(diagnosisScan ?? null)
  /** issue#7 C3：排查推进时自动展开的层 code（信息条徽标；effect 先写、渲染后读）。 */
  const autoExpandedLayerRef = useRef<TopoLayerCode | null>(null)

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

  /** 3D 分层活动图：拓扑（S1→S3 分层）+ 图谱（分层 X 列）+ 跨层 + 红逻辑链。 */
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

  /** 结构签名：节点 id 集 + 连线(source→target:category)。仅结构变化时重绑。 */
  const graphDataSignature = (gd: ActiveGraph): string => {
    const nodeIds = gd.nodes.map((n) => n.id).sort().join(',')
    const linkSig = gd.links
      .map((l) => `${l.source}->${l.target}:${l.category}`)
      .sort()
      .join(',')
    return `${nodeIds}|${linkSig}`
  }

  /** 按 id 复用节点：保留已布局自由轴（拓扑 x / 知识 z）与拖拽停留位置，刷新固定轴。 */
  const stabilizeNodes = (nodes: GraphNode[]): GraphNode[] => {
    const cache = nodeCacheRef.current
    return nodes.map((node) => {
      const cached = cache.get(node.id)
      if (!cached) {
        cache.set(node.id, node)
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
      return cached
    })
  }

  const stableNodes = useMemo(() => stabilizeNodes(graph.nodes), [graph])
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
    if (scan?.active_query_object_id === node.id) return SCAN_COLOR
    if (rootCauseRef.current.has(node.id)) return STATUS_COLORS.fault
    if (impactedRef.current.has(node.id)) return STATUS_COLORS.warning
    if (agentFocusRef.current.has(node.id)) return STATUS_COLORS.active
    const verdict = verdictByAnchorId.get(node.id)
    if (verdict) return VERDICT_DIM_COLOR[verdict]
    if (node.id === selectedRef.current || node.id === hoverRef.current) return brighten(node.color)
    if (focusNeighborAnchors.has(node.id)) return 'rgba(103, 232, 249, 0.65)'
    if (highlightTopologyRef.current.has(node.id)) return '#2dd4bf'
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

  /** Tooltip context：聚合摘要优先，其次 DETACHED 关键成员所属层。 */
  const labelContextFor = (node: GraphNode): NodeLabelContext => {
    const summary = summariesRef.current.get(node.id)
    if (summary) return { summary }
    const detachedLayer = detachedLayerLabelFor(node)
    if (detachedLayer) return { detachedLayerLabel: detachedLayer }
    return {}
  }

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
      const isScanning = scan?.active_query_object_id === node.id
      if (isScanning) {
        const visual = scanningVisual(node)
        scanningSweepsRef.current.set(node.id, visual.sweep)
        group.add(visual)
      }
      if (rootCauseRef.current.has(node.id)) group.add(rootHaloSprite(node))
      else if (impactedRef.current.has(node.id)) group.add(impactedRingSprite(node))
      if (agentFocusRef.current.has(node.id) && !isScanning) group.add(haloSprite(node))
      const verdict = verdictByAnchorId.get(node.id)
      if (
        verdict &&
        !isScanning &&
        !rootCauseRef.current.has(node.id) &&
        !impactedRef.current.has(node.id)
      ) {
        group.add(verdictRingSprite(node, verdict as VerdictKey))
      }
      if (focusNeighborAnchors.has(node.id) && !isScanning) group.add(neighborHintSprite(node))
      if (highlightTopologyRef.current.has(node.id)) group.add(highlightRingSprite(node))
    }
    const summary = summariesRef.current.get(node.id)
    if (summary) {
      group.add(countBadgeSprite(summary))
      if (node.alwaysLabel) group.add(labelSprite(node))
      return group
    }
    const detachedLayer = detachedLayerLabelFor(node)
    if (detachedLayer) group.add(detachedLayerTagSprite(node, detachedLayer))
    if (node.alwaysLabel) group.add(labelSprite(node))
    return group
  }

  /** 跨层连线是否命中当前选中（点选拓扑 → 其图谱映射；点选图谱 → 关联拓扑）。 */
  const isCrossLinkActive = (link: GraphLink): boolean => {
    const sel = selectedRef.current
    if (!sel) return false
    if (selectedIsTopologyRef.current) return link.source === sel || link.target === sel
    if (selectedIsKnowledgeRef.current) {
      return (
        link.target === sel || highlightTopologyRef.current.has(link.source as string)
      )
    }
    return false
  }

  const linkColorFor = (link: GraphLink): string => {
    if (link.category === 'logic') return LINK_COLORS.logic
    if (link.category === 'cross') {
      if (isCrossLinkActive(link)) return 'rgba(20, 184, 166, 0.95)'
      return link.relation === 'INSTANCE_OF'
        ? 'rgba(148, 163, 184, 0.22)'
        : 'rgba(148, 163, 184, 0.42)'
    }
    if (link.category === 'topology') return LINK_COLORS.topology
    if (link.category === 'knowledge') return LINK_COLORS.knowledge
    return 'rgba(45, 212, 191, 0.5)'
  }

  /** Re-apply node/link style accessors. Fresh instances force re-eval. */
  const refreshAppearance = (): void => {
    const graphInstance = graphRef.current
    if (!graphInstance) return
    graphInstance.nodeColor((node: GraphNode) => nodeColorFor(node))
    graphInstance.nodeThreeObject((node: GraphNode) => nodeThreeObjectFor(node))
    graphInstance
      .linkColor((link: GraphLink) => linkColorFor(link))
      .linkWidth((link: GraphLink) => linkWidthFor(link, false))
      .linkDirectionalParticles((link: GraphLink) => linkParticlesFor(link, false))
  }

  // --- create the graph instance once -------------------------------------

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let graphInstance: any
    let ro: ResizeObserver | undefined

    ;(async () => {
      const { default: ForceGraph3D } = await import('3d-force-graph')
      if (cancelled) return

      graphInstance = new ForceGraph3D(container, {
        controlType: 'orbit',
        rendererConfig: { antialias: true, alpha: false },
      })
      graphRef.current = graphInstance

      // issue#7 P0：修补 OrbitControls 多指针位置记录缺失（防诊断中白屏崩溃）。
      patchOrbitControlsPointerDesync(graphInstance.controls())

      graphInstance
        .backgroundColor('#0f1117')
        .showNavInfo(false)
        .enableNodeDrag(true)
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
        .linkWidth((link: GraphLink) => linkWidthFor(link, false))
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
      ro?.disconnect()
      if (graphInstance) {
        graphInstance._destructor()
        graphRef.current = null
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
    graphInstance.cameraPosition(preset.position, preset.lookAt, 900)
  }, [activeLens])

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
  ])

  // --- issue#7 C3：排查推进到某对象时自动展开其聚合层，使其可见并高亮 ----
  // 诊断推进到 active_query_object_id 时，若该对象所属域/子层当前收起，自动展开
  // （域收起 → 展开域；域已展开但子层收起 → 展开子层）。只处理"当前收起"的层，
  // 幂等，不反向收拢用户手动展开的层。
  useEffect(() => {
    const focusId = diagnosisScan?.active_query_object_id ?? null
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
  }, [diagnosisScan?.active_query_object_id, model])

  // --- issue#6 阶段C：扫描雷达扫掠 RAF 动画（仅旋转当前扫描对象的扫掠精灵） ---

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const delta = Math.min(0.05, (now - last) / 1000)
      last = now
      const activeQuery = diagnosisScanRef.current?.active_query_object_id ?? null
      for (const [id, sweep] of scanningSweepsRef.current) {
        if (id !== activeQuery) continue
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

      {/* 交互提示 */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-white/5 bg-[#11141c]/70 px-3 py-1.5 text-[10px] text-[#64748b] backdrop-blur-sm">
        滚轮缩放 · 拖拽旋转 · 拖动节点 · 双击聚合层展开/收起 · 单击查看关联
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
