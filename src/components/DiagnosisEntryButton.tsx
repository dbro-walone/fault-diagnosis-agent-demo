import { useEffect, useRef, useState } from 'react'
import { Plus, X, Send, Stethoscope, Clock, Boxes } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Floating entry point for the second stage of the main line: the user records
 * a natural-language symptom, when it happened, and which business it affects.
 * On submit it hands a standardized payload to the parent — it performs NO
 * routing or diagnosis itself (铁律 #7: input must flow through
 * SymptomNormalizer → CaseRouter, not be matched in the view).
 */

/** The business workload scopes a symptom can affect. The baseline case is a
 *  数据库业务 latency spike; the rest cover the typical storage workloads. */
const BUSINESS_SCOPES = [
  { value: '数据库业务', label: '数据库业务' },
  { value: '虚拟化业务', label: '虚拟化业务' },
  { value: '备份业务', label: '备份业务' },
  { value: '文件业务', label: '文件业务' },
  { value: '其他', label: '其他 / 不确定' },
] as const

export interface DiagnosisEntryPayload {
  symptom: string
  occurred_at: string
  business_scope: string
}

export interface DiagnosisEntryButtonProps {
  onStartDiagnosis: (payload: DiagnosisEntryPayload) => void
}

/** Current local time as a `datetime-local` value string (YYYY-MM-DDTHH:mm). */
function nowLocalDateTime(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

export default function DiagnosisEntryButton({
  onStartDiagnosis,
}: DiagnosisEntryButtonProps) {
  const [open, setOpen] = useState(false)
  const [symptom, setSymptom] = useState('')
  const [occurredAt, setOccurredAt] = useState(nowLocalDateTime)
  const [businessScope, setBusinessScope] = useState<string>(BUSINESS_SCOPES[0].value)

  /** Wraps both the FAB and the panel so an outside click closes cleanly. */
  const rootRef = useRef<HTMLDivElement>(null)

  const canSubmit = symptom.trim().length > 0

  // Close on outside click / Escape while open.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleSubmit = () => {
    if (!canSubmit) return
    onStartDiagnosis({
      symptom: symptom.trim(),
      occurred_at: occurredAt,
      business_scope: businessScope,
    })
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="ontology-diagnosis-entry pointer-events-auto absolute bottom-6 right-6 z-40">
      {/* Popover panel (opens upward from the FAB) */}
      {open && (
        <div className="absolute bottom-[68px] right-0 w-[360px] overflow-hidden rounded-xl border border-white/10 bg-[#1a1d27]/95 shadow-2xl backdrop-blur-md">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
            <div className="flex items-center gap-2">
              <Stethoscope className="h-4 w-4 text-status-active" />
              <span className="text-[13px] font-semibold text-[#e2e8f0]">与诊断 Agent 对话</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[#64748b] transition-colors hover:text-[#cbd5e1]"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="space-y-3 px-4 py-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-[#64748b]">
                自然语言故障现象
              </label>
              <textarea
                value={symptom}
                onChange={(e) => setSymptom(e.target.value)}
                rows={3}
                placeholder="例如：数据库访问突然变慢，部分 SQL 响应明显升高…"
                className="w-full resize-none rounded-md border border-white/10 bg-black/30 px-2.5 py-2 text-[12px] text-[#e2e8f0] placeholder:text-[#64748b] focus:border-status-active/60 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-[#64748b]">
                <Clock className="h-3 w-3" /> 发生时间
              </label>
              <input
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-black/30 px-2.5 py-2 text-[12px] text-[#e2e8f0] focus:border-status-active/60 focus:outline-none [color-scheme:dark]"
              />
            </div>

            <div>
              <label className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-[#64748b]">
                <Boxes className="h-3 w-3" /> 业务范围
              </label>
              <select
                value={businessScope}
                onChange={(e) => setBusinessScope(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-black/30 px-2.5 py-2 text-[12px] text-[#e2e8f0] focus:border-status-active/60 focus:outline-none [color-scheme:dark]"
              >
                {BUSINESS_SCOPES.map((s) => (
                  <option key={s.value} value={s.value} className="bg-[#1a1d27]">
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-white/8 px-4 py-3">
            <span className="text-[10px] text-[#64748b]">
              {canSubmit ? '提交后进入诊断推演' : '请先描述故障现象'}
            </span>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors',
                canSubmit
                  ? 'bg-status-active text-white hover:brightness-110'
                  : 'cursor-not-allowed bg-white/5 text-[#64748b]',
              )}
            >
              <Send className="h-3.5 w-3.5" />
              开始故障诊断
            </button>
          </div>
        </div>
      )}

      {/* Floating action button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onDoubleClick={() => setOpen(true)}
        title="单击或双击展开诊断对话"
        className="flex items-center gap-2 rounded-full border border-white/10 bg-status-active/90 px-4 py-3 text-white shadow-xl shadow-status-active/20 backdrop-blur-md transition-all hover:bg-status-active hover:shadow-status-active/40"
      >
        <Plus className={cn('h-5 w-5 transition-transform', open && 'rotate-45')} />
        <span className="text-[13px] font-medium">开始故障诊断</span>
      </button>
    </div>
  )
}
