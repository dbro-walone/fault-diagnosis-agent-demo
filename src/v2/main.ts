/**
 * V2 Runtime 演示入口（docs/01 交付形态：python3 start.py → http://localhost:8080）。
 *
 * 仅依赖 V2 运行时层，不引用已废弃的 V1 schemas/前端，证明三层 Case 均可由
 * 数据驱动运行：Adapter → Events → Reducer → Snapshot → View Models。
 */

import { listCases } from './manifest'
import { createDiagnosisRuntime, type DiagnosisRuntime } from './diagnosis-runtime'
import { replayCase } from './diagnosis-runtime'
import { ProjectionStore } from './projection-store'

interface CaseCard {
  caseId: string
  name: string
  runtime: DiagnosisRuntime
}

const cards: CaseCard[] = listCases().map((entry) => ({
  caseId: entry.caseId,
  name: entry.name,
  runtime: createDiagnosisRuntime(entry.caseId),
}))

// 终态快照（用于一次性校验/展示）。
const finalSnapshots = new Map<string, ReturnType<typeof replayCase>>()
for (const entry of listCases()) {
  finalSnapshots.set(entry.caseId, replayCase(entry.caseId))
}

// 暴露到 window 便于控制台探查与合约校验。
declare global {
  interface Window {
    v2: unknown
  }
}
window.v2 = { cards, finalSnapshots, listCases }

const root = document.getElementById('root')

function el(tag: string, cls: string | null, text: string | null): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== null) e.textContent = text
  return e
}

function renderCard(card: CaseCard): HTMLElement {
  const runtime = card.runtime
  // 推进到当前游标的快照
  const snap = runtime.snapshot
  const store = new ProjectionStore()
  store.bind(snap)
  const ks = store.knowledgeSnapshot()
  const cand = store.candidateList()
  const act = store.currentAction()

  const box = el('div', 'card', null)
  box.appendChild(el('h2', 'card-title', card.name))
  box.appendChild(el('div', 'card-meta', `${card.caseId} · ${ks.mode_label} · ${ks.phase_label}`))

  const leading = cand.items[0]
  const stats = el('div', 'stats', null)
  stats.appendChild(statItem('领先候选', leading ? `${leading.display_name}（${leading.score_label}）` : '-'))
  stats.appendChild(statItem('候选数', `${cand.items.length}`))
  stats.appendChild(statItem('事实/证据', `${snap.facts.length} / ${snap.evidences.length}`))
  stats.appendChild(statItem('事件', `${runtime.liveHead}/${runtime.events.length}`))
  stats.appendChild(statItem('证据链', `${ks.chain_progress.satisfied}/${ks.chain_progress.total}`))
  stats.appendChild(statItem('终态', ks.terminal_status_label ?? '进行中'))
  box.appendChild(stats)

  if (act.has_activity) {
    const ab = el('div', 'activity', null)
    ab.appendChild(el('div', 'activity-goal', act.goal ?? ''))
    ab.appendChild(el('div', 'activity-reason', act.reason_text ?? ''))
    box.appendChild(ab)
  }

  const list = el('div', 'cand-list', null)
  for (const c of cand.items) {
    const row = el('div', `cand cand-${c.status.toLowerCase()}`, null)
    row.appendChild(el('span', 'cand-name', `${c.is_confirmed ? '✓ ' : ''}${c.display_name}`))
    row.appendChild(el('span', 'cand-score', c.score_label))
    row.appendChild(el('span', 'cand-status', c.status_label))
    list.appendChild(row)
  }
  box.appendChild(list)
  return box
}

function statItem(label: string, value: string): HTMLElement {
  const w = el('div', 'stat', null)
  w.appendChild(el('div', 'stat-label', label))
  w.appendChild(el('div', 'stat-value', value))
  return w
}

function render(): void {
  if (!root) return
  root.innerHTML = ''
  root.appendChild(el('h1', 'title', '故障诊断 Agent — V2 Runtime'))
  root.appendChild(el('p', 'subtitle', 'Adapter → Events → Reducer → Snapshot → View Model · 三类 Case 共用同一运行时'))

  const controls = el('div', 'controls', null)
  const step = el('button', 'btn', '步进首个 Case')
  step.onclick = () => {
    const first = cards[0]
    if (first && !first.runtime.complete) first.runtime = first.runtime.advance()
    render()
  }
  const complete = el('button', 'btn', '全部完成')
  complete.onclick = () => {
    for (const c of cards) {
      let r = c.runtime
      while (!r.complete) r = r.advance()
      c.runtime = r
    }
    render()
  }
  controls.appendChild(step)
  controls.appendChild(complete)
  root.appendChild(controls)

  const grid = el('div', 'grid', null)
  for (const card of cards) grid.appendChild(renderCard(card))
  root.appendChild(grid)
}

render()

// 控制台输出每类 Case 的终态摘要，便于快速核验。
for (const [caseId, snap] of finalSnapshots) {
  const confirmed = snap.candidates.find((c) => c.status === 'CONFIRMED')
  // eslint-disable-next-line no-console
  console.log(`[V2] ${caseId}: events=${snap.events.length}, facts=${snap.facts.length}, ` +
    `evidences=${snap.evidences.length}, confirmed=${confirmed?.candidate_id ?? 'none'} ` +
    `(${confirmed?.diagnosis_support_score ?? '-'})`)
}
