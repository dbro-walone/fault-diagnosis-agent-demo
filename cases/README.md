# 可执行 Mock Case 索引

本目录是故障诊断 Agent Demo V2 的全量 Case 数据入口。每个 Case 均为自包含的 Case 数据包 V1.0，并由同一 Runtime Adapter、校验器和前端投影协议消费。

| Case ID | 场景 | 关键诊断链 | 状态 |
|---|---|---|---|
| `controller_warm_reset_001` | 控制器热复位 | Watchdog超时→控制器复位→对端接管→LUN时延升高 | 完整、校验通过 |
| `noisy_neighbor_io_contention_001` | 共享存储扰邻 | Host-A负载突增→共享队列/池压力→Host-B时延升高→A降载后恢复 | 完整、校验通过 |
| `remote_replication_lag_001` | 远程复制滞后 | WAN丢包/重传→复制吞吐下降→积压增长→RPO超标→链路恢复后收敛 | 完整、校验通过 |

每套数据包均包含：

- `manifest.json` 与 `case.json`；
- 资源与拓扑；
- 症状、告警、原始日志、日志指纹和 KPI 时序；
- 故障模式与相似案例；
- 候选、任务、证据、支持分轨迹和结论；
- 八幕回放与资产说明。

统一校验：

```bash
python3 tools/validate_case_catalog.py
```

约束：

- Case ID、目录名、`manifest.json.case_id` 与 `case.json.case_id` 必须完全一致；
- 不修改 Case 数据包定义规范 V1.0；
- 扰邻诊断不新增专用 Skill，由 Agent 沿拓扑/图谱共享关系结合既有原子查询完成；
- “诊断支持分”不是概率，根因确认还必须满足最小证据链。
