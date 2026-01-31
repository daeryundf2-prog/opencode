- To test opencode in the `packages/opencode` directory you can run `bun dev`
- To regenerate the javascript SDK, run ./packages/sdk/js/script/build.ts
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- the default branch in this repo is `dev`

# Installed Skills

<available_skills>

<skill>
<name>find-skills</name>
<description>Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill.</description>
</skill>

<skill>
<name>code-reviewer</name>
<description>Expert code review specialist. Proactively reviews code for quality, security, and maintainability. Use immediately after writing or modifying code. MUST BE USED for all code changes.</description>
</skill>

<skill>
<name>planner</name>
<description>Expert planning specialist for complex features and refactoring. Use PROACTIVELY when users request feature implementation, architectural changes, or complex refactoring. Automatically activated for planning tasks.</description>
</skill>

<skill>
<name>security-reviewer</name>
<description>Security vulnerability detection and remediation specialist. Use PROACTIVELY after writing code that handles user input, authentication, API endpoints, or sensitive data. Flags secrets, SSRF, injection, unsafe crypto, and OWASP Top 10 vulnerabilities.</description>
</skill>

<skill>
<name>architect</name>
<description>Software architecture specialist for system design, scalability, and technical decision-making. Use PROACTIVELY when planning new features, refactoring large systems, or making architectural decisions.</description>
</skill>

<skill>
<name>build-error-resolver</name>
<description>Build and TypeScript error resolution specialist. Use PROACTIVELY when build fails or type errors occur. Fixes build/type errors only with minimal diffs, no architectural edits. Focuses on getting the build green quickly.</description>
</skill>

<skill>
<name>accessibility-audit</name>
<description>You are an accessibility expert specializing in WCAG compliance, inclusive design, and assistive technology compatibility. Conduct audits, identify barriers, and provide remediation guidance.</description>
</skill>

<skill>
<name>ai-agents-architect</name>
<description>Expert in designing and building autonomous AI agents. Masters tool use, memory systems, planning strategies, and multi-agent orchestration. Use when: build agent, AI agent, autonomous agent, tool use, function calling.</description>
</skill>

<skill>
<name>react-patterns</name>
<description>Modern React patterns and principles. Hooks, composition, performance, TypeScript best practices. Use when: react, hooks, component design, optimization, typescript react.</description>
</skill>

</available_skills>
