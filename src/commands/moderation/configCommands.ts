import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  GuildMember,
  EmbedBuilder,
  Role,
  User,
  ChannelType,
} from 'discord.js';
import {
  buildKitKatEmbed,
  deleteGuildPermissionGrant,
  getGuildState,
  memberHasGuildScope,
  setGuildDmAlerts,
  setGuildLoggingChannel,
  setGuildPermissionGrant,
} from '../../lib/kitkatState.js';

// ==========================================
// 1. /config command (System Settings)
// ==========================================
export const ConfigCommand = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure server security system and logs.')
    .addSubcommand((sub) =>
      sub
        .setName('logging')
        .setDescription('Set the server text channel for violation audits and alerts.')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Select audit log destination channel')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('dm_alerts')
        .setDescription('Toggle direct message alerts for rule-breakers.')
        .addBooleanOption((opt) =>
          opt
            .setName('enabled')
            .setDescription('Should bot DM warning messages?')
            .setRequired(true)
        )
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    // Check executor Discord Administrator permissions
    const member = interaction.member as GuildMember;
    if (!member.permissions.has(PermissionFlagsBits.Administrator) && !memberHasGuildScope(member, 'config')) {
      return interaction.reply({
        content: '❌ **Access Denied**: You require Discord Administrator privileges or a KitKat config scope to modify settings.',
        ephemeral: true,
      });
    }

    if (sub === 'logging') {
      const channel = interaction.options.getChannel('channel', true);

      // Verify channel is text-based
      if (!('isTextBased' in channel) || !channel.isTextBased()) {
        return interaction.reply({
          content: '❌ **Configuration Error**: Logging channel must be text-based (text channel or text-in-voice channel).',
          ephemeral: true,
        });
      }

      setGuildLoggingChannel(interaction.client, interaction.guildId!, channel.id);

      await interaction.reply({
        content: `✅ **Configuration Updated**: KitKat security violation logs will be dispatched to <#${channel.id}>.`,
      });
    } else if (sub === 'dm_alerts') {
      const enabled = interaction.options.getBoolean('enabled', true);
      setGuildDmAlerts(interaction.client, interaction.guildId!, enabled);

      await interaction.reply({
        content: `✅ **Configuration Updated**: Direct Message warnings are now **${enabled ? 'ENABLED' : 'DISABLED'}**.`,
      });
    }
  }
};

// ==========================================
// 2. /perm command (Internal Permission Engine)
// ==========================================
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
          opt
            .setName('scope')
            .setDescription('Permission scopes (comma-separated list of commands or "all")')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Revoke all KitKat command permissions from a user or role.')
        .addMentionableOption((opt) => opt.setName('target').setDescription('User or role').setRequired(true))
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    const executor = interaction.member as GuildMember;

    // Only actual Server Administrators can manage internal bot permissions
    if (!executor.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: '❌ **Access Denied**: Only server administrators can edit KitKat internal scopes.',
        ephemeral: true,
      });
    }

    const target = interaction.options.getMentionable('target', true) as Role | User;

    if (sub === 'add') {
      const scopeInput = interaction.options.getString('scope', true);

      // Parse scopes (trim, convert to lowercase)
      const scopes = scopeInput.split(',').map((s) => s.trim().toLowerCase());
      const kind = target instanceof Role ? 'role' : 'user';
      const targetId = target.id;
      setGuildPermissionGrant(interaction.client, interaction.guildId!, targetId, kind, scopes);
      const targetLabel = target instanceof Role ? target.name : target.tag;

      await interaction.reply({
        content: `✅ **Permissions Granted**: Granted scopes (\`${scopes.join(', ')}\`) to **${targetLabel}**.`,
      });
    } else if (sub === 'remove') {
      const removed = deleteGuildPermissionGrant(interaction.client, interaction.guildId!, target.id);
      const targetLabel = target instanceof Role ? target.name : target.tag;

      if (removed) {
        await interaction.reply({
          content: `✅ **Permissions Revoked**: Cleared all KitKat permissions from **${targetLabel}**.`,
        });
      } else {
        await interaction.reply({
          content: `ℹ️ **Status Check**: **${targetLabel}** has no registered KitKat permissions.`,
          ephemeral: true,
        });
      }
    }
  }
};

// ==========================================
// 3. /role command (Dynamic Role Assignment)
// ==========================================
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

    // Permissions check
    if (!executor.permissions.has(PermissionFlagsBits.ManageRoles) && !memberHasGuildScope(executor, 'role')) {
      return interaction.reply({
        content: '❌ **Access Denied**: You require the Discord "Manage Roles" permission or a KitKat role scope.',
        ephemeral: true,
      });
    }

    if (!bot || !bot.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({
        content: '❌ **Bot Permission Error**: I do not have permission to manage server roles. Please grant me the "Manage Roles" permission.',
        ephemeral: true,
      });
    }

    const targetMember = interaction.options.getMember('target') as GuildMember | null;
    const role = interaction.options.getRole('role') as Role | null;

    if (!targetMember || !role) {
      return interaction.reply({ content: '❌ Target member or role not found.', ephemeral: true });
    }

    // Role Hierarchy Validation:
    // 1. Prevent bot from modifying roles higher or equal to its own highest role
    if (role.position >= bot.roles.highest.position) {
      return interaction.reply({
        content: `❌ **Hierarchy Error**: The role **${role.name}** is higher than or equal to my highest role. I cannot manage it.`,
        ephemeral: true,
      });
    }

    // 2. Prevent executor from assigning/removing roles higher or equal to their own highest role
    if (role.position >= executor.roles.highest.position && executor.id !== interaction.guild!.ownerId) {
      return interaction.reply({
        content: `❌ **Hierarchy Error**: The role **${role.name}** is equal to or higher than your highest role. Action denied.`,
        ephemeral: true,
      });
    }

    try {
      if (sub === 'assign') {
        if (targetMember.roles.cache.has(role.id)) {
          return interaction.reply({
            content: `ℹ️ **Status Check**: **${targetMember.user.tag}** already has the role **${role.name}**.`,
            ephemeral: true,
          });
        }

        await targetMember.roles.add(role, `Assigned by ${interaction.user.tag}`);
        await interaction.reply({
          content: `✅ **Role Assigned**: Added role **${role.name}** to **${targetMember.user.tag}**.`,
        });
      } else if (sub === 'remove') {
        if (!targetMember.roles.cache.has(role.id)) {
          return interaction.reply({
            content: `ℹ️ **Status Check**: **${targetMember.user.tag}** does not have the role **${role.name}**.`,
            ephemeral: true,
          });
        }

        await targetMember.roles.remove(role, `Removed by ${interaction.user.tag}`);
        await interaction.reply({
          content: `✅ **Role Removed**: Revoked role **${role.name}** from **${targetMember.user.tag}**.`,
        });
      }
    } catch (err) {
      console.error('[Role Manager Error]:', err);
      await interaction.reply({ content: '❌ Failed to update server roles for target member.', ephemeral: true });
    }
  }
};

// ==========================================
// 4. /help command (Interactive Help Panel)
// ==========================================
export const HelpCommand = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Displays the categorized help directory for all commands and permissions.'),
  async execute(interaction: ChatInputCommandInteraction) {
    const embed = buildKitKatEmbed(
      '🛡️ KitKat Security & Moderation Directory',
      'Listing all slash commands, descriptions, and required permissions. Restricted commands are reserved for approved members, authorized roles, or users granted KitKat scopes.',
      0x00aaff
    )
      .addFields(
        {
          name: '🔨 Server Moderation & Sanctions',
          value: [
            '`/tempkick @user [duration]` - Voice-temp-kicks user (disconnects and blocks re-entry).',
            '`/mute @user [duration] [reason]` - Times out a member (Discord native).',
            '`/unmute @user` - Removes timeout (ownership rules apply).',
            '`/deafen @user [reason]` - Server deafens a voice member.',
            '`/undeafen @user` - Server undeafens a voice member.',
            '`/setnick @user [nickname]` - Changes target member nickname.',
            '`/role <assign|remove> @user <role>` - Manages member server roles.'
          ].join('\n'),
        },
        {
          name: '🔊 Voice Session Controls',
          value: [
            '`/vclock` - Denies Connect permissions to `@everyone` on current VC.',
            '`/vcunlock` - Restores Connect permissions to current VC.',
            '`/guard` - Activates VC Guard (automatically kicks blacklisted users).',
            '`/unguard` - Deactivates VC Guard.',
            '`/whitelist <add|remove> @user` - Manages join permissions for locked/guarded VC.',
            '`/transfer @user <#channel>` - Direct transfers member to target VC.'
          ].join('\n'),
        },
        {
          name: '🛡️ Automod & Anti-Spam',
          value: [
            '`/blocktext <add|remove> <phrase>` - Add/remove dynamic automod blocked phrases.',
            '`/blocklink <add|remove> <domain>` - Add/remove dynamic automod blocked domains.',
            '`/spam <allow|revoke> @user_or_bot` - Add/remove members to anti-spam/anti-raid filters bypass.'
          ].join('\n'),
        },
        {
          name: '⚙️ Administration & Utility',
          value: [
            '`/config logging <#channel>` - Set KitKat audit logging channel.',
            '`/config dm_alerts <true|false>` - Toggle KitKat DM alerts.',
            '`/perm <add|remove> @user|@role [scope]` - Manage KitKat-specific scopes.',
            '`/tell <#channel> <message>` - Send a KitKat broadcast message.',
            '`/arch <code>` - Authenticate into the ARCH system.'
          ].join('\n'),
        }
      )
      ;

    await interaction.reply({ embeds: [embed] });
  }
};
