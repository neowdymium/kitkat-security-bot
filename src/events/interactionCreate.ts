import { Events, Interaction } from 'discord.js';
import { Config } from '../config.js';
import { Database } from '../database.js';

/**
 * Handles incoming interactions from the Discord Gateway.
 * Validates commands, executes the Bot-Specific Internal Permission Engine,
 * and handles execution errors safely.
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

    // List of restricted commands requiring security authorization
    const restrictedCommands = [
      'vclock', 
      'vcunlock', 
      'guard', 
      'unguard', 
      'mute', 
      'unmute', 
      'whitelist', 
      'transfer', 
      'tell', 
      'config', 
      'perm', 
      'automod',
      'blocktext',
      'blocklink',
      'spam'
    ];
    
    if (restrictedCommands.includes(commandName)) {
      const isOwner = guild ? guild.ownerId === user.id : false;
      const isArch = client.archUsers.has(user.id);
      const isLegacyWhitelisted = Config.whitelistedUsers.has(user.id) || Config.whitelistedUsers.has(user.username);
      
      // Check Bot-Specific Internal Permission Engine:
      // Verifies if the user has specific command name scope or 'all' scope in database.json
      const hasInternalScope = Database.hasPermission(user.id, commandName);

      if (!isOwner && !isArch && !isLegacyWhitelisted && !hasInternalScope) {
        await interaction.reply({
          content: '❌ **Access Denied**: You do not have permission to execute this restricted command. Contact the server administrator.',
          ephemeral: true,
        });
        console.log(`[Security Alert]: Unauthorized execution attempt of /${commandName} by ${user.tag} (${user.id}).`);
        return;
      }
    }

    try {
      console.log(`[Interaction]: Running /${commandName} for ${user.tag} (${user.id})`);
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
