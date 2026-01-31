import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdir, rm, writeFile, readFile, exists } from "fs/promises"
import { $ } from "bun"

const TEST_DIR = join(process.cwd(), "test-workspace-integration")
const MOCK_REPO = join(TEST_DIR, "mock-skill-repo")
const PROJECT_DIR = join(TEST_DIR, "project")
const CONFIG_DIR = join(TEST_DIR, "config")

const CLI_PATH = join(process.cwd(), "src/index.ts")

async function runCli(args: string[], env: Record<string, string> = {}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", "--conditions=browser", CLI_PATH, ...args], {
    cwd: PROJECT_DIR,
    env: {
      ...process.env,
      OPENCODE_CONFIG_DIR: CONFIG_DIR,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  
  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  
  return { exitCode, stdout, stderr }
}

describe("Skills Integration", () => {
  let commitSha: string
  
  beforeEach(async () => {
    // Clean slate
    await rm(TEST_DIR, { recursive: true, force: true })
    
    // Create directories
    await mkdir(TEST_DIR, { recursive: true })
    await mkdir(MOCK_REPO, { recursive: true })
    await mkdir(PROJECT_DIR, { recursive: true })
    await mkdir(join(CONFIG_DIR, "data"), { recursive: true })
    await mkdir(join(PROJECT_DIR, ".opencode"), { recursive: true })
    
    // Initialize PROJECT_DIR as a git repo
    // This ensures Instance.worktree is set to PROJECT_DIR, not the parent opencode repo
    await $`git init`.cwd(PROJECT_DIR).quiet()
    await $`git config user.email "test@example.com"`.cwd(PROJECT_DIR).quiet()
    await $`git config user.name "Test User"`.cwd(PROJECT_DIR).quiet()
    await writeFile(join(PROJECT_DIR, ".gitignore"), "node_modules\n")
    await $`git add .`.cwd(PROJECT_DIR).quiet()
    await $`git commit -m "Initial project setup"`.cwd(PROJECT_DIR).quiet()
    
    // Create a mock git repo for a skill
    await $`git init`.cwd(MOCK_REPO).quiet()
    await $`git config user.email "test@example.com"`.cwd(MOCK_REPO).quiet()
    await $`git config user.name "Test User"`.cwd(MOCK_REPO).quiet()
    
    // Create SKILL.md
    await writeFile(join(MOCK_REPO, "SKILL.md"), `---
name: test-skill
description: A test skill for integration testing
---
# Test Skill

This is test content.`)
    
    await $`git add .`.cwd(MOCK_REPO).quiet()
    await $`git commit -m "Initial commit"`.cwd(MOCK_REPO).quiet()
    
    // Get commit SHA
    const result = await $`git rev-parse HEAD`.cwd(MOCK_REPO).quiet()
    commitSha = result.stdout.toString().trim()
  })

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  it("should install a skill from local git repo with --commit", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      "skills", "install", MOCK_REPO, "--commit", commitSha
    ])
    
    // Should succeed
    expect(exitCode).toBe(0)
    expect(stdout + stderr).toContain("test-skill")
    
    // Verify skill was installed to OPENCODE_CONFIG_DIR/data/skills/installed
    const installedDir = join(CONFIG_DIR, "data", "skills", "installed", "test-skill")
    expect(await exists(installedDir)).toBe(true)
    
    // Verify SKILL.md exists in installed location
    expect(await exists(join(installedDir, "SKILL.md"))).toBe(true)
    
    // Verify lockfile was created in project
    const lockPath = join(PROJECT_DIR, "opencode.skills.lock")
    expect(await exists(lockPath)).toBe(true)
    
    const lock = JSON.parse(await readFile(lockPath, "utf-8"))
    expect(lock.skills["test-skill"]).toBeDefined()
    expect(lock.skills["test-skill"].commit).toBe(commitSha)
    
    // Verify manifest was created
    const manifestPath = join(PROJECT_DIR, "opencode.skills.json")
    expect(await exists(manifestPath)).toBe(true)
    
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"))
    expect(manifest.skills["test-skill"]).toContain(commitSha)
    
    // Verify audit log
    const auditPath = join(CONFIG_DIR, "data", "skills", "audit.jsonl")
    expect(await exists(auditPath)).toBe(true)
    
    const auditContent = await readFile(auditPath, "utf-8")
    expect(auditContent).toContain("INSTALL")
    expect(auditContent).toContain("test-skill")
  })

  it("should fail with MISSING_COMMIT_SHA when git URL lacks --commit", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      "skills", "install", MOCK_REPO
    ])
    
    // Should fail
    expect(exitCode).not.toBe(0)
    
    // Should show MISSING_COMMIT_SHA error
    const output = stdout + stderr
    expect(output).toContain("MISSING_COMMIT_SHA")
    expect(output).toContain("--commit")
    
    // Skill should NOT be installed
    const installedDir = join(CONFIG_DIR, "data", "skills", "installed", "test-skill")
    expect(await exists(installedDir)).toBe(false)
  })

  it("should list installed skills", async () => {
    // First install a skill
    await runCli(["skills", "install", MOCK_REPO, "--commit", commitSha])
    
    // Then list
    const { exitCode, stdout, stderr } = await runCli(["skills", "list"])
    
    expect(exitCode).toBe(0)
    const output = stdout + stderr
    expect(output).toContain("test-skill")
  })

  it("should remove an installed skill", async () => {
    // First install
    await runCli(["skills", "install", MOCK_REPO, "--commit", commitSha])
    
    // Verify installed
    const installedDir = join(CONFIG_DIR, "data", "skills", "installed", "test-skill")
    expect(await exists(installedDir)).toBe(true)
    
    // Remove
    const { exitCode, stdout, stderr } = await runCli(["skills", "remove", "test-skill"])
    
    expect(exitCode).toBe(0)
    const output = stdout + stderr
    expect(output).toContain("Removed")
    
    // Verify directory removed
    expect(await exists(installedDir)).toBe(false)
    
    // Verify lockfile updated
    const lockPath = join(PROJECT_DIR, "opencode.skills.lock")
    const lock = JSON.parse(await readFile(lockPath, "utf-8"))
    expect(lock.skills["test-skill"]).toBeUndefined()
    
    // Verify audit log has remove event
    const auditPath = join(CONFIG_DIR, "data", "skills", "audit.jsonl")
    const auditContent = await readFile(auditPath, "utf-8")
    expect(auditContent).toContain("REMOVE")
  })

  it("should fail to reinstall without --force", async () => {
    // Install first time
    await runCli(["skills", "install", MOCK_REPO, "--commit", commitSha])
    
    // Try to install again without --force
    const { exitCode, stdout, stderr } = await runCli([
      "skills", "install", MOCK_REPO, "--commit", commitSha
    ])
    
    expect(exitCode).not.toBe(0)
    const output = stdout + stderr
    expect(output).toContain("already installed")
  })

  it("should allow reinstall with --force", async () => {
    // Install first time
    await runCli(["skills", "install", MOCK_REPO, "--commit", commitSha])
    
    // Add a new commit to the repo
    await writeFile(join(MOCK_REPO, "CHANGELOG.md"), "# Changelog\n## v2")
    await $`git add .`.cwd(MOCK_REPO).quiet()
    await $`git commit -m "Add changelog"`.cwd(MOCK_REPO).quiet()
    const newShaResult = await $`git rev-parse HEAD`.cwd(MOCK_REPO).quiet()
    const newSha = newShaResult.stdout.toString().trim()
    
    // Reinstall with --force and new commit
    const { exitCode, stdout, stderr } = await runCli([
      "skills", "install", MOCK_REPO, "--commit", newSha, "--force"
    ])
    
    expect(exitCode).toBe(0)
    
    // Verify lockfile has new commit
    const lockPath = join(PROJECT_DIR, "opencode.skills.lock")
    const lock = JSON.parse(await readFile(lockPath, "utf-8"))
    expect(lock.skills["test-skill"].commit).toBe(newSha)
  })

  it("should handle full install-list-remove lifecycle", async () => {
    // 1. List before install (should show no skills)
    const list1 = await runCli(["skills", "list"])
    expect(list1.stdout + list1.stderr).toContain("No skills installed")
    
    // 2. Install
    const install = await runCli(["skills", "install", MOCK_REPO, "--commit", commitSha])
    expect(install.exitCode).toBe(0)
    
    // 3. List after install (should show skill)
    const list2 = await runCli(["skills", "list"])
    expect(list2.stdout + list2.stderr).toContain("test-skill")
    
    // 4. Remove
    const remove = await runCli(["skills", "remove", "test-skill"])
    expect(remove.exitCode).toBe(0)
    
    // 5. List after remove (should show no skills)
    const list3 = await runCli(["skills", "list"])
    expect(list3.stdout + list3.stderr).toContain("No skills installed")
  })
})
