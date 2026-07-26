import { Events, VoiceState, VoiceChannel } from 'discord.js';
import {
  getGuildState,
  isGuildArch,
  memberCanBypassVclock,
  scheduleTempVcCleanup,
  cancelTempVcCleanup,
  getTempVcRecord,
} from '../lib/kitkatState.js';

async function sendTemporaryChannelNotice(channel: VoiceChannel | null, content: string): Promise<void> {
  if (!channel || typeof (channel as any).send !== 'function') {
    return;
  }

  try {
    const message = await (channel as any).send({ content });
    setTimeout(() => {
      void message.delete().catch(() => {});
    }, 2000);
  } catch {
    // Voice channel chat is optional, so notification failures should never break moderation.
  }
}

export default {
  name: Events.VoiceStateUpdate,
  once: false,
  async execute(oldState: VoiceState, newState: VoiceState) {
    const member = newState.member;
    if (!member || member.user.bot || !member.guild) {
      return;
    }

    const guildId = member.guild.id;
    const state = getGuildState(member.client, guildId);
    const joinedChannel = newState.channel as VoiceChannel | null;
    const leftChannel = oldState.channel as VoiceChannel | null;
    const now = Date.now();

    if (joinedChannel && joinedChannel.id !== oldState.channelId) {
      const tempKick = state.tempKicks.get(member.id);
      if (tempKick) {
        if (tempKick.expiresAt > now && !isGuildArch(member.client, guildId, member.id)) {
          await member.voice.disconnect('KitKat temporary voice kick').catch(() => {});
          await sendTemporaryChannelNotice(
            joinedChannel,
            `⚠️ **KitKat**: **${member.user.tag}** is temporarily blocked from voice and was disconnected.`
          );
          return;
        }

        if (tempKick.expiresAt <= now) {
          state.tempKicks.delete(member.id);
        }
      }

      const tempVcRecord = getTempVcRecord(member.client, guildId, joinedChannel.id);
      const whitelist = state.whitelists.get(joinedChannel.id);
      const isWhitelisted = whitelist?.has(member.id) ?? false;
      const isOwner = tempVcRecord?.ownerId === member.id || state.lockedChannels.get(joinedChannel.id) === member.id;
      const isArch = isGuildArch(member.client, guildId, member.id);
      const isVclockBypass = memberCanBypassVclock(member);

      if (state.lockedChannels.has(joinedChannel.id) && !isOwner && !isArch && !isWhitelisted && !isVclockBypass) {
        await member.voice.disconnect('KitKat voice lock enforcement').catch(() => {});
        await sendTemporaryChannelNotice(
          joinedChannel,
          `🔒 **KitKat**: **${member.user.tag}** was removed because this voice channel is locked.`
        );
        return;
      }

      if (state.guardedChannels.has(joinedChannel.id) && !isOwner && !isArch && !isWhitelisted) {
        await member.voice.disconnect('KitKat guard enforcement').catch(() => {});
        await sendTemporaryChannelNotice(
          joinedChannel,
          `🛡️ **KitKat**: **${member.user.tag}** was removed because guard mode is active in this temp VC.`
        );
        return;
      }

      cancelTempVcCleanup(member.client, guildId, joinedChannel.id);
    }

    if (leftChannel && leftChannel.id !== joinedChannel?.id) {
      const tempVcRecord = getTempVcRecord(member.client, guildId, leftChannel.id);
      if (tempVcRecord && leftChannel.members.size === 0) {
        scheduleTempVcCleanup(member.client, guildId, leftChannel);
      }
    }
  },
};
