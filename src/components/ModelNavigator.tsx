import {
  Search,
  Compass,
  Layers,
  Share2,
  Boxes,
  Network,
  X,
  Check,
} from 'lucide-react'

import type { GraphNode, ModelData } from '@/lib/model-loader'
import { cn, PLANE_COLORS } from '@/lib/utils'

export interface LayerVisibility {
  topology: boolean
  knowledge: boolean
}

export interface ModelNavigatorProps {
  model: ModelData
  activePreset: string
  onPresetChange: (key: string) => void
  layerVisibility: LayerVisibility
  onToggleLayer: (plane: 'topology' | 'knowledge') => void
  visibleDomains: Record<string, boolean>
  onToggleDomain: (code: string) => void
  visibleKgLayers: Record<string, boolean>
  onToggleKgLayer: (code: string) => void
  showCrossLayer: boolean
  onToggleCrossLayer: () => void
  searchQuery: string
  onSearchChange: (value: string) => void
  searchResults: GraphNode[]
  onSearchSelect: (id: string) => void
  selectedNodeId: string | null
}

/** Small section header with an icon. */
function SectionTitle({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[#64748b]">
      <span className="text-[#94a3b8]">{icon}</span>
      {children}
    </div>
  )
}

/** A row with a label on the left and a pill switch on the right. */
function SwitchRow({
  label,
  sublabel,
  checked,
  swatch,
  onChange,
}: {
  label: string
  sublabel?: string
  checked: boolean
  swatch?: string
  onChange: () => void
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/5"
    >
      <span className="flex items-center gap-2">
        {swatch && (
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: swatch, opacity: checked ? 1 : 0.35 }}
          />
        )}
        <span>
          <span
            className={cn(
              'block text-[13px]',
              checked ? 'text-[#e2e8f0]' : 'text-[#64748b]',
            )}
          >
            {label}
          </span>
          {sublabel && <span className="block text-[10px] text-[#64748b]">{sublabel}</span>}
        </span>
      </span>
      <span
        className={cn(
          'relative h-4 w-7 rounded-full transition-colors',
          checked ? 'bg-status-active' : 'bg-white/10',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all',
            checked ? 'left-3.5' : 'left-0.5',
          )}
        />
      </span>
    </button>
  )
}

/** A checkbox filter row with a count badge. */
function FilterRow({
  label,
  count,
  checked,
  swatch,
  onToggle,
}: {
  label: string
  count: number
  checked: boolean
  swatch: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/5"
    >
      <span className="flex items-center gap-2">
        <span
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded border transition-colors',
            checked ? 'border-status-active bg-status-active' : 'border-white/20 bg-transparent',
          )}
        >
          {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
        </span>
        <span
          className={cn('text-[12px]', checked ? 'text-[#cbd5e1]' : 'text-[#64748b]')}
        >
          {label}
        </span>
      </span>
      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] tabular text-[#64748b]">
        {count}
      </span>
    </button>
  )
}

const PLANE_LABEL: Record<string, string> = {
  topology: '实例拓扑',
  knowledge: '知识图谱',
}

export default function ModelNavigator(props: ModelNavigatorProps) {
  const {
    model,
    activePreset,
    onPresetChange,
    layerVisibility,
    onToggleLayer,
    visibleDomains,
    onToggleDomain,
    visibleKgLayers,
    onToggleKgLayer,
    showCrossLayer,
    onToggleCrossLayer,
    searchQuery,
    onSearchChange,
    searchResults,
    onSearchSelect,
    selectedNodeId,
  } = props

  return (
    <aside className="pointer-events-auto absolute left-4 top-4 bottom-4 z-30 flex w-[290px] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#11141c]/90 shadow-2xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <div>
          <div className="text-[13px] font-semibold text-[#e2e8f0]">认知模型</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-active" />
            <span className="text-[10px] text-[#94a3b8]">模型探索态</span>
          </div>
        </div>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-[#64748b]">
          {model.counts.topology + model.counts.knowledge} 节点
        </span>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {/* Search */}
        <section>
          <SectionTitle icon={<Search className="h-3.5 w-3.5" />}>对象搜索</SectionTitle>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#64748b]" />
            <input
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="搜索实例 / 知识对象…"
              className="w-full rounded-md border border-white/10 bg-black/30 py-1.5 pl-8 pr-7 text-[12px] text-[#e2e8f0] placeholder:text-[#64748b] focus:border-status-active/60 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#cbd5e1]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {searchQuery && (
            <div className="mt-1.5 max-h-48 overflow-y-auto rounded-md border border-white/8 bg-black/20">
              {searchResults.length === 0 ? (
                <div className="px-2.5 py-2 text-[11px] text-[#64748b]">无匹配对象</div>
              ) : (
                searchResults.slice(0, 12).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => onSearchSelect(n.id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-white/5',
                      selectedNodeId === n.id && 'bg-status-active/15',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ background: n.color }}
                      />
                      <span className="truncate text-[12px] text-[#cbd5e1]">{n.label}</span>
                    </span>
                    <span className="shrink-0 text-[9px] uppercase text-[#64748b]">
                      {PLANE_LABEL[n.plane]}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </section>

        {/* View presets */}
        <section>
          <SectionTitle icon={<Compass className="h-3.5 w-3.5" />}>视角预设</SectionTitle>
          <div className="grid grid-cols-2 gap-1.5">
            {model.presets.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onPresetChange(p.key)}
                className={cn(
                  'rounded-md border px-2 py-2 text-[11px] leading-tight transition-colors',
                  activePreset === p.key
                    ? 'border-status-active/70 bg-status-active/15 text-[#e2e8f0]'
                    : 'border-white/10 bg-white/[0.02] text-[#94a3b8] hover:border-white/20 hover:text-[#cbd5e1]',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </section>

        {/* Layer toggles */}
        <section>
          <SectionTitle icon={<Layers className="h-3.5 w-3.5" />}>平面</SectionTitle>
          <div className="space-y-0.5">
            <SwitchRow
              label="实例拓扑"
              sublabel="上层 · 资源实例与访问关系"
              checked={layerVisibility.topology}
              swatch={PLANE_COLORS.topology}
              onChange={() => onToggleLayer('topology')}
            />
            <SwitchRow
              label="故障知识图谱"
              sublabel="下层 · 对象类型与故障模式"
              checked={layerVisibility.knowledge}
              swatch={PLANE_COLORS.knowledge}
              onChange={() => onToggleLayer('knowledge')}
            />
          </div>
        </section>

        {/* Cross-layer mapping */}
        <section>
          <SectionTitle icon={<Share2 className="h-3.5 w-3.5" />}>跨层映射</SectionTitle>
          <SwitchRow
            label="显示全部跨层映射"
            sublabel="默认仅显示 INSTANCE_OF 基线映射"
            checked={showCrossLayer}
            onChange={onToggleCrossLayer}
          />
          <p className="mt-1 px-2 text-[10px] leading-relaxed text-[#64748b]">
            候选生成前的故障模式 / 证据映射默认隐藏，避免提前指向根因。
          </p>
        </section>

        {/* Spatial domain filter */}
        <section>
          <SectionTitle icon={<Boxes className="h-3.5 w-3.5" />}>空间域 · 拓扑</SectionTitle>
          <div className="space-y-0.5">
            {model.domains.map((d) => (
              <FilterRow
                key={d.code}
                label={d.name}
                count={d.count}
                checked={visibleDomains[d.code] !== false}
                swatch={PLANE_COLORS.topology}
                onToggle={() => onToggleDomain(d.code)}
              />
            ))}
          </div>
        </section>

        {/* Knowledge layer filter */}
        <section>
          <SectionTitle icon={<Network className="h-3.5 w-3.5" />}>层级 · 知识图谱</SectionTitle>
          <div className="space-y-0.5">
            {model.kgLayers.map((l) => (
              <FilterRow
                key={l.code}
                label={l.name}
                count={l.count}
                checked={visibleKgLayers[l.code] !== false}
                swatch={PLANE_COLORS.knowledge}
                onToggle={() => onToggleKgLayer(l.code)}
              />
            ))}
          </div>
        </section>

        {/* Legend */}
        <section className="border-t border-white/8 pt-3">
          <SectionTitle icon={<Layers className="h-3.5 w-3.5" />}>图例</SectionTitle>
          <div className="space-y-1 px-2 text-[11px] text-[#94a3b8]">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: PLANE_COLORS.topology }} />
              实例资源（蓝）
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: PLANE_COLORS.knowledge }} />
              知识对象（紫）
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full border border-status-evidence/70 bg-status-evidence/20" />
              跨层映射
            </div>
          </div>
        </section>
      </div>
    </aside>
  )
}
