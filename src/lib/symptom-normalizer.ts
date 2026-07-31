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
import { getRouteProfiles } from './case-loader'

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

function normalizeOccurredAt(value: string | undefined): string {
  if (!value) return nowIso()
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(trimmed)) {
    return `${trimmed}${formatOffset(DEFAULT_TZ_OFFSET_HOURS)}`
  }
  return trimmed
}

/**
 * Normalize a free-text symptom into a structured {@link NormalizedSymptom}.
 *
 * - Matches the text against data-authored Case aliases (case-insensitive
 *   substring). Adding a Case or alias does not require Runtime/frontend logic.
 * - When no rule fires, returns an UNKNOWN symptom; the router maps that to
 *   NOT_MATCHED / INVALID_INPUT rather than guessing a Case.
 * - `occurred_at` defaults to the current time in `+08:00` (the caller may later
 *   override it from an explicit input field; this function only defaults it).
 */
export function normalizeSymptom(
  raw: string,
  overrides: { occurredAt?: string; businessScope?: string } = {},
): NormalizedSymptom {
  const text = (raw ?? '').trim()
  const lower = text.toLowerCase()

  const rules = getRouteProfiles().flatMap((profile) =>
    profile.supportedSymptoms.map((symptom) => ({
      ...symptom,
      defaultScope: profile.supportedScopes[0] ?? '',
    })),
  )
  const rule = rules.find((candidate) =>
    candidate.aliases.some((alias) => lower.includes(alias.toLowerCase())),
  )

  if (!rule) {
    return {
      objectType: UNKNOWN_OBJECT_TYPE,
      symptomCode: UNKNOWN_SYMPTOM_CODE,
      occurredAt: normalizeOccurredAt(overrides.occurredAt),
      businessScope: overrides.businessScope ?? '',
      description: text,
    }
  }

  return {
    objectType: rule.objectType,
    symptomCode: rule.symptomCode,
    occurredAt: normalizeOccurredAt(overrides.occurredAt),
    businessScope: overrides.businessScope || rule.defaultScope,
    description: text,
  }
}
