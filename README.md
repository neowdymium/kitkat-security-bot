# 🍫 KitKat — Advanced Multi-Guild Discord Moderation & Privacy Security Bot

A modular, highly secure, production-ready Discord moderation and voice security bot built with **TypeScript**, **Node.js**, and **discord.js v14**.

KitKat is designed for high-control multi-server management, featuring dynamic automod filters, a multi-tiered `ARCH` authorization engine, server-wide voice channel guards, interactive ticket transcripts, delegated inbox exports, and specialized anti-raid protections.

---

## ✨ Comprehensive Features Overview

### 🎙️ 1. Complete Voice Security & Channel Control

- **Universal Voice Guard (`/guard` & `/unguard`):** Active enforcement across **all voice channels**. Immediately disconnects unauthorized users attempting to join—even standard Server Admins or Moderators—unless explicitly whitelisted or holding `ARCH` status. Toggles the channel's voice status dynamically to `🛡️ This Channel is Guarded by KitKat` and clears it upon disabling.
- **Voice Locks (`/vclock` & `/vcunlock`):** Locks the channel for `@everyone`. Toggles the channel's voice status to `🔒 This Channel is Locked by KitKat`. Specific roles assigned via `/bypass vclock target:@role` or `/perm` can bypass lock barriers.
- **Voice Session Whitelisting (`/whitelist` / `/unwhitelist`):** Allows the command initiator to grant specific users access to join their locked or guarded voice channel.
- **Bulk Audio Controls:**
  - `/mute all` & `/unmute all`: Mutes/unmutes every member in the caller's current voice channel and dynamically toggles the `@everyone` speak permissions.
  - `/deafen all` & `/undeafen all`: Server-deafens or undeafens all members in the caller's current voice channel.
- **Direct Voice Transfer (`/transfer target:@user channel:#target-vc`):** Instantly moves a user from their current voice channel to another.

### 🏠 2. Dynamic Temporary Voice Channels (`/tempvc`)

- **Category Configuration:** Set the target category via `/config tempvc category:#category`.
- **User Creation:** `/tempvc create` spawns `<Username>'s Temporary VC` (fully isolated, up to 9 per user).
- **VC Renaming (`/tempvc rename vc_name:<string>`):** Allows the channel's creator to instantly update the VC name, provided they are currently connected inside it.
- **Manual & Instant Empty Cleanup:** Initiators can delete their channel manually with `/tempvc remove`. When the last member leaves a temporary voice channel (count hits 0), KitKat instantly deletes the channel and cleans up memory references to prevent server clutter.

### 👑 3. Hierarchical `ARCH` System & Supremacy Rules (`/arch`)

- **Alpha Archon Supremacy:** The first person in a server to execute `/arch add target:@themselves code:<ARCH_CODE>` becomes the **Alpha Archon**.
- **Absolute Bypass:** `ARCH` members bypass all locks, guards, automod filters, kicks, and bans. They cannot be targeted by any sanction.
- **Removal Safeguard:** Standard `ARCH` members can promote others, but **ONLY the Alpha Archon** can remove or demote existing `ARCH` members.

### 🏷️ 4. Interactive Nickname Request System (`/setnick`)

- **Regular Member Requests:** Running `/setnick new_nick:<string>` triggers a request pipeline instead of changing the name directly.
- **Interactive Approval:** KitKat sends an embed with an **[Approve Request]** button to the designated channel (`/config setnick channel:#channel`).
- **Reviewer Authorization:** `ARCH` members configure who can approve requests using `/setnick config approval target:<@role|@user>`.
- **Automated Rename & Hierarchy Guard:** Clicking approval applies the nickname and disables the button. If hierarchy permissions are missing, the button is disabled and warns the reviewer with a red status embed.

### 💤 5. AFK Voice Lobby Management (`/afk`)

- **AFK Target Channel:** Configure the server's AFK voice channel via `/config afk lobby vc:#voice_channel`.
- **Relocation Command:** `/afk target:@user` instantly moves a user into the configured AFK channel. Gated by `/perm` or `ARCH` privileges. Gracefully handles users not connected to voice.

### 📁 6. User Reporting System (`/report`)

- **Report Command:** `/report target:@user reason:<string>` allows any server member to flag inappropriate behavior.
- **Logs Integration:** Immediately formats and dispatches a detailed moderation report embed to the configured server logging channel (`/config logging set`). Replies to the reporter ephemerally to confirm receipt.

### 🎟️ 7. Support Ticket System (`/ticket`)

- **Ticket Channels:** `/ticket create reason:<string>` spawns a private channel under the category set via `/config ticket category:#category`.
- **Support Staff Assignment:** `ARCH` members assign support personnel via `/ticket support target:<@user|@role>`.
- **Automated Transcripts on Close:** Running `/ticket close` compiles the entire ticket transcript into a `.txt` or `.md` file and sends it directly to the creator's inbox before deleting the channel (zero memory overhead stored).

### 📝 8. On-Demand Chat Logging (`/logging`)

- **Controlled Logging:** `/logging start` begins recording chat in the current channel.
- **Export & Stop:** `/logging stop` compiles the recorded messages and posts the transcript directly to the designated logging channel (`/config logging set channel:#channel`).
- **Media Link Optimization:** Media attachments are stored as direct URLs (`attachment.url`) within transcripts to keep file sizes under a few kilobytes.

### 🔨 9. Robust Moderation & Banning Suite

- **Voice Temp-Kick (`/tempkick target:@user duration:<180s/10m>`):** Disconnects a member from voice and actively monitors `voiceStateUpdate` to kick them if they attempt to rejoin before the timer expires.
- **Server Banning (`/ban` & `/tempban`):** Executes native Discord server bans with support for automated unban callbacks on duration expiry.
- **Unified Violation Alerts:** Dispatches logs to both the server log channel (`/config logging channel:#channel`) and the rule breaker's Direct Messages (if enabled via `/config dm_alerts`).

### 🔒 10. Granular Permission Engine (`/perm`)

- Operates independently of standard Discord server roles.
- Supports both users and roles: `/perm add target:<@user|@role> scope:<all | command_list>`.
- Allows server owners to delegate specific bot commands without giving out full Discord Administrator rights.

### 🚫 11. Dynamic Automod & Anti-Raid Engine

- **Content Filtering:** Dynamic `/blocktext` and `/blocklink` management without bot restarts.
- **Anti-Raid / Anti-Nuke:** Monitors repetitive cross-user message spam within a 5-second sliding window, instantly deleting raid messages and applying temporary timeouts.
- **Spam Whitelist (`/spam allow target:<@user|@bot>`):** Exempts trusted bots or webhooks from anti-spam rate limits.

### 👑 12. Developer Suite & Silent Presence (`/dev`, `/join`, `/leave`, `/export`, `/import`)

- **Developer Management (`/dev`):** Owner-only command (`DEV_ID`) to list active operating guilds, system memory metrics, or force-leave unapproved servers (`/dev leave guild_id:<ID>`).
- **Silent Voice Presence (`/join [channel:#vc]` & `/leave`):** Connects the bot to the specified voice channel (or the developer's channel) in silent mode (`selfMute: true`, `selfDeaf: true`). Restructured to use `@discordjs/voice`. Disconnect with `/leave`.
- **Automated Backup Dispatcher:** Automatically dispatches lightweight JSON configuration files to the Developer's inbox whenever server settings are altered.
- **Delegated Export/Import (`/config permission ref @user guildID:<ID>`):** The Developer can grant specific users permission to export or import configs **exclusively for their assigned `guildID`**.
- **Hidden Inbox Commands (`/export`, `/import`):**
  - Executed inside KitKat's Direct Message inbox without command hints or auto-complete listings to maintain zero public visibility.

---

## 📋 Command Quick Reference

> 💡 *Note: Direct Message Inbox commands (`/export`, `/import`) are hidden from command hints and the `/help` display.*

| Command | Category | Description | Required Access |
| :--- | :--- | :--- | :--- |
| `/help` | General | Opens the interactive, categorized command menu | Everyone |
| `/guard` | Voice | Enforces strict privacy on any VC with 2s auto-alerts and custom voice statuses | `/perm` or `ARCH` |
| `/vclock` / `/vcunlock` | Voice | Locks/Unlocks voice channel for `@everyone` and sets voice statuses | `/perm` or `ARCH` |
| `/whitelist` | Voice | Adds a user to the active VC lock/guard session | Command Initiator |
| `/mute all` / `/unmute all` | Voice | Mutes or unmutes all users in current VC | `/perm` or `ARCH` |
| `/deafen all` / `/undeafen all` | Voice | Deafens or undeafens all users in current VC | `/perm` or `ARCH` |
| `/afk` | Voice | Moves a target member to the configured AFK voice lobby | `/perm` or `ARCH` |
| `/join` / `/leave` | Voice | Dev-only: Silent voice connection/disconnection | Developer Only |
| `/tempvc create` / `remove` | Temp VC | Spawns or deletes a temporary voice channel | Everyone / `/perm` |
| `/tempvc rename` | Temp VC | Renames the active temporary voice channel | Channel Creator |
| `/setnick` | Requests | Submits a nickname change request for approval | Everyone |
| `/report` | Moderation | File a report against a member to the staff logging channel | Everyone |
| `/ticket create` / `close` | Support | Opens a support ticket or closes and exports transcript | Everyone / Staff |
| `/tempkick` | Moderation | Voice-disconnects and blocks re-entry for a set duration | `/perm` or `ARCH` |
| `/ban` / `/tempban` | Moderation | Bans a user natively (permanently or temporarily) | `/perm` or `ARCH` |
| `/perm` | Admin | Assigns custom bot command permissions to users/roles | `ARCH` |
| `/arch` | Admin | Manages `ARCH` roles with Alpha Archon protection | `ARCH` / Secret Code |
| `/config` | Admin | Configures channels, tempvc, alerts, afk, and logging | `ARCH` |
| `/logging start` / `stop` | Logging | Starts or stops chat recording and exports transcript | `/perm` or `ARCH` |
| `/dev` | Developer | System diagnostics, guild listing, and remote leave | Developer Only |
