import { Client, GatewayIntentBits, Partials, EmbedBuilder } from "discord.js";
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

// === GET STEAM STATUS ===
async function getSteamStatus() {
  try {
    const res = await axios.get(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${STEAM_ID}`,
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

// === DISCORD READY EVENT ===
client.once("ready", () => {
  console.log(`✅ Bot is online as ${client.user.tag}`);

  const now = new Date();
  const nowStr = now.toLocaleString("de-DE", { timeZone: "Europe/Berlin" });

  const activityChannel = client.channels.cache.get(CHANNEL_DISCORD_ACTIVITY);
  if (activityChannel) {
    const onlineEmbed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setDescription("✅ **BOT ONLINE**")
      .setFooter({ text: nowStr });

    activityChannel.send({ embeds: [onlineEmbed] });
  }

  // === STEAM MONITOR LOOP ===
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

      if (steam.online && steam.game) {
        if (steam.game !== lastSteamGame) {
          steamGameStartTime = now;

          const steamEmbed = new EmbedBuilder()
            .setColor(0xfa8072)
            .setDescription(
              `🎮 **Steam Game Launched:** ${steam.game}\n<@${ALERT_USER_ID}>`,
            )
            .setFooter({ text: nowStr });

          steamChannel
            .send({ embeds: [steamEmbed] })
            .catch((err) =>
              console.error("[STEAM CHANNEL ERROR]", err.message),
            );
          lastSteamGame = steam.game;
        }
      } else if (!steam.game && lastSteamGame && steamGameStartTime) {
        const playedMs = now - steamGameStartTime;
        const mins = Math.floor(playedMs / 60000);
        const hrs = Math.floor(mins / 60);
        const remainingMins = mins % 60;

        const durationStr =
          hrs > 0
            ? `${hrs} hour${hrs !== 1 ? "s" : ""} ${remainingMins} minute${
                remainingMins !== 1 ? "s" : ""
              }`
            : `${remainingMins} minute${remainingMins !== 1 ? "s" : ""}`;

        const stopEmbed = new EmbedBuilder()
          .setColor(0x999999)
          .setDescription(
            `**Stopped playing on Steam:** ${lastSteamGame}\nPlayed for **${durationStr}**`,
          )
          .setFooter({ text: nowStr });

        steamChannel
          .send({ embeds: [stopEmbed] })
          .catch((err) => console.error("[STEAM CHANNEL ERROR]", err.message));
        steamGameStartTime = null;
        lastSteamGame = null;
      }

      const nowTime = Date.now();
      const cooldownPassed = nowTime - lastSuspiciousTime > 30 * 60 * 1000;

      const isSuspicious =
        discordStatus === "offline" && (steam.online || steam.game);

      if (
        isSuspicious &&
        (steam.game !== lastSuspiciousGame || cooldownPassed)
      ) {
        const compareEmbed = new EmbedBuilder()
          .setColor(0xffaa00)
          .setDescription(
            `**Flagging**\nSteam (${steam.game ? `playing **${steam.game}**` : "online"}), Discord shows **${discordStatus.toUpperCase()}**\n<@${ALERT_USER_ID}>`,
          )
          .setFooter({ text: nowStr });

        compareChannel
          .send({ embeds: [compareEmbed] })
          .catch((err) =>
            console.error("[COMPARE CHANNEL ERROR]", err.message),
          );

        lastSuspiciousGame = steam.game;
        lastSuspiciousTime = nowTime;
      }
    } catch (error) {
      console.error("Error in Steam monitor loop:", error);
    }
  }, 60000);
});

// === PRESENCE UPDATE HANDLER ===
client.on("presenceUpdate", (_, newPresence) => {
  if (!newPresence || newPresence.userId !== TRACKED_USER_ID) return;

  const member = newPresence.member;
  const status = newPresence.status || "offline";
  const now = new Date();
  const nowStr = now.toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
  const channel = client.channels.cache.get(CHANNEL_DISCORD_ACTIVITY);
  const userTag = member?.user?.tag || `<@${TRACKED_USER_ID}>`;

  if (status !== lastStatus) {
    if (["online", "idle", "dnd"].includes(status)) {
      discordOnlineSince = now;
    }

    if (status === "offline" && discordOnlineSince) {
      const timeOnlineMs = now - discordOnlineSince;
      const mins = Math.floor(timeOnlineMs / 60000);
      const hrs = Math.floor(mins / 60);
      const remainingMins = mins % 60;
      const durationStr =
        hrs > 0
          ? `${hrs} hour${hrs !== 1 ? "s" : ""} ${remainingMins} minute${
              remainingMins !== 1 ? "s" : ""
            }`
          : `${remainingMins} minute${remainingMins !== 1 ? "s" : ""}`;

      const offlineEmbed = new EmbedBuilder()
        .setColor(0x999999)
        .setDescription(`**Went offline**\nWas online for **${durationStr}**`)
        .setFooter({ text: nowStr });

      channel
        ?.send({ embeds: [offlineEmbed] })
        .catch((err) => console.error("[ACTIVITY CHANNEL ERROR]", err.message));

      discordOnlineSince = null;
    }

    lastStatus = status;

    if (status !== "offline") {
      const statusEmbed = new EmbedBuilder()
        .setColor(
          status === "online"
            ? 0x00ff00
            : status === "idle"
              ? 0xffcc00
              : status === "dnd"
                ? 0xff0000
                : 0x666666,
        )
        .setDescription(`📶 **Status:** ${status.toUpperCase()}`)
        .setFooter({ text: nowStr });

      channel
        ?.send({ embeds: [statusEmbed] })
        .catch((err) => console.error("[ACTIVITY CHANNEL ERROR]", err.message));
    }
  }

  const activities = newPresence.activities || [];
  const game = activities.find((a) => a.type === 0);

  if (game?.name !== lastGame) {
    if (lastGame) {
      const stopEmbed = new EmbedBuilder()
        .setColor(0xff5555)
        .setDescription(`**Stopped playing:** ${lastGame}`)
        .setFooter({ text: nowStr });

      channel
        ?.send({ embeds: [stopEmbed] })
        .catch((err) => console.error("[ACTIVITY CHANNEL ERROR]", err.message));
    }

    if (game) {
      const startEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setDescription(`🎮 **Now Playing:** ${game.name}`)
        .setFooter({ text: nowStr });

      channel
        ?.send({ embeds: [startEmbed] })
        .catch((err) => console.error("[ACTIVITY CHANNEL ERROR]", err.message));
    }

    lastGame = game?.name || null;
  }
});

// === ERROR HANDLING ===
process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

client.on("disconnect", () => {
  console.log("Bot disconnected, attempting to reconnect...");
});

client.on("reconnecting", () => {
  console.log("Bot reconnecting...");
});

client.on("resume", () => {
  console.log("Bot connection resumed");
});

client.on("warn", (warning) => {
  console.warn("Discord warning:", warning);
});

// === START BOT ===
keepAlive();
client.login(TOKEN);
