import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve directory paths in an ESM environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from the root .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Verify critical configuration properties are set
const requiredEnv = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID', 'ARCH_SAFEGUARD_CODE'];
for (const envVar of requiredEnv) {
  if (!process.env[envVar]) {
    console.warn(`[Config Warning]: Environment variable ${envVar} is missing. Please set it in your .env file.`);
  }
}

/**
 * Global Configuration Object
 * Exposes type-safe environment configuration and default rule parameters.
 */
export const Config = {
  // Credentials
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID || '',

  // Safeguard authentication code for the ARCH bypass role
  archSafeguardCode: process.env.ARCH_SAFEGUARD_CODE || 'SUPER_SECRET_ARCH_CODE_123',

  // Whitelisted Users: Whitelisted user IDs or usernames who are permitted to run restricted commands:
  // (/vclock, /vcunlock, /guard, /unguard, /mute, /unmute)
  // Can be configured in .env as a comma-separated list of IDs, e.g. WHITELISTED_USERS=123456789,987654321
  whitelistedUsers: new Set<string>(
    process.env.WHITELISTED_USERS
      ? process.env.WHITELISTED_USERS.split(',').map((id) => id.trim())
      : ['developer_id_placeholder'] // Fallback/default IDs or usernames
  ),

  // Guard Blacklist IDs: User IDs that are blocked from entering guarded voice channels
  guardBlacklistIds: new Set<string>(
    process.env.GUARD_BLACKLIST_IDS
      ? process.env.GUARD_BLACKLIST_IDS.split(',').map((id) => id.trim())
      : ['blacklist_id_placeholder'] // Example blocked IDs
  ),

  // Banned keywords or regex patterns for the automod filter
  bannedWords: [
    /toxic_word_1/i,
    /toxic_word_2/i,
    'badword',
    'scam-link-domain.com',
  ] as (string | RegExp)[],

  // Anti-spam configuration
  spamLimit: 5,           // Max messages
  spamIntervalMs: 3000,   // Within this duration (3 seconds)
  spamTimeoutDurationMs: 5 * 60 * 1000, // Timeout duration: 5 minutes (in ms)
};
