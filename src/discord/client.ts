import {
  Client,
  GatewayIntentBits,
  Events,
  type Message,
  type Interaction,
} from "discord.js";
import { EventEmitter } from "node:events";

export class DiscordGateway extends EventEmitter {
  public client: Client;

  constructor(
    private token: string,
    private allowedUserIds: string[]
  ) {
    super();
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
      ],
    });
  }

  async start(): Promise<void> {
    this.client.on(Events.MessageCreate, (msg: Message) => {
      if (msg.author.bot) return;
      if (!this.isAllowed(msg.author.id)) return;
      this.emit("message", msg);
    });

    this.client.on(Events.InteractionCreate, (interaction: Interaction) => {
      if (interaction.isAutocomplete()) {
        this.emit("autocomplete", interaction);
      }
      if (interaction.isCommand()) {
        this.emit("command", interaction);
      }
      if (interaction.isButton()) {
        this.emit("button", interaction);
      }
    });

    this.client.on(Events.ClientReady, () => {
      this.emit("ready");
    });

    await this.client.login(this.token);
  }

  async stop(): Promise<void> {
    this.client.destroy();
  }

  private isAllowed(userId: string): boolean {
    return this.allowedUserIds.includes(userId);
  }
}
