#!/usr/bin/env python3
"""Validate the semantic invariants of a Diagnosis Runtime V2 fixture.

The validator intentionally uses only the Python standard library. It checks
the reference lineage and temporal constraints that ordinary JSON Schema
cannot express. JSON Schema structural validation remains available through
schemas/runtime_contract.schema.json for IDE/CI integration.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Iterable


def load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"RUNTIME CONTRACT INVALID\n- file not found: {path}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"RUNTIME CONTRACT INVALID\n- invalid JSON: {exc}")


def collect_ids(
    items: Iterable[dict[str, Any]], field: str, label: str, errors: list[str]
) -> set[str]:
    seen: set[str] = set()
    for index, item in enumerate(items):
        value = item.get(field)
        if not isinstance(value, str) or not value:
            errors.append(f"{label}[{index}] missing {field}")
            continue
        if value in seen:
            errors.append(f"duplicate {field}: {value}")
        seen.add(value)
    return seen


def walk_legacy_keys(value: Any, path: str, errors: list[str]) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else key
            if key in {"confidence", "initial_confidence"}:
                errors.append(f"legacy confidence field is forbidden in Runtime V2: {child_path}")
            walk_legacy_keys(child, child_path, errors)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            walk_legacy_keys(child, f"{path}[{index}]", errors)


def require_dict(root: dict[str, Any], key: str, errors: list[str]) -> dict[str, Any]:
    value = root.get(key)
    if not isinstance(value, dict):
        errors.append(f"{key} must be an object")
        return {}
    return value


def require_list(root: dict[str, Any], key: str, errors: list[str]) -> list[dict[str, Any]]:
    value = root.get(key)
    if not isinstance(value, list):
        errors.append(f"{key} must be an array")
        return []
    return [item for item in value if isinstance(item, dict)]


def validate(path: Path) -> list[str]:
    data = load_json(path)
    errors: list[str] = []

    if data.get("schema_version") != "2.0":
        errors.append("schema_version must be '2.0'")

    session = require_dict(data, "session", errors)
    facts = require_list(data, "facts", errors)
    evidences = require_list(data, "evidences", errors)
    candidates = require_list(data, "candidates", errors)
    events = require_list(data, "events", errors)
    chain = require_dict(data, "minimum_evidence_chain", errors)

    fact_ids = collect_ids(facts, "fact_id", "facts", errors)
    evidence_ids = collect_ids(evidences, "evidence_id", "evidences", errors)
    candidate_ids = collect_ids(candidates, "candidate_id", "candidates", errors)
    event_ids = collect_ids(events, "event_id", "events", errors)

    walk_legacy_keys(data, "", errors)

    session_id = session.get("session_id")
    if not isinstance(session_id, str) or not session_id:
        errors.append("session.session_id is required")
    if session.get("mode") not in {"LIVE", "PAUSED", "REPLAY"}:
        errors.append("session.mode is invalid")
    if not isinstance(session.get("agent_focus"), dict):
        errors.append("session.agent_focus must be an object")

    sequences: list[int] = []
    for event in events:
        seq = event.get("sequence")
        if not isinstance(seq, int) or seq < 1:
            errors.append(f"{event.get('event_id')} has invalid sequence")
            continue
        sequences.append(seq)
        if event.get("session_id") != session_id:
            errors.append(f"{event.get('event_id')} references another session")
        if not isinstance(event.get("payload"), dict):
            errors.append(f"{event.get('event_id')} payload must be an object")

    if len(sequences) != len(set(sequences)):
        errors.append("duplicate event sequence")
    if sequences and sorted(sequences) != list(range(min(sequences), max(sequences) + 1)):
        errors.append("event sequences contain a gap")
    if sequences and min(sequences) != 1:
        errors.append("event sequence must start at 1 for a complete fixture")
    last_sequence = session.get("last_sequence")
    if sequences and last_sequence != max(sequences):
        errors.append("session.last_sequence does not match the final event sequence")

    fact_created: dict[str, int] = {}
    for fact in facts:
        fact_id = fact.get("fact_id")
        if fact.get("fact_type") not in {
            "ALARM", "LOG", "LOG_FINGERPRINT", "KPI_WINDOW",
            "TOPOLOGY_RELATION", "RESOURCE_STATE", "ABSENCE",
            "SIMILAR_CASE_REFERENCE",
        }:
            errors.append(f"{fact_id} has invalid fact_type")
        object_refs = fact.get("object_refs")
        if not isinstance(object_refs, list) or not object_refs:
            errors.append(f"{fact_id} must reference at least one object")
        source = fact.get("source")
        if not isinstance(source, dict):
            errors.append(f"{fact_id} source must be an object")
        else:
            for field in ("execution_id", "skill_id"):
                if not source.get(field):
                    errors.append(f"{fact_id} source missing {field}")
            if not isinstance(source.get("source_refs"), list) or not source.get("source_refs"):
                errors.append(f"{fact_id} source_refs must not be empty")
        if not isinstance(fact.get("payload"), dict):
            errors.append(f"{fact_id} payload must be an object")
        created = fact.get("created_sequence")
        if created is not None:
            if not isinstance(created, int) or created < 1:
                errors.append(f"{fact_id} has invalid created_sequence")
            else:
                fact_created[str(fact_id)] = created

    evidence_created: dict[str, int] = {}
    valid_effects = {"STRONG_SUPPORT", "SUPPORT", "WEAKEN", "CONFLICT", "NEUTRAL"}
    for evidence in evidences:
        evidence_id = str(evidence.get("evidence_id"))
        refs = evidence.get("fact_refs")
        if not isinstance(refs, list) or not refs:
            errors.append(f"{evidence_id} must reference at least one fact")
            refs = []
        for ref in refs:
            if ref not in fact_ids:
                errors.append(f"{evidence_id} unknown fact_ref: {ref}")
        effects = evidence.get("effects")
        if not isinstance(effects, list) or not effects:
            errors.append(f"{evidence_id} must have at least one candidate effect")
            effects = []
        for effect in effects:
            if effect.get("candidate_id") not in candidate_ids:
                errors.append(f"{evidence_id} effect references unknown candidate")
            if effect.get("effect") not in valid_effects:
                errors.append(f"{evidence_id} has invalid effect")
            if not isinstance(effect.get("score_delta"), (int, float)):
                errors.append(f"{evidence_id} effect score_delta must be numeric")
            if not effect.get("explanation"):
                errors.append(f"{evidence_id} effect explanation is required")
        created = evidence.get("created_sequence")
        if created is not None:
            if not isinstance(created, int) or created < 1:
                errors.append(f"{evidence_id} has invalid created_sequence")
            else:
                evidence_created[evidence_id] = created
                for ref in refs:
                    if ref in fact_created and fact_created[ref] > created:
                        errors.append(f"{evidence_id} is created before fact {ref}")

    candidate_by_id = {str(item.get("candidate_id")): item for item in candidates}
    valid_candidate_statuses = {
        "INITIAL", "ACTIVE", "LEADING", "WEAKENED", "CONFLICTING",
        "CONFIRMED", "NOT_CONFIRMED", "INSUFFICIENT_EVIDENCE",
    }
    for candidate in candidates:
        candidate_id = candidate.get("candidate_id")
        score = candidate.get("diagnosis_support_score")
        if not isinstance(score, (int, float)) or not 0 <= score <= 100:
            errors.append(f"{candidate_id} diagnosis_support_score must be 0..100")
        if candidate.get("status") not in valid_candidate_statuses:
            errors.append(f"{candidate_id} has invalid status")
        if not candidate.get("object_id") or not candidate.get("fault_mode_code"):
            errors.append(f"{candidate_id} must identify object and fault mode")

    chain_candidate_id = chain.get("candidate_id")
    if chain_candidate_id not in candidate_ids:
        errors.append("minimum_evidence_chain references unknown candidate")
    chain_items = chain.get("items")
    if not isinstance(chain_items, list) or not chain_items:
        errors.append("minimum_evidence_chain.items must not be empty")
        chain_items = []
    valid_chain_states = {"PENDING", "IN_PROGRESS", "SATISFIED", "CONFLICTING", "UNAVAILABLE"}
    required_chain_satisfied = True
    for item in chain_items:
        requirement_id = item.get("requirement_id")
        if not requirement_id:
            errors.append("chain item missing requirement_id")
        if item.get("status") not in valid_chain_states:
            errors.append(f"chain item {requirement_id} has invalid status")
        refs = item.get("evidence_refs")
        if not isinstance(refs, list):
            errors.append(f"chain item {requirement_id} evidence_refs must be an array")
            refs = []
        for ref in refs:
            if ref not in evidence_ids:
                errors.append(f"chain item {requirement_id} unknown evidence_ref: {ref}")
        if item.get("required") is True and item.get("status") != "SATISFIED":
            required_chain_satisfied = False

    confirmed_candidates = [c for c in candidates if c.get("status") == "CONFIRMED"]
    if confirmed_candidates:
        if len(confirmed_candidates) > 1:
            errors.append("more than one candidate is CONFIRMED")
        confirmed = confirmed_candidates[0]
        if confirmed.get("candidate_id") != chain_candidate_id:
            errors.append("confirmed candidate does not match minimum evidence chain")
        if not required_chain_satisfied:
            errors.append("candidate is CONFIRMED while required evidence chain is incomplete")
        if confirmed.get("diagnosis_support_score", 0) < 80:
            errors.append("confirmed candidate score is below the V2 default reference threshold")

    root_events = [e for e in events if e.get("event_type") == "ROOT_CAUSE_CONFIRMED"]
    for event in root_events:
        ref = event.get("payload", {}).get("candidate_ref")
        if ref not in candidate_by_id:
            errors.append(f"{event.get('event_id')} confirms unknown candidate")
        elif candidate_by_id[ref].get("status") != "CONFIRMED":
            errors.append(f"{event.get('event_id')} candidate is not CONFIRMED")
        if not required_chain_satisfied:
            errors.append(f"{event.get('event_id')} occurs before the evidence chain is satisfied")

    event_payload_text = json.dumps(events, ensure_ascii=False)
    for fact_id in fact_ids:
        if fact_id not in event_payload_text:
            errors.append(f"fact has no event reference: {fact_id}")
    for evidence_id in evidence_ids:
        if evidence_id not in event_payload_text:
            errors.append(f"evidence has no event reference: {evidence_id}")

    if len(event_ids) != len(events):
        errors.append("some events are missing valid event_id")

    return errors


def main() -> int:
    default = Path(__file__).resolve().parents[1] / "schemas" / "runtime_fixture.json"
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else default
    errors = validate(path)
    if errors:
        print("RUNTIME CONTRACT INVALID")
        for error in errors:
            print(f"- {error}")
        return 1
    data = load_json(path)
    print("RUNTIME CONTRACT VALID")
    print(
        "facts={facts}, evidences={evidences}, candidates={candidates}, events={events}".format(
            facts=len(data["facts"]),
            evidences=len(data["evidences"]),
            candidates=len(data["candidates"]),
            events=len(data["events"]),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

