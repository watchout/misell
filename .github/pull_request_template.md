## Summary

-

## Shirube V3

handoff_ref:
owner_decision_ref:

Use `handoff_ref` for the repo-local control handoff. If this PR touches a
protected surface, state the escalation route or protected governance handoff.

Structured audit and owner decision must target the exact PR head. Owner
approval should be posted as:

```yaml
shirube_owner_decision:
  verdict: APPROVED_EXACT_HEAD
  target_pr:
  exact_head_sha:
  owner_actor: watchout
```

## Scope

In scope:
-

Out of scope:
-

## Validation

-

## Policy Checklist

- [ ] Existing Misell Gate 0 remains required.
- [ ] Shirube structured audit exists for the exact PR head.
- [ ] Owner exact-head decision exists before merge.
- [ ] Structured audit uses an allowed auditor and satisfies maker-checker separation.
- [ ] LLM output is not used as merge, security, publish, billing, deletion, RBAC, or architecture authority.
- [ ] Soft-delete policy is followed or a bounded hard-delete exception is documented.
- [ ] Tenant/store/screen_group/device scope behavior is covered when relevant.
- [ ] Variable business values are centralized in DB/env/config/helper when relevant.
- [ ] No branch protection, ruleset, required-check, production, deploy, secret, or external runner change is included unless the handoff escalates to protected governance.
