## Summary

-

## Shirube V3 Rapid/Lite

handoff_ref:
owner_decision_ref:

Use `handoff_ref` for the repo-local Rapid/Lite control handoff when this PR is
part of normal feature, docs, governance, or fix work. If this PR is outside
Rapid/Lite scope, state the escalation route instead.

## Scope

In scope:
-

Out of scope:
-

## Validation

-

## Policy Checklist

- [ ] Existing Misell Gate 0 remains authoritative.
- [ ] GitHub structured audit remains the semantic review record.
- [ ] LLM output is not used as merge, security, publish, billing, deletion, RBAC, or architecture authority.
- [ ] Soft-delete policy is followed or a bounded hard-delete exception is documented.
- [ ] Tenant/store/screen_group/device scope behavior is covered when relevant.
- [ ] Variable business values are centralized in DB/env/config/helper when relevant.
- [ ] No branch protection, ruleset, required-check, production, deploy, secret, or external runner change is included unless the handoff escalates out of Rapid/Lite.
