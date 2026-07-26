import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve directory paths in an ESM environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from the root .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Verify critical configuration properties are set
const requiredEnv = ['DISCORD_TOKEN', 'CLIENT_ID', 'DEV_ID'];
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
  botName: 'KitKat',
  // Credentials
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  devId: process.env.DEV_ID || '',

  // Safeguard authentication code for the ARCH system
  archSafeguardCode:
    process.env.SUPER_SECRET_ARCH_CODE ||
    process.env.ARCH_SAFEGUARD_CODE ||
    'SUPER_SECRET_ARCH_CODE_123',

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
