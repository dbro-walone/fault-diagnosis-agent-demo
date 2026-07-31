// Case router: the second step of the diagnosis entry pipeline
// (产品主线 §2). Given a {@link NormalizedSymptom}, it decides which Case (if
// any) should handle the diagnosis.
//
// The router only answers "does this Case fit this input?" — it never reads
// fault modes, root-cause objects, support scores or conclusions from the Case
// (铁律 #4, docs §6.1). It works purely off CaseRouteProfile data (symptom code,
// aliases, scopes, priority). Only a MATCHED result may load a Case and create a
// diagnosis session (docs §6.1).

import { RouteStatus } from '../../schemas'
import type { CaseRouteProfile, NormalizedSymptom } from '../../schemas'
import { getRouteProfiles } from './case-loader'

/** Outcome of routing a normalized symptom. */
export interface RouteResult {
  status: RouteStatus
  /** The selected Case id, or null when status is not MATCHED. */
  caseId: string | null
  /** Human-readable explanation of the decision (for UI / debugging). */
  reason: string
}

/** Symptom code used by the normalizer when no rule fired. */
const UNKNOWN_SYMPTOM_CODE = 'UNKNOWN'

interface ProfileMatch {
  profile: CaseRouteProfile
  matched: boolean
  score: number
  reason: string
}

/**
 * Score a single route profile against the normalized symptom. A profile matches
 * when its symptom code equals the normalized code OR one of its aliases appears
 * in the free-text description. Scope agreement is a tie-breaker bonus, never a
 * requirement (so a scope-less input still routes on symptom/alias).
 */
function scoreProfile(
  profile: CaseRouteProfile,
  normalized: NormalizedSymptom,
): ProfileMatch {
  const desc = (normalized.description ?? '').toLowerCase()
  const scope = normalized.businessScope ?? ''
  const reasonParts: string[] = []
  let score = 0
  let matched = false

  for (const sym of profile.supportedSymptoms) {
    if (sym.symptomCode === normalized.symptomCode) {
      matched = true
      score += 10
      reasonParts.push(`故障现象码 ${sym.symptomCode} 命中`)
    }
    for (const alias of sym.aliases) {
      if (alias && desc.includes(alias.toLowerCase())) {
        matched = true
        score += 5
        reasonParts.push(`别名「${alias}」命中`)
      }
    }
  }

  if (matched && scope && profile.supportedScopes.includes(scope)) {
    score += 3
    reasonParts.push(`业务范围 ${scope} 匹配`)
  }

  return { profile, matched, score, reason: reasonParts.join('；') }
}

/**
 * Route a normalized symptom to a Case.
 *
 * Decision rules (docs §6.1):
 *   - INVALID_INPUT  — the symptom could not be standardized (UNKNOWN).
 *   - NOT_MATCHED    — no Case profile matched the symptom code or aliases.
 *   - AMBIGUOUS      — several Cases matched with no clear priority winner.
 *   - MATCHED        — exactly one (or one dominant) Case matched.
 */
export function routeCase(normalized: NormalizedSymptom): RouteResult {
  if (
    !normalized ||
    !normalized.symptomCode ||
    normalized.symptomCode === UNKNOWN_SYMPTOM_CODE
  ) {
    return {
      status: RouteStatus.INVALID_INPUT,
      caseId: null,
      reason: '无法从输入中识别标准故障现象，请补充更具体的现象描述',
    }
  }

  const matches = getRouteProfiles()
    .map((p) => scoreProfile(p, normalized))
    .filter((m) => m.matched)

  if (matches.length === 0) {
    return {
      status: RouteStatus.NOT_MATCHED,
      caseId: null,
      reason: `当前没有 Case 支持故障现象 ${normalized.symptomCode}`,
    }
  }

  // Dominance: higher priority first, then match score.
  matches.sort((a, b) => b.profile.priority - a.profile.priority || b.score - a.score)

  if (matches.length === 1) {
    return {
      status: RouteStatus.MATCHED,
      caseId: matches[0].profile.caseId,
      reason: matches[0].reason,
    }
  }

  const [best, second] = matches
  const dominates =
    best.profile.priority > second.profile.priority || best.score > second.score
  if (dominates) {
    return { status: RouteStatus.MATCHED, caseId: best.profile.caseId, reason: best.reason }
  }

  const ids = matches.map((m) => m.profile.caseId).join('、')
  return {
    status: RouteStatus.AMBIGUOUS,
    caseId: null,
    reason: `输入匹配多个 Case（${ids}），请补充对象或时间范围以消歧`,
  }
}
