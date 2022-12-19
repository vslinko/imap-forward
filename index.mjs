import "dotenv/config";
import Imap from "imap";
import { readDB, saveDB } from "./lib/db.mjs";
import {
  connect,
  openBox,
  search,
  addFlags,
  readMsg,
  append,
} from "./lib/imap.mjs";
import { log } from "./lib/log.mjs";

async function main() {
  const db = readDB();

  const source = new Imap({
    user: process.env.SOURCE_USER,
    password: process.env.SOURCE_PASSWORD,
    host: process.env.SOURCE_HOST,
    port: 993,
    tls: true,
  });
  const dest = new Imap({
    user: process.env.DEST_USER,
    password: process.env.DEST_PASSWORD,
    host: process.env.DEST_HOST,
    port: 993,
    tls: true,
  });

  await connect(source);
  await connect(dest);

  await openBox(source, "INBOX");
  await openBox(dest, "INBOX");

  const unseen = await search(source, ["UNSEEN"]);
  log(`Found ${unseen.length} new messages`);

  for (const id of unseen) {
    if (db.messagesFound.has(id)) {
      log(`Duplicate message ${id}`);
      continue;
    }

    log(`Forwarding ${id}`);
    db.messagesFound.add(id);
    saveDB(db);
    const { body, attributes } = await readMsg(source, id);
    await append(dest, body, { date: attributes.date });
    await addFlags(source, id, ["\\Seen"]);
  }

  source.end();
  dest.end();
}

main();
