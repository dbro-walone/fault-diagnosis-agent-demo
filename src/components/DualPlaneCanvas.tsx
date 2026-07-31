import { useEffect, useRef } from 'react'

import {
  type ActiveGraph,
  type GraphLink,
  type GraphNode,
  type ModelData,
  linkColorFor,
} from '@/lib/model-loader'
import { formatHealthStatus } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Visual tuning constants
// ---------------------------------------------------------------------------

/** Built-in sphere base radius; per-node radius scales with node.val (volume). */
const NODE_REL_SIZE = 6

/**
 * Lighten a hex color ~40% toward white so the selected/hovered node stands out
 * against its neutral base color (keeps per-plane blue/purple identity).
 */
function brighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c * 0.6 + 255 * 0.4)
  const r = mix((n >> 16) & 255)
  const g = mix((n >> 8) & 255)
  const b = mix(n & 255)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

/** Built-in hover tooltip (HTML) for a node. */
function nodeLabelHtml(node: GraphNode): string {
  const plane = node.plane === 'topology' ? '实例拓扑' : '故障知识图谱'
  const health = node.healthStatus
    ? ` · 健康：${formatHealthStatus(node.healthStatus)}`
    : ''
  return `${node.label}<br/><span style="font-size:10px;opacity:0.7">${plane} · ${node.kind} · ${node.groupName}${health}</span>`
}

// ---------------------------------------------------------------------------
// Link styling helpers (view context is passed in so accessors stay pure)
// ---------------------------------------------------------------------------

function isBusinessPath(link: GraphLink, businessPath: boolean): boolean {
  return businessPath && !!link.pathGroup && link.pathGroup.startsWith('block-path')
}

function linkWidthFor(link: GraphLink, businessPath: boolean): number {
  if (isBusinessPath(link, businessPath)) return 2.4
  if (link.category === 'knowledge') return 0.7 + (link.weight ?? 0.5) * 0.5
  if (link.category === 'cross') return link.crossRelation === 'INSTANCE_OF' ? 0.5 : 1.1
  return 1.1
}

function linkParticlesFor(link: GraphLink, businessPath: boolean): number {
  return isBusinessPath(link, businessPath) ? 4 : 0
}

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
  /** Node id to fly the camera to (search & focus). */
  focusNodeId: string | null
  /** Currently selected node id (drives selection visuals). */
  selectedNodeId: string | null
  /** Whether the cross-layer master toggle is on. */
  showCrossLayer: boolean
  /** Whether the BUSINESS_PATH preset is active (drives path highlight). */
  businessPath: boolean
  onNodeSelect: (id: string | null) => void
  onNodeHover: (id: string | null) => void
}

export default function DualPlaneCanvas(props: DualPlaneCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)

  // Latest-value refs so the once-created graph instance never captures stale state.
  const selectedRef = useRef<string | null>(props.selectedNodeId)
  const hoverRef = useRef<string | null>(null)
  const focusRef = useRef<string | null>(props.focusNodeId)
  const showCrossLayerRef = useRef<boolean>(props.showCrossLayer)
  const businessPathRef = useRef<boolean>(props.businessPath)
  const onSelectRef = useRef(props.onNodeSelect)
  const onHoverRef = useRef(props.onNodeHover)

  selectedRef.current = props.selectedNodeId
  focusRef.current = props.focusNodeId
  showCrossLayerRef.current = props.showCrossLayer
  businessPathRef.current = props.businessPath
  onSelectRef.current = props.onNodeSelect
  onHoverRef.current = props.onNodeHover

  /** Node color: brighter for the selected / hovered / focused node, base otherwise. */
  const nodeColorFor = (node: GraphNode): string => {
    if (
      node.id === selectedRef.current ||
      node.id === hoverRef.current ||
      node.id === focusRef.current
    ) {
      return brighten(node.color)
    }
    return node.color
  }

  /** Re-apply node colors. Passing a fresh accessor forces the lib to re-evaluate. */
  const refreshNodeColors = () => {
    const graph = graphRef.current
    if (!graph) return
    graph.nodeColor((node: GraphNode) => nodeColorFor(node))
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
        .nodeLabel((node: GraphNode) => nodeLabelHtml(node))
        .linkOpacity(0.9)
        .linkCurvature((l: GraphLink) => (l.category === 'cross' ? 0.18 : 0))
        .linkDirectionalParticleWidth(0.8)
        .linkDirectionalParticleSpeed(0.004)
        .linkDirectionalParticleColor('#38bdf8')
        .onNodeClick((node: GraphNode) => {
          const id = node.id
          onSelectRef.current(id === selectedRef.current ? null : id)
        })
        .onNodeHover((node: GraphNode | null) => {
          hoverRef.current = node?.id ?? null
          refreshNodeColors()
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
        nodes: props.graphData.nodes,
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

  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return
    graph.graphData({ nodes: props.graphData.nodes, links: props.graphData.links })
    refreshNodeColors()
  }, [props.graphData])

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

  // --- focus (search) -----------------------------------------------------

  useEffect(() => {
    const graph = graphRef.current
    if (!graph || !props.focusNodeId) return
    const node = props.model.nodesById.get(props.focusNodeId)
    if (!node) return
    const distance = 130
    graph.cameraPosition(
      { x: node.fx, y: node.fy + 30, z: node.fz + distance },
      { x: node.fx, y: node.fy, z: node.fz },
      900,
    )
    refreshNodeColors()
  }, [props.focusNodeId, props.model.nodesById])

  // --- selection visuals --------------------------------------------------

  useEffect(() => {
    refreshNodeColors()
  }, [props.selectedNodeId])

  // --- re-apply link styling on context change ----------------------------

  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return
    // New function instances force the lib to re-evaluate every link.
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

  return <div ref={containerRef} className="absolute inset-0" />
}
