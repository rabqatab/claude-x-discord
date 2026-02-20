import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

export interface ProjectFacts {
  tree: string;
  dependencies: string;
  readme: string;
}

export interface ContextInput {
  projectFacts: ProjectFacts;
  claudeSummary: string;
  question: string;
}

export function assembleContext(input: ContextInput): string {
  return `## Project Facts\n\n### Directory Structure\n\`\`\`\n${input.projectFacts.tree}\n\`\`\`\n\n### Dependencies\n\`\`\`json\n${input.projectFacts.dependencies}\n\`\`\`\n\n### README\n${input.projectFacts.readme}\n\n## Context Summary\n${input.claudeSummary}\n\n## Question\n${input.question}\n\nPlease provide your analysis and recommendation.`;
}

export function gatherProjectFacts(projectPath: string): ProjectFacts {
  let tree = "";
  try {
    tree = execSync("find . -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' | head -50", {
      cwd: projectPath,
      encoding: "utf-8",
      timeout: 5000,
    });
  } catch {
    tree = "(failed to read)";
  }

  let dependencies = "";
  for (const depFile of ["package.json", "pyproject.toml", "requirements.txt", "Cargo.toml"]) {
    const depPath = resolve(projectPath, depFile);
    if (existsSync(depPath)) {
      dependencies = readFileSync(depPath, "utf-8").slice(0, 2000);
      break;
    }
  }

  let readme = "";
  const readmePath = resolve(projectPath, "README.md");
  if (existsSync(readmePath)) {
    readme = readFileSync(readmePath, "utf-8").slice(0, 3000);
  }

  return { tree, dependencies, readme };
}
