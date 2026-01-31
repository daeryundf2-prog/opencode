import { createHash } from "crypto"
import fs from "fs/promises"
import { exists } from "fs/promises"
import path from "path"
import { Global } from "../global"
import { Log } from "../util/log"
import z from "zod"

const log = Log.create({ service: "skill:audit" })

/**
 * Hash-chained audit log for ISO 17025 compliance
 * Location: ${Global.Path.data}/skills/audit.jsonl
 * 
 * Each event contains:
 * - timestamp, actor, operation, target, result
 * - prev_hash: SHA256 of previous event (or "genesis")
 * - hash: SHA256(prev_hash + "\n" + canonical_event_json + "\n")
 */
export namespace Audit {
  export const Event = z.object({
    timestamp: z.string().datetime(),
    actor: z.string(),
    operation: z.enum([
      "INSTALL",
      "UPDATE",
      "REMOVE",
      "POLICY_DENY"
    ]),
    target: z.string(),
    result: z.enum(["SUCCESS", "FAILURE"]),
    details: z.record(z.string(), z.unknown()).optional(),
    prev_hash: z.string(),
    hash: z.string()
  })

  export type Event = z.infer<typeof Event>

  export type NewEvent = Omit<Event, "prev_hash" | "hash">

  export function auditPath(): string {
    return path.join(Global.Path.data, "skills", "audit.jsonl")
  }

  /**
   * RFC8785-like canonical JSON serialization
   * - Keys sorted alphabetically
   * - No whitespace
   * - Unicode escaping for control characters
   */
  export function canonical(obj: unknown): string {
    return JSON.stringify(obj, (_, v) => {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        return Object.keys(v).sort().reduce((sorted: Record<string, unknown>, key) => {
          sorted[key] = (v as Record<string, unknown>)[key]
          return sorted
        }, {})
      }
      return v
    })
  }

  export function sha256(data: string): string {
    return createHash("sha256").update(data).digest("hex")
  }

  /**
   * Compute hash for an event
   * hash = sha256(prev_hash + "\n" + canonical_event_without_hash + "\n")
   */
  export function computeHash(event: Omit<Event, "hash">, prevHash: string): string {
    const eventWithPrevHash = { ...event, prev_hash: prevHash }
    const canonicalJson = canonical(eventWithPrevHash)
    return sha256(prevHash + "\n" + canonicalJson + "\n")
  }

  /**
   * Get the hash of the last event in the audit log
   * Returns "genesis" if log is empty or doesn't exist
   */
  export async function lastHash(): Promise<string> {
    const p = auditPath()
    if (!(await exists(p))) {
      return "genesis"
    }

    try {
      const content = await fs.readFile(p, "utf-8")
      const lines = content.trim().split("\n").filter(Boolean)
      if (lines.length === 0) {
        return "genesis"
      }

      const lastLine = lines[lines.length - 1]
      const lastEvent = JSON.parse(lastLine) as Event
      return lastEvent.hash
    } catch (e) {
      log.warn("failed to read last hash, using genesis", { error: e })
      return "genesis"
    }
  }

  /**
   * Append a new event to the audit log with hash chain
   */
  export async function append(event: NewEvent): Promise<Event> {
    const p = auditPath()
    await fs.mkdir(path.dirname(p), { recursive: true })

    const prevHash = await lastHash()
    const hash = computeHash({ ...event, prev_hash: prevHash }, prevHash)
    
    const fullEvent: Event = {
      ...event,
      prev_hash: prevHash,
      hash
    }

    await fs.appendFile(p, canonical(fullEvent) + "\n")
    log.info("audit event appended", { operation: event.operation, target: event.target })

    return fullEvent
  }

  /**
   * Verify the integrity of the audit chain
   * Returns verification result with details
   */
  export async function verify(): Promise<{
    valid: boolean
    eventCount: number
    errors: string[]
  }> {
    const p = auditPath()
    if (!(await exists(p))) {
      return { valid: true, eventCount: 0, errors: [] }
    }

    const content = await fs.readFile(p, "utf-8")
    const lines = content.trim().split("\n").filter(Boolean)
    const errors: string[] = []
    let prevHash = "genesis"

    for (let i = 0; i < lines.length; i++) {
      try {
        const event = JSON.parse(lines[i]) as Event
        
        // Verify prev_hash matches
        if (event.prev_hash !== prevHash) {
          errors.push(`Event ${i}: prev_hash mismatch (expected ${prevHash}, got ${event.prev_hash})`)
        }

        // Verify hash computation (exclude hash field before recomputing)
        const { hash: _, ...eventWithoutHash } = event
        const expectedHash = computeHash(eventWithoutHash, event.prev_hash)
        if (event.hash !== expectedHash) {
          errors.push(`Event ${i}: hash mismatch (expected ${expectedHash}, got ${event.hash})`)
        }

        prevHash = event.hash
      } catch (e) {
        errors.push(`Event ${i}: failed to parse - ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    return {
      valid: errors.length === 0,
      eventCount: lines.length,
      errors
    }
  }

  /**
   * Read all audit events
   */
  export async function readAll(): Promise<Event[]> {
    const p = auditPath()
    if (!(await exists(p))) {
      return []
    }

    const content = await fs.readFile(p, "utf-8")
    const lines = content.trim().split("\n").filter(Boolean)
    
    return lines.map(line => JSON.parse(line) as Event)
  }
}
