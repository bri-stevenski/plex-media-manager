---
project: plex-media-manager
version: 1
last_synced: 2026-05-06
last_manual_edit: 2026-05-06
---

# Project Roadmap

## Phase 1: AI-First Core Implementation

### Standardize Architecture & Layers
- **Status:** planned
- **Summary:** Refactor existing layers to strictly follow Harness patterns and ensure AI readability.
- **Spec:** none
- **Blockers:** none
- **Plan:** none

### Unified Media Processor
- **Status:** planned
- **Summary:** Implement a core engine that handles directory recursion and multi-type media processing (TV, Movies, Music, Audiobooks, Podcasts).
- **Spec:** none
- **Blockers:** none
- **Plan:** none

### TMDb Enhanced Integration
- **Status:** planned
- **Summary:** Enhance metadata lookup to include TMDb ID in the renaming pattern for improved Plex matching.
- **Spec:** none
- **Blockers:** none
- **Plan:** none

### Conformity to Naming Standards
- **Status:** planned
- **Summary:** Align renaming logic with conventions defined in `/docs/resources` for all supported media types.
- **Spec:** none
- **Blockers:** none
- **Plan:** none

### Atomic File Staging & Delivery
- **Status:** planned
- **Summary:** Implement a move-to-completed pipeline that stages files before moving them to the final `upload` directory.
- **Spec:** none
- **Blockers:** none
- **Plan:** none

## Phase 2: Desktop Interface

### Cross-Platform Desktop UI
- **Status:** backlog
- **Summary:** Develop a desktop interface for monitoring and managing the media pipeline, building on the CLI core.
- **Spec:** none
- **Blockers:** none
- **Plan:** none

## Phase 3: Server Integration & Deployment

### NAS & Docker Integration
- **Status:** backlog
- **Summary:** Develop connector for the NAS server hosting the Plex Docker container for automated media delivery.
- **Spec:** none
- **Blockers:** none
- **Plan:** none

### Cloud Sync/Remote Upload
- **Status:** backlog
- **Summary:** Support for remote media management and uploading to cloud-hosted Plex instances.
- **Spec:** none
- **Blockers:** none
- **Plan:** none
