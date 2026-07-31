#!/usr/bin/env python3
import json
import sys
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else "controller_warm_reset_001")
errors = []

def load(rel):
    path = root / rel
    if not path.exists():
        errors.append(f"missing file: {rel}")
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"invalid json: {rel}: {exc}")
        return {}

manifest = load("manifest.json")
for rel in manifest.get("files", []):
    if not (root / rel).exists():
        errors.append(f"manifest file missing: {rel}")

case = load("case.json")
resources = load("resources.json").get("resources", [])
topology = load("topology.json").get("edges", [])
symptoms = load("observations/symptoms.json").get("symptoms", [])
alarms = load("observations/alarms.json").get("alarms", [])
logs = load("observations/logs.json").get("logs", [])
fingerprints = load("observations/log_fingerprints.json").get("fingerprints", [])
kpis = load("observations/kpis.json").get("series", [])
similar = load("knowledge/similar_cases.json").get("similar_cases", [])
candidates = load("diagnosis/candidates.json").get("candidates", [])
tasks = load("diagnosis/tasks.json").get("tasks", [])
evidence = load("diagnosis/evidence.json").get("evidence", [])
traces = load("diagnosis/confidence_trace.json").get("traces", [])
conclusion = load("diagnosis/conclusion.json")
storyboard = load("playback/storyboard.json").get("scenes", [])

def ids(items, field):
    values = [item.get(field) for item in items]
    duplicates = {v for v in values if v and values.count(v) > 1}
    if duplicates:
        errors.append(f"duplicate {field}: {sorted(duplicates)}")
    return {v for v in values if v}

resource_ids = ids(resources, "resource_id")
edge_ids = ids(topology, "edge_id")
symptom_ids = ids(symptoms, "symptom_id")
alarm_ids = ids(alarms, "alarm_id")
log_ids = ids(logs, "log_id")
fingerprint_ids = ids(fingerprints, "fingerprint_id")
kpi_ids = ids(kpis, "series_id")
similar_ids = ids(similar, "similar_case_id")
candidate_ids = ids(candidates, "candidate_id")
task_ids = ids(tasks, "task_id")
evidence_ids = ids(evidence, "evidence_id")

for edge in topology:
    for field in ("source_id", "target_id"):
        if edge.get(field) not in resource_ids:
            errors.append(f"{edge.get('edge_id')} unknown {field}: {edge.get(field)}")

for collection, id_field in ((symptoms, "symptom_id"), (alarms, "alarm_id"), (logs, "log_id"), (kpis, "series_id"), (candidates, "candidate_id")):
    for item in collection:
        if item.get("object_id") not in resource_ids:
            errors.append(f"{item.get(id_field)} unknown object_id: {item.get('object_id')}")

for log in logs:
    if log.get("fingerprint_id") and log["fingerprint_id"] not in fingerprint_ids:
        errors.append(f"{log['log_id']} unknown fingerprint_id: {log['fingerprint_id']}")

source_ids = alarm_ids | log_ids | fingerprint_ids | kpi_ids | edge_ids | similar_ids | task_ids
for ev in evidence:
    if ev.get("candidate_id") not in candidate_ids:
        errors.append(f"{ev.get('evidence_id')} unknown candidate")
    if ev.get("task_id") not in task_ids:
        errors.append(f"{ev.get('evidence_id')} unknown task")
    if ev.get("source_ref") not in source_ids:
        errors.append(f"{ev.get('evidence_id')} unknown source_ref: {ev.get('source_ref')}")

for trace in traces:
    if trace.get("candidate_id") not in candidate_ids:
        errors.append(f"trace unknown candidate: {trace.get('candidate_id')}")
    for point in trace.get("trace", []):
        if not 0 <= point.get("confidence", -1) <= 1:
            errors.append(f"invalid confidence for {trace.get('candidate_id')}")
        for ref in point.get("evidence_refs", []):
            if ref not in evidence_ids:
                errors.append(f"trace unknown evidence: {ref}")

root_cause = conclusion.get("root_cause", {})
if root_cause.get("candidate_id") not in candidate_ids:
    errors.append("conclusion root cause is not a candidate")
if root_cause.get("object_id") not in resource_ids:
    errors.append("conclusion root cause object does not exist")

expected_stages = [
    "NORMAL_BASELINE", "SYMPTOM_TRIGGERED", "SCOPE_LOCALIZED", "CANDIDATES_GENERATED",
    "EVIDENCE_COLLECTING", "CANDIDATES_EVALUATED", "DIAGNOSIS_COMPLETED", "FUTURE_REPAIR_PREVIEW"
]
actual_stages = [scene.get("stage_code") for scene in sorted(storyboard, key=lambda x: x.get("sequence", 0))]
if actual_stages != expected_stages:
    errors.append(f"storyboard stages mismatch: {actual_stages}")

if case.get("data_mode") != "mock" or not case.get("data_disclaimer"):
    errors.append("mock disclaimer missing")

if errors:
    print("CASE PACKAGE INVALID")
    for error in errors:
        print(f"- {error}")
    raise SystemExit(1)

print("CASE PACKAGE VALID")
print(f"resources={len(resources)}, edges={len(topology)}, alarms={len(alarms)}, logs={len(logs)}, kpi_series={len(kpis)}")
print(f"candidates={len(candidates)}, tasks={len(tasks)}, evidence={len(evidence)}, scenes={len(storyboard)}")
