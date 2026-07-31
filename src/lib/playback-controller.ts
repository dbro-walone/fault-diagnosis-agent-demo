import type { DiagnosisEngine } from '../runtime/diagnosis-engine'

/** UI controller helpers preserve the distinction between event arrival and replay. */
export function stepPlayback(engine: DiagnosisEngine): DiagnosisEngine {
  return engine.isHistorical
    ? engine.seek(engine.replayCursor + 1)
    : engine.advance()
}

export function returnToLive(engine: DiagnosisEngine): DiagnosisEngine {
  return engine.returnLive()
}

export function pendingLiveEvents(engine: DiagnosisEngine): number {
  return Math.max(0, engine.liveHead - engine.replayCursor)
}
