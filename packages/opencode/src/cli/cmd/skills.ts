import { cmd } from "./cmd"
import type { Argv } from "yargs"
import { Instance } from "../../project/instance"
import { Log } from "../../util/log"
import { UI } from "../ui"
import { Skill } from "../../skill/skill"
import { SkillManifest, SkillLock } from "../../skill/schema"
import { Policy } from "../../skill/policy"
import { Audit } from "../../skill/audit"
import { Global } from "../../global"
import path from "path"
import fs from "fs/promises"
import { exists } from "fs/promises"
import { ConfigMarkdown } from "../../config/markdown"
import { createHash } from "crypto"
import { ArchiveSafety } from "../../util/archive-safety"

const log = Log.create({ service: "cli:skills" })

async function downloadFile(url: string, dest: string): Promise<void> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`)
    if (!res.body) throw new Error(`Empty body for ${url}`)
    await Bun.write(dest, res)
}

async function extractTar(tarPath: string, destDir: string): Promise<void> {
    await fs.mkdir(destDir, { recursive: true })
    const p = Bun.spawn(["tar", "-xf", tarPath, "-C", destDir, "--strip-components=1"], {
        stderr: "pipe"
    })
    const exit = await p.exited
    if (exit !== 0) {
        const err = await new Response(p.stderr).text()
        throw new Error(`Tar extraction failed: ${err}`)
    }
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
    await fs.mkdir(destDir, { recursive: true })
    const p = Bun.spawn(["unzip", "-o", zipPath, "-d", destDir], {
        stderr: "pipe"
    })
    const exit = await p.exited
    if (exit !== 0) {
        const err = await new Response(p.stderr).text()
        throw new Error(`Zip extraction failed: ${err}`)
    }
    // Handle single root directory (strip-components equivalent)
    const entries = await fs.readdir(destDir)
    if (entries.length === 1) {
        const singleDir = path.join(destDir, entries[0])
        const stat = await fs.stat(singleDir)
        if (stat.isDirectory()) {
            const innerEntries = await fs.readdir(singleDir)
            for (const entry of innerEntries) {
                await fs.rename(path.join(singleDir, entry), path.join(destDir, entry))
            }
            await fs.rmdir(singleDir)
        }
    }
}

async function calculateFileHash(filePath: string, algo = "sha256"): Promise<string> {
    const file = Bun.file(filePath)
    const buf = await file.arrayBuffer()
    const hash = createHash(algo)
    hash.update(new Uint8Array(buf))
    return hash.digest("hex")
}

const SkillsInstallCommand = cmd({
  command: "install <url>",
  describe: "install a skill from a git repository",
  builder: (yargs: Argv) =>
    yargs
      .positional("url", {
        type: "string",
        describe: "git repository url",
        demandOption: true,
      })
      .option("commit", {
        type: "string",
        describe: "git commit sha to pin",
      })
      .option("sha256", {
        type: "string",
        describe: "sha256 hash for archive verification (required for archives)",
        alias: "integrity",
      })
      .option("force", {
        type: "boolean",
        default: false,
        describe: "overwrite existing skill",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const url = args.url as string
        const commit = args.commit as string | undefined
        const sha256Option = args.sha256 as string | undefined
        const force = args.force as boolean

        const skillsDir = path.join(Global.Path.data, "skills", "installed")
        const tempDir = path.join(Global.Path.cache, "temp", `skill-${Date.now()}`)
        const projectRoot = Instance.worktree

        log.info("installing skill", { url, commit, sha256: sha256Option })
        UI.info(`Installing skill from ${url}...`)

        // Policy check before installation
        const policyResult = await Policy.check("pending", url)
        if (!policyResult.allowed) {
            await Audit.append({
                timestamp: new Date().toISOString(),
                actor: process.env.USER || "unknown",
                operation: "POLICY_DENY",
                target: url,
                result: "FAILURE",
                details: { source: url, reason: policyResult.reason }
            })
            UI.error(`POLICY_DENY: ${policyResult.reason}`)
            process.exit(1)
        }

        try {
          await fs.mkdir(path.dirname(tempDir), { recursive: true })
          
          let sourceHash = ""
          let isGit = false
          
          if (url.endsWith(".tar.gz") || url.endsWith(".tgz") || url.endsWith(".zip")) {
              // MANDATORY sha256 for archives
              if (!sha256Option) {
                  UI.error("MISSING_SHA256: Archive installs require --sha256 <hex> for integrity verification")
                  process.exit(1)
              }
              
              const isZip = url.endsWith(".zip")
              const ext = isZip ? ".zip" : ".tar.gz"
              const archivePath = path.join(path.dirname(tempDir), `archive-${Date.now()}${ext}`)
              await downloadFile(url, archivePath)
              
              // Verify hash using ArchiveSafety
              sourceHash = await ArchiveSafety.sha256(archivePath)
              if (sourceHash !== sha256Option) {
                  await fs.unlink(archivePath)
                  UI.error(`SHA256_MISMATCH: Expected ${sha256Option}, got ${sourceHash}`)
                  process.exit(1)
              }
              
              // Safety validation before extraction
              const validation = await ArchiveSafety.validate(archivePath)
              if (!validation.safe) {
                  await fs.unlink(archivePath)
                  UI.error(`UNSAFE_ARCHIVE_PATH: ${validation.reason}`)
                  process.exit(1)
              }
              
              // Extract using appropriate method
              if (isZip) {
                  await extractZip(archivePath, tempDir)
              } else {
                  await extractTar(archivePath, tempDir)
              }
              await fs.unlink(archivePath)
          } else {
              isGit = true
              if (commit) {
                 const p = Bun.spawn(["git", "clone", url, tempDir], { stderr: "pipe", stdout: "ignore" })
                 const exit = await p.exited
                 if (exit !== 0) throw new Error(`Git clone failed`)
                 
                 const p2 = Bun.spawn(["git", "checkout", commit], { cwd: tempDir, stderr: "pipe" })
                 if ((await p2.exited) !== 0) throw new Error(`Git checkout ${commit} failed`)
              } else {
                 UI.error("MISSING_COMMIT_SHA: Git installs require --commit <sha> for reproducibility")
                 process.exit(1)
              }
          }

          const skillMdPath = path.join(tempDir, "SKILL.md")
          if (!(await exists(skillMdPath))) {
              throw new Error("Repository does not contain SKILL.md at root")
          }

          const md = await ConfigMarkdown.parse(skillMdPath)
          if (!md) throw new Error("Failed to parse SKILL.md")
          
          const info = Skill.Info.safeParse(md.data)
          if (!info.success) {
              throw new Error(`Invalid SKILL.md: ${info.error.message}`)
          }
          const skillName = info.data.name

          const targetDir = path.join(skillsDir, skillName)
          if (await exists(targetDir)) {
              if (!force) {
                  throw new Error(`Skill '${skillName}' already installed. Use --force to overwrite.`)
              }
              await fs.rm(targetDir, { recursive: true, force: true })
          }
          await fs.mkdir(skillsDir, { recursive: true })
          await fs.rename(tempDir, targetDir)
          
          const manifestPath = path.join(projectRoot, "opencode.skills.json")
          const lockPath = path.join(projectRoot, "opencode.skills.lock")
          
          let manifest: SkillManifest = { schema_version: 1, skills: {} }
          if (await exists(manifestPath)) {
              try { manifest = SkillManifest.parse(JSON.parse(await fs.readFile(manifestPath, "utf-8"))) } catch (e) {}
          }
          
          let lock: SkillLock = { version: 1, skills: {} }
          if (await exists(lockPath)) {
              try { lock = SkillLock.parse(JSON.parse(await fs.readFile(lockPath, "utf-8"))) } catch (e) {}
          }
          
          if (isGit) {
              manifest.skills[skillName] = `git+${url}${commit ? '#' + commit : ''}`
          } else {
              manifest.skills[skillName] = url
          }
          
          let installedCommit = commit
          if (isGit && !installedCommit) {
              const p = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: targetDir, stdout: "pipe" })
              installedCommit = (await new Response(p.stdout).text()).trim()
          }
          
          lock.skills[skillName] = {
              source: isGit ? `git+${url}` : url,
              commit: installedCommit,
              integrity: isGit ? undefined : sourceHash,
              installedAt: new Date().toISOString(),
              installedBy: process.env.USER || "unknown"
          }
          
          await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
          await fs.writeFile(lockPath, JSON.stringify(lock, null, 2))
          
          await Audit.append({
              timestamp: new Date().toISOString(),
              actor: process.env.USER || "unknown",
              operation: "INSTALL",
              target: skillName,
              result: "SUCCESS",
              details: { 
                  source: isGit ? `git+${url}` : url, 
                  commit: installedCommit,
                  integrity: isGit ? undefined : sourceHash
              }
          })

          UI.success(`Skill '${skillName}' installed successfully`)
          
        } catch (e) {
            log.error("install failed", { error: e })
            UI.error(`Failed to install skill: ${e instanceof Error ? e.message : String(e)}`)
            try { await fs.rm(tempDir, { recursive: true, force: true }) } catch (err) {}
            process.exit(1)
        }
      }
    })
  }
})

const SkillsListCommand = cmd({
  command: "list",
  describe: "list installed skills",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const projectRoot = Instance.worktree
        const lockPath = path.join(projectRoot, "opencode.skills.lock")
        
        if (!(await exists(lockPath))) {
            UI.info("No skills installed (opencode.skills.lock not found)")
            return
        }
        
        try {
            const lock = JSON.parse(await fs.readFile(lockPath, "utf-8"))
            if (!lock.skills || Object.keys(lock.skills).length === 0) {
                UI.info("No skills installed")
                return
            }
            
            console.log("Installed Skills:")
            for (const [name, info] of Object.entries(lock.skills)) {
                const i = info as any
                const source = i.source
                const version = i.version || i.commit?.substring(0, 7) || i.integrity?.substring(0, 7) || "unknown"
                console.log(`- ${name} (${version}) from ${source}`)
            }
        } catch (e) {
            UI.error("Failed to read lockfile")
        }
      }
    })
  }
})

const SkillsSearchCommand = cmd({
  command: "search <query>",
  describe: "search available skills",
  builder: (yargs) => yargs.positional("query", { type: "string", demandOption: true }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const query = (args.query as string).toLowerCase()
        const skills = await Skill.all()
        
        const matches = skills.filter(s => 
            s.name.toLowerCase().includes(query) || 
            s.description.toLowerCase().includes(query)
        )
        
        if (matches.length === 0) {
            UI.info(`No skills found matching '${query}'`)
            return
        }
        
        console.log(`Found ${matches.length} skills:`)
        for (const skill of matches) {
            console.log(`- ${skill.name}: ${skill.description} (${skill.location})`)
        }
      }
    })
  }
})

const SkillsRemoveCommand = cmd({
  command: "remove <name>",
  describe: "remove an installed skill",
  builder: (yargs) => yargs.positional("name", { type: "string", demandOption: true }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const name = args.name as string
        const skillsDir = path.join(Global.Path.data, "skills", "installed")
        const projectRoot = Instance.worktree
        const targetDir = path.join(skillsDir, name)
        
        const manifestPath = path.join(projectRoot, "opencode.skills.json")
        const lockPath = path.join(projectRoot, "opencode.skills.lock")
        
        if (!(await exists(targetDir))) {
            UI.error(`Skill '${name}' not found in .opencode/skills`)
        } else {
            await fs.rm(targetDir, { recursive: true, force: true })
            UI.success(`Removed skill directory: ${targetDir}`)
        }
        
        if (await exists(manifestPath)) {
            const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"))
            if (manifest.skills && manifest.skills[name]) {
                delete manifest.skills[name]
                await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
            }
        }
        
        if (await exists(lockPath)) {
            const lock = JSON.parse(await fs.readFile(lockPath, "utf-8"))
            if (lock.skills && lock.skills[name]) {
                delete lock.skills[name]
                await fs.writeFile(lockPath, JSON.stringify(lock, null, 2))
            }
        }
        
        await Audit.append({
            timestamp: new Date().toISOString(),
            actor: process.env.USER || "unknown",
            operation: "REMOVE",
            target: name,
            result: "SUCCESS",
            details: { source: "removed" }
        })
      }
    })
  }
})

const SkillsUpdateCommand = cmd({
  command: "update <name>",
  describe: "update an installed skill to a new version",
  builder: (yargs: Argv) => yargs
    .positional("name", { type: "string", demandOption: true })
    .option("commit", { type: "string", describe: "new git commit sha" })
    .option("sha256", { type: "string", alias: "integrity", describe: "new archive sha256" }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const name = args.name as string
        const newCommit = args.commit as string | undefined
        const newSha256 = args.sha256 as string | undefined
        const projectRoot = Instance.worktree
        
        const lockPath = path.join(projectRoot, "opencode.skills.lock")
        if (!(await exists(lockPath))) {
          UI.error("No skills.lock found")
          process.exit(1)
        }
        const lock = SkillLock.parse(JSON.parse(await fs.readFile(lockPath, "utf-8")))
        const current = lock.skills[name]
        if (!current) {
          UI.error(`Skill '${name}' not found in lockfile`)
          process.exit(1)
        }
        
        if (!newCommit && !newSha256) {
          UI.error("Update requires --commit <sha> or --sha256 <hex>")
          process.exit(1)
        }
        
        const policyResult = await Policy.check(name, current.source)
        if (!policyResult.allowed) {
          await Audit.append({
            timestamp: new Date().toISOString(),
            actor: process.env.USER || "unknown",
            operation: "POLICY_DENY",
            target: name,
            result: "FAILURE",
            details: { reason: policyResult.reason }
          })
          UI.error(`POLICY_DENY: ${policyResult.reason}`)
          process.exit(1)
        }
        
        const oldCommit = current.commit
        const oldIntegrity = current.integrity
        
        if (newCommit) lock.skills[name].commit = newCommit
        if (newSha256) lock.skills[name].integrity = newSha256
        lock.skills[name].installedAt = new Date().toISOString()
        lock.skills[name].installedBy = process.env.USER || "unknown"
        
        await fs.writeFile(lockPath, JSON.stringify(lock, null, 2))
        
        await Audit.append({
          timestamp: new Date().toISOString(),
          actor: process.env.USER || "unknown",
          operation: "UPDATE",
          target: name,
          result: "SUCCESS",
          details: { 
            source: current.source,
            oldCommit,
            newCommit,
            oldIntegrity,
            newIntegrity: newSha256
          }
        })
        
        UI.success(`Skill '${name}' updated`)
      }
    })
  }
})

export const SkillsCommand = cmd({
  command: "skills",
  describe: "manage skills",
  builder: (yargs) => yargs
    .command(SkillsInstallCommand)
    .command(SkillsListCommand)
    .command(SkillsSearchCommand)
    .command(SkillsRemoveCommand)
    .command(SkillsUpdateCommand)
    .demandCommand(),
  async handler() {},
})
