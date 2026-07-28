import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve database file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '../database.json');

// Interface defining the schema of our persistent JSON database
// Interface defining the schema of a single guild's persistent configuration
export interface GuildDatabaseSchema {
  blockedTexts: string[];
  blockedLinks: string[];
  loggingChannelId: string | null;
  dmAlertsEnabled: boolean;
  // Maps userId -> array of command scopes (e.g. ["vclock", "vcunlock"] or ["all"])
  permissions: Record<string, string[]>;
  spamExemptUsers: string[];
  // Active temporary kicks and bans persisted to survive bot crashes/restarts
  tempKicks: Record<string, { expiresAt: number; moderatorId: string; reason: string }>;
  tempBans: Record<string, { expiresAt: number; moderatorId: string; reason: string }>;
}

// The database structure maps each guildId to its specific GuildDatabaseSchema
export type DatabaseSchema = Record<string, GuildDatabaseSchema>;

// Default initial state of the database (empty record of guilds)
const DEFAULT_DATA: DatabaseSchema = {};

/**
 * Reads and parses the database JSON file.
 * Automatically initializes the file with DEFAULT_DATA if it does not exist.
 */
function readDb(): DatabaseSchema {
  try {
    if (!fs.existsSync(DB_PATH)) {
      writeDb(DEFAULT_DATA);
      return { ...DEFAULT_DATA };
    }
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('[Database Error]: Failed to read database.json, using defaults:', error);
    return { ...DEFAULT_DATA };
  }
}

/**
 * Writes the configuration schema object back to the database JSON file.
 */
function writeDb(data: DatabaseSchema): void {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('[Database Error]: Failed to write database.json:', error);
  }
}

/**
 * Helper to ensure a guild has its database schema initialized, migrating legacy formats if found.
 */
function getGuildData(db: DatabaseSchema, guildId: string): GuildDatabaseSchema {
  if (!db[guildId]) {
    // If the database is in the old flat format, perform a transparent migration
    if ('blockedTexts' in db) {
      const oldDb = db as unknown as GuildDatabaseSchema;
      db[guildId] = {
        blockedTexts: oldDb.blockedTexts || [],
        blockedLinks: oldDb.blockedLinks || [],
        loggingChannelId: oldDb.loggingChannelId || null,
        dmAlertsEnabled: oldDb.dmAlertsEnabled ?? true,
        permissions: oldDb.permissions || {},
        spamExemptUsers: oldDb.spamExemptUsers || [],
        tempKicks: (oldDb as any).tempKicks || {},
        tempBans: (oldDb as any).tempBans || {},
      };
      // Remove legacy keys
      delete (db as any).blockedTexts;
      delete (db as any).blockedLinks;
      delete (db as any).loggingChannelId;
      delete (db as any).dmAlertsEnabled;
      delete (db as any).permissions;
      delete (db as any).spamExemptUsers;
      delete (db as any).tempKicks;
      delete (db as any).tempBans;
    } else {
      db[guildId] = {
        blockedTexts: [],
        blockedLinks: [],
        loggingChannelId: null,
        dmAlertsEnabled: true,
        permissions: {},
        spamExemptUsers: [],
        tempKicks: {},
        tempBans: {},
      };
    }
  }
  return db[guildId];
}

export const Database = {
  // --- Blocked Words/Phrases ---
  getBlockedTexts(guildId: string): string[] {
    const db = readDb();
    return getGuildData(db, guildId).blockedTexts;
  },

  addBlockedText(guildId: string, phrase: string): boolean {
    const db = readDb();
    const guildData = getGuildData(db, guildId);
    const cleanPhrase = phrase.trim().toLowerCase();
    if (guildData.blockedTexts.includes(cleanPhrase)) return false;
    guildData.blockedTexts.push(cleanPhrase);
    writeDb(db);
    return true;
  },

  replaceBlockedTexts(guildId: string, phrases: string[]): void {
    const db = readDb();
    const guildData = getGuildData(db, guildId);
    guildData.blockedTexts = Array.from(new Set(phrases.map((phrase) => phrase.trim().toLowerCase()).filter(Boolean)));
    writeDb(db);
  },

  removeBlockedText(guildId: string, phrase: string): boolean {
    const db = readDb();
    const guildData = getGuildData(db, guildId);
    const cleanPhrase = phrase.trim().toLowerCase();
    const index = guildData.blockedTexts.indexOf(cleanPhrase);
    if (index === -1) return false;
    guildData.blockedTexts.splice(index, 1);
    writeDb(db);
    return true;
  },

  // --- Blocked Links/Domains ---
  getBlockedLinks(guildId: string): string[] {
    const db = readDb();
    return getGuildData(db, guildId).blockedLinks;
  },

  addBlockedLink(guildId: string, domain: string): boolean {
    const db = readDb();
    const guildData = getGuildData(db, guildId);
    const cleanDomain = domain.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '');
    if (guildData.blockedLinks.includes(cleanDomain)) return false;
    guildData.blockedLinks.push(cleanDomain);
    writeDb(db);
    return true;
  },

  replaceBlockedLinks(guildId: string, domains: string[]): void {
    const db = readDb();
    const guildData = getGuildData(db, guildId);
    guildData.blockedLinks = Array.from(
      new Set(domains.map((domain) => domain.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '')).filter(Boolean))
    );
    writeDb(db);
  },

  removeBlockedLink(guildId: string, domain: string): boolean {
    const db = readDb();
    const guildData = getGuildData(db, guildId);
    const cleanDomain = domain.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '');
    const index = guildData.blockedLinks.indexOf(cleanDomain);
    if (index === -1) return false;
    guildData.blockedLinks.splice(index, 1);
    writeDb(db);
    return true;
  },

  // --- Logging Channel Configuration ---
  getLoggingChannelId(guildId: string): string | null {
    const db = readDb();
    return getGuildData(db, guildId).loggingChannelId;
  },

  setLoggingChannelId(guildId: string, channelId: string | null): void {
    const db = readDb();
    getGuildData(db, guildId).loggingChannelId = channelId;
    writeDb(db);
  },

  // --- DM Alerts Configuration ---
  getDmAlertsEnabled(guildId: string): boolean {
    const db = readDb();
    return getGuildData(db, guildId).dmAlertsEnabled;
  },

  setDmAlertsEnabled(guildId: string, enabled: boolean): void {
    const db = readDb();
    getGuildData(db, guildId).dmAlertsEnabled = enabled;
    writeDb(db);
  },

  // --- Bot Internal Permissions Engine ---
  getUserScopes(guildId: string, userId: string): string[] {
    const db = readDb();
    return getGuildData(db, guildId).permissions[userId] || [];
  },

  addUserPermissions(guildId: string, userId: string, scopes: string[]): void {
    const db = readDb();
    const guildData = getGuildData(db, guildId);
    const currentScopes = guildData.permissions[userId] || [];
    const newScopes = Array.from(new Set([...currentScopes, ...scopes]));
    guildData.permissions[userId] = newScopes;
    writeDb(db);
  },

  removeUserPermissions(guildId: string, userId: string): boolean {
    const db = readDb();
    const guildData = getGuildData(db, guildId);
    if (!guildData.permissions[userId]) return false;
    delete guildData.permissions[userId];
    writeDb(db);
    return true;
  },

  hasPermission(guildId: string, userId: string, commandName: string): boolean {
    const scopes = this.getUserScopes(guildId, userId);
    if (scopes.includes('all')) return true;
    return scopes.includes(commandName.toLowerCase());
  },

  // --- Spam Exemption Whitelist ---
  getSpamExemptUsers(guildId: string): string[] {
    const db = readDb();
    return getGuildData(db, guildId).spamExemptUsers;
  },

  addSpamExemptUser(guildId: string, targetId: string): boolean {
    const db = readDb();
    const guildData = getGuildData(db, guildId);
    if (guildData.spamExemptUsers.includes(targetId)) return false;
    guildData.spamExemptUsers.push(targetId);
    writeDb(db);
    return true;
  },

  removeSpamExemptUser(guildId: string, targetId: string): boolean {
    const db = readDb();
    const guildData = getGuildData(db, guildId);
    const index = guildData.spamExemptUsers.indexOf(targetId);
    if (index === -1) return false;
    guildData.spamExemptUsers.splice(index, 1);
    writeDb(db);
    return true;
  },

  isSpamExempt(guildId: string, targetId: string): boolean {
    const db = readDb();
    return getGuildData(db, guildId).spamExemptUsers.includes(targetId);
  },

  // --- Temp Kicks & Bans Persistence ---
  getTempKicks(guildId: string): Record<string, { expiresAt: number; moderatorId: string; reason: string }> {
    const db = readDb();
    return getGuildData(db, guildId).tempKicks || {};
  },

  addTempKick(guildId: string, userId: string, record: { expiresAt: number; moderatorId: string; reason: string }): void {
    const db = readDb();
    getGuildData(db, guildId).tempKicks[userId] = record;
    writeDb(db);
  },

  removeTempKick(guildId: string, userId: string): void {
    const db = readDb();
    delete getGuildData(db, guildId).tempKicks[userId];
    writeDb(db);
  },

  getTempBans(guildId: string): Record<string, { expiresAt: number; moderatorId: string; reason: string }> {
    const db = readDb();
    return getGuildData(db, guildId).tempBans || {};
  },

  addTempBan(guildId: string, userId: string, record: { expiresAt: number; moderatorId: string; reason: string }): void {
    const db = readDb();
    getGuildData(db, guildId).tempBans[userId] = record;
    writeDb(db);
  },

  removeTempBan(guildId: string, userId: string): void {
    const db = readDb();
    delete getGuildData(db, guildId).tempBans[userId];
    writeDb(db);
  },
};
