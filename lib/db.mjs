import fs from "fs";

export function readDB() {
  const db = fs.existsSync(process.env.DB_FILE)
    ? JSON.parse(fs.readFileSync(process.env.DB_FILE))
    : {};
  db.messagesFound = new Set(db.messagesFound || []);
  return db;
}

export function saveDB(db) {
  fs.writeFileSync(
    process.env.DB_FILE,
    JSON.stringify({
      messagesFound: Array.from(db.messagesFound),
    })
  );
}
