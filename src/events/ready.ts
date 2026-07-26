import { Client, Events, REST, Routes } from 'discord.js';
import { Config } from '../config.js';

/**
 * Handles the gateway ClientReady event.
 * Performs REST registration of the command definitions loaded into memory.
 */
export default {
  name: Events.ClientReady,
  once: true,
  async execute(client: Client) {
    console.log(`[KitKat Ready]: Bot is authorized as ${client.user?.tag}`);

    const rest = new REST({ version: '10' }).setToken(Config.token);
    
    // Map commands collection to raw JSON slash command definitions
    const commandsJson = client.commands.map((cmd) => cmd.data.toJSON());

    try {
      if (!Config.clientId) {
        console.error('[REST Error]: CLIENT_ID is missing from config. Cannot register commands.');
        return;
      }

      console.log(`[KitKat REST]: Registering ${commandsJson.length} global slash commands...`);

      await rest.put(Routes.applicationCommands(Config.clientId), { body: commandsJson });
      console.log('[KitKat REST]: Global slash commands successfully registered.');
    } catch (error) {
      console.error('[KitKat REST Error]: Failed to register slash commands via Discord API:', error);
    }
  },
};
