import {
  ChevronLeft,
  ChevronRight,
  FastForward,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react'
import {
  EventType,
  OntologyObjectType,
  type JsonValue,
  type OntologyObject,
  type RuntimeEvent,
} from '../../schemas'
import { cn } from '@/lib/utils'

function formatTime(iso: string): string {
  return /T(\d{2}:\d{2}:\d{2})/.exec(iso)?.[1] ?? iso
}

function eventTone(event: RuntimeEvent): string {
  if (event.type === EventType.ROOT_CAUSE_CONFIRMED) return 'text-status-recovered'
  if (event.type === EventType.PLAN_REPLANNED) return 'text-status-warning'
  if (event.type === EventType.EVIDENCE_CREATED) return 'text-status-evidence'
  if (event.type === EventType.ACTION_PROPOSED) return 'text-status-warning'
  return 'text-status-active'
}

function objectAt(events: RuntimeEvent[], id: string, through: number): OntologyObject | null {
  let result: OntologyObject | null = null
  for (const event of events) {
    if (event.sequence > through) break
    const created = event.mutation.upsertObjects?.find((object) => object.id === id)
    if (created) result = { ...created, properties: { ...created.properties } }
    const patch = event.mutation.patches?.find((value) => value.objectId === id)
    if (result && patch) result.properties = { ...result.properties, ...patch.properties }
  }
  return result
}

function PlanDiffCard({ event, events }: { event: RuntimeEvent; events: RuntimeEvent[] }) {
  const current = event.mutation.upsertObjects?.find(
    (object) => object.type === OntologyObjectType.PLAN,
  )
  if (!current) return null
  const previousId = String(current.properties.previousPlanId ?? '')
  const previous = previousId ? objectAt(events, previousId, event.sequence) : null
  const changes = Array.isArray(current.properties.changes)
    ? current.properties.changes as Array<Record<string, JsonValue>>
    : []
  const tasks = (Array.isArray(current.properties.taskIds) ? current.properties.taskIds : [])
    .map(String)
    .map((id) => objectAt(events, id, event.sequence))
    .filter((object): object is OntologyObject => Boolean(object))
  return (
    <div className="mt-2 rounded-md border border-status-warning/15 bg-black/20 p-2 text-[8px]">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[#94a3b8]">
        <span>
          <span className="block text-[#475569]">上一计划</span>
          {previous?.label ?? previousId}
        </span>
        <span className="text-status-warning">→</span>
        <span>
          <span className="block text-[#475569]">当前计划</span>
          {current.label}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        {changes.map((change, index) => (
          <div key={`${String(change.type)}:${String(change.taskId)}:${index}`} className="rounded bg-white/[0.035] px-2 py-1.5">
            <span className="mr-1.5 rounded bg-status-warning/15 px-1 py-0.5 font-semibold text-status-warning">
              {String(change.type)}
            </span>
            <span className="text-[#cbd5e1]">{String(change.taskId)}</span>
            {change.from !== undefined && change.to !== undefined && (
              <span className="ml-1 text-[#64748b]">{String(change.from)} → {String(change.to)}</span>
            )}
            {change.with !== undefined && (
              <span className="ml-1 text-[#64748b]">→ {String(change.with)}</span>
            )}
            <span className="mt-0.5 block text-[#64748b]">{String(change.reason ?? '')}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {tasks.map((task) => (
          <span key={task.id} className="rounded border border-white/8 px-1.5 py-1 text-[#94a3b8]">
            {task.label} · <b className="font-medium text-[#cbd5e1]">{String(task.properties.status)}</b>
          </span>
        ))}
      </div>
    </div>
  )
}

export default function EventTimeline({
  events,
  totalEvents,
  liveHead,
  isHistorical,
  currentSequence,
  isPlaying,
  onPlayPause,
  onStep,
  onSeek,
  onReturnCurrent,
}: {
  events: RuntimeEvent[]
  totalEvents: number
  liveHead: number
  isHistorical: boolean
  currentSequence: number
  isPlaying: boolean
  onPlayPause: () => void
  onStep: () => void
  onSeek: (sequence: number) => void
  onReturnCurrent: () => void
}) {
  const visibleEvents = isHistorical
    ? events.filter((event) => event.sequence <= currentSequence)
    : events
  return (
    <section className="flex h-full flex-col overflow-hidden bg-[#11141c]/96 backdrop-blur-md">
      <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2">
        {isHistorical && (
          <span className="rounded bg-status-warning/15 px-2 py-1 text-[9px] text-status-warning">
            历史回放 · {liveHead - currentSequence} 条新进展
          </span>
        )}
        <button
          type="button"
          onClick={onPlayPause}
          className="flex h-7 w-7 items-center justify-center rounded bg-status-active/15 text-status-active"
          title={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => onSeek(Math.max(0, currentSequence - 1))}
          className="rounded p-1 text-[#64748b] hover:bg-white/5"
          title="上一步"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onStep}
          disabled={currentSequence >= totalEvents && currentSequence >= liveHead}
          className="rounded p-1 text-[#64748b] hover:bg-white/5 disabled:opacity-30"
          title="下一步"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onReturnCurrent}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[9px] text-[#64748b] hover:bg-white/5"
          title="跳到最新事件"
        >
          <FastForward className="h-3.5 w-3.5" />
          最新
        </button>
        <button
          type="button"
          onClick={() => onSeek(0)}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[9px] text-[#64748b] hover:bg-white/5"
          title="重置 Scenario"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          重置
        </button>
        <div className="ml-auto text-[9px] tabular text-[#64748b]">
          游标 {currentSequence} · Live {liveHead} / {totalEvents}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {visibleEvents.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[10px] text-[#64748b]">
            等待 Runtime Event…
          </div>
        ) : (
          <ol className="space-y-1.5">
            {visibleEvents.map((event) => {
              return (
                <li key={event.id}>
                  <button
                    type="button"
                    onClick={() => onSeek(event.sequence)}
                    className={cn(
                      'w-full rounded-md border px-2.5 py-2 text-left transition-colors',
                      event.sequence === currentSequence
                        ? 'border-status-active/35 bg-status-active/[0.07]'
                        : 'border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04]',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[8px] tabular text-[#64748b]">
                        #{event.sequence}
                      </span>
                      <span className={cn('text-[9px] font-medium', eventTone(event))}>
                        {event.type}
                      </span>
                      <span className="ml-auto text-[8px] tabular text-[#475569]">
                        {formatTime(event.occurredAt)}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] font-medium text-[#cbd5e1]">
                      {event.title}
                    </div>
                    <p className="mt-0.5 text-[9px] leading-relaxed text-[#64748b]">
                      {event.detail}
                    </p>
                    {event.type === EventType.PLAN_REPLANNED && (
                      <PlanDiffCard event={event} events={visibleEvents} />
                    )}
                  </button>
                  {(event.type === EventType.FUNCTION_CALL_COMPLETED ||
                    event.type === EventType.ROOT_CAUSE_CONFIRMED) && (
                    <details className="mx-2 border-x border-b border-white/[0.05] px-2 py-1.5 text-[8px] text-[#64748b]">
                      <summary className="cursor-pointer">原始结果 / Event mutation</summary>
                      <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap text-[8px] leading-relaxed">
                        {JSON.stringify(event.mutation, null, 2)}
                      </pre>
                    </details>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}
