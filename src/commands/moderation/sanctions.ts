import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  GuildMember,
  EmbedBuilder,
  User,
  VoiceChannel,
  PermissionOverwriteOptions,
} from 'discord.js';
import ms from 'ms';
import {
  buildKitKatEmbed,
  getGuildState,
  isGuildArch,
  memberHasGuildScope,
  sendKitKatAlert,
  sendKitKatLog,
} from '../../lib/kitkatState.js';

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
    .setDescription('Deafens a member in a voice channel.')
    .addUserOption((option) =>
      option.setName('target').setDescription('The member to server-deafen').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Reason for deafening').setRequired(false)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const executor = interaction.member as GuildMember;
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

    if (!canModerateWithScope(executor, 'deafen', PermissionFlagsBits.DeafenMembers)) {
      return interaction.reply({
        content: '❌ You need Deafen Members or a KitKat `deafen` scope to use this command.',
        ephemeral: true,
      });
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
    .setDescription('Undeafens a member in a voice channel.')
    .addUserOption((option) =>
      option.setName('target').setDescription('The member to server-undeafen').setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const executor = interaction.member as GuildMember;
    const targetUser = interaction.options.getUser('target', true);
    const target = await fetchMemberIfPresent(interaction, targetUser.id);

    if (!target) {
      return interaction.reply({ content: '❌ Target member not found.', ephemeral: true });
    }

    const blocked = moderationBlockedReason(executor, target);
    if (blocked) {
      return interaction.reply({ content: `❌ ${blocked}`, ephemeral: true });
    }

    if (!canModerateWithScope(executor, 'undeafen', PermissionFlagsBits.DeafenMembers)) {
      return interaction.reply({
        content: '❌ You need Deafen Members or a KitKat `undeafen` scope to use this command.',
        ephemeral: true,
      });
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
    .setDescription("Changes a target user's nickname.")
    .addUserOption((option) =>
      option.setName('target').setDescription('The member').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('nickname').setDescription('The new nickname (leave blank to reset)').setRequired(false)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const executor = interaction.member as GuildMember;
    const targetUser = interaction.options.getUser('target', true);
    const nickname = interaction.options.getString('nickname') || null;
    const target = await fetchMemberIfPresent(interaction, targetUser.id);

    if (!target) {
      return interaction.reply({ content: '❌ Target member not found.', ephemeral: true });
    }

    const blocked = moderationBlockedReason(executor, target);
    if (blocked) {
      return interaction.reply({ content: `❌ ${blocked}`, ephemeral: true });
    }

    if (!canModerateWithScope(executor, 'setnick', PermissionFlagsBits.ManageNicknames)) {
      return interaction.reply({
        content: '❌ You need Manage Nicknames or a KitKat `setnick` scope to use this command.',
        ephemeral: true,
      });
    }

    try {
      await target.setNickname(nickname, `KitKat nickname change by ${interaction.user.tag}`);
      await interaction.reply({
        content: nickname
          ? `📝 **KitKat Nickname**: Changed **${target.user.tag}** to **${nickname}**.`
          : `📝 **KitKat Nickname**: Reset **${target.user.tag}** to their default nickname.`,
      });
    } catch (error) {
      console.error('[KitKat SetNick Error]:', error);
      await interaction.reply({ content: '❌ Failed to update the nickname.', ephemeral: true });
    }
  },
};
