# 🍫 KitKat — Advanced Multi-Guild Discord Moderation & Privacy Security Bot

A modular, highly secure, production-ready Discord moderation and voice security bot built with **TypeScript**, **Node.js**, and **discord.js v14**.

KitKat is designed for high-control multi-server management, featuring dynamic automod filters, a multi-tiered `ARCH` authorization engine, server-wide voice channel guards, interactive ticket transcripts, delegated inbox exports, and specialized anti-raid protections.

---

## ✨ Comprehensive Features Overview

### 🎙️ 1. Complete Voice Security & Channel Control

- **Universal Voice Guard (`/guard` & `/unguard`):** Active enforcement across **all voice channels**. Immediately disconnects unauthorized users attempting to join—even standard Server Admins or Moderators—unless explicitly whitelisted or holding `ARCH` status. Auto-deletes 2-second alert notifications in text chat.
- **Voice Locks (`/vclock` & `/vcunlock`):** Locks the channel for `@everyone`. Specific roles assigned via `/bypass vclock target:@role` or `/perm` can bypass lock barriers.
- **Voice Session Whitelisting (`/whitelist` / `/unwhitelist`):** Allows the command initiator to grant specific users access to join their locked or guarded voice channel.
- **Bulk Audio Controls:**
  - `/mute all` & `/unmute all`: Mutes/unmutes every member in the caller's current voice channel and dynamically toggles the `@everyone` speak permissions.
  - `/deafen all` & `/undeafen all`: Server-deafens or undeafens all members in the caller's current voice channel.
- **Direct Voice Transfer (`/transfer target:@user channel:#target-vc`):** Instantly moves a user from their current voice channel to another.

### 🏠 2. Dynamic Temporary Voice Channels (`/tempvc`)

- **Category Configuration:** Set the target category via `/config tempvc category:#category`.
- **User Creation:** `/tempvc create` spawns `<Username>'s Temporary VC <1-9>` (up to 9 per user).
- **Manual & Automated Cleanup:** Initiators can delete their channel with `/tempvc remove` (or users with `/perm add target:<user/role> scope:tempvc`).
- **5-Minute Inactivity Sweeper:** Automatically deletes empty temporary voice channels after 5 minutes of total inactivity to prevent server clutter.

### 👑 3. Hierarchical `ARCH` System & Supremacy Rules (`/arch`)

- **Alpha Archon Supremacy:** The first person in a server to execute `/arch add target:@themselves code:<ARCH_CODE>` becomes the **Alpha Archon**.
- **Absolute Bypass:** `ARCH` members bypass all locks, guards, automod filters, kicks, and bans. They cannot be targeted by any sanction.
- **Removal Safeguard:** Standard `ARCH` members can promote others, but **ONLY the Alpha Archon** can remove or demote existing `ARCH` members.

### 🏷️ 4. Interactive Nickname Request System (`/setnick`)

- **Regular Member Requests:** Running `/setnick new_nick:<string>` triggers a request pipeline instead of changing the name directly.
- **Interactive Approval:** KitKat sends an embed with an **[Approve Request]** button to the designated channel (`/config setnick channel:#channel`).
- **Reviewer Authorization:** `ARCH` members configure who can approve requests using `/setnick config approval target:<@role|@user>`.

### 🎟️ 5. Support Ticket System (`/ticket`)

- **Ticket Channels:** `/ticket create reason:<string>` spawns a private channel under the category set via `/config ticket category:#category`.
- **Support Staff Assignment:** `ARCH` members assign support personnel via `/ticket support target:<@user|@role>`.
- **Automated Transcripts on Close:** Running `/ticket close` compiles the entire ticket transcript into a `.txt` or `.md` file and sends it directly to the creator's inbox before deleting the channel (zero memory overhead stored).

### 📝 6. On-Demand Chat Logging (`/logging`)

- **Controlled Logging:** `/logging start` begins recording chat in the current channel.
- **Export & Stop:** `/logging stop` compiles the recorded messages and posts the transcript directly to the designated logging channel (`/config logging set channel:#channel`).
- **Media Link Optimization:** Media attachments are stored as direct URLs (`attachment.url`) within transcripts to keep file sizes under a few kilobytes.

### 🔨 7. Robust Moderation & Banning Suite

- **Voice Temp-Kick (`/tempkick target:@user duration:<180s/10m>`):** Disconnects a member from voice and actively monitors `voiceStateUpdate` to kick them if they attempt to rejoin before the timer expires.
- **Server Banning (`/ban` & `/tempban`):** Executes native Discord server bans with support for automated unban callbacks on duration expiry.
- **Unified Violation Alerts:** Dispatches logs to both the server log channel (`/config logging channel:#channel`) and the rule breaker's Direct Messages (if enabled via `/config dm_alerts`).

### 🔒 8. Granular Permission Engine (`/perm`)

- Operates independently of standard Discord server roles.
- Supports both users and roles: `/perm add target:<@user|@role> scope:<all | command_list>`.
- Allows server owners to delegate specific bot commands without giving out full Discord Administrator rights.

### 🚫 9. Dynamic Automod & Anti-Raid Engine

- **Content Filtering:** Dynamic `/blocktext` and `/blocklink` management without bot restarts.
- **Anti-Raid / Anti-Nuke:** Monitors repetitive cross-user message spam within a 5-second sliding window, instantly deleting raid messages and applying temporary timeouts.
- **Spam Whitelist (`/spam allow target:<@user|@bot>`):** Exempts trusted bots or webhooks from anti-spam rate limits.

### 👑 10. Developer Suite & Hidden Inbox Management (`/dev`, `/export`, `/import`)

- **Developer Management (`/dev`):** Owner-only command (`DEV_ID`) to list active operating guilds, system memory metrics, or force-leave unapproved servers (`/dev leave guild_id:<ID>`).
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
| `/guard` | Voice | Enforces strict privacy on any VC with 2s auto-alerts | `/perm` or `ARCH` |
| `/vclock` / `/vcunlock` | Voice | Locks/Unlocks voice channel for `@everyone` | `/perm` or `ARCH` |
| `/whitelist` | Voice | Adds a user to the active VC lock/guard session | Command Initiator |
| `/mute all` / `/unmute all` | Voice | Mutes or unmutes all users in current VC | `/perm` or `ARCH` |
| `/deafen all` / `/undeafen all` | Voice | Deafens or undeafens all users in current VC | `/perm` or `ARCH` |
| `/tempvc create` / `remove` | Temp VC | Spawns or deletes a temporary voice channel | Everyone / `/perm` |
| `/setnick` | Requests | Submits a nickname change request for approval | Everyone |
| `/ticket create` / `close` | Support | Opens a support ticket or closes and exports transcript | Everyone / Staff |
| `/tempkick` | Moderation | Voice-disconnects and blocks re-entry for a set duration | `/perm` or `ARCH` |
| `/ban` / `/tempban` | Moderation | Bans a user natively (permanently or temporarily) | `/perm` or `ARCH` |
| `/perm` | Admin | Assigns custom bot command permissions to users/roles | `ARCH` |
| `/arch` | Admin | Manages `ARCH` roles with Alpha Archon protection | `ARCH` / Secret Code |
| `/config` | Admin | Configures channels, tempvc, alerts, and logging | `ARCH` |
| `/logging start` / `stop` | Logging | Starts or stops chat recording and exports transcript | `/perm` or `ARCH` |
| `/dev` | Developer | System diagnostics, guild listing, and remote leave | Developer Only |

---

## 📁 Directory Structure

```text
.
├── src/
│   ├── commands/                     # Slash command definitions & logic
│   │   ├── admin/                    # Core administrative & developer controls
│   │   │   ├── arch.ts               # ARCH role management & Alpha Archon supremacy rules
│   │   │   ├── dev.ts                # Developer diagnostics, guild listing, and remote leave
│   │   │   └── exportImport.ts       # DM inbox session backup (/export) & restoration (/import)
│   │   ├── moderation/               # Moderation, automod, and server config commands
│   │   │   ├── automodCommands.ts    # /blocktext, /blocklink, and anti-spam controls
│   │   │   ├── broadcastCommands.ts  # /tell interactive announcements & DM notifications
│   │   │   ├── configCommands.ts     # Server configs (logging, tempvc category, permissions)
│   │   │   ├── logging.ts            # On-demand chat logging (/logging start/stop)
│   │   │   └── sanctions.ts          # /mute, /deafen, /tempkick, /tempban, /ban, /setnick
│   │   ├── support/                  # Ticketing & support systems
│   │   │   └── ticket.ts             # Private ticket creation, staff handling, & transcript generation
│   │   └── voice/                    # Voice channel security & session controls
│   │       └── channelControl.ts     # /guard, /vclock, /whitelist, /transfer, /tempvc
│   ├── events/                       # Discord API event listeners
│   │   ├── interactionCreate.ts      # Handles slash commands, buttons, & inbox interactions
│   │   ├── messageCreate.ts          # Evaluates incoming chat against automod & anti-raid pipelines
│   │   ├── ready.ts                  # Bot initialization, global command registration, & startup tasks
│   │   └── voiceStateUpdate.ts       # Enforces universal VC Guard, temp-kicks, & 5-min idle sweeper
│   ├── handlers/                     # Dynamic system loaders
│   │   ├── commandHandler.ts         # Loads and registers slash commands from disk
│   │   └── eventHandler.ts           # Binds event files to discord.js client events
│   ├── lib/                          # Core state stores & memory managers
│   │   └── kitkatState.ts            # Multi-guild runtime memory maps (permissions, VC locks, configs)
│   ├── middleware/                   # Extensible execution pipelines
│   │   ├── messagePipeline.ts        # Message filtering middleware (word/link bans, raid checks)
│   │   ├── pipeline.ts               # Core middleware runner for command pre-checks
│   │   └── voicePipeline.ts          # Voice state validation middleware
│   ├── utils/                        # Shared utility modules (helpers, sweepers, formatters)
│   ├── config.ts                     # Environment variable loader & process configuration
│   ├── database.ts                   # Persistent state/database helper (if storing backups locally)
│   └── index.ts                      # Main entry point (initializes Client & connects WebSocket)
├── .env                              # Private environment variables (Tokens, DEV_ID, ARCH_CODE)
├── .gitignore                        # Prevents sensitive files & node_modules from pushing to Git
├── LICENSE                           # Project usage license
├── package-lock.json                 # Locked dependency version tree
├── package.json                      # Project metadata, scripts, and npm dependencies
├── README.md                         # Full project documentation & command guide
└── tsconfig.json                     # TypeScript compiler configuration
