/**
 * 共享 3D 视觉助手 —— 3d-force-graph + three 画布的节点/连线视觉构造。
 *
 * 从 DualPlaneCanvas（双平面 3D 主画布）与 Layered3DCanvas（分层 3D 主画布）
 * 共用的纯渲染工具中抽出：Sprite 标签/光晕/徽标、节点 tooltip、连线样式与
 * 逻辑链力距离配置。只负责"怎么画"，不决定布局（布局见 layered-topology-3d）。
 */

import * as THREE from 'three'
import { isStaticCrossRelation } from './knowledge-plane'

// ─────────────────────────────────────────────────────────────────────────────
// issue#7 P0 —— three.js OrbitControls 多指针状态机缺陷修补
//
// 崩溃现场（3d-force-graph 打包 chunk `mF.bF`）：
//   OrbitControls.onPointerUp 的 `case 1`（多指针时剩余 1 个指针）分支执行
//     const pointerId = this._pointers[0];
//     const position = this._pointerPositions[pointerId];   // ← 可能是 undefined
//     this._onTouchStart({ pointerId, pageX: position.x, pageY: position.y }); // 崩溃
//   `_removePointer` 会 delete `_pointerPositions[pointerId]`，但同名 pointerId
//   在 `_pointers` 中残留重复项时，只 splice 掉一个；随后 case 1 读到已删除的
//   位置记录 → "Cannot read properties of undefined (reading 'x')" → 白屏。
//
// 修法：对画布持有的 controls 实例打补丁 `_removePointer` —— 每次移除后，把
// 仍在跟踪的每个指针的位置记录补齐（不改变 OrbitControls 其它行为），保证
// `onPointerUp` case 1 永远读到合法对象。幂等：同一实例只补一次。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 修补 three OrbitControls 的多指针位置记录缺失（issue#7 P0，防白屏崩溃）。
 * controls 为 3d-force-graph 实例 `.controls()` 返回的 OrbitControls。
 */
export function patchOrbitControlsPointerDesync(controls: any): void {
  if (!controls || typeof controls._removePointer !== 'function') return
  if (controls.__faultAgentPatchPointerDesync) return
  const origRemove = controls._removePointer.bind(controls)
  controls._removePointer = (event: PointerEvent): void => {
    origRemove(event)
    // 移除后仍在跟踪的指针必须有位置记录，否则 onPointerUp case 1 读到 undefined。
    const pointers: unknown[] = controls._pointers
    const positions = controls._pointerPositions
    if (!Array.isArray(pointers) || !positions) return
    for (const pid of pointers) {
      const key = pid as string | number
      if (positions[key] === undefined) {
        positions[key] = { x: event.pageX ?? 0, y: event.pageY ?? 0 }
      }
    }
  }
  controls.__faultAgentPatchPointerDesync = true
}

import type {
  AggregateSummary,
  GraphLink,
  GraphNode,
} from '@/lib/model-loader'
import { STATUS_COLORS, formatHealthStatus } from '@/lib/utils'

/** Built-in sphere base radius; per-node radius scales with node.val (volume). */
export const NODE_REL_SIZE = 6

/** Max gap (ms) between two clicks on the same node counted as a double-click. */
export const DOUBLE_CLICK_MS = 350

/**
 * Lighten a hex color ~40% toward white so the selected/hovered node stands out
 * against its neutral base color (keeps per-plane blue/purple identity).
 */
export function brighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c * 0.6 + 255 * 0.4)
  const r = mix((n >> 16) & 255)
  const g = mix((n >> 8) & 255)
  const b = mix(n & 255)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

export interface NodeLabelContext {
  /** 聚合摘要（BA-GRAPH-012）：成员总数/异常数/候选数/最高严重度。 */
  summary?: AggregateSummary
  /** 所属父组 label —— 节点是已收起设备的 DETACHED_CRITICAL 关键子项（BA-GRAPH-011）。 */
  detachedParentLabel?: string
  /** 所属层 label —— 分层画布中节点所属层级已收起的 DETACHED_CRITICAL 关键子项。 */
  detachedLayerLabel?: string
  /** 已排查节点的关键指标（KPI/性能/日志摘要，悬浮展示；与指标芯片同源，最多 3 个）。 */
  metrics?: MetricChip[]
}

/** Built-in hover tooltip (HTML) for a node. Aggregate / detached-critical nodes
 * get an extra summary strip (docs/05 §5、§6). Nodes with examined metrics get a
 * compact key-indicator card (name + value + status color). */
export function nodeLabelHtml(node: GraphNode, ctx: NodeLabelContext = {}): string {
  const plane = node.plane === 'topology' ? '实例拓扑' : '故障知识图谱'
  const health = node.healthStatus
    ? ` · 健康：${formatHealthStatus(node.healthStatus)}`
    : ''
  let base: string
  if (ctx.summary) {
    const severityLabel =
      ctx.summary.maxSeverity === 'CRITICAL'
        ? '严重'
        : ctx.summary.maxSeverity === 'WARNING'
          ? '注意'
          : '正常'
    base =
      `${node.label}<br/>` +
      `<span style="font-size:10px;opacity:0.7">聚合 ${ctx.summary.total} 成员 · 异常 ${ctx.summary.anomaly} · 候选 ${ctx.summary.candidate} · 最高${severityLabel}</span><br/>` +
      `<span style="font-size:9px;opacity:0.6">含 ${ctx.summary.total} 个成员，双击展开 / 收起</span>`
  } else if (ctx.detachedParentLabel) {
    base =
      `${node.label}<br/>` +
      `<span style="font-size:10px;opacity:0.7">${plane} · ${node.kind} · ${node.groupName}${health}</span><br/>` +
      `<span style="font-size:9px;opacity:0.75;color:#fbbf24">关键对象 · 所属父组 ${ctx.detachedParentLabel}（已收起）</span>`
  } else if (ctx.detachedLayerLabel) {
    base =
      `${node.label}<br/>` +
      `<span style="font-size:10px;opacity:0.7">${plane} · ${node.kind} · ${node.groupName}${health}</span><br/>` +
      `<span style="font-size:9px;opacity:0.75;color:#fbbf24">关键对象 · 所属层 ${ctx.detachedLayerLabel}（已收起）</span>`
  } else {
    base = `${node.label}<br/><span style="font-size:10px;opacity:0.7">${plane} · ${node.kind} · ${node.groupName}${health}</span>`
  }
  if (ctx.metrics && ctx.metrics.length > 0) {
    const rows = ctx.metrics
      .map((m) => {
        const color = CHIP_TONE_COLOR[m.tone]
        return `<div style="font-size:11px;font-weight:600;color:${color}">${m.name} ${m.value}</div>`
      })
      .join('')
    base +=
      `<div style="margin-top:4px;border-top:1px solid rgba(255,255,255,0.18);padding-top:4px">` +
      `<div style="font-size:9px;opacity:0.6">关键指标</div>${rows}</div>`
  }
  return base
}

/** A lightweight canvas label attached to the same Three.js scene as the node. */
export function labelSprite(node: GraphNode): THREE.Sprite {
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
export function getHaloTexture(): THREE.CanvasTexture {
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

export function haloSprite(node: GraphNode): THREE.Sprite {
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
export function getRootHaloTexture(): THREE.CanvasTexture {
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

export function rootHaloSprite(node: GraphNode): THREE.Sprite {
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

// Impacted ring: a dashed amber ring (docs/04 §8 IMPACTED tier).
let impactedRingTexture: THREE.CanvasTexture | null = null
export function getImpactedRingTexture(): THREE.CanvasTexture {
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

export function impactedRingSprite(node: GraphNode): THREE.Sprite {
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

// Cross-layer highlight ring: a dashed teal ring (docs/04 §8 — shape + color),
// used when selecting one plane lifts the associated nodes on the other plane.
let highlightRingTexture: THREE.CanvasTexture | null = null
export function getHighlightRingTexture(): THREE.CanvasTexture {
  if (highlightRingTexture) return highlightRingTexture
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.shadowBlur = 14
  ctx.shadowColor = '#2dd4bf'
  ctx.lineWidth = 5
  ctx.strokeStyle = 'rgba(45, 212, 191, 0.9)'
  ctx.setLineDash([10, 6])
  ctx.beginPath()
  ctx.arc(64, 64, 52, 0, Math.PI * 2)
  ctx.stroke()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  highlightRingTexture = tex
  return tex
}

export function highlightRingSprite(node: GraphNode): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getHighlightRingTexture(),
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
// issue#6 阶段C — 逐对象诊断循环视觉
// ---------------------------------------------------------------------------

/**
 * 判定标记颜色（docs/07 §6 阶段C「判断」态）：
 * 异常红 / 正常绿 / 受影响橙 / 候选黄。与 STATUS_COLORS 同族，画布节点色与光环共用。
 */
export const VERDICT_COLORS = {
  ABNORMAL: '#ef4444',
  NORMAL: '#22c55e',
  IMPACTED: '#f59e0b',
  CANDIDATE: '#fbbf24',
} as const
export type VerdictKey = keyof typeof VERDICT_COLORS

/** 已判断对象判定环（弱于根因/受影响光环；形态+颜色，不只靠颜色）。 */
const verdictRingTextures = new Map<string, THREE.CanvasTexture>()
export function getVerdictRingTexture(color: string): THREE.CanvasTexture {
  const cached = verdictRingTextures.get(color)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.shadowBlur = 14
  ctx.shadowColor = color
  ctx.lineWidth = 5
  ctx.strokeStyle = color
  ctx.beginPath()
  ctx.arc(64, 64, 50, 0, Math.PI * 2)
  ctx.stroke()
  // 顶点小点强化"判定"语义（形态组合，不单靠颜色）。
  ctx.lineWidth = 4
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(64, 14, 7, 0, Math.PI * 2)
  ctx.fill()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  verdictRingTextures.set(color, tex)
  return tex
}

export function verdictRingSprite(node: GraphNode, verdict: VerdictKey): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getVerdictRingTexture(VERDICT_COLORS[verdict]),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  const scale = 14 + node.val * 4
  sprite.scale.set(scale, scale, 1)
  return sprite
}

// —— 查询扫描态：静态底座环 + 可旋转雷达扫掠（材质 rotation 动画，画布 RAF 驱动）——

let scanningBaseTexture: THREE.CanvasTexture | null = null
export function getScanningBaseTexture(): THREE.CanvasTexture {
  if (scanningBaseTexture) return scanningBaseTexture
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.shadowBlur = 16
  ctx.shadowColor = '#22d3ee'
  ctx.lineWidth = 5
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.9)'
  ctx.beginPath()
  ctx.arc(64, 64, 50, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(165, 243, 252, 0.4)'
  ctx.beginPath()
  ctx.arc(64, 64, 58, 0, Math.PI * 2)
  ctx.stroke()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  scanningBaseTexture = tex
  return tex
}

let scanningSweepTexture: THREE.CanvasTexture | null = null
export function getScanningSweepTexture(): THREE.CanvasTexture {
  if (scanningSweepTexture) return scanningSweepTexture
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const cx = 64
  const cy = 64
  const r = 50
  // 雷达扫掠楔形（-70° → +70°），径向淡出。
  const start = -Math.PI * 0.39
  const end = Math.PI * 0.39
  const grad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r)
  grad.addColorStop(0, 'rgba(34, 211, 238, 0)')
  grad.addColorStop(0.82, 'rgba(34, 211, 238, 0.16)')
  grad.addColorStop(1, 'rgba(34, 211, 238, 0.55)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.arc(cx, cy, r, start, end)
  ctx.closePath()
  ctx.fill()
  // 扫掠前沿亮线。
  ctx.strokeStyle = 'rgba(165, 243, 252, 0.95)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + Math.cos(end) * r, cy + Math.sin(end) * r)
  ctx.stroke()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  scanningSweepTexture = tex
  return tex
}

export interface ScanningVisual extends THREE.Group {
  /** 可旋转的扫掠精灵（材质 rotation 动画）。 */
  sweep: THREE.Sprite
}

/** 正在被 Skill 查询对象的扫描视觉：底座环 + 旋转雷达扫掠。 */
export function scanningVisual(node: GraphNode): ScanningVisual {
  const group = new THREE.Group()
  const base = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getScanningBaseTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  const scale = 20 + node.val * 4
  base.scale.set(scale, scale, 1)
  group.add(base)
  const sweep = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getScanningSweepTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  sweep.scale.set(scale, scale, 1)
  group.add(sweep)
  const visual = group as ScanningVisual
  visual.sweep = sweep
  return visual
}

/** 推进扫描扫掠旋转（由画布 RAF 循环调用；delta 为秒）。 */
export function advanceScanningSweep(visual: ScanningVisual, delta: number): void {
  const material = visual.sweep.material as THREE.SpriteMaterial
  material.rotation = (material.rotation ?? 0) + delta * 2.2
}

// —— 聚焦对象上下游一跳弱提示环（聚焦态）——

let neighborHintTexture: THREE.CanvasTexture | null = null
export function getNeighborHintTexture(): THREE.CanvasTexture {
  if (neighborHintTexture) return neighborHintTexture
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.shadowBlur = 10
  ctx.shadowColor = '#67e8f9'
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(103, 232, 249, 0.5)'
  ctx.setLineDash([8, 10])
  ctx.beginPath()
  ctx.arc(64, 64, 52, 0, Math.PI * 2)
  ctx.stroke()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  neighborHintTexture = tex
  return tex
}

export function neighborHintSprite(node: GraphNode): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getNeighborHintTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  const scale = 16 + node.val * 4
  sprite.scale.set(scale, scale, 1)
  return sprite
}

// —— 图谱原始点：金色强光晕（诊断启动后点亮，与 teal 关联点区分）——

let graphOriginTexture: THREE.CanvasTexture | null = null
export function getGraphOriginTexture(): THREE.CanvasTexture {
  if (graphOriginTexture) return graphOriginTexture
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.shadowBlur = 22
  ctx.shadowColor = '#fbbf24'
  ctx.lineWidth = 8
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.95)'
  ctx.beginPath()
  ctx.arc(64, 64, 46, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 2.5
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)'
  ctx.beginPath()
  ctx.arc(64, 64, 60, 0, Math.PI * 2)
  ctx.stroke()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  graphOriginTexture = tex
  return tex
}

export function graphOriginSprite(node: GraphNode): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getGraphOriginTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  const scale = 18 + node.val * 4
  sprite.scale.set(scale, scale, 1)
  return sprite
}

// ---------------------------------------------------------------------------
// 排查证据路径 + 指标芯片（issue 本轮：诊断推进时布局稳定，已走过节点/边累积高亮）
// ---------------------------------------------------------------------------

/** 排查证据路径主题色（issue#10 单点聚焦：当前推进节点=扫描强光（SCAN_COLOR+雷达，唯一活动高亮），
 *  已走过节点/边=弱化灰（非活动背景形态，保留"已排查+顺序"信息，不抢单点主体），当前入边=淡青（推进方向）。 */
export const PATH_COLORS = {
  /** 已走过路径节点（弱化灰——单点聚焦下非活动，仅保留"已排查"信息）。 */
  node: '#3f4a5f',
  /** 已走过路径连线（弱化灰淡背景）。 */
  edge: 'rgba(148, 163, 184, 0.3)',
  /** 当前推进节点的入边（淡青，随当前节点体现推进方向，不抢单点主体）。 */
  edgeActive: 'rgba(103, 232, 249, 0.8)',
  /** 路径桥接中间节点（物理链上非目标节点）的环（弱化 trail）。 */
  ring: 'rgba(148, 163, 184, 0.38)',
} as const

/** 已排查节点的关键指标（指标名 + 数值 + 状态色；悬浮 tooltip 呈现）。 */
export interface MetricChip {
  /** 指标名称（如 时延 / I/O吞吐 / 控制器热复位）。 */
  name: string
  /** 数值（含单位，如 "42ms"、"0 GB/s"、"严重"）。 */
  value: string
  /** 状态色：normal(绿) / warning(黄) / critical(红)。 */
  tone: 'normal' | 'warning' | 'critical'
}

/** 指标状态色（悬浮 tooltip 分级着色：正常绿 / 告警黄 / 异常红）。 */
const CHIP_TONE_COLOR: Record<MetricChip['tone'], string> = {
  normal: '#22c55e',
  warning: '#facc15',
  critical: '#ef4444',
}

// 已走过路径节点环：emerald 实环（与判定环/扫描环形态区分）。
let pathRingTexture: THREE.CanvasTexture | null = null
export function getPathRingTexture(): THREE.CanvasTexture {
  if (pathRingTexture) return pathRingTexture
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.shadowBlur = 16
  ctx.shadowColor = PATH_COLORS.ring
  ctx.lineWidth = 4.5
  ctx.strokeStyle = PATH_COLORS.ring
  ctx.beginPath()
  ctx.arc(64, 64, 52, 0, Math.PI * 2)
  ctx.stroke()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  pathRingTexture = tex
  return tex
}

export function pathRingSprite(node: GraphNode): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getPathRingTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  const scale = 15 + node.val * 4
  sprite.scale.set(scale, scale, 1)
  return sprite
}

// Aggregate member-count badge: a circular notification badge tinted by the
// group's highest severity (docs/05 §5 — shape + color, never color alone).
export function countBadgeSprite(summary: AggregateSummary): THREE.Sprite {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')!
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = 64 * ratio
  canvas.height = 64 * ratio
  context.scale(ratio, ratio)
  const ring =
    summary.maxSeverity === 'CRITICAL'
      ? '#ef4444'
      : summary.maxSeverity === 'WARNING'
        ? '#f59e0b'
        : '#3b82f6'
  context.beginPath()
  context.arc(32, 32, 26, 0, Math.PI * 2)
  context.fillStyle = 'rgba(15, 17, 23, 0.92)'
  context.fill()
  context.lineWidth = 3.5
  context.strokeStyle = ring
  context.stroke()
  context.fillStyle = '#f8fafc'
  context.font = '600 26px system-ui, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(String(summary.total), 32, 34)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  )
  const scale = 0.13
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1)
  sprite.position.set(18, 12, 0)
  return sprite
}

// Detached-critical parent tag: a small pill under the node naming its (still
// collapsed) parent device — "关键对象 · 所属父组 X" (docs/05 §6 DETACHED_CRITICAL).
export function detachedTagSprite(node: GraphNode, parentLabel: string): THREE.Sprite {
  return pillSprite(node, `↳ ${parentLabel}`, '#fcd34d')
}

// Detached-critical layer tag: a pill naming the (still collapsed) parent layer.
export function detachedLayerTagSprite(node: GraphNode, layerLabel: string): THREE.Sprite {
  return pillSprite(node, `↳ ${layerLabel}`, '#2dd4bf')
}

function pillSprite(node: GraphNode, text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')!
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  context.font = `600 ${11 * ratio}px system-ui, sans-serif`
  const width = Math.ceil(context.measureText(text).width + 18 * ratio)
  canvas.width = width
  canvas.height = 22 * ratio
  context.font = `600 ${11 * ratio}px system-ui, sans-serif`
  context.fillStyle = 'rgba(251, 146, 60, 0.16)'
  context.roundRect(0, 0, canvas.width, canvas.height, 11 * ratio)
  context.fill()
  context.lineWidth = 1.5 * ratio
  context.strokeStyle = 'rgba(251, 146, 60, 0.55)'
  context.roundRect(0, 0, canvas.width, canvas.height, 11 * ratio)
  context.stroke()
  context.fillStyle = color
  context.textBaseline = 'middle'
  context.fillText(text, 9 * ratio, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  )
  const scale = 0.1
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1)
  sprite.position.set(0, -15 - node.val * 1.5, 0)
  return sprite
}

// ---------------------------------------------------------------------------
// Link styling helpers
// ---------------------------------------------------------------------------

function isBusinessPath(link: GraphLink, businessPath: boolean): boolean {
  return businessPath && !!link.pathGroup && link.pathGroup.startsWith('block-path')
}

export function linkWidthFor(link: GraphLink, businessPath: boolean): number {
  if (isBusinessPath(link, businessPath)) return 2.4
  // F2：红色虚拟逻辑链（根因 → 证据 → 影响）——粗线突出，与物理连线区分。
  if (link.category === 'logic') return 3.2
  if (link.category === 'knowledge') return 0.7 + (link.weight ?? 0.5) * 0.5
  // 阶段3：静态 Binding（INSTANCE_OF 等）淡显细线；动态 Binding 激活后粗一档。
  if (link.category === 'cross') return isStaticCrossRelation(link.relation) ? 0.5 : 1.3
  return 1.1
}

export function linkParticlesFor(link: GraphLink, businessPath: boolean): number {
  if (isBusinessPath(link, businessPath)) return 4
  // F2：逻辑链带红色粒子动画，随推进实时“流动”。
  return link.category === 'logic' ? 6 : 0
}

/**
 * F2：逻辑链是虚拟连线，不应把远端对象拉近 —— 通过 link 力设置较大目标距离，
 * 让红线只作视觉投影、不参与布局收紧。3d-force-graph 无 linkDistance 便捷方法，
 * 直接配置 d3 link 力。
 */
export function applyLogicLinkDistance(graph: any): void {
  const linkForce = graph?.d3Force?.('link')
  if (linkForce && typeof linkForce.distance === 'function') {
    linkForce.distance((l: GraphLink) => (l.category === 'logic' ? 420 : 50))
  }
}
