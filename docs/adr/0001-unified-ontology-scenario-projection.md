# Use one ontology registry with isolated Scenario overlays

Topology, knowledge, and diagnosis previously built separate in-memory objects, which made identity and state drift unavoidable. The executable ontology now keeps base assets and knowledge in one registry, applies Case data as an isolated event-driven Scenario overlay, and derives every Lens and 3D view from the merged snapshot. This preserves stable object identity and prevents diagnostic playback from mutating or duplicating the base model, at the cost of requiring all Case events to use ontology mutations and explicit provenance.

Function, Skill and Action definitions follow the same rule: the base Registry Catalog is the single source of truth, while a Scenario may reference stable IDs or add definitions through one isolated catalog overlay. Runtime validation, Object View and execution resolve the same catalog snapshot.

Hidden cross-layer mappings are capability-gated data. A Lens may project one only after a reached Scenario Candidate, Evidence or Decision explicitly lists its mapping ID in `activatesLinkIds`; selecting a Lens or enabling cross-layer display is never sufficient.

Terminal Decisions are derived assertions rather than trusted Scenario flags. Before applying a Decision event, Runtime evaluates the pre-event Session and the Decision event's declared path Links, then rejects invalid support, evidence, conflict, competitor, temporal, lineage or path protocols.
