import { describe, expect, it } from 'vitest'

import scenarioJson from '../../cases/controller_warm_reset_001/scenario.json'
import type { OntologyScenarioDefinition } from '../../schemas'
import { createDiagnosisEngine } from '../runtime/diagnosis-engine'
import { pendingLiveEvents, returnToLive, stepPlayback } from './playback-controller'

const scenario = scenarioJson as OntologyScenarioDefinition

describe('App playback interaction controller', () => {
  it('returns to the reached live head without leaking authored future events', () => {
    let engine = createDiagnosisEngine(scenario).advance().advance().advance()
    engine = engine.seek(1)
    expect(pendingLiveEvents(engine)).toBe(2)
    expect(returnToLive(engine).session.version).toBe(3)
  })

  it('keeps a replay cursor stable when a new live event arrives, then steps history', () => {
    let engine = createDiagnosisEngine(scenario).advance().advance().seek(1)
    engine = engine.advance()
    expect(engine.liveHead).toBe(3)
    expect(engine.replayCursor).toBe(1)
    expect(stepPlayback(engine).replayCursor).toBe(2)
  })
})
