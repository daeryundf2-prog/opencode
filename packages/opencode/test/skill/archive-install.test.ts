import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { ArchiveSafety } from "../../src/util/archive-safety"

describe("ArchiveSafety", () => {
  describe("isPathSafe", () => {
    test("accepts safe relative paths", () => {
      expect(ArchiveSafety.isPathSafe("skill/SKILL.md").safe).toBe(true)
      expect(ArchiveSafety.isPathSafe("foo/bar/baz.txt").safe).toBe(true)
      expect(ArchiveSafety.isPathSafe("single-file.txt").safe).toBe(true)
      expect(ArchiveSafety.isPathSafe("nested/deep/path/file.ts").safe).toBe(true)
    })

    test("rejects path traversal with ..", () => {
      const result = ArchiveSafety.isPathSafe("../etc/passwd")
      expect(result.safe).toBe(false)
      expect(result.reason).toContain("traversal")
    })

    test("rejects embedded path traversal", () => {
      const result = ArchiveSafety.isPathSafe("foo/../../../etc/passwd")
      expect(result.safe).toBe(false)
    })

    test("rejects absolute Unix paths", () => {
      const result = ArchiveSafety.isPathSafe("/etc/passwd")
      expect(result.safe).toBe(false)
      expect(result.reason).toContain("Absolute")
    })

    test("rejects Windows drive paths", () => {
      const result = ArchiveSafety.isPathSafe("C:\\Windows\\System32\\config")
      expect(result.safe).toBe(false)
      expect(result.reason).toContain("Windows")
    })

    test("rejects Windows drive with forward slashes", () => {
      const result = ArchiveSafety.isPathSafe("D:/Users/admin/secrets")
      expect(result.safe).toBe(false)
    })
  })

  describe("sha256", () => {
    let testFile: string

    beforeAll(async () => {
      testFile = path.join(os.tmpdir(), `sha256-test-${Date.now()}.txt`)
      await Bun.write(testFile, "hello world")
    })

    afterAll(async () => {
      await fs.unlink(testFile).catch(() => {})
    })

    test("produces correct hash for known content", async () => {
      const hash = await ArchiveSafety.sha256(testFile)
      // SHA256 of "hello world" (no newline)
      expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9")
    })

    test("produces different hash for different content", async () => {
      const testFile2 = path.join(os.tmpdir(), `sha256-test2-${Date.now()}.txt`)
      await Bun.write(testFile2, "different content")
      const hash = await ArchiveSafety.sha256(testFile2)
      expect(hash).not.toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9")
      await fs.unlink(testFile2).catch(() => {})
    })
  })

  describe("validateTar", () => {
    let tmpDir: string
    let tarPath: string

    beforeAll(async () => {
      tmpDir = path.join(os.tmpdir(), `safe-tar-${Date.now()}`)
      await fs.mkdir(tmpDir, { recursive: true })
      await Bun.write(path.join(tmpDir, "SKILL.md"), "# Test Skill\n\nA safe skill for testing.")
      await fs.mkdir(path.join(tmpDir, "sub"), { recursive: true })
      await Bun.write(path.join(tmpDir, "sub", "helper.ts"), "export const helper = () => {}")

      tarPath = `${tmpDir}.tar.gz`
      const proc = Bun.spawn(["tar", "-czvf", tarPath, "-C", path.dirname(tmpDir), path.basename(tmpDir)])
      await proc.exited
    })

    afterAll(async () => {
      await fs.rm(tmpDir, { recursive: true }).catch(() => {})
      await fs.unlink(tarPath).catch(() => {})
    })

    test("accepts safe tar archive", async () => {
      const result = await ArchiveSafety.validateTar(tarPath)
      expect(result.safe).toBe(true)
      expect(result.entries.length).toBeGreaterThan(0)
    })

    test("returns entries list", async () => {
      const result = await ArchiveSafety.validateTar(tarPath)
      expect(result.entries.some(e => e.includes("SKILL.md"))).toBe(true)
    })
  })

  describe("validateZip", () => {
    let tmpDir: string
    let zipPath: string

    beforeAll(async () => {
      tmpDir = path.join(os.tmpdir(), `safe-zip-${Date.now()}`)
      await fs.mkdir(tmpDir, { recursive: true })
      await Bun.write(path.join(tmpDir, "SKILL.md"), "# Test Skill\n\nA safe skill for testing.")
      await fs.mkdir(path.join(tmpDir, "lib"), { recursive: true })
      await Bun.write(path.join(tmpDir, "lib", "index.ts"), "export const main = () => {}")

      zipPath = `${tmpDir}.zip`
      const proc = Bun.spawn(["zip", "-r", zipPath, path.basename(tmpDir)], { cwd: path.dirname(tmpDir) })
      await proc.exited
    })

    afterAll(async () => {
      await fs.rm(tmpDir, { recursive: true }).catch(() => {})
      await fs.unlink(zipPath).catch(() => {})
    })

    test("accepts safe zip archive", async () => {
      const result = await ArchiveSafety.validateZip(zipPath)
      expect(result.safe).toBe(true)
    })

    test("returns entries list", async () => {
      const result = await ArchiveSafety.validateZip(zipPath)
      expect(result.entries.length).toBeGreaterThan(0)
    })
  })

  describe("validate (auto-detect)", () => {
    test("detects tar.gz format", async () => {
      const tmpDir = path.join(os.tmpdir(), `auto-tar-${Date.now()}`)
      await fs.mkdir(tmpDir, { recursive: true })
      await Bun.write(path.join(tmpDir, "test.txt"), "content")

      const tarPath = `${tmpDir}.tar.gz`
      const proc = Bun.spawn(["tar", "-czvf", tarPath, "-C", path.dirname(tmpDir), path.basename(tmpDir)])
      await proc.exited

      const result = await ArchiveSafety.validate(tarPath)
      expect(result.safe).toBe(true)

      await fs.rm(tmpDir, { recursive: true }).catch(() => {})
      await fs.unlink(tarPath).catch(() => {})
    })

    test("detects zip format", async () => {
      const tmpDir = path.join(os.tmpdir(), `auto-zip-${Date.now()}`)
      await fs.mkdir(tmpDir, { recursive: true })
      await Bun.write(path.join(tmpDir, "test.txt"), "content")

      const zipPath = `${tmpDir}.zip`
      const proc = Bun.spawn(["zip", "-r", zipPath, path.basename(tmpDir)], { cwd: path.dirname(tmpDir) })
      await proc.exited

      const result = await ArchiveSafety.validate(zipPath)
      expect(result.safe).toBe(true)

      await fs.rm(tmpDir, { recursive: true }).catch(() => {})
      await fs.unlink(zipPath).catch(() => {})
    })

    test("rejects unsupported format", async () => {
      const result = await ArchiveSafety.validate("/tmp/fake.rar")
      expect(result.safe).toBe(false)
      expect(result.reason).toContain("Unsupported")
    })
  })
})
