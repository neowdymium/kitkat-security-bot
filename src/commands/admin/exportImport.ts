import { AttachmentBuilder, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import {
  buildGuildSnapshot,
  buildSnapshotAttachment,
  decodeSnapshot,
  applyGuildSnapshot,
  KitKatExportFormat,
  KitKatExportScope,
} from '../../utils/stateSnapshots.js';
import { canAccessGuildExport } from '../../lib/kitkatState.js';

function parseScopes(scopeInput: string): KitKatExportScope[] {
  return scopeInput
    .split(',')
    .map((scope) => scope.trim().toLowerCase())
    .filter(Boolean) as KitKatExportScope[];
}

export const ExportCommand = {
  data: new SlashCommandBuilder()
    .setName('export')
    .setDescription('Export a guild snapshot inside KitKat DMs.')
    .addStringOption((opt) =>
      opt.setName('guild_id').setDescription('Target guild ID').setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('scope')
        .setDescription('Comma-separated scopes: all, config, perm, words, links, voice, setnick, ticket')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('format')
        .setDescription('Export format')
        .setRequired(false)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    if (interaction.guildId) {
      return interaction.reply({ content: '❌ `/export` must be used in KitKat DMs.', ephemeral: true });
    }

    const guildId = interaction.options.getString('guild_id', true);
    const scopeInput = interaction.options.getString('scope', true);
    const formatInput = (interaction.options.getString('format') || 'compact').toLowerCase() as KitKatExportFormat;
    const scopes = parseScopes(scopeInput);
    const format: KitKatExportFormat = formatInput === 'json' ? 'json' : 'compact';

    if (!canAccessGuildExport(interaction.client, guildId, interaction.user.id)) {
      return interaction.reply({
        content: '❌ You are not authorized to export data for that guild.',
        ephemeral: true,
      });
    }

    const snapshot = buildGuildSnapshot(interaction.client, guildId, scopes);
    const attachment = buildSnapshotAttachment(snapshot, format);

    await interaction.reply({
      content: `✅ Export ready for guild \`${guildId}\` with scopes: ${snapshot.scopes.join(', ')}.`,
      files: [attachment],
      ephemeral: true,
    });
  },
};

export const ImportCommand = {
  data: new SlashCommandBuilder()
    .setName('import')
    .setDescription('Import a guild snapshot inside KitKat DMs.')
    .addStringOption((opt) =>
      opt.setName('guild_id').setDescription('Target guild ID').setRequired(true)
    )
    .addAttachmentOption((opt) =>
      opt.setName('file').setDescription('Snapshot file produced by /export').setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    if (interaction.guildId) {
      return interaction.reply({ content: '❌ `/import` must be used in KitKat DMs.', ephemeral: true });
    }

    const guildId = interaction.options.getString('guild_id', true);
    const file = interaction.options.getAttachment('file', true);

    if (!canAccessGuildExport(interaction.client, guildId, interaction.user.id)) {
      return interaction.reply({
        content: '❌ You are not authorized to import data for that guild.',
        ephemeral: true,
      });
    }

    const response = await fetch(file.url);
    const buffer = Buffer.from(await response.arrayBuffer());
    const snapshot = decodeSnapshot(buffer);

    if (snapshot.guildId !== guildId) {
      return interaction.reply({
        content: `❌ Snapshot guild ID \`${snapshot.guildId}\` does not match the requested guild \`${guildId}\`.`,
        ephemeral: true,
      });
    }

    applyGuildSnapshot(interaction.client, snapshot);

    await interaction.reply({
      content: `✅ Imported KitKat snapshot for guild \`${guildId}\`.`,
      ephemeral: true,
    });
  },
};
