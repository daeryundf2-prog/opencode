import z from "zod"
import { SkillPolicy } from "./schema"
import { Global } from "../global"
import fs from "fs/promises"
import { exists } from "fs/promises"
import path from "path"
import { Log } from "../util/log"

const log = Log.create({ service: "skill:policy" })

/**
 * Policy enforcement for skill installation
 * Location: ${Global.Path.data}/skills/policy.json
 * 
 * Matching rules:
 * - skillId: exact match on skill name
 * - sourceUrlPrefix: prefix match on source URL
 * 
 * Precedence: deny > allow
 * If allowlist is non-empty, anything not matching allow is denied
 */
export namespace Policy {
  const DEFAULT: SkillPolicy = {
    version: 1,
    allowlist: [],
    denylist: []
  }

  export function policyPath(): string {
    return path.join(Global.Path.data, "skills", "policy.json")
  }

  export async function load(): Promise<SkillPolicy> {
    const p = policyPath()
    if (!(await exists(p))) {
      return DEFAULT
    }
    try {
      const raw = await fs.readFile(p, "utf-8")
      return SkillPolicy.parse(JSON.parse(raw))
    } catch (e) {
      log.warn("failed to load policy, using default", { error: e })
      return DEFAULT
    }
  }

  export async function save(policy: SkillPolicy): Promise<void> {
    const p = policyPath()
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, JSON.stringify(policy, null, 2))
  }

  export type CheckResult = 
    | { allowed: true }
    | { allowed: false; reason: string; code: "POLICY_DENY" }

  /**
   * Check if skill installation is allowed by policy
   * 
   * @param skillId - The skill name/id
   * @param sourceUrl - The source URL (git+https://... or https://...)
   * @param policy - Optional pre-loaded policy
   */
  export async function check(
    skillId: string,
    sourceUrl: string,
    policy?: SkillPolicy
  ): Promise<CheckResult> {
    const p = policy ?? await load()

    // Check denylist first (deny > allow)
    for (const pattern of p.denylist) {
      if (matches(pattern, skillId, sourceUrl)) {
        log.info("policy deny", { skillId, sourceUrl, pattern })
        return {
          allowed: false,
          reason: `Denied by policy pattern: ${pattern}`,
          code: "POLICY_DENY"
        }
      }
    }

    // If allowlist is non-empty, require match
    if (p.allowlist.length > 0) {
      const allowed = p.allowlist.some(pattern => matches(pattern, skillId, sourceUrl))
      if (!allowed) {
        log.info("policy deny (not in allowlist)", { skillId, sourceUrl })
        return {
          allowed: false,
          reason: "Not in policy allowlist",
          code: "POLICY_DENY"
        }
      }
    }

    return { allowed: true }
  }

  /**
   * Pattern matching:
   * - If pattern contains "://" -> prefix match on sourceUrl
   * - Otherwise -> exact match on skillId
   */
  function matches(pattern: string, skillId: string, sourceUrl: string): boolean {
    if (pattern.includes("://")) {
      // URL prefix match
      return sourceUrl.startsWith(pattern)
    }
    // Exact skill ID match
    return skillId === pattern
  }
}
