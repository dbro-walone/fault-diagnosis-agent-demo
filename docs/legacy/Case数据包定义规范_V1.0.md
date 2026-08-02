# 故障诊断原型 Case 数据包定义规范 V1.0

## 1. 目标与适用范围

本规范用于定义故障诊断原型的标准 Case 数据包，使每个案例都能独立驱动：

- 实例拓扑初始化与展开；
- 故障现象触发及时间轴播放；
- 告警、日志、KPI、拓扑、历史案例等证据展示；
- 根因候选生成、取证、验证、排除及置信度演化；
- 根因、影响范围、恢复状态和诊断报告展示；
- 当前版本能力与未来修复能力边界展示。

原型阶段数据可以 Mock，但对象、时间、因果关系和证据必须相互一致。后续接入真实 DME、ES 或故障注入数据时，应保持本规范的逻辑模型不变，仅替换数据来源和适配器。

---

## 2. 设计原则

### 2.1 Case 自包含

一个 Case 包含完成一次演示所需的全部数据，不依赖其他 Case，也不依赖在线服务。

### 2.2 原始事实与诊断推演分离

- `observations/`：模拟设备实际产生的资源、拓扑、告警、日志、KPI等客观数据；
- `diagnosis/`：模拟 Agent 的候选、取证任务、证据判断、置信度变化及结论；
- `playback/`：只描述页面如何按阶段播放。

不得在原始 KPI、日志或拓扑对象中直接写入 `rootCause: true`。

### 2.3 全局 ID 一致

同一对象在资源、拓扑、告警、KPI、日志和诊断证据中必须使用相同的 `resource_id`。禁止仅依赖显示名称关联数据。

### 2.4 统一时间基准

- 绝对时间统一使用 ISO 8601，并带时区；
- KPI点、日志和告警保留毫秒精度；
- Case定义一个 `time_origin`；
- 播放脚本使用相对时间 `offset_ms`，避免修改演示日期后逐项改动。

示例：`2026-07-30T14:32:17.842+08:00`。

### 2.5 证据可追溯

每次置信度变化必须引用具体 `evidence_id`；每条证据必须能反查到告警、日志、KPI点、拓扑边或历史案例。

### 2.6 Mock 数据显式标识

Case 元数据必须包含：

```json
{
  "data_mode": "mock",
  "data_disclaimer": "本案例数据用于原型演示，不代表真实环境实测结果"
}
```

---

## 3. 标准目录结构

```text
cases/
└── controller_warm_reset_001/
    ├── manifest.json
    ├── case.json
    ├── resources.json
    ├── topology.json
    ├── observations/
    │   ├── symptoms.json
    │   ├── alarms.json
    │   ├── logs.json
    │   ├── log_fingerprints.json
    │   └── kpis.json
    ├── knowledge/
    │   ├── fault_patterns.json
    │   └── similar_cases.json
    ├── diagnosis/
    │   ├── candidates.json
    │   ├── tasks.json
    │   ├── evidence.json
    │   ├── confidence_trace.json
    │   └── conclusion.json
    ├── playback/
    │   └── storyboard.json
    └── assets/
        └── README.md
```

小型 Case 可以将多个文件合并为一个 `case-package.json`；但逻辑分区和字段含义必须保持一致。正式扩展建议使用上述多文件结构，便于维护和局部替换。

---

## 4. 文件职责

| 文件 | 必选 | 主要职责 |
|---|---|---|
| `manifest.json` | 是 | 协议版本、文件清单、校验信息、兼容性 |
| `case.json` | 是 | Case身份、故障类型、场景摘要、时间窗口、演示能力 |
| `resources.json` | 是 | 资源实例及其类型、名称、状态、展示属性 |
| `topology.json` | 是 | 资源关系、方向、主备、多路径和设备内外归属 |
| `symptoms.json` | 是 | 用户可见现象和标准化故障现象 |
| `alarms.json` | 否 | 告警事件；无告警场景可为空数组 |
| `logs.json` | 否 | 原始日志及结构化字段 |
| `log_fingerprints.json` | 否 | 指纹定义及日志命中关系 |
| `kpis.json` | 否 | KPI元数据、基线、阈值和时序点 |
| `fault_patterns.json` | 否 | 故障知识、现象到候选的生成规则 |
| `similar_cases.json` | 否 | 历史案例检索结果 |
| `candidates.json` | 是 | 候选根因及初始依据 |
| `tasks.json` | 是 | Agent计划和Skill执行记录 |
| `evidence.json` | 是 | 支持、反证、中性或缺失证据 |
| `confidence_trace.json` | 是 | 候选置信度及其变化依据 |
| `conclusion.json` | 是 | 最终根因、影响链、恢复链、建议和能力边界 |
| `storyboard.json` | 是 | 8幕播放顺序、触发条件和视觉动作 |

“否”表示允许没有该类数据，并不表示可以静默缺失。没有数据时应保留文件并写入空数组，同时在诊断任务中明确 `no_data`。

---

## 5. Manifest 与版本控制

```json
{
  "schema_name": "dme-fault-case-package",
  "schema_version": "1.0.0",
  "case_id": "controller_warm_reset_001",
  "case_version": "1.0.0",
  "created_at": "2026-07-30T21:00:00+08:00",
  "data_mode": "mock",
  "locale": "zh-CN",
  "timezone": "Asia/Shanghai",
  "entry_file": "case.json",
  "files": [
    "case.json",
    "resources.json",
    "topology.json",
    "observations/symptoms.json",
    "diagnosis/conclusion.json",
    "playback/storyboard.json"
  ],
  "compatible_player": ">=1.0.0 <2.0.0"
}
```

版本规则：

- `schema_version`：数据协议版本，字段发生不兼容变化时升级主版本；
- `case_version`：案例内容版本，数据修订或分镜调整时升级；
- 新增可选字段：升级次版本；
- 仅修正样例数据：升级修订版本。

前端必须先校验 `schema_version`，不支持时给出明确提示，不能静默忽略核心字段。

---

## 6. Case 元数据

```json
{
  "case_id": "controller_warm_reset_001",
  "name": "Controller-0A 热复位导致块业务时延突增",
  "fault_domain": "controller",
  "fault_mode_code": "CONTROLLER_WARM_RESET",
  "severity": "critical",
  "scenario_tags": ["双SAN", "双控制器", "主备切换", "块业务"],
  "data_mode": "mock",
  "data_disclaimer": "本案例数据用于原型演示，不代表真实环境实测结果",
  "time_origin": "2026-07-30T14:32:00.000+08:00",
  "observation_window": {
    "start": "2026-07-30T14:31:50.000+08:00",
    "end": "2026-07-30T14:32:35.000+08:00"
  },
  "trigger": {
    "type": "kpi_anomaly",
    "object_id": "lun-db01",
    "symptom_id": "sym-lun-latency-high"
  },
  "expected_duration_ms": 90000,
  "supported_capabilities": [
    "topology_playback",
    "candidate_reasoning",
    "evidence_drilldown",
    "diagnosis_report"
  ],
  "future_capabilities": [
    "repair_plan",
    "approval",
    "repair_execution",
    "effect_verification",
    "rollback"
  ]
}
```

`fault_mode_code` 使用稳定枚举；中文名称只用于展示，不能承担程序判断。

---

## 7. 资源模型

资源最少包含：

```json
{
  "resource_id": "controller-0a",
  "resource_type": "CONTROLLER",
  "name": "Controller-0A",
  "parent_id": "storage-01",
  "device_id": "storage-01",
  "zone": "CONTROL_SERVICE",
  "location": "internal",
  "attributes": {
    "role": "active",
    "slot": "0A"
  },
  "display": {
    "label": "Controller-0A",
    "default_expanded": true,
    "aggregate_group": null
  }
}
```

建议统一资源类型：

`BUSINESS`、`HOST`、`SAN_FABRIC`、`IP_NETWORK`、`STORAGE_DEVICE`、`FC_PORT`、`ETH_PORT`、`CONTROLLER`、`BLOCK_SERVICE`、`NAS_SERVICE`、`LUN`、`FILE_SYSTEM`、`STORAGE_POOL`、`DISK_ENCLOSURE`、`DISK`、`BBU`、`POWER`、`FAN`。

展示层可扩展新类型，但不得用名称字符串推断类型。

---

## 8. 拓扑关系模型

```json
{
  "edge_id": "edge-controller0a-block",
  "source_id": "controller-0a",
  "target_id": "block-service-01",
  "relation_type": "PROVIDES_SERVICE",
  "direction": "directed",
  "path_group": "block-path-a",
  "redundancy_group": "controller-ha-01",
  "state": "normal",
  "valid_from": null,
  "valid_to": null
}
```

建议关系枚举：

- `PHYSICAL_CONNECTS`：物理连接；
- `ACCESSES`：业务访问；
- `HOSTS`：承载；
- `PROVIDES_SERVICE`：提供服务；
- `DEPENDS_ON`：依赖；
- `BELONGS_TO`：资源归属；
- `BACKED_BY`：逻辑资源由物理资源支撑；
- `PRIMARY_BACKUP_OF`：主备关系；
- `FAILOVER_TO`：故障切换；
- `AFFECTS`：诊断确认后的影响关系。

原始拓扑文件主要保存稳定关系。`AFFECTS`、`FAILOVER_TO`等事件型关系应带有效时间，或在播放阶段动态生成。

---

## 9. 观测数据规范

### 9.1 故障现象

```json
{
  "symptom_id": "sym-lun-latency-high",
  "source": "kpi",
  "raw_description": "数据库业务访问变慢",
  "normalized_type": "LUN_LATENCY_HIGH",
  "object_id": "lun-db01",
  "detected_at": "2026-07-30T14:32:18.120+08:00",
  "value": 38.6,
  "unit": "ms",
  "baseline": 1.8
}
```

### 9.2 告警

```json
{
  "alarm_id": "alm-0a-78421",
  "alarm_code": "CONTROLLER_WARM_RESET",
  "name": "控制器发生热复位",
  "object_id": "controller-0a",
  "severity": "critical",
  "occurred_at": "2026-07-30T14:32:17.842+08:00",
  "cleared_at": "2026-07-30T14:32:23.106+08:00",
  "status": "cleared",
  "raw_fields": {
    "reason": "watchdog_timeout"
  }
}
```

### 9.3 日志与指纹

原始日志：

```json
{
  "log_id": "log-00017",
  "timestamp": "2026-07-30T14:32:17.615+08:00",
  "object_id": "controller-0a",
  "level": "WARN",
  "component": "controller",
  "message": "controller 0A warm reset triggered, reason=watchdog_timeout, service=block",
  "fingerprint_id": "fp-ctrl-warm-reset-017"
}
```

指纹：

```json
{
  "fingerprint_id": "fp-ctrl-warm-reset-017",
  "name": "控制器Watchdog超时热复位",
  "template": "controller <*> warm_reset reason=<WATCHDOG_TIMEOUT> service=<BLOCK>",
  "fault_mode_codes": ["CONTROLLER_WARM_RESET"],
  "window": {
    "start": "2026-07-30T14:32:16.000+08:00",
    "end": "2026-07-30T14:32:20.000+08:00"
  },
  "hit_count": 7,
  "matched_log_ids": ["log-00017"]
}
```

### 9.4 KPI

每条 KPI 序列应包含指标元数据、基线、阈值、采样周期和数据点：

```json
{
  "series_id": "kpi-lun-db01-latency",
  "object_id": "lun-db01",
  "indicator_id": "lun_avg_latency",
  "name": "LUN平均时延",
  "unit": "ms",
  "sample_interval_ms": 1000,
  "baseline": {
    "value": 1.8,
    "method": "mock_pre_fault_mean"
  },
  "thresholds": {
    "warning": 10,
    "critical": 30
  },
  "points": [
    {"timestamp": "2026-07-30T14:32:17.000+08:00", "value": 1.8, "quality": "good"},
    {"timestamp": "2026-07-30T14:32:18.000+08:00", "value": 38.6, "quality": "good"},
    {"timestamp": "2026-07-30T14:32:23.000+08:00", "value": 3.1, "quality": "good"}
  ],
  "annotations": [
    {
      "timestamp": "2026-07-30T14:32:18.000+08:00",
      "type": "anomaly_peak",
      "label": "时延突增"
    }
  ]
}
```

`quality` 建议使用 `good`、`estimated`、`missing`、`invalid`。缺失点不能伪造为 0。

---

## 10. 诊断推演模型

### 10.1 候选根因

```json
{
  "candidate_id": "cand-controller-warm-reset",
  "fault_mode_code": "CONTROLLER_WARM_RESET",
  "object_id": "controller-0a",
  "display_name": "Controller-0A 热复位",
  "initial_confidence": 0.42,
  "generation_basis": [
    "sym-lun-latency-high",
    "pattern-block-path-interruption"
  ],
  "status": "investigating"
}
```

置信度统一使用 `0—1` 小数存储，界面转换为百分比。

### 10.2 Agent 与 Skill 任务

```json
{
  "task_id": "task-query-controller-alarm",
  "stage": "evidence_collection",
  "skill_code": "QUERY_ALARM",
  "display_name": "查询控制器告警",
  "input": {
    "object_ids": ["controller-0a"],
    "start": "2026-07-30T14:32:10.000+08:00",
    "end": "2026-07-30T14:32:25.000+08:00"
  },
  "started_at": "2026-07-30T14:32:25.100+08:00",
  "ended_at": "2026-07-30T14:32:25.480+08:00",
  "status": "succeeded",
  "result_refs": ["alm-0a-78421"],
  "error": null
}
```

任务状态统一为：

`pending`、`running`、`succeeded`、`failed`、`timeout`、`no_data`、`skipped`。

### 10.3 证据

```json
{
  "evidence_id": "ev-controller-reset-alarm",
  "evidence_type": "alarm",
  "source_ref": "alm-0a-78421",
  "task_id": "task-query-controller-alarm",
  "candidate_id": "cand-controller-warm-reset",
  "stance": "support",
  "strength": 0.82,
  "summary": "命中Controller-0A热复位严重告警",
  "time_alignment_ms": 225,
  "quality": "high"
}
```

`stance` 使用：

- `support`：支持候选；
- `contradict`：反驳或排除候选；
- `neutral`：相关但无法判断；
- `missing`：预期数据缺失。

`strength` 表示证据强度，不等同于候选置信度。

### 10.4 置信度轨迹

```json
{
  "candidate_id": "cand-controller-warm-reset",
  "trace": [
    {
      "sequence": 1,
      "stage": "candidate_generation",
      "confidence": 0.42,
      "evidence_refs": [],
      "reason": "依据故障现象和块访问路径生成候选"
    },
    {
      "sequence": 2,
      "stage": "evidence_collection",
      "confidence": 0.68,
      "evidence_refs": ["ev-controller-reset-alarm"],
      "reason": "命中热复位告警，且与业务异常时间相差225ms"
    },
    {
      "sequence": 3,
      "stage": "evidence_fusion",
      "confidence": 0.96,
      "evidence_refs": [
        "ev-controller-reset-alarm",
        "ev-warm-reset-fingerprint",
        "ev-controller-throughput-zero",
        "ev-controller0b-takeover"
      ],
      "reason": "告警、日志、KPI和主备切换证据相互印证"
    }
  ]
}
```

原型可以预设置信度结果，但必须同时提供变化原因及证据引用。后续接真实推理引擎时，由引擎生成同格式轨迹。

### 10.5 最终结论

```json
{
  "diagnosis_id": "diag-controller-warm-reset-001",
  "status": "confirmed",
  "root_cause": {
    "candidate_id": "cand-controller-warm-reset",
    "object_id": "controller-0a",
    "fault_mode_code": "CONTROLLER_WARM_RESET",
    "confidence": 0.96
  },
  "root_cause_chain": [
    "controller-0a",
    "block-service-01"
  ],
  "impact_chain": [
    "block-service-01",
    "lun-db01",
    "db-business-01"
  ],
  "recovery_chain": [
    "controller-0b",
    "block-service-01",
    "lun-db01"
  ],
  "excluded_candidates": [
    "cand-fc-link-flap",
    "cand-san-link-fault",
    "cand-pool-bottleneck"
  ],
  "diagnosis_summary": "Controller-0A因watchdog超时发生热复位，Block Service切换至Controller-0B，导致LUN-DB01时延短时升高。",
  "current_capability_boundary": "diagnosis_completed",
  "repair": {
    "status": "future_capability",
    "display_mode": "dimmed"
  }
}
```

---

## 11. 8 幕播放脚本

`storyboard.json` 不重复存储业务数据，只引用已有对象和事件：

| 幕次 | `stage_code` | 核心输入 |
|---:|---|---|
| 1 | `NORMAL_BASELINE` | 正常拓扑、基线KPI |
| 2 | `SYMPTOM_TRIGGERED` | symptom、异常KPI点 |
| 3 | `SCOPE_LOCALIZED` | 当前业务路径、相关资源 |
| 4 | `CANDIDATES_GENERATED` | candidates初始置信度 |
| 5 | `EVIDENCE_COLLECTING` | tasks、告警、日志指纹、KPI、拓扑、案例 |
| 6 | `CANDIDATES_EVALUATED` | evidence、confidence_trace、排除理由 |
| 7 | `DIAGNOSIS_COMPLETED` | conclusion、根因链、影响链、恢复链 |
| 8 | `FUTURE_REPAIR_PREVIEW` | future_capabilities，整体降暗 |

单幕示例：

```json
{
  "scene_id": "scene-05",
  "sequence": 5,
  "stage_code": "EVIDENCE_COLLECTING",
  "title": "Agent并行取证",
  "start_offset_ms": 36000,
  "duration_ms": 18000,
  "enter_when": {
    "type": "scene_previous_completed"
  },
  "focus_resource_ids": ["controller-0a", "controller-0b", "lun-db01"],
  "task_ids": [
    "task-query-controller-alarm",
    "task-query-log-fingerprint",
    "task-query-kpi"
  ],
  "evidence_panel_tabs": ["alarm", "log", "kpi", "topology", "case"],
  "visual_actions": [
    {"type": "highlight_path", "target": "block-path-a"},
    {"type": "animate_evidence_flow", "target": "cand-controller-warm-reset"}
  ]
}
```

播放参数与真实查询耗时分开：

- `duration_ms`：演示动画时长；
- task中的 `started_at`、`ended_at`：模拟或真实执行耗时。

---

## 12. 时间与因果一致性约束

每个 Case 必须满足：

1. 故障原因事件不晚于直接影响事件；
2. 告警、日志、KPI异常允许有合理采集延迟，但需能解释；
3. 根因对象必须存在于 `resources.json`；
4. 诊断路径中的每一跳必须能由拓扑关系或事件型关系解释；
5. 每个证据的 `source_ref` 必须真实存在；
6. 每次置信度变化必须至少引用一条新增证据，初始值除外；
7. 排除候选必须有反证、正常观测或数据不足说明；
8. 恢复时间不得早于故障开始时间；
9. 修复未实现时，不得出现 `repair_succeeded` 等状态；
10. KPI缺失值不能以0替代。

Controller热复位基线时间链建议固定为：

```text
14:32:17.615  热复位日志及指纹命中
14:32:17.842  控制器热复位告警
14:32:18.000  Controller-0A吞吐降为0
14:32:18.120  LUN-DB01时延升至38.6ms
14:32:18.350  Controller-0B开始接管
14:32:22.900  Block Service切换完成
14:32:23.106  告警恢复，业务逐步回落
```

---

## 13. Case 扩展分类与命名

目录命名：

```text
<fault_mode_code小写>_<三位序号>
```

示例：

- `controller_warm_reset_001`
- `disk_bad_sector_001`
- `fc_link_flap_001`
- `bbu_fault_001`

建议按以下维度维护标签，而不是为每种组合复制协议：

| 维度 | 示例 |
|---|---|
| 故障域 | controller、disk、port、network、pool、power |
| 故障模式 | warm_reset、bad_sector、link_flap、over_temperature |
| 业务协议 | block、nas、nfs、cifs |
| 拓扑形态 | single_path、multipath、dual_san、dual_controller |
| 数据完备度 | full_data、missing_alarm、missing_log、missing_kpi |
| 诊断难度 | direct、multi_evidence、ambiguous、unknown |
| 最终状态 | confirmed、probable、inconclusive |

同一故障模式可建立多个 Case，覆盖不同数据完备度和拓扑形态。

---

## 14. 扩展一个新 Case 的步骤

1. 复制标准 Case 目录；
2. 修改 `case_id`、`fault_mode_code`、场景标签和时间窗口；
3. 定义资源实例，确保所有 `resource_id` 唯一；
4. 建立稳定拓扑及主备、多路径关系；
5. 先编写统一故障时间线；
6. 根据时间线生成告警、日志、指纹和KPI；
7. 定义不少于一个正确候选和两个合理干扰候选；
8. 为每个候选准备支持证据或反证；
9. 编排置信度轨迹和最终结论；
10. 绑定8幕播放脚本；
11. 运行完整性、一致性和展示验收。

不建议先写动画再补数据。应先形成事实时间线，再生成诊断和分镜。

---

## 15. 校验与验收要求

### 15.1 结构校验

- 所有必选文件存在；
- JSON可解析；
- schema和Case版本合法；
- ID引用无悬空；
- 枚举值在允许范围内。

### 15.2 数据一致性校验

- 时间排序合理；
- 资源、告警、日志、KPI对象一致；
- 拓扑可形成完整访问路径；
- 证据可追溯；
- 置信度轨迹在0—1之间；
- 最终根因必须来自候选集合。

### 15.3 演示验收

- Case载入后能生成正常基线；
- 第2幕不提前暴露根因；
- 第5幕能查看具体告警字段、日志原文及指纹、KPI真实值；
- 第4—7幕置信度数字连续可追溯；
- 第6幕能看到候选被支持或排除的原因；
- 第7幕能闭合根因链、影响链、恢复链；
- 第8幕修复能力处于降暗的未来能力状态；
- 任意一类数据为空时，页面显示“无数据/数据不足”，不能报错或伪造结果。

---

## 16. 推荐的首批 Case 集

原型第一阶段建议先建设以下四类：

| Case | 验证重点 |
|---|---|
| Controller热复位 | 双控切换、时间对齐、多源证据融合 |
| 磁盘坏道 | 物理资源逐级展开、日志与介质错误、存储池影响 |
| FC端口链路抖动 | 多路径、端口计数、网络侧与存储侧排查 |
| BBU故障 | 基础设施聚合展开、告警主导、业务影响较弱 |

随后补充“数据不完整”变体，例如无告警、无日志或KPI采样缺失，用于展示 Agent 面对不完备证据时的降级诊断，而不是永远输出96%的确定结论。

---

## 17. V1.0 核心约定总结

```text
Case数据包
├── 客观事实：资源、拓扑、现象、告警、日志、KPI
├── 诊断知识：故障模式、相似案例
├── Agent过程：候选、任务、证据、置信度
├── 诊断结果：根因、影响、恢复、能力边界
└── 展示编排：8幕分镜与视觉动作
```

后续所有案例均应遵循：

> 数据事实负责“发生了什么”，诊断模型负责“为什么这样判断”，播放脚本负责“如何展示”；三者通过稳定ID和统一时间轴关联。
