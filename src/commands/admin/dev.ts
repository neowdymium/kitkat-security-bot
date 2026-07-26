import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import os from 'os';
import { Config } from '../../config.js';
import { getGuildState, buildKitKatEmbed } from '../../lib/kitkatState.js';

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

export const DevCommand = {
  data: new SlashCommandBuilder()
    .setName('dev')
    .setDescription('Developer controls for KitKat.')
    .addSubcommand((sub) =>
      sub.setName('info').setDescription('Show fleet status and joined guild information.')
    )
    .addSubcommand((sub) =>
      sub
        .setName('leave')
        .setDescription('Force KitKat to leave a guild.')
        .addStringOption((option) =>
          option.setName('guild_id').setDescription('Target guild ID').setRequired(true)
        )
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    if (interaction.user.id !== Config.devId) {
      return interaction.reply({
        content: '❌ **KitKat Access Denied**: This developer command is restricted to the primary owner.',
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'leave') {
      const guildId = interaction.options.getString('guild_id', true);
      const guild = interaction.client.guilds.cache.get(guildId);

      if (!guild) {
        return interaction.reply({
          content: `❌ **KitKat Dev**: Guild \`${guildId}\` is not currently joined.`,
          ephemeral: true,
        });
      }

      await interaction.reply({
        content: `✅ **KitKat Dev**: Leaving **${guild.name}** (\`${guild.id}\`).`,
        ephemeral: true,
      });

      await guild.leave();
      return;
    }

    const guilds = Array.from(interaction.client.guilds.cache.values());
    const totalServers = guilds.length;
    const activeVoiceConnections = guilds.reduce((count, guild) => count + guild.voiceStates.cache.filter((state) => Boolean(state.channelId)).size, 0);
    const memory = process.memoryUsage();

    const pages: EmbedBuilder[] = [];
    const pageSize = 5;

    for (let i = 0; i < guilds.length; i += pageSize) {
      const slice = guilds.slice(i, i + pageSize);
      const embed = buildKitKatEmbed(
        `🛠️ KitKat Fleet Info - Page ${Math.floor(i / pageSize) + 1}`,
        [
          `Servers: **${totalServers}**`,
          `Active voice connections: **${activeVoiceConnections}**`,
          `Memory RSS: **${formatBytes(memory.rss)}**`,
          `Heap used: **${formatBytes(memory.heapUsed)}**`,
        ].join('\n'),
        0x5865f2
      );

      for (const guild of slice) {
        const state = getGuildState(interaction.client, guild.id);
        const archIds = Array.from(state.archUsers.keys());
        embed.addFields({
          name: `${guild.name} (${guild.memberCount} members)`,
          value: [
            `Guild ID: \`${guild.id}\``,
            archIds.length > 0 ? `ARCH IDs: ${archIds.map((id) => `\`${id}\``).join(', ')}` : 'ARCH IDs: none',
          ].join('\n'),
        });
      }

      pages.push(embed);
    }

    await interaction.reply({
      embeds: pages.length > 0 ? pages : [buildKitKatEmbed('🛠️ KitKat Fleet Info', 'KitKat is online but has no joined guilds yet.', 0x5865f2)],
      ephemeral: true,
    });
  },
};
