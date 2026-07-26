import { SlashCommandBuilder, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { Config } from '../../config.js';
import {
  addArchMember,
  allowTargetOnLockedChannels,
  buildKitKatEmbed,
  getGuildState,
  isAlphaArchon,
  isGuildArch,
  removeArchMember,
  sendKitKatLog,
} from '../../lib/kitkatState.js';

export const ArchCommand = {
  data: new SlashCommandBuilder()
    .setName('arch')
    .setDescription('Authenticate into the KitKat ARCH system.')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Promote a user into ARCH.')
        .addUserOption((option) =>
          option.setName('target').setDescription('The user to promote').setRequired(true)
        )
        .addStringOption((option) =>
          option.setName('code').setDescription('ARCH authentication code').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Demote an ARCH member.')
        .addUserOption((option) =>
          option.setName('target').setDescription('The ARCH member to remove').setRequired(true)
        )
        .addStringOption((option) =>
          option.setName('code').setDescription('ARCH authentication code').setRequired(true)
        )
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const codeInput = interaction.options.getString('code', true);
    const targetUser = interaction.options.getUser('target', true);
    const guildId = interaction.guildId!;
    const state = getGuildState(interaction.client, guildId);
    const callerIsArch = isGuildArch(interaction.client, guildId, interaction.user.id);
    const callerIsAlpha = isAlphaArchon(interaction.client, guildId, interaction.user.id);

    if (codeInput !== Config.archSafeguardCode) {
      return interaction.reply({
        content: '❌ **KitKat ARCH**: Invalid authentication code.',
        ephemeral: true,
      });
    }

    if (sub === 'add') {
      if (state.archUsers.size === 0) {
        if (targetUser.id !== interaction.user.id) {
          return interaction.reply({
            content: '❌ The first ARCH member in a guild must authenticate themselves.',
            ephemeral: true,
          });
        }

        addArchMember(interaction.client, guildId, targetUser.id, {
          isAlpha: true,
          grantedBy: interaction.user.id,
          grantedAt: Date.now(),
        });

        await interaction.reply({
          content: '👑 **KitKat ARCH**: You are now the **Alpha Archon** for this guild.',
          ephemeral: true,
        });
        return;
      }

      if (!callerIsArch) {
        return interaction.reply({
          content: '❌ Only an existing ARCH member can promote another user into ARCH.',
          ephemeral: true,
        });
      }

      if (isGuildArch(interaction.client, guildId, targetUser.id)) {
        return interaction.reply({
          content: `ℹ️ **KitKat ARCH**: **${targetUser.tag}** is already an ARCH member.`,
          ephemeral: true,
        });
      }

      addArchMember(interaction.client, guildId, targetUser.id, {
        isAlpha: false,
        grantedBy: interaction.user.id,
        grantedAt: Date.now(),
      });
      allowTargetOnLockedChannels(interaction.client, guildId, targetUser.id);

      await interaction.reply({
        content: `👑 **KitKat ARCH**: Promoted **${targetUser.tag}** into ARCH.`,
        ephemeral: true,
      });
      return;
    }

    const targetRecord = state.archUsers.get(targetUser.id);
    if (!targetRecord) {
      return interaction.reply({
        content: `ℹ️ **KitKat ARCH**: **${targetUser.tag}** is not registered as ARCH in this guild.`,
        ephemeral: true,
      });
    }

    if (!callerIsArch) {
      return interaction.reply({
        content: '❌ Only an existing ARCH member can remove ARCH access.',
        ephemeral: true,
      });
    }

    if (targetRecord.isAlpha && !callerIsAlpha) {
      return interaction.reply({
        content: '❌ Standard ARCH members cannot demote the Alpha Archon.',
        ephemeral: true,
      });
    }

    if (targetUser.id === interaction.user.id && !callerIsAlpha) {
      return interaction.reply({
        content: '❌ Only the Alpha Archon can demote themselves.',
        ephemeral: true,
      });
    }

    removeArchMember(interaction.client, guildId, targetUser.id);

    await sendKitKatLog(
      interaction.client,
      guildId,
      {
        embeds: [
          buildKitKatEmbed(
            '👑 KitKat ARCH Updated',
            `Removed ARCH access for **${targetUser.tag}**.`,
            0x8b5cf6
          ),
        ],
      }
    );

    await interaction.reply({
      content: `👑 **KitKat ARCH**: Removed ARCH access from **${targetUser.tag}**.`,
      ephemeral: true,
    });
  },
};
