import type {
  CaseBundle,
  CaseRouteProfile,
  OntologyScenarioDefinition,
} from '../../schemas'
import { validateScenarioDefinition } from '../runtime/diagnosis-engine'

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
interface RawCaseJson {
  schema_name: string
  schema_version: string
  case_id: string
  title: string
  description: string
  data_mode?: string
  route_profile: RawRouteProfile
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateCaseMetadata(value: unknown): asserts value is RawCaseJson {
  if (
    !isRecord(value) || value.schema_name !== 'dme-fault-case-package' ||
    value.schema_version !== '1.1.0' || typeof value.case_id !== 'string' ||
    !value.case_id.trim() || typeof value.title !== 'string' ||
    typeof value.description !== 'string' || !isRecord(value.route_profile) ||
    value.route_profile.case_id !== value.case_id
  ) throw new Error('[case-loader] invalid schema_name/schema_version or Case/profile ids')
}

const caseModules = import.meta.glob<{ default: RawCaseJson }>(
  '../../cases/*/case.json',
  { eager: true },
)
const scenarioModules = import.meta.glob<{ default: unknown }>(
  '../../cases/*/scenario.json',
  { eager: true },
)

interface RegistryEntry {
  raw: RawCaseJson
  routeProfile: CaseRouteProfile
  scenario: OntologyScenarioDefinition
}

function parseRouteProfile(raw: RawRouteProfile): CaseRouteProfile {
  const supportedRequiredInputs = new Set([
    'symptom',
    'occurred_at',
    'business_scope',
    'object_type',
  ])
  if (
    !raw || typeof raw.case_id !== 'string' ||
    !Array.isArray(raw.supported_symptoms) || !raw.supported_symptoms.length ||
    !Array.isArray(raw.supported_scopes) || !raw.supported_scopes.length ||
    raw.supported_scopes.some((scope) => typeof scope !== 'string' || !scope.trim()) ||
    !Array.isArray(raw.required_inputs) ||
    raw.required_inputs.some((input) => !supportedRequiredInputs.has(input)) ||
    typeof raw.priority !== 'number'
  ) {
    throw new Error('[case-loader] malformed route_profile')
  }
  for (const symptom of raw.supported_symptoms) {
    if (
      typeof symptom.object_type !== 'string' ||
      typeof symptom.symptom_code !== 'string' ||
      !Array.isArray(symptom.aliases) || symptom.aliases.some((alias) => typeof alias !== 'string')
    ) {
      throw new Error(`[case-loader] malformed supported symptom in ${raw.case_id}`)
    }
  }
  return {
    caseId: raw.case_id,
    supportedSymptoms: raw.supported_symptoms.map((symptom) => ({
      objectType: symptom.object_type,
      symptomCode: symptom.symptom_code,
      aliases: symptom.aliases,
    })),
    supportedScopes: raw.supported_scopes,
    requiredInputs: raw.required_inputs,
    priority: raw.priority,
  }
}

function buildRegistry(): Map<string, RegistryEntry> {
  const registry = new Map<string, RegistryEntry>()
  for (const [path, module] of Object.entries(caseModules)) {
    const raw = module.default
    validateCaseMetadata(raw)
    const directory = path.replace(/\/case\.json$/, '')
    const scenarioValue = scenarioModules[`${directory}/scenario.json`]?.default
    if (!scenarioValue) throw new Error(`[case-loader] ${raw.case_id} has no scenario.json`)
    validateScenarioDefinition(scenarioValue)
    const scenario: OntologyScenarioDefinition = scenarioValue
    if (scenario.caseId !== raw.case_id) {
      throw new Error(`[case-loader] Case/Scenario id mismatch for ${raw.case_id}`)
    }
    if (registry.has(raw.case_id)) throw new Error(`[case-loader] duplicate Case ${raw.case_id}`)
    registry.set(raw.case_id, {
      raw,
      routeProfile: parseRouteProfile(raw.route_profile),
      scenario,
    })
  }
  return registry
}

const REGISTRY = buildRegistry()
const CACHE = new Map<string, CaseBundle>()

export function listCaseIds(): string[] {
  return [...REGISTRY.keys()]
}

export function hasCase(caseId: string): boolean {
  return REGISTRY.has(caseId)
}

/** Route metadata is deliberately the only Case material exposed before routing. */
export function getRouteProfiles(): CaseRouteProfile[] {
  return [...REGISTRY.values()].map((entry) => entry.routeProfile)
}

export async function loadCase(caseId: string): Promise<CaseBundle> {
  const cached = CACHE.get(caseId)
  if (cached) return cached
  const entry = REGISTRY.get(caseId)
  if (!entry) throw new Error(`[case-loader] Unknown case id: ${caseId}`)
  const bundle: CaseBundle = {
    caseId,
    title: entry.raw.title,
    description: entry.raw.description,
    dataMode: entry.raw.data_mode ?? 'mock',
    routeProfile: entry.routeProfile,
    scenario: entry.scenario,
  }
  CACHE.set(caseId, bundle)
  return bundle
}
