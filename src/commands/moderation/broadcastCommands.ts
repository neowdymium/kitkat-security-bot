import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  PermissionFlagsBits, 
  GuildMember, 
  TextChannel, 
  EmbedBuilder 
} from 'discord.js';
import { Database } from '../../database.js';
import { sendAuditLog } from '../../middleware/messagePipeline.js';

// ==========================================
// 1. /tell command (Broadcast Message)
// ==========================================
export const TellCommand = {
  data: new SlashCommandBuilder()
    .setName('tell')
    .setDescription('Sends a message broadcast to a text channel directly from the bot, masking your identity.')
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Select destination text channel')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('message')
        .setDescription('The text message to transmit')
        .setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const executor = interaction.member as GuildMember;

    // Check permission: Executor must have ManageMessages or bot "tell" scope
    if (!executor.permissions.has(PermissionFlagsBits.ManageMessages) && !Database.hasPermission(executor.id, 'tell')) {
      return interaction.reply({
        content: '❌ **Access Denied**: You require "Manage Messages" server permission or bot internal "tell" scope to use broadcast.',
        ephemeral: true,
      });
    }

    const channel = interaction.options.getChannel('channel', true) as TextChannel;
    const messageText = interaction.options.getString('message', true);

    // Verify channel is text-based
    if (!channel.isTextBased()) {
      return interaction.reply({
        content: '❌ **Target Error**: Broadcast destination must be a text-based channel.',
        ephemeral: true,
      });
    }

    // Verify bot has permissions to write in the target channel
    const bot = interaction.guild?.members.me;
    if (bot && !bot.permissionsIn(channel).has(PermissionFlagsBits.SendMessages)) {
      return interaction.reply({
        content: '❌ **Bot Permission Error**: I do not have permission to send messages in the selected channel.',
        ephemeral: true,
      });
    }

    try {
      // 1. Send broadcast directly to target channel
      await channel.send(messageText);

      // 2. Reply to executor ephemerally so they know it was sent successfully
      await interaction.reply({
        content: `✅ **Broadcast Transmitted**: Message sent to <#${channel.id}>.`,
        ephemeral: true,
      });

      // 3. Log the audit details to the staff logs channel (masks publicly, logs internally)
      const auditEmbed = new EmbedBuilder()
        .setColor(0x00ffaa)
        .setTitle('📢 Public Broadcast Transmitted')
        .setDescription(`Moderator **${interaction.user.tag}** sent a broadcast via bot.`)
        .addFields(
          { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Channel', value: `<#${channel.id}>`, inline: true },
          { name: 'Content Sent', value: `\`\`\`\n${messageText.slice(0, 1000)}\n\`\`\`` }
        )
        .setTimestamp();

      await sendAuditLog(interaction.client, interaction.guild!.id, { embeds: [auditEmbed] });

    } catch (error) {
      console.error('[Tell Command Error]:', error);
      await interaction.reply({
        content: '❌ Failed to broadcast the message.',
        ephemeral: true,
      });
    }
  }
};
