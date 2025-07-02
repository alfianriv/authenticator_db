
const sqlite3 = require('sqlite3').verbose();
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const schema = require('./schema');

const dbClient = process.env.DB_CLIENT || 'sqlite';

let db;

if (dbClient === 'sqlite') {
    db = new sqlite3.Database('./bot.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Connected to the bot database.');
    });

    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userid INTEGER NOT NULL,
            name TEXT NOT NULL UNIQUE,
            secret TEXT NOT NULL UNIQUE,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error(err.message);
            }
            console.log("'users' table is ready.");
        });
    });
} else if (dbClient === 'supabase') {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL are not set');
    }

    const supabase = postgres(process.env.DATABASE_URL);
    db = drizzle(supabase, { schema });
    console.log('Connected to Supabase.');
} else if (dbClient === 'supabase-postgres') {
    if (!process.env.SUPABASE_DB_URL) {
        throw new Error('SUPABASE_DB_URL is not set');
    }

    const client = new Client({
        connectionString: process.env.SUPABASE_DB_URL,
    });

    client.connect();

    db = drizzle(client, { schema });
    console.log('Connected to Supabase via Postgres.');
} else {
    throw new Error(`Unsupported DB_CLIENT: ${dbClient}`);
}

module.exports = db;
