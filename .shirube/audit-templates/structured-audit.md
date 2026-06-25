## Structured Audit

```yaml
shirube_structured_audit:
  schema_version: shirube-structured-audit/v1
  target_pr:
  target_head:
  auditor_actor:
  auditor_model:
  audit_checklist_ref:
  item_set_ref:
  overall_verdict: PASS | PASS_WITH_WARN | FAIL | BLOCK
  blocking_findings: []
  required_rework: []
  warnings: []
  cto_review_required: false
  owner_decision_made: false
  items:
    - item_id: AUDIT-001
      result: PASS | FAIL | N/A | UNVERIFIED
      evidence_refs:
        - changed_files
      confidence: high | medium | low
      notes: ""
```

The top-level YAML may omit `shirube_structured_audit:` only for legacy
compatibility. New audits should include it and answer every requested checklist
item exactly once.

### Evidence

- PR metadata:
- GitHub checks:
- Local checks:
- Shirube report:
- Relevant handoff:
- Audit checklist:
- Machine evidence for executable items:

### Findings

#### Blocking Findings

- none

#### Required Rework

- none

#### Warnings

- none

### Scope Verification

- Handoff allowed paths:
- Handoff forbidden paths:
- Non-scope behavior:
- Runtime/product behavior changes:
- Security/CEO gate impact:
- Protected surfaces:
- Reusable/report-only workflow impact:

### Auditor Boundary

- Exact head audited:
- Checklist items answered:
- Follow-up issues:
- Owner merge decision: out of scope for auditor
- CEO/CTO approval decision: out of scope unless explicitly assigned
- Branch protection / required-check decision: out of scope for auditor
