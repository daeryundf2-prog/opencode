#!/usr/bin/env bun
import { $ } from "bun"
import { join } from "path"
import { mkdir, rm, writeFile, readFile } from "fs/promises"
import { exists } from "fs/promises"

const TEST_DIR = join(process.cwd(), "temp-integration-test")
const MOCK_REPO = join(TEST_DIR, "mock-skill-repo")
const PROJECT_DIR = join(TEST_DIR, "project")

// Set environment for opencode execution (avoiding TUI issues if any)
process.env.OPENCODE_CLIENT = "test"

async function run() {
    console.log("setup...")
    if (await exists(TEST_DIR)) await rm(TEST_DIR, { recursive: true, force: true })
    await mkdir(TEST_DIR, { recursive: true })
    
    // 1. Create Mock Repo
    await mkdir(MOCK_REPO, { recursive: true })
    await $`git init`.cwd(MOCK_REPO).quiet()
    await $`git config user.email "test@example.com"`.cwd(MOCK_REPO).quiet()
    await $`git config user.name "Test User"`.cwd(MOCK_REPO).quiet()
    
    await writeFile(join(MOCK_REPO, "SKILL.md"), `---
name: test-skill
description: A test skill
---
Test Content`)
    
    await $`git add .`.cwd(MOCK_REPO).quiet()
    await $`git commit -m "Initial commit"`.cwd(MOCK_REPO).quiet()
    const commit = (await $`git rev-parse HEAD`.cwd(MOCK_REPO).text()).trim()
    
    console.log(`Created mock repo at ${MOCK_REPO} (commit: ${commit})`)
    
    // 2. Run Opencode CLI (using ts-node or bun run)
    // We assume we are in opencode root or package root.
    // We will run the source directly.
    
    await mkdir(PROJECT_DIR, { recursive: true })
    
    const cliPath = join(process.cwd(), "src/index.ts")
    console.log("Running install command...")
    
    // Install
    const proc = Bun.spawn(["bun", "run", cliPath, "skills", "install", MOCK_REPO, "--commit", commit], {
        cwd: PROJECT_DIR,
        stdout: "inherit",
        stderr: "inherit"
    })
    
    const exitCode = await proc.exited
    if (exitCode !== 0) {
        console.error("CLI failed")
        process.exit(1)
    }
    
    // 3. Verify
    console.log("Verifying results...")
    const installedSkill = join(PROJECT_DIR, ".opencode/skills/test-skill/SKILL.md")
    if (!(await exists(installedSkill))) throw new Error("Skill file not found")
    
    const lockFile = join(PROJECT_DIR, "opencode.skills.lock")
    if (!(await exists(lockFile))) throw new Error("Lock file not found")
    
    const lock = JSON.parse(await readFile(lockFile, "utf-8"))
    if (lock.skills["test-skill"].commit !== commit) throw new Error("Commit mismatch in lockfile")
    
    const auditFile = join(PROJECT_DIR, ".opencode/skills_audit.jsonl")
    if (!(await exists(auditFile))) throw new Error("Audit log not found")
    
    const auditLine = await readFile(auditFile, "utf-8")
    const audit = JSON.parse(auditLine)
    if (audit.action !== "SKILL_INSTALL_SUCCESS") throw new Error("Audit action mismatch")
    
    console.log("✅ Integration Test Passed!")
    
    // Cleanup
    await rm(TEST_DIR, { recursive: true, force: true })
}

run().catch(e => {
    console.error(e)
    process.exit(1)
})
