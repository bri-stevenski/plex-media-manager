## Verifier Agent

**Role:** Verify that implementation matches the approved spec and plan using harness methodology. Checks at three tiers — EXISTS (files present), SUBSTANTIVE (real implementation, not stubs), and WIRED (connected to the rest of the system). Reports pass/fail with evidence-based findings.


**Triggers:** Manual

**Skills:** harness-verification

**When this agent flags an issue:** Fix violations before merging. Run `harness validate`, `harness check-deps`, `harness check-phase-gate`, `harness skill run harness-verification` locally to validate.
