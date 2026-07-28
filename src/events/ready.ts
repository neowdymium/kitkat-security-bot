import { Client, Events, REST, Routes } from 'discord.js';
import { Config } from '../config.js';
import { Database } from '../database.js';
import { getGuildState } from '../lib/kitkatState.js';

/**
 * Scans the database for active temporary sanctions and schedules timeouts
 * or processes immediately if their duration expired while the bot was offline.
 */
async function restoreTempSanctions(client: Client): Promise<void> {
  console.log('[KitKat Sanctions]: Restoring active temp-bans and temp-kicks from database...');

  for (const guild of client.guilds.cache.values()) {
    const guildId = guild.id;
    const state = getGuildState(client, guildId);

    // 1. Load and restore Temp Kicks
    const tempKicks = Database.getTempKicks(guildId);
    for (const [userId, record] of Object.entries(tempKicks)) {
      const now = Date.now();
      const timeLeft = record.expiresAt - now;

      // Restore to in-memory state
      state.tempKicks.set(userId, record);

      if (timeLeft <= 0) {
        console.log(`[KitKat Sanctions]: Temp-kick for user ${userId} in guild ${guildId} has expired. Removing...`);
        state.tempKicks.delete(userId);
        Database.removeTempKick(guildId, userId);
      } else {
        console.log(`[KitKat Sanctions]: Rescheduling temp-kick for user ${userId} in guild ${guildId} (${Math.round(timeLeft / 1000)}s remaining)`);
        setTimeout(() => {
          const currentRecord = state.tempKicks.get(userId);
          if (currentRecord && currentRecord.expiresAt === record.expiresAt) {
            state.tempKicks.delete(userId);
            Database.removeTempKick(guildId, userId);
          }
        }, timeLeft);
      }
    }

    // 2. Load and restore Temp Bans
    const tempBans = Database.getTempBans(guildId);
    for (const [userId, record] of Object.entries(tempBans)) {
      const now = Date.now();
      const timeLeft = record.expiresAt - now;

      // Restore to in-memory state
      state.tempBans.set(userId, record);

      if (timeLeft <= 0) {
        console.log(`[KitKat Sanctions]: Temp-ban for user ${userId} in guild ${guildId} has expired. Unbanning immediately...`);
        try {
          await guild.members.unban(userId, `KitKat temp-ban expired (during offline/restart)`);
        } catch (error) {
          console.error(`[KitKat Sanctions]: Failed to unban user ${userId} in guild ${guildId}:`, error);
        } finally {
          state.tempBans.delete(userId);
          Database.removeTempBan(guildId, userId);
        }
      } else {
        console.log(`[KitKat Sanctions]: Rescheduling temp-ban for user ${userId} in guild ${guildId} (${Math.round(timeLeft / 1000)}s remaining)`);
        setTimeout(async () => {
          const currentRecord = state.tempBans.get(userId);
          if (!currentRecord || currentRecord.expiresAt !== record.expiresAt) {
            return;
          }
          try {
            await guild.members.unban(userId, `KitKat temp-ban expired: ${record.reason}`);
          } catch (error) {
            console.error(`[KitKat Sanctions]: Failed to unban user ${userId} in guild ${guildId}:`, error);
          } finally {
            state.tempBans.delete(userId);
            Database.removeTempBan(guildId, userId);
          }
        }, timeLeft);
      }
    }
  }

  console.log('[KitKat Sanctions]: Temp-sanctions restoration complete.');
}

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

      // Restore temp sanctions on startup
      await restoreTempSanctions(client);
    } catch (error) {
      console.error('[KitKat REST Error]: Failed to register slash commands via Discord API:', error);
    }
  },
};
