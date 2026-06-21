# Plan: Phase 1 Architecture Standardization

**Date:** 2026-05-06 | **Spec:** docs/changes/phase-1-ai-core/proposal.md | **Tasks:** 12 | **Time:** 45 min | **Integration Tier:** medium

## Goal

Standardize the project architecture by enforcing strict Harness layering, implementing barrel exports for all layers, and ensuring all imports follow the defined hierarchy to eliminate leaky abstractions and prepare for the unified media processor.

## Observable Truths (Acceptance Criteria)

1. The system shall pass `harness check-deps` (or equivalent manual verification if CLI is broken) with zero architectural violations.
2. Every layer (`agents`, `services`, `repository`, `config`, `types`) shall have a `src/<layer>/index.ts` barrel export.
3. Every file within `src/` shall import from the barrel exports of lower layers rather than deep-linking into individual files, where appropriate for public APIs.
4. The system shall pass `npm run type-check` with no errors.
5. The system shall pass `harness validate` once environmental issues are resolved.

## File Map

- CREATE `src/types/index.ts`
- CREATE `src/config/index.ts`
- CREATE `src/repository/index.ts`
- CREATE `src/services/index.ts`
- MODIFY `src/repository/fs.ts`
- MODIFY `src/repository/tmdb.ts`
- MODIFY `src/services/parser.ts`
- MODIFY `src/services/formatter.ts`
- MODIFY `src/agents/cli-movies.ts`
- MODIFY `src/agents/cli-tv.ts`
- MODIFY `src/agents/cli-music.ts`

## Skeleton

1. Layer Barrel Exports (~4 tasks, ~12 min)
2. Repository Layer Refactor (~2 tasks, ~8 min)
3. Service Layer Refactor (~2 tasks, ~8 min)
4. Agent Layer Refactor (~3 tasks, ~12 min)
5. Final Validation (~1 task, ~5 min)
   **Estimated total:** 12 tasks, ~45 minutes

## Tasks

### Task 1: Create Types Barrel Export

**Depends on:** none | **Files:** `src/types/index.ts`

1. Create `src/types/index.ts`:
   ```typescript
   export * from './media';
   ```
2. Run: `npm run type-check`
3. Run: `harness validate`
4. Commit: `chore(types): add barrel export`

### Task 2: Create Config Barrel Export

**Depends on:** Task 1 | **Files:** `src/config/index.ts`

1. Create `src/config/index.ts`:
   ```typescript
   export * from './env';
   export * from './logger';
   ```
2. Run: `npm run type-check`
3. Run: `harness validate`
4. Commit: `chore(config): add barrel export`

### Task 3: Create Repository Barrel Export

**Depends on:** Task 2 | **Files:** `src/repository/index.ts`

1. Create `src/repository/index.ts`:
   ```typescript
   export * from './fs';
   export * from './tmdb';
   ```
2. Run: `npm run type-check`
3. Run: `harness validate`
4. Commit: `chore(repository): add barrel export`

### Task 4: Create Services Barrel Export

**Depends on:** Task 3 | **Files:** `src/services/index.ts`

1. Create `src/services/index.ts`:
   ```typescript
   export * from './formatter';
   export * from './parser';
   ```
2. Run: `npm run type-check`
3. Run: `harness validate`
4. Commit: `chore(services): add barrel export`

### Task 5: Refactor Repository Layer Imports

**Depends on:** Task 4 | **Files:** `src/repository/fs.ts`, `src/repository/tmdb.ts`

1. Modify `src/repository/fs.ts`: update imports from `../config/env` and `../config/logger` to `../config`.
2. Modify `src/repository/tmdb.ts`: update imports from `../config/env`, `../config/logger` to `../config`.
3. Run: `npm run type-check`
4. Run: `harness validate`
5. Commit: `refactor(repository): use barrel imports for config`

### Task 6: Refactor Service Layer Imports

**Depends on:** Task 5 | **Files:** `src/services/parser.ts`, `src/services/formatter.ts`

1. Modify `src/services/parser.ts`: update imports from `../config/env` and `../types/media` to `../config` and `../types`.
2. Modify `src/services/formatter.ts`: update imports from `../config/env` and `../config/logger` to `../config`.
3. Run: `npm run type-check`
4. Run: `harness validate`
5. Commit: `refactor(services): use barrel imports for config and types`

### Task 7: Refactor Movies Agent Imports

**Depends on:** Task 6 | **Files:** `src/agents/cli-movies.ts`

1. Modify `src/agents/cli-movies.ts`: update all relative imports to use barrel exports from `../services`, `../repository`, `../config`, and `../types`.
2. Run: `npm run type-check`
3. Run: `harness validate`
4. Commit: `refactor(agents): use barrel imports in cli-movies`

### Task 8: Refactor TV Agent Imports

**Depends on:** Task 6 | **Files:** `src/agents/cli-tv.ts`

1. Modify `src/agents/cli-tv.ts`: update all relative imports to use barrel exports from `../services`, `../repository`, `../config`, and `../types`.
2. Run: `npm run type-check`
3. Run: `harness validate`
4. Commit: `refactor(agents): use barrel imports in cli-tv`

### Task 9: Refactor Music Agent Imports

**Depends on:** Task 6 | **Files:** `src/agents/cli-music.ts`

1. Modify `src/agents/cli-music.ts`: update all relative imports to use barrel exports from `../repository`, `../config`, and `../types`.
2. Run: `npm run type-check`
3. Run: `harness validate`
4. Commit: `refactor(agents): use barrel imports in cli-music`

### Task 10: Cleanup and Final Architectural Review

**Depends on:** Task 9 | **Files:** `src/**/*.ts`

1. Run `grep -r "import .* from '../.*/.*'" src/` to find any remaining deep imports that should be redirected to barrels.
2. Fix any remaining deep imports.
3. [checkpoint:human-verify] Verify that `harness check-deps` passes or that manual audit confirms strict layering.
4. Run: `harness validate`
5. Commit: `chore: finalize architecture standardization`

### Task 11: Implement Basic Service Layer Protection (Integration)

**Depends on:** Task 10 | **Files:** `src/services/index.ts` | **Category:** integration

1. Review agent→service boundaries in `src/services/index.ts`.
2. Apply decision matrix for logic moves:
   - **Move to Service:** Stateful I/O, external API orchestration (TMDb), core business rules (metadata parsing/scoring), and file path construction.
   - **Keep in Agent:** CLI argument parsing, environment loading, log level setting, and high-level process flow control.
   - **Document:** Any shared utilities that reside in `repository` but are orchestrated by `services`.
3. Success Criteria & Checklist:
   - [ ] All stateful I/O and business rules are moved out of agents.
   - [ ] All public service functions are re-exported from `src/services/index.ts`.
   - [ ] Create `docs/changes/phase-1-ai-core/boundary.md` containing:
     - Examples of moved functions.
     - List of exported API surface.
     - Diagram or description of the new boundary.
4. Run: `harness validate`
5. Commit: `chore: service layer API hardening`

### Task 12: Documentation Update (Integration)

**Depends on:** Task 11 | **Files:** `README.md` | **Category:** integration

1. Update `README.md` or internal docs to reflect the new barrel export structure.
2. Run: `harness validate`
3. Commit: `docs: update architecture documentation`
