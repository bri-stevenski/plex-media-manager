## Architecture Enforcer Agent

**Role:** Enforce layer boundaries, detect circular dependencies, block forbidden imports

**Triggers:** On PR (src/**), On commit (main, develop), Scheduled (cron: 0 6 * * 1)

**Skills:** enforce-architecture, check-mechanical-constraints, harness-dependency-health

**When this agent flags an issue:** Fix violations before merging. Run `harness check-deps`, `harness validate` locally to validate.
