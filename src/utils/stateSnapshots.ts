import { AttachmentBuilder, Client } from 'discord.js';
import zlib from 'zlib';
import { Database } from '../database.js';
import {
  KitKatGuildState,
  deleteGuildPermissionGrant,
  deleteNicknameRequest,
  deleteTempVcRecord,
  getGuildState,
  removeExportDelegate,
  removeNicknameApprover,
  setExportDelegate,
  setGuildDmAlerts,
  setGuildLoggingChannel,
  setGuildPermissionGrant,
  setSetNickChannel,
  setTempVcCategory,
  setTicketCategory,
  setTicketSupportTarget,
  addArchMember,
  registerTempVc,
  setGuildAfkChannel,
} from '../lib/kitkatState.js';
import { Config } from '../config.js';

export type KitKatExportScope = 'all' | 'config' | 'perm' | 'words' | 'links' | 'voice' | 'setnick' | 'ticket';
export type KitKatExportFormat = 'json' | 'compact';

export interface KitKatSnapshotPayload {
  schema: 'kitkat.snapshot.v1';
  guildId: string;
  exportedAt: string;
  scopes: KitKatExportScope[];
  database?: {
    blockedTexts: string[];
    blockedLinks: string[];
  };
  config?: Record<string, string | boolean | null>;
  permissions?: {
    archUsers: Array<[string, { isAlpha: boolean; grantedBy: string; grantedAt: number }]>;
    grants: Array<[string, { kind: 'user' | 'role'; scopes: string[] }]>;
    vclockBypassRoles: string[];
    whitelists: Array<[string, string[]]>;
    exportDelegates: string[];
  };
  voice?: {
    lockedChannels: Array<[string, string]>;
    guardedChannels: Array<[string, string]>;
    tempVcs: Array<[string, { ownerId: string; index: number; categoryId: string; createdAt: number; guardEnabled: boolean }]>;
  };
  setnick?: {
    channelId: string | null;
    approvers: Array<[string, 'user' | 'role']>;
  };
  ticket?: {
    categoryId: string | null;
    supportTargets: Array<[string, 'user' | 'role']>;
  };
}

function pickScopes(scopes: KitKatExportScope[]): KitKatExportScope[] {
  return scopes.includes('all')
    ? ['config', 'perm', 'words', 'links', 'voice', 'setnick', 'ticket']
    : scopes;
}

export function buildGuildSnapshot(client: Client, guildId: string, scopes: KitKatExportScope[]): KitKatSnapshotPayload {
  const state = getGuildState(client, guildId);
  const expandedScopes = pickScopes(scopes);
  const payload: KitKatSnapshotPayload = {
    schema: 'kitkat.snapshot.v1',
    guildId,
    exportedAt: new Date().toISOString(),
    scopes: expandedScopes,
  };

  if (expandedScopes.includes('words')) {
    payload.database = payload.database || { blockedTexts: [], blockedLinks: [] };
    payload.database.blockedTexts = Database.getBlockedTexts(guildId);
  }

  if (expandedScopes.includes('links')) {
    payload.database = payload.database || { blockedTexts: [], blockedLinks: [] };
    payload.database.blockedLinks = Database.getBlockedLinks(guildId);
  }

  if (expandedScopes.includes('config')) {
    payload.config = {
      loggingChannelId: state.config.loggingChannelId,
      dmAlertsEnabled: state.config.dmAlertsEnabled,
      tempVcCategoryId: state.config.tempVcCategoryId,
      ticketCategoryId: state.config.ticketCategoryId,
      setnickChannelId: state.config.setnickChannelId,
      afkChannelId: state.config.afkChannelId,
    };
  }

  if (expandedScopes.includes('perm')) {
    payload.permissions = {
      archUsers: Array.from(state.archUsers.entries()),
      grants: Array.from(state.permissions.entries()).map(([targetId, grant]) => [
        targetId,
        { kind: grant.kind, scopes: Array.from(grant.scopes) },
      ]),
      vclockBypassRoles: Array.from(state.vclockBypassRoles),
      whitelists: Array.from(state.whitelists.entries()).map(([channelId, list]) => [channelId, Array.from(list)]),
      exportDelegates: Array.from(state.exportDelegates),
    };
  }

  if (expandedScopes.includes('voice')) {
    payload.voice = {
      lockedChannels: Array.from(state.lockedChannels.entries()),
      guardedChannels: Array.from(state.guardedChannels.entries()),
      tempVcs: Array.from(state.tempVcs.entries()),
    };
  }

  if (expandedScopes.includes('setnick')) {
    payload.setnick = {
      channelId: state.config.setnickChannelId,
      approvers: Array.from(state.nicknameApprovers.entries()),
    };
  }

  if (expandedScopes.includes('ticket')) {
    payload.ticket = {
      categoryId: state.config.ticketCategoryId,
      supportTargets: Array.from(state.ticketSupportTargets.entries()),
    };
  }

  return payload;
}

export function applyGuildSnapshot(client: Client, snapshot: KitKatSnapshotPayload): void {
  const state = getGuildState(client, snapshot.guildId);

  if (snapshot.database?.blockedTexts) {
    Database.replaceBlockedTexts(snapshot.guildId, snapshot.database.blockedTexts);
  }

  if (snapshot.database?.blockedLinks) {
    Database.replaceBlockedLinks(snapshot.guildId, snapshot.database.blockedLinks);
  }

  if (snapshot.config) {
    if ('loggingChannelId' in snapshot.config) {
      setGuildLoggingChannel(client, snapshot.guildId, (snapshot.config.loggingChannelId as string | null) ?? null);
    }
    if ('dmAlertsEnabled' in snapshot.config) {
      setGuildDmAlerts(client, snapshot.guildId, Boolean(snapshot.config.dmAlertsEnabled));
    }
    if ('tempVcCategoryId' in snapshot.config) {
      setTempVcCategory(client, snapshot.guildId, (snapshot.config.tempVcCategoryId as string | null) ?? null);
    }
    if ('ticketCategoryId' in snapshot.config) {
      setTicketCategory(client, snapshot.guildId, (snapshot.config.ticketCategoryId as string | null) ?? null);
    }
    if ('setnickChannelId' in snapshot.config) {
      setSetNickChannel(client, snapshot.guildId, (snapshot.config.setnickChannelId as string | null) ?? null);
    }
    if ('afkChannelId' in snapshot.config) {
      setGuildAfkChannel(client, snapshot.guildId, (snapshot.config.afkChannelId as string | null) ?? null);
    }
  }

  if (snapshot.permissions) {
    state.archUsers.clear();
    snapshot.permissions.archUsers.forEach(([userId, record]) => {
      addArchMember(client, snapshot.guildId, userId, record);
    });

    state.permissions.clear();
    snapshot.permissions.grants.forEach(([targetId, grant]) => {
      setGuildPermissionGrant(client, snapshot.guildId, targetId, grant.kind, grant.scopes);
    });

    state.vclockBypassRoles = new Set(snapshot.permissions.vclockBypassRoles);

    state.whitelists.clear();
    snapshot.permissions.whitelists.forEach(([channelId, list]) => {
      state.whitelists.set(channelId, new Set(list));
    });

    state.exportDelegates = new Set(snapshot.permissions.exportDelegates);
  }

  if (snapshot.voice) {
    state.lockedChannels = new Map(snapshot.voice.lockedChannels);
    state.guardedChannels = new Map(snapshot.voice.guardedChannels);
    state.tempVcs = new Map(snapshot.voice.tempVcs);
  }

  if (snapshot.setnick) {
    state.nicknameApprovers.clear();
    snapshot.setnick.approvers.forEach(([targetId, kind]) => {
      state.nicknameApprovers.set(targetId, kind);
    });
  }

  if (snapshot.ticket) {
    state.ticketSupportTargets.clear();
    snapshot.ticket.supportTargets.forEach(([targetId, kind]) => {
      setTicketSupportTarget(client, snapshot.guildId, targetId, kind);
    });
  }
}

export function encodeSnapshot(snapshot: KitKatSnapshotPayload, format: KitKatExportFormat): Buffer {
  const json = JSON.stringify(snapshot, null, format === 'json' ? 2 : 0);
  if (format === 'json') {
    return Buffer.from(json, 'utf8');
  }

  return zlib.gzipSync(Buffer.from(json, 'utf8'));
}

export function decodeSnapshot(buffer: Buffer): KitKatSnapshotPayload {
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  if (buffer.length > MAX_SIZE) {
    throw new Error('Snapshot file size exceeds the 10MB safety limit.');
  }

  let content: string;
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    const decompressed = zlib.gunzipSync(buffer);
    if (decompressed.length > MAX_SIZE) {
      throw new Error('Decompressed snapshot content exceeds the 10MB safety limit.');
    }
    content = decompressed.toString('utf8');
  } else {
    content = buffer.toString('utf8');
  }

  const parsed = JSON.parse(content) as KitKatSnapshotPayload;
  if (parsed.schema !== 'kitkat.snapshot.v1') {
    throw new Error('Unsupported snapshot schema.');
  }
  return parsed;
}

export function buildSnapshotAttachment(snapshot: KitKatSnapshotPayload, format: KitKatExportFormat): AttachmentBuilder {
  const extension = format === 'json' ? 'json' : 'kitkat';
  const filename = `kitkat-${snapshot.guildId}-${Date.now()}.${extension}`;
  return new AttachmentBuilder(encodeSnapshot(snapshot, format), { name: filename });
}

export async function sendDeveloperBackup(client: Client, guildId: string, scopes: KitKatExportScope[]): Promise<void> {
  if (!Config.devId) return;

  try {
    const user = await client.users.fetch(Config.devId);
    const snapshot = buildGuildSnapshot(client, guildId, scopes);
    const attachment = buildSnapshotAttachment(snapshot, 'compact');
    await user.send({
      content: `KitKat backup snapshot for guild \`${guildId}\` (${snapshot.scopes.join(', ')}).`,
      files: [attachment],
    });
  } catch (error) {
    console.error('[KitKat Backup Error]:', error);
  }
}
