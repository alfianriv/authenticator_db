# Telegram Authenticator Bot

This is a Telegram bot that provides two-factor authentication (2FA) services.

## Tech Stack

*   **Backend:** Node.js, Express.js
*   **Database:** PostgreSQL with Drizzle ORM
*   **Telegram Bot API:** `node-telegram-bot-api`
*   **2FA:** `otpauth`

## Environment Variables

To run this project, you will need to create a `.env` file in the root directory and add the following environment variables:

```
TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
DB_CLIENT=supabase/sqlite
DATABASE_URL=YOUR_DATABASE_URL
```

## Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/your-username/authenticator.git
    ```
2.  Install the dependencies:
    ```bash
    npm install
    ```

## Running the Application

To start the bot, run the following command:

```bash
npm start
```

## Folder Structure

```
.
├── handlers
│   └── messageHandlers.js
├── index.js
├── package.json
├── README.md
└── setup
    └── db
        ├── index.js
        └── schema.js
```
