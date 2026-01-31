import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { SkillsCommand } from "./skills"
import { Instance } from "../../project/instance"
import { join } from "path"
import { mkdir, rm, writeFile, readFile, exists } from "fs/promises"

// Mock env
const TEST_DIR = join(process.cwd(), "test-workspace-unit")

describe("Skills Command", () => {
  beforeEach(async () => {
    // Basic setup
    try {
        await rm(TEST_DIR, { recursive: true, force: true })
        await mkdir(TEST_DIR, { recursive: true })
    } catch(e) {}
  })

  afterEach(async () => {
    try {
        await rm(TEST_DIR, { recursive: true, force: true })
    } catch(e) {}
  })

  it("should be defined", async () => {
      expect(SkillsCommand).toBeDefined()
      expect(SkillsCommand.command).toBe("skills")
  })
})
