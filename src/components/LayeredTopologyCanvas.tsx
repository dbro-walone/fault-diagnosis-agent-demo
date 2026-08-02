import { useMemo } from 'react'
import { ChevronDown, ChevronRight, Layers } from 'lucide-react'

import {
  TOPO_DOMAINS,
  TOPO_SUB_LAYERS,
  buildLayeredActiveGraph,
  computeLayerSummary,
  isLayerAggregateId,
  layerAggregateId,
  topoLayerDef,
  type AggregateSummaryContext,
  type LayeredModelData,
  type TopoLayerCode,
} from '@/lib/layered-topology'
import type { GraphNode, SeverityLevel } from '@/lib/model-loader'
import { cn, STATUS_COLORS } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Layout metrics（竖向条带：域带 → 子层 → 成员，从 S1 到 S3.5）
// ---------------------------------------------------------------------------

const LANE_HEADER_W = 252
const DOMAIN_ROW_H = 66
const SUB_ROW_H = 62
const MEMBER_START_X = 272
const MEMBER_DX = 112
const CHIP_W = 96
const CHIP_H = 30

const SEVERITY_RING: Record<SeverityLevel, string> = {
  NORMAL: '#3b82f6',
  WARNING: STATUS_COLORS.warning,
  CRITICAL: STATUS_COLORS.fault,
}

// ---------------------------------------------------------------------------
// 行结构：域带（聚合头）→ 子层（聚合头 + 成员）
// ---------------------------------------------------------------------------

interface Row {
  code: TopoLayerCode
  isDomain: boolean
  y: number
  /** 该行放置的可见成员节点（展开成员 + DETACHED 关键对象）。 */
  members: GraphNode[]
}

function buildRows(model: LayeredModelData, expanded: Partial<Record<TopoLayerCode, boolean>>, visible: Set<string>): Row[] {
  const rows: Row[] = []
  let y = 0
  for (const domain of TOPO_DOMAINS) {
    const domainRow: Row = { code: domain.code, isDomain: true, y, members: [] }
    rows.push(domainRow)
    y += DOMAIN_ROW_H
    if (expanded[domain.code]) {
      for (const sub of TOPO_SUB_LAYERS) {
        if (sub.domain !== domain.code) continue
        rows.push({
          code: sub.code,
          isDomain: false,
          y,
          members: model.nodes.filter((n) => visible.has(n.id) && n.group === sub.code),
        })
        y += SUB_ROW_H
      }
    } else {
      // 域收起：域内 DETACHED 关键对象保留在域带行。
      domainRow.members = model.nodes.filter(
        (n) => visible.has(n.id) && topoLayerDef(n.group as TopoLayerCode).domain === domain.code,
      )
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export interface LayeredTopologyCanvasProps {
  model: LayeredModelData
  /** 当前分层 Case（构建 model 时用的 caseId）。 */
  caseId: string
  /** 可选 Case 列表（名称取自 manifest）。 */
  cases: Array<{ caseId: string; name: string }>
  /** 切换 Case：重建模型 + 重置展开。 */
  onCaseChange: (caseId: string) => void
  /** 层展开状态（域/子层 code → expanded）。 */
  expandedLayers: Partial<Record<TopoLayerCode, boolean>>
  /** 点击聚合头/chevron 切换展开。 */
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
  /** F2 活动逻辑路径（根因 → 证据 → 影响链）：渲染红色逻辑连线。 */
  logicPath: string[]
  selectedNodeId: string | null
  /** F0：左侧 Object Explorer 是否收起（收起时条带左起点移到画布边缘）。 */
  navigatorCollapsed: boolean
  onNodeSelect: (id: string | null) => void
}

export default function LayeredTopologyCanvas(props: LayeredTopologyCanvasProps) {
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
    onNodeSelect,
  } = props

  const graph = useMemo(
    () => buildLayeredActiveGraph(model, { expandedLayers, criticalObjectIds }),
    [model, expandedLayers, criticalObjectIds],
  )
  const visible = useMemo(() => new Set(graph.nodes.map((n) => n.id)), [graph.nodes])
  const rows = useMemo(() => buildRows(model, expandedLayers, visible), [model, expandedLayers, visible])

  // 节点/聚合头 → 坐标。
  const positions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>()
    for (const row of rows) {
      const cy = row.y + (row.isDomain ? DOMAIN_ROW_H : SUB_ROW_H) / 2
      pos.set(layerAggregateId(row.code), { x: LANE_HEADER_W / 2, y: cy })
      row.members.forEach((node, i) => {
        pos.set(node.id, { x: MEMBER_START_X + i * MEMBER_DX, y: cy })
      })
    }
    return pos
  }, [rows])

  const width = useMemo(() => {
    let maxX = 960
    for (const row of rows) {
      const end = MEMBER_START_X + row.members.length * MEMBER_DX + CHIP_W
      if (end > maxX) maxX = end
    }
    return maxX + 24
  }, [rows])
  const height = useMemo(
    () => rows.reduce((acc, r) => acc + (r.isDomain ? DOMAIN_ROW_H : SUB_ROW_H), 0) + 16,
    [rows],
  )

  // F2：活动逻辑路径 → 红色连线段（对象经 anchorByObjectId 落到可见锚点坐标）。
  // 连续对象锚定到同一可见锚点（如层收起时聚合到域带）时折叠为单点；锚点变化
  // 才画线段 —— 收起态显示"跨层红链"，展开态显示"成员级红链"。
  const logicSegments = useMemo(() => {
    const segs: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }> = []
    let prevAnchor: string | null = null
    let prevPos: { x: number; y: number } | null = null
    for (const oid of logicPath) {
      const anchor = graph.anchorByObjectId.get(oid) ?? oid
      if (anchor === prevAnchor) continue
      const pos = positions.get(anchor)
      if (!pos) continue
      if (prevAnchor !== null && prevPos) {
        segs.push({
          id: `logic-${prevAnchor}->${anchor}`,
          x1: prevPos.x,
          y1: prevPos.y,
          x2: pos.x,
          y2: pos.y,
        })
      }
      prevAnchor = anchor
      prevPos = pos
    }
    return segs
  }, [graph, positions, logicPath])

  const nodeColorFor = (id: string, base: string): string => {
    if (rootCauseIds.has(id)) return STATUS_COLORS.fault
    if (impactedIds.has(id)) return STATUS_COLORS.warning
    if (agentFocusIds.has(id)) return STATUS_COLORS.active
    if (id === selectedNodeId) return '#e2e8f0'
    return base
  }

  return (
    // 从左侧 ModelNavigator 面板（w-[292px]+left-4）右侧开始，避免 2D 条带头被面板遮挡/拦截点击。
    // F0：Object Explorer 收起时条带左起点移到画布边缘。
    <div
      className={cn(
        'absolute bottom-0 right-0 top-0 overflow-auto bg-[#0f1117]',
        navigatorCollapsed ? 'left-4' : 'left-[308px]',
      )}
    >
      <div className="sticky left-0 top-0 z-10 flex items-center gap-2 bg-[#0f1117]/92 px-4 py-3 text-[12px] text-[#94a3b8] backdrop-blur">
        <Layers className="h-4 w-4 text-status-active" />
        <span className="font-semibold text-[#e2e8f0]">S1 → S3 分层拓扑</span>
        <span className="text-[#64748b]">
          {model.nodes.length} 资源 · {model.crossLayerLinks.length} 跨层连线 · 点击层标题展开/收起
        </span>
        {/* Case 切换：加载任意 Case 的分层展示（issue #4「兼而有之」）。 */}
        <label className="ml-auto flex items-center gap-1.5">
          <span className="text-[10px] text-[#64748b]">Case</span>
          <select
            value={caseId}
            onChange={(event) => onCaseChange(event.target.value)}
            aria-label="分层拓扑 Case"
            className="max-w-[240px] cursor-pointer rounded-md border border-white/10 bg-[#11141c] px-2 py-1 text-[11px] text-[#cbd5e1] outline-none focus:border-status-active/60"
          >
            {cases.map((c) => (
              <option key={c.caseId} value={c.caseId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block"
        onClick={() => onNodeSelect(null)}
      >
        {/* 物理连线（含跨层） */}
        <g>
          {graph.links.map((link) => {
            const s = positions.get(link.source as string)
            const t = positions.get(link.target as string)
            if (!s || !t) return null
            const srcNode = model.nodesById.get(link.source as string)
            const tgtNode = model.nodesById.get(link.target as string)
            const cross = !!srcNode && !!tgtNode && srcNode.group !== tgtNode.group
            return (
              <line
                key={link.id}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke={cross ? 'rgba(56, 189, 248, 0.5)' : 'rgba(59, 130, 246, 0.18)'}
                strokeWidth={cross ? 1.5 : 1}
                className="pointer-events-none"
              />
            )
          })}
        </g>

        {/* F2 红色虚拟逻辑链：随诊断推进在根因 → 证据 → 影响路径上延伸 */}
        <g>
          {logicSegments.map((seg) => (
            <line
              key={seg.id}
              x1={seg.x1}
              y1={seg.y1}
              x2={seg.x2}
              y2={seg.y2}
              stroke="#ef4444"
              strokeWidth={3}
              strokeLinecap="round"
              className="pointer-events-none"
            />
          ))}
        </g>

        {/* 条带行 */}
        {rows.map((row) => (
          <LayerRow
            key={row.code}
            model={model}
            row={row}
            expanded={expandedLayers[row.code] === true}
            aggregateContext={aggregateContext}
            positions={positions}
            nodeColorFor={nodeColorFor}
            selectedNodeId={selectedNodeId}
            onToggleLayer={onToggleLayer}
            onNodeClick={onNodeSelect}
          />
        ))}
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 条带行：左侧聚合头 + 右侧成员节点
// ---------------------------------------------------------------------------

interface LayerRowProps {
  model: LayeredModelData
  row: Row
  expanded: boolean
  aggregateContext: AggregateSummaryContext
  positions: Map<string, { x: number; y: number }>
  nodeColorFor: (id: string, base: string) => string
  selectedNodeId: string | null
  onToggleLayer: (code: TopoLayerCode) => void
  onNodeClick: (id: string | null) => void
}

function LayerRow(props: LayerRowProps) {
  const { model, row, expanded, aggregateContext, positions, nodeColorFor, selectedNodeId, onToggleLayer, onNodeClick } = props
  const layer = topoLayerDef(row.code)
  const summary = computeLayerSummary(model, row.code, aggregateContext)
  const rowH = row.isDomain ? DOMAIN_ROW_H : SUB_ROW_H
  const cx = LANE_HEADER_W / 2
  const cy = row.y + rowH / 2
  const ring = SEVERITY_RING[summary.maxSeverity]

  return (
    <g>
      {/* 域带聚合头（整块可点击：rect + 文本 + chevron 共享切换事件） */}
      <g
        onClick={(e) => {
          e.stopPropagation()
          onToggleLayer(row.code)
        }}
        className="cursor-pointer"
      >
        <rect
          x={0}
          y={row.y}
          width={LANE_HEADER_W - 12}
          height={rowH - 8}
          rx={10}
          fill={row.isDomain ? '#131823' : '#141a26'}
          stroke={layer.color}
          strokeOpacity={row.isDomain ? 0.55 : 0.35}
        />
        {/* 成员计数徽标（docs/05 §5：形状 + 光晕，不只靠颜色） */}
        <circle cx={cx - 82} cy={cy - 2} r={15} fill="#0f1117" stroke={ring} strokeWidth={3} />
        <text x={cx - 82} y={cy + 4} textAnchor="middle" fontSize={13} fontWeight={600} fill="#f8fafc">
          {summary.total}
        </text>
        <text x={cx - 58} y={cy - 7} fontSize={9.5} fill="#94a3b8">
          {summary.anomaly} 异常 · {summary.candidate} 候选
        </text>
        <text x={cx - 58} y={cy + 8} fontSize={8.5} fill="#64748b">
          {summary.maxSeverity === 'CRITICAL'
            ? '最高严重'
            : summary.maxSeverity === 'WARNING'
              ? '最高注意'
              : '健康正常'}
        </text>
        {/* 层名 */}
        <text x={cx - 24} y={cy - 6} fontSize={12} fontWeight={600} fill="#e2e8f0">
          {layer.name}
        </text>
        <text x={cx - 24} y={cy + 10} fontSize={9} fill="#64748b">
          {layer.code}
        </text>
        {/* 展开/收起 chevron */}
        <g transform={`translate(${LANE_HEADER_W - 44}, ${cy - 8})`}>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-[#94a3b8]" />
          ) : (
            <ChevronRight className="h-4 w-4 text-[#94a3b8]" />
          )}
        </g>
      </g>

      {/* 成员节点 */}
      {row.members.map((node) => {
        const pos = positions.get(node.id)
        if (!pos) return null
        const color = nodeColorFor(node.id, node.color)
        const isSelected = node.id === selectedNodeId
        return (
          <g
            key={node.id}
            transform={`translate(${pos.x - CHIP_W / 2}, ${pos.y - CHIP_H / 2})`}
            onClick={(e) => {
              e.stopPropagation()
              onNodeClick(node.id)
            }}
            className="cursor-pointer"
          >
            <rect
              width={CHIP_W}
              height={CHIP_H}
              rx={8}
              fill="#1a2030"
              stroke={color}
              strokeWidth={isSelected ? 2 : 1.4}
            />
            <circle cx={12} cy={CHIP_H / 2} r={4} fill={color} />
            <text x={22} y={CHIP_H / 2 + 3.5} fontSize={10.5} fill="#cbd5e1">
              {node.label.length > 12 ? `${node.label.slice(0, 11)}…` : node.label}
            </text>
            <text x={CHIP_W - 8} y={CHIP_H - 6} textAnchor="end" fontSize={7.5} fill="#475569">
              {node.kind}
            </text>
          </g>
        )
      })}
    </g>
  )
}
