import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  GuildMember,
  Role,
  User,
  ChannelType,
} from 'discord.js';
import { Config } from '../../config.js';
import {
  addNicknameApprover,
  buildKitKatEmbed,
  deleteGuildPermissionGrant,
  isGuildArch,
  memberHasGuildScope,
  removeExportDelegate,
  sendKitKatLog,
  setGuildDmAlerts,
  setGuildLoggingChannel,
  setGuildPermissionGrant,
  setExportDelegate,
  setSetNickChannel,
  setTempVcCategory,
  setTicketCategory,
} from '../../lib/kitkatState.js';
import { sendDeveloperBackup } from '../../utils/stateSnapshots.js';

function isRoleOrUser(value: Role | User): value is Role {
  return 'position' in value;
}

function labelForMentionable(value: Role | User): string {
  return isRoleOrUser(value) ? value.name : value.tag;
}

export const ConfigCommand = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure KitKat server settings.')
    .addSubcommandGroup((group) =>
      group
        .setName('logging')
        .setDescription('Configure logging output.')
        .addSubcommand((sub) =>
          sub
            .setName('set')
            .setDescription('Set the staff logging channel.')
            .addChannelOption((opt) =>
              opt.setName('channel').setDescription('Logging channel').setRequired(true)
            )
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName('tempvc')
        .setDescription('Configure temporary voice channels.')
        .addSubcommand((sub) =>
          sub
            .setName('category')
            .setDescription('Set the default temp VC category.')
            .addChannelOption((opt) =>
              opt.setName('category').setDescription('Temp VC category').setRequired(true)
            )
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName('ticket')
        .setDescription('Configure support tickets.')
        .addSubcommand((sub) =>
          sub
            .setName('category')
            .setDescription('Set the ticket category.')
            .addChannelOption((opt) =>
              opt.setName('category').setDescription('Ticket category').setRequired(true)
            )
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName('setnick')
        .setDescription('Configure nickname requests.')
        .addSubcommand((sub) =>
          sub
            .setName('channel')
            .setDescription('Set where nickname requests are posted.')
            .addChannelOption((opt) =>
              opt.setName('channel').setDescription('Request channel').setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('approval')
            .setDescription('Authorize a user or role to approve nickname requests.')
            .addMentionableOption((opt) =>
              opt.setName('target').setDescription('Approver target').setRequired(true)
            )
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName('permission')
        .setDescription('Delegate export/import access.')
        .addSubcommand((sub) =>
          sub
            .setName('ref')
            .setDescription('Grant a user export/import access for one guild.')
            .addUserOption((opt) => opt.setName('user').setDescription('User to grant').setRequired(true))
            .addStringOption((opt) =>
              opt.setName('guild_id').setDescription('Guild ID to authorize').setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('revoke')
            .setDescription('Revoke a user export/import access for one guild.')
            .addUserOption((opt) => opt.setName('user').setDescription('User to revoke').setRequired(true))
            .addStringOption((opt) =>
              opt.setName('guild_id').setDescription('Guild ID to revoke').setRequired(true)
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('dm_alerts')
        .setDescription('Toggle direct message alerts.')
        .addBooleanOption((opt) =>
          opt.setName('enabled').setDescription('Enable or disable DM alerts').setRequired(true)
        )
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (!member.permissions.has(PermissionFlagsBits.Administrator) && !memberHasGuildScope(member, 'config')) {
      return interaction.reply({
        content: '❌ You need Discord Administrator or a KitKat `config` scope to change settings.',
        ephemeral: true,
      });
    }

    if (group === 'logging' && sub === 'set') {
      const channel = interaction.options.getChannel('channel', true);
      if (!('isTextBased' in channel) || !channel.isTextBased()) {
        return interaction.reply({ content: '❌ Logging channel must be text-based.', ephemeral: true });
      }

      setGuildLoggingChannel(interaction.client, interaction.guildId!, channel.id);
      await interaction.reply({
        content: `✅ **KitKat** will send staff logs to <#${channel.id}>.`,
      });
      await sendDeveloperBackup(interaction.client, interaction.guildId!, ['config']);
      return;
    }

    if (group === 'tempvc' && sub === 'category') {
      const category = interaction.options.getChannel('category', true);
      if (category.type !== ChannelType.GuildCategory) {
        return interaction.reply({ content: '❌ Please choose a category channel.', ephemeral: true });
      }

      setTempVcCategory(interaction.client, interaction.guildId!, category.id);
      await interaction.reply({ content: `✅ **KitKat TempVC** category set to <#${category.id}>.` });
      await sendDeveloperBackup(interaction.client, interaction.guildId!, ['config']);
      return;
    }

    if (group === 'ticket' && sub === 'category') {
      const category = interaction.options.getChannel('category', true);
      if (category.type !== ChannelType.GuildCategory) {
        return interaction.reply({ content: '❌ Please choose a category channel.', ephemeral: true });
      }

      setTicketCategory(interaction.client, interaction.guildId!, category.id);
      await interaction.reply({ content: `✅ **KitKat Ticket** category set to <#${category.id}>.` });
      await sendDeveloperBackup(interaction.client, interaction.guildId!, ['config']);
      return;
    }

    if (group === 'setnick' && sub === 'channel') {
      const channel = interaction.options.getChannel('channel', true);
      if (!('isTextBased' in channel) || !channel.isTextBased()) {
        return interaction.reply({ content: '❌ Nickname requests must be posted in a text channel.', ephemeral: true });
      }

      setSetNickChannel(interaction.client, interaction.guildId!, channel.id);
      await interaction.reply({ content: `✅ **KitKat SetNick** requests will be posted in <#${channel.id}>.` });
      await sendDeveloperBackup(interaction.client, interaction.guildId!, ['config', 'setnick']);
      return;
    }

    if (group === 'setnick' && sub === 'approval') {
      if (!isGuildArch(interaction.client, interaction.guildId!, interaction.user.id)) {
        return interaction.reply({ content: '❌ Only ARCH members can configure nickname approvers.', ephemeral: true });
      }

      const target = interaction.options.getMentionable('target', true) as Role | User;
      addNicknameApprover(interaction.client, interaction.guildId!, target.id, isRoleOrUser(target) ? 'role' : 'user');

      await interaction.reply({
        content: `✅ **KitKat SetNick**: Added **${labelForMentionable(target)}** as a nickname approver.`,
      });
      await sendDeveloperBackup(interaction.client, interaction.guildId!, ['config', 'setnick']);
      return;
    }

    if (group === 'permission') {
      if (interaction.user.id !== Config.devId) {
        return interaction.reply({
          content: '❌ Only the developer can delegate export/import access.',
          ephemeral: true,
        });
      }

      const targetUser = interaction.options.getUser('user', true);
      const guildId = interaction.options.getString('guild_id', true);

      if (sub === 'ref') {
        setExportDelegate(interaction.client, guildId, targetUser.id);
        await interaction.reply({
          content: `✅ **KitKat Permission**: Granted export/import access for guild \`${guildId}\` to **${targetUser.tag}**.`,
          ephemeral: true,
        });
      } else {
        removeExportDelegate(interaction.client, guildId, targetUser.id);
        await interaction.reply({
          content: `✅ **KitKat Permission**: Revoked export/import access for guild \`${guildId}\` from **${targetUser.tag}**.`,
          ephemeral: true,
        });
      }

      await sendDeveloperBackup(interaction.client, guildId, ['config', 'perm']);
      return;
    }

    if (sub === 'dm_alerts') {
      const enabled = interaction.options.getBoolean('enabled', true);
      setGuildDmAlerts(interaction.client, interaction.guildId!, enabled);
      await interaction.reply({
        content: `✅ **KitKat** DM alerts are now **${enabled ? 'ENABLED' : 'DISABLED'}**.`,
      });
      await sendDeveloperBackup(interaction.client, interaction.guildId!, ['config']);
    }
  },
};

export const PermCommand = {
  data: new SlashCommandBuilder()
    .setName('perm')
    .setDescription('Manage KitKat-specific command execution permissions for users or roles.')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Grant KitKat command permissions to a user or role.')
        .addMentionableOption((opt) => opt.setName('target').setDescription('User or role').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('scope').setDescription('Comma-separated scopes or "all"').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Revoke all KitKat command permissions from a user or role.')
        .addMentionableOption((opt) => opt.setName('target').setDescription('User or role').setRequired(true))
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const executor = interaction.member as GuildMember;
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getMentionable('target', true) as Role | User;

    if (!executor.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: '❌ Only server administrators can edit KitKat scopes.',
        ephemeral: true,
      });
    }

    if (sub === 'add') {
      const scopeInput = interaction.options.getString('scope', true);
      const scopes = scopeInput
        .split(',')
        .map((scope) => scope.trim().toLowerCase())
        .filter(Boolean);
      setGuildPermissionGrant(
        interaction.client,
        interaction.guildId!,
        target.id,
        isRoleOrUser(target) ? 'role' : 'user',
        scopes
      );

      await interaction.reply({
        content: `✅ Granted scopes \`${scopes.join(', ')}\` to **${labelForMentionable(target)}**.`,
      });
      await sendDeveloperBackup(interaction.client, interaction.guildId!, ['perm', 'config']);
      return;
    }

    deleteGuildPermissionGrant(interaction.client, interaction.guildId!, target.id);
    await interaction.reply({
      content: `✅ Cleared KitKat permissions for **${labelForMentionable(target)}**.`,
    });
    await sendDeveloperBackup(interaction.client, interaction.guildId!, ['perm', 'config']);
  },
};

export const RoleCommand = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Assign or remove server roles from members.')
    .addSubcommand((sub) =>
      sub
        .setName('assign')
        .setDescription('Assign a server role to a user.')
        .addUserOption((opt) => opt.setName('target').setDescription('Target member').setRequired(true))
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to assign').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a server role from a user.')
        .addUserOption((opt) => opt.setName('target').setDescription('Target member').setRequired(true))
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to remove').setRequired(true))
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const executor = interaction.member as GuildMember;
    const bot = interaction.guild?.members.me;

    if (!executor.permissions.has(PermissionFlagsBits.ManageRoles) && !memberHasGuildScope(executor, 'role')) {
      return interaction.reply({
        content: '❌ You need Manage Roles or a KitKat `role` scope to use this command.',
        ephemeral: true,
      });
    }

    if (!bot || !bot.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({
        content: '❌ KitKat needs Manage Roles permission to manage roles.',
        ephemeral: true,
      });
    }

    const targetMember = interaction.options.getMember('target') as GuildMember | null;
    const role = interaction.options.getRole('role') as Role | null;

    if (!targetMember || !role) {
      return interaction.reply({ content: '❌ Target member or role not found.', ephemeral: true });
    }

    if (role.position >= bot.roles.highest.position) {
      return interaction.reply({
        content: `❌ The role **${role.name}** is higher than or equal to my highest role.`,
        ephemeral: true,
      });
    }

    if (role.position >= executor.roles.highest.position && executor.id !== interaction.guild!.ownerId) {
      return interaction.reply({
        content: `❌ The role **${role.name}** is equal to or higher than your highest role.`,
        ephemeral: true,
      });
    }

    try {
      if (sub === 'assign') {
        await targetMember.roles.add(role, `Assigned by KitKat`);
        await interaction.reply({ content: `✅ Added role **${role.name}** to **${targetMember.user.tag}**.` });
      } else {
        await targetMember.roles.remove(role, `Removed by KitKat`);
        await interaction.reply({ content: `✅ Removed role **${role.name}** from **${targetMember.user.tag}**.` });
      }
    } catch (error) {
      console.error('[KitKat Role Error]:', error);
      await interaction.reply({ content: '❌ Failed to update server roles.', ephemeral: true });
    }
  },
};

export const HelpCommand = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Displays the categorized help directory for all commands and permissions.'),
  async execute(interaction: ChatInputCommandInteraction) {
    const embed = buildKitKatEmbed(
      '🛡️ KitKat Command Directory',
      'Public command list for server-side moderation and configuration.',
      0x00aaff
    )
      .addFields(
        {
          name: 'Moderation',
          value: [
            '`/mute user`, `/mute all`',
            '`/unmute user`, `/unmute all`',
            '`/deafen user`, `/deafen all`',
            '`/tempkick`, `/tempban`, `/ban`',
            '`/setnick request`, `/setnick config approval`',
          ].join('\n'),
        },
        {
          name: 'Voice & Guard',
          value: [
            '`/vclock`, `/vcunlock`, `/guard`, `/unguard`, `/whitelist`, `/transfer`',
          ].join('\n'),
        },
        {
          name: 'Temp VC',
          value: ['`/config tempvc category`', '`/tempvc create`, `/tempvc remove`'].join('\n'),
        },
        {
          name: 'Support & Requests',
          value: ['`/config ticket category`', '`/ticket support`, `/ticket create`, `/ticket close`'].join('\n'),
        },
        {
          name: 'Admin & Config',
          value: [
            '`/config logging set`, `/config setnick channel`, `/config setnick approval`',
            '`/config permission ref`, `/config permission revoke`',
            '`/config dm_alerts`, `/perm`, `/blocktext`, `/blocklink`, `/logging start|stop`',
          ].join('\n'),
        }
      );

    await interaction.reply({ embeds: [embed] });
  },
};
