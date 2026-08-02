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
import {
  KNOWLEDGE_LAYERS,
  KNOWLEDGE_LAYOUT_METRICS,
  buildCrossLayerLinks,
  knowledgeAssociations,
  knowledgeLayerDef,
  layoutKnowledgeGraph,
  reachableKnowledgeNodes,
  topologyAssociationsForKnowledge,
} from '@/lib/knowledge-plane'
import type { GraphLink, GraphNode, SeverityLevel } from '@/lib/model-loader'
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
  /** 下层故障知识图谱节点（plane==='knowledge'，来自静态 knowledge-graph 模型）。 */
  knowledgeNodes: GraphNode[]
  /** 下层故障知识图谱连线（category==='knowledge'）。 */
  knowledgeLinks: GraphLink[]
  /** 图谱分层显隐（layer code → visible；与 ModelNavigator Knowledge layers 分区联动）。 */
  visibleKgLayers?: Record<string, boolean>
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
    knowledgeNodes,
    knowledgeLinks,
    visibleKgLayers,
  } = props

  const graph = useMemo(
    () => buildLayeredActiveGraph(model, { expandedLayers, criticalObjectIds }),
    [model, expandedLayers, criticalObjectIds],
  )
  const visible = useMemo(() => new Set(graph.nodes.map((n) => n.id)), [graph.nodes])
  const rows = useMemo(() => buildRows(model, expandedLayers, visible), [model, expandedLayers, visible])

  // ── 下层知识图谱：过滤可见分层 → 布局 → 跨层映射（issue #4 落地补全） ──────
  const kgNodes = useMemo(
    () => knowledgeNodes.filter((n) => (visibleKgLayers ?? {})[n.group] !== false),
    [knowledgeNodes, visibleKgLayers],
  )
  const kgLayout = useMemo(
    () => layoutKnowledgeGraph(kgNodes, knowledgeLinks),
    [kgNodes, knowledgeLinks],
  )
  const crossLinks = useMemo(
    () => buildCrossLayerLinks(model.nodes, kgNodes),
    [model.nodes, kgNodes],
  )

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

  // ── 两层总画布：上层条带 + 跨层连线区 + 下层图谱（垂直排列，容器可滚动） ──────
  const KG_GAP = 84
  const kgOffsetY = height + KG_GAP
  const totalWidth = useMemo(() => Math.max(width, kgLayout.width), [width, kgLayout.width])
  const totalHeight = kgOffsetY + kgLayout.height

  // 选中跨层高亮：拓扑侧 → 图谱关联子图；图谱侧 → 关联拓扑实例 + 图谱邻居。
  const selectedIsTopology =
    selectedNodeId != null && model.nodesById.has(selectedNodeId)
  const selectedIsKnowledge =
    selectedNodeId != null && kgLayout.nodePositions.has(selectedNodeId)
  const highlightedKnowledge = useMemo(() => {
    if (!selectedNodeId) return new Set<string>()
    if (selectedIsTopology) {
      return knowledgeAssociations(selectedNodeId, crossLinks, kgLayout.links, 3)
    }
    if (selectedIsKnowledge) {
      return reachableKnowledgeNodes([selectedNodeId], kgLayout.links, 2)
    }
    return new Set<string>()
  }, [selectedNodeId, selectedIsTopology, selectedIsKnowledge, crossLinks, kgLayout.links])
  const highlightedTopology = useMemo(() => {
    if (!selectedNodeId || !selectedIsKnowledge) return new Set<string>()
    return topologyAssociationsForKnowledge(selectedNodeId, crossLinks, kgLayout.links, 3)
  }, [selectedNodeId, selectedIsKnowledge, crossLinks, kgLayout.links])

  /** 跨层映射线段：端点锚定拓扑可见锚点 / 图谱节点坐标（下层偏移 kgOffsetY）。 */
  const crossSegments = useMemo(() => {
    return crossLinks
      .map((l) => {
        const anchor = graph.anchorByObjectId.get(l.topologyId) ?? l.topologyId
        const s = positions.get(anchor)
        const t = kgLayout.nodePositions.get(l.knowledgeId)
        if (!s || !t) return null
        const isInstance = l.relation === 'INSTANCE_OF'
        const active =
          selectedNodeId != null &&
          ((selectedIsTopology && l.topologyId === selectedNodeId) ||
            (selectedIsKnowledge &&
              (l.knowledgeId === selectedNodeId || highlightedTopology.has(l.topologyId))))
        return { ...l, x1: s.x, y1: s.y, x2: t.x, y2: t.y + kgOffsetY, isInstance, active }
      })
      .filter((s): s is NonNullable<typeof s> => s != null)
  }, [crossLinks, graph.anchorByObjectId, positions, kgLayout.nodePositions, kgOffsetY, selectedNodeId, selectedIsTopology, selectedIsKnowledge, highlightedTopology])

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
        <span className="font-semibold text-[#e2e8f0]">S1 → S3 分层拓扑 · 故障知识图谱</span>
        <span className="text-[#64748b]">
          {model.nodes.length} 资源 · {model.crossLayerLinks.length} 跨层连线 ·{' '}
          {kgLayout.nodes.length} 图谱节点 · {crossLinks.length} 跨层映射 · 点击节点查看关联
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
        width={totalWidth}
        height={totalHeight}
        viewBox={`0 0 ${totalWidth} ${totalHeight}`}
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
            highlightedNodeIds={highlightedTopology}
            onToggleLayer={onToggleLayer}
            onNodeClick={onNodeSelect}
          />
        ))}

        {/* ── 下层：故障知识图谱 + 跨层映射连线（issue #4 落地补全） ─────────── */}
        {/* 上下层分隔 + 提示 */}
        <g className="pointer-events-none">
          <line
            x1={0}
            y1={height + 18}
            x2={totalWidth}
            y2={height + 18}
            stroke="rgba(255,255,255,0.08)"
          />
          <text x={16} y={height + 36} fontSize={10.5} fontWeight={600} fill="#94a3b8">
            故障知识图谱 · 对象类型 → 故障现象 → 故障模式/机制 → 证据规则/案例
          </text>
          <text x={16} y={height + 52} fontSize={9} fill="#64748b">
            跨层映射（INSTANCE_OF）淡显 · 选中拓扑/图谱节点高亮其关联
          </text>
        </g>

        {/* 跨层映射连线：INSTANCE_OF 常显淡线；其余映射命中选中时高亮 */}
        <g>
          {crossSegments.map((seg) =>
            !seg.isInstance && !seg.active ? null : (
              <line
                key={seg.id}
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                stroke={seg.active ? 'rgba(20, 184, 166, 0.85)' : 'rgba(148, 163, 184, 0.16)'}
                strokeWidth={seg.active ? 1.8 : 1}
                strokeDasharray={seg.active ? undefined : '5 4'}
                className="pointer-events-none"
              />
            ),
          )}
        </g>

        {/* 图谱层头（列标签 + 计数） */}
        <g>
          {KNOWLEDGE_LAYERS.map((layer, i) => {
            const colX =
              KNOWLEDGE_LAYOUT_METRICS.padSide + i * KNOWLEDGE_LAYOUT_METRICS.colW + KNOWLEDGE_LAYOUT_METRICS.colW / 2
            const y = kgOffsetY + KNOWLEDGE_LAYOUT_METRICS.padTop
            return (
              <g key={layer.code}>
                <text x={colX} y={y + 11} textAnchor="middle" fontSize={11} fontWeight={600} fill={layer.color}>
                  {layer.name}
                </text>
                <text x={colX} y={y + 24} textAnchor="middle" fontSize={8.5} fill="#64748b">
                  {layer.code} · {kgLayout.counts[layer.code] ?? 0}
                </text>
              </g>
            )
          })}
        </g>

        {/* 图谱内部连线 */}
        <g>
          {kgLayout.links.map((link) => {
            const s = kgLayout.nodePositions.get(link.source as string)
            const t = kgLayout.nodePositions.get(link.target as string)
            if (!s || !t) return null
            const active =
              selectedNodeId != null &&
              highlightedKnowledge.has(link.source as string) &&
              highlightedKnowledge.has(link.target as string)
            return (
              <line
                key={link.id}
                x1={s.x}
                y1={s.y + kgOffsetY}
                x2={t.x}
                y2={t.y + kgOffsetY}
                stroke={active ? 'rgba(45, 212, 191, 0.72)' : 'rgba(167, 139, 250, 0.24)'}
                strokeWidth={active ? 1.6 : 1}
                className="pointer-events-none"
              />
            )
          })}
        </g>

        {/* 图谱节点 */}
        <g>
          {kgLayout.nodes.map((node) => {
            const pos = kgLayout.nodePositions.get(node.id)
            if (!pos) return null
            const layer = knowledgeLayerDef(node.group)
            const y = pos.y + kgOffsetY
            const isSelected = node.id === selectedNodeId
            const isHighlighted = highlightedKnowledge.has(node.id)
            const stroke = isSelected ? '#e2e8f0' : isHighlighted ? '#2dd4bf' : layer.color
            const strokeOpacity = isHighlighted ? 1 : 0.5
            return (
              <g
                key={node.id}
                transform={`translate(${pos.x - KNOWLEDGE_LAYOUT_METRICS.nodeW / 2}, ${y - KNOWLEDGE_LAYOUT_METRICS.nodeH / 2})`}
                onClick={(e) => {
                  e.stopPropagation()
                  onNodeSelect(node.id)
                }}
                className="cursor-pointer"
              >
                <rect
                  width={KNOWLEDGE_LAYOUT_METRICS.nodeW}
                  height={KNOWLEDGE_LAYOUT_METRICS.nodeH}
                  rx={8}
                  fill="#141a28"
                  stroke={stroke}
                  strokeWidth={isSelected ? 2 : isHighlighted ? 1.8 : 1.1}
                  strokeOpacity={strokeOpacity}
                />
                <circle cx={12} cy={KNOWLEDGE_LAYOUT_METRICS.nodeH / 2} r={4} fill={layer.color} />
                <text x={22} y={KNOWLEDGE_LAYOUT_METRICS.nodeH / 2 + 3.5} fontSize={10.5} fill="#cbd5e1">
                  {node.label.length > 16 ? `${node.label.slice(0, 15)}…` : node.label}
                </text>
                <text
                  x={KNOWLEDGE_LAYOUT_METRICS.nodeW - 8}
                  y={KNOWLEDGE_LAYOUT_METRICS.nodeH - 6}
                  textAnchor="end"
                  fontSize={7.5}
                  fill="#64748b"
                >
                  {node.group}
                </text>
              </g>
            )
          })}
        </g>
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
  /** 下层图谱选中时关联的拓扑实例 ids（跨层高亮环）。 */
  highlightedNodeIds: Set<string>
  onToggleLayer: (code: TopoLayerCode) => void
  onNodeClick: (id: string | null) => void
}

function LayerRow(props: LayerRowProps) {
  const { model, row, expanded, aggregateContext, positions, nodeColorFor, selectedNodeId, highlightedNodeIds, onToggleLayer, onNodeClick } = props
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
        const isCrossLinked = highlightedNodeIds.has(node.id)
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
            {/* 跨层关联高亮环（下层图谱选中时对应拓扑实例） */}
            {isCrossLinked && (
              <rect
                x={-4}
                y={-4}
                width={CHIP_W + 8}
                height={CHIP_H + 8}
                rx={11}
                fill="none"
                stroke="#2dd4bf"
                strokeWidth={1.6}
                strokeDasharray="4 3"
                className="pointer-events-none"
              />
            )}
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
