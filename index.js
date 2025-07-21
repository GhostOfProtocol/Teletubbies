import { Client, GatewayIntentBits, Partials, EmbedBuilder, ActivityType } from "discord.js";
import axios from "axios";
import keepAlive from "./server.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// === CONFIGURATION ===
const TOKEN = process.env.BOT_TOKEN;
const TRACKED_USER_ID = process.env.TRACKED_USER_ID;
const ALERT_USER_ID = process.env.ALERT_USER_ID;
const CHANNEL_DISCORD_ACTIVITY = process.env.CHANNEL_DISCORD_ACTIVITY;
const CHANNEL_STEAM_ALERTS = process.env.CHANNEL_STEAM_ALERTS;
const CHANNEL_COMPARISON = process.env.CHANNEL_COMPARISON;
const STEAM_API_KEY = process.env.STEAM_API_KEY;
const STEAM_ID = process.env.STEAM_ID;

// === STATE TRACKERS ===
let lastStatus = null;
let lastGame = null;
let lastSteamGame = null;
let steamGameStartTime = null;
let lastSuspiciousGame = null;
let lastSuspiciousTime = 0;
let discordOnlineSince = null;
let lastTrackedHours = {};
let lastHourCheck = 0;
const botStartTime = Date.now();

// === GET STEAM STATUS ===
async function getSteamStatus() {
  try {
    const res = await axios.get(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${STEAM_ID}`
    );
    const player = res.data.response.players[0];
    if (!player) return null;

    return {
      online: player.personastate !== 0,
      game: player.gameextrainfo || null,
      steamName: player.personaname,
      avatar: player.avatarfull,
    };
  } catch (err) {
    console.error("[STEAM ERROR]", err.message);
    return null;
  }
}

// === DISCORD PRESENCE UPDATE ===
client.on("presenceUpdate", (oldPresence, newPresence) => {
if (!newPresence || newPresence.user.id !== TRACKED_USER_ID) return;

  const member = newPresence.member;
  const status = newPresence.status || "offline";
  const nowStr = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
  const channel = client.channels.cache.get(CHANNEL_DISCORD_ACTIVITY);
  const game = (newPresence.activities || []).find((a) => a.type === ActivityType.Playing);

  if (status !== lastStatus) {
    if (["online", "idle", "dnd"].includes(status)) {
      discordOnlineSince = new Date();
    }

    if (status === "offline" && discordOnlineSince) {
      const timeOnlineMs = new Date() - discordOnlineSince;
      const mins = Math.floor(timeOnlineMs / 60000);
      const hrs = Math.floor(mins / 60);
      const durationStr = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;

      const embed = new EmbedBuilder()
        .setColor(0x999999)
        .setDescription(`📴 **Went offline**\nWas online for **${durationStr}**`)
        .setFooter({ text: nowStr });

      channel?.send({ embeds: [embed] }).catch(console.error);
      discordOnlineSince = null;
    }

    lastStatus = status;

    if (status !== "offline") {
      const embed = new EmbedBuilder()
        .setColor(status === "online" ? 0x00ff00 : status === "idle" ? 0xffcc00 : 0xff0000)
        .setDescription(`📶 **Status:** ${status.toUpperCase()}`)
        .setFooter({ text: nowStr });

      channel?.send({ embeds: [embed] }).catch(console.error);
    }
  }

  if (game?.name !== lastGame) {
    if (lastGame) {
      const embed = new EmbedBuilder()
        .setColor(0xff5555)
        .setDescription(`**Stopped playing:** ${lastGame}`)
        .setFooter({ text: nowStr });
      channel?.send({ embeds: [embed] }).catch(console.error);
    }

    if (game) {
      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setDescription(`🎮 **Now Playing:** ${game.name}`)
        .setFooter({ text: nowStr });
      channel?.send({ embeds: [embed] }).catch(console.error);
    }

    lastGame = game?.name || null;
  }
});

// === GET STEAM GAME HOURS ===
async function getSteamHours() {
  try {
    const res = await axios.get(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_API_KEY}&steamid=${STEAM_ID}&include_appinfo=true&include_played_free_games=true`
    );
    return res.data.response.games || [];
  } catch (err) {
    console.error("[STEAM HOURS ERROR]", err.message);
    return [];
  }
}

client.once("ready", () => {
  console.log(`Bot is online as ${client.user.tag}`);
  const activityChannel = client.channels.cache.get(CHANNEL_DISCORD_ACTIVITY);
  const nowStr = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
  if (activityChannel) {
    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setDescription("**BOT ONLINE**")
      .setFooter({ text: nowStr });
    activityChannel.send({ embeds: [embed] });
  }

  setInterval(async () => {
    try {
      const steam = await getSteamStatus();
      const user = await client.users.fetch(TRACKED_USER_ID).catch(() => null);
      const steamChannel = client.channels.cache.get(CHANNEL_STEAM_ALERTS);
      const compareChannel = client.channels.cache.get(CHANNEL_COMPARISON);
      if (!steam || !user || !steamChannel || !compareChannel) return;

      const discordStatus = user?.presence?.status || "offline";
      const now = new Date();
      const nowStr = now.toLocaleString("de-DE", { timeZone: "Europe/Berlin" });

      // Steam game activity
      if (steam.online && steam.game && steam.game !== lastSteamGame) {
        steamGameStartTime = now;
        const embed = new EmbedBuilder()
          .setColor(0xfa8072)
          .setDescription(`🎮 **Steam Game Launched:** ${steam.game}\n<@${ALERT_USER_ID}>`)
          .setFooter({ text: nowStr });
        steamChannel.send({ embeds: [embed] });
        lastSteamGame = steam.game;
      }

      if (!steam.game && lastSteamGame && steamGameStartTime) {
        const duration = Math.floor((now - steamGameStartTime) / 60000);
        const embed = new EmbedBuilder()
          .setColor(0x999999)
          .setDescription(`**Stopped playing on Steam:** ${lastSteamGame}\nPlayed for **${duration} minutes**`)
          .setFooter({ text: nowStr });
        steamChannel.send({ embeds: [embed] });
        lastSteamGame = null;
        steamGameStartTime = null;
      }

      // Suspicion check
      const isSuspicious = discordStatus === "offline" && (steam.online || steam.game);
      const cooldownPassed = Date.now() - lastSuspiciousTime > 30 * 60 * 1000;
      if (isSuspicious && (steam.game !== lastSuspiciousGame || cooldownPassed)) {
        const embed = new EmbedBuilder()
          .setColor(0xffaa00)
          .setDescription(`**Flagging**\nSteam (${steam.game ? `playing **${steam.game}**` : "online"}), Discord shows **OFFLINE**\n<@${ALERT_USER_ID}>`)
          .setFooter({ text: nowStr });
        compareChannel.send({ embeds: [embed] });
        lastSuspiciousGame = steam.game;
        lastSuspiciousTime = Date.now();
      }

      // Hidden hour check
      if (Date.now() - lastHourCheck >= 15 * 60 * 1000) {
        const games = await getSteamHours();
        games.forEach((game) => {
          const prev = lastTrackedHours[game.appid] || 0;
          const current = game.playtime_forever;
          if (prev && current > prev + 60) {
            const embed = new EmbedBuilder()
              .setColor(0xff4444)
              .setDescription(`**Suspicious Hour Detected**\nGame: **${game.name}**\nRecorded: ${prev} min → Now: ${current} min\n<@${ALERT_USER_ID}>`)
              .setFooter({ text: nowStr });
            compareChannel.send({ embeds: [embed] });
          }
          lastTrackedHours[game.appid] = current;
        });
        lastHourCheck = Date.now();
      }
    } catch (err) {
      console.error("Monitor loop error:", err);
    }
  }, 60000);
});

client.on("messageCreate", async (msg) => {
  if (!msg.guild) return;
  const compareChannel = client.channels.cache.get(CHANNEL_COMPARISON);
  const nowStr = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" });

  if (msg.content === "!test") {
    compareChannel?.send("Bot is active and listening.");
  }

  if (msg.content === "!uptime") {
    const uptime = Date.now() - botStartTime;
    const mins = Math.floor(uptime / 60000);
    const hrs = Math.floor(mins / 60);
    compareChannel?.send(`Uptime: ${hrs}h ${mins % 60}m`);
  }

  if (msg.content === "!cooldown") {
    const diff = Math.max(0, (lastSuspiciousTime + 30 * 60 * 1000) - Date.now());
    const mins = Math.ceil(diff / 60000);
    compareChannel?.send(diff > 0 ? `Cooldown remaining: ${mins} min` : `✅ No cooldown active.`);
  }

  if (msg.content === "!status") {
    const steam = await getSteamStatus();
    if (!steam) return compareChannel?.send("Steam API error or no user.");
    compareChannel?.send(`Steam: ${steam.online ? (steam.game ? `🎮 Playing **${steam.game}**` : "🟢 Online") : "⚫ Offline"}`);
  }

  if (msg.content === "!hiddencheck") {
    const games = await getSteamHours();
    games.forEach((game) => {
      const prev = lastTrackedHours[game.appid] || 0;
      const current = game.playtime_forever;
      if (prev && current > prev + 60) {
        const embed = new EmbedBuilder()
          .setColor(0xff4444)
          .setDescription(`**Manual Check: Suspicious Hour Detected**\nGame: **${game.name}**\nRecorded: ${prev} → Now: ${current} min\n<@${ALERT_USER_ID}>`)
          .setFooter({ text: nowStr });
        compareChannel.send({ embeds: [embed] });
      }
      lastTrackedHours[game.appid] = current;
    });
    compareChannel?.send("Manual hidden hour check complete.");
  }

  if (msg.content === "!list") {
    const activityChannel = client.channels.cache.get(CHANNEL_DISCORD_ACTIVITY);
    if (!activityChannel) return msg.reply("⚠️ Activity channel not found.");
    const embed = new EmbedBuilder()
      .setTitle("📋 Bot Command List")
      .setColor(0x00bfff)
      .setDescription([
        "`!test` – Check if bot is working",
        "`!status` – Show current Steam status",
        "`!uptime` – Show bot uptime",
        "`!cooldown` – Show suspicion cooldown",
        "`!hiddencheck` – Manual check for hidden Steam hours",
        "`!list` – Show all available commands"
      ].join("\n"));
    activityChannel.send({ embeds: [embed] });
    msg.reply("Command list sent to activity channel.");
  }
});

keepAlive();
client.login(TOKEN).catch((err) => {
  console.error("Login failed:", err);
});
