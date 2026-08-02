import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Layers } from 'lucide-react'

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
  type NodeLabelContext,
} from '@/lib/three-visuals'
import { LINK_COLORS, STATUS_COLORS, cn } from '@/lib/utils'

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
// Props
// ---------------------------------------------------------------------------

export interface Layered3DCanvasProps {
  /** 分层拓扑模型（buildLayeredModelData 产物，任意 Case）。 */
  model: LayeredModelData
  /** 当前分层 Case id。 */
  caseId: string
  /** 可选 Case 列表（名称取自 manifest）。 */
  cases: Array<{ caseId: string; name: string }>
  /** 切换 Case：重建模型 + 重置展开。 */
  onCaseChange: (caseId: string) => void
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
  /** 当前透镜（驱动相机：TOPOLOGY/KNOWLEDGE/其余→OVERVIEW）。 */
  activeLens?: LensId
  onNodeSelect: (id: string | null) => void
  /** 下层故障知识图谱节点（plane==='knowledge'，来自静态 knowledge-graph 模型）。 */
  knowledgeNodes: GraphNode[]
  /** 下层故障知识图谱连线（category==='knowledge'）。 */
  knowledgeLinks: GraphLink[]
  /** 图谱分层显隐（layer code → visible；与 ModelNavigator Knowledge layers 分区联动）。 */
  visibleKgLayers?: Record<string, boolean>
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Layered3DCanvas(props: Layered3DCanvasProps) {
  const {
    model,
    caseId,
    cases,
    onCaseChange,
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
    activeLens,
    onNodeSelect,
    knowledgeNodes,
    knowledgeLinks,
    visibleKgLayers,
  } = props

  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)

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
   */
  const nodeColorFor = (node: GraphNode): string => {
    if (rootCauseRef.current.has(node.id)) return STATUS_COLORS.fault
    if (impactedRef.current.has(node.id)) return STATUS_COLORS.warning
    if (agentFocusRef.current.has(node.id)) return STATUS_COLORS.active
    if (node.id === selectedRef.current || node.id === hoverRef.current) {
      return brighten(node.color)
    }
    if (
      highlightKnowledgeRef.current.has(node.id) ||
      highlightTopologyRef.current.has(node.id)
    ) {
      return '#2dd4bf'
    }
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

  /** Per-node 3D object：聚合头徽标、DETACHED 层标签、跨层关联环、agent/根因光晕。 */
  const nodeThreeObjectFor = (node: GraphNode): THREE.Object3D => {
    const group = new THREE.Group()
    if (rootCauseRef.current.has(node.id)) group.add(rootHaloSprite(node))
    else if (impactedRef.current.has(node.id)) group.add(impactedRingSprite(node))
    if (agentFocusRef.current.has(node.id)) group.add(haloSprite(node))
    if (
      highlightKnowledgeRef.current.has(node.id) ||
      highlightTopologyRef.current.has(node.id)
    ) {
      group.add(highlightRingSprite(node))
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

  // --- appearance refresh on selection / runtime highlight changes ----------

  useEffect(() => {
    refreshAppearance()
  }, [selectedNodeId, agentFocusIds, rootCauseIds, impactedIds])

  // --- header counts ---------------------------------------------------------

  const kgCount = graph.nodes.filter((n) => n.plane === 'knowledge').length
  const layerColors = [
    { code: 'S1', name: 'S1 业务域', color: '#34d399' },
    { code: 'S2', name: 'S2 连接域', color: '#60a5fa' },
    { code: 'S3', name: 'S3 存储域', color: '#c084fc' },
  ]

  return (
    <div
      className={cn(
        'absolute bottom-0 right-0 top-0 bg-[#0f1117]',
        navigatorCollapsed ? 'left-4' : 'left-[308px]',
      )}
    >
      {/* 3D 力导向画布 */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* 信息条：标题 + 统计 + Case 切换 */}
      <div className="pointer-events-none absolute left-1/2 top-[104px] z-10 -translate-x-1/2">
        <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-white/10 bg-[#11141c]/92 px-4 py-2 text-[12px] text-[#94a3b8] shadow-2xl backdrop-blur-md">
          <Layers className="h-4 w-4 text-status-active" />
          <span className="font-semibold text-[#e2e8f0]">S1 → S3 分层拓扑 · 故障知识图谱</span>
          <span className="hidden text-[#64748b] md:inline">
            {model.nodes.length} 资源 · {graph.crossLinks.length} 跨层映射 · {kgCount} 图谱节点
          </span>
          <label className="ml-1 flex items-center gap-1.5">
            <span className="text-[10px] text-[#64748b]">Case</span>
            <select
              value={caseId}
              onChange={(event) => onCaseChange(event.target.value)}
              aria-label="分层拓扑 Case"
              className="max-w-[220px] cursor-pointer rounded-md border border-white/10 bg-[#11141c] px-2 py-1 text-[11px] text-[#cbd5e1] outline-none focus:border-status-active/60"
            >
              {cases.map((c) => (
                <option key={c.caseId} value={c.caseId}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

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
