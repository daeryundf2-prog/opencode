import z from "zod"

/**
 * Source of a skill:
 * - Git: git+https://github.com/org/repo.git#commit
 * - Archive: https://example.com/skill.tar.gz#sha256=...
 * - Local: local:/path/to/skill
 */
export const SkillSource = z.union([
  z.string().regex(/^git\+https?:\/\//).describe("Git URL (git+https://...)"),
  z.string().url().describe("Archive URL (https://...)"),
  z.string().regex(/^local:/).describe("Local path (local:...)")
])

export type SkillSource = z.infer<typeof SkillSource>

/**
 * opencode.skills.json - User-defined manifest
 */
export const SkillManifest = z.object({
  schema_version: z.literal(1).default(1),
  skills: z.record(z.string(), SkillSource).default({})
})

export type SkillManifest = z.infer<typeof SkillManifest>

/**
 * opencode.skills.lock - Pinning details
 */
export const SkillLockEntry = z.object({
  source: SkillSource,
  commit: z.string().optional().describe("Git commit SHA"),
  integrity: z.string().optional().describe("Archive SHA256"),
  version: z.string().optional().describe("Skill version if available"),
  installedAt: z.string().datetime().describe("ISO 8601 timestamp"),
  installedBy: z.string().optional().describe("User or Agent ID")
})

export type SkillLockEntry = z.infer<typeof SkillLockEntry>

export const SkillLock = z.object({
  version: z.literal(1),
  skills: z.record(z.string(), SkillLockEntry).default({})
})

export type SkillLock = z.infer<typeof SkillLock>

/**
 * Audit Event Structure for ISO 17025 Compliance
 * This structure corresponds to what Lumos Engine expects or ingests.
 */
export const SkillAuditEvent = z.object({
  ts_utc: z.string().datetime(),
  actor_id: z.string(),
  action: z.enum([
    "SKILL_INSTALL_INIT", 
    "SKILL_INSTALL_SUCCESS", 
    "SKILL_INSTALL_FAILED",
    "SKILL_REMOVE",
    "SKILL_UPDATE"
  ]),
  entity_type: z.literal("skill"),
  entity_id: z.string().describe("Skill Name"),
  payload: z.object({
    source: SkillSource,
    commit: z.string().optional(),
    integrity: z.string().optional(),
    lock_before: SkillLockEntry.optional(),
    lock_after: SkillLockEntry.optional(),
    error: z.string().optional()
  })
})

export type SkillAuditEvent = z.infer<typeof SkillAuditEvent>

/**
 * Policy for skill installation (allowlist/denylist)
 * Persistence: ${Global.Path.data}/skills/policy.json
 */
export const SkillPolicy = z.object({
  version: z.literal(1),
  allowlist: z.array(z.string()).default([]),
  denylist: z.array(z.string()).default([])
})

export type SkillPolicy = z.infer<typeof SkillPolicy>
