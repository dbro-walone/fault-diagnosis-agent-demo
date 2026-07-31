// Case loader: discovers Case packages under `cases/`, loads each Case's
// metadata + route profile + observations, and exposes them to the rest of the
// runtime (the CaseRouter and, later, the diagnosis Runtime).
//
// Design notes (see docs/Case数据包定义规范_V1.0.md):
//   - Discovery is build-time: `import.meta.glob` eagerly bundles every
//     `cases/<id>/case.json` and `cases/<id>/observations.json`, so adding a Case
//     is data-only (铁律 #5 — Case 只增数据不改代码). The runtime is served as a
//     static bundle (start.py serves dist/), so there is no runtime fetch.
//   - JSON on disk is snake_case for stable serialization; the domain TS types
//     are camelCase (see schemas/types.ts). This module owns the one mapping
//     boundary between them so no other module touches the raw shape.
//   - `ground_truth` is carried in the bundle for the Runtime to confirm against
//     at conclusion time. It MUST NOT seed the initial diagnosis session
//     (铁律 #4 — no early root-cause leak).

import type { CaseRouteProfile, ConclusionType } from '../../schemas'

// ---------------------------------------------------------------------------
// On-disk JSON shapes (snake_case; only the fields the loader consumes)
// ---------------------------------------------------------------------------

interface RawSupportedSymptom {
  object_type: string
  symptom_code: string
  aliases: string[]
}
interface RawRouteProfile {
  case_id: string
  supported_symptoms: RawSupportedSymptom[]
  supported_scopes: string[]
  required_inputs: string[]
  priority: number
}
interface RawFaultWindow {
  start: string
  end: string
}
interface RawGroundTruth {
  root_cause: string
  root_object: string
  final_conclusion: string
  final_support_score: number
}
interface RawCaseJson {
  case_id: string
  title: string
  description: string
  data_mode?: string
  route_profile: RawRouteProfile
  fault_window: RawFaultWindow
  ground_truth: RawGroundTruth
}

/** One skill's mock observation: the query that was run + the data it returned. */
export interface SkillObservation {
  query: string
  result: unknown
}

/**
 * Baseline skill types the demo Case ships observations for. The map is keyed by
 * skill type and stays open (`Record<string, SkillObservation>`) so a Case may
 * declare additional skills without a code change.
 */
export type BaselineSkillType =
  | 'business_mapping'
  | 'topology'
  | 'alert'
  | 'log'
  | 'kpi'
  | 'link_health'
  | 'similar_case'

/** All skill observations for a Case, keyed by skill type. */
export type CaseObservations = Record<string, SkillObservation>

interface RawObservationsJson {
  observations?: CaseObservations
  // Allow a Case to omit the envelope and put skill keys at the top level.
  [skill: string]: unknown
}

export interface FaultWindow {
  start: string
  end: string
}

/**
 * Terminal truth used by the Runtime's confirmation rules. Not a starting
 * candidate, never displayed before CONCLUSION_REACHED (铁律 #4).
 */
export interface GroundTruth {
  rootCause: string
  rootObject: string
  finalConclusion: ConclusionType
  finalSupportScore: number
}

/** A fully loaded, ready-to-run Case package. */
export interface CaseBundle {
  caseId: string
  title: string
  description: string
  dataMode: string
  faultWindow: FaultWindow
  routeProfile: CaseRouteProfile
  observations: CaseObservations
  groundTruth: GroundTruth
}

// ---------------------------------------------------------------------------
// Discovery: bundle every Case + observations file at build time
// ---------------------------------------------------------------------------

const ENVELOPE_KEYS = new Set([
  'schema_name',
  'schema_version',
  'case_id',
  'data_mode',
  'data_disclaimer',
  'timezone',
  'observations',
])

const caseModules = import.meta.glob<{ default: RawCaseJson }>(
  '../../cases/*/case.json',
  { eager: true },
)
const obsModules = import.meta.glob<{ default: RawObservationsJson }>(
  '../../cases/*/observations.json',
  { eager: true },
)

// ---------------------------------------------------------------------------
// snake_case → camelCase mapping
// ---------------------------------------------------------------------------

function parseRouteProfile(raw: RawRouteProfile): CaseRouteProfile {
  return {
    caseId: raw.case_id,
    supportedSymptoms: (raw.supported_symptoms ?? []).map((s) => ({
      objectType: s.object_type,
      symptomCode: s.symptom_code,
      aliases: s.aliases ?? [],
    })),
    supportedScopes: raw.supported_scopes ?? [],
    requiredInputs: raw.required_inputs ?? [],
    priority: raw.priority ?? 0,
  }
}

/**
 * Extract the skill→observation map from a raw observations file. Accepts both
 * the envelope form (`{ observations: { ... } }`) and the bare form (skill keys
 * at the top level), so Cases authored either way load identically.
 */
function parseObservations(raw: RawObservationsJson): CaseObservations {
  if (raw.observations && typeof raw.observations === 'object') {
    return raw.observations as CaseObservations
  }
  const out: CaseObservations = {}
  for (const [key, value] of Object.entries(raw)) {
    if (ENVELOPE_KEYS.has(key)) continue
    if (value && typeof value === 'object') {
      out[key] = value as SkillObservation
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

interface RegistryEntry {
  caseId: string
  raw: RawCaseJson
  routeProfile: CaseRouteProfile
  observations: CaseObservations
}

function toBundle(entry: RegistryEntry): CaseBundle {
  const { raw, routeProfile, observations } = entry
  return {
    caseId: raw.case_id,
    title: raw.title,
    description: raw.description,
    dataMode: raw.data_mode ?? 'mock',
    faultWindow: { start: raw.fault_window.start, end: raw.fault_window.end },
    routeProfile,
    observations,
    groundTruth: {
      rootCause: raw.ground_truth.root_cause,
      rootObject: raw.ground_truth.root_object,
      finalConclusion: raw.ground_truth.final_conclusion as ConclusionType,
      finalSupportScore: raw.ground_truth.final_support_score,
    },
  }
}

/** Build the in-memory registry from the globbed JSON (runs once at module load). */
function buildRegistry(): Map<string, RegistryEntry> {
  const map = new Map<string, RegistryEntry>()
  for (const [casePath, caseMod] of Object.entries(caseModules)) {
    const raw = caseMod.default
    if (!raw || !raw.case_id) continue
    const dir = casePath.replace(/\/case\.json$/, '')
    const obsRaw = obsModules[`${dir}/observations.json`]?.default ?? {}
    map.set(raw.case_id, {
      caseId: raw.case_id,
      raw,
      routeProfile: parseRouteProfile(raw.route_profile),
      observations: parseObservations(obsRaw),
    })
  }
  return map
}

const REGISTRY = buildRegistry()

/** Cache of already-assembled bundles (loadCase is idempotent). */
const bundleCache = new Map<string, CaseBundle>()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** IDs of all discovered Cases, in discovery (file-system) order. */
export function listCaseIds(): string[] {
  return Array.from(REGISTRY.keys())
}

/** True if a Case with the given id is present in the registry. */
export function hasCase(caseId: string): boolean {
  return REGISTRY.has(caseId)
}

/** Route profiles for every Case — the router matches against these. */
export function getRouteProfiles(): CaseRouteProfile[] {
  return Array.from(REGISTRY.values(), (e) => e.routeProfile)
}

/**
 * Load a Case bundle by id. Resolves from cache on repeat calls. The result is
 * async by contract so a future adapter can swap in real DME / ES data sources
 * without changing call sites (docs §1).
 *
 * @throws if `caseId` is unknown.
 */
export async function loadCase(caseId: string): Promise<CaseBundle> {
  const cached = bundleCache.get(caseId)
  if (cached) return cached

  const entry = REGISTRY.get(caseId)
  if (!entry) {
    throw new Error(`[case-loader] Unknown case id: "${caseId}"`)
  }
  const bundle = toBundle(entry)
  bundleCache.set(caseId, bundle)
  return bundle
}
