import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  PermissionFlagsBits, 
  GuildMember 
} from 'discord.js';
import { Database } from '../../database.js';
import { memberHasGuildScope } from '../../lib/kitkatState.js';

// Helper to check for automod administrative permissions
function verifyAutomodPermissions(interaction: ChatInputCommandInteraction): boolean {
  const member = interaction.member as GuildMember;
  return member.permissions.has(PermissionFlagsBits.ManageGuild) || memberHasGuildScope(member, 'automod');
}

// ==========================================
// 1. /blocktext command (Automod Text Filter)
// ==========================================
export const BlockTextCommand = {
  data: new SlashCommandBuilder()
    .setName('blocktext')
    .setDescription('Manage prohibited text phrases in automod.')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a phrase to the prohibited word list.')
        .addStringOption((opt) => opt.setName('phrase').setDescription('Prohibited word or phrase').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a phrase from the prohibited word list.')
        .addStringOption((opt) => opt.setName('phrase').setDescription('Phrase to unblock').setRequired(true))
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!verifyAutomodPermissions(interaction)) {
      return interaction.reply({
        content: '❌ **Access Denied**: You require "Manage Server" permissions or bot "automod" scope to edit blocked texts.',
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();
    const phrase = interaction.options.getString('phrase', true);
    const guildId = interaction.guildId!;

    if (sub === 'add') {
      const added = Database.addBlockedText(guildId, phrase);
      if (added) {
        await interaction.reply({
          content: `✅ **Automod Updated**: Phrase **"${phrase.toLowerCase()}"** is now blocked. Message containing it will be automatically deleted.`,
        });
      } else {
        await interaction.reply({
          content: `ℹ️ **Status Check**: Phrase **"${phrase.toLowerCase()}"** is already on the blocklist.`,
          ephemeral: true,
        });
      }
    } else if (sub === 'remove') {
      const removed = Database.removeBlockedText(guildId, phrase);
      if (removed) {
        await interaction.reply({
          content: `✅ **Automod Updated**: Phrase **"${phrase.toLowerCase()}"** has been unblocked.`,
        });
      } else {
        await interaction.reply({
          content: `❌ **Unblock Failed**: Phrase **"${phrase.toLowerCase()}"** was not found on the blocklist.`,
          ephemeral: true,
        });
      }
    }
  }
};

// ==========================================
// 2. /blocklink command (Automod Domain Filter)
// ==========================================
export const BlockLinkCommand = {
  data: new SlashCommandBuilder()
    .setName('blocklink')
    .setDescription('Manage prohibited link domains in automod.')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a domain to the prohibited link blacklist.')
        .addStringOption((opt) => opt.setName('domain').setDescription('Domain name (e.g. scam-link.com)').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a domain from the prohibited link blacklist.')
        .addStringOption((opt) => opt.setName('domain').setDescription('Domain to unblock').setRequired(true))
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!verifyAutomodPermissions(interaction)) {
      return interaction.reply({
        content: '❌ **Access Denied**: You require "Manage Server" permissions or bot "automod" scope to edit blocked links.',
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();
    const domain = interaction.options.getString('domain', true);
    const guildId = interaction.guildId!;

    if (sub === 'add') {
      const added = Database.addBlockedLink(guildId, domain);
      if (added) {
        await interaction.reply({
          content: `✅ **Automod Updated**: Link domain **"${domain.toLowerCase()}"** is now blocked. Message containing this link will be deleted.`,
        });
      } else {
        await interaction.reply({
          content: `ℹ️ **Status Check**: Domain **"${domain.toLowerCase()}"** is already on the link blocklist.`,
          ephemeral: true,
        });
      }
    } else if (sub === 'remove') {
      const removed = Database.removeBlockedLink(guildId, domain);
      if (removed) {
        await interaction.reply({
          content: `✅ **Automod Updated**: Link domain **"${domain.toLowerCase()}"** has been unblocked.`,
        });
      } else {
        await interaction.reply({
          content: `❌ **Unblock Failed**: Domain **"${domain.toLowerCase()}"** was not found on the link blocklist.`,
          ephemeral: true,
        });
      }
    }
  }
};

// ==========================================
// 3. /spam command (Anti-Spam Bypass Whitelist)
// ==========================================
export const SpamCommand = {
  data: new SlashCommandBuilder()
    .setName('spam')
    .setDescription('Manage anti-spam and anti-raid bypass exemptions.')
    .addSubcommand((sub) =>
      sub
        .setName('allow')
        .setDescription('Allow a user or bot to send rapid messages without triggering spam/raid rules.')
        .addUserOption((opt) => opt.setName('target').setDescription('Select user or bot').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('revoke')
        .setDescription('Revoke anti-spam/anti-raid exemption from a user or bot.')
        .addUserOption((opt) => opt.setName('target').setDescription('Select user or bot').setRequired(true))
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!verifyAutomodPermissions(interaction)) {
      return interaction.reply({
        content: '❌ **Access Denied**: You require "Manage Server" permissions or bot "automod" scope to configure spam bypass.',
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('target', true);
    const guildId = interaction.guildId!;

    if (sub === 'allow') {
      const added = Database.addSpamExemptUser(guildId, target.id);
      if (added) {
        await interaction.reply({
          content: `✅ **Anti-Spam Exemption Granted**: **${target.tag}** will now bypass message frequency and duplicate content filters.`,
        });
      } else {
        await interaction.reply({
          content: `ℹ️ **Status Check**: **${target.tag}** is already whitelisted for spam exemption.`,
          ephemeral: true,
        });
      }
    } else if (sub === 'revoke') {
      const removed = Database.removeSpamExemptUser(guildId, target.id);
      if (removed) {
        await interaction.reply({
          content: `✅ **Anti-Spam Exemption Revoked**: **${target.tag}** is no longer exempt from message filters.`,
        });
      } else {
        await interaction.reply({
          content: `❌ **Revocation Failed**: **${target.tag}** was not found on the spam exemption list.`,
          ephemeral: true,
        });
      }
    }
  }
};
