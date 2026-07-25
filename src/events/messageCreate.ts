import { Events, Message } from 'discord.js';
import { runMessagePipeline } from '../middleware/messagePipeline.js';

/**
 * Handles the gateway messageCreate event.
 * Passes incoming messages to the extensible Middleware Pipeline system.
 */
export default {
  name: Events.MessageCreate,
  once: false,
  async execute(message: Message) {
    // Ignore messages sent by bots
    if (message.author.bot) return;

    // Filter out messages not from a guild
    if (!message.guild || !message.member) return;

    try {
      // Execute the message filtering and moderation pipeline
      await runMessagePipeline(message, message.client);
    } catch (error) {
      console.error('[Pipeline Error]: Execution failed in messageCreate event:', error);
    }
  },
};
