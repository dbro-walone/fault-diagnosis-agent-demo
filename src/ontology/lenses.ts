import {
  LensId,
  OntologyLinkType,
  OntologyObjectType,
} from '../../schemas/enums'
import type { OntologyLink, OntologyObject, OntologySnapshot } from '../../schemas/types'

export interface LensDefinition {
  id: LensId
  label: string
  description: string
  primaryObjectTypes: OntologyObjectType[]
  linkTypes: OntologyLinkType[]
  includeLinkedContext: boolean
}

const TOPOLOGY_LINKS = [
  OntologyLinkType.ACCESSES,
  OntologyLinkType.CONNECTS_TO,
  OntologyLinkType.DEPENDS_ON,
  OntologyLinkType.HOSTS,
  OntologyLinkType.PROVIDES_SERVICE,
  OntologyLinkType.BACKED_BY,
  OntologyLinkType.BELONGS_TO,
  OntologyLinkType.PRIMARY_BACKUP_OF,
  OntologyLinkType.INSTANCE_OF,
]

/** 资源类对象类型（docs/03 §3）；拓扑/诊断视图均投影这些（D2 细粒度化后适配）。 */
const RESOURCE_TYPES: OntologyObjectType[] = [
  OntologyObjectType.ASSET,
  OntologyObjectType.BUSINESS_SERVICE,
  OntologyObjectType.HOST,
  OntologyObjectType.FABRIC,
  OntologyObjectType.PORT,
  OntologyObjectType.STORAGE_SYSTEM,
  OntologyObjectType.CONTROLLER,
  OntologyObjectType.SERVICE,
  OntologyObjectType.LUN,
  OntologyObjectType.POOL,
  OntologyObjectType.ENCLOSURE,
  OntologyObjectType.DISK,
  OntologyObjectType.REPLICATION_SESSION,
  OntologyObjectType.REMOTE_DEVICE,
]

export const LENS_DEFINITIONS: Record<LensId, LensDefinition> = {
  [LensId.TOPOLOGY]: {
    id: LensId.TOPOLOGY,
    label: 'Topology',
    description: '资产、访问路径、冗余关系与对象类型映射',
    primaryObjectTypes: RESOURCE_TYPES,
    linkTypes: TOPOLOGY_LINKS,
    includeLinkedContext: true,
  },
  [LensId.KNOWLEDGE]: {
    id: LensId.KNOWLEDGE,
    label: 'Knowledge',
    description: '对象类型、现象、故障模式、机制、证据规则与案例',
    primaryObjectTypes: [OntologyObjectType.KNOWLEDGE],
    linkTypes: [
      OntologyLinkType.INSTANCE_OF,
      OntologyLinkType.APPLICABLE_TO,
      OntologyLinkType.EXHIBITS,
      OntologyLinkType.SUSCEPTIBLE_TO,
      OntologyLinkType.CAUSED_BY,
      OntologyLinkType.TRIGGERED_BY,
      OntologyLinkType.LEADS_TO,
      OntologyLinkType.CASE_MATCH,
      OntologyLinkType.EVIDENCED_BY,
      OntologyLinkType.DEPENDS_ON,
    ],
    includeLinkedContext: true,
  },
  [LensId.DIAGNOSIS]: {
    id: LensId.DIAGNOSIS,
    label: 'Diagnosis',
    description: '事实、证据、候选、计划与当前收敛状态',
    primaryObjectTypes: [
      ...RESOURCE_TYPES,
      OntologyObjectType.SCENARIO,
      OntologyObjectType.OBSERVATION,
      OntologyObjectType.FACT,
      OntologyObjectType.EVIDENCE,
      OntologyObjectType.CANDIDATE,
      OntologyObjectType.PLAN,
      OntologyObjectType.TASK,
      OntologyObjectType.FUNCTION_CALL,
      OntologyObjectType.DECISION,
    ],
    linkTypes: [
      OntologyLinkType.TARGETS,
      OntologyLinkType.PRODUCED_BY,
      OntologyLinkType.DERIVED_FROM,
      OntologyLinkType.SUPPORTS,
      OntologyLinkType.WEAKENS,
      OntologyLinkType.CONFLICTS_WITH,
      OntologyLinkType.CONTAINS,
      OntologyLinkType.SUPERSEDES,
      OntologyLinkType.BASED_ON,
      OntologyLinkType.INSTANCE_OF,
    ],
    includeLinkedContext: true,
  },
  [LensId.IMPACT]: {
    id: LensId.IMPACT,
    label: 'Impact',
    description: '已证明的影响、传播、冗余接管与恢复路径',
    primaryObjectTypes: [OntologyObjectType.DECISION],
    linkTypes: [
      OntologyLinkType.IMPACTS,
      OntologyLinkType.RECOVERS_VIA,
      OntologyLinkType.TARGETS,
    ],
    includeLinkedContext: true,
  },
  [LensId.AUDIT]: {
    id: LensId.AUDIT,
    label: 'Audit',
    description: 'Function Call、原始事实、计划差异、Action Proposal 与 Decision 血缘',
    primaryObjectTypes: [
      OntologyObjectType.SCENARIO,
      OntologyObjectType.PLAN,
      OntologyObjectType.TASK,
      OntologyObjectType.FUNCTION_CALL,
      OntologyObjectType.ACTION_PROPOSAL,
      OntologyObjectType.OBSERVATION,
      OntologyObjectType.FACT,
      OntologyObjectType.EVIDENCE,
      OntologyObjectType.CANDIDATE,
      OntologyObjectType.DECISION,
    ],
    linkTypes: [
      OntologyLinkType.CONTAINS,
      OntologyLinkType.PRODUCED_BY,
      OntologyLinkType.DERIVED_FROM,
      OntologyLinkType.TARGETS,
      OntologyLinkType.SUPPORTS,
      OntologyLinkType.WEAKENS,
      OntologyLinkType.CONFLICTS_WITH,
      OntologyLinkType.SUPERSEDES,
      OntologyLinkType.BASED_ON,
      OntologyLinkType.PROPOSES,
    ],
    includeLinkedContext: true,
  },
}

function isTopologyContext(object: OntologyObject): boolean {
  return (
    object.type === OntologyObjectType.KNOWLEDGE &&
    object.properties.knowledgeKind === 'OBJECT_TYPE'
  )
}

/** Deterministically project one Lens from the shared ontology snapshot. */
export function projectLens(snapshot: OntologySnapshot, lensId: LensId): OntologySnapshot {
  const lens = LENS_DEFINITIONS[lensId]
  const hiddenLinkActivatorTypes = new Set([
    OntologyObjectType.CANDIDATE,
    OntologyObjectType.EVIDENCE,
    OntologyObjectType.DECISION,
  ])
  const activatedHiddenLinks = new Set(
    snapshot.objects
      .filter((object) => hiddenLinkActivatorTypes.has(object.type))
      .flatMap((object) => {
      const value = object.properties.activatesLinkIds
      return Array.isArray(value) ? value.map(String) : []
      }),
  )
  const isVisibleLink = (link: OntologyLink): boolean =>
    link.properties.visibility !== 'hidden' || activatedHiddenLinks.has(link.id)
  if (lensId === LensId.IMPACT) {
    const allowedLinkTypes = new Set(lens.linkTypes)
    const links = snapshot.links.filter(
      (link) => allowedLinkTypes.has(link.type) && isVisibleLink(link),
    )
    const visibleIds = new Set(
      snapshot.objects
        .filter((object) => object.type === OntologyObjectType.DECISION)
        .map((object) => object.id),
    )
    for (const link of links) {
      visibleIds.add(link.sourceId)
      visibleIds.add(link.targetId)
    }
    return {
      objects: snapshot.objects.filter((object) => visibleIds.has(object.id)),
      links,
    }
  }

  const primaryIds = new Set(
    snapshot.objects
      .filter(
        (object) =>
          lens.primaryObjectTypes.includes(object.type) ||
          (lensId === LensId.TOPOLOGY && isTopologyContext(object)),
      )
      .map((object) => object.id),
  )

  const allowedLinkTypes = new Set(lens.linkTypes)
  const objectById = new Map(snapshot.objects.map((object) => [object.id, object]))
  const candidateLinks = snapshot.links.filter((link) => {
    if (!isVisibleLink(link)) return false
    if (!allowedLinkTypes.has(link.type)) return false
    if (lensId !== LensId.TOPOLOGY) return true
    const source = objectById.get(link.sourceId)
    const target = objectById.get(link.targetId)
    if (!source || !target) return false
    if (
      RESOURCE_TYPES.includes(source.type) &&
      RESOURCE_TYPES.includes(target.type)
    ) {
      return true
    }
    return (
      link.type === OntologyLinkType.INSTANCE_OF &&
      ((RESOURCE_TYPES.includes(source.type) && isTopologyContext(target)) ||
        (RESOURCE_TYPES.includes(target.type) && isTopologyContext(source)))
    )
  })

  if (lens.includeLinkedContext) {
    // Context is exactly one hop from the original primary set. Mutating and
    // reusing the same set as the traversal anchor would make projection depend
    // on link order and could leak an entire knowledge chain into TOPOLOGY.
    const anchors = new Set(primaryIds)
    for (const link of candidateLinks) {
      if (anchors.has(link.sourceId) || anchors.has(link.targetId)) {
        primaryIds.add(link.sourceId)
        primaryIds.add(link.targetId)
      }
    }
  }

  const objects = snapshot.objects.filter((object) => primaryIds.has(object.id))
  const visibleIds = new Set(objects.map((object) => object.id))
  const links = candidateLinks.filter(
    (link) => visibleIds.has(link.sourceId) && visibleIds.has(link.targetId),
  )

  return { objects, links }
}
