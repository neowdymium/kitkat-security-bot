import { Client, VoiceState } from 'discord.js';

/**
 * Legacy voice pipeline entry point.
 * The main voice moderation logic now lives in the dedicated voiceStateUpdate event,
 * but this function remains as a compatibility wrapper for older imports.
 */
export async function runVoicePipeline(_oldState: VoiceState, _newState: VoiceState, _client: Client): Promise<void> {
  return;
}
