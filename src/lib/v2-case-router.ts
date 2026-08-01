/**
 * V2 Case Router —— 现象标准化 + 可解释加权路由（docs/13 §8、§9）。
 *
 * 数据驱动，禁止 case_id 特判：评分仅基于 Case 元数据（scenarioTags /
 * faultModeCode / trigger）与标准化现象的匹配，三类 Case 共用同一逻辑。
 *
 * 路由结果三态（docs/13 §9.4）：
 * - UNIQUE_MATCH：唯一命中，可自动建会话；
 * - AMBIGUOUS：多 Case 可匹配，需追问/选择，不得猜测；
 * - NO_MATCH：信号不足，引导用户补充或从 Case 列表选择。
 *
 * route_score 四维（docs/13 §9.2）：scenario_anchor(0..40) + symptom_type(0..30)
 * + object_relation(0..20) + value_time(0..10)。该分数仅用于路由，不得展示为诊断支持分。
 */

import { listCases, type CaseRouteEntry } from '../v2'

// ─────────────────────────────────────────────────────────────────────────────
// 现象标准化（docs/13 §8.1）
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalizedSymptom {
  raw_text: string
  normalized_types: string[]
  object_mentions: string[]
  scope_mentions: string[]
  extracted_values: Array<{ name: string; value: number; unit: string }>
  missing_fields: string[]
  normalization_warnings: string[]
}

const TYPE_LEXICON: Array<{ type: string; words: string[] }> = [
  { type: 'CONTROLLER_RESET', words: ['复位', '重启', '热复位', 'watchdog', '主备切换', '主备', '接管', 'warm reset'] },
  { type: 'LATENCY_SPIKE', words: ['时延', '延迟', '变慢', '缓慢', '响应升高', '卡顿', '抖动', '突增'] },
  { type: 'NOISY_NEIGHBOR', words: ['扰邻', '争抢', '争用', '邻居', '其他主机', '同阵列', '兄弟消费者', '反向'] },
  { type: 'IO_BURST', words: ['i/o突增', 'io突增', '吞吐', '带宽', '批处理', '负载突增'] },
  { type: 'REPLICATION_RPO_HIGH', words: ['rpo', '远程复制', '容灾', '同步滞后', '复制滞后', '保护降级', 'recovery point'] },
  { type: 'REPLICATION_BACKLOG', words: ['积压', '堆积', '待复制', 'backlog'] },
  { type: 'LINK_LOSS', words: ['丢包', '重传', '链路', '拥塞', 'congestion'] },
  { type: 'DISK_FAILURE', words: ['磁盘', '扇区', '坏道', 'raid', '降级', '重建', '盘故障'] },
]

const OBJECT_LEXICON: Array<{ canonical: string; words: string[] }> = [
  { canonical: 'host', words: ['主机', 'host'] },
  { canonical: 'lun', words: ['lun', '逻辑卷'] },
  { canonical: 'controller', words: ['控制器', 'controller', '0a', '0b'] },
  { canonical: 'pool', words: ['存储池', 'pool', '池'] },
  { canonical: 'port', words: ['端口', 'port', 'fc '] },
  { canonical: 'replication_session', words: ['复制会话', 'replication', 'session', 'rs0', 'rs01'] },
  { canonical: 'business', words: ['业务', '交易'] },
]

const SCOPE_LEXICON = ['数据库', '虚拟化', '备份', '文件', '块业务', '远程复制', '容灾', '共享存储']

const VALUE_RE = /(\d+\.?\d*)\s*(ms|s|秒|minute|min|分钟|gb\/s|iops|%|gb|mb)/gi

function inferValueName(text: string, unit: string): string {
  const u = unit.toLowerCase()
  if (u.match(/minute|min|分钟/)) return text.includes('rpo') ? 'rpo' : 'duration'
  if (u === 'ms') return 'latency'
  if (u.match(/gb|mb/)) return 'throughput'
  if (u === 'iops') return 'iops'
  return 'value'
}

export function normalizeSymptom(rawText: string): NormalizedSymptom {
  const text = (rawText ?? '').toLowerCase()
  const normalized_types = TYPE_LEXICON.filter((t) => t.words.some((w) => text.includes(w))).map((t) => t.type)
  const object_mentions = OBJECT_LEXICON.filter((o) => o.words.some((w) => text.includes(w))).map((o) => o.canonical)
  const scope_mentions = SCOPE_LEXICON.filter((s) => text.includes(s.toLowerCase()))
  const extracted_values: Array<{ name: string; value: number; unit: string }> = []
  let m: RegExpExecArray | null
  VALUE_RE.lastIndex = 0
  while ((m = VALUE_RE.exec(text))) {
    extracted_values.push({ name: inferValueName(text, m[2]), value: parseFloat(m[1]), unit: m[2] })
  }
  const missing_fields: string[] = []
  if (!object_mentions.length) missing_fields.push('object')
  if ((text.includes('rpo') || text.includes('复制')) && !text.includes('session') && !text.includes('会话')) {
    missing_fields.push('replication_session')
  }
  const normalization_warnings: string[] = []
  if (!normalized_types.length) normalization_warnings.push('no_symptom_type_recognized')
  return {
    raw_text: rawText ?? '',
    normalized_types,
    object_mentions,
    scope_mentions,
    extracted_values,
    missing_fields,
    normalization_warnings,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 加权路由（docs/13 §9.2）
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  anchor: number
  type: number
  object: number
  value: number
}

export interface RouteCandidate {
  caseId: string
  name: string
  score: number
  breakdown: ScoreBreakdown
  explanation: string
}

export type RouteStatus = 'UNIQUE_MATCH' | 'AMBIGUOUS' | 'NO_MATCH'

/** 路由错误码（docs/13 §18.1 子集）。 */
export type RouteErrorCode = 'CASE_ROUTE_AMBIGUOUS' | 'CASE_ROUTE_NO_MATCH'

export interface RouteResult {
  status: RouteStatus
  caseId: string | null
  entry: CaseRouteEntry | null
  candidates: RouteCandidate[]
  normalized: NormalizedSymptom
  reason: string
  /** 结构化错误码（docs/13 §18.1），UNIQUE_MATCH 时为 null。 */
  error_code: RouteErrorCode | null
  /** 本次路由的可观测性追踪 id（确定性，基于输入）。 */
  correlation_id: string
  /** 向后兼容：仅 UNIQUE_MATCH 为 true。 */
  confident: boolean
}

/** 确定性短哈希，用作 correlation_id（可观测性追踪，非安全用途）。 */
function stableHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** All 2-char substrings of CJK runs —— 语言无关的核心匹配信号。 */
export function cjkBigrams(text: string): Set<string> {
  const grams = new Set<string>()
  const cjk = text.match(/[一-鿿]+/g) ?? []
  for (const run of cjk) {
    for (let i = 0; i < run.length - 1; i += 1) grams.add(run.slice(i, i + 2))
  }
  return grams
}

/** fault_mode_code → 典型现象类型（数据驱动，非 case_id 特判）。 */
function profileTypes(faultModeCode: string | null): string[] {
  const code = (faultModeCode ?? '').toUpperCase()
  if (code.includes('RESET')) return ['CONTROLLER_RESET', 'LATENCY_SPIKE']
  if (code.includes('NOISY_NEIGHBOR')) return ['NOISY_NEIGHBOR', 'IO_BURST', 'LATENCY_SPIKE']
  if (code.includes('REPLICATION')) return ['REPLICATION_RPO_HIGH', 'LINK_LOSS', 'REPLICATION_BACKLOG']
  // 磁盘故障：区分信号是磁盘/RAID/扇区词，而非通用时延（避免抢占其他场景的时延现象）。
  if (code.includes('DISK') || code.includes('RAID')) return ['DISK_FAILURE']
  return []
}

const GENERIC_TAGS = new Set(['full_data', 'multi_evidence', 'multi-host'])

function scoreCase(entry: CaseRouteEntry, normalized: NormalizedSymptom, grams: Set<string>): RouteCandidate {
  const rawLower = normalized.raw_text.toLowerCase()
  // scenario_anchor(0..40)：语义 tag 命中 + name/desc bigram 重叠。
  const semanticTags = entry.scenarioTags.filter((t) => !GENERIC_TAGS.has(t.toLowerCase()))
  let anchor = 0
  for (const tag of semanticTags) {
    if (rawLower.includes(tag.toLowerCase())) anchor += 10
  }
  const hay = [
    entry.name,
    entry.description,
    entry.faultDomain ?? '',
    entry.faultModeCode ?? '',
    entry.scenarioTags.join(' '),
  ].join(' ')
  const caseGrams = cjkBigrams(hay)
  let overlap = 0
  for (const g of grams) if (caseGrams.has(g)) overlap += 1
  anchor = Math.min(40, anchor + overlap * 3)

  // symptom_type(0..30)：标准化类型 ∩ 该 Case 典型类型。
  const types = profileTypes(entry.faultModeCode)
  const typeHits = types.filter((t) => normalized.normalized_types.includes(t)).length
  const type = Math.min(30, typeHits * 15)

  // object_relation(0..20)：提及对象命中 trigger 对象 / 故障域 / 类型相关对象。
  const trigObj = (entry.triggerObjectId ?? '').toLowerCase()
  const domain = (entry.faultDomain ?? '').toLowerCase()
  let object = 0
  if (trigObj && normalized.object_mentions.some((o) => trigObj.includes(o) || o.includes(trigObj))) {
    object = 20
  } else if (domain && normalized.object_mentions.some((o) => domain.includes(o) || o.includes(domain))) {
    object = 15
  } else if (normalized.object_mentions.length && typeHits > 0) {
    object = 8
  }

  // value_time(0..10)：抽取数值，复制场景的 RPO 数值给满分。
  let value = 0
  if (normalized.extracted_values.length) value = 5
  if (types.includes('REPLICATION_RPO_HIGH') && normalized.extracted_values.some((v) => v.name === 'rpo')) value = 10

  const score = anchor + type + object + value
  return {
    caseId: entry.caseId,
    name: entry.name,
    score,
    breakdown: { anchor, type, object, value },
    explanation: `锚点${anchor}/现象${type}/对象${object}/数值${value}`,
  }
}

/** 唯一命中门槛（docs/13 §9.2）：Top1 ≥ 50 且与 Top2 分差 ≥ 15（margin 保证区分度）。 */
const UNIQUE_SCORE_MIN = 50
const UNIQUE_MARGIN_MIN = 15
const AMBIGUOUS_SCORE_MIN = 30

/**
 * 路由自由文本现象（+可选业务范围）到 Case。无 Case 数据时抛错。
 * 不再默认回退首个 Case：信号不足时返回 AMBIGUOUS/NO_MATCH 由调用方追问（#2/§9.4）。
 */
export function routeToCase(symptom: string, businessScope = ''): RouteResult {
  const cases = listCases()
  if (cases.length === 0) throw new Error('未发现任何 Case 数据包')
  const text = `${symptom} ${businessScope}`.trim()
  const normalized = normalizeSymptom(text)
  const grams = cjkBigrams(text)
  const ranked = cases
    .map((e) => scoreCase(e, normalized, grams))
    .sort((a, b) => b.score - a.score)
  const top1 = ranked[0]
  const top2 = ranked[1]
  const margin = top2 ? top1.score - top2.score : top1.score

  let status: RouteStatus
  let caseId: string | null = null
  let errorCode: RouteErrorCode | null = null
  if (top1.score >= UNIQUE_SCORE_MIN && margin >= UNIQUE_MARGIN_MIN) {
    status = 'UNIQUE_MATCH'
    caseId = top1.caseId
  } else if (top1.score >= AMBIGUOUS_SCORE_MIN) {
    status = 'AMBIGUOUS'
    errorCode = 'CASE_ROUTE_AMBIGUOUS'
  } else {
    status = 'NO_MATCH'
    errorCode = 'CASE_ROUTE_NO_MATCH'
  }

  const reason =
    status === 'UNIQUE_MATCH'
      ? `唯一命中：${top1.name}（route_score=${top1.score}，领先第二名 ${margin} 分）`
      : status === 'AMBIGUOUS'
        ? `现象可匹配多个 Case（领先 ${top1.name}/${top1.score}，分差仅 ${margin}），请选择或补充区分性信息`
        : `未识别足够的场景信号（最高 ${top1.name}/${top1.score}），请更详细描述或从 Case 列表选择`

  return {
    status,
    caseId,
    entry: caseId ? cases.find((c) => c.caseId === caseId) ?? null : null,
    candidates: ranked.slice(0, 3),
    normalized,
    reason,
    error_code: errorCode,
    correlation_id: `rt-${stableHash(text)}`,
    confident: status === 'UNIQUE_MATCH',
  }
}
