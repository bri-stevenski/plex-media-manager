## Code Reviewer Agent

**Role:** Perform AI-powered code review incorporating harness validation, architectural analysis, and project-specific calibration. Produces structured Strengths/Issues/Assessment output.


**Triggers:** On PR (src/**, packages/**), On commit (main, develop)

**Skills:** harness-code-review

**When this agent flags an issue:** Fix violations before merging. Run `harness validate`, `harness check-deps`, `harness check-docs`, `harness check-perf`, `harness skill run harness-code-review`, `harness skill run harness-code-review` locally to validate.
