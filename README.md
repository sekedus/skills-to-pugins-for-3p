# Skills → Plugins for Claude Desktop 3P

Convert any [Agent Skills](https://agentskills.io) to [plugins](https://claude.com/docs/cowork/3p/extensions#plugin-structure) so they actually work on Claude Desktop 3P (third-party) mode.

<br/>

## The Problem

> Upload skills: **Settings → Developer → Customize → Skills → + → Create Skill → Upload a Skill**

Claude Desktop 3P skill upload feature does work – it registers the skill name and description in your skills list.

But it has a bug: **only `SKILL.md` is saved from the upload**, any supporting files (`LICENSE.txt`, `references/`, etc.) are silently dropped.

This means **any skill** with scripts, references, agents, or assets is broken after upload.

According to the [official 3P extensions docs](https://claude.com/docs/cowork/3p/extensions):

- Only organization plugins (from `org-plugins/`) show in the browse directory/marketplace.
- **Skills** are primarily distributed/bundled **inside plugins**.
- **Connectors** are managed separately via [mcpServers](https://modelcontextprotocol.io/docs/develop/connect-local-servers#installing-the-filesystem-server) or `managedMcpServers`.

<br/>

## The Workaround

Convert skills to plugins and place them in the system plugin directory:

- macOS: `/Library/Application Support/Claude/org-plugins/`
- Windows: `C:\Program Files\Claude\org-plugins\`

> ⚠️ This is an admin-only directory. You'll need administrator privileges to write to it.

<br/>

## What This Repo Does

This repo provides three things:

| # | Tool | What it does |
|---|------|-------------|
| 1 | **README** (this file) | Explains the problem and the workaround |
| 2 | **Converter Tool** ([`converter/index.html`](./converter/index.html)) | An offline webpage that validates a skill zip, converts it to plugin format, and lets you download the result |
| 3 | **Sync Script** ([`scripts/`](./scripts/)) | A Node.js script + GitHub Actions workflow that automatically fetches skills from upstream repos, converts them, and commits updates |

<br/>

## Quick Start: Manual Conversion

### Option A – Use the Converter Tool

1. Open [`converter/index.html`](./converter/index.html) in your browser
2. Upload a skill zip file (or a folder of skills)
3. The tool validates the skill spec, converts to plugin format
4. Download the converted plugin zip
5. Extract to `C:\Program Files\Claude\org-plugins\`

#### Running the Tests

The converter includes a self-contained test suite in [`converter/test/`](./converter/test/) that validates the discovery and validation logic against a set of sample zip files.

```bash
cd converter/test
npm install  # first time only
npm run test -- "path/to/test/zips"
```

The test suite replicates the core validation logic from [`converter/script.js`](./converter/script.js), so passing tests means the converter will produce the same results for those zips.

<br/>

### Option B – Use the Sync Script

```bash
node scripts/sync-plugins.js
```

This fetches skills from configured repos ([`scripts/sync-config.json`](./scripts/sync-config.json)), converts them, and saves to [`plugins/`](./plugins/).

<br/>

## Plugin Structure Reference

A skill directory:
```
my-skill/
├── SKILL.md          # Required: metadata + instructions
├── scripts/          # Optional: executable code
├── references/       # Optional: documentation
├── assets/           # Optional: templates, resources
└── ...
```

Gets converted to a plugin:
```
org-plugins/
└── my-skill/
    ├── .claude-plugin/
    │   └── plugin.json      # Plugin manifest (name, description, version)
    └── skills/
        └── my-skill/
            ├── SKILL.md
            ├── scripts/
            ├── references/
            ├── assets/
            └── ...
```

See the [official plugin structure docs](https://claude.com/docs/cowork/3p/extensions#plugin-structure) for full details.

### `.claude-plugin/plugin.json`

```json
{
  "id": "my-skill",
  "name": "my-skill",
  "description": "Description from SKILL.md frontmatter",
  "author": { "name": "your name" }
}
```

<br/>

## Available Converted Skills

Converted plugins are in `plugins/`. Each subdirectory is a ready-to-use plugin.

| Plugin | Source | Description |
|--------|--------|-------------|
| (see [`plugins/`](./plugins/) directory for current list) | | |

<br/>

## Running the Sync Script

### Locally

```bash
cd scripts
node sync-plugins.js             # Normal sync — only converts changed skills
node sync-plugins.js --force     # Re-convert everything even if unchanged
node sync-plugins.js --dry-run   # Show what would change without writing anything
node sync-plugins.js --config ./my-config.json  # Use a custom config file
```

The sync script automatically detects changes by computing a hash of each converted plugin. If a skill hasn't changed since the last run, it's skipped. Use `--force` to override this.

### GitHub Actions

This repo includes a [GitHub Actions workflow](.github/workflows/sync-plugins.yml) that:

- Runs daily at 06:00 UTC
- Can be triggered manually via **Actions → Convert Skills to Plugins → Run workflow** (with optional `force` flag)
- Checks upstream repos for changes
- Converts new/changed skills to plugins
- Auto-commits and pushes updates

<br/>

## References

- [Claude Desktop 3P Plugin Structure](https://claude.com/docs/cowork/3p/extensions)
- [Agent Skills Specification](https://agentskills.io/specification)
- [Anthropic Skills](https://github.com/anthropics/skills)
- [Matt Pocock Skills](https://github.com/mattpocock/skills)
