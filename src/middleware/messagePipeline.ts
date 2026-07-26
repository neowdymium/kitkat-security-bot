import { Message, GuildMember, EmbedBuilder, Client } from 'discord.js';
import { Database } from '../database.js';
import { Config } from '../config.js';
import { Pipeline } from './pipeline.js';
import { isGuildDmAlertsEnabled, sendKitKatLog } from '../lib/kitkatState.js';

// Unified helper to send audit logs to the configured log channel
export async function sendAuditLog(client: Client, guildId: string, payload: { embeds: EmbedBuilder[] } | string): Promise<void> {
  try {
    await sendKitKatLog(client, guildId, payload);
  } catch (error) {
    console.error('[KitKat Audit Log Error]: Failed to dispatch audit log message:', error);
  }
}

// Interfaces and caches for the pipelines
interface MessageContext {
  message: Message;
  client: Client;
  isDeleted: boolean;
}

// Cache for Anti-Raid (duplicate detection across server)
// Holds message details from the last 5 seconds
let globalMessageCache: {
  content: string;
  authorId: string;
  timestamp: number;
  message: Message;
}[] = [];

// Cache for single-user Anti-Spam
const userMessageCache = new Map<string, number[]>();

// ==========================================
// 1. SPAM EXEMPTION MIDDLEWARE
// ==========================================
const SpamExemptionMiddleware = async (ctx: MessageContext, next: () => Promise<void>) => {
  const { message } = ctx;
  const authorId = message.author.id;

  // Check if the author is added to the spam exemption list
  if (Database.isSpamExempt(authorId)) {
    console.log(`[Pipeline]: Bypassed Spam/Raid check for exempt user/bot: ${message.author.tag}`);
    // Skip to next check (WordFilter) directly, bypassing Spam & Raid filters
    return WordFilterMiddleware(ctx, next);
  }
  await next();
};

// ==========================================
// 2. ANTI-SPAM MIDDLEWARE (Single User)
// ==========================================
const AntiSpamMiddleware = async (ctx: MessageContext, next: () => Promise<void>) => {
  const { message } = ctx;
  const { author, member, channel } = message;
  const now = Date.now();

  const userTimestamps = userMessageCache.get(author.id) || [];
  // Keep only timestamps within the rolling window (e.g. 3 seconds)
  const activeTimestamps = userTimestamps.filter(t => now - t < Config.spamIntervalMs);
  activeTimestamps.push(now);
  userMessageCache.set(author.id, activeTimestamps);

  if (activeTimestamps.length > Config.spamLimit) {
    userMessageCache.delete(author.id); // Reset
    ctx.isDeleted = true;

    try {
      if (member && member.moderatable) {
        // Apply 5 minutes timeout
        await member.timeout(Config.spamTimeoutDurationMs, 'Automated Anti-Spam System');
        
        // Delete original message
        if (message.deletable) await message.delete().catch(() => {});

        // Purge recent messages
        if ('bulkDelete' in channel) {
          const fetched = await channel.messages.fetch({ limit: 50 });
          const toDelete = fetched.filter(m => m.author.id === author.id && now - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000);
          if (toDelete.size > 0) {
            await (channel as any).bulkDelete(toDelete).catch(() => {});
          }
        }

        const alertEmbed = new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle('🛡️ Security Action: Member Muted (Spam)')
          .setDescription(`User **${author.tag}** was timed out for 5 minutes due to message spamming.`)
          .addFields(
            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
            { name: 'User ID', value: author.id, inline: true }
          )
          .setTimestamp();

        await sendAuditLog(ctx.client, message.guild!.id, { embeds: [alertEmbed] });

        const warningMsg = await (channel as any).send(`🚨 **Anti-Spam**: **${author.tag}** has been timed out for 5 minutes. Purging messages...`);
        setTimeout(() => warningMsg.delete().catch(() => {}), 5000);
      }
    } catch (err) {
      console.error('[Anti-Spam Middleware Error]:', err);
    }
    return; // Break pipeline, message handled
  }
  await next();
};

// ==========================================
// 3. ANTI-RAID MIDDLEWARE (Duplicates)
// ==========================================
const AntiRaidMiddleware = async (ctx: MessageContext, next: () => Promise<void>) => {
  const { message } = ctx;
  const now = Date.now();
  const contentKey = message.content.trim().toLowerCase();

  // Ignore empty messages (e.g. only embeds or files)
  if (!contentKey) {
    return next();
  }

  // Push new message metadata to global cache
  globalMessageCache.push({
    content: contentKey,
    authorId: message.author.id,
    timestamp: now,
    message: message,
  });

  // Prune entries older than 5 seconds
  globalMessageCache = globalMessageCache.filter(m => now - m.timestamp < 5000);

  // Find duplicates of the current message content
  const duplicates = globalMessageCache.filter(m => m.content === contentKey);

  if (duplicates.length >= 3) {
    ctx.isDeleted = true;
    
    // Evict duplicate keys from cache to prevent multiple fires
    globalMessageCache = globalMessageCache.filter(m => m.content !== contentKey);

    const offendingUserIds = Array.from(new Set(duplicates.map(d => d.authorId)));
    console.log(`[Anti-Raid]: Raid detected! Duplicate content: "${contentKey}". Offending users: ${offendingUserIds.join(', ')}`);

    try {
      // 1. Delete all duplicate messages
      for (const item of duplicates) {
        if (item.message.deletable) {
          await item.message.delete().catch(() => {});
        }
      }

      // 2. Apply timeout sanctions to all involved users (unless exempt)
      for (const userId of offendingUserIds) {
        if (Database.isSpamExempt(userId)) continue;

        const guildMember = await message.guild!.members.fetch(userId).catch(() => null);
        if (guildMember && guildMember.moderatable) {
          await guildMember.timeout(Config.spamTimeoutDurationMs, 'Automated Anti-Raid: Duplicate Message Spam');
        }
      }

      // 3. Dispatch logging embeds
      const logEmbed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🚨 Raid Blocked: Duplicate Messages Detected')
        .setDescription(`Raid activity detected in <#${message.channel.id}>. Deleted duplicate messages.`)
        .addFields(
          { name: 'Sanctioned Spammers', value: offendingUserIds.map(id => `<@${id}>`).join(', '), inline: false },
          { name: 'Offensive Content', value: `\`\`\`\n${message.content.slice(0, 100)}\n\`\`\``, inline: false }
        )
        .setTimestamp();

      await sendAuditLog(ctx.client, message.guild!.id, { embeds: [logEmbed] });

      const notice = await (message.channel as any).send('🚨 **Anti-Raid Triggered**: Duplicate messages detected. Deleting duplicates and silencing spammers.');
      setTimeout(() => notice.delete().catch(() => {}), 5000);
    } catch (error) {
      console.error('[Anti-Raid Error]:', error);
    }
    return; // Break pipeline
  }
  await next();
};

// ==========================================
// 4. WORD FILTER / LINK FILTER MIDDLEWARE
// ==========================================
const WordFilterMiddleware = async (ctx: MessageContext, next: () => Promise<void>) => {
  const { message } = ctx;
  const { content, author, channel } = message;
  const cleanContent = content.toLowerCase();

  const blockedTexts = Database.getBlockedTexts();
  const blockedLinks = Database.getBlockedLinks();

  let flaggedPhrase: string | null = null;
  let isLink = false;

  // 1. Inspect dynamic blocked texts
  for (const text of blockedTexts) {
    if (cleanContent.includes(text)) {
      flaggedPhrase = text;
      break;
    }
  }

  // 2. Inspect dynamic blocked links (domain detection)
  if (!flaggedPhrase) {
    for (const domain of blockedLinks) {
      if (cleanContent.includes(domain)) {
        flaggedPhrase = domain;
        isLink = true;
        break;
      }
    }
  }

  if (flaggedPhrase) {
    ctx.isDeleted = true;

    try {
      // Delete the message
      if (message.deletable) {
        await message.delete();
      }

      // Send warning DM if alerts are enabled
      if (isGuildDmAlertsEnabled(ctx.client, message.guild!.id)) {
        await author.send({
          content: `⚠️ **KitKat Notice**: Your message in **${message.guild!.name}** was deleted because it contained a blocked ${isLink ? 'link/domain' : 'phrase'}: **"${flaggedPhrase}"**.`,
        }).catch(() => {});
      }

      // Log the violation
      const logEmbed = new EmbedBuilder()
        .setColor(0xffaa00)
        .setTitle(`🛡️ Auto-Mod: Content Filter Triggered`)
        .setDescription(`Deleted message from **${author.tag}** in <#${channel.id}>.`)
        .addFields(
          { name: 'Reason', value: `Contained blocked ${isLink ? 'domain' : 'phrase'}`, inline: true },
          { name: 'Flagged Key', value: `\`${flaggedPhrase}\``, inline: true },
          { name: 'Full Message', value: `\`\`\`\n${content.slice(0, 500)}\n\`\`\`` }
        )
        .setTimestamp();

      await sendAuditLog(ctx.client, message.guild!.id, { embeds: [logEmbed] });

      const notice = await (channel as any).send(`🛡️ **KitKat Auto-Mod**: Deleted message from **${author.tag}** containing blocked content.`);
      setTimeout(() => notice.delete().catch(() => {}), 5000);
    } catch (error) {
      console.error('[Word Filter Middleware Error]:', error);
    }
    return;
  }
  await next();
};

// ==========================================
// INITIALIZE MESSAGE PIPELINE
// ==========================================
const messagePipeline = new Pipeline<MessageContext>();
messagePipeline
  .use(SpamExemptionMiddleware)
  .use(AntiSpamMiddleware)
  .use(AntiRaidMiddleware)
  .use(WordFilterMiddleware);

/**
 * Entry point to process incoming messages through the middleware pipelines.
 */
export async function runMessagePipeline(message: Message, client: Client): Promise<void> {
  const context: MessageContext = {
    message,
    client,
    isDeleted: false,
  };
  await messagePipeline.execute(context);
}
