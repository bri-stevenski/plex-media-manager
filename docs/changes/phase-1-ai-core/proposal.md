---
title: "Phase 1: AI-First Core Implementation"
status: approved
created: 2026-05-06
---

# Phase 1: AI-First Core Implementation

This phase focuses on establishing a robust, AI-readable foundation for the Plex Media Manager. We will standardize the architecture, implement a unified media processing engine, and ensure all naming and metadata operations follow canonical standards.

## Objectives
- Enforce strict Harness layering for high AI predictability.
- Implement a recursive directory processor supporting multiple media types.
- Embed TMDb IDs in filenames for 100% Plex matching accuracy.
- Centralize all naming logic to follow `/docs/resources` guidelines.
- Ensure atomic file moves to prevent data loss.

## Implementation Order

### Phase 1: Architecture Standardization
Refactor existing `src/` structure to ensure strict layer boundaries and eliminate any "leaky" abstractions. Ensure `harness check-deps` passes with zero warnings.
<!-- complexity: low -->

### Phase 2: Unified Media Processor
Implement the core engine in `src/services/processor.ts` that handles directory recursion and delegates to specific media handlers.
<!-- complexity: medium -->

### Phase 3: Metadata & Naming Enhancement
Update `src/repository/tmdb.ts` and `src/services/formatter.ts` to include TMDb IDs and follow the Plex-compliant naming conventions.
<!-- complexity: medium -->

### Phase 4: Atomic Staging & Delivery
Implement the staging pipeline in `src/repository/fs.ts` to move files through a `processing/` state before final organization.
<!-- complexity: medium -->

### Phase 5: Verification & Integration
Comprehensive end-to-end testing of the renaming pipeline for all media types.
<!-- complexity: medium -->
