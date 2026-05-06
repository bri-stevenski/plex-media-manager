## Planner Agent

**Role:** Create detailed implementation plans from approved specs using harness methodology. Breaks work into atomic tasks with explicit file paths, dependency ordering, and checkpoint placement. Writes plans and handoff context for execution.


**Triggers:** Manual

**Skills:** harness-planning

**When this agent flags an issue:** Fix violations before merging. Run `harness validate`, `harness check-deps`, `harness skill run harness-planning` locally to validate.
