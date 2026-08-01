#!/usr/bin/env python3
"""生成第四 Case(disk_raid_degrade_001)数据包,验证 docs/14 BA-EXT 扩展能力。
仅使用现有对象/关系/Fact 类型与诊断机制,无 case_id 特判。"""
import json, os

CASE = 'disk_raid_degrade_001'
DIR = f'cases/{CASE}'
for sub in ['observations', 'diagnosis', 'knowledge', 'playback', 'assets']:
    os.makedirs(f'{DIR}/{sub}', exist_ok=True)

W = '2026-08-01T09:44:50.000+08:00'
E = '2026-08-01T09:45:40.000+08:00'

data = {}

T = "2026-08-01T09:45:00.000+08:00"
data['case.json'] = {
    "case_id": CASE, "name": "SSD 磁盘扇区故障致 RAID 降级归档业务变慢",
    "description": "storage-02 的 RAID 组中磁盘 disk-02a 发生扇区坏道，RAID 组降级并进入重建，重建期间 lun-arch02 归档业务 IO 时延升高。",
    "fault_domain": "disk_failure", "fault_mode_code": "DISK_RAID_DEGRADE",
    "severity": "critical",
    "scenario_tags": ["磁盘故障", "RAID降级", "扇区坏道", "归档业务", "full_data", "multi_evidence"],
    "data_mode": "mock", "data_disclaimer": "本案例数据用于原型演示，不代表真实环境实测结果",
    "time_origin": T,
    "observation_window": {"start": W, "end": E},
    "trigger": {"type": "kpi_anomaly", "object_id": "lun-arch02", "symptom_id": "sym-arch-latency-high"},
    "expected_duration_ms": 90000,
    "supported_capabilities": ["topology_playback", "candidate_reasoning", "evidence_drilldown", "diagnosis_report"],
    "future_capabilities": ["repair_plan", "approval", "repair_execution", "effect_verification", "rollback"],
}

data['manifest.json'] = {
    "schema_name": "dme-fault-case-package", "schema_version": "1.0.0",
    "case_id": CASE, "case_version": "1.0.0",
    "created_at": "2026-08-01T10:00:00+08:00", "data_mode": "mock",
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

data['resources.json'] = {"resources": [
    {"resource_id": "business-arch", "resource_type": "BUSINESS", "name": "归档业务", "parent_id": None, "device_id": None, "zone": "BUSINESS_SIDE", "location": "external", "attributes": {"service": "archive-db"}},
    {"resource_id": "host-02", "resource_type": "HOST", "name": "Host-02", "parent_id": None, "device_id": None, "zone": "ACCESS_SIDE", "location": "external", "attributes": {"os": "Linux", "multipath": "enabled"}},
    {"resource_id": "storage-02", "resource_type": "STORAGE_DEVICE", "name": "Storage-02", "parent_id": None, "device_id": "storage-02", "zone": "ROOT", "location": "boundary", "attributes": {"model": "MockStorage-Y"}},
    {"resource_id": "controller-2a", "resource_type": "CONTROLLER", "name": "Controller-2A", "parent_id": "storage-02", "device_id": "storage-02", "zone": "CONTROL_SERVICE", "location": "internal", "attributes": {"role": "active", "slot": "2A"}},
    {"resource_id": "block-service-02", "resource_type": "BLOCK_SERVICE", "name": "Block Service-02", "parent_id": "storage-02", "device_id": "storage-02", "zone": "CONTROL_SERVICE", "location": "internal", "attributes": {"raid": "RAID6"}},
    {"resource_id": "lun-arch02", "resource_type": "LUN", "name": "LUN-ARCH02", "parent_id": "storage-02", "device_id": "storage-02", "zone": "LOGICAL_RESOURCE", "location": "internal", "attributes": {"capacity_tb": 16, "protocol": "FC"}},
    {"resource_id": "storage-pool-02", "resource_type": "STORAGE_POOL", "name": "Storage Pool-02", "parent_id": "storage-02", "device_id": "storage-02", "zone": "LOGICAL_RESOURCE", "location": "internal", "attributes": {"raid": "RAID6", "utilization_pct": 58.4}},
    {"resource_id": "disk-enclosure-02", "resource_type": "DISK_ENCLOSURE", "name": "Disk Enclosure-02", "parent_id": "storage-02", "device_id": "storage-02", "zone": "PHYSICAL_RESOURCE", "location": "internal", "attributes": {"disk_count": 8}},
    {"resource_id": "disk-02a", "resource_type": "DISK", "name": "Disk-02A", "parent_id": "disk-enclosure-02", "device_id": "storage-02", "zone": "PHYSICAL_RESOURCE", "location": "internal", "attributes": {"media": "SSD", "health": "degraded"}},
    {"resource_id": "disk-02b", "resource_type": "DISK", "name": "Disk-02B", "parent_id": "disk-enclosure-02", "device_id": "storage-02", "zone": "PHYSICAL_RESOURCE", "location": "internal", "attributes": {"media": "SSD", "health": "normal"}},
]}

data['topology.json'] = {"edges": [
    {"edge_id": "e-host-02-arch-lun", "source_id": "host-02", "target_id": "lun-arch02", "relation_type": "ACCESSES", "direction": "directed", "path_group": "arch-path"},
    {"edge_id": "e-arch-lun-pool", "source_id": "lun-arch02", "target_id": "storage-pool-02", "relation_type": "BACKED_BY", "direction": "directed", "path_group": "arch-path"},
    {"edge_id": "e-pool-enclosure", "source_id": "storage-pool-02", "target_id": "disk-enclosure-02", "relation_type": "BACKED_BY", "direction": "directed", "path_group": "arch-path"},
    {"edge_id": "e-enclosure-disk-2a", "source_id": "disk-enclosure-02", "target_id": "disk-02a", "relation_type": "CONTAINS", "direction": "directed", "path_group": "arch-path"},
    {"edge_id": "e-enclosure-disk-2b", "source_id": "disk-enclosure-02", "target_id": "disk-02b", "relation_type": "CONTAINS", "direction": "directed", "path_group": "arch-path"},
    {"edge_id": "e-block-arch", "source_id": "block-service-02", "target_id": "lun-arch02", "relation_type": "PROVIDES_SERVICE", "direction": "directed", "path_group": "arch-path"},
]}

data['observations/symptoms.json'] = {"symptoms": [
    {"symptom_id": "sym-arch-latency-high", "source": "kpi", "raw_description": "归档业务 LUN 时延突增，IO 明显变慢",
     "normalized_type": "IO_LATENCY_HIGH", "object_id": "lun-arch02", "detected_at": "2026-08-01T09:45:02.000+08:00",
     "value": 42.0, "unit": "ms", "baseline": 2.8},
]}

data['observations/alarms.json'] = {"alarms": [
    {"alarm_id": "alm-raid-degrade-8801", "alarm_code": "RAID_GROUP_DEGRADED", "name": "RAID组降级", "object_id": "disk-enclosure-02",
     "severity": "critical", "occurred_at": "2026-08-01T09:45:03.500+08:00", "cleared_at": None, "status": "active",
     "raw_fields": {"raid_group": "rg-arch-01", "degraded_disk": "disk-02a"}},
    {"alarm_id": "alm-disk-02a-fault", "alarm_code": "DISK_FAULT", "name": "磁盘故障", "object_id": "disk-02a",
     "severity": "major", "occurred_at": "2026-08-01T09:45:03.600+08:00", "cleared_at": None, "status": "active",
     "raw_fields": {"error_type": "sector_reallocated", "sector_count": 47}},
]}

data['observations/logs.json'] = {"logs": [
    {"log_id": "log-disk-02a-sector", "timestamp": "2026-08-01T09:44:58.200+08:00", "object_id": "disk-02a",
     "level": "ERROR", "component": "disk-agent", "message": "Sector reallocation threshold exceeded: 47 sectors", "fingerprint_id": "fp-sector-fault"},
    {"log_id": "log-raid-rebuild", "timestamp": "2026-08-01T09:45:05.100+08:00", "object_id": "disk-enclosure-02",
     "level": "WARN", "component": "raid-mgr", "message": "RAID group rg-arch-01 degraded, rebuild started", "fingerprint_id": "fp-raid-rebuild"},
    {"log_id": "log-host-02-cpu", "timestamp": "2026-08-01T09:45:20.000+08:00", "object_id": "host-02",
     "level": "INFO", "component": "os", "message": "CPU/IO normal, no local saturation", "fingerprint_id": "fp-host-normal"},
]}

data['observations/log_fingerprints.json'] = {"fingerprints": [
    {"fingerprint_id": "fp-sector-fault", "name": "扇区坏道指纹", "template": "sector reallocation", "fault_mode_codes": ["DISK_RAID_DEGRADE"],
     "window": {"start": "2026-08-01T09:44:55.000+08:00", "end": "2026-08-01T09:45:00.000+08:00"}, "hit_count": 47, "matched_log_ids": ["log-disk-02a-sector"]},
    {"fingerprint_id": "fp-raid-rebuild", "name": "RAID 重建指纹", "template": "degraded, rebuild", "fault_mode_codes": ["DISK_RAID_DEGRADE"],
     "window": {"start": "2026-08-01T09:45:04.000+08:00", "end": "2026-08-01T09:45:30.000+08:00"}, "hit_count": 1, "matched_log_ids": ["log-raid-rebuild"]},
    {"fingerprint_id": "fp-host-normal", "name": "主机正常指纹", "template": "cpu/io normal", "fault_mode_codes": [],
     "window": {"start": "2026-08-01T09:45:18.000+08:00", "end": "2026-08-01T09:45:22.000+08:00"}, "hit_count": 1, "matched_log_ids": ["log-host-02-cpu"]},
]}

data['observations/kpis.json'] = {"series": [
    {"series_id": "kpi-lun-arch02-latency", "object_id": "lun-arch02", "indicator_id": "io_latency", "name": "归档LUN时延", "unit": "ms",
     "sample_interval_ms": 1000, "baseline": {"value": 2.8}, "thresholds": {"high": 10},
     "points": [{"timestamp": "2026-08-01T09:44:50.000+08:00", "value": 2.9}, {"timestamp": "2026-08-01T09:45:02.000+08:00", "value": 18.4},
                {"timestamp": "2026-08-01T09:45:10.000+08:00", "value": 42.0}, {"timestamp": "2026-08-01T09:45:20.000+08:00", "value": 39.6}]},
    {"series_id": "kpi-disk-02a-read-err", "object_id": "disk-02a", "indicator_id": "read_errors", "name": "磁盘读错误", "unit": "count",
     "sample_interval_ms": 1000, "baseline": {"value": 0}, "thresholds": {"high": 5},
     "points": [{"timestamp": "2026-08-01T09:44:50.000+08:00", "value": 0}, {"timestamp": "2026-08-01T09:45:02.000+08:00", "value": 12},
                {"timestamp": "2026-08-01T09:45:10.000+08:00", "value": 47}, {"timestamp": "2026-08-01T09:45:20.000+08:00", "value": 53}]},
    {"series_id": "kpi-host-02-cpu", "object_id": "host-02", "indicator_id": "cpu_util", "name": "主机CPU", "unit": "%",
     "sample_interval_ms": 1000, "baseline": {"value": 30}, "thresholds": {"high": 90},
     "points": [{"timestamp": "2026-08-01T09:44:50.000+08:00", "value": 31}, {"timestamp": "2026-08-01T09:45:10.000+08:00", "value": 33},
                {"timestamp": "2026-08-01T09:45:20.000+08:00", "value": 32}]},
]}

data['diagnosis/candidates.json'] = {"candidates": [
    {"candidate_id": "cand-disk-failure", "fault_mode_code": "DISK_RAID_DEGRADE", "object_id": "disk-02a",
     "display_name": "磁盘扇区故障致 RAID 降级", "initial_confidence": 0.35, "generation_basis": ["sym-arch-latency-high", "pattern-disk-fault"], "status": "confirmed"},
    {"candidate_id": "cand-lun-contention", "fault_mode_code": "LUN_IO_CONTENTION", "object_id": "lun-arch02",
     "display_name": "归档业务 IO 争抢", "initial_confidence": 0.25, "generation_basis": ["sym-arch-latency-high", "pattern-io-contention"], "status": "excluded"},
    {"candidate_id": "cand-host-bottleneck", "fault_mode_code": "HOST_RESOURCE_BOTTLENECK", "object_id": "host-02",
     "display_name": "主机自身瓶颈", "initial_confidence": 0.20, "generation_basis": ["sym-arch-latency-high", "pattern-host-bottleneck"], "status": "excluded"},
]}

data['diagnosis/tasks.json'] = {"tasks": [
    {"task_id": "task-map-arch", "stage": "scope_localization", "skill_code": "BUSINESS_MAPPING", "display_name": "映射归档业务与LUN", "input": {"object_ids": ["business-arch"]},
     "started_at": "2026-08-01T09:45:10.000+08:00", "ended_at": "2026-08-01T09:45:10.350+08:00", "status": "succeeded", "result_refs": ["e-host-02-arch-lun"], "error": None},
    {"task_id": "task-verify-lun-kpi", "stage": "evidence_collection", "skill_code": "QUERY_KPI", "display_name": "验证归档LUN时延与IO", "input": {"series_ids": ["kpi-lun-arch02-latency"]},
     "started_at": "2026-08-01T09:45:10.400+08:00", "ended_at": "2026-08-01T09:45:11.200+08:00", "status": "succeeded", "result_refs": ["kpi-lun-arch02-latency"], "error": None},
    {"task_id": "task-query-disk-alarm", "stage": "evidence_collection", "skill_code": "QUERY_ALARM", "display_name": "查询磁盘与RAID告警", "input": {"object_ids": ["disk-02a", "disk-enclosure-02"]},
     "started_at": "2026-08-01T09:45:11.500+08:00", "ended_at": "2026-08-01T09:45:12.000+08:00", "status": "succeeded", "result_refs": ["alm-raid-degrade-8801", "alm-disk-02a-fault"], "error": None},
    {"task_id": "task-match-sector-fp", "stage": "evidence_collection", "skill_code": "MATCH_LOG_FINGERPRINT", "display_name": "匹配扇区坏道与重建指纹", "input": {"object_ids": ["disk-02a", "disk-enclosure-02"]},
     "started_at": "2026-08-01T09:45:12.100+08:00", "ended_at": "2026-08-01T09:45:12.700+08:00", "status": "succeeded", "result_refs": ["fp-sector-fault", "fp-raid-rebuild"], "error": None},
    {"task_id": "task-check-competitors", "stage": "evidence_collection", "skill_code": "QUERY_KPI", "display_name": "检查主机与IO竞争候选", "input": {"series_ids": ["kpi-host-02-cpu", "kpi-disk-02a-read-err"]},
     "started_at": "2026-08-01T09:45:12.800+08:00", "ended_at": "2026-08-01T09:45:13.400+08:00", "status": "succeeded", "result_refs": ["kpi-host-02-cpu", "kpi-disk-02a-read-err"], "error": None},
    {"task_id": "task-search-similar", "stage": "evidence_collection", "skill_code": "SEARCH_SIMILAR_CASE", "display_name": "检索磁盘故障历史案例", "input": {"query_features": ["sector_realloc", "raid_degrade"]},
     "started_at": "2026-08-01T09:45:13.500+08:00", "ended_at": "2026-08-01T09:45:14.200+08:00", "status": "succeeded", "result_refs": ["case-20260511-021"], "error": None},
]}

data['diagnosis/evidence.json'] = {"evidence": [
    {"evidence_id": "ev-raid-degrade-alarm", "evidence_type": "alarm", "source_ref": "alm-raid-degrade-8801", "task_id": "task-query-disk-alarm",
     "candidate_id": "cand-disk-failure", "stance": "support", "strength": 0.85, "summary": "命中 RAID 组降级严重告警", "detail": "RAID 组 rg-arch-01 降级，故障盘 disk-02a", "time_alignment_ms": 1500, "quality": "high"},
    {"evidence_id": "ev-disk-fault-alarm", "evidence_type": "alarm", "source_ref": "alm-disk-02a-fault", "task_id": "task-query-disk-alarm",
     "candidate_id": "cand-disk-failure", "stance": "support", "strength": 0.80, "summary": "命中磁盘 02A 扇区重映射告警", "detail": "sector_reallocated 47 sectors", "time_alignment_ms": 1600, "quality": "high"},
    {"evidence_id": "ev-sector-fp", "evidence_type": "log_fingerprint", "source_ref": "fp-sector-fault", "task_id": "task-match-sector-fp",
     "candidate_id": "cand-disk-failure", "stance": "support", "strength": 0.88, "summary": "命中扇区坏道指纹（47 扇区）", "detail": "sector reallocation threshold exceeded", "time_alignment_ms": 4200, "quality": "high"},
    {"evidence_id": "ev-rebuild-fp", "evidence_type": "log_fingerprint", "source_ref": "fp-raid-rebuild", "task_id": "task-match-sector-fp",
     "candidate_id": "cand-disk-failure", "stance": "support", "strength": 0.82, "summary": "命中 RAID 重建指纹", "detail": "degraded, rebuild started", "time_alignment_ms": 2600, "quality": "high"},
    {"evidence_id": "ev-arch-latency", "evidence_type": "kpi", "source_ref": "kpi-lun-arch02-latency", "task_id": "task-verify-lun-kpi",
     "candidate_id": "cand-disk-failure", "stance": "support", "strength": 0.78, "summary": "归档 LUN 时延 2.8→42ms", "detail": "同窗升高，重建期间持续", "time_alignment_ms": 800, "quality": "high"},
    {"evidence_id": "ev-host-normal", "evidence_type": "kpi", "source_ref": "kpi-host-02-cpu", "task_id": "task-check-competitors",
     "candidate_id": "cand-host-bottleneck", "stance": "contradict", "strength": 0.85, "summary": "主机 CPU 正常，削弱主机瓶颈候选", "detail": "CPU ~32%，无本地饱和", "time_alignment_ms": 900, "quality": "high"},
    {"evidence_id": "ev-arch-latency-contend", "evidence_type": "kpi", "source_ref": "kpi-lun-arch02-latency", "task_id": "task-verify-lun-kpi",
     "candidate_id": "cand-lun-contention", "stance": "contradict", "strength": 0.60, "summary": "时延升高但 IO 量未激增，削弱 IO 争抢候选", "detail": "IOPS 平稳，仅时延上升", "time_alignment_ms": 800, "quality": "medium"},
    {"evidence_id": "ev-disk-err-read", "evidence_type": "kpi", "source_ref": "kpi-disk-02a-read-err", "task_id": "task-check-competitors",
     "candidate_id": "cand-disk-failure", "stance": "support", "strength": 0.90, "summary": "磁盘读错误 0→53 持续上升", "detail": "与扇区坏道告警同窗", "time_alignment_ms": 700, "quality": "high"},
    {"evidence_id": "ev-similar-disk", "evidence_type": "similar_case", "source_ref": "case-20260511-021", "task_id": "task-search-similar",
     "candidate_id": "cand-disk-failure", "stance": "support", "strength": 0.70, "summary": "相似历史案例：扇区坏道致 RAID 降级", "detail": "历史根因 DISK_RAID_DEGRADE", "time_alignment_ms": None, "quality": "medium"},
]}

data['diagnosis/confidence_trace.json'] = {"traces": [
    {"candidate_id": "cand-disk-failure", "trace": [
        {"sequence": 1, "stage": "candidate_generation", "confidence": 0.35, "evidence_refs": [], "reason": "依据归档 LUN 时延现象和磁盘路径生成候选"},
        {"sequence": 2, "stage": "evidence_collection", "confidence": 0.66, "evidence_refs": ["ev-raid-degrade-alarm", "ev-disk-fault-alarm"], "reason": "命中 RAID 降级与磁盘故障告警"},
        {"sequence": 3, "stage": "evidence_fusion", "confidence": 0.94, "evidence_refs": ["ev-sector-fp", "ev-rebuild-fp", "ev-disk-err-read", "ev-arch-latency"], "reason": "扇区指纹、重建日志与磁盘读错误同窗，LUN 时延升高"}]},
    {"candidate_id": "cand-lun-contention", "trace": [
        {"sequence": 1, "stage": "candidate_generation", "confidence": 0.25, "evidence_refs": [], "reason": "归档 LUN 时延升高，IO 争抢为候选"},
        {"sequence": 2, "stage": "evidence_collection", "confidence": 0.18, "evidence_refs": ["ev-arch-latency-contend"], "reason": "IO 量未激增，削弱争抢假设"},
        {"sequence": 3, "stage": "evidence_fusion", "confidence": 0.08, "evidence_refs": ["ev-arch-latency-contend"], "reason": "争抢假设被进一步削弱"}]},
    {"candidate_id": "cand-host-bottleneck", "trace": [
        {"sequence": 1, "stage": "candidate_generation", "confidence": 0.20, "evidence_refs": [], "reason": "归档业务变慢，主机瓶颈为候选"},
        {"sequence": 2, "stage": "evidence_collection", "confidence": 0.12, "evidence_refs": ["ev-host-normal"], "reason": "主机 CPU 正常，削弱"},
        {"sequence": 3, "stage": "evidence_fusion", "confidence": 0.06, "evidence_refs": ["ev-host-normal"], "reason": "主机无本地饱和，排除"}]},
]}

data['diagnosis/conclusion.json'] = {
    "diagnosis_id": "diag-disk-raid-degrade-001", "status": "confirmed",
    "completed_at": "2026-08-01T09:45:27.000+08:00",
    "root_cause": {"candidate_id": "cand-disk-failure", "object_id": "disk-02a", "fault_mode_code": "DISK_RAID_DEGRADE", "confidence": 0.94},
    "root_cause_chain": ["disk-02a", "disk-enclosure-02"],
    "impact_chain": ["storage-pool-02", "lun-arch02", "business-arch"],
    "recovery_chain": ["disk-02b", "disk-enclosure-02", "lun-arch02"],
    "excluded_candidates": ["cand-lun-contention", "cand-host-bottleneck"],
    "diagnosis_summary": "disk-02a 发生扇区坏道，RAID 组降级并重建，重建期间归档 LUN 时延由 2.8ms 升至 42ms；主机与 IO 争抢候选被竞争检查排除。",
    "key_evidence_refs": ["ev-raid-degrade-alarm", "ev-sector-fp", "ev-rebuild-fp", "ev-disk-err-read", "ev-arch-latency"],
    "business_impact": {"object_id": "business-arch", "level": "moderate", "duration_ms": 85000, "description": "归档业务 IO 时延升高，重建完成后恢复"},
}

data['knowledge/fault_patterns.json'] = {"fault_patterns": [
    {"pattern_id": "pattern-disk-fault", "fault_mode_code": "DISK_RAID_DEGRADE", "symptom_codes": ["IO_LATENCY_HIGH"],
     "resource_types": ["DISK", "DISK_ENCLOSURE"], "description": "磁盘扇区坏道→RAID降级→重建→IO时延升高"},
]}

data['knowledge/similar_cases.json'] = {"similar_cases": [
    {"similar_case_id": "case-20260511-021", "title": "历史磁盘扇区坏道致RAID降级", "similarity": 0.82,
     "historical_root_cause": {"fault_mode_code": "DISK_RAID_DEGRADE", "object_type": "DISK"},
     "matched_features": ["sector_realloc", "raid_degrade", "io_latency_high"], "resolution_summary": "更换故障盘后重建完成，性能恢复"},
]}

scenes = [
    ("NORMAL_BASELINE", "正常基线", 0, 9000, ["business-arch", "storage-02"]),
    ("SYMPTOM_TRIGGERED", "故障现象触发", 9000, 10000, ["lun-arch02"]),
    ("SCOPE_LOCALIZED", "现象映射与范围锁定", 19000, 11000, ["host-02", "lun-arch02", "storage-02"]),
    ("CANDIDATES_GENERATED", "候选根因生成", 30000, 12000, ["disk-02a", "lun-arch02"]),
    ("EVIDENCE_COLLECTING", "Agent并行取证", 42000, 20000, ["disk-02a", "disk-enclosure-02", "lun-arch02"]),
    ("CANDIDATES_EVALUATED", "候选验证与排除", 62000, 14000, ["disk-02a", "host-02"]),
    ("DIAGNOSIS_COMPLETED", "根因诊断完成", 76000, 13000, ["disk-02a", "disk-enclosure-02", "lun-arch02", "business-arch"]),
    ("FUTURE_REPAIR_PREVIEW", "修复闭环能力预告", 89000, 7000, ["disk-02a"]),
]
data['playback/storyboard.json'] = {
    "playback_id": "story-disk-raid-degrade-v1", "total_duration_ms": 96000,
    "scenes": [{"scene_id": f"scene-{i+1:02d}", "sequence": i+1, "stage_code": sc[0], "title": sc[1],
                "start_offset_ms": sc[2], "duration_ms": sc[3], "focus_resource_ids": sc[4]} for i, sc in enumerate(scenes)],
}

data['assets/README.md'] = "第四 Case 模拟数据包（扩展性验收演示），无新增 Skill/页面/诊断分支。\n"
data['README.md'] = f"# {CASE}\n磁盘扇区坏道 → RAID 降级 → 归档业务变慢。用于验证 docs/14 BA-EXT 扩展能力。\n"

for name, payload in data.items():
    with open(f'{DIR}/{name}', 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
print(f'生成完成: {DIR}/ ({len(data)} 个文件)')
