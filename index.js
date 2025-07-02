const { configDotenv } = require("dotenv");
configDotenv();
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const db = require("./setup/db");
const messageHandlers = require("./handlers/messageHandlers");

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN is not set");
}

// replace the value below with the Telegram token you receive from @BotFather
const token = process.env.TELEGRAM_BOT_TOKEN;

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { polling: true });

// Register message handlers
messageHandlers(bot);

const app = express();

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Example app listening on port ${port}!`);
});

// Gracefully close the database connection
process.on("SIGINT", () => {
  if (db.close) {
    db.close((err) => {
      if (err) {
        return console.error(err.message);
      }
      console.log("Closed the database connection.");
      process.exit();
    });
  } else if (db.end) {
    db.end();
    process.exit();
  } else {
    process.exit();
  }
});
