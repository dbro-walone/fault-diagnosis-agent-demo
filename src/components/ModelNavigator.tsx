import {
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  FolderOpen,
  Layers,
  Network,
  Search,
  Share2,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import type { ModelData } from '@/lib/model-loader'
import type { ObjectSet } from '../../schemas'
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
  objectSet: ObjectSet
  objectSetFilter: boolean
  onToggleObjectSet: () => void
  aroundRootId: string | null
  onClearRestriction: () => void
  onSearchSelect: (id: string) => void
  selectedNodeId: string | null
  /** D3 设备级聚合展开状态（deviceId → expanded）。 */
  expandedDevices: Record<string, boolean>
  /** 展开/收起设备聚合组（BA-GRAPH-009 显式按钮入口）。 */
  onToggleDevice: (deviceId: string) => void
}

function SectionTitle({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-[#64748b]">
      {icon}
      {children}
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onClick,
  color,
}: {
  label: string
  checked: boolean
  onClick: () => void
  color?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-white/5"
    >
      <span className="flex items-center gap-2 text-[11px] text-[#cbd5e1]">
        {color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />}
        {label}
      </span>
      <span
        className={cn(
          'flex h-4 w-4 items-center justify-center rounded border',
          checked ? 'border-status-active bg-status-active' : 'border-white/20',
        )}
      >
        {checked && <Check className="h-3 w-3" />}
      </span>
    </button>
  )
}

export default function ModelNavigator(props: ModelNavigatorProps) {
  return (
    <aside className="ontology-navigator pointer-events-auto absolute bottom-4 left-4 top-4 z-30 flex w-[292px] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#11141c]/94 shadow-2xl backdrop-blur-md">
      <div className="border-b border-white/8 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold">Object Explorer</div>
            <div className="mt-0.5 text-[9px] uppercase tracking-wider text-[#64748b]">
              executable ontology
            </div>
          </div>
          <span className="rounded bg-white/5 px-2 py-1 text-[9px] text-[#64748b]">
            {props.model.counts.topology + props.model.counts.knowledge} BASE
          </span>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        <section>
          <SectionTitle icon={<Search className="h-3.5 w-3.5" />}>Object Set</SectionTitle>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#64748b]" />
            <input
              value={props.searchQuery}
              onChange={(event) => props.onSearchChange(event.target.value)}
              placeholder="属性、类型、对象 ID…"
              className="w-full rounded-md border border-white/10 bg-black/30 py-2 pl-8 pr-8 text-[11px] outline-none placeholder:text-[#475569] focus:border-status-active/60"
            />
            {props.searchQuery && (
              <button
                type="button"
                onClick={() => props.onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2"
                aria-label="清除搜索"
              >
                <X className="h-3.5 w-3.5 text-[#64748b]" />
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-[#64748b]">
              {props.objectSet.objects.length} objects
            </span>
            {props.searchQuery && (
              <button
                type="button"
                onClick={props.onToggleObjectSet}
                className={cn(
                  'rounded px-2 py-1 text-[9px]',
                  props.objectSetFilter
                    ? 'bg-status-active/20 text-status-active'
                    : 'bg-white/5 text-[#94a3b8]',
                )}
              >
                {props.objectSetFilter ? '显示完整 Lens' : '仅显示对象集'}
              </button>
            )}
          </div>
          {(props.aroundRootId || props.objectSetFilter) && (
            <button
              type="button"
              onClick={props.onClearRestriction}
              className="mt-2 flex w-full items-center justify-center gap-1 rounded border border-status-warning/20 bg-status-warning/[0.06] py-1.5 text-[9px] text-status-warning"
            >
              <SlidersHorizontal className="h-3 w-3" />
              清除 {props.aroundRootId ? 'Search Around' : 'Object Set'} 限制
            </button>
          )}
          {props.searchQuery && (
            <div className="mt-2 max-h-52 overflow-y-auto rounded-md border border-white/8 bg-black/20">
              {props.objectSet.objects.length === 0 ? (
                <div className="px-2.5 py-3 text-[10px] text-[#64748b]">无匹配对象</div>
              ) : (
                props.objectSet.objects.slice(0, 24).map((object) => (
                  <button
                    key={object.id}
                    type="button"
                    onClick={() => props.onSearchSelect(object.id)}
                    className={cn(
                      'flex w-full items-center gap-2 border-b border-white/[0.04] px-2.5 py-2 text-left last:border-0 hover:bg-white/5',
                      props.selectedNodeId === object.id && 'bg-status-active/12',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] text-[#cbd5e1]">
                        {object.label}
                      </span>
                      <span className="text-[8px] uppercase tracking-wide text-[#475569]">
                        {object.type} · {object.id}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </section>

        <section>
          <SectionTitle icon={<Compass className="h-3.5 w-3.5" />}>Camera</SectionTitle>
          <div className="grid grid-cols-2 gap-1">
            {props.model.presets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => props.onPresetChange(preset.key)}
                className={cn(
                  'rounded-md border px-2 py-2 text-[10px]',
                  props.activePreset === preset.key
                    ? 'border-status-active/50 bg-status-active/12 text-[#e2e8f0]'
                    : 'border-white/8 text-[#64748b] hover:text-[#cbd5e1]',
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle icon={<Layers className="h-3.5 w-3.5" />}>Planes</SectionTitle>
          <ToggleRow
            label="上层 · 实例拓扑"
            checked={props.layerVisibility.topology}
            onClick={() => props.onToggleLayer('topology')}
            color={PLANE_COLORS.topology}
          />
          <ToggleRow
            label="下层 · 语义与诊断"
            checked={props.layerVisibility.knowledge}
            onClick={() => props.onToggleLayer('knowledge')}
            color={PLANE_COLORS.knowledge}
          />
          <ToggleRow
            label="跨层映射"
            checked={props.showCrossLayer}
            onClick={props.onToggleCrossLayer}
          />
        </section>

        {props.model.deviceGroups.length > 0 && (
          <section>
            <SectionTitle icon={<FolderOpen className="h-3.5 w-3.5" />}>
              设备聚合
            </SectionTitle>
            <div className="space-y-1">
              {props.model.deviceGroups.map((group) => {
                const expanded = props.expandedDevices[group.deviceId] === true
                return (
                  <button
                    key={group.deviceId}
                    type="button"
                    onClick={() => props.onToggleDevice(group.deviceId)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/5',
                      props.selectedNodeId === group.deviceId && 'bg-status-active/12',
                    )}
                  >
                    <span
                      className={cn(
                        'shrink-0 rounded border px-1 py-0.5 text-[8px] font-medium',
                        expanded
                          ? 'border-status-active/50 bg-status-active/15 text-status-active'
                          : 'border-white/15 bg-white/5 text-[#94a3b8]',
                      )}
                    >
                      {group.deviceId}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[#cbd5e1]">
                      {group.label}
                    </span>
                    <span className="shrink-0 text-[9px] text-[#64748b]">
                      {group.memberIds.length} 成员
                    </span>
                    <span className="shrink-0 text-[9px] text-status-active">
                      {expanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        <section>
          <SectionTitle icon={<Boxes className="h-3.5 w-3.5" />}>Topology domains</SectionTitle>
          {props.model.domains.map((domain) => (
            <ToggleRow
              key={domain.code}
              label={`${domain.name} · ${domain.count}`}
              checked={props.visibleDomains[domain.code] !== false}
              onClick={() => props.onToggleDomain(domain.code)}
            />
          ))}
        </section>

        <section>
          <SectionTitle icon={<Network className="h-3.5 w-3.5" />}>Knowledge layers</SectionTitle>
          {props.model.kgLayers.map((layer) => (
            <ToggleRow
              key={layer.code}
              label={`${layer.code} · ${layer.count}`}
              checked={props.visibleKgLayers[layer.code] !== false}
              onClick={() => props.onToggleKgLayer(layer.code)}
            />
          ))}
        </section>
      </div>

      <footer className="border-t border-white/8 px-4 py-2 text-[9px] leading-relaxed text-[#475569]">
        <span className="inline-flex items-center gap-1">
          <Share2 className="h-3 w-3" />
          所有视图共享稳定 Object ID；筛选不写入诊断状态。
        </span>
      </footer>
    </aside>
  )
}
