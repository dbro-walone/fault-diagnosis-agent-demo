import { describe, expect, it } from 'vitest'

import { RouteStatus } from '../../schemas/enums'
import { loadCase } from './case-loader'
import { validateCaseMetadata } from './case-loader'
import caseJson from '../../cases/controller_warm_reset_001/case.json'
import { routeCase } from './case-router'
import { normalizeSymptom } from './symptom-normalizer'

describe('SymptomNormalizer -> CaseRouter pipeline', () => {
  it('rejects invalid Case schema metadata and mismatched profile ids', () => {
    const schema = structuredClone(caseJson)
    schema.schema_version = '666.0.0'
    expect(() => validateCaseMetadata(schema)).toThrow(/schema_name\/schema_version/)

    const profile = structuredClone(caseJson)
    profile.route_profile.case_id = 'other-case'
    expect(() => validateCaseMetadata(profile)).toThrow(/Case\/profile ids/)
  })
  it('normalizes natural language before resolving the data-authored Case', async () => {
    const symptom = normalizeSymptom('数据库业务延迟升高', {
      occurredAt: '2026-07-30T14:32:18.120+08:00',
      businessScope: '数据库业务',
    })
    const route = routeCase(symptom)

    expect(route.status).toBe(RouteStatus.MATCHED)
    expect(route.caseId).toBe('controller_warm_reset_001')
    const bundle = await loadCase(route.caseId!)
    expect(bundle.scenario.caseId).toBe(route.caseId)
  })

  it('does not bypass the router for unsupported input', () => {
    const symptom = normalizeSymptom('完全未知的现象', {
      occurredAt: '2026-07-30T14:32:18.120+08:00',
      businessScope: '数据库业务',
    })
    expect(routeCase(symptom).status).not.toBe(RouteStatus.MATCHED)
  })

  it('rejects a supported phrase when the business scope conflicts', () => {
    const symptom = normalizeSymptom('数据库访问突然变慢', {
      occurredAt: '2026-07-30T14:32:18.120+08:00',
      businessScope: '虚拟化业务',
    })
    expect(routeCase(symptom).status).toBe(RouteStatus.NOT_MATCHED)
  })

  it('rejects an invalid occurredAt instead of creating a Session', () => {
    const symptom = normalizeSymptom('数据库访问突然变慢', {
      occurredAt: 'not-a-date',
      businessScope: '数据库业务',
    })
    expect(routeCase(symptom).status).toBe(RouteStatus.INVALID_INPUT)
  })

  it('requires the supported object type and routes the second data-authored fixture', () => {
    const wrongType = {
      ...normalizeSymptom('数据库访问突然变慢', {
        occurredAt: '2026-07-30T14:32:18.120+08:00',
        businessScope: '数据库业务',
      }),
      objectType: 'HOST',
    }
    expect(routeCase(wrongType).status).toBe(RouteStatus.NOT_MATCHED)

    const second = normalizeSymptom('业务 IO 间歇卡顿', {
      occurredAt: '2026-07-30T15:00:00.000+08:00',
      businessScope: '虚拟化业务',
    })
    expect(routeCase(second)).toMatchObject({
      status: RouteStatus.MATCHED,
      caseId: 'monitoring_gap_001',
    })
  })

  it('applies requiredInputs only to the matched Case profile', () => {
    const database = {
      ...normalizeSymptom('数据库访问突然变慢', {
        occurredAt: '2026-07-30T14:32:18.120+08:00',
      }),
      businessScope: '',
    }
    expect(routeCase(database).status).toBe(RouteStatus.MATCHED)

    const monitoring = {
      ...normalizeSymptom('业务 IO 间歇卡顿', {
        occurredAt: '2026-07-30T15:00:00.000+08:00',
      }),
      businessScope: '',
    }
    expect(routeCase(monitoring)).toMatchObject({
      status: RouteStatus.INVALID_INPUT,
      caseId: null,
    })
  })
})
