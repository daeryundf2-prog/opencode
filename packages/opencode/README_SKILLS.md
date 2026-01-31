# OpenCode

OpenCode is a powerful AI coding agent platform that integrates with your existing workflow.

## Skills Management (New)

OpenCode now supports managing skills with strict version pinning and ISO 17025 compliant audit logging.

### Commands

#### Install a Skill

Install a skill from a Git repository (must be pinned to a commit SHA):

```bash
opencode skills install git+https://github.com/org/repo.git --commit <sha>
```

Install a skill from an archive (tar.gz/zip) (must be pinned with SHA256 integrity):

```bash
opencode skills install https://example.com/skill.tar.gz --integrity <sha256>
```

**Note:** Installing without pinning (`--commit` or `--integrity`) will trigger a security warning.

#### List Installed Skills

View all installed skills and their pinned versions:

```bash
opencode skills list
```

#### Search Skills

Search for available skills (matches name or description):

```bash
opencode skills search "react"
```

#### Remove a Skill

Remove an installed skill and update the lockfile:

```bash
opencode skills remove <skill-name>
```

### Audit Logging

All skill operations (install, remove) are logged to `.opencode/skills_audit.jsonl` with:
- Timestamp (UTC)
- Actor ID
- Action type
- Entity details
- Hash verification status

This ensures full traceability of the skill supply chain.
