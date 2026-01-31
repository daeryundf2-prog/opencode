import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { Audit } from "../../src/skill/audit"
import fs from "fs/promises"
import path from "path"

describe("Audit", () => {
  const auditPath = Audit.auditPath()

  beforeEach(async () => {
    // Ensure clean state
    try {
      await fs.unlink(auditPath)
    } catch {}
  })

  afterEach(async () => {
    // Cleanup
    try {
      await fs.unlink(auditPath)
    } catch {}
  })

  describe("auditPath", () => {
    it("returns path under data directory", () => {
      expect(auditPath).toContain("skills")
      expect(auditPath).toContain("audit.jsonl")
    })
  })

  describe("canonical", () => {
    it("sorts keys alphabetically", () => {
      const result = Audit.canonical({ z: 1, a: 2, m: 3 })
      expect(result).toBe('{"a":2,"m":3,"z":1}')
    })

    it("handles nested objects", () => {
      const result = Audit.canonical({ b: { z: 1, a: 2 }, a: 1 })
      expect(result).toBe('{"a":1,"b":{"a":2,"z":1}}')
    })

    it("preserves arrays", () => {
      const result = Audit.canonical({ items: [3, 1, 2] })
      expect(result).toBe('{"items":[3,1,2]}')
    })

    it("produces no whitespace", () => {
      const result = Audit.canonical({ a: 1, b: 2 })
      expect(result).not.toContain(" ")
      expect(result).not.toContain("\n")
    })
  })

  describe("sha256", () => {
    it("computes correct SHA256 hash", () => {
      const hash = Audit.sha256("test")
      expect(hash).toBe("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08")
    })

    it("produces 64 character hex string", () => {
      const hash = Audit.sha256("anything")
      expect(hash).toHaveLength(64)
      expect(hash).toMatch(/^[0-9a-f]+$/)
    })
  })

  describe("lastHash", () => {
    it("returns genesis when no audit log exists", async () => {
      const hash = await Audit.lastHash()
      expect(hash).toBe("genesis")
    })

    it("returns genesis for empty file", async () => {
      await fs.mkdir(path.dirname(auditPath), { recursive: true })
      await fs.writeFile(auditPath, "")
      
      const hash = await Audit.lastHash()
      expect(hash).toBe("genesis")
    })

    it("returns last event hash", async () => {
      const event = await Audit.append({
        timestamp: new Date().toISOString(),
        actor: "test",
        operation: "INSTALL",
        target: "test-skill",
        result: "SUCCESS"
      })

      const hash = await Audit.lastHash()
      expect(hash).toBe(event.hash)
    })
  })

  describe("append", () => {
    it("first event has genesis prev_hash", async () => {
      const event = await Audit.append({
        timestamp: new Date().toISOString(),
        actor: "test",
        operation: "INSTALL",
        target: "test-skill",
        result: "SUCCESS"
      })
      
      expect(event.prev_hash).toBe("genesis")
    })

    it("chains events correctly", async () => {
      const first = await Audit.append({
        timestamp: new Date().toISOString(),
        actor: "test",
        operation: "INSTALL",
        target: "skill-1",
        result: "SUCCESS"
      })
      
      const second = await Audit.append({
        timestamp: new Date().toISOString(),
        actor: "test",
        operation: "INSTALL",
        target: "skill-2",
        result: "SUCCESS"
      })
      
      expect(second.prev_hash).toBe(first.hash)
    })

    it("includes hash in event", async () => {
      const event = await Audit.append({
        timestamp: new Date().toISOString(),
        actor: "test",
        operation: "INSTALL",
        target: "test-skill",
        result: "SUCCESS"
      })
      
      expect(event.hash).toBeDefined()
      expect(event.hash).toHaveLength(64)
    })

    it("creates parent directories", async () => {
      await Audit.append({
        timestamp: new Date().toISOString(),
        actor: "test",
        operation: "INSTALL",
        target: "test-skill",
        result: "SUCCESS"
      })

      const stat = await fs.stat(path.dirname(auditPath))
      expect(stat.isDirectory()).toBe(true)
    })

    it("writes event to file", async () => {
      await Audit.append({
        timestamp: new Date().toISOString(),
        actor: "test",
        operation: "INSTALL",
        target: "test-skill",
        result: "SUCCESS"
      })

      const content = await fs.readFile(auditPath, "utf-8")
      expect(content).toContain("test-skill")
      expect(content).toContain("INSTALL")
    })

    it("appends multiple events on separate lines", async () => {
      await Audit.append({
        timestamp: new Date().toISOString(),
        actor: "test",
        operation: "INSTALL",
        target: "skill-1",
        result: "SUCCESS"
      })
      
      await Audit.append({
        timestamp: new Date().toISOString(),
        actor: "test",
        operation: "REMOVE",
        target: "skill-2",
        result: "SUCCESS"
      })

      const content = await fs.readFile(auditPath, "utf-8")
      const lines = content.trim().split("\n")
      expect(lines).toHaveLength(2)
    })

    it("includes optional details", async () => {
      const event = await Audit.append({
        timestamp: new Date().toISOString(),
        actor: "test",
        operation: "INSTALL",
        target: "test-skill",
        result: "SUCCESS",
        details: { source: "https://github.com/org/repo", commit: "abc123" }
      })

      expect(event.details).toEqual({ source: "https://github.com/org/repo", commit: "abc123" })
    })
  })

  describe("verify", () => {
    it("returns valid for empty log", async () => {
      const result = await Audit.verify()
      expect(result.valid).toBe(true)
      expect(result.eventCount).toBe(0)
      expect(result.errors).toEqual([])
    })

    it("returns valid for single event", async () => {
      await Audit.append({
        timestamp: new Date().toISOString(),
        actor: "test",
        operation: "INSTALL",
        target: "skill-1",
        result: "SUCCESS"
      })

      const result = await Audit.verify()
      expect(result.valid).toBe(true)
      expect(result.eventCount).toBe(1)
    })

    it("returns valid for multiple chained events", async () => {
      await Audit.append({
        timestamp: new Date().toISOString(),
        actor: "test",
        operation: "INSTALL",
        target: "skill-1",
        result: "SUCCESS"
      })
      
      await Audit.append({
        timestamp: new Date().toISOString(),
        actor: "test",
        operation: "UPDATE",
        target: "skill-1",
        result: "SUCCESS"
      })
      
      await Audit.append({
        timestamp: new Date().toISOString(),
        actor: "test",
        operation: "REMOVE",
        target: "skill-1",
        result: "SUCCESS"
      })

      const result = await Audit.verify()
      expect(result.valid).toBe(true)
      expect(result.eventCount).toBe(3)
    })

    it("detects tampered hash", async () => {
      await Audit.append({
        timestamp: new Date().toISOString(),
        actor: "test",
        operation: "INSTALL",
        target: "skill-1",
        result: "SUCCESS"
      })

      // Tamper with the file
      const content = await fs.readFile(auditPath, "utf-8")
      const event = JSON.parse(content)
      event.hash = "0000000000000000000000000000000000000000000000000000000000000000"
      await fs.writeFile(auditPath, JSON.stringify(event))

      const result = await Audit.verify()
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain("hash mismatch")
    })

    it("detects broken chain", async () => {
      const first = await Audit.append({
        timestamp: new Date().toISOString(),
        actor: "test",
        operation: "INSTALL",
        target: "skill-1",
        result: "SUCCESS"
      })

      // Manually write second event with wrong prev_hash
      const badEvent = {
        timestamp: new Date().toISOString(),
        actor: "test",
        operation: "INSTALL",
        target: "skill-2",
        result: "SUCCESS",
        prev_hash: "wrong_hash",
        hash: "fake"
      }
      await fs.appendFile(auditPath, JSON.stringify(badEvent) + "\n")

      const result = await Audit.verify()
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes("prev_hash mismatch"))).toBe(true)
    })
  })

  describe("readAll", () => {
    it("returns empty array when no log exists", async () => {
      const events = await Audit.readAll()
      expect(events).toEqual([])
    })

    it("returns all events", async () => {
      await Audit.append({
        timestamp: new Date().toISOString(),
        actor: "test",
        operation: "INSTALL",
        target: "skill-1",
        result: "SUCCESS"
      })
      
      await Audit.append({
        timestamp: new Date().toISOString(),
        actor: "test",
        operation: "REMOVE",
        target: "skill-1",
        result: "SUCCESS"
      })

      const events = await Audit.readAll()
      expect(events).toHaveLength(2)
      expect(events[0].target).toBe("skill-1")
      expect(events[0].operation).toBe("INSTALL")
      expect(events[1].operation).toBe("REMOVE")
    })
  })

  describe("computeHash", () => {
    it("produces deterministic hash", () => {
      const event = {
        timestamp: "2024-01-01T00:00:00.000Z",
        actor: "test",
        operation: "INSTALL" as const,
        target: "skill-1",
        result: "SUCCESS" as const,
        prev_hash: "genesis"
      }

      const hash1 = Audit.computeHash(event, "genesis")
      const hash2 = Audit.computeHash(event, "genesis")
      expect(hash1).toBe(hash2)
    })

    it("changes with different prev_hash", () => {
      const event = {
        timestamp: "2024-01-01T00:00:00.000Z",
        actor: "test",
        operation: "INSTALL" as const,
        target: "skill-1",
        result: "SUCCESS" as const,
        prev_hash: "genesis"
      }

      const hash1 = Audit.computeHash(event, "genesis")
      const hash2 = Audit.computeHash({ ...event, prev_hash: "other" }, "other")
      expect(hash1).not.toBe(hash2)
    })
  })
})
