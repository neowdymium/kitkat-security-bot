import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  PermissionFlagsBits, 
  GuildMember,
  EmbedBuilder
} from 'discord.js';
import ms from 'ms';
import { Database } from '../../database.js';
import { sendAuditLog } from '../../middleware/messagePipeline.js';

// Helper to validate role hierarchies and bot permissions
function checkModerationSafety(
  interaction: ChatInputCommandInteraction,
  target: GuildMember,
  requiredBotPermission: bigint
): { allowed: boolean; reason: string } {
  const guild = interaction.guild;
  const executor = interaction.member as GuildMember;
  const bot = guild?.members.me;

  if (!guild || !bot) {
    return { allowed: false, reason: 'This command can only be executed in a server.' };
  }

  // 1. Check Bot's own Discord permissions
  if (!bot.permissions.has(requiredBotPermission)) {
    return { 
      allowed: false, 
      reason: `I do not have the required server permissions to execute this command (requires: ${requiredBotPermission.toString()}).` 
    };
  }

  // 2. Prevent the bot from acting on itself
  if (target.id === bot.id) {
    return { allowed: false, reason: 'I cannot apply moderation sanctions to myself.' };
  }

  // 3. Prevent acting on the server owner
  if (target.id === guild.ownerId) {
    return { allowed: false, reason: 'Cannot apply sanctions to the Server Owner.' };
  }

  // 4. Validate Bot vs Target Hierarchy
  if (target.roles.highest.position >= bot.roles.highest.position) {
    return { 
      allowed: false, 
      reason: `Role Hierarchy Error: Target **${target.user.tag}** has a role equal to or higher than mine. I cannot moderate them.` 
    };
  }

  // 5. Validate Executor vs Target Hierarchy (bypass for ARCH members or users with command-specific internal scopes)
  const isArch = interaction.client.archUsers.has(executor.id);
  const hasInternalPerm = Database.hasPermission(executor.id, interaction.commandName);
  
  if (!isArch && !hasInternalPerm && target.roles.highest.position >= executor.roles.highest.position && executor.id !== guild.ownerId) {
    return { 
      allowed: false, 
      reason: `Role Hierarchy Error: Target **${target.user.tag}** has a role equal to or higher than yours. Action denied.` 
    };
  }

  return { allowed: true, reason: '' };
}

// ==========================================
// 1. /tempkick command (Voice-Only Temp-Kick)
// ==========================================
export const TempKickCommand = {
  data: new SlashCommandBuilder()
    .setName('tempkick')
    .setDescription('Disconnects a member from voice and bans them from voice channels temporarily.')
    .addUserOption((option) =>
      option.setName('target').setDescription('The member to voice tempkick').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('duration').setDescription('Duration of voice block (e.g. 180s, 5m, 10m)').setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const target = interaction.options.getMember('target') as GuildMember;
    const durationInput = interaction.options.getString('duration', true);

    if (!target) {
      return interaction.reply({ content: '❌ Target member not found in this guild.', ephemeral: true });
    }

    // Voice tempkick requires the bot to have MoveMembers permission to disconnect users
    const check = checkModerationSafety(interaction, target, PermissionFlagsBits.MoveMembers);
    if (!check.allowed) {
      return interaction.reply({ content: `❌ ${check.reason}`, ephemeral: true });
    }

    // Parse duration input
    let msDuration: number;
    try {
      const parsed = ms(durationInput);
      if (typeof parsed === 'number' && parsed > 0) {
        msDuration = parsed;
      } else {
        // Fallback to checking raw seconds if input was a number without suffix
        const rawSec = parseInt(durationInput);
        if (!isNaN(rawSec) && rawSec > 0) {
          msDuration = rawSec * 1000;
        } else {
          throw new Error('Invalid duration');
        }
      }
    } catch {
      return interaction.reply({
        content: '❌ **Invalid Duration**: Please use a valid format (e.g., `180s` for 180 seconds, `5m` for 5 minutes).',
        ephemeral: true,
      });
    }

    try {
      // 1. Instantly disconnect user from VC if they are in one
      const inVoice = target.voice.channel;
      if (inVoice) {
        await target.voice.disconnect('Voice Temp-Kick applied');
      }

      // 2. Set temporary voice block in client memory
      const expirationTimestamp = Date.now() + msDuration;
      interaction.client.voiceTempKicks.set(target.id, expirationTimestamp);

      // 3. Setup self-cleanup timer for automatic expiration
      setTimeout(() => {
        // Verify another block wasn't applied in the meantime
        if (interaction.client.voiceTempKicks.get(target.id) === expirationTimestamp) {
          interaction.client.voiceTempKicks.delete(target.id);
          console.log(`[Temp Voice Kick]: Block automatically lifted for user ${target.user.tag} (${target.id})`);
        }
      }, msDuration);

      // 4. Send log embed
      const auditEmbed = new EmbedBuilder()
        .setColor(0xff5500)
        .setTitle('🔇 Voice Temp-Kick Applied')
        .setDescription(`User **${target.user.tag}** was voice-temp-kicked for **${durationInput}**.`)
        .addFields(
          { name: 'Target', value: `<@${target.id}>`, inline: true },
          { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Duration', value: durationInput, inline: true }
        )
        .setTimestamp();

      await sendAuditLog(interaction.client, interaction.guild!.id, { embeds: [auditEmbed] });

      await interaction.reply({
        content: `👢 **Voice Temp-Kick**: **${target.user.tag}** has been disconnected from voice and blocked from connecting for **${durationInput}**.`,
      });
    } catch (err) {
      console.error('[Voice Tempkick Error]:', err);
      await interaction.reply({ content: '❌ Failed to execute voice temp-kick.', ephemeral: true });
    }
  }
};

// ==========================================
// 2. /mute command (Timeout)
// ==========================================
export const MuteCommand = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Applies a timeout to a server member.')
    .addUserOption((option) =>
      option.setName('target').setDescription('The member to mute').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('duration').setDescription('Mute duration (e.g. 10m, 1h, 1d)').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Reason for the mute').setRequired(false)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const target = interaction.options.getMember('target') as GuildMember;
    const durationInput = interaction.options.getString('duration', true);
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (!target) {
      return interaction.reply({ content: '❌ Target member not found.', ephemeral: true });
    }

    const check = checkModerationSafety(interaction, target, PermissionFlagsBits.ModerateMembers);
    if (!check.allowed) {
      return interaction.reply({ content: `❌ ${check.reason}`, ephemeral: true });
    }

    let msDuration: number;
    try {
      const parsed = ms(durationInput);
      if (!parsed || typeof parsed !== 'number' || parsed <= 0) {
        throw new Error('Invalid duration');
      }
      msDuration = parsed;
    } catch {
      return interaction.reply({
        content: '❌ **Invalid Duration**: Please use a format like `10m`, `2h`, or `3d`.',
        ephemeral: true,
      });
    }

    const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
    if (msDuration > MAX_TIMEOUT_MS) {
      return interaction.reply({
        content: '❌ **Limit Exceeded**: Discord timeouts cannot exceed 28 days.',
        ephemeral: true,
      });
    }

    try {
      await target.timeout(msDuration, reason);
      interaction.client.mutedUsers.set(target.id, interaction.user.id);

      const auditEmbed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🔇 Native Server Timeout Applied')
        .setDescription(`Member **${target.user.tag}** was timed out.`)
        .addFields(
          { name: 'Target', value: `<@${target.id}>`, inline: true },
          { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Duration', value: durationInput, inline: true },
          { name: 'Reason', value: reason, inline: false }
        )
        .setTimestamp();

      await sendAuditLog(interaction.client, interaction.guild!.id, { embeds: [auditEmbed] });

      await interaction.reply({
        content: `🔇 **Member Muted**: **${target.user.tag}** has been timed out for **${durationInput}**.\n**Reason**: ${reason}\n*(Only the muting moderator or ARCH members can undo this)*`,
      });
    } catch (err) {
      console.error('[Mute Error]:', err);
      await interaction.reply({ content: '❌ Failed to mute target user.', ephemeral: true });
    }
  }
};

// ==========================================
// 3. /unmute command (Remove Timeout)
// ==========================================
export const UnmuteCommand = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Removes timeout from a member.')
    .addUserOption((option) =>
      option.setName('target').setDescription('The member to unmute').setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const target = interaction.options.getMember('target') as GuildMember;

    if (!target) {
      return interaction.reply({ content: '❌ Target member not found.', ephemeral: true });
    }

    const check = checkModerationSafety(interaction, target, PermissionFlagsBits.ModerateMembers);
    if (!check.allowed) {
      return interaction.reply({ content: `❌ ${check.reason}`, ephemeral: true });
    }

    const muterId = interaction.client.mutedUsers.get(target.id);
    const isArch = interaction.client.archUsers.has(interaction.user.id);

    if (muterId && muterId !== interaction.user.id && !isArch) {
      return interaction.reply({
        content: `❌ **Access Denied**: You cannot unmute this user. Only the moderator who applied the mute (<@${muterId}>) or ARCH bypass members can unmute them.`,
        ephemeral: true,
      });
    }

    try {
      await target.timeout(null, `Unmuted by ${interaction.user.tag}`);
      interaction.client.mutedUsers.delete(target.id);

      const auditEmbed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('🔊 Server Timeout Revoked')
        .setDescription(`Member **${target.user.tag}** has been unmuted.`)
        .addFields(
          { name: 'Target', value: `<@${target.id}>`, inline: true },
          { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
        )
        .setTimestamp();

      await sendAuditLog(interaction.client, interaction.guild!.id, { embeds: [auditEmbed] });

      await interaction.reply({
        content: `🔊 **Member Unmuted**: Timeout removed from **${target.user.tag}**.`,
      });
    } catch (err) {
      console.error('[Unmute Error]:', err);
      await interaction.reply({ content: '❌ Failed to unmute target user.', ephemeral: true });
    }
  }
};

// ==========================================
// 4. /deafen command (Server Deafen)
// ==========================================
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
    const target = interaction.options.getMember('target') as GuildMember;
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (!target) {
      return interaction.reply({ content: '❌ Target member not found.', ephemeral: true });
    }

    const check = checkModerationSafety(interaction, target, PermissionFlagsBits.DeafenMembers);
    if (!check.allowed) {
      return interaction.reply({ content: `❌ ${check.reason}`, ephemeral: true });
    }

    if (!target.voice.channel) {
      return interaction.reply({
        content: `❌ **Voice Error**: Target **${target.user.tag}** is not in a voice channel.`,
        ephemeral: true,
      });
    }

    try {
      await target.voice.setDeaf(true, reason);

      const auditEmbed = new EmbedBuilder()
        .setColor(0xffaa00)
        .setTitle('🔇 Server Deafen Applied')
        .setDescription(`Deafened **${target.user.tag}** in <#${target.voice.channel.id}>.`)
        .addFields(
          { name: 'Target', value: `<@${target.id}>`, inline: true },
          { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
        )
        .setTimestamp();

      await sendAuditLog(interaction.client, interaction.guild!.id, { embeds: [auditEmbed] });

      await interaction.reply({
        content: `🔇 **Member Deafened**: Server deafened **${target.user.tag}** in VC.\n**Reason**: ${reason}`,
      });
    } catch (err) {
      console.error('[Deafen Error]:', err);
      await interaction.reply({ content: '❌ Failed to server-deafen target user.', ephemeral: true });
    }
  }
};

// ==========================================
// 5. /undeafen command (Remove Server Deafen)
// ==========================================
export const UndeafenCommand = {
  data: new SlashCommandBuilder()
    .setName('undeafen')
    .setDescription('Undeafens a member in a voice channel.')
    .addUserOption((option) =>
      option.setName('target').setDescription('The member to server-undeafen').setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const target = interaction.options.getMember('target') as GuildMember;

    if (!target) {
      return interaction.reply({ content: '❌ Target member not found.', ephemeral: true });
    }

    const check = checkModerationSafety(interaction, target, PermissionFlagsBits.DeafenMembers);
    if (!check.allowed) {
      return interaction.reply({ content: `❌ ${check.reason}`, ephemeral: true });
    }

    if (!target.voice.channel) {
      return interaction.reply({
        content: `❌ **Voice Error**: Target **${target.user.tag}** is not in a voice channel.`,
        ephemeral: true,
      });
    }

    try {
      await target.voice.setDeaf(false, `Undeafened by ${interaction.user.tag}`);

      const auditEmbed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('🔊 Server Deafen Revoked')
        .setDescription(`Undeafened **${target.user.tag}** in <#${target.voice.channel.id}>.`)
        .addFields(
          { name: 'Target', value: `<@${target.id}>`, inline: true },
          { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
        )
        .setTimestamp();

      await sendAuditLog(interaction.client, interaction.guild!.id, { embeds: [auditEmbed] });

      await interaction.reply({
        content: `🔊 **Member Undeafened**: Removed server-deafen from **${target.user.tag}**.`,
      });
    } catch (err) {
      console.error('[Undeafen Error]:', err);
      await interaction.reply({ content: '❌ Failed to server-undeafen target user.', ephemeral: true });
    }
  }
};

// ==========================================
// 6. /setnick command (Change Nickname)
// ==========================================
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
    const target = interaction.options.getMember('target') as GuildMember;
    const nickname = interaction.options.getString('nickname') || null;

    if (!target) {
      return interaction.reply({ content: '❌ Target member not found.', ephemeral: true });
    }

    const check = checkModerationSafety(interaction, target, PermissionFlagsBits.ManageNicknames);
    if (!check.allowed) {
      return interaction.reply({ content: `❌ ${check.reason}`, ephemeral: true });
    }

    try {
      const oldNick = target.nickname || target.user.username;
      await target.setNickname(nickname, `Nickname changed by ${interaction.user.tag}`);
      const response = nickname 
        ? `📝 Changed nickname of **${target.user.tag}** to **${nickname}**.` 
        : `📝 Reset nickname of **${target.user.tag}** to default.`;

      const auditEmbed = new EmbedBuilder()
        .setColor(0x00aaff)
        .setTitle('📝 Nickname Updated')
        .setDescription(`Modified nickname for **${target.user.tag}**.`)
        .addFields(
          { name: 'Target', value: `<@${target.id}>`, inline: true },
          { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Old Nickname', value: oldNick, inline: true },
          { name: 'New Nickname', value: nickname || 'Default', inline: true }
        )
        .setTimestamp();

      await sendAuditLog(interaction.client, interaction.guild!.id, { embeds: [auditEmbed] });

      await interaction.reply({ content: response });
    } catch (err) {
      console.error('[SetNick Error]:', err);
      await interaction.reply({ content: '❌ Failed to update target user nickname.', ephemeral: true });
    }
  }
};
