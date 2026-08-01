import { describe, expect, it } from 'vitest'

import { LensId, OntologyObjectType } from '../../schemas'
import type { OntologyScenarioDefinition, ScenarioOverlay } from '../../schemas'
import scenarioJson from '../../cases/controller_warm_reset_001/scenario.json'
import { replayEvents } from '../runtime/diagnosis-engine'
import { buildActiveGraph, loadModelData } from './model-loader'

function filter(lens: LensId, overlay?: ScenarioOverlay) {
  const model = loadModelData()
  return {
    model,
    filter: {
      lens,
      overlay,
      layerTopology: true,
      layerKnowledge: true,
      visibleDomains: Object.fromEntries(model.domains.map(({ code }) => [code, true])),
      visibleKgLayers: Object.fromEntries(model.kgLayers.map(({ code }) => [code, true])),
      showCrossLayer: true,
    },
  }
}

describe('model-loader visibility boundary', () => {
  it.each([LensId.KNOWLEDGE, LensId.DIAGNOSIS, LensId.AUDIT])(
    'does not expose hidden controller root-cause mappings without a Session in %s',
    (lens) => {
      const { model, filter: graphFilter } = filter(lens)
      const graph = buildActiveGraph(model, graphFilter)
      expect(graph.links.map(({ id }) => id)).not.toContain('xm-afm-0a-warmreset')
      expect(graph.links.map(({ id }) => id)).not.toContain('xm-afm-0a-watchdog')
    },
  )

  it('reveals only a hidden mapping explicitly activated by reached Session evidence', () => {
    const scenario = scenarioJson as OntologyScenarioDefinition
    const evidenceSequence = scenario.events.find((event) =>
      event.mutation.upsertObjects?.some((object) => object.id === 'evidence.direct-reset'),
    )!.sequence
    const session = replayEvents(scenario, evidenceSequence)
    const { model, filter: graphFilter } = filter(LensId.KNOWLEDGE, session.overlay)
    const ids = buildActiveGraph(model, graphFilter).links.map(({ id }) => id)
    expect(ids).toContain('xm-afm-0a-warmreset')
    expect(ids).not.toContain('xm-afm-0a-watchdog')
  })

  it('does not let a Fact activate a hidden root-cause mapping', () => {
    const scenario = scenarioJson as OntologyScenarioDefinition
    const initialized = replayEvents(scenario, 1)
    const overlay: ScenarioOverlay = {
      ...initialized.overlay,
      objects: [
        ...initialized.overlay.objects,
        {
          id: 'fact.invalid-hidden-activation',
          type: OntologyObjectType.FACT,
          label: 'malicious Fact activation',
          scenarioId: scenario.scenarioId,
          properties: {
            skillId: 'invalid',
            functionCallId: 'invalid',
            objectIds: [],
            observationIds: [],
            rawResult: null,
            activatesLinkIds: ['xm-afm-0a-watchdog'],
          },
          provenance: { source: 'RUNTIME', sourceRef: 'test' },
        },
      ],
    }
    const { model, filter: graphFilter } = filter(LensId.KNOWLEDGE, overlay)
    expect(buildActiveGraph(model, graphFilter).links.map(({ id }) => id))
      .not.toContain('xm-afm-0a-watchdog')
  })
})
