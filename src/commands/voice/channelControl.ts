import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  PermissionFlagsBits, 
  VoiceChannel, 
  GuildMember,
  EmbedBuilder
} from 'discord.js';
import { Config } from '../../config.js';
import { Database } from '../../database.js';
import { sendAuditLog } from '../../middleware/messagePipeline.js';

// Helper to verify if the bot has permission to modify channel settings
function verifyBotChannelPermissions(
  interaction: ChatInputCommandInteraction, 
  channel: VoiceChannel
): boolean {
  const bot = interaction.guild?.members.me;
  if (!bot) return false;

  // Resolves the bot's permissions inside the specific voice channel.
  // Requires PermissionFlagsBits.ManageRoles or ManageChannels.
  const permissions = bot.permissionsIn(channel);
  return permissions.has(PermissionFlagsBits.ManageRoles) || permissions.has(PermissionFlagsBits.ManageChannels);
}

// ==========================================
// 1. /vclock command (Voice Channel Lock)
// ==========================================
export const VcLockCommand = {
  data: new SlashCommandBuilder()
    .setName('vclock')
    .setDescription('Locks your current voice channel for new members.'),
  async execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel as VoiceChannel | null;

    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ **Voice Error**: You must join a voice channel before running this command.',
        ephemeral: true,
      });
    }

    if (!verifyBotChannelPermissions(interaction, voiceChannel)) {
      return interaction.reply({
        content: '❌ **Bot Permission Error**: I do not have permission to manage permissions in your current voice channel.',
        ephemeral: true,
      });
    }

    const channelId = voiceChannel.id;
    const client = interaction.client;

    if (client.lockedChannels.has(channelId)) {
      const lockerId = client.lockedChannels.get(channelId);
      return interaction.reply({
        content: `❌ **State Error**: This channel is already locked by <@${lockerId}>.`,
        ephemeral: true,
      });
    }

    try {
      // 1. Modify channel permissions to deny '@everyone' the permission to Connect
      await voiceChannel.permissionOverwrites.edit(interaction.guild!.roles.everyone, {
        Connect: false,
      });

      // 2. Allow any currently registered ARCH bypass users to connect
      for (const archUserId of client.archUsers) {
        await voiceChannel.permissionOverwrites.create(archUserId, {
          Connect: true,
        }).catch(() => {});
      }

      // 3. Allow whitelisted members for the active session (if any exist)
      const whitelist = client.channelWhitelists.get(channelId);
      if (whitelist) {
        for (const whitelistedId of whitelist) {
          await voiceChannel.permissionOverwrites.create(whitelistedId, {
            Connect: true,
          }).catch(() => {});
        }
      }

      // 4. Save the locker user ID in memory
      client.lockedChannels.set(channelId, interaction.user.id);

      const auditEmbed = new EmbedBuilder()
        .setColor(0x0055ff)
        .setTitle('🔒 Voice Channel Locked')
        .setDescription(`Channel **${voiceChannel.name}** was locked.`)
        .addFields(
          { name: 'Channel ID', value: channelId, inline: true },
          { name: 'Lock Owner', value: `<@${interaction.user.id}>`, inline: true }
        )
        .setTimestamp();

      await sendAuditLog(client, interaction.guild!.id, { embeds: [auditEmbed] });

      await interaction.reply({
        content: `🔒 **Voice Lock**: Channel **${voiceChannel.name}** has been locked.\n*Only the initiator (<@${interaction.user.id}>), whitelisted users, and ARCH members can join.*`,
      });
    } catch (error) {
      console.error('[VC Lock Error]:', error);
      await interaction.reply({ content: '❌ Failed to lock the voice channel.', ephemeral: true });
    }
  }
};

// ==========================================
// 2. /vcunlock command (Voice Channel Unlock)
// ==========================================
export const VcUnlockCommand = {
  data: new SlashCommandBuilder()
    .setName('vcunlock')
    .setDescription('Unlocks your current voice channel.'),
  async execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel as VoiceChannel | null;

    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ **Voice Error**: You must join a voice channel before running this command.',
        ephemeral: true,
      });
    }

    if (!verifyBotChannelPermissions(interaction, voiceChannel)) {
      return interaction.reply({
        content: '❌ **Bot Permission Error**: I do not have permission to manage permissions in this channel.',
        ephemeral: true,
      });
    }

    const channelId = voiceChannel.id;
    const client = interaction.client;

    if (!client.lockedChannels.has(channelId)) {
      return interaction.reply({
        content: '❌ **State Error**: This voice channel is not currently locked.',
        ephemeral: true,
      });
    }

    // Ownership Check
    const lockerId = client.lockedChannels.get(channelId);
    const isArch = client.archUsers.has(interaction.user.id);

    if (lockerId && lockerId !== interaction.user.id && !isArch) {
      return interaction.reply({
        content: `❌ **Access Denied**: You cannot unlock this channel. It was locked by <@${lockerId}>.`,
        ephemeral: true,
      });
    }

    try {
      // 1. Reset Connect permission for @everyone
      await voiceChannel.permissionOverwrites.edit(interaction.guild!.roles.everyone, {
        Connect: null,
      });

      // 2. Remove explicit allows for ARCH members to clean up overwrites
      for (const archUserId of client.archUsers) {
        const overwrite = voiceChannel.permissionOverwrites.cache.get(archUserId);
        if (overwrite) {
          await overwrite.delete().catch(() => {});
        }
      }

      // 3. Remove explicit allows for session-whitelisted members
      const whitelist = client.channelWhitelists.get(channelId);
      if (whitelist) {
        for (const whitelistedId of whitelist) {
          const overwrite = voiceChannel.permissionOverwrites.cache.get(whitelistedId);
          if (overwrite) {
            await overwrite.delete().catch(() => {});
          }
        }
      }

      // 4. Clear states
      client.lockedChannels.delete(channelId);
      client.channelWhitelists.delete(channelId);

      const auditEmbed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('🔓 Voice Channel Unlocked')
        .setDescription(`Channel **${voiceChannel.name}** was unlocked and whitelists cleared.`)
        .addFields(
          { name: 'Channel ID', value: channelId, inline: true },
          { name: 'Unlocker', value: `<@${interaction.user.id}>`, inline: true }
        )
        .setTimestamp();

      await sendAuditLog(client, interaction.guild!.id, { embeds: [auditEmbed] });

      await interaction.reply({
        content: `🔓 **Voice Unlock**: Channel **${voiceChannel.name}** has been unlocked.`,
      });
    } catch (error) {
      console.error('[VC Unlock Error]:', error);
      await interaction.reply({ content: '❌ Failed to unlock the voice channel.', ephemeral: true });
    }
  }
};

// ==========================================
// 3. /guard command (VC Guard Enable)
// ==========================================
export const GuardCommand = {
  data: new SlashCommandBuilder()
    .setName('guard')
    .setDescription('Enables the VC Guard blacklist defense on your current voice channel.'),
  async execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel as VoiceChannel | null;

    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ **Voice Error**: You must join a voice channel to enable the Guard.',
        ephemeral: true,
      });
    }

    const channelId = voiceChannel.id;
    const client = interaction.client;

    if (client.guardedChannels.has(channelId)) {
      const guarderId = client.guardedChannels.get(channelId);
      return interaction.reply({
        content: `❌ **State Error**: The Guard is already active on this channel (enabled by <@${guarderId}>).`,
        ephemeral: true,
      });
    }

    client.guardedChannels.set(channelId, interaction.user.id);

    const auditEmbed = new EmbedBuilder()
      .setColor(0xffaa00)
      .setTitle('🛡️ Voice Guard Active')
      .setDescription(`Activated Guard on **${voiceChannel.name}**.`)
      .addFields(
        { name: 'Channel ID', value: channelId, inline: true },
        { name: 'Guard Owner', value: `<@${interaction.user.id}>`, inline: true }
      )
      .setTimestamp();

      await sendAuditLog(client, interaction.guild!.id, { embeds: [auditEmbed] });

    await interaction.reply({
      content: `🛡️ **VC Guard Activated**: Guard is now active on **${voiceChannel.name}**.\n*Only the initiator (<@${interaction.user.id}>), whitelisted users, and ARCH members can join.*`,
    });
  }
};

// ==========================================
// 4. /unguard command (VC Guard Disable)
// ==========================================
export const UnguardCommand = {
  data: new SlashCommandBuilder()
    .setName('unguard')
    .setDescription('Disables the VC Guard blacklist defense on your current voice channel.'),
  async execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel as VoiceChannel | null;

    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ **Voice Error**: You must join a voice channel to disable the Guard.',
        ephemeral: true,
      });
    }

    const channelId = voiceChannel.id;
    const client = interaction.client;

    if (!client.guardedChannels.has(channelId)) {
      return interaction.reply({
        content: '❌ **State Error**: The Guard is not active on your current voice channel.',
        ephemeral: true,
      });
    }

    // Ownership Check
    const guarderId = client.guardedChannels.get(channelId);
    const isArch = client.archUsers.has(interaction.user.id);

    if (guarderId && guarderId !== interaction.user.id && !isArch) {
      return interaction.reply({
        content: `❌ **Access Denied**: You cannot disable this guard. It was activated by <@${guarderId}>.`,
        ephemeral: true,
      });
    }

    client.guardedChannels.delete(channelId);
    client.channelWhitelists.delete(channelId); // Reset Whitelist on session close

    const auditEmbed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('🛡️ Voice Guard Deactivated')
      .setDescription(`Deactivated Guard and cleared whitelists on **${voiceChannel.name}**.`)
      .addFields(
        { name: 'Channel ID', value: channelId, inline: true },
        { name: 'Deactivator', value: `<@${interaction.user.id}>`, inline: true }
      )
      .setTimestamp();

    await sendAuditLog(client, interaction.guild!.id, { embeds: [auditEmbed] });

    await interaction.reply({
      content: `🛡️ **VC Guard Deactivated**: Blacklist protection disabled on **${voiceChannel.name}**.`,
    });
  }
};

// ==========================================
// 5. /whitelist command (Manage Session whitelist)
// ==========================================
export const WhitelistCommand = {
  data: new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Manage whitelisted users for the active voice lock/guard session.')
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
    const voiceChannel = member.voice.channel as VoiceChannel | null;

    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ **Voice Error**: You must join a voice channel to manage its whitelist.',
        ephemeral: true,
      });
    }

    const channelId = voiceChannel.id;
    const client = interaction.client;

    const isLocked = client.lockedChannels.has(channelId);
    const isGuarded = client.guardedChannels.has(channelId);

    if (!isLocked && !isGuarded) {
      return interaction.reply({
        content: '❌ **State Error**: Active whitelists are only supported on locked or guarded voice channels.',
        ephemeral: true,
      });
    }

    // Ownership Check
    const lockerId = client.lockedChannels.get(channelId);
    const guarderId = client.guardedChannels.get(channelId);
    const ownerId = lockerId || guarderId;
    const isArch = client.archUsers.has(interaction.user.id);

    if (ownerId && ownerId !== interaction.user.id && !isArch) {
      return interaction.reply({
        content: `❌ **Access Denied**: Only the moderator who locked/guarded this channel (<@${ownerId}>) can edit its whitelist.`,
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser('user', true);
    const sub = interaction.options.getSubcommand();

    let whitelist = client.channelWhitelists.get(channelId);
    if (!whitelist) {
      whitelist = new Set();
      client.channelWhitelists.set(channelId, whitelist);
    }

    if (sub === 'add') {
      if (whitelist.has(targetUser.id)) {
        return interaction.reply({
          content: `ℹ️ **Status Check**: **${targetUser.tag}** is already whitelisted for this voice channel.`,
          ephemeral: true,
        });
      }

      whitelist.add(targetUser.id);

      // If channel is locked, modify permission overwrite to allow Connect
      if (isLocked) {
        if (verifyBotChannelPermissions(interaction, voiceChannel)) {
          await voiceChannel.permissionOverwrites.create(targetUser.id, {
            Connect: true,
          }).catch(() => {});
        }
      }

      await interaction.reply({
        content: `✅ **Voice Whitelist**: Added **${targetUser.tag}** to the whitelist for **${voiceChannel.name}**.`,
      });
    } else if (sub === 'remove') {
      if (!whitelist.has(targetUser.id)) {
        return interaction.reply({
          content: `❌ **Whitelist Error**: **${targetUser.tag}** is not whitelisted for this channel.`,
          ephemeral: true,
        });
      }

      whitelist.delete(targetUser.id);

      // If channel is locked, delete their permission overwrite
      if (isLocked) {
        if (verifyBotChannelPermissions(interaction, voiceChannel)) {
          const overwrite = voiceChannel.permissionOverwrites.cache.get(targetUser.id);
          if (overwrite) {
            await overwrite.delete().catch(() => {});
          }
        }
      }

      await interaction.reply({
        content: `✅ **Voice Whitelist**: Removed **${targetUser.tag}** from the whitelist for **${voiceChannel.name}**.`,
      });
    }
  }
};

// ==========================================
// 6. /transfer command (Move Member)
// ==========================================
export const TransferCommand = {
  data: new SlashCommandBuilder()
    .setName('transfer')
    .setDescription('Instantly moves a connected user to another voice channel.')
    .addUserOption((opt) => opt.setName('target').setDescription('The member to move').setRequired(true))
    .addChannelOption((opt) => opt.setName('channel').setDescription('Target voice channel').setRequired(true)),
  async execute(interaction: ChatInputCommandInteraction) {
    const executor = interaction.member as GuildMember;
    const bot = interaction.guild?.members.me;

    // Check permission: MoveMembers or bot internal voice scope
    if (!executor.permissions.has(PermissionFlagsBits.MoveMembers) && !Database.hasPermission(executor.id, 'transfer')) {
      return interaction.reply({
        content: '❌ **Access Denied**: You require "Move Members" server permission or bot internal voice scope to transfer users.',
        ephemeral: true,
      });
    }

    if (!bot || !bot.permissions.has(PermissionFlagsBits.MoveMembers)) {
      return interaction.reply({
        content: '❌ **Bot Permission Error**: I do not have permission to move members. (requires Move Members).',
        ephemeral: true,
      });
    }

    const targetMember = interaction.options.getMember('target') as GuildMember | null;
    const targetChannel = interaction.options.getChannel('channel', true) as VoiceChannel;

    if (!targetMember) {
      return interaction.reply({ content: '❌ Target member not found.', ephemeral: true });
    }

    if (!targetChannel.isVoiceBased()) {
      return interaction.reply({ content: '❌ **Target Error**: Destination must be a voice channel.', ephemeral: true });
    }

    if (!targetMember.voice.channel) {
      return interaction.reply({
        content: `❌ **Voice Error**: Target **${targetMember.user.tag}** is not connected to a voice channel.`,
        ephemeral: true,
      });
    }

    try {
      await targetMember.voice.setChannel(targetChannel);
      await interaction.reply({
        content: `✅ **Voice Transfer**: Moved **${targetMember.user.tag}** to **${targetChannel.name}**.`,
      });
    } catch (err) {
      console.error('[Voice Transfer Error]:', err);
      await interaction.reply({ content: '❌ Failed to transfer user to the target voice channel.', ephemeral: true });
    }
  }
};

// ==========================================
// 7. /arch command (Register ARCH bypass role)
// ==========================================
export const ArchCommand = {
  data: new SlashCommandBuilder()
    .setName('arch')
    .setDescription('Authenticates a user into the ARCH bypass list using the developer safeguard code.')
    .addStringOption((option) =>
      option.setName('code').setDescription('Safeguard authentication code').setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const codeInput = interaction.options.getString('code', true);
    const client = interaction.client;
    const userId = interaction.user.id;

    if (client.archUsers.has(userId)) {
      return interaction.reply({
        content: 'ℹ️ **Status Check**: You are already authenticated as an ARCH bypass member.',
        ephemeral: true,
      });
    }

    if (codeInput !== Config.archSafeguardCode) {
      console.log(`[Security Alert]: Failed ARCH authorization attempt by ${interaction.user.tag} using code "${codeInput}".`);
      return interaction.reply({
        content: '❌ **Authorization Failed**: Invalid safeguard code.',
        ephemeral: true,
      });
    }

    try {
      client.archUsers.add(userId);
      console.log(`[Security Alert]: User ${interaction.user.tag} (${userId}) successfully authenticated as ARCH.`);

      // Grant connection allowance overrides on all currently locked channels
      for (const channelId of client.lockedChannels.keys()) {
        const lockedChannel = interaction.guild?.channels.cache.get(channelId) as VoiceChannel | undefined;
        if (lockedChannel && verifyBotChannelPermissions(interaction, lockedChannel)) {
          await lockedChannel.permissionOverwrites.create(userId, {
            Connect: true,
          }).catch(() => {});
        }
      }

      await interaction.reply({
        content: '👑 **Authentication Successful**: You have been granted the **ARCH** bypass role.\n*You will now automatically bypass all voice locks, voice guards, and moderator locks.*',
        ephemeral: true,
      });
    } catch (error) {
      console.error('[ARCH Registration Error]:', error);
      await interaction.reply({ content: '❌ Failed to complete ARCH authentication.', ephemeral: true });
    }
  }
};
