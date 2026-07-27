import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  GuildMember,
  VoiceChannel,
  ChannelType,
  Role,
  EmbedBuilder,
} from 'discord.js';
import {
  allowTargetOnLockedChannels,
  buildKitKatEmbed,
  cancelTempVcCleanup,
  canUseKitKatRestrictedCommand,
  deleteTempVcRecord,
  getGuildState,
  getNextTempVcIndex,
  getPermissionGrantsForScope,
  getTempVcCategory,
  getTempVcRecord,
  memberHasAnyScope,
  memberCanBypassVclock,
  registerTempVc,
  scheduleTempVcCleanup,
  setTempVcCategory,
  isGuildArch,
} from '../../lib/kitkatState.js';
import { sendKitKatLog } from '../../lib/kitkatState.js';

function botCanManageChannel(interaction: ChatInputCommandInteraction, channel: VoiceChannel): boolean {
  const bot = interaction.guild?.members.me;
  if (!bot) return false;
  return bot.permissionsIn(channel).has(PermissionFlagsBits.ManageChannels);
}

function getMemberChannel(member: GuildMember): VoiceChannel | null {
  return (member.voice.channel as VoiceChannel | null) ?? null;
}

function isVoiceBasedChannel(channel: ReturnType<ChatInputCommandInteraction['options']['getChannel']>): boolean {
  if (!channel) return false;
  return 'isVoiceBased' in channel && typeof channel.isVoiceBased === 'function' && channel.isVoiceBased();
}

function getAllowedLockTargets(interaction: ChatInputCommandInteraction): string[] {
  const guildId = interaction.guildId!;
  const state = getGuildState(interaction.client, guildId);
  const targets = new Set<string>();

  for (const archId of state.archUsers.keys()) {
    targets.add(archId);
  }

  for (const roleId of state.vclockBypassRoles) {
    targets.add(roleId);
  }

  for (const grant of getPermissionGrantsForScope(interaction.client, guildId, 'vclock')) {
    targets.add(grant.targetId);
  }

  return Array.from(targets);
}

async function clearLockOverwrites(interaction: ChatInputCommandInteraction, channel: VoiceChannel): Promise<void> {
  const guildId = interaction.guildId!;
  const state = getGuildState(interaction.client, guildId);

  const overwriteTargets = new Set<string>();
  overwriteTargets.add(interaction.user.id);

  for (const archId of state.archUsers.keys()) {
    overwriteTargets.add(archId);
  }

  for (const roleId of state.vclockBypassRoles) {
    overwriteTargets.add(roleId);
  }

  for (const grant of getPermissionGrantsForScope(interaction.client, guildId, 'vclock')) {
    overwriteTargets.add(grant.targetId);
  }

  const whitelist = state.whitelists.get(channel.id);
  if (whitelist) {
    for (const userId of whitelist) {
      overwriteTargets.add(userId);
    }
  }

  for (const targetId of overwriteTargets) {
    await channel.permissionOverwrites.delete(targetId).catch(() => {});
  }
}

async function createTempVc(
  interaction: ChatInputCommandInteraction,
  owner: GuildMember,
  categoryId: string
): Promise<void> {
  const index = getNextTempVcIndex(interaction.client, interaction.guildId!, owner.id);
  if (!index) {
    await interaction.reply({
      content: '❌ You already have the maximum of 9 temporary voice channels.',
      ephemeral: true,
    });
    return;
  }

  const channelName = `${owner.user.username}'s Temporary VC ${index}`;
  const channel = await interaction.guild!.channels.create({
    name: channelName,
    type: ChannelType.GuildVoice,
    parent: categoryId,
    reason: `KitKat temporary voice channel created by ${owner.user.tag}`,
  });

  registerTempVc(interaction.client, interaction.guildId!, channel.id, owner.id, categoryId, index);
  scheduleTempVcCleanup(interaction.client, interaction.guildId!, channel as VoiceChannel);

  await channel.permissionOverwrites.create(owner.id, {
    Connect: true,
    Speak: true,
  });

  await interaction.reply({
    content: `✅ **KitKat TempVC**: Created <#${channel.id}> for **${owner.user.tag}**.`,
  });
}

async function deleteTempVcIfOwned(interaction: ChatInputCommandInteraction, actor: GuildMember): Promise<void> {
  const state = getGuildState(interaction.client, interaction.guildId!);
  const currentChannel = getMemberChannel(actor);
  let recordChannelId: string | null = null;
  let targetChannel: VoiceChannel | null = null;

  if (currentChannel) {
    const record = getTempVcRecord(interaction.client, interaction.guildId!, currentChannel.id);
    if (record && (record.ownerId === actor.id || memberHasAnyScope(actor, ['tempvc']))) {
      recordChannelId = currentChannel.id;
      targetChannel = currentChannel;
    }
  }

  if (!recordChannelId) {
    for (const [channelId, record] of state.tempVcs.entries()) {
      if (record.ownerId === actor.id) {
        const channel = interaction.guild!.channels.cache.get(channelId);
        if (channel && channel.type === ChannelType.GuildVoice) {
          recordChannelId = channelId;
          targetChannel = channel as VoiceChannel;
        }
      }
    }
  }

  if (!recordChannelId || !targetChannel) {
    await interaction.reply({
      content: '❌ No temporary voice channel owned by you could be found.',
      ephemeral: true,
    });
    return;
  }

  cancelTempVcCleanup(interaction.client, interaction.guildId!, recordChannelId);
  deleteTempVcRecord(interaction.client, interaction.guildId!, recordChannelId);
  await targetChannel.delete(`KitKat tempvc removed by ${interaction.user.tag}`).catch(() => {});

  await interaction.reply({
    content: `🗑️ **KitKat TempVC**: Deleted <#${recordChannelId}>.`,
  });
}

export const VcLockCommand = {
  data: new SlashCommandBuilder()
    .setName('vclock')
    .setDescription('Locks your current voice channel for new members.'),
  async execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const voiceChannel = getMemberChannel(member);

    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ You need to join a voice channel before using `/vclock`.',
        ephemeral: true,
      });
    }

    if (!canUseKitKatRestrictedCommand(member, 'vclock')) {
      return interaction.reply({
        content: '❌ You need a KitKat `vclock` scope or the matching Discord permission to use this command.',
        ephemeral: true,
      });
    }

    if (!botCanManageChannel(interaction, voiceChannel)) {
      return interaction.reply({
        content: '❌ KitKat needs Manage Channels permission in your voice channel.',
        ephemeral: true,
      });
    }

    const state = getGuildState(interaction.client, interaction.guildId!);
    if (state.lockedChannels.has(voiceChannel.id)) {
      return interaction.reply({
        content: `❌ This voice channel is already locked by <@${state.lockedChannels.get(voiceChannel.id)}>.`,
        ephemeral: true,
      });
    }

    try {
      await voiceChannel.permissionOverwrites.edit(interaction.guild!.roles.everyone, { Connect: false });

      state.lockedChannels.set(voiceChannel.id, interaction.user.id);

      await voiceChannel.permissionOverwrites.edit(interaction.user.id, { Connect: true }).catch(() => {});

      for (const targetId of getAllowedLockTargets(interaction)) {
        await voiceChannel.permissionOverwrites.edit(targetId, { Connect: true }).catch(() => {});
      }

      const embed = buildKitKatEmbed(
        '🔒 KitKat Voice Lock Enabled',
        `Locked **${voiceChannel.name}** for new members.`,
        0x0055ff
      ).addFields(
        { name: 'Channel ID', value: voiceChannel.id, inline: true },
        { name: 'Owner', value: `<@${interaction.user.id}>`, inline: true }
      );

      await sendKitKatLog(interaction.client, interaction.guildId!, { embeds: [embed] });

      await interaction.reply({
        content: `🔒 **KitKat Voice Lock**: **${voiceChannel.name}** is now locked.`,
      });
    } catch (error) {
      console.error('[KitKat Voice Lock Error]:', error);
      await interaction.reply({ content: '❌ Failed to lock the voice channel.', ephemeral: true });
    }
  },
};

export const VcUnlockCommand = {
  data: new SlashCommandBuilder()
    .setName('vcunlock')
    .setDescription('Unlocks your current voice channel.'),
  async execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const voiceChannel = getMemberChannel(member);

    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ You need to join a voice channel before using `/vcunlock`.',
        ephemeral: true,
      });
    }

    if (!botCanManageChannel(interaction, voiceChannel)) {
      return interaction.reply({
        content: '❌ KitKat needs Manage Channels permission in this voice channel.',
        ephemeral: true,
      });
    }

    const state = getGuildState(interaction.client, interaction.guildId!);
    const lockerId = state.lockedChannels.get(voiceChannel.id);

    if (!lockerId) {
      return interaction.reply({
        content: '❌ This voice channel is not locked.',
        ephemeral: true,
      });
    }

    if (lockerId !== interaction.user.id && !isGuildArch(interaction.client, interaction.guildId!, interaction.user.id)) {
      return interaction.reply({
        content: `❌ Only the channel owner (<@${lockerId}>) or an ARCH member can unlock this channel.`,
        ephemeral: true,
      });
    }

    try {
      await voiceChannel.permissionOverwrites.edit(interaction.guild!.roles.everyone, { Connect: null });
      await clearLockOverwrites(interaction, voiceChannel);
      state.lockedChannels.delete(voiceChannel.id);
      state.whitelists.delete(voiceChannel.id);

      const embed = buildKitKatEmbed(
        '🔓 KitKat Voice Lock Removed',
        `Unlocked **${voiceChannel.name}** and cleared temporary connect overrides.`,
        0x00ff00
      ).addFields(
        { name: 'Channel ID', value: voiceChannel.id, inline: true },
        { name: 'Unlocked By', value: `<@${interaction.user.id}>`, inline: true }
      );

      await sendKitKatLog(interaction.client, interaction.guildId!, { embeds: [embed] });

      await interaction.reply({
        content: `🔓 **KitKat Voice Unlock**: **${voiceChannel.name}** is now unlocked.`,
      });
    } catch (error) {
      console.error('[KitKat Voice Unlock Error]:', error);
      await interaction.reply({ content: '❌ Failed to unlock the voice channel.', ephemeral: true });
    }
  },
};

export const GuardCommand = {
  data: new SlashCommandBuilder()
    .setName('guard')
    .setDescription('Enables privacy lockdown on your current temporary voice channel.'),
  async execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const voiceChannel = getMemberChannel(member);

    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ You need to join a voice channel before using `/guard`.',
        ephemeral: true,
      });
    }

    if (!canUseKitKatRestrictedCommand(member, 'guard')) {
      return interaction.reply({
        content: '❌ You need a KitKat `guard` scope or administrator access to use this command.',
        ephemeral: true,
      });
    }

    const state = getGuildState(interaction.client, interaction.guildId!);
    if (state.guardedChannels.has(voiceChannel.id)) {
      return interaction.reply({
        content: '❌ This voice channel is already guarded.',
        ephemeral: true,
      });
    }

    if (state.lockedChannels.has(voiceChannel.id) && state.lockedChannels.get(voiceChannel.id) !== interaction.user.id && !isGuildArch(interaction.client, interaction.guildId!, interaction.user.id)) {
      return interaction.reply({
        content: `❌ Only the channel owner (<@${state.lockedChannels.get(voiceChannel.id)}>) or an ARCH member can enable guard mode.`,
        ephemeral: true,
      });
    }

    state.guardedChannels.set(voiceChannel.id, interaction.user.id);

    const embed = buildKitKatEmbed(
      '🛡️ KitKat Guard Enabled',
      `Privacy lockdown is active in **${voiceChannel.name}**.`,
      0xffaa00
    ).addFields(
      { name: 'Channel ID', value: voiceChannel.id, inline: true },
      { name: 'Owner', value: `<@${interaction.user.id}>`, inline: true }
    );

    await sendKitKatLog(interaction.client, interaction.guildId!, { embeds: [embed] });

    await interaction.reply({
      content: `🛡️ **KitKat Guard** is now active in **${voiceChannel.name}**.`,
    });
  },
};

export const UnguardCommand = {
  data: new SlashCommandBuilder()
    .setName('unguard')
    .setDescription('Disables privacy lockdown on your current temporary voice channel.'),
  async execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const voiceChannel = getMemberChannel(member);

    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ You need to join a voice channel before using `/unguard`.',
        ephemeral: true,
      });
    }

    if (!canUseKitKatRestrictedCommand(member, 'guard')) {
      return interaction.reply({
        content: '❌ You need a KitKat `guard` scope or administrator access to use this command.',
        ephemeral: true,
      });
    }

    const state = getGuildState(interaction.client, interaction.guildId!);
    const guardOwner = state.guardedChannels.get(voiceChannel.id);
    if (!guardOwner) {
      return interaction.reply({
        content: '❌ This voice channel is not currently guarded.',
        ephemeral: true,
      });
    }

    if (guardOwner !== interaction.user.id && !isGuildArch(interaction.client, interaction.guildId!, interaction.user.id)) {
      return interaction.reply({
        content: `❌ Only the guard owner (<@${guardOwner}>) or an ARCH member can disable guard mode.`,
        ephemeral: true,
      });
    }

    state.guardedChannels.delete(voiceChannel.id);

    const embed = buildKitKatEmbed(
      '🛡️ KitKat Guard Disabled',
      `Guard mode was removed from **${voiceChannel.name}**.`,
      0x00ff00
    ).addFields(
      { name: 'Channel ID', value: voiceChannel.id, inline: true },
      { name: 'Owner', value: `<@${interaction.user.id}>`, inline: true }
    );

    await sendKitKatLog(interaction.client, interaction.guildId!, { embeds: [embed] });

    await interaction.reply({
      content: `🛡️ **KitKat Guard** has been disabled in **${voiceChannel.name}**.`,
    });
  },
};

export const WhitelistCommand = {
  data: new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Manage whitelisted users for the active voice lock or guard session.')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Allow a user to join your locked or guarded voice channel.')
        .addUserOption((opt) => opt.setName('user').setDescription('Target user').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Revoke join permission from a user for your voice channel.')
        .addUserOption((opt) => opt.setName('user').setDescription('Target user').setRequired(true))
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const voiceChannel = getMemberChannel(member);
    const sub = interaction.options.getSubcommand();

    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ You need to join a voice channel before managing a whitelist.',
        ephemeral: true,
      });
    }

    const state = getGuildState(interaction.client, interaction.guildId!);
    const isLocked = state.lockedChannels.has(voiceChannel.id);
    const isGuarded = state.guardedChannels.has(voiceChannel.id);

    if (!isLocked && !isGuarded) {
      return interaction.reply({
        content: '❌ Whitelists only work on locked or guarded voice channels.',
        ephemeral: true,
      });
    }

    const isOwner =
      state.lockedChannels.get(voiceChannel.id) === interaction.user.id ||
      state.guardedChannels.get(voiceChannel.id) === interaction.user.id ||
      isGuildArch(interaction.client, interaction.guildId!, interaction.user.id);

    if (!isOwner && !memberHasAnyScope(member, ['whitelist'])) {
      return interaction.reply({
        content: '❌ Only the channel owner, ARCH members, or users with a KitKat `whitelist` scope can edit this list.',
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser('user', true);
    let whitelist = state.whitelists.get(voiceChannel.id);
    if (!whitelist) {
      whitelist = new Set<string>();
      state.whitelists.set(voiceChannel.id, whitelist);
    }

    if (sub === 'add') {
      whitelist.add(targetUser.id);
      if (isLocked && botCanManageChannel(interaction, voiceChannel)) {
        await voiceChannel.permissionOverwrites.edit(targetUser.id, { Connect: true }).catch(() => {});
      }

      await interaction.reply({
        content: `✅ **KitKat Whitelist**: Added **${targetUser.tag}** to **${voiceChannel.name}**.`,
      });
      return;
    }

    whitelist.delete(targetUser.id);
    if (isLocked && botCanManageChannel(interaction, voiceChannel)) {
      await voiceChannel.permissionOverwrites.delete(targetUser.id).catch(() => {});
    }

    await interaction.reply({
      content: `✅ **KitKat Whitelist**: Removed **${targetUser.tag}** from **${voiceChannel.name}**.`,
    });
  },
};

export const BypassCommand = {
  data: new SlashCommandBuilder()
    .setName('bypass')
    .setDescription('Configure bypass access for voice channel locks.')
    .addSubcommand((sub) =>
      sub
        .setName('vclock')
        .setDescription('Allow a role to bypass `/vclock` locks.')
        .addRoleOption((opt) => opt.setName('target').setDescription('Role to bypass voice locks').setRequired(true))
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const bot = interaction.guild?.members.me;
    const role = interaction.options.getRole('target', true) as Role;

    if (!member.permissions.has(PermissionFlagsBits.ManageRoles) && !memberHasAnyScope(member, ['bypass'])) {
      return interaction.reply({
        content: '❌ You need Manage Roles or a KitKat `bypass` scope to manage bypass roles.',
        ephemeral: true,
      });
    }

    if (!bot || !bot.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({
        content: '❌ KitKat needs Manage Roles permission to manage bypass roles.',
        ephemeral: true,
      });
    }

    const state = getGuildState(interaction.client, interaction.guildId!);
    state.vclockBypassRoles.add(role.id);

    for (const channelId of state.lockedChannels.keys()) {
      const channel = interaction.guild!.channels.cache.get(channelId);
      if (channel && channel.type === ChannelType.GuildVoice) {
        await (channel as VoiceChannel).permissionOverwrites.edit(role.id, { Connect: true }).catch(() => {});
      }
    }

    await interaction.reply({
      content: `✅ **KitKat Bypass**: **${role.name}** can now bypass \`/vclock\` locks.`,
    });
  },
};

export const TempVcCommand = {
  data: new SlashCommandBuilder()
    .setName('tempvc')
    .setDescription('Configure and manage temporary voice channels.')
    .addSubcommand((sub) =>
      sub
        .setName('config')
        .setDescription('Set the default category for temporary voice channels.')
        .addChannelOption((opt) =>
          opt
            .setName('category')
            .setDescription('Category where temp channels should spawn')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('create').setDescription('Create a temporary voice channel.')
    )
    .addSubcommand((sub) =>
      sub.setName('remove').setDescription('Delete your temporary voice channel.')
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const member = interaction.member as GuildMember;
    const state = getGuildState(interaction.client, interaction.guildId!);

    if (sub === 'config') {
      const category = interaction.options.getChannel('category', true);
      if (category.type !== ChannelType.GuildCategory) {
        return interaction.reply({
          content: '❌ Please choose a Discord category channel.',
          ephemeral: true,
        });
      }

      if (!canUseKitKatRestrictedCommand(member, 'tempvc')) {
        return interaction.reply({
          content: '❌ You need a KitKat `tempvc` scope or the matching Discord permission to configure temp VCs.',
          ephemeral: true,
        });
      }

      setTempVcCategory(interaction.client, interaction.guildId!, category.id);
      await interaction.reply({
        content: `✅ **KitKat TempVC**: Default category set to <#${category.id}>.`,
      });
      return;
    }

    if (sub === 'create') {
      const categoryId = getTempVcCategory(interaction.client, interaction.guildId!);
      if (!categoryId) {
        return interaction.reply({
          content: '❌ No temp VC category is configured. Use `/tempvc config` first.',
          ephemeral: true,
        });
      }

      await createTempVc(interaction, member, categoryId);
      return;
    }

    await deleteTempVcIfOwned(interaction, member);
  },
};

export const TransferCommand = {
  data: new SlashCommandBuilder()
    .setName('transfer')
    .setDescription('Instantly moves a connected user to another voice channel.')
    .addUserOption((opt) => opt.setName('target').setDescription('The member to move').setRequired(true))
    .addChannelOption((opt) => opt.setName('channel').setDescription('Target voice channel').setRequired(true)),
  async execute(interaction: ChatInputCommandInteraction) {
    const executor = interaction.member as GuildMember;
    const bot = interaction.guild?.members.me;
    const targetMember = interaction.options.getMember('target') as GuildMember | null;
    const targetChannel = interaction.options.getChannel('channel', true);

    if (!executor.permissions.has(PermissionFlagsBits.MoveMembers) && !memberHasAnyScope(executor, ['transfer'])) {
      return interaction.reply({
        content: '❌ You need Move Members or a KitKat `transfer` scope to use this command.',
        ephemeral: true,
      });
    }

    if (!bot || !bot.permissions.has(PermissionFlagsBits.MoveMembers)) {
      return interaction.reply({
        content: '❌ KitKat needs Move Members permission to transfer members.',
        ephemeral: true,
      });
    }

    if (!targetMember) {
      return interaction.reply({ content: '❌ Target member not found.', ephemeral: true });
    }

    if (!isVoiceBasedChannel(targetChannel)) {
      return interaction.reply({ content: '❌ The destination must be a voice channel.', ephemeral: true });
    }

    try {
      await targetMember.voice.setChannel(targetChannel as VoiceChannel);
      await interaction.reply({
        content: `✅ **KitKat Transfer**: Moved **${targetMember.user.tag}** to **${targetChannel.name}**.`,
      });
    } catch (error) {
      console.error('[KitKat Transfer Error]:', error);
      await interaction.reply({ content: '❌ Failed to transfer the member.', ephemeral: true });
    }
  },
};
