import { Events, Interaction, ButtonInteraction, GuildMember, ActionRowBuilder, ButtonBuilder, ComponentType } from 'discord.js';
import {
  deleteNicknameRequest,
  getNicknameRequest,
  isNicknameApprover,
} from '../lib/kitkatState.js';
import { buildKitKatEmbed } from '../lib/kitkatState.js';

// Cooldown cache to rate-limit slash commands globally (2s duration per user/command combo)
const commandCooldowns = new Map<string, number>();
const COOLDOWN_DURATION_MS = 2000;

/**
 * Handles incoming interactions from the Discord Gateway.
 * Dispatches slash commands and leaves fine-grained permission checks to the commands themselves.
 */
export default {
  name: Events.InteractionCreate,
  once: false,
  async execute(interaction: Interaction) {
    if (interaction.isButton()) {
      await handleButtonInteraction(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    // 1. Dispatcher Guild-only Pre-flight Guard
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: '❌ **Access Denied**: KitKat slash commands can only be executed within a Discord server (guild).',
        ephemeral: true,
      });
      return;
    }

    const { client, commandName, user, guild } = interaction;
    const command = client.commands.get(commandName);

    if (!command) {
      console.warn(`[Interaction Warning]: Slash command /${commandName} was called but not found in memory.`);
      return;
    }

    // 2. Command Rate-limiting / Cooldown Check
    const cooldownKey = `${user.id}:${commandName}`;
    const now = Date.now();
    const expiration = commandCooldowns.get(cooldownKey);
    if (expiration && now < expiration) {
      const secondsLeft = ((expiration - now) / 1000).toFixed(1);
      await interaction.reply({
        content: `⏱️ **Cooldown Active**: Please wait **${secondsLeft}s** before calling \`/${commandName}\` again.`,
        ephemeral: true,
      });
      return;
    }
    commandCooldowns.set(cooldownKey, now + COOLDOWN_DURATION_MS);

    try {
      console.log(`[KitKat Interaction]: Running /${commandName} for ${user.tag} (${user.id}) in guild ${interaction.guildId}`);
      await command.execute(interaction);
    } catch (error) {
      console.error(`[Execution Error]: Failed to execute /${commandName}:`, error);

      const errorMessage = {
        content: '❌ An unexpected error occurred while executing this command. The issue has been logged.',
        ephemeral: true,
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage).catch(() => {});
      } else {
        await interaction.reply(errorMessage).catch(() => {});
      }
    }
  },
};

async function handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: '❌ This action can only be used inside a server.', ephemeral: true });
    return;
  }

  if (!interaction.customId.startsWith('kitkat:nick:approve:')) {
    return;
  }

  const requestId = interaction.customId.slice('kitkat:nick:approve:'.length);
  const request = getNicknameRequest(interaction.client, interaction.guildId, requestId);

  if (!request) {
    await interaction.reply({ content: '❌ This nickname request no longer exists.', ephemeral: true });
    return;
  }

  if (!interaction.member || !('roles' in interaction.member)) {
    await interaction.reply({ content: '❌ Unable to validate your approval role.', ephemeral: true });
    return;
  }

  const approverAllowed = isNicknameApprover(interaction.member as GuildMember);
  if (!approverAllowed) {
    await interaction.reply({ content: '❌ You are not authorized to approve nickname requests.', ephemeral: true });
    return;
  }

  const guild = interaction.guild!;
  const target = await guild.members.fetch(request.targetId).catch(() => null);
  if (!target) {
    deleteNicknameRequest(interaction.client, interaction.guildId, requestId);
    await interaction.reply({ content: '❌ The target member is no longer in this server.', ephemeral: true });
    return;
  }

  let success = true;
  try {
    await target.setNickname(request.requestedNick, `KitKat nickname approved by ${interaction.user.tag}`);
  } catch (error) {
    console.error('[Nickname Approval Error]:', error);
    success = false;
  }

  deleteNicknameRequest(interaction.client, interaction.guildId, requestId);

  // Disable the button in the action row
  let row: ActionRowBuilder<ButtonBuilder> | null = null;
  if (interaction.message && interaction.message.components.length > 0) {
    row = new ActionRowBuilder<ButtonBuilder>();
    const originalRow = interaction.message.components[0] as any;
    originalRow.components.forEach((comp: any) => {
      if (comp.type === ComponentType.Button) {
        const btn = ButtonBuilder.from(comp);
        btn.setDisabled(true);
        row!.addComponents(btn);
      }
    });
  }

  if (success) {
    const embed = buildKitKatEmbed(
      '✅ KitKat Nickname Approved',
      `Approved & Applied by <@${interaction.user.id}>.\n\n**Member:** <@${request.targetId}>\n**Nickname:** \`${request.requestedNick}\``,
      0x00cc66
    );

    if (interaction.message && 'edit' in interaction.message) {
      await interaction.message.edit({
        embeds: [embed],
        components: row ? [row] : [],
      }).catch(() => {});
    }

    await interaction.reply({
      content: `✅ Approved and applied nickname change for <@${request.targetId}>.`,
      ephemeral: true,
    });
  } else {
    const embed = buildKitKatEmbed(
      '❌ KitKat Nickname Approval Failed',
      `Approval Failed (Hierarchy Error).\n\n**Member:** <@${request.targetId}>\n**Nickname:** \`${request.requestedNick}\``,
      0xff3333
    );

    if (interaction.message && 'edit' in interaction.message) {
      await interaction.message.edit({
        embeds: [embed],
        components: row ? [row] : [],
      }).catch(() => {});
    }

    await interaction.reply({
      content: `❌ **Hierarchy Error**: KitKat has lower role hierarchy than <@${request.targetId}> and cannot rename them.`,
      ephemeral: true,
    });
  }
}
