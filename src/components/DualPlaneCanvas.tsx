import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import {
  type ActiveGraph,
  type GraphLink,
  type GraphNode,
  type ModelData,
  linkColorFor,
} from '@/lib/model-loader'
import { STATUS_COLORS, formatHealthStatus } from '@/lib/utils'

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

/** A lightweight canvas label attached to the same Three.js scene as the node. */
function labelSprite(node: GraphNode): THREE.Sprite {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')!
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const fontSize = node.alwaysLabel ? 24 : 20
  context.font = `600 ${fontSize * ratio}px system-ui, sans-serif`
  const width = Math.ceil(context.measureText(node.label).width + 20 * ratio)
  canvas.width = width
  canvas.height = 36 * ratio
  context.font = `600 ${fontSize * ratio}px system-ui, sans-serif`
  context.fillStyle = 'rgba(15, 17, 23, 0.78)'
  context.roundRect(0, 0, canvas.width, canvas.height, 8 * ratio)
  context.fill()
  context.fillStyle = '#e2e8f0'
  context.textBaseline = 'middle'
  context.fillText(node.label, 10 * ratio, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  )
  const scale = 0.16
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1)
  sprite.position.set(0, 12 + node.val * 2, 0)
  return sprite
}

// Agent-focus halo: a reusable additive ring sprite (docs/04 §8 — combine shape
// + glow, never color alone). Cached so we don't reallocate a texture per node.
let haloTexture: THREE.CanvasTexture | null = null
function getHaloTexture(): THREE.CanvasTexture {
  if (haloTexture) return haloTexture
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.shadowBlur = 18
  ctx.shadowColor = STATUS_COLORS.active
  ctx.lineWidth = 7
  ctx.strokeStyle = 'rgba(59,130,246,0.95)'
  ctx.beginPath()
  ctx.arc(64, 64, 50, 0, Math.PI * 2)
  ctx.stroke()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  haloTexture = tex
  return tex
}

function haloSprite(node: GraphNode): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getHaloTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  const scale = 16 + node.val * 4
  sprite.scale.set(scale, scale, 1)
  sprite.position.set(0, 0, 0)
  return sprite
}

// Root-cause halo: a stronger double-ring (docs/04 §8 ROOT_CAUSE tier — shape +
// glow, never color alone). Confirmed root stands out from mere agent_focus.
let rootHaloTexture: THREE.CanvasTexture | null = null
function getRootHaloTexture(): THREE.CanvasTexture {
  if (rootHaloTexture) return rootHaloTexture
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.shadowBlur = 22
  ctx.shadowColor = STATUS_COLORS.fault
  ctx.lineWidth = 8
  ctx.strokeStyle = 'rgba(248,113,113,0.95)'
  ctx.beginPath()
  ctx.arc(64, 64, 46, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(248,113,113,0.55)'
  ctx.beginPath()
  ctx.arc(64, 64, 60, 0, Math.PI * 2)
  ctx.stroke()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  rootHaloTexture = tex
  return tex
}

// Impacted ring: a dashed amber ring (docs/04 §8 IMPACTED tier).
let impactedRingTexture: THREE.CanvasTexture | null = null
function getImpactedRingTexture(): THREE.CanvasTexture {
  if (impactedRingTexture) return impactedRingTexture
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.shadowBlur = 14
  ctx.shadowColor = STATUS_COLORS.warning
  ctx.lineWidth = 5
  ctx.strokeStyle = 'rgba(251,146,60,0.85)'
  ctx.setLineDash([10, 6])
  ctx.beginPath()
  ctx.arc(64, 64, 52, 0, Math.PI * 2)
  ctx.stroke()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  impactedRingTexture = tex
  return tex
}

function rootHaloSprite(node: GraphNode): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getRootHaloTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  const scale = 18 + node.val * 4
  sprite.scale.set(scale, scale, 1)
  return sprite
}

function impactedRingSprite(node: GraphNode): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getImpactedRingTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  const scale = 16 + node.val * 4
  sprite.scale.set(scale, scale, 1)
  return sprite
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
  if (link.category === 'cross') return link.relation === 'INSTANCE_OF' ? 0.5 : 1.1
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
  const agentFocusRef = useRef<Set<string>>(props.agentFocusIds)
  const rootCauseRef = useRef<Set<string>>(props.rootCauseIds)
  const impactedRef = useRef<Set<string>>(props.impactedIds)
  const showCrossLayerRef = useRef<boolean>(props.showCrossLayer)
  const businessPathRef = useRef<boolean>(props.businessPath)
  const onSelectRef = useRef(props.onNodeSelect)
  const onHoverRef = useRef(props.onNodeHover)

  selectedRef.current = props.selectedNodeId
  agentFocusRef.current = props.agentFocusIds
  rootCauseRef.current = props.rootCauseIds
  impactedRef.current = props.impactedIds
  showCrossLayerRef.current = props.showCrossLayer
  businessPathRef.current = props.businessPath
  onSelectRef.current = props.onNodeSelect
  onHoverRef.current = props.onNodeHover

  const nodesById = useMemo(
    () => new Map(props.graphData.nodes.map((node) => [node.id, node])),
    [props.graphData.nodes],
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

  /** Per-node 3D object: default sphere is kept (extend=true); we add a label
   * for landmark nodes and an additive halo for agent_focus nodes. */
  const nodeThreeObjectFor = (node: GraphNode): THREE.Object3D => {
    const group = new THREE.Group()
    // 组合视觉（docs/04 §8）：ROOT_CAUSE 红双环 > IMPACTED 橙虚线环 > AGENT_FOCUS 蓝环。
    if (rootCauseRef.current.has(node.id)) group.add(rootHaloSprite(node))
    else if (impactedRef.current.has(node.id)) group.add(impactedRingSprite(node))
    if (agentFocusRef.current.has(node.id)) group.add(haloSprite(node))
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
        .nodeLabel((node: GraphNode) => nodeLabelHtml(node))
        .nodeThreeObject((node: GraphNode) => nodeThreeObjectFor(node))
        .nodeThreeObjectExtend(true)
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
    refreshNodeAppearance()
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
