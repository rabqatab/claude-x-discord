import { SlashCommandBuilder, type ChatInputCommandInteraction, type AutocompleteInteraction } from "discord.js";
import { type Command, type CommandContext } from "./registry.js";
import { existsSync, statSync, readdirSync } from "node:fs";
import { resolve, normalize, basename, dirname } from "node:path";
import { homedir } from "node:os";

/** Well-known project root directories to scan */
const PROJECT_ROOTS = [
  "~/PycharmProjects",
  "~/PythonProjects",
  "~/Study",
  "~/Research",
  "~/Projects",
  "~/Desktop",
  "~/Documents",
].map(p => p.replace(/^~/, homedir()));

const data = new SlashCommandBuilder()
  .setName("register")
  .setDescription("Register a project and create a Forum Topic")
  .addStringOption((opt) =>
    opt.setName("name").setDescription("Project name").setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName("path").setDescription("Absolute path to project directory (supports ~)").setRequired(true).setAutocomplete(true)
  ) as SlashCommandBuilder;

/** Resolve ~, relative paths, trailing slashes */
function normalizePath(input: string): string {
  let p = input.trim();
  if (p.startsWith("~/") || p === "~") {
    p = p.replace(/^~/, homedir());
  }
  p = resolve(p);
  return normalize(p);
}

/** Find similar directory names when path doesn't exist */
function suggestPaths(input: string): string[] {
  const normalized = normalizePath(input);
  const parent = resolve(normalized, "..");
  if (!existsSync(parent)) return [];

  const target = normalized.split("/").pop()?.toLowerCase() ?? "";
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .filter(name => {
        const lower = name.toLowerCase();
        return lower.includes(target) || target.includes(lower) ||
          levenshtein(lower, target) <= 3;
      })
      .slice(0, 5)
      .map(name => resolve(parent, name));
  } catch { return []; }
}

/** Simple Levenshtein distance */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}

async function execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const name = interaction.options.getString("name", true).trim();
  const rawPath = interaction.options.getString("path", true);
  const projectPath = normalizePath(rawPath);

  // Check path exists
  if (!existsSync(projectPath)) {
    const suggestions = suggestPaths(rawPath);
    let msg = `Path \`${projectPath}\` does not exist.`;
    if (suggestions.length > 0) {
      msg += `\n\nDid you mean?\n${suggestions.map(s => `- \`${s}\``).join("\n")}`;
    }
    await interaction.reply({ content: msg, ephemeral: true });
    return;
  }

  // Verify it's a directory
  try {
    if (!statSync(projectPath).isDirectory()) {
      await interaction.reply({ content: `\`${projectPath}\` is not a directory.`, ephemeral: true });
      return;
    }
  } catch {
    await interaction.reply({ content: `Cannot access \`${projectPath}\`.`, ephemeral: true });
    return;
  }

  // Case-insensitive duplicate check for name
  const allProjects = ctx.sessions.listProjects();
  const nameLower = name.toLowerCase();
  const existing = allProjects.find(p => p.project_name.toLowerCase() === nameLower);
  if (existing) {
    await interaction.reply({
      content: `Project \`${existing.project_name}\` is already registered (topic: <#${existing.forum_topic_id}>).`,
      ephemeral: true,
    });
    return;
  }

  // Check if same path is already registered
  const samePath = allProjects.find(p => normalize(p.project_path) === projectPath);
  if (samePath) {
    await interaction.reply({
      content: `This path is already registered as \`${samePath.project_name}\` (topic: <#${samePath.forum_topic_id}>).`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const machine = ctx.config.machine_name;
  const thread = await ctx.forum.createTopic(
    name,
    `Project registered: **${name}**\nPath: \`${projectPath}\`\nMachine: **${machine}**`
  );

  ctx.sessions.registerProject({
    forumTopicId: thread.id,
    projectName: name,
    projectPath,
  });

  await interaction.editReply(`Registered project **${name}** on **${machine}** in <#${thread.id}>`);
}

/** List subdirectories of a path */
function listDirs(dirPath: string): string[] {
  try {
    if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) return [];
    return readdirSync(dirPath, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith("."))
      .map(d => resolve(dirPath, d.name));
  } catch { return []; }
}

/** Shorten path for display: replace homedir with ~ */
function displayPath(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

async function autocomplete(interaction: AutocompleteInteraction, _ctx: CommandContext): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== "path") return;

  const input = focused.value.trim();
  let choices: { name: string; value: string }[] = [];

  if (!input) {
    // No input yet — show all projects from known roots
    for (const root of PROJECT_ROOTS) {
      for (const dir of listDirs(root)) {
        choices.push({ name: displayPath(dir), value: dir });
      }
    }
  } else {
    // User is typing a path — expand and list matching directories
    const normalized = normalizePath(input);

    if (existsSync(normalized) && statSync(normalized).isDirectory()) {
      // Input is a valid directory — show its subdirectories
      const subs = listDirs(normalized);
      if (subs.length > 0) {
        choices = subs.map(d => ({ name: displayPath(d), value: d }));
      } else {
        // No subdirs, suggest the directory itself
        choices = [{ name: displayPath(normalized), value: normalized }];
      }
    } else {
      // Partial input — list parent's dirs matching the partial name
      const parent = dirname(normalized);
      const partial = basename(normalized).toLowerCase();
      if (existsSync(parent)) {
        choices = listDirs(parent)
          .filter(d => basename(d).toLowerCase().includes(partial))
          .map(d => ({ name: displayPath(d), value: d }));
      }
    }
  }

  // Discord allows max 25 choices
  await interaction.respond(choices.slice(0, 25));
}

export const registerCommand: Command = { data, execute, autocomplete };
