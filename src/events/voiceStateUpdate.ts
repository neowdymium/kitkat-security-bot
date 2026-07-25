import { Events, VoiceState, TextBasedChannel } from 'discord.js';
import { Config } from '../config.js';

/**
 * Handles the voiceStateUpdate event.
 * Acts as the VC Guard and handles ARCH bypass logic.
 */
export default {
  name: Events.VoiceStateUpdate,
  once: false,
  async execute(oldState: VoiceState, newState: VoiceState) {
    const member = newState.member;
    if (!member || member.user.bot) return;

    // Check if the user joined a voice channel (i.e. newState.channelId is set and is different from oldState.channelId)
    if (newState.channelId && newState.channelId !== oldState.channelId) {
      const channel = newState.channel;
      if (!channel) return;

      const client = newState.client;
      const channelId = newState.channelId;

      // 1. VC Guard System Check
      // Check if this channel has been guarded by a moderator
      if (client.guardedChannels.has(channelId)) {
        const userId = member.user.id;
        const username = member.user.username;

        // Check if the member is blacklisted (by ID or username match)
        const isBlacklisted = Config.guardBlacklistIds.has(userId) || Config.guardBlacklistIds.has(username);
        // Check if the member is in the ARCH list (bypasses all guards)
        const isArch = client.archUsers.has(userId);

        if (isBlacklisted && !isArch) {
          console.log(`[VC Guard]: Blacklisted user ${member.user.tag} (${userId}) attempted to join guarded channel "${channel.name}".`);

          try {
            // Disconnect the user immediately by setting their voice channel to null
            await member.voice.disconnect('VC Guard - Blacklisted User Attempted Entry');
            console.log(`[VC Guard]: Disconnected ${member.user.tag} from "${channel.name}".`);

            // Send a temporary notification to the voice channel's text chat
            // In discord.js v14, voice channels implement TextBasedChannel, allowing text messages inside the VC
            const textChannel = channel as any;
            const notification = await textChannel.send({
              content: `⚠️ **Security Alert**: **${member.user.tag}** (Blacklisted) tried to join this guarded channel and was disconnected.`,
            });

            // Automatically delete the notification after 2 seconds (2000 milliseconds)
            setTimeout(async () => {
              try {
                await notification.delete();
              } catch (deleteError) {
                console.error('[VC Guard Error]: Failed to delete temporary warning message:', deleteError);
              }
            }, 2000);
          } catch (error) {
            console.error(`[VC Guard Error]: Failed to execute disconnect or notification for ${member.user.tag}:`, error);
          }
        } else if (isArch) {
          console.log(`[VC Guard]: ARCH user ${member.user.tag} joined guarded channel "${channel.name}". Guard bypassed.`);
        }
      }
    }
  },
};
