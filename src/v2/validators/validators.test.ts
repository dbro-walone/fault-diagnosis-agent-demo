// 校验器分层测试（docs/19 §17.1）—— 7 类校验器中的 Case 级实现。
// 全部 Case 必须通过；负例确认"不可静默修复项"显式报错。
import { describe, expect, it } from 'vitest'
import { listCases } from '../manifest'
import { loadAdaptedCase } from '../case-adapter'
import {
  validateCasePackage,
  validateAdapterIntegration,
  validateRuntimeReplay,
  validateDeterministicStream,
  validateFrontendContract,
  validateAll,
  VALIDATORS,
  VALIDATOR_CATALOG,
} from './index'

const CASE_IDS = listCases().map((c) => c.caseId)

describe('校验器分层目录（§17.1 7 类）', () => {
  it('目录覆盖 7 类且各自标注实现与错误码', () => {
    const kinds = VALIDATOR_CATALOG.map((c) => c.kind)
    expect(kinds).toEqual(expect.arrayContaining([
      'CASE_PACKAGE',
      'KNOWLEDGE_PACKAGE',
      'INSTANCE_TOPOLOGY',
      'ADAPTER_INTEGRATION',
      'LEAK',
      'RUNTIME_REPLAY',
      'FRONTEND_CONTRACT',
    ]))
    expect(new Set(kinds).size).toBe(7)
    for (const c of VALIDATOR_CATALOG) {
      expect(c.implementation.length).toBeGreaterThan(0)
      expect(c.codes.length).toBeGreaterThan(0)
    }
  })

  it('Case 级校验器注册表 4 类 + 确定性', () => {
    const kinds = VALIDATORS.map((v) => v.kind)
    expect(kinds).toEqual(expect.arrayContaining([
      'CASE_PACKAGE',
      'ADAPTER_INTEGRATION',
      'RUNTIME_REPLAY',
      'FRONTEND_CONTRACT',
    ]))
  })
})

describe('Case Package Validator（CKA-*）', () => {
  for (const caseId of CASE_IDS) {
    it(`${caseId} 通过`, () => {
      const result = validateCasePackage(caseId)
      expect(result.ok, `${caseId}: ${result.issues.map((i) => `[${i.code}] ${i.message}`).join('; ')}`).toBe(true)
    })
  }

  it('正向不变量：结论根因在候选集合（CKA-FIXTURE-003 不触发）', () => {
    for (const caseId of CASE_IDS) {
      const adapted = loadAdaptedCase(caseId)
      if (!adapted.conclusion?.root_cause?.candidate_id) continue
      const rootId = adapted.conclusion.root_cause.candidate_id
      expect(adapted.candidates.some((c) => c.candidate_id === rootId), `${caseId} 根因 ${rootId} 不在候选`).toBe(true)
    }
  })
})

describe('Adapter Integration Validator（CKA-SEED/RELEASE/KG/FIXTURE）', () => {
  for (const caseId of CASE_IDS) {
    it(`${caseId} 通过`, () => {
      const result = validateAdapterIntegration(caseId)
      expect(result.ok, `${caseId}: ${result.issues.map((i) => `[${i.code}] ${i.message}`).join('; ')}`).toBe(true)
    })
  }
})

describe('Runtime Replay Validator（RT-*）', () => {
  for (const caseId of CASE_IDS) {
    it(`${caseId} 事件顺序/幂等/快照一致/回放只读`, () => {
      const result = validateRuntimeReplay(caseId)
      expect(result.ok, `${caseId}: ${result.issues.map((i) => `[${i.code}] ${i.message}`).join('; ')}`).toBe(true)
    })
  }

  it('事件流确定性：两次生成一致（RT-007）', () => {
    for (const caseId of CASE_IDS) {
      const result = validateDeterministicStream(caseId)
      expect(result.ok, `${caseId}: ${result.issues.map((i) => i.message).join('; ')}`).toBe(true)
    }
  })
})

describe('Frontend Contract Validator（VWB-*）', () => {
  for (const caseId of CASE_IDS) {
    it(`${caseId} 投影只消费 Known + ViewState 隔离 + 回放只读`, () => {
      const result = validateFrontendContract(caseId)
      expect(result.ok, `${caseId}: ${result.issues.map((i) => `[${i.code}] ${i.message}`).join('; ')}`).toBe(true)
    })
  }
})

describe('validateAll 汇总（§17.1）', () => {
  it('全部 Case 级校验器通过且产生 5×(4+1) 条结果', () => {
    const results = validateAll(CASE_IDS)
    expect(results).toHaveLength(CASE_IDS.length * 5)
    for (const r of results) {
      expect(r.ok, `${r.label}: ${r.issues.map((i) => `[${i.code}] ${i.message}`).join('; ')}`).toBe(true)
    }
  })
})
