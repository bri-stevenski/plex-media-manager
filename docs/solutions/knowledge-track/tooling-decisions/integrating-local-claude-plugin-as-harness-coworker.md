---
module: config
tags: [plugin-integration, co-worker, harness-config, claude-code-plugin, multi-project]
problem_type: multi-project-integration
last_updated: '2026-05-12'
track: knowledge-track
category: tooling-decisions
---

# Integrating a Local Claude Code Plugin as a Harness Co-worker

## Context

When a sibling project ships a `.claude-plugin/` directory (with `plugin.json`, `marketplace.json`, and agent definition files), it can be surfaced in a separate harness project as both a **Claude Code plugin** (so its agents appear as co-workers in the UI) and a **harness co-worker** (so harness can dispatch work to it).

The two wiring points are independent:

| Surface | Config file | What it enables |
|---|---|---|
| Claude Code plugin | `.claude/settings.json` | Agents load as personas in the session |
| Harness co-worker | `harness.config.json` | Harness dispatch, roadmap, and skill routing |

This came up when integrating `oracle-test-ai-agent` (four specialist test personas) into `plex-media-manager`. Commit `f1ce3e0`.

## Guidance

### 1. Claude Code plugin — `.claude/settings.json`

Register the sibling repo as a marketplace via `extraKnownMarketplaces`, then enable the plugin with `enabledPlugins`. The `"directory"` source type reads `.claude-plugin/marketplace.json` from the given path.

```json
{
  "extraKnownMarketplaces": {
    "<marketplace-id>": {
      "source": {
        "source": "directory",
        "path": "/absolute/path/to/sibling-project"
      }
    }
  },
  "enabledPlugins": {
    "<plugin-name>@<marketplace-id>": true
  }
}
```

- `<marketplace-id>` is an arbitrary local key (e.g. `oracle-local`).
- `<plugin-name>` must match the `name` field in the sibling's `.claude-plugin/plugin.json`.
- Do **not** use the top-level `plugins` key — it is not in the settings schema and will fail validation.

### 2. Harness co-worker — `harness.config.json`

Add `agentsMapPath`, `docsDir`, and a `coworkers` array. `agentsMapPath` wires the project's own `AGENTS.md`; `coworkers` references the sibling.

```json
{
  "agentsMapPath": "./AGENTS.md",
  "docsDir": "./docs",
  "coworkers": [
    {
      "name": "<coworker-name>",
      "path": "/absolute/path/to/sibling-project",
      "agentsMapPath": "./AGENTS.md",
      "description": "One-line description of what it does.",
      "personas": ["persona-a", "persona-b"]
    }
  ]
}
```

- `personas` lists the agent file stems from the sibling's `.claude-plugin/agents/` directory.
- Use absolute paths so the config works regardless of which directory harness is invoked from.

### 3. Verification

After both changes, restart Claude Code. The sibling agents should appear in the agents panel. Harness dispatch can reference them by name.

## Applicability

Use this pattern when:
- A sibling project has a complete `.claude-plugin/` structure (plugin.json + marketplace.json + agents).
- You want its specialist agents available as co-workers without publishing to a remote registry.
- The two repos live on the same machine (CI/CD environments require a remote source instead).

Do **not** use this pattern when:
- The sibling project is not on the local filesystem — use a `github` or `git` source in `extraKnownMarketplaces` instead.
- The plugin is already published to a known marketplace — just use `enabledPlugins` directly without `extraKnownMarketplaces`.

## References

- Commit: `f1ce3e0` — Add oracle as harness co-worker and Claude Code plugin
- Claude Code settings schema: `enabledPlugins`, `extraKnownMarketplaces` fields
- Oracle plugin: `/Users/bs/Github/oracle-test-ai-agent/.claude-plugin/`
