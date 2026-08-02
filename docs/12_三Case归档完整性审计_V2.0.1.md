# 三 Case 归档完整性审计 V2.0.1

> 日期：2026-08-01  
> 范围：`故障诊断Agent-demoV2` 可浏览目录、统一 ZIP、Case 标识、文档导航、协议样例与校验工具

## 1. 问题结论

此前归档产生了两套不同步的结果：统一 ZIP 已包含三个 Case，但可浏览的 `cases/` 目录只保存了 `controller_warm_reset_001`。因此用户直接浏览目录时无法看到两个新增 Case。

同时发现两个新增 Case 的 ID 漏了版本后缀 `_001`，与 Controller Case 及先前冻结的兼容 Case 命名不一致。

## 2. 本次修复

| 检查项 | 修复结果 |
|---|---|
| 可浏览 `cases/` | 补齐三套完整数据包 |
| Case ID | 统一为 `controller_warm_reset_001`、`noisy_neighbor_io_contention_001`、`remote_replication_lag_001` |
| 目录/manifest/case.json | 四处 ID 完全一致 |
| README/版本矩阵/设计稿 | 同步三套 Case 路径与状态 |
| Case 总索引 | 新增 `cases/README.md` 与 `cases/index.json` |
| 统一 ZIP | 从修复后的目录重新生成，不包含缓存文件 |
| Case 校验 | 三套均通过同一 V1.0 校验器 |
| Runtime 校验 | Controller 参考 Fixture 通过 V2 Runtime 校验器 |

## 3. 非遗漏项

- `schemas/runtime_fixture.json` 是 Runtime V2 的代表性协议样例，使用 Controller Case 不表示只支持一个 Case；
- `prototype/fault-diagnosis-storyboard-v2.html` 是五层 LUI 与八幕交互参考样例，当前用 Controller 剧情演示；
- 三套全量业务数据的权威清单是 `cases/index.json`，而不是 Runtime Fixture 或 HTML 内置示例。

## 4. 保持不变的设计约束

- Case 数据包定义规范保持 V1.0，不因新增场景升版；
- 扰邻不新增专用 Skill，由 Agent＋故障图谱/拓扑推理与现有原子 Skill 完成；
- Skill 只返回事实，推理模块形成 Evidence 并更新 Candidate；
- 诊断支持分不是概率，根因确认必须同时满足最小证据链和竞争候选检查。

## 5. 完成判据

只有同时满足以下条件，归档才算完整：

1. `cases/index.json` 的三个路径全部存在；
2. 每个目录包含 manifest 声明的全部文件；
3. 每个目录名与 Case ID 一致；
4. 三套 Case 均通过 `validate_case_package.py`；
5. README 与版本矩阵不再引用无 `_001` 的旧名称；
6. ZIP 与可浏览目录文件清单、内容哈希一致。
