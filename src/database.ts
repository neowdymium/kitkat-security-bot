import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve database file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '../database.json');

// Interface defining the schema of our persistent JSON database
export interface DatabaseSchema {
  blockedTexts: string[];
  blockedLinks: string[];
  loggingChannelId: string | null;
  dmAlertsEnabled: boolean;
  // Maps userId -> array of command scopes (e.g. ["vclock", "vcunlock"] or ["all"])
  permissions: Record<string, string[]>;
  spamExemptUsers: string[];
}

// Default initial state of the database
const DEFAULT_DATA: DatabaseSchema = {
  blockedTexts: [],
  blockedLinks: [],
  loggingChannelId: null,
  dmAlertsEnabled: true,
  permissions: {},
  spamExemptUsers: [],
};

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

export const Database = {
  // --- Blocked Words/Phrases ---
  getBlockedTexts(): string[] {
    return readDb().blockedTexts;
  },

  addBlockedText(phrase: string): boolean {
    const db = readDb();
    const cleanPhrase = phrase.trim().toLowerCase();
    if (db.blockedTexts.includes(cleanPhrase)) return false;
    db.blockedTexts.push(cleanPhrase);
    writeDb(db);
    return true;
  },

  removeBlockedText(phrase: string): boolean {
    const db = readDb();
    const cleanPhrase = phrase.trim().toLowerCase();
    const index = db.blockedTexts.indexOf(cleanPhrase);
    if (index === -1) return false;
    db.blockedTexts.splice(index, 1);
    writeDb(db);
    return true;
  },

  // --- Blocked Links/Domains ---
  getBlockedLinks(): string[] {
    return readDb().blockedLinks;
  },

  addBlockedLink(domain: string): boolean {
    const db = readDb();
    const cleanDomain = domain.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '');
    if (db.blockedLinks.includes(cleanDomain)) return false;
    db.blockedLinks.push(cleanDomain);
    writeDb(db);
    return true;
  },

  removeBlockedLink(domain: string): boolean {
    const db = readDb();
    const cleanDomain = domain.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '');
    const index = db.blockedLinks.indexOf(cleanDomain);
    if (index === -1) return false;
    db.blockedLinks.splice(index, 1);
    writeDb(db);
    return true;
  },

  // --- Logging Channel Configuration ---
  getLoggingChannelId(): string | null {
    return readDb().loggingChannelId;
  },

  setLoggingChannelId(channelId: string | null): void {
    const db = readDb();
    db.loggingChannelId = channelId;
    writeDb(db);
  },

  // --- DM Alerts Configuration ---
  getDmAlertsEnabled(): boolean {
    return readDb().dmAlertsEnabled;
  },

  setDmAlertsEnabled(enabled: boolean): void {
    const db = readDb();
    db.dmAlertsEnabled = enabled;
    writeDb(db);
  },

  // --- Bot Internal Permissions Engine ---
  getUserScopes(userId: string): string[] {
    return readDb().permissions[userId] || [];
  },

  addUserPermissions(userId: string, scopes: string[]): void {
    const db = readDb();
    const currentScopes = db.permissions[userId] || [];
    const newScopes = Array.from(new Set([...currentScopes, ...scopes]));
    db.permissions[userId] = newScopes;
    writeDb(db);
  },

  removeUserPermissions(userId: string): boolean {
    const db = readDb();
    if (!db.permissions[userId]) return false;
    delete db.permissions[userId];
    writeDb(db);
    return true;
  },

  hasPermission(userId: string, commandName: string): boolean {
    const scopes = this.getUserScopes(userId);
    if (scopes.includes('all')) return true;
    return scopes.includes(commandName.toLowerCase());
  },

  // --- Spam Exemption Whitelist ---
  getSpamExemptUsers(): string[] {
    return readDb().spamExemptUsers;
  },

  addSpamExemptUser(targetId: string): boolean {
    const db = readDb();
    if (db.spamExemptUsers.includes(targetId)) return false;
    db.spamExemptUsers.push(targetId);
    writeDb(db);
    return true;
  },

  removeSpamExemptUser(targetId: string): boolean {
    const db = readDb();
    const index = db.spamExemptUsers.indexOf(targetId);
    if (index === -1) return false;
    db.spamExemptUsers.splice(index, 1);
    writeDb(db);
    return true;
  },

  isSpamExempt(targetId: string): boolean {
    return readDb().spamExemptUsers.includes(targetId);
  },
};
