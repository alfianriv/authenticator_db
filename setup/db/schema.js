const { pgTable, serial, integer, text, timestamp } = require("drizzle-orm/pg-core");

const users = pgTable("authenticator", {
  id: serial("id").primaryKey(),
  userid: integer("userid").notNull(),
  name: text("name").notNull().unique(),
  secret: text("secret").notNull().unique(),
  created_at: timestamp("created_at").defaultNow(),
});

module.exports = { users };
