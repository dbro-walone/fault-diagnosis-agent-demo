# 业务验收走查记录 — docs/14 基线 (2026-08-02 第二轮运行验收)

> 执行人：Hermes（龙哥指定的验收监工）
> 方式：黑盒运行验收（真实启动 `python3 start.py` @ 127.0.0.1:8080）+ 数据包语义校验 + 源码实现核验
> 说明：DeepSeek 主模型不支持图像输入，视觉层级（BA-UX）需龙哥人工看图确认；功能/语义/交互均已在浏览器实测。

## 一、直接结论

| 验收层面 | 方式 | 结果 |
|---|---|---|
| 主流程 + 路由三态 | 浏览器实测 | **通过** |
| 图谱/双平面/跨层映射/状态叠加 | 数据包 + DualPlaneCanvas 源码核验 | **通过（视觉待人工）** |
| 三级事实追溯（LUI-007/008） | UI 实测（Fact→详情tab） | **通过** |
| Controller 热复位黄金路径 | UI 实测（64事件→96分→链6/6→ROOT_CONFIRMED） | **通过** |
| 扰邻反露 Host-A | storyboard + 数据核验（scene-05 才 reveal） | **通过** |
| 远程复制/扰邻/磁盘 | scripts/verify-v2.mjs 4 Case | **ALL PASS** |
| 语义/回放/变异（80用例） | vitest | **80/80 PASS** |
| 回放起点一致性 | UI 实测（回放起点0无根因/分数/证据泄露） | **通过** |
| 第四 Case 路由+完整诊断 | UI 实测（UNIQUE命中disk_raid+94分+链6/6） | **通过** |

## 二、实测确认的关键能力（均为基线 P0/P1）

1. **双平面真实存在**：`DualPlaneCanvas` 用 `node.plane`(topology/knowledge) 分层渲染，Y 轴分为上下两平面；`cross` 类别连线 + `INSTANCE_OF` 实现跨层映射（BA-GRAPH-001/006）。
2. **状态叠加 4 级**：ROOT_CAUSE(红双环) > IMPACTED(橙虚线环) > AGENT_FOCUS(蓝环) > USER_SELECTED(提亮)，形状+光晕组合、非单色（BA-GRAPH-016）。
3. **7 类关系可辨**：topology/knowledge/cross/impact/audit/diagnosis 分类 + 有向箭头（BA-GRAPH-007）。
4. **三级事实**：证据链 Fact 按钮 → 点击切"详情"tab → KPI 详情显示指标名/单位/基线/阈值/峰值/峰值时间/采样点数/覆盖质量/来源血缘（BA-LUI-007/008，BA-CWR-005）。实测 disk_raid 的 KPI 详情字段齐全。
5. **最小证据链门槛**：`evaluateConfirmationGates` 六条门槛（分数≥80、分差≥15、竞争检查、无冲突、链类型、证据完整），裁决 ROOT_CONFIRMED / PROBABLE_CAUSES / INSUFFICIENT（BA-SEM-004/005，一票否决#7/#8）。
6. **回放时点一致性**：回到起点游标0时，无候选、无最终分、无根因、无未来证据（BA-REPLAY-001，一票否决#6）。
7. **路由三态**：强语料（"Controller-0A热复位"/"SSD磁盘扇区"/"RPO超标"）UNIQUE 命中；弱输入 AMBIGUOUS 展示候选让用户选（不得猜测）(BA-GOAL-002/003，一票否决#3)。
8. **第四 Case 扩展**：新增 disk_raid_degrade_001 用通用机制（8幕/三级事实/竞争检查/相似案例），无 case_id 特判、无页面复制、无旧 Case 残留（BA-EXT-001~004）。
9. **恢复闭环/竞争排除**数据齐备：三 Case 的 recovery_chain、A恢复→B恢复、WAN恢复→RPO收敛 等均在数据包中存在。

## 三、潜在不达标 / 需确认项

### A. 路由排序 —— P2（**已修复**）
- **原状**：输入"交易数据库刚才突然变慢了"（Controller 指定语料），候选排序：扰邻(41) > Controller(26)。根因：Controller case.json 缺少"数据库/交易"标签，扰邻 name 含"交易"撞词。
- **修复**（Claude Code，数据层）：`cases/controller_warm_reset_001/case.json` scenario_tags 追加 `"数据库","交易"`。
- **复测**：输入"交易数据库刚才突然变慢了" → Controller **55 排第一**（锚点3→32），扰邻41。浏览器实测确认。✅

### B. 缺口追问细节 —— P2（**已修复**）
- **原状**：BA-GOAL-003 预期"明确指出缺口并追问"，但 AMBIGUOUS 面板只有"请选择最接近的一个"，未指出缺口。
- **修复**（Claude Code，UI 层）：`src/App.tsx` 新增 `routeGapSuffix` helper + `routeGapHint` state，基于 `route.normalized.missing_fields` 动态生成缺口文案；并处理"仅剩泛化 business 对象"视为未识别具体对象。
- **复测**：输入"业务变慢了" → 面板文案"…请选择最接近的一个：（未识别到具体对象，请补充后重试或直接从下方选择场景）"。浏览器实测确认。✅

### 回归验证（修复后）
- `npm run typecheck`：0 错误 ✅
- `npx vitest run`：80/80 ✅
- `node scripts/verify-v2.mjs`：4 Case ALL PASS，三基线路由仍 confident=true ✅
- 扰邻"Host-B交易业务变慢"仍 UNIQUE 命中（未被反超）✅

## 六、图谱聚合/钻取能力补全（龙哥指出，2026-08-02 第二轮）

龙哥指出"图谱/拓扑的上钻/下钻以及聚合能力未实现"。核实属实：代码里原本只有 `expandedDevices/deviceGroups` 过滤半成品，但左侧栏无聚合 UI、聚合节点无计数/摘要/展开提示、默认全收起、单击还会 toggle。

### 驱动 Claude Code 补全（BA-GRAPH-008~012/019/020）
改动 5 文件 + 3 新测试：
- `src/lib/model-loader.ts`：`computeAggregateSummary(model, deviceId, ctx)` 纯函数（total/anomaly/candidate/maxSeverity）、`healthSeverity()`
- `src/components/DualPlaneCanvas.tsx`：`countBadgeSprite`（成员计数徽标）、`detachedTagSprite`（↳父组标签，DETACHED_CRITICAL）、`nodeLabelHtml`（聚合摘要 tooltip）、双击检测（350ms 时间窗）
- `src/components/ModelNavigator.tsx`：新增"设备聚合"分区 + 展开/收起按钮
- `src/App.tsx`：`handleNodeDoubleClick`（双击 toggle）、`handleNodeSelect` 改为单击纯选中（BA-GRAPH-008）、`aggregateSummaries`
- `src/lib/model-loader.aggregate.test.ts`：3 个 buildActiveGraph 测试（收起隐藏/展开锚点/关键拆出）

### 验收结果
- typecheck 0 错误；vitest **89/89**；verify **4 Case ALL PASS** + 三路由 confident=true
- 浏览器 console 无 JS 错误
- Claude Code Playwright 实机验证：聚合 tooltip「聚合 12 成员·异常 N·候选 N·最高X」+ 计数徽标；双击展开/收起 + nav 按钮；非相关区域不重排；关键子项拆出保留
- 已实现：BA-GRAPH-008（单击纯选中）、009（双击/按钮展开收起）、010（锚点局部布局）、011（关键子项拆出）、012（聚合摘要）
- 限制：全图仅 45 节点（1 设备组×12 成员），60/80 节点阈值不可达（BA-GRAPH-019/020 无法充分验证，数据规模所致非缺陷）

### 待龙哥人工视觉复核
- 聚合徽标/label 是否清晰、双击展开动画效果、DETACHED_CRITICAL 父组标签可读性
- 截图：`after-focus.png`（Claude Code 聚焦验证）、cache/screenshots 最新图


## 四、待业务验收团队正式执行的剩余项（非本地可裁决）
- **正式第四 Case**（docs/14 §6.2 权限属验收方，非本地自建）
- **体验评审**（3名评审者，BA-UX 全量）
- **三视图/双平面视觉确认、P0 录像证据采集**

## 五、建议动作优先级
1. **P0/P1 全部通过**，无一票否决触发 → 维持 CONDITIONAL_PASS。
2. 若驱动 Claude Code：仅 B（缺口追问措辞）和 A（路由排序）为可选优化项，均 P2，不阻塞。
3. 需龙哥决策：是否动手优化 A/B，或先进入视觉评审。

> 注：本次未做破坏式变异（直接改 Case 数据易污染工作区），变异项由 vitest 80 用例（含 #17 失败注入→PROBABLE_CAUSES）保障。
