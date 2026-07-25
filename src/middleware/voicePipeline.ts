import { VoiceState, Client } from 'discord.js';
import { Config } from '../config.js';
import { Pipeline } from './pipeline.js';
import { sendAuditLog } from './messagePipeline.js';

interface VoiceContext {
  oldState: VoiceState;
  newState: VoiceState;
  client: Client;
}

// ==========================================
// 1. TEMP VOICE KICK MIDDLEWARE
// ==========================================
const TempVoiceKickMiddleware = async (ctx: VoiceContext, next: () => Promise<void>) => {
  const { newState, client } = ctx;
  const member = newState.member;
  if (!member || member.user.bot) return next();

  // Enforce voice temp-kicks only when a user is joining or moving to a channel
  if (newState.channelId) {
    const expiration = client.voiceTempKicks.get(member.id);
    if (expiration) {
      const now = Date.now();
      if (now < expiration) {
        console.log(`[Temp Voice Kick]: Enforcing block for ${member.user.tag} (${member.id}). Expires in ${Math.round((expiration - now) / 1000)}s.`);
        
        try {
          // Disconnect them instantly
          await member.voice.disconnect('Temporary Voice Kick Active');
          
          // Send temporary alert message
          const textChannel = newState.channel as any;
          if (textChannel && 'send' in textChannel) {
            const warn = await textChannel.send(`⚠️ **Voice Block**: **${member.user.tag}** is temporarily voice-kicked and cannot join for another ${Math.ceil((expiration - now) / 1000)}s.`);
            setTimeout(() => warn.delete().catch(() => {}), 2000);
          }
        } catch (error) {
          console.error('[Temp Voice Kick Error]: Failed to disconnect temp-kicked user:', error);
        }
        return; // Break pipeline, user blocked
      } else {
        // Expired, clear record and allow them to proceed
        client.voiceTempKicks.delete(member.id);
        console.log(`[Temp Voice Kick]: Temporary voice block expired for ${member.user.tag}. cleared.`);
      }
    }
  }
  await next();
};

// ==========================================
// 2. VOICE GUARD & LOCK OVERWRITE MIDDLEWARE
// ==========================================
const VoiceGuardMiddleware = async (ctx: VoiceContext, next: () => Promise<void>) => {
  const { newState, client } = ctx;
  const member = newState.member;
  if (!member || member.user.bot) return next();

  const channelId = newState.channelId;
  
  // Verify user joined a channel
  if (channelId) {
    const isLocked = client.lockedChannels.has(channelId);
    const isGuarded = client.guardedChannels.has(channelId);

    // If channel is locked OR guarded, check permission barriers
    if (isLocked || isGuarded) {
      const userId = member.user.id;
      const username = member.user.username;

      const lockerId = client.lockedChannels.get(channelId);
      const guarderId = client.guardedChannels.get(channelId);
      const initiatorId = lockerId || guarderId;

      // Check if user is in ARCH (bypasses all barriers)
      const isArch = client.archUsers.has(userId);

      // Check if user is the initiator who ran /lock or /guard
      const isInitiator = userId === initiatorId;

      // Check if user is on the whitelist for this active voice session
      const whitelist = client.channelWhitelists.get(channelId);
      const isWhitelisted = whitelist ? whitelist.has(userId) : false;

      // Barrier evaluation
      if (!isArch && !isInitiator && !isWhitelisted) {
        console.log(`[VC Security]: Unauthorized connection attempt to locked/guarded channel by ${member.user.tag} (${userId}).`);
        
        try {
          // Disconnect member
          await member.voice.disconnect('Voice Channel is Locked/Guarded and user is not whitelisted');

          // Send temporary warning in Voice channel text chat
          const textChannel = newState.channel as any;
          if (textChannel && 'send' in textChannel) {
            const warningMsg = await textChannel.send({
              content: `⚠️ **VC Security**: Connection denied for **${member.user.tag}** (channel is locked/guarded and you are not whitelisted).`,
            });
            setTimeout(() => warningMsg.delete().catch(() => {}), 2000);
          }
        } catch (error) {
          console.error('[VC Security Error]: Failed to enforce barrier for member:', error);
        }
        return; // Break pipeline
      }
    }
  }
  await next();
};

// ==========================================
// INITIALIZE VOICE STATE PIPELINE
// ==========================================
const voicePipeline = new Pipeline<VoiceContext>();
voicePipeline
  .use(TempVoiceKickMiddleware)
  .use(VoiceGuardMiddleware);

/**
 * Entry point to process voice state transitions through the middleware pipelines.
 */
export async function runVoicePipeline(oldState: VoiceState, newState: VoiceState, client: Client): Promise<void> {
  const context: VoiceContext = {
    oldState,
    newState,
    client,
  };
  await voicePipeline.execute(context);
}
