import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  GuildMember,
  Role,
  EmbedBuilder,
  User,
  VoiceChannel,
  PermissionOverwriteOptions,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import ms from 'ms';
import {
  buildKitKatEmbed,
  createNicknameRequest,
  deleteNicknameRequest,
  getGuildState,
  getSetNickChannel,
  isGuildArch,
  isNicknameApprover,
  memberHasGuildScope,
  addNicknameApprover,
  sendKitKatAlert,
  sendKitKatLog,
  setSetNickChannel,
} from '../../lib/kitkatState.js';
import { sendDeveloperBackup } from '../../utils/stateSnapshots.js';

function canModerateWithScope(member: GuildMember, scope: string, permission: bigint): boolean {
  return member.permissions.has(permission) || memberHasGuildScope(member, scope);
}

async function fetchMemberIfPresent(interaction: ChatInputCommandInteraction, userId: string): Promise<GuildMember | null> {
  return interaction.guild?.members.fetch(userId).catch(() => null) ?? null;
}

function moderationBlockedReason(member: GuildMember, target: GuildMember): string | null {
  if (target.id === member.guild.ownerId) {
    return 'Cannot apply sanctions to the server owner.';
  }

  if (target.id === member.client.user?.id) {
    return 'KitKat cannot sanction itself.';
  }

  if (isGuildArch(member.client, member.guild.id, target.id)) {
    return 'ARCH members are immune to moderation sanctions.';
  }

  return null;
}

function isRoleMentionable(value: Role | User): value is Role {
  return 'position' in value;
}

function labelForMentionable(value: Role | User): string {
  return isRoleMentionable(value) ? value.name : value.tag;
}

async function ensureTargetHierarchy(
  interaction: ChatInputCommandInteraction,
  target: GuildMember,
  requiredPermission: bigint,
  scope: string
): Promise<string | null> {
  const executor = interaction.member as GuildMember;
  const bot = interaction.guild?.members.me;

  if (!interaction.guild || !bot) {
    return 'This command can only be used inside a server.';
  }

  if (!bot.permissions.has(requiredPermission)) {
    return `KitKat needs the required Discord permission to do that.`;
  }

  const blocked = moderationBlockedReason(executor, target);
  if (blocked) {
    return blocked;
  }

  if (target.roles.highest.position >= bot.roles.highest.position) {
    return `KitKat cannot moderate **${target.user.tag}** because their top role is equal to or higher than mine.`;
  }

  if (!executor.permissions.has(requiredPermission) && !memberHasGuildScope(executor, scope)) {
    return `You need the Discord permission or a KitKat \`${scope}\` scope to use this command.`;
  }

  if (!isGuildArch(executor.client, executor.guild.id, executor.id) && target.roles.highest.position >= executor.roles.highest.position) {
    return `You cannot moderate **${target.user.tag}** because their top role is equal to or higher than yours.`;
  }

  return null;
}

async function dispatchModerationAlert(
  interaction: ChatInputCommandInteraction,
  target: User,
  title: string,
  description: string,
  color: number,
  dmMessage: string
): Promise<void> {
  await sendKitKatAlert(interaction.client, interaction.guildId!, target, dmMessage);
  await sendKitKatLog(
    interaction.client,
    interaction.guildId!,
    { embeds: [buildKitKatEmbed(title, description, color)] }
  );
}

async function muteVoiceChannelMembers(
  interaction: ChatInputCommandInteraction,
  voiceChannel: VoiceChannel,
  muteState: boolean
): Promise<number> {
  const executor = interaction.member as GuildMember;
  const bot = interaction.guild?.members.me;

  if (!bot || !bot.permissionsIn(voiceChannel).has(PermissionFlagsBits.ManageChannels) && !bot.permissions.has(PermissionFlagsBits.MuteMembers)) {
    throw new Error('KitKat lacks the permissions required to modify this voice channel.');
  }

  const everyoneOverwrite: PermissionOverwriteOptions = {
    Speak: muteState ? false : null,
  };
  await voiceChannel.permissionOverwrites.edit(interaction.guild!.roles.everyone, everyoneOverwrite);

  const targetMembers = Array.from(voiceChannel.members.values()).filter((member) => !member.user.bot);
  let affected = 0;

  for (const member of targetMembers) {
    if (isGuildArch(member.client, member.guild.id, member.id)) {
      continue;
    }

    if (muteState) {
      await member.voice.setMute(true, `KitKat bulk mute by ${executor.user.tag}`).catch(() => {});
    } else {
      await member.voice.setMute(false, `KitKat bulk unmute by ${executor.user.tag}`).catch(() => {});
    }
    affected += 1;
  }

  return affected;
}

async function deafenVoiceChannelMembers(
  interaction: ChatInputCommandInteraction,
  voiceChannel: VoiceChannel,
  deafenState: boolean
): Promise<number> {
  const executor = interaction.member as GuildMember;
  const bot = interaction.guild?.members.me;

  if (!bot || !bot.permissions.has(PermissionFlagsBits.DeafenMembers)) {
    throw new Error('KitKat lacks the permissions required to deafen members.');
  }

  const targetMembers = Array.from(voiceChannel.members.values()).filter((member) => !member.user.bot);
  let affected = 0;

  for (const member of targetMembers) {
    if (isGuildArch(member.client, member.guild.id, member.id)) {
      continue;
    }

    await member.voice.setDeaf(deafenState, `KitKat bulk ${deafenState ? 'deafen' : 'undeafen'} by ${executor.user.tag}`).catch(() => {});
    affected += 1;
  }

  return affected;
}

async function parseDurationInput(durationInput: string): Promise<number | null> {
  const parsed = ms(durationInput);
  if (typeof parsed === 'number' && parsed > 0) {
    return parsed;
  }

  const fallbackSeconds = Number.parseInt(durationInput, 10);
  if (!Number.isNaN(fallbackSeconds) && fallbackSeconds > 0) {
    return fallbackSeconds * 1000;
  }

  return null;
}

export const TempKickCommand = {
  data: new SlashCommandBuilder()
    .setName('tempkick')
    .setDescription('Disconnects a member from voice and blocks re-entry temporarily.')
    .addUserOption((option) =>
      option.setName('target').setDescription('The member to voice temp-kick').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('duration').setDescription('Duration of voice block (e.g. 180s, 5m, 10m)').setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const executor = interaction.member as GuildMember;
    const bot = interaction.guild?.members.me;
    const targetUser = interaction.options.getUser('target', true);
    const durationInput = interaction.options.getString('duration', true);
    const target = await fetchMemberIfPresent(interaction, targetUser.id);

    if (!target) {
      return interaction.reply({ content: '❌ Target member not found in this guild.', ephemeral: true });
    }

    const blocked = moderationBlockedReason(executor, target);
    if (blocked) {
      return interaction.reply({ content: `❌ ${blocked}`, ephemeral: true });
    }

    if (!bot || !bot.permissions.has(PermissionFlagsBits.MoveMembers)) {
      return interaction.reply({ content: '❌ KitKat needs Move Members permission for temp-kicks.', ephemeral: true });
    }

    if (!canModerateWithScope(executor, 'tempkick', PermissionFlagsBits.MoveMembers)) {
      return interaction.reply({
        content: '❌ You need Move Members or a KitKat `tempkick` scope to use this command.',
        ephemeral: true,
      });
    }

    const duration = await parseDurationInput(durationInput);
    if (!duration) {
      return interaction.reply({
        content: '❌ Please provide a valid duration such as `180s`, `5m`, or `10m`.',
        ephemeral: true,
      });
    }

    const state = getGuildState(interaction.client, interaction.guildId!);
    const expiresAt = Date.now() + duration;

    try {
      if (target.voice.channel) {
        await target.voice.disconnect('KitKat temporary voice kick');
      }

      state.tempKicks.set(target.id, {
        expiresAt,
        moderatorId: interaction.user.id,
        reason: `Temp-kick by KitKat for ${durationInput}`,
      });

      setTimeout(() => {
        const record = state.tempKicks.get(target.id);
        if (record && record.expiresAt === expiresAt) {
          state.tempKicks.delete(target.id);
        }
      }, duration);

      await dispatchModerationAlert(
        interaction,
        target.user,
        '🔇 KitKat Temp-Kick Applied',
        `**${target.user.tag}** was disconnected from voice and blocked for **${durationInput}**.`,
        0xff5500,
        `⚠️ **KitKat Notice**: You were temporarily blocked from joining voice in **${interaction.guild!.name}** for **${durationInput}**.`
      );

      await interaction.reply({
        content: `👢 **KitKat Temp-Kick**: **${target.user.tag}** has been disconnected and blocked from voice for **${durationInput}**.`,
      });
    } catch (error) {
      console.error('[KitKat TempKick Error]:', error);
      await interaction.reply({ content: '❌ Failed to execute the temporary voice kick.', ephemeral: true });
    }
  },
};

export const MuteCommand = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Mute one member or everyone in your current voice channel.')
    .addSubcommand((sub) =>
      sub
        .setName('user')
        .setDescription('Apply a Discord server mute to a member.')
        .addUserOption((option) =>
          option.setName('target').setDescription('The member to mute').setRequired(true)
        )
        .addStringOption((option) =>
          option.setName('duration').setDescription('Mute duration (e.g. 10m, 1h, 1d)').setRequired(true)
        )
        .addStringOption((option) =>
          option.setName('reason').setDescription('Reason for the mute').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('all')
        .setDescription('Mute every non-ARCH member in your current voice channel.')
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const executor = interaction.member as GuildMember;
    const bot = interaction.guild?.members.me;

    if (sub === 'all') {
      const voiceChannel = executor.voice.channel as VoiceChannel | null;
      if (!voiceChannel) {
        return interaction.reply({
          content: '❌ You need to join a voice channel before using `/mute all`.',
          ephemeral: true,
        });
      }

      if (!canModerateWithScope(executor, 'mute', PermissionFlagsBits.MuteMembers)) {
        return interaction.reply({
          content: '❌ You need Mute Members or a KitKat `mute` scope to use `/mute all`.',
          ephemeral: true,
        });
      }

      if (!bot || !bot.permissions.has(PermissionFlagsBits.MuteMembers)) {
        return interaction.reply({
          content: '❌ KitKat needs the Mute Members permission to server-mute people.',
          ephemeral: true,
        });
      }

      try {
        const affected = await muteVoiceChannelMembers(interaction, voiceChannel, true);
        await dispatchModerationAlert(
          interaction,
          executor.user,
          '🔇 KitKat Bulk Voice Mute',
          `Muted **${affected}** members in <#${voiceChannel.id}>.`,
          0xff0000,
          `⚠️ **KitKat Notice**: Voice mute was enabled in **${interaction.guild!.name}**.`
        );

        await interaction.reply({
          content: `🔇 **KitKat Bulk Mute**: Muted **${affected}** members in **${voiceChannel.name}**.`,
        });
      } catch (error) {
        console.error('[KitKat Bulk Mute Error]:', error);
        await interaction.reply({ content: '❌ Failed to mute everyone in the voice channel.', ephemeral: true });
      }

      return;
    }

    const targetUser = interaction.options.getUser('target', true);
    const durationInput = interaction.options.getString('duration', true);
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const target = await fetchMemberIfPresent(interaction, targetUser.id);

    if (!target) {
      return interaction.reply({ content: '❌ Target member not found.', ephemeral: true });
    }

    const blocked = moderationBlockedReason(executor, target);
    if (blocked) {
      return interaction.reply({ content: `❌ ${blocked}`, ephemeral: true });
    }

    if (!canModerateWithScope(executor, 'mute', PermissionFlagsBits.MuteMembers)) {
      return interaction.reply({
        content: '❌ You need Mute Members or a KitKat `mute` scope to use this command.',
        ephemeral: true,
      });
    }

    if (!bot || !bot.permissions.has(PermissionFlagsBits.MuteMembers)) {
      return interaction.reply({ content: '❌ KitKat needs the Mute Members permission.', ephemeral: true });
    }

    const duration = await parseDurationInput(durationInput);
    if (!duration) {
      return interaction.reply({
        content: '❌ Please use a valid duration such as `10m`, `2h`, or `3d`.',
        ephemeral: true,
      });
    }

    const maxTimeout = 28 * 24 * 60 * 60 * 1000;
    if (duration > maxTimeout) {
      return interaction.reply({ content: '❌ Discord timeouts cannot exceed 28 days.', ephemeral: true });
    }

    try {
      await target.timeout(duration, reason);

      const state = getGuildState(interaction.client, interaction.guildId!);
      state.tempKicks.delete(target.id);

      await dispatchModerationAlert(
        interaction,
        target.user,
        '🔇 KitKat Timeout Applied',
        `**${target.user.tag}** was timed out for **${durationInput}**.\nReason: ${reason}`,
        0xff0000,
        `⚠️ **KitKat Notice**: You were timed out in **${interaction.guild!.name}** for **${durationInput}**.\nReason: ${reason}`
      );

      await interaction.reply({
        content: `🔇 **KitKat Mute**: **${target.user.tag}** has been timed out for **${durationInput}**.\n**Reason**: ${reason}`,
      });
    } catch (error) {
      console.error('[KitKat Mute Error]:', error);
      await interaction.reply({ content: '❌ Failed to mute the target user.', ephemeral: true });
    }
  },
};

export const UnmuteCommand = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Unmute one member or everyone in your current voice channel.')
    .addSubcommand((sub) =>
      sub
        .setName('user')
        .setDescription('Remove a Discord server mute from a member.')
        .addUserOption((option) =>
          option.setName('target').setDescription('The member to unmute').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('all')
        .setDescription('Unmute every member in your current voice channel.')
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const executor = interaction.member as GuildMember;
    const bot = interaction.guild?.members.me;

    if (sub === 'all') {
      const voiceChannel = executor.voice.channel as VoiceChannel | null;
      if (!voiceChannel) {
        return interaction.reply({
          content: '❌ You need to join a voice channel before using `/unmute all`.',
          ephemeral: true,
        });
      }

      if (!canModerateWithScope(executor, 'unmute', PermissionFlagsBits.MuteMembers)) {
        return interaction.reply({
          content: '❌ You need Mute Members or a KitKat `unmute` scope to use `/unmute all`.',
          ephemeral: true,
        });
      }

      if (!bot || !bot.permissions.has(PermissionFlagsBits.MuteMembers)) {
        return interaction.reply({
          content: '❌ KitKat needs the Mute Members permission to unmute people.',
          ephemeral: true,
        });
      }

      try {
        const affected = await muteVoiceChannelMembers(interaction, voiceChannel, false);
        await interaction.reply({
          content: `🔊 **KitKat Bulk Unmute**: Restored voice permissions for **${affected}** members in **${voiceChannel.name}**.`,
        });
      } catch (error) {
        console.error('[KitKat Bulk Unmute Error]:', error);
        await interaction.reply({ content: '❌ Failed to unmute everyone in the voice channel.', ephemeral: true });
      }

      return;
    }

    const targetUser = interaction.options.getUser('target', true);
    const target = await fetchMemberIfPresent(interaction, targetUser.id);

    if (!target) {
      return interaction.reply({ content: '❌ Target member not found.', ephemeral: true });
    }

    const blocked = moderationBlockedReason(executor, target);
    if (blocked) {
      return interaction.reply({ content: `❌ ${blocked}`, ephemeral: true });
    }

    if (!canModerateWithScope(executor, 'unmute', PermissionFlagsBits.MuteMembers)) {
      return interaction.reply({
        content: '❌ You need Mute Members or a KitKat `unmute` scope to use this command.',
        ephemeral: true,
      });
    }

    if (!bot || !bot.permissions.has(PermissionFlagsBits.MuteMembers)) {
      return interaction.reply({ content: '❌ KitKat needs the Mute Members permission.', ephemeral: true });
    }

    try {
      await target.timeout(null, `KitKat unmute by ${interaction.user.tag}`);
      await interaction.reply({
        content: `🔊 **KitKat Unmute**: Timeout removed from **${target.user.tag}**.`,
      });
    } catch (error) {
      console.error('[KitKat Unmute Error]:', error);
      await interaction.reply({ content: '❌ Failed to unmute the target user.', ephemeral: true });
    }
  },
};

export const BanCommand = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user from the server.')
    .addUserOption((option) =>
      option.setName('target').setDescription('The user to ban').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Reason for the ban').setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const executor = interaction.member as GuildMember;
    const targetUser = interaction.options.getUser('target', true);
    const reason = interaction.options.getString('reason', true);
    const targetMember = await fetchMemberIfPresent(interaction, targetUser.id);

    if (!canModerateWithScope(executor, 'ban', PermissionFlagsBits.BanMembers)) {
      return interaction.reply({
        content: '❌ You need Ban Members or a KitKat `ban` scope to use this command.',
        ephemeral: true,
      });
    }

    if (targetMember) {
      const blocked = moderationBlockedReason(executor, targetMember);
      if (blocked) {
        return interaction.reply({ content: `❌ ${blocked}`, ephemeral: true });
      }
    }

    try {
      await interaction.guild!.members.ban(targetUser.id, { reason });

      await dispatchModerationAlert(
        interaction,
        targetUser,
        '⛔ KitKat Ban Applied',
        `**${targetUser.tag}** was banned from **${interaction.guild!.name}**.\nReason: ${reason}`,
        0xaa0000,
        `⚠️ **KitKat Notice**: You were banned from **${interaction.guild!.name}**.\nReason: ${reason}`
      );

      await interaction.reply({
        content: `⛔ **KitKat Ban**: **${targetUser.tag}** has been banned.\n**Reason**: ${reason}`,
      });
    } catch (error) {
      console.error('[KitKat Ban Error]:', error);
      await interaction.reply({ content: '❌ Failed to ban the target user.', ephemeral: true });
    }
  },
};

export const TempBanCommand = {
  data: new SlashCommandBuilder()
    .setName('tempban')
    .setDescription('Temporarily ban a user and automatically unban them later.')
    .addUserOption((option) =>
      option.setName('target').setDescription('The user to temp-ban').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('duration').setDescription('Duration such as 1h or 1d').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Reason for the temp-ban').setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const executor = interaction.member as GuildMember;
    const targetUser = interaction.options.getUser('target', true);
    const durationInput = interaction.options.getString('duration', true);
    const reason = interaction.options.getString('reason', true);
    const duration = await parseDurationInput(durationInput);
    const targetMember = await fetchMemberIfPresent(interaction, targetUser.id);

    if (!canModerateWithScope(executor, 'tempban', PermissionFlagsBits.BanMembers)) {
      return interaction.reply({
        content: '❌ You need Ban Members or a KitKat `tempban` scope to use this command.',
        ephemeral: true,
      });
    }

    if (!duration) {
      return interaction.reply({ content: '❌ Please provide a valid duration such as `1h` or `1d`.', ephemeral: true });
    }

    if (targetMember) {
      const blocked = moderationBlockedReason(executor, targetMember);
      if (blocked) {
        return interaction.reply({ content: `❌ ${blocked}`, ephemeral: true });
      }
    }

    const state = getGuildState(interaction.client, interaction.guildId!);
    const expiresAt = Date.now() + duration;

    try {
      await interaction.guild!.members.ban(targetUser.id, { reason });
      state.tempBans.set(targetUser.id, {
        expiresAt,
        moderatorId: interaction.user.id,
        reason,
      });

      setTimeout(async () => {
        const record = state.tempBans.get(targetUser.id);
        if (!record || record.expiresAt !== expiresAt) {
          return;
        }

        try {
          await interaction.guild!.members.unban(targetUser.id, `KitKat temp-ban expired: ${record.reason}`);
        } catch (error) {
          console.error('[KitKat TempBan Unban Error]:', error);
        } finally {
          state.tempBans.delete(targetUser.id);
        }
      }, duration);

      await dispatchModerationAlert(
        interaction,
        targetUser,
        '⏳ KitKat Temp-Ban Applied',
        `**${targetUser.tag}** was banned for **${durationInput}**.\nReason: ${reason}`,
        0xbb5500,
        `⚠️ **KitKat Notice**: You were temporarily banned from **${interaction.guild!.name}** for **${durationInput}**.\nReason: ${reason}`
      );

      await interaction.reply({
        content: `⏳ **KitKat Temp-Ban**: **${targetUser.tag}** has been banned for **${durationInput}**.\n**Reason**: ${reason}`,
      });
    } catch (error) {
      console.error('[KitKat TempBan Error]:', error);
      await interaction.reply({ content: '❌ Failed to execute the temporary ban.', ephemeral: true });
    }
  },
};

export const DeafenCommand = {
  data: new SlashCommandBuilder()
    .setName('deafen')
    .setDescription('Deafens one member or everyone in your current voice channel.')
    .addSubcommand((sub) =>
      sub
        .setName('user')
        .setDescription('Server-deafen one member.')
        .addUserOption((option) =>
          option.setName('target').setDescription('The member to server-deafen').setRequired(true)
        )
        .addStringOption((option) =>
          option.setName('reason').setDescription('Reason for deafening').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('all')
        .setDescription('Server-deafen every member in your current voice channel.')
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const executor = interaction.member as GuildMember;
    const sub = interaction.options.getSubcommand();
    const voiceChannel = executor.voice.channel as VoiceChannel | null;

    if (!canModerateWithScope(executor, 'deafen', PermissionFlagsBits.DeafenMembers)) {
      return interaction.reply({
        content: '❌ You need Deafen Members or a KitKat `deafen` scope to use this command.',
        ephemeral: true,
      });
    }

    if (sub === 'all') {
      if (!voiceChannel) {
        return interaction.reply({ content: '❌ Join a voice channel before using `/deafen all`.', ephemeral: true });
      }

      if (!voiceChannel.members.size) {
        return interaction.reply({ content: '❌ There are no connected members to deafen.', ephemeral: true });
      }

      try {
        const affected = await deafenVoiceChannelMembers(interaction, voiceChannel, true);
        await interaction.reply({
          content: `🔇 **KitKat Deafen**: Deafened **${affected}** members in **${voiceChannel.name}**.`,
        });
      } catch (error) {
        console.error('[KitKat Deafen All Error]:', error);
        await interaction.reply({ content: '❌ Failed to deafen everyone in the voice channel.', ephemeral: true });
      }
      return;
    }

    const targetUser = interaction.options.getUser('target', true);
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const target = await fetchMemberIfPresent(interaction, targetUser.id);

    if (!target) {
      return interaction.reply({ content: '❌ Target member not found.', ephemeral: true });
    }

    const blocked = moderationBlockedReason(executor, target);
    if (blocked) {
      return interaction.reply({ content: `❌ ${blocked}`, ephemeral: true });
    }

    if (!target.voice.channel) {
      return interaction.reply({ content: `❌ **${target.user.tag}** is not in a voice channel.`, ephemeral: true });
    }

    try {
      await target.voice.setDeaf(true, reason);
      await interaction.reply({ content: `🔇 **KitKat Deafen**: Deafened **${target.user.tag}**.` });
    } catch (error) {
      console.error('[KitKat Deafen Error]:', error);
      await interaction.reply({ content: '❌ Failed to server-deafen the target user.', ephemeral: true });
    }
  },
};

export const UndeafenCommand = {
  data: new SlashCommandBuilder()
    .setName('undeafen')
    .setDescription('Undeafens one member or everyone in your current voice channel.')
    .addSubcommand((sub) =>
      sub
        .setName('user')
        .setDescription('Remove server-deafen from one member.')
        .addUserOption((option) =>
          option.setName('target').setDescription('The member to server-undeafen').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('all')
        .setDescription('Remove server-deafen from everyone in your current voice channel.')
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const executor = interaction.member as GuildMember;
    if (!canModerateWithScope(executor, 'undeafen', PermissionFlagsBits.DeafenMembers)) {
      return interaction.reply({
        content: '❌ You need Deafen Members or a KitKat `undeafen` scope to use this command.',
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();
    const voiceChannel = executor.voice.channel as VoiceChannel | null;

    if (sub === 'all') {
      if (!voiceChannel) {
        return interaction.reply({ content: '❌ Join a voice channel before using `/undeafen all`.', ephemeral: true });
      }

      if (!voiceChannel.members.size) {
        return interaction.reply({ content: '❌ There are no connected members to undeafen.', ephemeral: true });
      }

      try {
        const affected = await deafenVoiceChannelMembers(interaction, voiceChannel, false);
        await interaction.reply({
          content: `🔊 **KitKat Undeafen**: Restored audio access for **${affected}** members in **${voiceChannel.name}**.`,
        });
      } catch (error) {
        console.error('[KitKat Undeafen All Error]:', error);
        await interaction.reply({ content: '❌ Failed to undeafen everyone in the voice channel.', ephemeral: true });
      }
      return;
    }

    const targetUser = interaction.options.getUser('target', true);
    const target = await fetchMemberIfPresent(interaction, targetUser.id);

    if (!target) {
      return interaction.reply({ content: '❌ Target member not found.', ephemeral: true });
    }

    const blocked = moderationBlockedReason(executor, target);
    if (blocked) {
      return interaction.reply({ content: `❌ ${blocked}`, ephemeral: true });
    }

    if (!target.voice.channel) {
      return interaction.reply({ content: `❌ **${target.user.tag}** is not in a voice channel.`, ephemeral: true });
    }

    try {
      await target.voice.setDeaf(false, `KitKat undeafen by ${interaction.user.tag}`);
      await interaction.reply({ content: `🔊 **KitKat Undeafen**: Removed server-deafen from **${target.user.tag}**.` });
    } catch (error) {
      console.error('[KitKat Undeafen Error]:', error);
      await interaction.reply({ content: '❌ Failed to server-undeafen the target user.', ephemeral: true });
    }
  },
};

export const SetNickCommand = {
  data: new SlashCommandBuilder()
    .setName('setnick')
    .setDescription('Request a nickname change or manage nickname approval settings.')
    .addSubcommand((sub) =>
      sub
        .setName('request')
        .setDescription('Submit your nickname change request for approval.')
        .addStringOption((option) =>
          option.setName('new_nick').setDescription('The requested nickname').setRequired(true)
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName('config')
        .setDescription('Manage nickname workflow settings.')
        .addSubcommand((configSub) =>
          configSub
            .setName('channel')
            .setDescription('Set the request review channel.')
            .addChannelOption((option) =>
              option.setName('channel').setDescription('Request channel').setRequired(true)
            )
        )
        .addSubcommand((configSub) =>
          configSub
            .setName('approval')
            .setDescription('Grant approval rights to a user or role.')
            .addMentionableOption((option) =>
              option.setName('target').setDescription('Approver target').setRequired(true)
            )
        )
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const executor = interaction.member as GuildMember;

    if (group === 'config' && sub === 'channel') {
      if (!isGuildArch(interaction.client, interaction.guildId!, interaction.user.id)) {
        return interaction.reply({
          content: '❌ Only ARCH members can configure nickname workflow settings.',
          ephemeral: true,
        });
      }

      const channel = interaction.options.getChannel('channel', true);
      if (!('isTextBased' in channel) || !channel.isTextBased()) {
        return interaction.reply({ content: '❌ Nickname requests must be posted in a text channel.', ephemeral: true });
      }

      setSetNickChannel(interaction.client, interaction.guildId!, channel.id);
      await interaction.reply({ content: `✅ Nickname requests will be posted in <#${channel.id}>.` });
      await sendDeveloperBackup(interaction.client, interaction.guildId!, ['config', 'setnick']);
      return;
    }

    if (group === 'config' && sub === 'approval') {
      if (!isGuildArch(interaction.client, interaction.guildId!, interaction.user.id)) {
        return interaction.reply({
          content: '❌ Only ARCH members can configure nickname workflow settings.',
          ephemeral: true,
        });
      }

      const target = interaction.options.getMentionable('target', true) as Role | User;
      addNicknameApprover(interaction.client, interaction.guildId!, target.id, isRoleMentionable(target) ? 'role' : 'user');
      await interaction.reply({
        content: `✅ Added **${labelForMentionable(target)}** as a nickname approver.`,
      });
      await sendDeveloperBackup(interaction.client, interaction.guildId!, ['config', 'setnick']);
      return;
    }

    if (sub !== 'request') {
      return interaction.reply({ content: '❌ Unknown setnick subcommand.', ephemeral: true });
    }

    const newNick = interaction.options.getString('new_nick', true);
    const requestChannelId = getSetNickChannel(interaction.client, interaction.guildId!);
    const targetMember = interaction.member as GuildMember;

    if (!requestChannelId) {
      return interaction.reply({
        content: '❌ No nickname request review channel is configured.',
        ephemeral: true,
      });
    }

    const requestChannel = interaction.guild!.channels.cache.get(requestChannelId);
    if (!requestChannel || !('send' in requestChannel)) {
      return interaction.reply({
        content: '❌ The configured nickname request channel is unavailable.',
        ephemeral: true,
      });
    }

    const request = createNicknameRequest(interaction.client, interaction.guildId!, {
      guildId: interaction.guildId!,
      requesterId: interaction.user.id,
      targetId: targetMember.id,
      requestedNick: newNick,
      channelId: requestChannelId,
      messageId: null,
    });

    const button = new ButtonBuilder()
      .setCustomId(`kitkat:nick:approve:${request.id}`)
      .setLabel('Approve Request')
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
    const embed = buildKitKatEmbed(
      '📝 KitKat Nickname Request',
      `**Requester:** <@${interaction.user.id}>\n**Requested Nickname:** \`${newNick}\`\n**Member:** <@${targetMember.id}>`,
      0x4f46e5
    );

    const sent = await (requestChannel as any).send({ embeds: [embed], components: [row] });
    request.messageId = sent.id;

  await interaction.reply({
      content: 'Your nickname change request has been received and is waiting for approval.',
      ephemeral: true,
    });
  },
};
