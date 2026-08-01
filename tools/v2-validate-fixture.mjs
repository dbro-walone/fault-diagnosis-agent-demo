#!/usr/bin/env node
/**
 * 独立的文件级 Runtime Contract 校验（端口自 validate_runtime_contract.py）。
 * 读取 schemas/generated/*.fixture.json（即序列化后落盘的快照），按 python
 * 校验器的规则复核，确保“内存对象 → JSON 文件”序列化无丢失。
 *
 * 运行：node tools/v2-validate-fixture.mjs
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dir = resolve(__dirname, '..', 'schemas', 'generated')
const FACT_TYPES = new Set(['ALARM', 'LOG', 'LOG_FINGERPRINT', 'KPI_WINDOW', 'TOPOLOGY_RELATION', 'RESOURCE_STATE', 'ABSENCE', 'SIMILAR_CASE_REFERENCE'])
const EFFECTS = new Set(['STRONG_SUPPORT', 'SUPPORT', 'WEAKEN', 'CONFLICT', 'NEUTRAL'])
const CAND_STATUS = new Set(['INITIAL', 'ACTIVE', 'LEADING', 'WEAKENED', 'CONFLICTING', 'CONFIRMED', 'NOT_CONFIRMED', 'INSUFFICIENT_EVIDENCE'])
const CHAIN_STATUS = new Set(['PENDING', 'IN_PROGRESS', 'SATISFIED', 'CONFLICTING', 'UNAVAILABLE'])

let totalFiles = 0
let totalErrors = 0

for (const file of readdirSync(dir).filter((f) => f.endsWith('.fixture.json')).sort()) {
  totalFiles++
  const data = JSON.parse(readFileSync(resolve(dir, file), 'utf-8'))
  const errors = []

  if (data.schema_version !== '2.0') errors.push('schema_version must be 2.0')
  const { session, facts = [], evidences = [], candidates = [], events = [], minimum_evidence_chain: chain = {} } = data

  // 禁止 legacy 字段（递归）
  const walk = (v, p) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`))
    else if (v && typeof v === 'object') for (const [k, val] of Object.entries(v)) {
      if (k === 'confidence' || k === 'initial_confidence') errors.push(`legacy field ${p}.${k}`)
      walk(val, `${p}.${k}`)
    }
  }
  walk(data, '')

  // 事件序列
  const seqs = events.map((e) => e.sequence).filter((s) => Number.isInteger(s) && s >= 1)
  if (seqs.length !== events.length) errors.push('some events have invalid sequence')
  if (new Set(seqs).size !== seqs.length) errors.push('duplicate event sequence')
  const sorted = [...seqs].sort((a, b) => a - b)
  if (seqs.length && JSON.stringify(sorted) !== JSON.stringify(Array.from({ length: seqs.length }, (_, i) => i + 1))) errors.push('event sequences contain a gap')
  if (seqs.length && Math.min(...seqs) !== 1) errors.push('event sequence must start at 1')
  if (seqs.length && session.last_sequence !== Math.max(...seqs)) errors.push('last_sequence mismatch')
  if (!session.session_id) errors.push('session_id required')
  if (!['LIVE', 'PAUSED', 'REPLAY'].includes(session.mode)) errors.push('mode invalid')
  if (typeof session.agent_focus !== 'object' || !session.agent_focus) errors.push('agent_focus must be object')

  const factIds = new Set()
  for (const f of facts) {
    factIds.add(f.fact_id)
    if (!FACT_TYPES.has(f.fact_type)) errors.push(`${f.fact_id} bad fact_type`)
    if (!Array.isArray(f.object_refs) || !f.object_refs.length) errors.push(`${f.fact_id} needs object_refs`)
    if (!f.source || !f.source.execution_id || !f.source.skill_id) errors.push(`${f.fact_id} bad source`)
    if (!Array.isArray(f.source?.source_refs) || !f.source.source_refs.length) errors.push(`${f.fact_id} bad source_refs`)
    if (typeof f.payload !== 'object') errors.push(`${f.fact_id} bad payload`)
  }

  const evidenceIds = new Set()
  for (const ev of evidences) {
    evidenceIds.add(ev.evidence_id)
    if (!Array.isArray(ev.fact_refs) || !ev.fact_refs.length) errors.push(`${ev.evidence_id} needs fact_refs`)
    for (const r of ev.fact_refs) if (!factIds.has(r)) errors.push(`${ev.evidence_id} unknown fact_ref ${r}`)
    if (!Array.isArray(ev.effects) || !ev.effects.length) errors.push(`${ev.evidence_id} needs effects`)
    for (const eff of ev.effects || []) {
      if (!candidates.some((c) => c.candidate_id === eff.candidate_id)) errors.push(`${ev.evidence_id} effect unknown candidate`)
      if (!EFFECTS.has(eff.effect)) errors.push(`${ev.evidence_id} bad effect`)
      if (typeof eff.score_delta !== 'number') errors.push(`${ev.evidence_id} bad score_delta`)
      if (!eff.explanation) errors.push(`${ev.evidence_id} missing explanation`)
    }
    // 时序血缘
    for (const r of ev.fact_refs) {
      const fc = facts.find((f) => f.fact_id === r)?.created_sequence
      if (fc != null && ev.created_sequence != null && fc > ev.created_sequence) errors.push(`${ev.evidence_id} created before fact ${r}`)
    }
  }

  const candIds = new Set(candidates.map((c) => c.candidate_id))
  for (const c of candidates) {
    if (typeof c.diagnosis_support_score !== 'number' || c.diagnosis_support_score < 0 || c.diagnosis_support_score > 100) errors.push(`${c.candidate_id} bad score`)
    if (!CAND_STATUS.has(c.status)) errors.push(`${c.candidate_id} bad status`)
    if (!c.object_id || !c.fault_mode_code) errors.push(`${c.candidate_id} needs object/fault_mode`)
  }

  // 最小证据链
  if (!candIds.has(chain.candidate_id)) errors.push('chain references unknown candidate')
  if (!Array.isArray(chain.items) || !chain.items.length) errors.push('chain items empty')
  let requiredSatisfied = true
  for (const it of chain.items || []) {
    if (!CHAIN_STATUS.has(it.status)) errors.push(`chain item ${it.requirement_id} bad status`)
    for (const r of it.evidence_refs || []) if (!evidenceIds.has(r)) errors.push(`chain item ${it.requirement_id} unknown evidence_ref ${r}`)
    if (it.required && it.status !== 'SATISFIED') requiredSatisfied = false
  }

  // 确认候选
  const confirmed = candidates.filter((c) => c.status === 'CONFIRMED')
  if (confirmed.length > 1) errors.push('more than one confirmed candidate')
  if (confirmed.length === 1) {
    if (confirmed[0].candidate_id !== chain.candidate_id) errors.push('confirmed != chain candidate')
    if (!requiredSatisfied) errors.push('confirmed while chain incomplete')
    if (confirmed[0].diagnosis_support_score < 80) errors.push('confirmed score < 80')
  }

  // 每个 fact/evidence 必须被事件引用
  const text = JSON.stringify(events)
  for (const id of factIds) if (!text.includes(id)) errors.push(`fact ${id} has no event reference`)
  for (const id of evidenceIds) if (!text.includes(id)) errors.push(`evidence ${id} has no event reference`)

  totalErrors += errors.length
  console.log(`${errors.length ? '✗' : '✓'} ${file} — facts=${facts.length} evidences=${evidences.length} candidates=${candidates.length} events=${events.length}`)
  for (const e of errors) console.log(`    - ${e}`)
}

console.log(`\n${totalFiles} fixtures, ${totalErrors} errors`)
process.exitCode = totalErrors ? 1 : 0
