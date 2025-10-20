# Context

ACME maintains an enterprise ontology (OWL2) hosted in GraphDB. Users need:
1) Fast full-text search across concepts and descriptions.
2) Browsable type hierarchy.
3) Clear details view of classes/properties/individuals.
4) A diagram of neighborhood relations derived from OWL restrictions (read-only in Phase 1).

Future phases: editing with workspaces (named graphs), SHACL validation, batch updates, diagram editing, and Git-governed releases.

Primary users:
- Data architects / ontology curators
- Business analysts and developers needing quick discovery

Non-goals (Phase 1): Any write operations, inference-heavy UIs, or complex security beyond read-only + basic auth.