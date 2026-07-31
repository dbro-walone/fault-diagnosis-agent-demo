// Symptom normalizer: the first step of the diagnosis entry pipeline
// (产品主线 §2: 故障现象输入). It converts a free-text symptom into a stable
// {@link NormalizedSymptom} that the CaseRouter can match against Case route
// profiles — the frontend must never bypass this and play a Case by keyword
// (铁律 #7: 用户输入必须经 SymptomNormalizer → CaseRouter).
//
// This module only STANDARDIZES input (object type + symptom code + time). It
// performs no diagnosis and never emits a root cause, candidate or support
// score (铁律 #8 — and it cannot leak one, since routing metadata alone drives
// the match).

import type { NormalizedSymptom } from '../../schemas'

/**
 * A normalization rule: if the free text contains any of `keywords`, the symptom
 * is mapped to `symptomCode` / `objectType`. Add a rule here to teach the
 * normalizer a new standardized symptom; routing still happens through the
 * CaseRouteProfile, so a rule never decides which Case runs.
 */
interface SymptomRule {
  symptomCode: string
  objectType: string
  keywords: string[]
  /** Business scope inferred when the rule fires; matched against route scopes. */
  defaultScope: string
}

// Keyword → standardized symptom. The baseline case routes on
// BUSINESS_LATENCY_INCREASE; '数据库' / '变慢' / '时延' / '抖动' are the anchors
// called out in the spec, with a few safe aliases for robustness.
const SYMPTOM_RULES: SymptomRule[] = [
  {
    symptomCode: 'BUSINESS_LATENCY_INCREASE',
    objectType: 'BUSINESS',
    keywords: ['数据库', '变慢', '时延', '抖动', 'db业务', 'db 业务', 'latency'],
    defaultScope: '数据库业务',
  },
]

/** Sentinel used when no rule fires — the router turns this into NOT_MATCHED. */
const UNKNOWN_SYMPTOM_CODE = 'UNKNOWN'
const UNKNOWN_OBJECT_TYPE = 'UNKNOWN'

/**
 * Default timezone offset, in hours, applied to `occurred_at` so the normalized
 * timestamp matches the Case data convention (ISO-8601 with `+08:00`, docs
 * Case数据包定义规范 §2.4 / timezone Asia/Shanghai).
 */
const DEFAULT_TZ_OFFSET_HOURS = 8

/** Format a numeric hour offset as an ISO-8601 fragment, e.g. `+08:00`. */
function formatOffset(offsetHours: number): string {
  const sign = offsetHours >= 0 ? '+' : '-'
  const abs = Math.abs(offsetHours)
  const h = String(Math.floor(abs)).padStart(2, '0')
  const m = String(Math.round((abs - Math.floor(abs)) * 60)).padStart(2, '0')
  return `${sign}${h}:${m}`
}

/** Current time as ISO-8601 in the project's default timezone (default `now`). */
function nowIso(offsetHours: number = DEFAULT_TZ_OFFSET_HOURS): string {
  const shifted = new Date(Date.now() + offsetHours * 3_600_000)
  return shifted.toISOString().replace('Z', formatOffset(offsetHours))
}

/**
 * Normalize a free-text symptom into a structured {@link NormalizedSymptom}.
 *
 * - Matches the text against {@link SYMPTOM_RULES} (case-insensitive substring).
 * - When no rule fires, returns an UNKNOWN symptom; the router maps that to
 *   NOT_MATCHED / INVALID_INPUT rather than guessing a Case.
 * - `occurred_at` defaults to the current time in `+08:00` (the caller may later
 *   override it from an explicit input field; this function only defaults it).
 */
export function normalizeSymptom(raw: string): NormalizedSymptom {
  const text = (raw ?? '').trim()
  const lower = text.toLowerCase()

  const rule = SYMPTOM_RULES.find((r) =>
    r.keywords.some((k) => lower.includes(k.toLowerCase())),
  )

  if (!rule) {
    return {
      objectType: UNKNOWN_OBJECT_TYPE,
      symptomCode: UNKNOWN_SYMPTOM_CODE,
      occurredAt: nowIso(),
      businessScope: '',
      description: text,
    }
  }

  return {
    objectType: rule.objectType,
    symptomCode: rule.symptomCode,
    occurredAt: nowIso(),
    businessScope: rule.defaultScope,
    description: text,
  }
}
