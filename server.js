import express from "express";
const app = express();

app.get("/", (req, res) => {
  res.send("Bot is alive!");
});

export default function keepAlive() {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ KeepAlive server running on port ${PORT}`);
  });

  setInterval(
    () => {
      fetch("https://discord-steam-bot.hydraplayer.repl.co/");
    },
    4 * 60 * 1000,
  ); // every 4 minutes
}
