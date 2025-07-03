const db = require("../setup/db");
const otpauth = require("otpauth");
const { and, eq } = require("drizzle-orm");
const { users } = require("../setup/db/schema");
const axios = require("axios");
const { decompileQrCodeFromBuffer } = require("../helpers/image/decompile-qrcode");

// In-memory store for user states
const userState = {};

module.exports = (bot) => {
  // Command to start the process of adding a new secret
  bot.onText(/\/set/, (msg) => {
    const chatId = msg.chat.id;
    userState[chatId] = { step: "awaiting_name" };
    bot.sendMessage(
      chatId,
      "Let's set up a new secret. What would you like to name it?"
    );
  });

  // Command to cancel the current operation
  bot.onText(/\/cancel/, (msg) => {
    const chatId = msg.chat.id;
    if (userState[chatId]) {
      delete userState[chatId];
      bot.sendMessage(chatId, "The current operation has been cancelled.");
    } else {
      bot.sendMessage(chatId, "There is no operation to cancel.");
    }
  });

  // Listen for messages to handle the step-by-step process
  bot.on("message", (msg) => {
    const chatId = msg.chat.id;
    const state = userState[chatId];

    if (
      !state ||
      (msg.text &&
        (msg.text.startsWith("/set") ||
          msg.text.startsWith("/cancel") ||
          msg.text.startsWith("/generate") ||
          msg.text.startsWith("/delete") ||
          msg.text.startsWith("/rename") ||
          msg.text.startsWith("/help")))
    ) {
      return;
    }

    if (state.step === "awaiting_name") {
      handleNameStep(bot, msg);
    } else if (state.step === "awaiting_secret") {
      handleSecretStep(bot, msg);
    } else if (state.step === "awaiting_new_name") {
      handleNewNameStep(bot, msg);
    }
  });

  async function handleNameStep(bot, msg) {
    const chatId = msg.chat.id;
    const name = msg.text;

    if (!name) {
      bot.sendMessage(chatId, "Please provide a name for your key.");
      return;
    }

    try {
      await checkName(msg.from.id, name);
    } catch (e) {
      bot.sendMessage(chatId, e.message);
      delete userState[chatId];
      return;
    }

    userState[chatId].name = name;
    userState[chatId].step = "awaiting_secret";
    bot.sendMessage(
      chatId,
      `Great! The name is set to "${name}". Now, please send me the secret key, or a QR code containing it.`
    );
  }

  async function checkName(userId, name) {
    if (process.env.DB_CLIENT === "supabase") {
      const { data, error } = await db
        .select()
        .from(users)
        .where(and(eq(users.userid, userId), eq(users.name, name)));

      if (error) {
        throw new Error(error.message);
      }
      if (data?.length > 0) {
        throw new Error("Name already in use");
      }
    } else if (process.env.DB_CLIENT === "sqlite") {
      db.get("SELECT * FROM users WHERE name = ?", [name], (err, row) => {
        if (err) {
          throw new Error(err.message);
        }
        if (row) {
          throw new Error("Name already in use");
        }
      });
    }
  }

  async function handleSecretStep(bot, msg) {
    const chatId = msg.chat.id;

    if (msg.photo) {
      const photo = msg.photo[msg.photo.length - 1];
      const fileId = photo.file_id;

      const fileLink = await bot.getFileLink(fileId);

      const response = await axios({
        method: "get",
        url: fileLink,
        responseType: "arraybuffer",
      });

      const imageBuffer = response.data;

      try {
        const decodedText = await decompileQrCodeFromBuffer(imageBuffer);
        await saveSecret(bot, msg, decodedText);
        delete userState[chatId];
      } catch (error) {
        console.error(error);
        bot.sendMessage(chatId, "Invalid QR code.");
        delete userState[chatId];
      }
    } else if (msg.text) {
      const secret = msg.text;
      saveSecret(bot, msg, secret);
    } else {
      bot.sendMessage(
        chatId,
        "Please send me the secret key as text, or a QR code image."
      );
    }
  }

  async function checkAuth(userId, name, secret) {
    if (process.env.DB_CLIENT === "supabase") {
      const { data, error } = await db
        .select()
        .from(users)
        .where(
          and(
            eq(users.userid, userId),
            eq(users.name, name),
            eq(users.secret, secret)
          )
        );

      if (error) {
        throw new Error(error.message);
      }
      if (data?.length > 0) {
        throw new Error("Invalid secret");
      }
    } else if (process.env.DB_CLIENT === "sqlite") {
      db.get(
        "SELECT * FROM users WHERE userid = ? AND name = ? AND secret = ?",
        [userId, name, secret],
        (err, row) => {
          if (err) {
            throw new Error(err.message);
          }
          if (row) {
            throw new Error("Invalid secret");
          }
        }
      );
    }
  }

  async function saveSecret(bot, msg, secret) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const name = userState[chatId].name;

    await checkAuth(userId, name, secret);

    if (process.env.DB_CLIENT === "supabase") {
      const { data, error } = await db.insert(users).values({
        userid: userId,
        name: name,
        secret: secret,
        created_at: new Date(),
      });

      if (error) {
        bot.sendMessage(chatId, "An error occurred while saving your data.");
        console.error(error.message);
        delete userState[chatId];
        return;
      }

      bot.sendMessage(
        chatId,
        `Success! Your secret for "${name}" has been saved.`
      );
      delete userState[chatId];
    } else if (process.env.DB_CLIENT === "sqlite") {
      db.get("SELECT * FROM users WHERE secret = ?", [secret], (err, row) => {
        if (err) {
          bot.sendMessage(chatId, "An error occurred.");
          console.error(err.message);
          delete userState[chatId];
          return;
        }
        if (row) {
          bot.sendMessage(
            chatId,
            "This secret is already in use. Please provide a different one."
          );
          return;
        }

        db.run(
          "INSERT INTO users (userid, name, secret) VALUES (?, ?, ?)",
          [userId, name, secret],
          function (err) {
            if (err) {
              bot.sendMessage(
                chatId,
                "An error occurred while saving your data."
              );
              console.error(err.message);
            } else {
              bot.sendMessage(
                chatId,
                `Success! Your secret for "${name}" has been saved.`
              );
            }
            delete userState[chatId];
          }
        );
      });
    }
  }

  async function handleNewNameStep(bot, msg) {
    const chatId = msg.chat.id;
    const newName = msg.text;
    const oldName = userState[chatId].oldName;
    const userId = msg.from.id;

    if (!newName) {
      bot.sendMessage(chatId, "Please provide a new name for your key.");
      return;
    }

    if (process.env.DB_CLIENT === "supabase") {
      const { data, error } = await db
        .update(users)
        .set({ name: newName })
        .where(and(eq(users.userid, userId), eq(users.name, oldName)));

      if (error) {
        bot.sendMessage(chatId, "An error occurred while renaming the key.");
        console.error(error.message);
      } else {
        bot.sendMessage(
          chatId,
          `The key "${oldName}" has been renamed to "${newName}".`
        );
      }
      delete userState[chatId];
    } else if (process.env.DB_CLIENT === "sqlite") {
      db.get(
        "SELECT * FROM users WHERE name = ? AND userid = ?",
        [newName, userId],
        (err, row) => {
          if (err) {
            bot.sendMessage(chatId, "An error occurred.");
            console.error(err.message);
            delete userState[chatId];
            return;
          }
          if (row) {
            bot.sendMessage(
              chatId,
              "This name is already taken. Please choose another one."
            );
            return;
          }

          db.run(
            "UPDATE users SET name = ? WHERE name = ? AND userid = ?",
            [newName, oldName, userId],
            function (err) {
              if (err) {
                bot.sendMessage(
                  chatId,
                  "An error occurred while renaming the key."
                );
                console.error(err.message);
              } else {
                bot.sendMessage(
                  chatId,
                  `The key "${oldName}" has been renamed to "${newName}".`
                );
              }
              delete userState[chatId];
            }
          );
        }
      );
    }
  }

  bot.onText(/\/generate(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const name = match[1];

    if (name) {
      generateToken(bot, chatId, userId, name);
    } else {
      if (process.env.DB_CLIENT === "supabase") {
        const result = await db
          .select()
          .from(users)
          .where(eq(users.userid, userId));

        if (result.length === 0) {
          bot.sendMessage(
            chatId,
            "You don't have any keys saved yet. Use /set to add one."
          );
          return;
        }

        const keyboard = {
          inline_keyboard: result.map((row) => [
            {
              text: row.name,
              callback_data: `generate_${row.name}`,
            },
          ]),
        };

        bot.sendMessage(chatId, "Choose a key to generate a token:", {
          reply_markup: keyboard,
        });
        return;
      } else if (process.env.DB_CLIENT === "sqlite") {
        db.all(
          "SELECT name FROM users WHERE userid = ?",
          [userId],
          (err, rows) => {
            if (err) {
              bot.sendMessage(chatId, "An error occurred.");
              return console.error(err.message);
            }

            if (rows.length === 0) {
              bot.sendMessage(
                chatId,
                "You don't have any keys saved yet. Use /set to add one."
              );
              return;
            }

            const keyboard = {
              inline_keyboard: rows.map((row) => [
                {
                  text: row.name,
                  callback_data: `generate_${row.name}`,
                },
              ]),
            };

            bot.sendMessage(chatId, "Choose a key to generate a token:", {
              reply_markup: keyboard,
            });
          }
        );
      }
    }
  });

  bot.onText(/\/delete/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (process.env.DB_CLIENT === "supabase") {
      const data = await db
        .select()
        .from(users)
        .where(eq(users.userid, userId));

      if (data.length === 0) {
        bot.sendMessage(chatId, "You don't have any keys to delete.");
        return;
      }

      const keyboard = {
        inline_keyboard: data.map((row) => [
          {
            text: row.name,
            callback_data: `delete_${row.name}`,
          },
        ]),
      };

      bot.sendMessage(chatId, "Choose a key to delete:", {
        reply_markup: keyboard,
      });
    } else if (process.env.DB_CLIENT === "sqlite") {
      db.all(
        "SELECT name FROM users WHERE userid = ?",
        [userId],
        (err, rows) => {
          if (err) {
            bot.sendMessage(chatId, "An error occurred.");
            return console.error(err.message);
          }

          if (rows.length === 0) {
            bot.sendMessage(chatId, "You don't have any keys to delete.");
            return;
          }

          const keyboard = {
            inline_keyboard: rows.map((row) => [
              {
                text: row.name,
                callback_data: `delete_${row.name}`,
              },
            ]),
          };

          bot.sendMessage(chatId, "Choose a key to delete:", {
            reply_markup: keyboard,
          });
        }
      );
    }
  });

  bot.onText(/\/rename/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (process.env.DB_CLIENT === "supabase") {
      const data = await db
        .select()
        .from(users)
        .where(eq(users.userid, userId));

      if (data.length === 0) {
        bot.sendMessage(chatId, "You don't have any keys to rename.");
        return;
      }

      const keyboard = {
        inline_keyboard: data.map((row) => [
          {
            text: row.name,
            callback_data: `rename_${row.name}`,
          },
        ]),
      };

      bot.sendMessage(chatId, "Choose a key to rename:", {
        reply_markup: keyboard,
      });
    } else if (process.env.DB_CLIENT === "sqlite") {
      db.all(
        "SELECT name FROM users WHERE userid = ?",
        [userId],
        (err, rows) => {
          if (err) {
            bot.sendMessage(chatId, "An error occurred.");
            return console.error(err.message);
          }

          if (rows.length === 0) {
            bot.sendMessage(chatId, "You don't have any keys to rename.");
            return;
          }

          const keyboard = {
            inline_keyboard: rows.map((row) => [
              {
                text: row.name,
                callback_data: `rename_${row.name}`,
              },
            ]),
          };

          bot.sendMessage(chatId, "Choose a key to rename:", {
            reply_markup: keyboard,
          });
        }
      );
    }
  });

  bot.onText(/\/help|\/start/, (msg) => {
    const chatId = msg.chat.id;
    const helpCommands = [
      { text: "/set - Add a new secret key", callback_data: "help_set" },
      { text: "/generate - Generate a TOTP", callback_data: "help_generate" },
      { text: "/delete - Delete a key", callback_data: "help_delete" },
      { text: "/rename - Rename a key", callback_data: "help_rename" },
    ];

    const keyboard = {
      inline_keyboard: helpCommands.map((cmd) => [cmd]),
    };

    bot.sendMessage(chatId, "Here are the commands you can use:", {
      reply_markup: keyboard,
    });
  });

  bot.on("callback_query", async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    if (data.startsWith("generate_")) {
      const name = data.replace("generate_", "");
      bot.editMessageText(`Generating token for "${name}"...`, {
        chat_id: chatId,
        message_id: msg.message_id,
        reply_markup: null,
      });
      generateToken(bot, chatId, userId, name, msg.message_id);
      bot.answerCallbackQuery(callbackQuery.id);
    } else if (data.startsWith("delete_")) {
      const name = data.replace("delete_", "");
      const keyboard = {
        inline_keyboard: [
          [
            { text: "Yes, delete it", callback_data: `confirm_delete_${name}` },
            { text: "No, cancel", callback_data: "cancel_delete" },
          ],
        ],
      };
      bot.editMessageText(
        `Are you sure you want to delete the key "${name}"?`,
        {
          chat_id: chatId,
          message_id: msg.message_id,
          reply_markup: keyboard,
        }
      );
      bot.answerCallbackQuery(callbackQuery.id);
    } else if (data.startsWith("confirm_delete_")) {
      const name = data.replace("confirm_delete_", "");
      if (process.env.DB_CLIENT === "supabase") {
        const { error } = await db
          .delete(users)
          .where(and(eq(users.userid, userId), eq(users.name, name)));

        if (error) {
          bot.editMessageText("An error occurred while deleting the key.", {
            chat_id: chatId,
            message_id: msg.message_id,
            reply_markup: null,
          });
          return console.error(error.message);
        }
        bot.editMessageText(`The key "${name}" has been deleted.`, {
          chat_id: chatId,
          message_id: msg.message_id,
          reply_markup: null,
        });
      } else if (process.env.DB_CLIENT === "sqlite") {
        db.run(
          "DELETE FROM users WHERE userid = ? AND name = ?",
          [userId, name],
          function (err) {
            if (err) {
              bot.editMessageText("An error occurred while deleting the key.", {
                chat_id: chatId,
                message_id: msg.message_id,
                reply_markup: null,
              });
              return console.error(err.message);
            }
            bot.editMessageText(`The key "${name}" has been deleted.`, {
              chat_id: chatId,
              message_id: msg.message_id,
              reply_markup: null,
            });
          }
        );
      }
      bot.answerCallbackQuery(callbackQuery.id);
    } else if (data === "cancel_delete") {
      bot.editMessageText("Deletion cancelled.", {
        chat_id: chatId,
        message_id: msg.message_id,
        reply_markup: null,
      });
      bot.answerCallbackQuery(callbackQuery.id);
    } else if (data.startsWith("rename_")) {
      const name = data.replace("rename_", "");
      userState[chatId] = { step: "awaiting_new_name", oldName: name };
      bot.editMessageText(
        `You have selected to rename "${name}". What would you like to rename it to?`,
        {
          chat_id: chatId,
          message_id: msg.message_id,
          reply_markup: null,
        }
      );
      bot.answerCallbackQuery(callbackQuery.id);
    } else if (data.startsWith("help_")) {
      const command = data.replace("help_", "");
      let helpText = "";
      switch (command) {
        case "set":
          helpText =
            "Use /set to add a new secret key. The bot will guide you through the process of providing a name and the secret (either as text or a QR code image).";
          break;
        case "generate":
          helpText =
            "Use /generate to get a TOTP. If you don't specify a key name (e.g., /generate mykey), the bot will show you a list of your saved keys to choose from.";
          break;
        case "delete":
          helpText =
            "Use /delete to remove a saved key. The bot will ask you to choose which key to delete from a list and confirm your choice.";
          break;
        case "rename":
          helpText =
            "Use /rename to change the name of an existing key. The bot will guide you through selecting the key and providing a new name.";
          break;
        default:
          helpText = "Unknown command. Please select from the options.";
      }
      bot.editMessageText(helpText, {
        chat_id: chatId,
        message_id: msg.message_id,
        reply_markup: null,
      });
      bot.answerCallbackQuery(callbackQuery.id);
    }
  });

  async function generateToken(bot, chatId, userId, name, message_id = null) {
    if (process.env.DB_CLIENT === "supabase") {
      const data = await db
        .select()
        .from(users)
        .where(and(eq(users.userid, userId), eq(users.name, name)));

      let text;
      if (data.length > 0) {
        try {
          let totp = new otpauth.TOTP({
            issuer: "YourBot",
            label: name,
            algorithm: "SHA1",
            digits: 6,
            period: 30,
            secret: data[0].secret,
          });
          let token = totp.generate();
          text = `Your TOTP for ${name} is: ||${token}||`;
        } catch (e) {
          text = "Could not generate a token. Is the secret valid?";
          console.error(e);
        }
      } else {
        text = `No key found with the name "${name}".`;
      }

      if (message_id) {
        bot.editMessageText(text, {
          chat_id: chatId,
          message_id: message_id,
          reply_markup: null,
          parse_mode: "MarkdownV2",
        });
      } else {
        bot.sendMessage(chatId, text, { parse_mode: "MarkdownV2" });
      }
    } else if (process.env.DB_CLIENT === "sqlite") {
      db.get(
        "SELECT secret FROM users WHERE userid = ? AND name = ?",
        [userId, name],
        (err, row) => {
          let text;
          if (err) {
            text = "An error occurred.";
            console.error(err.message);
          } else if (row) {
            try {
              let totp = new otpauth.TOTP({
                issuer: "YourBot",
                label: name,
                algorithm: "SHA1",
                digits: 6,
                period: 30,
                secret: row.secret,
              });
              let token = totp.generate();
              text = `Your TOTP for ${name} is: ||${token}||`;
            } catch (e) {
              text = "Could not generate a token. Is the secret valid?";
              console.error(e);
            }
          } else {
            text = `No key found with the name "${name}".`;
          }

          if (message_id) {
            bot.editMessageText(text, {
              chat_id: chatId,
              message_id: message_id,
              reply_markup: null,
              parse_mode: "MarkdownV2",
            });
          } else {
            bot.sendMessage(chatId, text, { parse_mode: "MarkdownV2" });
          }
        }
      );
    }
  }

  bot.onText(/\/echo (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const resp = match[1];
    bot.sendMessage(chatId, resp);
  });

  bot.on("polling_error", console.log);
};
