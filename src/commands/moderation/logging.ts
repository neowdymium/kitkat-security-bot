import { AttachmentBuilder, ChatInputCommandInteraction, SlashCommandBuilder, TextBasedChannel, GuildMember, PermissionFlagsBits } from 'discord.js';
import { getGuildState, memberHasGuildScope, startLoggingSession, stopLoggingSession } from '../../lib/kitkatState.js';

function formatTranscriptLine(data: {
  authorTag: string;
  authorId: string;
  content: string;
  createdAt: number;
  attachments: string[];
}): string {
  const time = new Date(data.createdAt).toISOString();
  const attachmentBlock = data.attachments.length ? `\nAttachments: ${data.attachments.join(' ')}` : '';
  return `[${time}] ${data.authorTag} (${data.authorId}): ${data.content || '[no text]'}${attachmentBlock}`;
}

export const LoggingCommand = {
  data: new SlashCommandBuilder()
    .setName('logging')
    .setDescription('Record and export a channel transcript.')
    .addSubcommand((sub) => sub.setName('start').setDescription('Start recording this channel.'))
    .addSubcommand((sub) => sub.setName('stop').setDescription('Stop recording and export the transcript.')),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      return interaction.reply({ content: '❌ `/logging` can only be used in a server.', ephemeral: true });
    }

    const member = interaction.member as GuildMember;
    if (!member.permissions.has(PermissionFlagsBits.ManageGuild) && !memberHasGuildScope(member, 'logging')) {
      return interaction.reply({
        content: '❌ You need Manage Server or a KitKat `logging` scope to use this command.',
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();
    const state = getGuildState(interaction.client, interaction.guildId);
    const currentChannel = interaction.channel;

    if (!currentChannel || !('isTextBased' in currentChannel) || !currentChannel.isTextBased()) {
      return interaction.reply({ content: '❌ `/logging` must be used inside a text-based channel.', ephemeral: true });
    }

    if (sub === 'start') {
      startLoggingSession(interaction.client, interaction.guildId, currentChannel.id, interaction.user.id);
      await interaction.reply({
        content: `✅ **KitKat Logging**: Started recording <#${currentChannel.id}>.`,
      });
      return;
    }

    const session = stopLoggingSession(interaction.client, interaction.guildId, currentChannel.id);
    if (!session) {
      return interaction.reply({ content: '❌ No active logging session was found for this channel.', ephemeral: true });
    }

    const transcript = session.messages.map(formatTranscriptLine).join('\n\n');
    const file = new AttachmentBuilder(Buffer.from(transcript || 'No messages were recorded.', 'utf8'), {
      name: `kitkat-log-${currentChannel.id}-${Date.now()}.txt`,
    });

    const destinationId = state.config.loggingChannelId;
    if (!destinationId) {
      return interaction.reply({
        content: '❌ No designated logging channel is configured. Use `/config logging set` first.',
        ephemeral: true,
      });
    }

    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({ content: '❌ `/logging` can only be used in a server.', ephemeral: true });
    }

    const destination = guild.channels.cache.get(destinationId);
    if (!destination || !('send' in destination)) {
      return interaction.reply({
        content: '❌ The configured logging channel is unavailable.',
        ephemeral: true,
      });
    }

    await (destination as any).send({
      content: `📄 **KitKat Transcript** for <#${currentChannel.id}>`,
      files: [file],
    });

    await interaction.reply({
      content: `✅ **KitKat Logging**: Exported the transcript to <#${destinationId}>.`,
    });
  },
};
