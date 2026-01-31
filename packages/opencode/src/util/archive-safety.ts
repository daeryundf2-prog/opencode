import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { createHash } from "crypto"
import { Log } from "./log"

const log = Log.create({ service: "archive-safety" })

export namespace ArchiveSafety {
  export interface ValidationResult {
    safe: boolean
    entries: string[]
    reason?: string
  }

  export interface PathCheckResult {
    safe: boolean
    reason?: string
  }

  /**
   * Validate a single path entry for safety
   * Rejects: absolute paths, ".." segments, Windows drive prefixes
   */
  export function isPathSafe(entryPath: string): PathCheckResult {
    const normalized = path.normalize(entryPath)

    // Reject absolute paths
    if (path.isAbsolute(entryPath) || path.isAbsolute(normalized)) {
      return { safe: false, reason: `Absolute path detected: ${entryPath}` }
    }

    // Reject paths starting with / (Unix absolute)
    if (entryPath.startsWith("/")) {
      return { safe: false, reason: `Unix absolute path: ${entryPath}` }
    }

    // Reject Windows drive prefixes (C:, D:, etc.)
    if (/^[A-Za-z]:/.test(entryPath)) {
      return { safe: false, reason: `Windows drive prefix: ${entryPath}` }
    }

    // Reject ".." path traversal segments
    const segments = entryPath.split(/[\\/]/)
    if (segments.includes("..")) {
      return { safe: false, reason: `Path traversal detected: ${entryPath}` }
    }

    // Reject normalized paths that escape (start with ..)
    if (normalized.startsWith("..")) {
      return { safe: false, reason: `Normalized path escapes root: ${entryPath}` }
    }

    return { safe: true }
  }

  /**
   * Validate all entries in a tar archive
   * Uses `tar -tvf` to list entries and detect symlinks/hardlinks
   */
  export async function validateTar(tarPath: string): Promise<ValidationResult> {
    const entries: string[] = []

    try {
      // Use tar -tvf to get verbose listing (shows link types)
      const p = Bun.spawn(["tar", "-tvf", tarPath], { stdout: "pipe", stderr: "pipe" })
      const exit = await p.exited
      if (exit !== 0) {
        const err = await new Response(p.stderr).text()
        return { safe: false, entries: [], reason: `Failed to list tar: ${err}` }
      }

      const output = await new Response(p.stdout).text()
      const lines = output.trim().split("\n").filter(Boolean)

      for (const line of lines) {
        // tar -tvf format: "lrwxrwxrwx user/group 0 2024-01-01 00:00 link -> target"
        // First char: - = file, d = dir, l = symlink, h = hardlink
        const firstChar = line.charAt(0)

        // Reject symlinks (l) and hardlinks (h)
        if (firstChar === "l") {
          const match = line.match(/\s(\S+)\s*->\s*(\S+)$/)
          const linkPath = match ? match[1] : "unknown"
          return { safe: false, entries, reason: `Symlink detected: ${linkPath}` }
        }
        if (firstChar === "h") {
          return { safe: false, entries, reason: `Hardlink detected in archive` }
        }

        // Extract the path (last field, or before " -> " for links)
        const parts = line.split(/\s+/)
        // Path is typically the last element, but we need to handle spaces
        // For safety, extract from position after timestamp
        const pathMatch = line.match(/\d{2}:\d{2}\s+(.+?)(?:\s*->.*)?$/)
        if (pathMatch) {
          const entryPath = pathMatch[1].trim()
          entries.push(entryPath)

          const pathCheck = isPathSafe(entryPath)
          if (!pathCheck.safe) {
            return { safe: false, entries, reason: pathCheck.reason }
          }
        }
      }

      return { safe: true, entries }
    } catch (e) {
      log.error("tar validation failed", { error: e })
      return { safe: false, entries: [], reason: `Tar validation error: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  /**
   * Validate all entries in a zip archive
   * Uses `unzip -l` to list entries (we don't parse the zip ourselves for security)
   */
  export async function validateZip(zipPath: string): Promise<ValidationResult> {
    const entries: string[] = []

    try {
      // Use unzip -l to list contents, -Z for zipinfo format (more detail)
      const p = Bun.spawn(["unzip", "-Z", "-1", zipPath], { stdout: "pipe", stderr: "pipe" })
      const exit = await p.exited
      if (exit !== 0) {
        // Try fallback with basic unzip -l
        const p2 = Bun.spawn(["unzip", "-l", zipPath], { stdout: "pipe", stderr: "pipe" })
        const exit2 = await p2.exited
        if (exit2 !== 0) {
          const err = await new Response(p2.stderr).text()
          return { safe: false, entries: [], reason: `Failed to list zip: ${err}` }
        }
        const output = await new Response(p2.stdout).text()
        // Parse unzip -l output (skip header/footer lines)
        const lines = output.trim().split("\n")
        for (const line of lines) {
          // Format: "   1234  01-01-2024 00:00   path/to/file"
          const match = line.match(/^\s*\d+\s+\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}\s+(.+)$/)
          if (match) {
            const entryPath = match[1].trim()
            entries.push(entryPath)
            const pathCheck = isPathSafe(entryPath)
            if (!pathCheck.safe) {
              return { safe: false, entries, reason: pathCheck.reason }
            }
          }
        }
      } else {
        // zipinfo -1 output: one path per line
        const output = await new Response(p.stdout).text()
        const lines = output.trim().split("\n").filter(Boolean)
        for (const entryPath of lines) {
          entries.push(entryPath)
          const pathCheck = isPathSafe(entryPath)
          if (!pathCheck.safe) {
            return { safe: false, entries, reason: pathCheck.reason }
          }
        }
      }

      // Additional check: look for symlinks using unzip -Z (zipinfo)
      // Symlinks in zip have 'l' in the attribute field
      const pInfo = Bun.spawn(["unzip", "-Z", zipPath], { stdout: "pipe", stderr: "pipe" })
      const infoExit = await pInfo.exited
      if (infoExit === 0) {
        const infoOutput = await new Response(pInfo.stdout).text()
        // Look for lines starting with 'l' (symlink indicator)
        const infoLines = infoOutput.split("\n")
        for (const line of infoLines) {
          if (line.match(/^l/)) {
            return { safe: false, entries, reason: `Symlink detected in zip archive` }
          }
        }
      }

      return { safe: true, entries }
    } catch (e) {
      log.error("zip validation failed", { error: e })
      return { safe: false, entries: [], reason: `Zip validation error: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  /**
   * Calculate SHA256 hash of a file
   */
  export async function sha256(filePath: string): Promise<string> {
    const file = Bun.file(filePath)
    const buf = await file.arrayBuffer()
    const hash = createHash("sha256")
    hash.update(new Uint8Array(buf))
    return hash.digest("hex")
  }

  /**
   * Validate an archive (tar.gz, tgz, or zip)
   */
  export async function validate(archivePath: string): Promise<ValidationResult> {
    const lower = archivePath.toLowerCase()
    if (lower.endsWith(".zip")) {
      return validateZip(archivePath)
    }
    if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz") || lower.endsWith(".tar")) {
      return validateTar(archivePath)
    }
    return { safe: false, entries: [], reason: `Unsupported archive format: ${archivePath}` }
  }
}
