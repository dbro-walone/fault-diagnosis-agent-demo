import type { PlanTask, SkillResult } from '../../schemas/types'

/**
 * Mock Skill Executor
 * 根据 Task 的 skillType 从 Case 观测数据中查询事实
 */

type ObservationKey = 'business_mapping' | 'topology' | 'alert' | 'log' | 'kpi' | 'link_health' | 'similar_case'

interface ObservationEntry {
  query: string
  result: Record<string, unknown>
}

type ObservationData = Partial<Record<ObservationKey, ObservationEntry>>

export class MockSkillExecutor {
  private observations: ObservationData
  private static execCounter = 0

  constructor(observations: ObservationData) {
    this.observations = observations
  }

  private static nextExecId(): string {
    MockSkillExecutor.execCounter++
    return `skill-exec-${String(MockSkillExecutor.execCounter).padStart(3, '0')}`
  }

  execute(task: PlanTask): SkillResult {
    const obsKey = this.mapSkillTypeToObs(task.skillType)
    const obs = this.observations[obsKey]

    if (!obs) {
      return {
        skillId: MockSkillExecutor.nextExecId(),
        taskType: task.skillType,
        success: false,
        data: null,
        error: `No observation data for skill type: ${task.skillType}`,
        timestamp: new Date().toISOString(),
      }
    }

    return {
      skillId: MockSkillExecutor.nextExecId(),
      taskType: task.skillType,
      success: true,
      data: obs.result,
      error: null,
      timestamp: new Date().toISOString(),
    }
  }

  private mapSkillTypeToObs(skillType: string): ObservationKey {
    const mapping: Record<string, ObservationKey> = {
      business_mapping: 'business_mapping',
      topology: 'topology',
      alert: 'alert',
      log: 'log',
      kpi: 'kpi',
      link_health: 'link_health',
      similar_case: 'similar_case',
    }
    return mapping[skillType] || 'business_mapping'
  }
}
