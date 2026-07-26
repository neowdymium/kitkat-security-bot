import { Events, Interaction } from 'discord.js';

/**
 * Handles incoming interactions from the Discord Gateway.
 * Dispatches slash commands and leaves fine-grained permission checks to the commands themselves.
 */
export default {
  name: Events.InteractionCreate,
  once: false,
  async execute(interaction: Interaction) {
    if (!interaction.isChatInputCommand()) return;

    const { client, commandName, user, guild } = interaction;
    const command = client.commands.get(commandName);

    if (!command) {
      console.warn(`[Interaction Warning]: Slash command /${commandName} was called but not found in memory.`);
      return;
    }

    try {
      console.log(`[KitKat Interaction]: Running /${commandName} for ${user.tag} (${user.id})`);
      await command.execute(interaction);
    } catch (error) {
      console.error(`[Execution Error]: Failed to execute /${commandName}:`, error);

      const errorMessage = {
        content: '❌ An unexpected error occurred while executing this command. The issue has been logged.',
        ephemeral: true,
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage).catch(() => {});
      } else {
        await interaction.reply(errorMessage).catch(() => {});
      }
    }
  },
};
