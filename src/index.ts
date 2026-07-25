import { Client, GatewayIntentBits, Collection, ActivityType } from 'discord.js';
import { Config } from './config.js';
import { loadCommands } from './handlers/commandHandler.js';
import { loadEvents } from './handlers/eventHandler.js';

// Extend the discord.js Client interface to hold commands and in-memory states
declare module 'discord.js' {
  interface Client {
    commands: Collection<string, any>;
    // Maps channelId -> userId of the moderator who locked the voice channel
    lockedChannels: Map<string, string>;
    // Maps channelId -> userId of the moderator who enabled the guard
    guardedChannels: Map<string, string>;
    // Maps targetUserId -> userId of the moderator who muted (timed out) the user
    mutedUsers: Map<string, string>;
    // Set of user IDs who have authenticated using the ARCH safeguard code
    archUsers: Set<string>;
    
    // Voice Session Whitelist: channelId -> Set of whitelisted userIds
    channelWhitelists: Map<string, Set<string>>;
    // Voice Temp-Kicks: userId -> expiration timestamp (milliseconds)
    voiceTempKicks: Map<string, number>;
  }
}

/**
 * Bootstraps the Discord moderation bot.
 * Configures intents, loads command/event handlers, and starts the gateway client connection.
 */
async function bootstrap() {
  console.log('[System Initialization]: Starting Discord Moderation Bot with Extensions...');

  // Gateway Intents explain:
  // - Guilds: Required for general client events, structure cache, and command parsing.
  // - GuildMembers: Required for managing roles, nicknames, timeouts, kicks, and role hierarchy.
  // - GuildVoiceStates: Required for tracking VC connections, disconnects, and channel joins.
  // - GuildMessages: Required for listening to incoming text messages for filtering.
  // - MessageContent: Required to read message contents for automod word scans (requires Dev Portal toggle).
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // Initialize in-memory state tracking to enforce locking/guard ownership
  client.lockedChannels = new Map();
  client.guardedChannels = new Map();
  client.mutedUsers = new Map();
  client.archUsers = new Set();
  
  // Initialize new extended state tracking
  client.channelWhitelists = new Map();
  client.voiceTempKicks = new Map();

  // Setup presence details
  client.once('ready', () => {
    if (client.user) {
      client.user.setPresence({
        activities: [{ name: 'Server Security (v2)', type: ActivityType.Watching }],
        status: 'online',
      });
      console.log(`[System Ready]: Logged in successfully as ${client.user.tag}`);
    }
  });

  try {
    // Load event listeners and command commands dynamically
    await loadEvents(client);
    await loadCommands(client);

    // Login using bot token
    if (!Config.token) {
      throw new Error('Bot token is missing! Please configure DISCORD_TOKEN in the .env file.');
    }
    await client.login(Config.token);
  } catch (error) {
    console.error('[Fatal Startup Error]: Client failed to initialize:', error);
    process.exit(1);
  }
}

// Execute the bootstrap function
bootstrap();
