import {
  type ForumChannel,
  ChannelType,
  type ThreadChannel,
  type Client,
  type GuildForumTag,
} from "discord.js";

export class ForumManager {
  private forumChannel: ForumChannel | null = null;

  constructor(
    private client: Client,
    private guildId: string,
    private forumChannelId: string
  ) {}

  async init(): Promise<void> {
    const guild = await this.client.guilds.fetch(this.guildId);
    const channel = await guild.channels.fetch(this.forumChannelId);
    if (channel?.type !== ChannelType.GuildForum) {
      throw new Error(`Channel ${this.forumChannelId} is not a Forum channel`);
    }
    this.forumChannel = channel as ForumChannel;
  }

  async createTopic(name: string, initialMessage: string): Promise<ThreadChannel> {
    if (!this.forumChannel) throw new Error("Forum not initialized");
    const thread = await this.forumChannel.threads.create({
      name,
      message: { content: initialMessage },
    });
    return thread;
  }

  async setTopicTag(threadId: string, tagName: string): Promise<void> {
    if (!this.forumChannel) return;
    const thread = await this.forumChannel.threads.fetch(threadId);
    if (!thread) return;
    const tag = this.forumChannel.availableTags.find(
      (t: GuildForumTag) => t.name === tagName
    );
    if (tag) {
      await thread.setAppliedTags([tag.id]);
    }
  }

  async archiveTopic(threadId: string): Promise<void> {
    if (!this.forumChannel) return;
    const thread = await this.forumChannel.threads.fetch(threadId);
    if (thread) {
      await thread.setArchived(true);
    }
  }
}
