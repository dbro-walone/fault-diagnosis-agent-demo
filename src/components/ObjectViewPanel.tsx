import { Braces, ChevronRight, GitFork, Search, X, Zap } from 'lucide-react'
import type { JsonValue, ObjectView } from '../../schemas'
import { OntologyObjectType } from '../../schemas'
import { cn } from '@/lib/utils'

function displayValue(value: JsonValue): string {
  if (value === null) return '—'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

export default function ObjectViewPanel({
  view,
  onClose,
  onSelectObject,
  onSearchAround,
}: {
  view: ObjectView
  onClose: () => void
  onSelectObject: (id: string) => void
  onSearchAround: () => void
}) {
  const isScenarioObject = Boolean(view.object.scenarioId)
  return (
    <aside className="ontology-object-view pointer-events-auto absolute bottom-5 right-4 top-[112px] z-40 flex w-[330px] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#11141c]/96 shadow-2xl backdrop-blur-md">
      <div className="border-b border-white/8 px-4 py-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
              view.object.type === OntologyObjectType.DECISION
                ? 'bg-status-recovered/15 text-status-recovered'
                : 'bg-status-active/15 text-status-active',
            )}
          >
            <Braces className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold" title={view.object.label}>
              {view.object.label}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-[#64748b]">
              {view.object.type}
              {isScenarioObject && (
                <span className="rounded bg-[#c084fc]/12 px-1.5 py-0.5 text-[#c084fc]">
                  Scenario overlay
                </span>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭 Object View">
            <X className="h-4 w-4 text-[#64748b] hover:text-[#cbd5e1]" />
          </button>
        </div>
        <button
          type="button"
          onClick={onSearchAround}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-status-active/30 bg-status-active/10 px-2 py-1.5 text-[11px] text-status-active hover:bg-status-active/15"
        >
          <Search className="h-3.5 w-3.5" />
          Search Around · 一跳关联对象
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <section>
          <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[#64748b]">
            Properties
          </h3>
          <dl className="space-y-1.5">
            {Object.entries(view.object.properties).map(([key, value]) => (
              <div key={key} className="rounded-md border border-white/6 bg-white/[0.025] px-2.5 py-2">
                <dt className="text-[9px] uppercase tracking-wide text-[#475569]">{key}</dt>
                <dd className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-relaxed text-[#cbd5e1]">
                  {displayValue(value)}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-[#64748b]">
            <GitFork className="h-3.5 w-3.5" />
            Links · {view.incoming.length + view.outgoing.length}
          </h3>
          <div className="space-y-1">
            {[...view.outgoing, ...view.incoming].slice(0, 18).map(({ link, object }) => (
              <button
                key={`${link.id}:${object.id}`}
                type="button"
                onClick={() => onSelectObject(object.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-[#cbd5e1]">{object.label}</span>
                  <span className="text-[9px] text-[#64748b]">{link.type}</span>
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#475569]" />
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-[#64748b]">
            <Zap className="h-3.5 w-3.5" />
            Functions / Actions
          </h3>
          <div className="space-y-1.5">
            {view.availableFunctions.map((fn) => (
              <div key={fn.id} className="rounded-md border border-status-evidence/15 bg-status-evidence/[0.04] px-2.5 py-2">
                <div className="text-[10px] text-status-evidence">{fn.label}</div>
                <div className="mt-0.5 text-[9px] text-[#64748b]">FUNCTION · READ_ONLY</div>
              </div>
            ))}
            {view.availableActions.map((action) => (
              <div key={action.id} className="rounded-md border border-status-warning/15 bg-status-warning/[0.04] px-2.5 py-2">
                <div className="text-[10px] text-status-warning">{action.label}</div>
                <div className="mt-0.5 text-[9px] text-[#64748b]">
                  ACTION · APPROVAL REQUIRED
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <footer className="border-t border-white/8 px-4 py-2 text-[9px] text-[#475569]">
        provenance · {view.object.provenance.sourceRef}
      </footer>
    </aside>
  )
}
