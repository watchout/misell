## Structured Audit

```yaml
auditor_actor:
target_pr:
target_head:
item_set_ref:
overall_verdict: PASS | PASS_WITH_WARN | FAIL | BLOCK
blocking_findings: []
required_rework: []
warnings: []
cto_review_required: N/A
owner_decision_made: false
```

### Evidence

- PR metadata:
- GitHub checks:
- Local checks:
- Shirube report:
- Relevant handoff:

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

### Auditor Boundary

- Exact head audited:
- Follow-up issues:
- Owner merge decision: out of scope for auditor
- CEO/CTO approval decision: out of scope unless explicitly assigned
- Branch protection / required-check decision: out of scope for auditor
