#!/usr/bin/env python3
"""生成第五 Case(layered_topology_demo_001)数据包 —— GitHub issue #4 分层拓扑演示。

S1 客户业务域 / S2 访问连接域 / S3 存储系统域(S3.1~S3.5) 多层条带样例数据，
含跨层物理拓扑连线。仅使用现有对象/关系/Fact 类型与诊断机制,无 case_id 特判。
验收重点在分层展示;诊断走标准 V2 运行时(备份业务 LUN 时延 → 磁盘扇区坏道)。
"""
import json, os

CASE = 'layered_topology_demo_001'
DIR = f'cases/{CASE}'
for sub in ['observations', 'diagnosis', 'knowledge', 'playback', 'assets']:
    os.makedirs(f'{DIR}/{sub}', exist_ok=True)

T = '2026-08-02T10:00:00.000+08:00'
W = '2026-08-02T09:59:50.000+08:00'
E = '2026-08-02T10:00:50.000+08:00'

data = {}

data['case.json'] = {
    "case_id": CASE, "name": "分层拓扑演示：备份业务磁盘扇区故障致 RAID 降级",
    "description": "S1→S3 多层条带演示 Case：备份业务 LUN 时延升高，沿 S1.3 存储客户端→S2 访问连接→S3.1 接入→S3.2 控制→S3.3 数据服务→S3.4 资源池→S3.5 硬件逐层下钻，定位 disk-01a 扇区坏道致 RAID 降级。",
    "fault_domain": "disk_failure", "fault_mode_code": "DISK_SECTOR_FAULT",
    "severity": "critical",
    "scenario_tags": ["磁盘故障", "RAID降级", "扇区坏道", "备份业务", "分层拓扑", "full_data", "multi_evidence"],
    "data_mode": "mock", "data_disclaimer": "本案例数据用于分层拓扑展示原型演示，不代表真实环境实测结果",
    "time_origin": T,
    "observation_window": {"start": W, "end": E},
    "trigger": {"type": "kpi_anomaly", "object_id": "lun-backup-01", "symptom_id": "sym-backup-latency-high"},
    "expected_duration_ms": 96000,
    "supported_capabilities": ["topology_playback", "candidate_reasoning", "evidence_drilldown", "diagnosis_report"],
    "future_capabilities": ["repair_plan", "approval", "repair_execution", "effect_verification", "rollback"],
}

data['manifest.json'] = {
    "schema_name": "dme-fault-case-package", "schema_version": "1.0.0",
    "case_id": CASE, "case_version": "1.0.0",
    "created_at": "2026-08-02T10:10:00+08:00", "data_mode": "mock",
    "locale": "zh-CN", "timezone": "Asia/Shanghai", "entry_file": "case.json",
    "files": ["case.json","resources.json","topology.json",
        "observations/symptoms.json","observations/alarms.json","observations/logs.json",
        "observations/log_fingerprints.json","observations/kpis.json",
        "knowledge/fault_patterns.json","knowledge/similar_cases.json",
        "diagnosis/candidates.json","diagnosis/tasks.json","diagnosis/evidence.json",
        "diagnosis/confidence_trace.json","diagnosis/conclusion.json",
        "playback/storyboard.json","assets/README.md","README.md"],
    "compatible_player": ">=1.0.0 <2.0.0",
}

def res(rid, rtype, name, parent, device, zone, loc, attrs):
    return {"resource_id": rid, "resource_type": rtype, "name": name, "parent_id": parent,
            "device_id": device, "zone": zone, "location": loc,
            "attributes": attrs,
            "display": {"label": name, "default_expanded": True, "aggregate_group": None}}

R = []
# ── S1 客户业务域 ──
# S1.1 Business Application（上层应用）
for rid, name in [("db-app-01", "数据库业务"), ("credit-app-01", "信用卡业务"),
                  ("backup-app-01", "备份业务"), ("archive-app-01", "归档业务"),
                  ("file-share-app-01", "文件共享业务")]:
    health = "WARNING" if rid in ("backup-app-01",) else "NORMAL"
    R.append(res(rid, "BUSINESS_APP", name, None, None, "BUSINESS_SIDE", "external",
                 {"service": rid.split("-")[0], "health": health, "topo_layer": "S1_1"}))
# S1.2 Business Service（业务服务）
for rid, name in [("bs-db-01", "数据库业务服务"), ("bs-credit-01", "信用卡业务服务"), ("bs-backup-01", "备份业务服务")]:
    health = "WARNING" if rid == "bs-backup-01" else "NORMAL"
    R.append(res(rid, "BUSINESS_SERVICE", name, None, None, "BUSINESS_SIDE", "external",
                 {"health": health, "topo_layer": "S1_2"}))
# S1.3 Storage Client（存储客户端）
for rid, name, rtype in [("file-client-01", "文件客户端", "STORAGE_CLIENT"),
                         ("client-os-01", "客户端OS", "CLIENT_OS"),
                         ("mount-point-01", "挂载点", "MOUNT_POINT")]:
    R.append(res(rid, rtype, name, None, None, "BUSINESS_SIDE", "external",
                 {"health": "NORMAL", "topo_layer": "S1_3"}))

# ── S2 访问连接域 ──
# S2.1 Host Interface（主机接口/网卡端口）
for rid, name in [("host-if-01", "主机网卡接口-01"), ("host-if-02", "主机网卡接口-02"), ("host-if-03", "主机网卡接口-03")]:
    R.append(res(rid, "HOST_INTERFACE", name, None, None, "ACCESS_SIDE", "external",
                 {"health": "NORMAL", "topo_layer": "S2_1"}))
# S2.2 Network Fabric（网络 Fabric/交换机）
for rid, name in [("fab-a", "SAN Fabric-A"), ("fab-b", "SAN Fabric-B"), ("fab-c", "ETH Fabric-C")]:
    R.append(res(rid, "NETWORK_FABRIC", name, None, None, "NETWORK_SIDE", "external",
                 {"fabric": rid[-1], "health": "NORMAL", "topo_layer": "S2_2"}))
# S2.3 Access Link（访问链路）
for rid, name in [("link-host-fab-a", "主机-FabricA访问链路"), ("link-host-fab-b", "主机-FabricB访问链路"),
                  ("link-host-fab-c", "主机-FabricC访问链路"), ("link-fab-stor-a", "FabricA-存储访问链路"),
                  ("link-fab-stor-b", "FabricB-存储访问链路"), ("link-fab-stor-c", "FabricC-存储访问链路")]:
    R.append(res(rid, "ACCESS_LINK", name, None, None, "NETWORK_SIDE", "external",
                 {"health": "NORMAL", "topo_layer": "S2_3"}))

# ── S3 存储系统域 ──
# S3.1 Access Layer（存储以太端口 FC Port / ETH Port / LIF）
for rid, name, rtype in [("fc-port-01a", "FC端口-01A", "FC_PORT"), ("fc-port-01b", "FC端口-01B", "FC_PORT"),
                         ("eth-port-01a", "ETH端口-01A", "ETH_PORT"), ("lif-01a", "LIF-01A", "LIF")]:
    R.append(res(rid, rtype, name, None, "storage-01", "FRONTEND_ACCESS", "internal_boundary",
                 {"controller": rid[-1] if rid[-1] in "ab" else "a", "health": "NORMAL", "topo_layer": "S3_1"}))
# S3.2 Control Layer（Controller / CPU / Memory / Cache）
for rid, name, rtype in [("ctl-01a", "控制器-01A", "CONTROLLER"), ("ctl-01b", "控制器-01B", "CONTROLLER"),
                         ("cpu-01a", "控制器CPU-01A", "CPU"), ("mem-01a", "控制器内存-01A", "MEMORY"),
                         ("cache-01a", "控制器缓存-01A", "CACHE")]:
    R.append(res(rid, rtype, name, "storage-01", "storage-01", "CONTROL_SERVICE", "internal",
                 {"role": "active" if rid.endswith("a") else "standby", "health": "NORMAL", "topo_layer": "S3_2"}))
# S3.3 Data Service Layer（Block / NAS / Object / Snapshot / QoS / Replication）
for rid, name, rtype in [("svc-block-01", "Block服务-01", "BLOCK_SERVICE"), ("svc-nas-01", "NAS服务-01", "NAS_SERVICE"),
                         ("svc-object-01", "Object服务-01", "OBJECT_SERVICE"), ("svc-snapshot-01", "快照服务-01", "SNAPSHOT_SERVICE"),
                         ("svc-qos-01", "QoS服务-01", "QOS_SERVICE"), ("svc-repl-01", "复制服务-01", "REPLICATION_SERVICE")]:
    R.append(res(rid, rtype, name, "storage-01", "storage-01", "CONTROL_SERVICE", "internal",
                 {"health": "NORMAL", "topo_layer": "S3_3"}))
# S3.4 Storage Resource Layer（Pool / RAID / LUN / FileSystem / DiskDomain）
for rid, name, rtype, health in [("pool-01a", "存储池-01A", "POOL", "WARNING"),
                                 ("raid-01a", "RAID组-01A", "RAID", "WARNING"),
                                 ("lun-01a", "LUN-01A", "LUN", "NORMAL"),
                                 ("lun-backup-01", "LUN-BACKUP-01", "LUN", "WARNING"),
                                 ("fs-01a", "文件系统-01A", "FILESYSTEM", "NORMAL"),
                                 ("disk-domain-01a", "磁盘域-01A", "DISK_DOMAIN", "NORMAL")]:
    R.append(res(rid, rtype, name, "storage-01", "storage-01", "LOGICAL_RESOURCE", "internal",
                 {"health": health, "topo_layer": "S3_4"}))
# S3.5 Hardware Layer（Enclosure / Disk / Power / Fan / BBU）
for rid, name, rtype, health in [("enc-01a", "机框-01A", "ENCLOSURE", "NORMAL"),
                                 ("disk-01a", "磁盘-01A", "DISK", "FAULT"),
                                 ("disk-01b", "磁盘-01B", "DISK", "NORMAL"),
                                 ("disk-01c", "磁盘-01C", "DISK", "NORMAL"),
                                 ("psu-01a", "电源-01A", "POWER", "NORMAL"),
                                 ("fan-01a", "风扇-01A", "FAN", "NORMAL"),
                                 ("bbu-01a", "BBU-01A", "BBU", "NORMAL")]:
    R.append(res(rid, rtype, name, "enc-01a" if rtype == "DISK" else "storage-01",
                 "storage-01", "PHYSICAL_RESOURCE", "internal",
                 {"media": "SSD" if rtype == "DISK" and rid in ("disk-01a", "disk-01b") else "HDD",
                  "health": health, "topo_layer": "S3_5"}))
data['resources.json'] = {"resources": R}

def edge(eid, src, tgt, rel, pg=None):
    return {"edge_id": eid, "source_id": src, "target_id": tgt, "relation_type": rel,
            "direction": "directed", "path_group": pg, "redundancy_group": None,
            "state": "normal", "valid_from": None, "valid_to": None}

E = []
# ── 业务 → 服务 → 存储客户端 ──
E.append(edge("e-db-app-bs", "db-app-01", "bs-db-01", "DEPENDS_ON"))
E.append(edge("e-credit-app-bs", "credit-app-01", "bs-credit-01", "DEPENDS_ON"))
E.append(edge("e-backup-app-bs", "backup-app-01", "bs-backup-01", "DEPENDS_ON", "backup-path"))
E.append(edge("e-archive-app-bs", "archive-app-01", "bs-backup-01", "DEPENDS_ON"))
E.append(edge("e-bs-db-os", "bs-db-01", "client-os-01", "HOSTS"))
E.append(edge("e-bs-credit-os", "bs-credit-01", "client-os-01", "HOSTS"))
E.append(edge("e-bs-backup-client", "bs-backup-01", "file-client-01", "HOSTS", "backup-path"))
E.append(edge("e-file-share-app-client", "file-share-app-01", "file-client-01", "DEPENDS_ON"))
E.append(edge("e-file-client-mount", "file-client-01", "mount-point-01", "HOSTS"))
E.append(edge("e-os-hif-1", "client-os-01", "host-if-01", "HOSTS", "backup-path"))
E.append(edge("e-mount-hif-2", "mount-point-01", "host-if-02", "HOSTS"))
E.append(edge("e-mount-hif-3", "mount-point-01", "host-if-03", "HOSTS"))
# ── 主机接口 → 访问链路 → Fabric ──
E.append(edge("e-hif1-link-a", "host-if-01", "link-host-fab-a", "CONNECTS_TO", "backup-path"))
E.append(edge("e-hif2-link-b", "host-if-02", "link-host-fab-b", "CONNECTS_TO"))
E.append(edge("e-hif3-link-c", "host-if-03", "link-host-fab-c", "CONNECTS_TO"))
E.append(edge("e-linka-fab-a", "link-host-fab-a", "fab-a", "CONNECTS_TO", "backup-path"))
E.append(edge("e-linkb-fab-b", "link-host-fab-b", "fab-b", "CONNECTS_TO"))
E.append(edge("e-linkc-fab-c", "link-host-fab-c", "fab-c", "CONNECTS_TO"))
E.append(edge("e-faba-link-stor-a", "fab-a", "link-fab-stor-a", "CONNECTS_TO", "backup-path"))
E.append(edge("e-fabb-link-stor-b", "fab-b", "link-fab-stor-b", "CONNECTS_TO"))
E.append(edge("e-fabc-link-stor-c", "fab-c", "link-fab-stor-c", "CONNECTS_TO"))
# ── Fabric → 存储前端端口 ──
E.append(edge("e-link-stor-a-fc-a", "link-fab-stor-a", "fc-port-01a", "PHYSICAL_CONNECTS", "backup-path"))
E.append(edge("e-link-stor-b-fc-b", "link-fab-stor-b", "fc-port-01b", "PHYSICAL_CONNECTS"))
E.append(edge("e-link-stor-c-eth", "link-fab-stor-c", "eth-port-01a", "PHYSICAL_CONNECTS"))
E.append(edge("e-faba-fc-a", "fab-a", "fc-port-01a", "PHYSICAL_CONNECTS", "backup-path"))
E.append(edge("e-fabb-fc-b", "fab-b", "fc-port-01b", "PHYSICAL_CONNECTS"))
# ── 前端端口 → 控制器 ──
E.append(edge("e-fc-a-ctl-a", "fc-port-01a", "ctl-01a", "DEPENDS_ON", "backup-path"))
E.append(edge("e-fc-b-ctl-b", "fc-port-01b", "ctl-01b", "DEPENDS_ON"))
E.append(edge("e-eth-ctl-a", "eth-port-01a", "ctl-01a", "DEPENDS_ON"))
E.append(edge("e-lif-ctl-a", "lif-01a", "ctl-01a", "DEPENDS_ON"))
# ── 控制器内部 ──
E.append(edge("e-ctl-a-cpu", "ctl-01a", "cpu-01a", "CONTAINS"))
E.append(edge("e-ctl-a-mem", "ctl-01a", "mem-01a", "CONTAINS"))
E.append(edge("e-ctl-a-cache", "ctl-01a", "cache-01a", "CONTAINS"))
E.append(edge("e-ctl-a-enc", "ctl-01a", "enc-01a", "BELONGS_TO"))
E.append(edge("e-ctl-b-enc", "ctl-01b", "enc-01a", "BELONGS_TO"))
# ── 控制器 → 数据服务 ──
E.append(edge("e-ctl-a-block", "ctl-01a", "svc-block-01", "PROVIDES_SERVICE", "backup-path"))
E.append(edge("e-ctl-a-nas", "ctl-01a", "svc-nas-01", "PROVIDES_SERVICE"))
E.append(edge("e-ctl-b-object", "ctl-01b", "svc-object-01", "PROVIDES_SERVICE"))
# ── 数据服务依赖 ──
E.append(edge("e-block-snapshot", "svc-block-01", "svc-snapshot-01", "DEPENDS_ON"))
E.append(edge("e-block-qos", "svc-block-01", "svc-qos-01", "DEPENDS_ON"))
E.append(edge("e-block-repl", "svc-block-01", "svc-repl-01", "DEPENDS_ON"))
E.append(edge("e-nas-repl", "svc-nas-01", "svc-repl-01", "DEPENDS_ON"))
# ── 数据服务 → 存储资源 ──
E.append(edge("e-block-lun-a", "svc-block-01", "lun-01a", "PROVIDES_SERVICE"))
E.append(edge("e-block-lun-backup", "svc-block-01", "lun-backup-01", "PROVIDES_SERVICE", "backup-path"))
E.append(edge("e-nas-fs", "svc-nas-01", "fs-01a", "PROVIDES_SERVICE"))
# ── 存储资源内部 ──
E.append(edge("e-lun-a-pool", "lun-01a", "pool-01a", "BACKED_BY"))
E.append(edge("e-lun-backup-pool", "lun-backup-01", "pool-01a", "BACKED_BY", "backup-path"))
E.append(edge("e-fs-pool", "fs-01a", "pool-01a", "BACKED_BY"))
E.append(edge("e-pool-raid", "pool-01a", "raid-01a", "BACKED_BY", "backup-path"))
E.append(edge("e-raid-diskdomain", "raid-01a", "disk-domain-01a", "BACKED_BY", "backup-path"))
E.append(edge("e-pool-diskdomain", "pool-01a", "disk-domain-01a", "BACKED_BY"))
# ── 存储资源 → 硬件 ──
E.append(edge("e-diskdomain-enc", "disk-domain-01a", "enc-01a", "BELONGS_TO", "backup-path"))
E.append(edge("e-enc-disk-a", "enc-01a", "disk-01a", "CONTAINS", "backup-path"))
E.append(edge("e-enc-disk-b", "enc-01a", "disk-01b", "CONTAINS"))
E.append(edge("e-enc-disk-c", "enc-01a", "disk-01c", "CONTAINS"))
E.append(edge("e-enc-psu", "enc-01a", "psu-01a", "CONTAINS"))
E.append(edge("e-enc-fan", "enc-01a", "fan-01a", "CONTAINS"))
E.append(edge("e-enc-bbu", "enc-01a", "bbu-01a", "CONTAINS"))
# ── 诊断直连：客户端 → 备份 LUN ──
E.append(edge("e-os-lun-backup", "client-os-01", "lun-backup-01", "ACCESSES", "backup-path"))
data['topology.json'] = {"edges": E}

data['observations/symptoms.json'] = {"symptoms": [
    {"symptom_id": "sym-backup-latency-high", "source": "kpi", "raw_description": "备份业务 LUN 时延突增，IO 明显变慢",
     "normalized_type": "IO_LATENCY_HIGH", "object_id": "lun-backup-01", "detected_at": "2026-08-02T10:00:02.000+08:00",
     "value": 45.0, "unit": "ms", "baseline": 3.0},
]}

data['observations/alarms.json'] = {"alarms": [
    {"alarm_id": "alm-raid-degrade-8802", "alarm_code": "RAID_GROUP_DEGRADED", "name": "RAID组降级", "object_id": "raid-01a",
     "severity": "critical", "occurred_at": "2026-08-02T10:00:03.500+08:00", "cleared_at": None, "status": "active",
     "raw_fields": {"raid_group": "raid-01a", "degraded_disk": "disk-01a"}},
    {"alarm_id": "alm-disk-01a-fault", "alarm_code": "DISK_FAULT", "name": "磁盘故障", "object_id": "disk-01a",
     "severity": "major", "occurred_at": "2026-08-02T10:00:03.600+08:00", "cleared_at": None, "status": "active",
     "raw_fields": {"error_type": "sector_reallocated", "sector_count": 51}},
]}

data['observations/logs.json'] = {"logs": [
    {"log_id": "log-disk-01a-sector", "timestamp": "2026-08-02T09:59:58.200+08:00", "object_id": "disk-01a",
     "level": "ERROR", "component": "disk-agent", "message": "Sector reallocation threshold exceeded: 51 sectors", "fingerprint_id": "fp-sector-fault"},
    {"log_id": "log-raid-rebuild", "timestamp": "2026-08-02T10:00:05.100+08:00", "object_id": "raid-01a",
     "level": "WARN", "component": "raid-mgr", "message": "RAID group raid-01a degraded, rebuild started", "fingerprint_id": "fp-raid-rebuild"},
    {"log_id": "log-host-normal", "timestamp": "2026-08-02T10:00:20.000+08:00", "object_id": "client-os-01",
     "level": "INFO", "component": "os", "message": "CPU/IO normal, no local saturation", "fingerprint_id": "fp-host-normal"},
]}

data['observations/log_fingerprints.json'] = {"fingerprints": [
    {"fingerprint_id": "fp-sector-fault", "name": "扇区坏道指纹", "template": "sector reallocation", "fault_mode_codes": ["DISK_SECTOR_FAULT"],
     "window": {"start": "2026-08-02T09:59:55.000+08:00", "end": "2026-08-02T10:00:00.000+08:00"}, "hit_count": 51, "matched_log_ids": ["log-disk-01a-sector"]},
    {"fingerprint_id": "fp-raid-rebuild", "name": "RAID 重建指纹", "template": "degraded, rebuild", "fault_mode_codes": ["DISK_SECTOR_FAULT"],
     "window": {"start": "2026-08-02T10:00:04.000+08:00", "end": "2026-08-02T10:00:30.000+08:00"}, "hit_count": 1, "matched_log_ids": ["log-raid-rebuild"]},
    {"fingerprint_id": "fp-host-normal", "name": "主机正常指纹", "template": "cpu/io normal", "fault_mode_codes": [],
     "window": {"start": "2026-08-02T10:00:18.000+08:00", "end": "2026-08-02T10:00:22.000+08:00"}, "hit_count": 1, "matched_log_ids": ["log-host-normal"]},
]}

data['observations/kpis.json'] = {"series": [
    {"series_id": "kpi-lun-backup-latency", "object_id": "lun-backup-01", "indicator_id": "io_latency", "name": "备份LUN时延", "unit": "ms",
     "sample_interval_ms": 1000, "baseline": {"value": 3.0}, "thresholds": {"high": 10},
     "points": [{"timestamp": "2026-08-02T09:59:50.000+08:00", "value": 3.1}, {"timestamp": "2026-08-02T10:00:02.000+08:00", "value": 19.2},
                {"timestamp": "2026-08-02T10:00:10.000+08:00", "value": 45.0}, {"timestamp": "2026-08-02T10:00:20.000+08:00", "value": 41.8}]},
    {"series_id": "kpi-disk-01a-read-err", "object_id": "disk-01a", "indicator_id": "read_errors", "name": "磁盘读错误", "unit": "count",
     "sample_interval_ms": 1000, "baseline": {"value": 0}, "thresholds": {"high": 5},
     "points": [{"timestamp": "2026-08-02T09:59:50.000+08:00", "value": 0}, {"timestamp": "2026-08-02T10:00:02.000+08:00", "value": 14},
                {"timestamp": "2026-08-02T10:00:10.000+08:00", "value": 51}, {"timestamp": "2026-08-02T10:00:20.000+08:00", "value": 58}]},
    {"series_id": "kpi-host-cpu", "object_id": "client-os-01", "indicator_id": "cpu_util", "name": "客户端CPU", "unit": "%",
     "sample_interval_ms": 1000, "baseline": {"value": 30}, "thresholds": {"high": 90},
     "points": [{"timestamp": "2026-08-02T09:59:50.000+08:00", "value": 32}, {"timestamp": "2026-08-02T10:00:10.000+08:00", "value": 34},
                {"timestamp": "2026-08-02T10:00:20.000+08:00", "value": 33}]},
]}

data['diagnosis/candidates.json'] = {"candidates": [
    {"candidate_id": "cand-disk-sector-fault", "fault_mode_code": "DISK_SECTOR_FAULT", "object_id": "disk-01a",
     "display_name": "磁盘扇区坏道致 RAID 降级", "initial_confidence": 0.35, "generation_basis": ["sym-backup-latency-high", "pattern-disk-fault"], "status": "confirmed"},
    {"candidate_id": "cand-lun-contention", "fault_mode_code": "LUN_IO_CONTENTION", "object_id": "lun-backup-01",
     "display_name": "备份 LUN IO 争抢", "initial_confidence": 0.25, "generation_basis": ["sym-backup-latency-high", "pattern-io-contention"], "status": "excluded"},
    {"candidate_id": "cand-host-bottleneck", "fault_mode_code": "HOST_RESOURCE_BOTTLENECK", "object_id": "host-if-01",
     "display_name": "访问链路/主机瓶颈", "initial_confidence": 0.20, "generation_basis": ["sym-backup-latency-high", "pattern-host-bottleneck"], "status": "excluded"},
]}

data['diagnosis/tasks.json'] = {"tasks": [
    {"task_id": "task-map-backup", "stage": "scope_localization", "skill_code": "BUSINESS_MAPPING", "display_name": "映射备份业务端到端路径", "input": {"object_ids": ["backup-app-01"]},
     "started_at": "2026-08-02T10:00:10.000+08:00", "ended_at": "2026-08-02T10:00:10.500+08:00", "status": "succeeded", "result_refs": ["e-backup-app-bs", "e-bs-backup-client", "e-os-lun-backup"], "error": None},
    {"task_id": "task-verify-lun-kpi", "stage": "evidence_collection", "skill_code": "QUERY_KPI", "display_name": "验证备份LUN时延与IO", "input": {"series_ids": ["kpi-lun-backup-latency"]},
     "started_at": "2026-08-02T10:00:10.600+08:00", "ended_at": "2026-08-02T10:00:11.200+08:00", "status": "succeeded", "result_refs": ["kpi-lun-backup-latency"], "error": None},
    {"task_id": "task-query-disk-alarm", "stage": "evidence_collection", "skill_code": "QUERY_ALARM", "display_name": "查询RAID与磁盘告警", "input": {"object_ids": ["raid-01a", "disk-01a"]},
     "started_at": "2026-08-02T10:00:11.500+08:00", "ended_at": "2026-08-02T10:00:12.000+08:00", "status": "succeeded", "result_refs": ["alm-raid-degrade-8802", "alm-disk-01a-fault"], "error": None},
    {"task_id": "task-match-sector-fp", "stage": "evidence_collection", "skill_code": "MATCH_LOG_FINGERPRINT", "display_name": "匹配扇区坏道与重建指纹", "input": {"object_ids": ["disk-01a", "raid-01a"]},
     "started_at": "2026-08-02T10:00:12.100+08:00", "ended_at": "2026-08-02T10:00:12.700+08:00", "status": "succeeded", "result_refs": ["fp-sector-fault", "fp-raid-rebuild"], "error": None},
    {"task_id": "task-check-competitors", "stage": "evidence_collection", "skill_code": "QUERY_KPI", "display_name": "检查主机与IO竞争候选", "input": {"series_ids": ["kpi-host-cpu", "kpi-disk-01a-read-err"]},
     "started_at": "2026-08-02T10:00:12.800+08:00", "ended_at": "2026-08-02T10:00:13.400+08:00", "status": "succeeded", "result_refs": ["kpi-host-cpu", "kpi-disk-01a-read-err"], "error": None},
    {"task_id": "task-search-similar", "stage": "evidence_collection", "skill_code": "SEARCH_SIMILAR_CASE", "display_name": "检索磁盘故障历史案例", "input": {"query_features": ["sector_realloc", "raid_degrade"]},
     "started_at": "2026-08-02T10:00:13.500+08:00", "ended_at": "2026-08-02T10:00:14.200+08:00", "status": "succeeded", "result_refs": ["case-20260728-021"], "error": None},
]}

data['diagnosis/evidence.json'] = {"evidence": [
    {"evidence_id": "ev-raid-degrade-alarm", "evidence_type": "alarm", "source_ref": "alm-raid-degrade-8802", "task_id": "task-query-disk-alarm",
     "candidate_id": "cand-disk-sector-fault", "stance": "support", "strength": 0.85, "summary": "命中 RAID 组降级严重告警", "detail": "RAID 组 raid-01a 降级，故障盘 disk-01a", "time_alignment_ms": 1500, "quality": "high"},
    {"evidence_id": "ev-disk-fault-alarm", "evidence_type": "alarm", "source_ref": "alm-disk-01a-fault", "task_id": "task-query-disk-alarm",
     "candidate_id": "cand-disk-sector-fault", "stance": "support", "strength": 0.80, "summary": "命中磁盘 01A 扇区重映射告警", "detail": "sector_reallocated 51 sectors", "time_alignment_ms": 1600, "quality": "high"},
    {"evidence_id": "ev-sector-fp", "evidence_type": "log_fingerprint", "source_ref": "fp-sector-fault", "task_id": "task-match-sector-fp",
     "candidate_id": "cand-disk-sector-fault", "stance": "support", "strength": 0.88, "summary": "命中扇区坏道指纹（51 扇区）", "detail": "sector reallocation threshold exceeded", "time_alignment_ms": 4200, "quality": "high"},
    {"evidence_id": "ev-rebuild-fp", "evidence_type": "log_fingerprint", "source_ref": "fp-raid-rebuild", "task_id": "task-match-sector-fp",
     "candidate_id": "cand-disk-sector-fault", "stance": "support", "strength": 0.82, "summary": "命中 RAID 重建指纹", "detail": "degraded, rebuild started", "time_alignment_ms": 2600, "quality": "high"},
    {"evidence_id": "ev-backup-latency", "evidence_type": "kpi", "source_ref": "kpi-lun-backup-latency", "task_id": "task-verify-lun-kpi",
     "candidate_id": "cand-disk-sector-fault", "stance": "support", "strength": 0.78, "summary": "备份 LUN 时延 3.0→45ms", "detail": "同窗升高，重建期间持续", "time_alignment_ms": 800, "quality": "high"},
    {"evidence_id": "ev-host-normal", "evidence_type": "kpi", "source_ref": "kpi-host-cpu", "task_id": "task-check-competitors",
     "candidate_id": "cand-host-bottleneck", "stance": "contradict", "strength": 0.85, "summary": "客户端 CPU 正常，削弱主机瓶颈候选", "detail": "CPU ~33%，无本地饱和", "time_alignment_ms": 900, "quality": "high"},
    {"evidence_id": "ev-latency-contend", "evidence_type": "kpi", "source_ref": "kpi-lun-backup-latency", "task_id": "task-verify-lun-kpi",
     "candidate_id": "cand-lun-contention", "stance": "contradict", "strength": 0.60, "summary": "时延升高但 IO 量未激增，削弱 IO 争抢候选", "detail": "IOPS 平稳，仅时延上升", "time_alignment_ms": 800, "quality": "medium"},
    {"evidence_id": "ev-disk-read-err", "evidence_type": "kpi", "source_ref": "kpi-disk-01a-read-err", "task_id": "task-check-competitors",
     "candidate_id": "cand-disk-sector-fault", "stance": "support", "strength": 0.90, "summary": "磁盘读错误 0→58 持续上升", "detail": "与扇区坏道告警同窗", "time_alignment_ms": 700, "quality": "high"},
    {"evidence_id": "ev-similar-disk", "evidence_type": "similar_case", "source_ref": "case-20260728-021", "task_id": "task-search-similar",
     "candidate_id": "cand-disk-sector-fault", "stance": "support", "strength": 0.70, "summary": "相似历史案例：扇区坏道致 RAID 降级", "detail": "历史根因 DISK_SECTOR_FAULT", "time_alignment_ms": None, "quality": "medium"},
]}

data['diagnosis/confidence_trace.json'] = {"traces": [
    {"candidate_id": "cand-disk-sector-fault", "trace": [
        {"sequence": 1, "stage": "candidate_generation", "confidence": 0.35, "evidence_refs": [], "reason": "依据备份 LUN 时延现象和分层拓扑路径生成候选"},
        {"sequence": 2, "stage": "evidence_collection", "confidence": 0.66, "evidence_refs": ["ev-raid-degrade-alarm", "ev-disk-fault-alarm"], "reason": "命中 RAID 降级与磁盘故障告警"},
        {"sequence": 3, "stage": "evidence_fusion", "confidence": 0.95, "evidence_refs": ["ev-sector-fp", "ev-rebuild-fp", "ev-disk-read-err", "ev-backup-latency"], "reason": "扇区指纹、重建日志与磁盘读错误同窗，备份 LUN 时延升高"}]},
    {"candidate_id": "cand-lun-contention", "trace": [
        {"sequence": 1, "stage": "candidate_generation", "confidence": 0.25, "evidence_refs": [], "reason": "备份 LUN 时延升高，IO 争抢为候选"},
        {"sequence": 2, "stage": "evidence_collection", "confidence": 0.18, "evidence_refs": ["ev-latency-contend"], "reason": "IO 量未激增，削弱争抢假设"},
        {"sequence": 3, "stage": "evidence_fusion", "confidence": 0.08, "evidence_refs": ["ev-latency-contend"], "reason": "争抢假设被进一步削弱"}]},
    {"candidate_id": "cand-host-bottleneck", "trace": [
        {"sequence": 1, "stage": "candidate_generation", "confidence": 0.20, "evidence_refs": [], "reason": "备份业务变慢，访问链路/主机瓶颈为候选"},
        {"sequence": 2, "stage": "evidence_collection", "confidence": 0.12, "evidence_refs": ["ev-host-normal"], "reason": "客户端 CPU 正常，削弱"},
        {"sequence": 3, "stage": "evidence_fusion", "confidence": 0.06, "evidence_refs": ["ev-host-normal"], "reason": "客户端无本地饱和，排除"}]},
]}

data['diagnosis/conclusion.json'] = {
    "diagnosis_id": "diag-layered-disk-sector-001", "status": "confirmed",
    "completed_at": "2026-08-02T10:00:30.000+08:00",
    "root_cause": {"candidate_id": "cand-disk-sector-fault", "object_id": "disk-01a", "fault_mode_code": "DISK_SECTOR_FAULT", "confidence": 0.95},
    "root_cause_chain": ["disk-01a", "raid-01a"],
    "impact_chain": ["disk-domain-01a", "pool-01a", "lun-backup-01", "bs-backup-01", "backup-app-01"],
    "recovery_chain": ["disk-01b", "enc-01a", "raid-01a", "lun-backup-01"],
    "excluded_candidates": ["cand-lun-contention", "cand-host-bottleneck"],
    "diagnosis_summary": "disk-01a 发生扇区坏道，RAID 组 raid-01a 降级并重建，重建期间备份 LUN 时延由 3ms 升至 45ms；主机与 IO 争抢候选被竞争检查排除。",
    "key_evidence_refs": ["ev-raid-degrade-alarm", "ev-sector-fp", "ev-rebuild-fp", "ev-disk-read-err", "ev-backup-latency"],
    "business_impact": {"object_id": "backup-app-01", "level": "moderate", "duration_ms": 88000, "description": "备份业务 IO 时延升高，重建完成后恢复"},
}

data['knowledge/fault_patterns.json'] = {"fault_patterns": [
    {"pattern_id": "pattern-disk-fault", "fault_mode_code": "DISK_SECTOR_FAULT", "symptom_codes": ["IO_LATENCY_HIGH"],
     "resource_types": ["DISK", "RAID"], "description": "磁盘扇区坏道→RAID降级→重建→LUN时延升高（S3.5→S3.4→S3.3 影响链）"},
]}

data['knowledge/similar_cases.json'] = {"similar_cases": [
    {"similar_case_id": "case-20260728-021", "title": "历史磁盘扇区坏道致RAID降级", "similarity": 0.81,
     "historical_root_cause": {"fault_mode_code": "DISK_SECTOR_FAULT", "object_type": "DISK"},
     "matched_features": ["sector_realloc", "raid_degrade", "io_latency_high"], "resolution_summary": "更换故障盘后重建完成，性能恢复"},
]}

scenes = [
    ("NORMAL_BASELINE", "正常基线", 0, 9000, ["backup-app-01", "storage-01"]),
    ("SYMPTOM_TRIGGERED", "故障现象触发", 9000, 10000, ["lun-backup-01"]),
    ("SCOPE_LOCALIZED", "现象映射与范围锁定", 19000, 11000, ["client-os-01", "lun-backup-01"]),
    ("CANDIDATES_GENERATED", "候选根因生成", 30000, 12000, ["disk-01a", "lun-backup-01"]),
    ("EVIDENCE_COLLECTING", "Agent沿分层路径取证", 42000, 20000, ["disk-01a", "raid-01a", "lun-backup-01"]),
    ("CANDIDATES_EVALUATED", "候选验证与排除", 62000, 14000, ["disk-01a", "host-if-01"]),
    ("DIAGNOSIS_COMPLETED", "根因诊断完成", 76000, 13000, ["disk-01a", "raid-01a", "lun-backup-01", "backup-app-01"]),
    ("FUTURE_REPAIR_PREVIEW", "修复闭环能力预告", 89000, 7000, ["disk-01a"]),
]
data['playback/storyboard.json'] = {
    "playback_id": "story-layered-topology-v1", "total_duration_ms": 96000,
    "scenes": [{"scene_id": f"scene-{i+1:02d}", "sequence": i+1, "stage_code": sc[0], "title": sc[1],
                "start_offset_ms": sc[2], "duration_ms": sc[3], "focus_resource_ids": sc[4]} for i, sc in enumerate(scenes)],
}

data['assets/README.md'] = "第五 Case（分层拓扑演示）模拟数据包：S1→S3 多层条带样例数据，验证 issue #4 分层拓扑展示。\n"
data['README.md'] = f"# {CASE}\nS1 客户业务域 / S2 访问连接域 / S3 存储系统域(S3.1~S3.5) 分层条带演示：备份业务磁盘扇区坏道 → RAID 降级。\n"

for name, payload in data.items():
    with open(f'{DIR}/{name}', 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
print(f'生成完成: {DIR}/ ({len(data)} 个文件)')
print(f'资源数: {len(R)}, 边数: {len(E)}')
