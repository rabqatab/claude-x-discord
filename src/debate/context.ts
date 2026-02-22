import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import { execSync } from "node:child_process";

export interface ProjectFacts {
  tree: string;
  dependencies: string;
  readme: string;
  sourceFiles: string;
}

export interface ContextInput {
  projectFacts: ProjectFacts;
  claudeSummary: string;
  question: string;
}

/**
 * Assemble context for Claude (minimal — Claude has tool access to the project).
 */
export function assembleClaudeContext(input: ContextInput): string {
  return [
    `You have full access to the project at the current working directory.`,
    `Project: ${input.claudeSummary}`,
    ``,
    `## Question`,
    input.question,
    ``,
    `Use your tools to read the project files and provide a thorough analysis.`,
  ].join("\n");
}

/**
 * Assemble context for API-only models (Gemini, OpenAI) — must include all relevant code.
 */
export function assembleApiContext(input: ContextInput): string {
  return [
    `## Project Facts`,
    ``,
    `### Directory Structure`,
    "```",
    input.projectFacts.tree,
    "```",
    ``,
    `### Dependencies`,
    "```",
    input.projectFacts.dependencies,
    "```",
    ``,
    `### README`,
    input.projectFacts.readme,
    ``,
    `### Source Code`,
    input.projectFacts.sourceFiles,
    ``,
    `## Context Summary`,
    input.claudeSummary,
    ``,
    `## Question`,
    input.question,
    ``,
    `Please provide your analysis and recommendation based on the project code above.`,
  ].join("\n");
}

const CODE_EXTENSIONS = new Set([
  ".py", ".ts", ".js", ".tsx", ".jsx", ".rs", ".go", ".java", ".kt",
  ".rb", ".c", ".cpp", ".h", ".hpp", ".cs", ".swift", ".vue", ".svelte",
]);

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build",
  ".next", ".nuxt", "target", ".tox", ".mypy_cache", ".ruff_cache",
  "egg-info", ".eggs",
]);

export function gatherProjectFacts(projectPath: string): ProjectFacts {
  // Tree — deeper and more complete
  let tree = "";
  try {
    tree = execSync(
      "find . -maxdepth 4 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/__pycache__/*' -not -path '*/.venv/*' -not -path '*/dist/*' -not -path '*/build/*' | sort | head -200",
      { cwd: projectPath, encoding: "utf-8", timeout: 5000 }
    );
  } catch {
    tree = "(failed to read)";
  }

  // Dependencies
  let dependencies = "";
  for (const depFile of ["package.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod"]) {
    const depPath = resolve(projectPath, depFile);
    if (existsSync(depPath)) {
      dependencies = readFileSync(depPath, "utf-8").slice(0, 4000);
      break;
    }
  }

  // README
  let readme = "";
  for (const name of ["README.md", "readme.md", "README.rst", "README"]) {
    const readmePath = resolve(projectPath, name);
    if (existsSync(readmePath)) {
      readme = readFileSync(readmePath, "utf-8").slice(0, 5000);
      break;
    }
  }

  // Source files — collect key source code
  const sourceFiles = collectSourceFiles(projectPath, 30000);

  return { tree, dependencies, readme, sourceFiles };
}

/**
 * Collect source code files up to maxChars total.
 * Prioritizes: entry points, main modules, then by directory depth (shallow first).
 */
function collectSourceFiles(projectPath: string, maxChars: number): string {
  const files: { path: string; content: string; priority: number }[] = [];

  function walk(dir: string, depth: number) {
    if (depth > 4) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch { return; }

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry) || entry.startsWith(".")) continue;
      const fullPath = join(dir, entry);
      let stat;
      try { stat = statSync(fullPath); } catch { continue; }

      if (stat.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (stat.isFile() && CODE_EXTENSIONS.has(extname(entry))) {
        const relPath = fullPath.slice(projectPath.length + 1);
        let priority = depth;
        // Boost priority for key files
        if (entry.match(/^(main|index|app|cli|__init__|mod)\./)) priority -= 2;
        if (entry.match(/^(config|settings|schema)\./)) priority -= 1;
        if (relPath.includes("test")) priority += 2;

        try {
          const content = readFileSync(fullPath, "utf-8");
          if (content.length < 10000) { // Skip huge files
            files.push({ path: relPath, content, priority });
          }
        } catch { /* skip */ }
      }
    }
  }

  walk(projectPath, 0);
  files.sort((a, b) => a.priority - b.priority);

  let result = "";
  let totalChars = 0;

  for (const file of files) {
    const block = `\n#### ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n`;
    if (totalChars + block.length > maxChars) break;
    result += block;
    totalChars += block.length;
  }

  if (!result) return "(no source files found)";
  return result;
}
