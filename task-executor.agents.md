## Task Executor Agent

**Role:** Execute implementation plans task-by-task using harness methodology. Maintains persistent state, follows TDD rhythm, runs verification after each task, and respects checkpoint protocol.


**Triggers:** On PR (src/**, packages/**), On commit (main, develop)

**Skills:** harness-execution

**When this agent flags an issue:** Fix violations before merging. Run `harness validate`, `harness check-deps`, `harness scan`, and `harness skill run harness-execution` locally to validate.
