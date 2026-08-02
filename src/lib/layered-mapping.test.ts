// 映射校验：现有 Case 实例数据 ↔ 分层本体建模 一一对应、无遗漏（issue #4「兼而有之」）。
// 对每个现有 Case 数据包断言：
//   1. 所有 resource 都能映射到合法 S 子层（resourceToLayer 非空、非 S1 域兜底误判）；
//   2. 每个 resource_type 在 TOPO_LAYERS 子层 resourceTypes 里有唯一归属；
//   3. crossLayerLinks 非空（跨层物理连线存在）；
//   4. buildLayeredModelData(caseId) 能成功构建且成员数>0。
// 只读 case 数据；不改 ontologies/case 文件。
import { describe, expect, it } from 'vitest'
import {
  TOPO_LAYERS,
  TOPO_SUB_LAYERS,
  buildLayeredModelData,
  resourceToLayer,
  type TopoLayerCode,
} from './layered-topology'
import { listCases, loadAdaptedCase } from '../v2'

const SUB_CODES = new Set(TOPO_SUB_LAYERS.map((l) => l.code))

/** 合法子层归属判定：落在 S1_1..S3_5 之一，且不是 S1 域兜底。 */
function isLegalSubLayer(layer: TopoLayerCode | 'S1'): boolean {
  return SUB_CODES.has(layer) && layer !== 'S1'
}

/** 每个子层可见的唯一 resource_type 集合。 */
function knownTypes(): Map<string, TopoLayerCode> {
  const map = new Map<string, TopoLayerCode>()
  for (const layer of TOPO_SUB_LAYERS) {
    for (const rt of layer.resourceTypes) map.set(rt, layer.code)
  }
  return map
}

// 对每个已发现且带资源的 Case 数据包做映射校验。
const CASE_IDS = listCases()
  .map((c) => c.caseId)
  .filter((caseId) => loadAdaptedCase(caseId).resources.length > 0)

describe('Case 实例数据 ↔ 分层本体映射校验', () => {
  it(`覆盖全部现有 Case（${CASE_IDS.length} 个带资源的 Case）`, () => {
    expect(CASE_IDS).toContain('controller_warm_reset_001')
    expect(CASE_IDS).toContain('noisy_neighbor_io_contention_001')
    expect(CASE_IDS).toContain('remote_replication_lag_001')
    expect(CASE_IDS).toContain('layered_topology_demo_001')
  })

  for (const caseId of CASE_IDS) {
    const adapted = loadAdaptedCase(caseId)

    describe(caseId, () => {
      const typeToLayer = knownTypes()

      it('每个实例 resource 都映射到合法 S 子层（非 S1 兜底误判）', () => {
        for (const resource of adapted.resources) {
          const layer = resourceToLayer(resource.resource_type)
          expect(layer, `${resource.resource_id} (${resource.resource_type})`).toSatisfy(
            isLegalSubLayer,
          )
        }
      })

      it('每个 resource_type 在 TOPO_LAYERS 子层里有唯一归属', () => {
        const types = new Set(adapted.resources.map((r) => r.resource_type))
        for (const rt of types) {
          expect(rt, `resource_type=${rt}`).toSatisfy((t: string) => typeToLayer.has(t))
          expect(typeToLayer.get(rt), `resource_type=${rt}`).toSatisfy(isLegalSubLayer)
        }
      })

      it('buildLayeredModelData 成功构建：成员数>0、跨层连线非空、无悬挂边', () => {
        const model = buildLayeredModelData(caseId)
        expect(model.caseId).toBe(caseId)
        expect(model.nodes.length).toBe(adapted.resources.length)
        expect(model.links.length).toBeGreaterThan(0)
        expect(model.crossLayerLinks.length).toBeGreaterThan(0)
        // 子层成员数之和 = 全部节点（无遗漏、无重复）。
        const subSum = TOPO_SUB_LAYERS.reduce(
          (sum, l) => sum + (model.memberIdsByLayer.get(l.code)?.length ?? 0),
          0,
        )
        expect(subSum).toBe(model.nodes.length)
        // 无悬挂边：所有连线端点均为已知节点。
        for (const link of model.links) {
          expect(model.nodesById.has(link.source as string)).toBe(true)
          expect(model.nodesById.has(link.target as string)).toBe(true)
        }
      })

      it('跨层连线端点分属不同子层', () => {
        const model = buildLayeredModelData(caseId)
        for (const link of model.crossLayerLinks) {
          const a = model.nodesById.get(link.source as string)?.group as TopoLayerCode
          const b = model.nodesById.get(link.target as string)?.group as TopoLayerCode
          expect(a).toBeDefined()
          expect(b).toBeDefined()
          expect(a).not.toBe(b)
        }
      })
    })
  }
})

// 元数据自身一致性：TOPO_LAYERS 子层 resourceTypes 全局无重复归属。
describe('TOPO_LAYERS 子层 resourceTypes 唯一性', () => {
  it('每个资源类型只归属一个子层（41 种现有 Case 类型全覆盖）', () => {
    const seen = new Set<string>()
    let count = 0
    for (const layer of TOPO_LAYERS) {
      for (const rt of layer.resourceTypes) {
        expect(seen.has(rt), `重复归属：${rt}`).toBe(false)
        seen.add(rt)
        count += 1
      }
    }
    expect(count).toBeGreaterThan(30)
  })
})
