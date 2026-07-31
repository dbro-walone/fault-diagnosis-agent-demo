import { Activity, FileSearch, Target, X } from 'lucide-react'
import {
  OntologyObjectType,
  type DiagnosisSession,
  type OntologyObject,
} from '../../schemas'

function arrayValue(object: OntologyObject | undefined, key: string): string[] {
  const value = object?.properties[key]
  return Array.isArray(value) ? value.map(String) : []
}

export default function DiagnosisStatusBar({
  session,
  onExit,
}: {
  session: DiagnosisSession
  onExit: () => void
}) {
  const plan = session.overlay.objects.find(
    (object) =>
      object.id === session.currentPlanId && object.type === OntologyObjectType.PLAN,
  )
  const activity = session.overlay.objects.find(
    (object) => object.id === session.currentActivityId,
  )
  const expected = arrayValue(plan, 'expectedEvidence')

  return (
    <div className="flex h-full items-center gap-4 overflow-hidden bg-[#11141c]/96 px-4 py-2 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-status-active/15">
          <Activity className="h-3.5 w-3.5 text-status-active" />
        </span>
        <div>
          <div className="text-[11px] font-semibold">{session.phase}</div>
          <div className="text-[9px] tabular text-[#64748b]">
            Scenario v{session.version}
          </div>
        </div>
      </div>
      <span className="h-8 w-px bg-white/10" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-[#cbd5e1]" title={session.summary}>
          {session.summary}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-3 text-[9px] text-[#64748b]">
          <span className="flex min-w-0 items-center gap-1">
            <Target className="h-3 w-3 text-status-active" />
            <span className="truncate">{String(plan?.properties.goal ?? '准备诊断')}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1">
            <FileSearch className="h-3 w-3 text-status-evidence" />
            <span className="truncate">
              {activity
                ? `${activity.type} · ${activity.label}`
                : expected.length
                  ? `预期：${expected.join(' / ')}`
                  : '等待下一 Runtime Event'}
            </span>
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onExit}
        title="退出 Scenario，返回模型探索"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-white/5"
      >
        <X className="h-4 w-4 text-[#64748b]" />
      </button>
    </div>
  )
}
