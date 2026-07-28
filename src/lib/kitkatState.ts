import {
  Client,
  EmbedBuilder,
  GuildMember,
  PermissionFlagsBits,
  Role,
  TextBasedChannel,
  User,
  VoiceChannel,
} from 'discord.js';

export interface KitKatPermissionGrant {
  kind: 'user' | 'role';
  scopes: Set<string>;
}

export interface KitKatArchRecord {
  isAlpha: boolean;
  grantedBy: string;
  grantedAt: number;
}

export interface KitKatTempKickRecord {
  expiresAt: number;
  moderatorId: string;
  reason: string;
}

export interface KitKatTempBanRecord {
  expiresAt: number;
  moderatorId: string;
  reason: string;
}

export interface KitKatTempVcRecord {
  ownerId: string;
  index: number;
  categoryId: string;
  createdAt: number;
  guardEnabled: boolean;
}

export interface KitKatNicknameRequest {
  id: string;
  guildId: string;
  requesterId: string;
  targetId: string;
  requestedNick: string;
  channelId: string | null;
  messageId: string | null;
  createdAt: number;
}

export interface KitKatLoggingSession {
  guildId: string;
  channelId: string;
  startedBy: string;
  startedAt: number;
  messages: Array<{
    authorTag: string;
    authorId: string;
    content: string;
    createdAt: number;
    attachments: string[];
  }>;
}

export interface KitKatTicketRecord {
  channelId: string;
  creatorId: string;
  reason: string;
  createdAt: number;
}

export interface KitKatGuildState {
  config: {
    loggingChannelId: string | null;
    dmAlertsEnabled: boolean;
    tempVcCategoryId: string | null;
    ticketCategoryId: string | null;
    setnickChannelId: string | null;
  };
  archUsers: Map<string, KitKatArchRecord>;
  permissions: Map<string, KitKatPermissionGrant>;
  vclockBypassRoles: Set<string>;
  lockedChannels: Map<string, string>;
  guardedChannels: Map<string, string>;
  whitelists: Map<string, Set<string>>;
  tempKicks: Map<string, KitKatTempKickRecord>;
  tempBans: Map<string, KitKatTempBanRecord>;
  tempVcs: Map<string, KitKatTempVcRecord>;
  tempVcTimers: Map<string, NodeJS.Timeout>;
  nicknameApprovers: Map<string, 'user' | 'role'>;
  nicknameRequests: Map<string, KitKatNicknameRequest>;
  ticketSupportTargets: Map<string, 'user' | 'role'>;
  ticketRecords: Map<string, KitKatTicketRecord>;
  loggingSessions: Map<string, KitKatLoggingSession>;
  exportDelegates: Set<string>;
}

declare module 'discord.js' {
  interface Client {
    kitkatGuildStates: Map<string, KitKatGuildState>;
  }
}

function createDefaultGuildState(): KitKatGuildState {
  return {
    config: {
      loggingChannelId: null,
      dmAlertsEnabled: true,
      tempVcCategoryId: null,
      ticketCategoryId: null,
      setnickChannelId: null,
    },
    archUsers: new Map(),
    permissions: new Map(),
    vclockBypassRoles: new Set(),
    lockedChannels: new Map(),
    guardedChannels: new Map(),
    whitelists: new Map(),
    tempKicks: new Map(),
    tempBans: new Map(),
    tempVcs: new Map(),
    tempVcTimers: new Map(),
    nicknameApprovers: new Map(),
    nicknameRequests: new Map(),
    ticketSupportTargets: new Map(),
    ticketRecords: new Map(),
    loggingSessions: new Map(),
    exportDelegates: new Set(),
  };
}

export function getGuildState(client: Client, guildId: string): KitKatGuildState {
  if (!client.kitkatGuildStates) {
    client.kitkatGuildStates = new Map();
  }

  let state = client.kitkatGuildStates.get(guildId);
  if (!state) {
    state = createDefaultGuildState();
    client.kitkatGuildStates.set(guildId, state);
  }
  return state;
}

export function getKitKatName(): string {
  return 'KitKat';
}

export function normalizeScope(scope: string): string {
  return scope.trim().toLowerCase();
}

export function normalizeScopes(scopes: string[]): string[] {
  return Array.from(new Set(scopes.map((scope) => normalizeScope(scope)).filter(Boolean)));
}

export function buildKitKatEmbed(title: string, description: string, color: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: 'KitKat Security' })
    .setTimestamp();
}

export function isGuildOwner(member: GuildMember): boolean {
  return member.id === member.guild.ownerId;
}

export function isGuildArch(client: Client, guildId: string, userId: string): boolean {
  return getGuildState(client, guildId).archUsers.has(userId);
}

export function getGuildArchRecord(client: Client, guildId: string, userId: string): KitKatArchRecord | undefined {
  return getGuildState(client, guildId).archUsers.get(userId);
}

export function isAlphaArchon(client: Client, guildId: string, userId: string): boolean {
  return getGuildState(client, guildId).archUsers.get(userId)?.isAlpha ?? false;
}

export function addArchMember(
  client: Client,
  guildId: string,
  userId: string,
  record: KitKatArchRecord
): void {
  getGuildState(client, guildId).archUsers.set(userId, record);
}

export function removeArchMember(client: Client, guildId: string, userId: string): KitKatArchRecord | undefined {
  const state = getGuildState(client, guildId);
  const record = state.archUsers.get(userId);
  if (record) {
    state.archUsers.delete(userId);
  }
  return record;
}

export function getGuildPermissionGrant(
  client: Client,
  guildId: string,
  targetId: string
): KitKatPermissionGrant | undefined {
  return getGuildState(client, guildId).permissions.get(targetId);
}

export function getPermissionGrantsForScope(
  client: Client,
  guildId: string,
  scope: string
): Array<{ targetId: string; kind: 'user' | 'role'; grant: KitKatPermissionGrant }> {
  const normalizedScope = normalizeScope(scope);
  const state = getGuildState(client, guildId);
  const grants: Array<{ targetId: string; kind: 'user' | 'role'; grant: KitKatPermissionGrant }> = [];

  for (const [targetId, grant] of state.permissions.entries()) {
    if (grant.scopes.has('all') || grant.scopes.has(normalizedScope)) {
      grants.push({ targetId, kind: grant.kind, grant });
    }
  }

  return grants;
}

export function setGuildPermissionGrant(
  client: Client,
  guildId: string,
  targetId: string,
  kind: 'user' | 'role',
  scopes: string[]
): void {
  getGuildState(client, guildId).permissions.set(targetId, {
    kind,
    scopes: new Set(normalizeScopes(scopes)),
  });
}

export function deleteGuildPermissionGrant(
  client: Client,
  guildId: string,
  targetId: string
): boolean {
  return getGuildState(client, guildId).permissions.delete(targetId);
}

export function memberHasGuildScope(member: GuildMember, commandName: string): boolean {
  const state = getGuildState(member.client, member.guild.id);
  const normalizedCommand = normalizeScope(commandName);

  const userGrant = state.permissions.get(member.id);
  if (userGrant && (userGrant.scopes.has('all') || userGrant.scopes.has(normalizedCommand))) {
    return true;
  }

  for (const role of member.roles.cache.values()) {
    const roleGrant = state.permissions.get(role.id);
    if (roleGrant && (roleGrant.scopes.has('all') || roleGrant.scopes.has(normalizedCommand))) {
      return true;
    }
  }

  return false;
}

export function memberHasAnyScope(member: GuildMember, scopes: string[]): boolean {
  return scopes.some((scope) => memberHasGuildScope(member, scope));
}

export function canUseKitKatRestrictedCommand(member: GuildMember, commandName: string): boolean {
  return isGuildOwner(member) || isGuildArch(member.client, member.guild.id, member.id) || memberHasGuildScope(member, commandName);
}

export function allowTargetOnLockedChannels(
  client: Client,
  guildId: string,
  targetId: string
): void {
  const state = getGuildState(client, guildId);
  for (const channelId of state.lockedChannels.keys()) {
    const guild = client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(channelId);
    if (channel && 'permissionOverwrites' in channel) {
      void channel.permissionOverwrites.edit(targetId, { Connect: true }).catch(() => {});
    }
  }
}

export function revokeTargetFromLockedChannels(
  client: Client,
  guildId: string,
  targetId: string
): void {
  const state = getGuildState(client, guildId);
  for (const channelId of state.lockedChannels.keys()) {
    const guild = client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(channelId);
    if (channel && 'permissionOverwrites' in channel) {
      void channel.permissionOverwrites.delete(targetId).catch(() => {});
    }
  }
}

export function setGuildLoggingChannel(client: Client, guildId: string, channelId: string | null): void {
  getGuildState(client, guildId).config.loggingChannelId = channelId;
}

export function getGuildLoggingChannelId(client: Client, guildId: string): string | null {
  return getGuildState(client, guildId).config.loggingChannelId;
}

export function setGuildDmAlerts(client: Client, guildId: string, enabled: boolean): void {
  getGuildState(client, guildId).config.dmAlertsEnabled = enabled;
}

export function isGuildDmAlertsEnabled(client: Client, guildId: string): boolean {
  return getGuildState(client, guildId).config.dmAlertsEnabled;
}

export function setTempVcCategory(client: Client, guildId: string, categoryId: string | null): void {
  getGuildState(client, guildId).config.tempVcCategoryId = categoryId;
}

export function getTempVcCategory(client: Client, guildId: string): string | null {
  return getGuildState(client, guildId).config.tempVcCategoryId;
}

export function setTicketCategory(client: Client, guildId: string, categoryId: string | null): void {
  getGuildState(client, guildId).config.ticketCategoryId = categoryId;
}

export function getTicketCategory(client: Client, guildId: string): string | null {
  return getGuildState(client, guildId).config.ticketCategoryId;
}

export function setSetNickChannel(client: Client, guildId: string, channelId: string | null): void {
  getGuildState(client, guildId).config.setnickChannelId = channelId;
}

export function getSetNickChannel(client: Client, guildId: string): string | null {
  return getGuildState(client, guildId).config.setnickChannelId;
}

export function addNicknameApprover(
  client: Client,
  guildId: string,
  targetId: string,
  kind: 'user' | 'role'
): void {
  getGuildState(client, guildId).nicknameApprovers.set(targetId, kind);
}

export function removeNicknameApprover(client: Client, guildId: string, targetId: string): boolean {
  return getGuildState(client, guildId).nicknameApprovers.delete(targetId);
}

export function isNicknameApprover(member: GuildMember): boolean {
  const state = getGuildState(member.client, member.guild.id);
  if (state.nicknameApprovers.has(member.id)) {
    return true;
  }

  for (const role of member.roles.cache.values()) {
    if (state.nicknameApprovers.has(role.id)) {
      return true;
    }
  }

  return false;
}

export function createNicknameRequest(
  client: Client,
  guildId: string,
  request: Omit<KitKatNicknameRequest, 'id' | 'createdAt'>
): KitKatNicknameRequest {
  const id = `${guildId}:${request.targetId}:${Date.now()}`;
  const record: KitKatNicknameRequest = {
    ...request,
    id,
    createdAt: Date.now(),
  };

  getGuildState(client, guildId).nicknameRequests.set(id, record);
  return record;
}

export function getNicknameRequest(client: Client, guildId: string, requestId: string): KitKatNicknameRequest | undefined {
  return getGuildState(client, guildId).nicknameRequests.get(requestId);
}

export function deleteNicknameRequest(client: Client, guildId: string, requestId: string): boolean {
  return getGuildState(client, guildId).nicknameRequests.delete(requestId);
}

export function addVclockBypassRole(client: Client, guildId: string, roleId: string): boolean {
  return getGuildState(client, guildId).vclockBypassRoles.add(roleId).size > 0;
}

export function removeVclockBypassRole(client: Client, guildId: string, roleId: string): boolean {
  return getGuildState(client, guildId).vclockBypassRoles.delete(roleId);
}

export function memberCanBypassVclock(member: GuildMember): boolean {
  const state = getGuildState(member.client, member.guild.id);
  if (isGuildOwner(member) || isGuildArch(member.client, member.guild.id, member.id)) {
    return true;
  }

  if (memberHasAnyScope(member, ['vclock', 'all'])) {
    return true;
  }

  for (const roleId of state.vclockBypassRoles) {
    if (member.roles.cache.has(roleId)) {
      return true;
    }
  }

  return false;
}

export function setExportDelegate(client: Client, guildId: string, userId: string): void {
  getGuildState(client, guildId).exportDelegates.add(userId);
}

export function removeExportDelegate(client: Client, guildId: string, userId: string): boolean {
  return getGuildState(client, guildId).exportDelegates.delete(userId);
}

export function canAccessGuildExport(client: Client, guildId: string, userId: string): boolean {
  if (userId === process.env.DEV_ID) return true;
  return getGuildState(client, guildId).exportDelegates.has(userId);
}

export function getNextTempVcIndex(client: Client, guildId: string, ownerId: string): number | null {
  const state = getGuildState(client, guildId);
  const used = new Set<number>();
  for (const tempVc of state.tempVcs.values()) {
    if (tempVc.ownerId === ownerId) {
      used.add(tempVc.index);
    }
  }

  for (let index = 1; index <= 9; index += 1) {
    if (!used.has(index)) {
      return index;
    }
  }

  return null;
}

export function registerTempVc(
  client: Client,
  guildId: string,
  channelId: string,
  ownerId: string,
  categoryId: string,
  index: number
): KitKatTempVcRecord {
  const record: KitKatTempVcRecord = {
    ownerId,
    index,
    categoryId,
    createdAt: Date.now(),
    guardEnabled: false,
  };

  getGuildState(client, guildId).tempVcs.set(channelId, record);
  return record;
}

export function getTempVcRecord(client: Client, guildId: string, channelId: string): KitKatTempVcRecord | undefined {
  return getGuildState(client, guildId).tempVcs.get(channelId);
}

export function deleteTempVcRecord(client: Client, guildId: string, channelId: string): KitKatTempVcRecord | undefined {
  const state = getGuildState(client, guildId);
  const record = state.tempVcs.get(channelId);
  if (record) {
    state.tempVcs.delete(channelId);
  }
  const timer = state.tempVcTimers.get(channelId);
  if (timer) {
    clearTimeout(timer);
    state.tempVcTimers.delete(channelId);
  }
  state.guardedChannels.delete(channelId);
  state.whitelists.delete(channelId);
  state.lockedChannels.delete(channelId);
  return record;
}

export function scheduleTempVcCleanup(
  client: Client,
  guildId: string,
  channel: VoiceChannel
): void {
  const state = getGuildState(client, guildId);
  const existingTimer = state.tempVcTimers.get(channel.id);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(async () => {
    try {
      const liveChannel = channel.guild.channels.cache.get(channel.id) as VoiceChannel | undefined;
      if (!liveChannel || liveChannel.members.size > 0) {
        return;
      }

      deleteTempVcRecord(client, guildId, channel.id);
      await liveChannel.delete(`KitKat removed inactive temporary voice channel "${channel.name}"`).catch(() => {});
    } catch {
      deleteTempVcRecord(client, guildId, channel.id);
    }
  }, 5 * 60 * 1000);

  state.tempVcTimers.set(channel.id, timer);
}

export function cancelTempVcCleanup(client: Client, guildId: string, channelId: string): void {
  const timer = getGuildState(client, guildId).tempVcTimers.get(channelId);
  if (timer) {
    clearTimeout(timer);
    getGuildState(client, guildId).tempVcTimers.delete(channelId);
  }
}

export async function sendKitKatLog(
  client: Client,
  guildId: string,
  payload: { embeds: EmbedBuilder[] } | string
): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const channelId = getGuildLoggingChannelId(client, guildId);
  if (!channelId) return;

  const channel = guild.channels.cache.get(channelId);
  if (!channel) return;

  const textChannel = channel as unknown as { send?: (value: typeof payload) => Promise<unknown> };
  if (typeof textChannel.send !== 'function') return;

  await textChannel.send(payload).catch(() => {});
}

export function startLoggingSession(
  client: Client,
  guildId: string,
  channelId: string,
  startedBy: string
): KitKatLoggingSession {
  const session: KitKatLoggingSession = {
    guildId,
    channelId,
    startedBy,
    startedAt: Date.now(),
    messages: [],
  };

  getGuildState(client, guildId).loggingSessions.set(channelId, session);
  return session;
}

export function stopLoggingSession(client: Client, guildId: string, channelId: string): KitKatLoggingSession | undefined {
  const state = getGuildState(client, guildId);
  const session = state.loggingSessions.get(channelId);
  if (session) {
    state.loggingSessions.delete(channelId);
  }
  return session;
}

export function getLoggingSession(client: Client, guildId: string, channelId: string): KitKatLoggingSession | undefined {
  return getGuildState(client, guildId).loggingSessions.get(channelId);
}

export function recordLoggingMessage(
  client: Client,
  guildId: string,
  channelId: string,
  payload: {
    authorTag: string;
    authorId: string;
    content: string;
    createdAt: number;
    attachments: string[];
  }
): void {
  const session = getLoggingSession(client, guildId, channelId);
  if (!session) return;
  session.messages.push(payload);
}

export function setTicketSupportTarget(
  client: Client,
  guildId: string,
  targetId: string,
  kind: 'user' | 'role'
): void {
  getGuildState(client, guildId).ticketSupportTargets.set(targetId, kind);
}

export function getTicketSupportTargets(client: Client, guildId: string): Array<{ targetId: string; kind: 'user' | 'role' }> {
  const state = getGuildState(client, guildId);
  return Array.from(state.ticketSupportTargets.entries()).map(([targetId, kind]) => ({ targetId, kind }));
}

export function addTicketRecord(client: Client, guildId: string, record: KitKatTicketRecord): void {
  getGuildState(client, guildId).ticketRecords.set(record.channelId, record);
}

export function getTicketRecord(client: Client, guildId: string, channelId: string): KitKatTicketRecord | undefined {
  return getGuildState(client, guildId).ticketRecords.get(channelId);
}

export function deleteTicketRecord(client: Client, guildId: string, channelId: string): boolean {
  return getGuildState(client, guildId).ticketRecords.delete(channelId);
}

export async function sendKitKatAlert(
  client: Client,
  guildId: string,
  targetUser: User,
  message: string
): Promise<void> {
  if (!isGuildDmAlertsEnabled(client, guildId)) return;
  await targetUser.send({ content: message }).catch(() => {});
}

export function buildVoiceActionEmbed(
  title: string,
  description: string,
  color: number
): EmbedBuilder {
  return buildKitKatEmbed(title, description, color);
}

export function memberIsInTempVc(client: Client, guildId: string, channelId: string): boolean {
  return getGuildState(client, guildId).tempVcs.has(channelId);
}
