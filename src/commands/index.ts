import { CommandRegistry } from "./registry.js";
import { registerCommand } from "./register.js";
import { unregisterCommand } from "./unregister.js";
import { projectsCommand } from "./projects.js";
import { statusCommand } from "./status.js";
import { stopCommand } from "./stop.js";
import { resetCommand } from "./reset.js";
import { helpCommand } from "./help.js";
import { healthCommand } from "./health.js";
import { rememberCommand } from "./remember.js";
import { recallCommand } from "./recall.js";
import { debateCommand } from "./debate.js";
import { rcCommand } from "./rc.js";
import { loadCustomCommands } from "./custom-loader.js";

export async function createCommandRegistry(): Promise<CommandRegistry> {
  const registry = new CommandRegistry();
  registry.register(registerCommand);
  registry.register(unregisterCommand);
  registry.register(projectsCommand);
  registry.register(statusCommand);
  registry.register(stopCommand);
  registry.register(resetCommand);
  registry.register(helpCommand);
  registry.register(healthCommand);
  registry.register(rememberCommand);
  registry.register(recallCommand);
  registry.register(debateCommand);
  registry.register(rcCommand);

  // Load user-defined custom commands from commands/ directory
  const custom = await loadCustomCommands();
  for (const cmd of custom) {
    registry.register(cmd);
  }

  return registry;
}

export { CommandRegistry, type Command, type CommandContext } from "./registry.js";
