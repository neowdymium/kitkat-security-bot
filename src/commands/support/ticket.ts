import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
  Role,
  User,
  OverwriteResolvable,
} from 'discord.js';
import {
  addTicketRecord,
  deleteTicketRecord,
  getGuildState,
  getTicketCategory,
  getTicketRecord,
  getTicketSupportTargets,
  isGuildArch,
  memberHasGuildScope,
} from '../../lib/kitkatState.js';

async function buildTranscript(channel: TextChannel): Promise<string> {
  const allMessages: Array<{
    authorTag: string;
    createdAt: number;
    content: string;
    attachments: string[];
  }> = [];

  let before: string | undefined;
  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || batch.size === 0) break;

    const ordered = Array.from(batch.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    for (const message of ordered) {
      allMessages.push({
        authorTag: message.author.tag,
        createdAt: message.createdTimestamp,
        content: message.content,
        attachments: Array.from(message.attachments.values()).map((attachment) => attachment.url),
      });
    }

    before = ordered[0]?.id;
    if (batch.size < 100) break;
  }

  return allMessages
    .map((line) => {
      const attachmentList = line.attachments.length ? `\nAttachments: ${line.attachments.join(' ')}` : '';
      return `[${new Date(line.createdAt).toISOString()}] ${line.authorTag}: ${line.content || '[no text]'}${attachmentList}`;
    })
    .join('\n\n');
}

function isRoleMentionable(value: Role | User): value is Role {
  return 'position' in value;
}

export const TicketCommand = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Create and manage KitKat support tickets.')
    .addSubcommand((sub) =>
      sub
        .setName('support')
        .setDescription('Assign support staff who can manage tickets.')
        .addMentionableOption((opt) => opt.setName('target').setDescription('User or role').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a private support ticket.')
        .addStringOption((opt) => opt.setName('reason').setDescription('Ticket reason').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('close').setDescription('Close the active ticket.')
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId || !interaction.guild) {
      return interaction.reply({ content: '❌ `/ticket` can only be used in a server.', ephemeral: true });
    }

    const member = interaction.member as GuildMember;
    const sub = interaction.options.getSubcommand();
    const state = getGuildState(interaction.client, interaction.guildId);

    if (sub === 'support') {
      if (!isGuildArch(interaction.client, interaction.guildId, interaction.user.id)) {
        return interaction.reply({ content: '❌ Only ARCH members can assign ticket support staff.', ephemeral: true });
      }

      const target = interaction.options.getMentionable('target', true) as Role | User;
      state.ticketSupportTargets.set(target.id, isRoleMentionable(target) ? 'role' : 'user');
      await interaction.reply({
        content: `✅ Added **${isRoleMentionable(target) ? target.name : target.tag}** as ticket support.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === 'create') {
      const reason = interaction.options.getString('reason', true);
      const categoryId = getTicketCategory(interaction.client, interaction.guildId);
      if (!categoryId) {
        return interaction.reply({ content: '❌ No ticket category is configured. Use `/config ticket category` first.', ephemeral: true });
      }

      if (Array.from(state.ticketRecords.values()).some((ticket) => ticket.creatorId === interaction.user.id)) {
        return interaction.reply({ content: '❌ You already have an open ticket.', ephemeral: true });
      }

      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`.toLowerCase(),
        type: ChannelType.GuildText,
        parent: categoryId,
        topic: `KitKat ticket created by ${interaction.user.tag}: ${reason}`,
        permissionOverwrites: [
          {
            id: interaction.guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: interaction.user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          },
          ...getTicketSupportTargets(interaction.client, interaction.guildId).map((target) => ({
            id: target.targetId,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          })) as OverwriteResolvable[],
        ],
      });

      addTicketRecord(interaction.client, interaction.guildId, {
        channelId: channel.id,
        creatorId: interaction.user.id,
        reason,
        createdAt: Date.now(),
      });

      await interaction.reply({
        content: `✅ Your support ticket has been created: <#${channel.id}>`,
        ephemeral: true,
      });
      return;
    }

    const currentChannel = interaction.channel;
    if (!currentChannel || currentChannel.type !== ChannelType.GuildText) {
      return interaction.reply({ content: '❌ Tickets can only be closed from inside a ticket channel.', ephemeral: true });
    }

    const ticket = getTicketRecord(interaction.client, interaction.guildId, currentChannel.id);
    if (!ticket) {
      return interaction.reply({ content: '❌ This channel is not registered as an open ticket.', ephemeral: true });
    }

    const isOwner = ticket.creatorId === interaction.user.id;
    const isSupport = memberHasGuildScope(member, 'ticket') || isGuildArch(interaction.client, interaction.guildId, interaction.user.id);
    if (!isOwner && !isSupport) {
      return interaction.reply({ content: '❌ You are not allowed to close this ticket.', ephemeral: true });
    }

    const transcript = await buildTranscript(currentChannel);
    const buffer = Buffer.from(transcript || 'No messages were recorded in this ticket.', 'utf8');
    const fileName = `kitkat-ticket-${currentChannel.id}-${Date.now()}.txt`;
    const creator = await interaction.client.users.fetch(ticket.creatorId).catch(() => null);
    if (creator) {
      await creator.send({
        content: `📄 Your KitKat ticket transcript from <#${currentChannel.id}>.`,
        files: [{ attachment: buffer, name: fileName }],
      }).catch(() => {});
    }

    deleteTicketRecord(interaction.client, interaction.guildId, currentChannel.id);
    await interaction.reply({ content: '✅ Ticket closed. Transcript sent to the ticket creator if DMs are enabled.' });
    await currentChannel.delete(`KitKat ticket closed by ${interaction.user.tag}`).catch(() => {});
  },
};
