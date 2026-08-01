/**
 * Manifest —— Case 自动发现与路由元数据（docs/02 §1、docs/11）。
 *
 * 通过 import.meta.glob 扫描各 Case 目录下的 case.json / manifest.json，
 * 为每一类 Case 构建路由元数据。禁止 `if (case_id === ...)` 特判；
 * 三类 Case 共用同一发现与路由逻辑。
 */

interface RawCaseMeta {
  case_id: string
  name: string
  description: string
  fault_domain?: string
  fault_mode_code?: string
  severity?: string
  scenario_tags?: string[]
  data_mode?: string
  time_origin?: string
  observation_window?: { start: string | null; end: string | null }
  trigger?: { type?: string; object_id?: string; symptom_id?: string }
  expected_duration_ms?: number
  supported_capabilities?: string[]
  future_capabilities?: string[]
}

interface RawManifest {
  schema_name?: string
  schema_version?: string
  case_id: string
  case_version?: string
  data_mode?: string
  locale?: string
  timezone?: string
  compatible_player?: string
  files?: string[]
}

/** 单个 Case 的路由/展示元数据。 */
export interface CaseRouteEntry {
  caseId: string
  /** 相对 cases/ 的目录名。 */
  path: string
  name: string
  description: string
  faultDomain: string | null
  faultModeCode: string | null
  severity: string | null
  scenarioTags: string[]
  dataMode: string
  timeOrigin: string | null
  observationWindow: { start: string | null; end: string | null }
  triggerObjectId: string | null
  supportedCapabilities: string[]
  packageVersion: string | null
  locale: string | null
  timezone: string | null
  expectedDurationMs: number | null
  /** 校验状态（来自 cases/index.json 的 status，若存在）。 */
  status: string | null
}

const caseMetaModules = import.meta.glob<{ default: RawCaseMeta }>('../../cases/*/case.json', { eager: true })
const manifestModules = import.meta.glob<{ default: RawManifest }>('../../cases/*/manifest.json', { eager: true })
const indexModules = import.meta.glob<{ default: { cases: Array<{ case_id: string; path: string; status?: string }> } }>(
  '../../cases/index.json',
  { eager: true },
)

function caseDirOf(path: string): string {
  const m = path.match(/cases\/([^/]+)\//)
  return m ? m[1] : ''
}

function buildIndexStatus(): Map<string, string> {
  const out = new Map<string, string>()
  for (const mod of Object.values(indexModules)) {
    for (const c of mod.default?.cases ?? []) {
      if (c.case_id && c.status) out.set(c.case_id, c.status)
    }
  }
  return out
}

function buildRegistry(): Map<string, CaseRouteEntry> {
  const manifestByDir = new Map<string, RawManifest>()
  for (const [path, mod] of Object.entries(manifestModules)) {
    manifestByDir.set(caseDirOf(path), mod.default)
  }
  const statusById = buildIndexStatus()

  const registry = new Map<string, CaseRouteEntry>()
  for (const [path, mod] of Object.entries(caseMetaModules)) {
    const meta = mod.default
    if (!meta || !meta.case_id) continue
    const dir = caseDirOf(path)
    const manifest = manifestByDir.get(dir)
    const entry: CaseRouteEntry = {
      caseId: meta.case_id,
      path: dir,
      name: meta.name ?? meta.case_id,
      description: meta.description ?? '',
      faultDomain: meta.fault_domain ?? null,
      faultModeCode: meta.fault_mode_code ?? null,
      severity: meta.severity ?? null,
      scenarioTags: meta.scenario_tags ?? [],
      dataMode: meta.data_mode ?? manifest?.data_mode ?? 'mock',
      timeOrigin: meta.time_origin ?? null,
      observationWindow: {
        start: meta.observation_window?.start ?? null,
        end: meta.observation_window?.end ?? null,
      },
      triggerObjectId: meta.trigger?.object_id ?? null,
      supportedCapabilities: meta.supported_capabilities ?? [],
      packageVersion: manifest?.case_version ?? null,
      locale: manifest?.locale ?? null,
      timezone: manifest?.timezone ?? null,
      expectedDurationMs: meta.expected_duration_ms ?? null,
      status: statusById.get(meta.case_id) ?? null,
    }
    if (registry.has(meta.case_id)) {
      throw new Error(`[manifest] duplicate case id: ${meta.case_id}`)
    }
    registry.set(meta.case_id, entry)
  }
  return registry
}

const REGISTRY = buildRegistry()

/** 列出全部 Case 路由元数据（按 caseId 排序）。 */
export function listCases(): CaseRouteEntry[] {
  return [...REGISTRY.values()].sort((a, b) => a.caseId.localeCompare(b.caseId))
}

/** 全部 caseId。 */
export function listCaseIds(): string[] {
  return listCases().map((c) => c.caseId)
}

/** 是否存在某 Case。 */
export function caseExists(caseId: string): boolean {
  return REGISTRY.has(caseId)
}

/** 取单个 Case 路由元数据。 */
export function getCase(caseId: string): CaseRouteEntry | undefined {
  return REGISTRY.get(caseId)
}
