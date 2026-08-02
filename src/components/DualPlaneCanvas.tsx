import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import {
  type ActiveGraph,
  type AggregateSummary,
  type GraphLink,
  type GraphNode,
  type ModelData,
  linkColorFor,
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
  countBadgeSprite,
  detachedTagSprite,
  linkWidthFor,
  linkParticlesFor,
  applyLogicLinkDistance,
  type NodeLabelContext,
} from '@/lib/three-visuals'
import { STATUS_COLORS } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface DualPlaneCanvasProps {
  /** Filtered subgraph currently rendered (rebuilt by the parent on filter change). */
  graphData: ActiveGraph
  /** Full model — presets, node lookup. */
  model: ModelData
  /** Active camera preset key. */
  activePreset: string
  /**
   * Camera target node id. The PARENT decides this — it is the user-selected
   * node while the user is exploring, otherwise the agent_focus node. Because
   * the parent only swaps this id on an explicit focus change, agent events
   * never move the camera while the user is browsing (docs/04 §5).
   */
  focusNodeId: string | null
  /** agent_focus object ids (Runtime-driven). Highlighted, never auto-camera. */
  agentFocusIds: Set<string>
  /** 已确认根因对象 ids（Runtime conclusion.root_cause_chain，docs/04 §8 ROOT_CAUSE）。 */
  rootCauseIds: Set<string>
  /** 受影响对象 ids（Runtime conclusion.impact_chain，docs/04 §8 IMPACTED）。 */
  impactedIds: Set<string>
  /** Currently user-selected node id (drives selection visuals). */
  selectedNodeId: string | null
  /** D3 设备级聚合展开状态（deviceId → expanded）。收起设备的成员默认隐藏。 */
  expandedDevices: Record<string, boolean>
  /** 设备聚合摘要（deviceId → summary，docs/05 §5），驱动徽标与 tooltip。 */
  aggregateSummaries: Map<string, AggregateSummary>
  /** Whether the cross-layer master toggle is on. */
  showCrossLayer: boolean
  /** Whether the BUSINESS_PATH preset is active (drives path highlight). */
  businessPath: boolean
  onNodeSelect: (id: string | null) => void
  /** 双击聚合设备节点 → 展开/收起（BA-GRAPH-009）。 */
  onNodeDoubleClick: (id: string) => void
  onNodeHover: (id: string | null) => void
}

export default function DualPlaneCanvas(props: DualPlaneCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)

  // Latest-value refs so the once-created graph instance never captures stale state.
  const selectedRef = useRef<string | null>(props.selectedNodeId)
  const hoverRef = useRef<string | null>(null)
  const agentFocusRef = useRef<Set<string>>(props.agentFocusIds)
  const rootCauseRef = useRef<Set<string>>(props.rootCauseIds)
  const impactedRef = useRef<Set<string>>(props.impactedIds)
  const expandedDevicesRef = useRef<Record<string, boolean>>(props.expandedDevices)
  const aggregateSummariesRef = useRef<Map<string, AggregateSummary>>(props.aggregateSummaries)
  const showCrossLayerRef = useRef<boolean>(props.showCrossLayer)
  const businessPathRef = useRef<boolean>(props.businessPath)
  const onSelectRef = useRef(props.onNodeSelect)
  const onDoubleSelectRef = useRef(props.onNodeDoubleClick)
  const onHoverRef = useRef(props.onNodeHover)
  // Last single-click (node id + timestamp) for double-click detection, since
  // 3d-force-graph exposes no native dblclick event on nodes.
  const lastNodeClickRef = useRef<{ id: string; time: number } | null>(null)

  // ── issue #5 B0：诊断推进性能 ──────────────────────────────────────────────
  // 节点缓存：按 id 复用同一 GraphNode 对象，力导向布局在 graphData 重绑时
  // 保留已布局位置，避免每 tick 全量重排（肉眼可见卡顿）。
  const nodeCacheRef = useRef<Map<string, GraphNode>>(new Map())
  // 最近一次绑定到力导向的图结构签名（节点集 + 连线集）。结构未变时跳过重绑。
  const dataSignatureRef = useRef<string>('')

  selectedRef.current = props.selectedNodeId
  agentFocusRef.current = props.agentFocusIds
  rootCauseRef.current = props.rootCauseIds
  impactedRef.current = props.impactedIds
  expandedDevicesRef.current = props.expandedDevices
  aggregateSummariesRef.current = props.aggregateSummaries
  showCrossLayerRef.current = props.showCrossLayer
  businessPathRef.current = props.businessPath
  onSelectRef.current = props.onNodeSelect
  onDoubleSelectRef.current = props.onNodeDoubleClick
  onHoverRef.current = props.onNodeHover

  /** 结构签名：节点 id 集 + 连线(source→target:category) 集。仅结构变化时重绑。 */
  const graphDataSignature = (gd: ActiveGraph): string => {
    const nodeIds = gd.nodes.map((n) => n.id).sort().join(',')
    const linkSig = gd.links
      .map((l) => `${l.source}->${l.target}:${l.category}`)
      .sort()
      .join(',')
    return `${nodeIds}|${linkSig}`
  }

  /** 按 id 复用节点对象：保留力导向已布局位置，只刷新展示字段。 */
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
      return cached
    })
  }

  const stableNodes = useMemo(
    () => stabilizeNodes(props.graphData.nodes),
    [props.graphData.nodes],
  )
  const nodesById = useMemo(
    () => new Map(stableNodes.map((node) => [node.id, node])),
    [stableNodes],
  )

  /**
   * Node color:
   * - agent_focus → active blue (Runtime highlight, docs/04 §8 AGENT_FOCUS tier);
   * - user-selected / hovered → brightened plane color (USER_SELECTED tier);
   * - otherwise the neutral plane color.
   * Lower tiers never fully hide higher tiers — agent_focus keeps its blue even
   * when the user also selects it (the halo + color combine).
   */
  const nodeColorFor = (node: GraphNode): string => {
    if (rootCauseRef.current.has(node.id)) return STATUS_COLORS.fault
    if (impactedRef.current.has(node.id)) return STATUS_COLORS.warning
    if (agentFocusRef.current.has(node.id)) return STATUS_COLORS.active
    if (node.id === selectedRef.current || node.id === hoverRef.current) {
      return brighten(node.color)
    }
    return node.color
  }

  /** Tooltip context for a node: aggregate summary, or detached-critical parent. */
  const labelContextFor = (node: GraphNode): NodeLabelContext => {
    const summary = aggregateSummariesRef.current.get(node.id)
    if (summary) return { summary }
    const deviceId = node.object.properties.deviceId as string | undefined
    if (deviceId && deviceId !== node.id && !expandedDevicesRef.current[deviceId]) {
      const group = props.model.deviceGroups.find((g) => g.deviceId === deviceId)
      return { detachedParentLabel: group?.label ?? deviceId }
    }
    return {}
  }

  /** Per-node 3D object: default sphere is kept (extend=true); we add a label
   * for landmark nodes, an additive halo for agent_focus nodes, a member-count
   * badge on aggregate device nodes and a parent tag on detached-critical items
   * (docs/05 §5、§6 — shape + glow/badge, never color alone). */
  const nodeThreeObjectFor = (node: GraphNode): THREE.Object3D => {
    const group = new THREE.Group()
    // 组合视觉（docs/04 §8）：ROOT_CAUSE 红双环 > IMPACTED 橙虚线环 > AGENT_FOCUS 蓝环。
    if (rootCauseRef.current.has(node.id)) group.add(rootHaloSprite(node))
    else if (impactedRef.current.has(node.id)) group.add(impactedRingSprite(node))
    if (agentFocusRef.current.has(node.id)) group.add(haloSprite(node))
    const summary = aggregateSummariesRef.current.get(node.id)
    if (summary) {
      // 聚合设备节点：常驻 label + 成员计数徽标（可发现性，BA-GRAPH-012）。
      group.add(countBadgeSprite(summary))
      if (node.alwaysLabel) group.add(labelSprite(node))
      return group
    }
    const deviceId = node.object.properties.deviceId as string | undefined
    if (deviceId && deviceId !== node.id && !expandedDevicesRef.current[deviceId]) {
      const groupInfo = props.model.deviceGroups.find((g) => g.deviceId === deviceId)
      group.add(detachedTagSprite(node, groupInfo?.label ?? deviceId))
    }
    if (node.alwaysLabel) group.add(labelSprite(node))
    return group
  }

  /** Re-apply node colors / objects. Fresh accessor instances force re-eval. */
  const refreshNodeAppearance = () => {
    const graph = graphRef.current
    if (!graph) return
    graph.nodeColor((node: GraphNode) => nodeColorFor(node))
    graph.nodeThreeObject((node: GraphNode) => nodeThreeObjectFor(node))
  }

  // --- create the graph instance once -------------------------------------

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let graph: any
    let ro: ResizeObserver | undefined

    // Dynamic import keeps 3d-force-graph (and its bundled THREE) out of the
    // critical path and — importantly — we do NOT touch window.THREE, so the
    // library uses its own private THREE instance end-to-end. No dual-instance
    // conflict, no invisible custom objects.
    ;(async () => {
      const { default: ForceGraph3D } = await import('3d-force-graph')
      if (cancelled) return

      graph = new ForceGraph3D(container, {
        controlType: 'orbit',
        rendererConfig: { antialias: true, alpha: false },
      })
      graphRef.current = graph

      graph
        .backgroundColor('#0f1117')
        .showNavInfo(false)
        .enableNodeDrag(false)
        .nodeRelSize(NODE_REL_SIZE)
        .nodeVal((node: GraphNode) => node.val)
        .nodeOpacity(0.85)
        .nodeColor((node: GraphNode) => nodeColorFor(node))
        .nodeLabel((node: GraphNode) => nodeLabelHtml(node, labelContextFor(node)))
        .nodeThreeObject((node: GraphNode) => nodeThreeObjectFor(node))
        .nodeThreeObjectExtend(true)
        .linkOpacity(0.9)
        .linkCurvature((l: GraphLink) => (l.category === 'cross' ? 0.18 : 0))
        .linkDirectionalParticleWidth(0.8)
        .linkDirectionalParticleSpeed(0.004)
        .linkDirectionalParticleColor((l: GraphLink) =>
          l.category === 'logic' ? '#ef4444' : '#38bdf8',
        )
        .onNodeClick((node: GraphNode) => {
          const id = node.id
          // Double-click on the same node within the window → expand/collapse
          // (BA-GRAPH-009); otherwise it is a plain single-click selection
          // (BA-GRAPH-008, never changes hierarchy).
          const now = Date.now()
          const last = lastNodeClickRef.current
          const isDouble = !!last && last.id === id && now - last.time < DOUBLE_CLICK_MS
          lastNodeClickRef.current = { id, time: now }
          if (isDouble) {
            // 双击展开/收起聚合节点（BA-GRAPH-009），并保持节点选中。
            // 单击已选中节点不再取消选中（只在背景处取消），因此双击的首击不会触发
            // 节点重建（selection 无变化 → React bail out），第二次点击不会被重建竞态。
            onDoubleSelectRef.current(id)
            onSelectRef.current(id)
          } else {
            onSelectRef.current(id)
          }
        })
        .onNodeHover((node: GraphNode | null) => {
          hoverRef.current = node?.id ?? null
          refreshNodeAppearance()
          onHoverRef.current(node?.id ?? null)
        })
        .onBackgroundClick(() => {
          onSelectRef.current(null)
        })

      // Initial link style accessors (re-applied on context change below).
      graph
        .linkColor((l: GraphLink) =>
          linkColorFor(l, {
            showCrossLayer: showCrossLayerRef.current,
            businessPath: businessPathRef.current,
          }),
        )
        .linkWidth((l: GraphLink) => linkWidthFor(l, businessPathRef.current))
        .linkDirectionalParticles((l: GraphLink) =>
          linkParticlesFor(l, businessPathRef.current),
        )
      applyLogicLinkDistance(graph)

      // Resize handling.
      const applySize = () => {
        const { width, height } = container.getBoundingClientRect()
        graph.width(width).height(height)
      }
      applySize()
      ro = new ResizeObserver(applySize)
      ro.observe(container)

      // Bind the current data immediately — the separate data useEffect may
      // have already fired (and bailed) while the async import was in flight.
      graph.graphData({
        nodes: stableNodes,
        links: props.graphData.links,
      })

      // Apply the initial camera preset.
      const preset = props.model.presets.find((p) => p.key === props.activePreset)
      if (preset) {
        graph.cameraPosition(
          { x: preset.position.x, y: preset.position.y, z: preset.position.z },
          { x: preset.lookAt.x, y: preset.lookAt.y, z: preset.lookAt.z },
          0,
        )
      }
    })()

    return () => {
      cancelled = true
      ro?.disconnect()
      if (graph) {
        graph._destructor()
        graphRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- bind data ----------------------------------------------------------
  // issue #5 B0：仅当节点/连线结构真的变化才重绑 graphData（避免力导向每 tick
  // 全量重算）；结构未变（如仅颜色/焦点变化）只刷外观。
  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return
    const signature = graphDataSignature(props.graphData)
    if (dataSignatureRef.current === signature) {
      refreshNodeAppearance()
      return
    }
    dataSignatureRef.current = signature
    graph.graphData({ nodes: stableNodes, links: props.graphData.links })
    applyLogicLinkDistance(graph)
    refreshNodeAppearance()
  }, [props.graphData, stableNodes])

  // --- camera presets -----------------------------------------------------

  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return
    const preset = props.model.presets.find((p) => p.key === props.activePreset)
    if (!preset) return
    graph.cameraPosition(
      { x: preset.position.x, y: preset.position.y, z: preset.position.z },
      { x: preset.lookAt.x, y: preset.lookAt.y, z: preset.lookAt.z },
      900,
    )
  }, [props.activePreset, props.model.presets])

  // --- focus (camera target id) -------------------------------------------
  // Depends on the id only, so re-renders / filter rebuilds that change node
  // object identity do not trigger a spurious camera flight.
  useEffect(() => {
    const graph = graphRef.current
    if (!graph || !props.focusNodeId) return
    const node = nodesById.get(props.focusNodeId)
    if (!node) return
    const distance = 130
    graph.cameraPosition(
      { x: node.fx, y: node.fy + 30, z: node.fz + distance },
      { x: node.fx, y: node.fy, z: node.fz },
      900,
    )
  }, [props.focusNodeId, nodesById])

  // --- selection / agent-focus visuals ------------------------------------

  useEffect(() => {
    refreshNodeAppearance()
  }, [props.selectedNodeId, props.agentFocusIds, props.rootCauseIds, props.impactedIds])

  // Aggregate badges / detached-critical tags depend on summaries + expand state.
  useEffect(() => {
    refreshNodeAppearance()
  }, [props.aggregateSummaries, props.expandedDevices])

  // --- re-apply link styling on context change ----------------------------

  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return
    graph
      .linkColor((l: GraphLink) =>
        linkColorFor(l, {
          showCrossLayer: showCrossLayerRef.current,
          businessPath: businessPathRef.current,
        }),
      )
      .linkWidth((l: GraphLink) => linkWidthFor(l, businessPathRef.current))
      .linkDirectionalParticles((l: GraphLink) =>
        linkParticlesFor(l, businessPathRef.current),
      )
  }, [props.showCrossLayer, props.businessPath])

  return <div ref={containerRef} className="ontology-interaction-canvas absolute inset-0" />
}
