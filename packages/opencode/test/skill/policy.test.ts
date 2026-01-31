import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { Policy } from "../../src/skill/policy"
import fs from "fs/promises"
import path from "path"

describe("Policy", () => {
  const policyPath = Policy.policyPath()

  beforeEach(async () => {
    // Ensure clean state
    try {
      await fs.unlink(policyPath)
    } catch {}
  })

  afterEach(async () => {
    // Cleanup
    try {
      await fs.unlink(policyPath)
    } catch {}
  })

  describe("policyPath", () => {
    it("returns path under data directory", () => {
      expect(policyPath).toContain("skills")
      expect(policyPath).toContain("policy.json")
    })
  })

  describe("load", () => {
    it("returns default policy when file does not exist", async () => {
      const policy = await Policy.load()
      expect(policy.version).toBe(1)
      expect(policy.allowlist).toEqual([])
      expect(policy.denylist).toEqual([])
    })

    it("loads saved policy correctly", async () => {
      await Policy.save({
        version: 1,
        allowlist: ["allowed-skill"],
        denylist: ["blocked-skill"]
      })

      const policy = await Policy.load()
      expect(policy.allowlist).toEqual(["allowed-skill"])
      expect(policy.denylist).toEqual(["blocked-skill"])
    })
  })

  describe("save", () => {
    it("creates parent directories if needed", async () => {
      const dirPath = path.dirname(policyPath)
      
      await Policy.save({
        version: 1,
        allowlist: [],
        denylist: ["test"]
      })

      const stat = await fs.stat(dirPath)
      expect(stat.isDirectory()).toBe(true)
    })

    it("persists policy to file", async () => {
      await Policy.save({
        version: 1,
        allowlist: ["a"],
        denylist: ["b"]
      })

      const content = await fs.readFile(policyPath, "utf-8")
      const parsed = JSON.parse(content)
      expect(parsed.allowlist).toEqual(["a"])
      expect(parsed.denylist).toEqual(["b"])
    })
  })

  describe("check", () => {
    it("allows by default when no policy exists", async () => {
      const result = await Policy.check("my-skill", "https://github.com/org/repo")
      expect(result.allowed).toBe(true)
    })

    it("allows when denylist and allowlist are both empty", async () => {
      await Policy.save({ version: 1, allowlist: [], denylist: [] })
      const result = await Policy.check("any-skill", "https://github.com/org/repo")
      expect(result.allowed).toBe(true)
    })

    describe("denylist", () => {
      it("denies skill by exact name match", async () => {
        await Policy.save({ version: 1, allowlist: [], denylist: ["blocked-skill"] })
        
        const result = await Policy.check("blocked-skill", "https://github.com/org/repo")
        expect(result.allowed).toBe(false)
        if (!result.allowed) {
          expect(result.code).toBe("POLICY_DENY")
          expect(result.reason).toContain("blocked-skill")
        }
      })

      it("allows skill not in denylist", async () => {
        await Policy.save({ version: 1, allowlist: [], denylist: ["blocked-skill"] })
        
        const result = await Policy.check("other-skill", "https://github.com/org/repo")
        expect(result.allowed).toBe(true)
      })

      it("denies by URL prefix match", async () => {
        await Policy.save({ version: 1, allowlist: [], denylist: ["https://evil.com/"] })
        
        const result = await Policy.check("any-skill", "https://evil.com/malware.tar.gz")
        expect(result.allowed).toBe(false)
        if (!result.allowed) {
          expect(result.code).toBe("POLICY_DENY")
        }
      })

      it("allows different URL not matching prefix", async () => {
        await Policy.save({ version: 1, allowlist: [], denylist: ["https://evil.com/"] })
        
        const result = await Policy.check("any-skill", "https://github.com/org/repo")
        expect(result.allowed).toBe(true)
      })
    })

    describe("allowlist", () => {
      it("denies skill not in allowlist when allowlist is non-empty", async () => {
        await Policy.save({ version: 1, allowlist: ["allowed-skill"], denylist: [] })
        
        const result = await Policy.check("other-skill", "https://github.com/org/repo")
        expect(result.allowed).toBe(false)
        if (!result.allowed) {
          expect(result.code).toBe("POLICY_DENY")
          expect(result.reason).toContain("allowlist")
        }
      })

      it("allows skill in allowlist", async () => {
        await Policy.save({ version: 1, allowlist: ["allowed-skill"], denylist: [] })
        
        const result = await Policy.check("allowed-skill", "https://github.com/org/repo")
        expect(result.allowed).toBe(true)
      })

      it("allows by URL prefix in allowlist", async () => {
        await Policy.save({ version: 1, allowlist: ["https://trusted.org/"], denylist: [] })
        
        const result = await Policy.check("any-skill", "https://trusted.org/skill.tar.gz")
        expect(result.allowed).toBe(true)
      })
    })

    describe("precedence", () => {
      it("denylist takes precedence over allowlist", async () => {
        await Policy.save({
          version: 1,
          allowlist: ["skill-a"],
          denylist: ["skill-a"]
        })
        
        const result = await Policy.check("skill-a", "https://github.com/org/repo")
        expect(result.allowed).toBe(false)
        if (!result.allowed) {
          expect(result.code).toBe("POLICY_DENY")
        }
      })
    })

    it("accepts pre-loaded policy parameter", async () => {
      // Don't save to file, pass directly
      const policy = { version: 1 as const, allowlist: [] as string[], denylist: ["blocked"] }
      
      const result = await Policy.check("blocked", "https://github.com/org/repo", policy)
      expect(result.allowed).toBe(false)
    })
  })
})
