---
project: plex-media-manager
version: 1
last_synced: 2026-05-06
last_manual_edit: 2026-05-06T17:28:43.206Z
---

# Roadmap

## Phase 1: AI-First Core Implementation

### Standardize Architecture & Layers

- **Status:** done
- **Spec:** none
- **Summary:** Refactor existing layers to strictly follow Harness patterns and ensure AI readability.
- **Blockers:** —
- **Plan:** —

### Unified Media Processor

- **Status:** planned
- **Spec:** none
- **Summary:** Implement a core engine that handles directory recursion and multi-type media processing (TV, Movies, Music, Audiobooks, Podcasts).
- **Blockers:** —
- **Plan:** —

### TMDb Enhanced Integration

- **Status:** planned
- **Spec:** none
- **Summary:** Enhance metadata lookup to include TMDb ID in the renaming pattern for improved Plex matching.
- **Blockers:** —
- **Plan:** —

### Conformity to Naming Standards

- **Status:** planned
- **Spec:** none
- **Summary:** Align renaming logic with conventions defined in `/docs/resources` for all supported media types.
- **Blockers:** —
- **Plan:** —

### Atomic File Staging & Delivery

- **Status:** planned
- **Spec:** none
- **Summary:** Implement a move-to-completed pipeline that stages files before moving them to the final `upload` directory.
- **Blockers:** —
- **Plan:** —

## Phase 2: Desktop Interface

### Cross-Platform Desktop UI

- **Status:** backlog
- **Spec:** none
- **Summary:** Develop a desktop interface for monitoring and managing the media pipeline, building on the CLI core.
- **Blockers:** —
- **Plan:** —

## Phase 3: Server Integration & Deployment

### NAS & Docker Integration

- **Status:** backlog
- **Spec:** none
- **Summary:** Develop connector for the NAS server hosting the Plex Docker container for automated media delivery.
- **Blockers:** —
- **Plan:** —

### Cloud Sync/Remote Upload

- **Status:** backlog
- **Spec:** none
- **Summary:** Support for remote media management and uploading to cloud-hosted Plex instances.
- **Blockers:** —
- **Plan:** —
