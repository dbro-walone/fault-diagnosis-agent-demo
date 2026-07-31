# Fault Operations Ontology

This context describes the shared operational language used to explore a storage model and execute a traceable fault-diagnosis Scenario.

## Language

**Ontology Object**:
A stable, typed identity for a real asset, observation, knowledge item, diagnostic hypothesis, task, or decision.
_Avoid_: topology node, graph node, UI node

**Ontology Link**:
A typed relationship between two Ontology Objects whose identity and provenance are explicit.
_Avoid_: inferred edge, name-based connection

**Ontology Scenario**:
An isolated, event-driven overlay that adds diagnostic Objects and Links without mutating the base ontology.
_Avoid_: Case page, scripted animation

**Function Call**:
A read-only invocation that obtains facts from ontology-backed data sources.
_Avoid_: Action, write operation

**Action Proposal**:
An approval-gated proposal to change operational state; it is not executed by the diagnosis demo.
_Avoid_: Function Call, automatic repair

**Decision**:
A terminal, traceable diagnosis Object whose lineage links to the candidates, evidence, facts, plans, tasks, and function calls that justify it.
_Avoid_: conclusion string, root-cause flag

**Lens**:
A deterministic projection of the same Ontology Objects and Links for topology, knowledge, diagnosis, impact, or audit exploration.
_Avoid_: separate graph, duplicated dataset
