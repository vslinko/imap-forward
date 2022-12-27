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

async function forwardEmails(db, source, dest, sourceMailbox, destMailbox) {
  log(`Forwarding ${sourceMailbox} -> ${destMailbox}`);

  await openBox(source, sourceMailbox);

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
    await append(dest, body, { date: attributes.date, mailbox: destMailbox });
    await addFlags(source, id, ["\\Seen"]);
  }

  log("All messages forwarded");
}

async function main() {
  const db = readDB();

  log("Connecting");

  const authTimeout = Number(process.env.AUTH_TIMEOUT || 5000);
  const source = new Imap({
    user: process.env.SOURCE_USER,
    password: process.env.SOURCE_PASSWORD,
    host: process.env.SOURCE_HOST,
    port: 993,
    tls: true,
    authTimeout,
  });
  const dest = new Imap({
    user: process.env.DEST_USER,
    password: process.env.DEST_PASSWORD,
    host: process.env.DEST_HOST,
    port: 993,
    tls: true,
    authTimeout,
  });

  source.on("error", (err) => {
    log("Source server error:", err);
    process.exit(1);
  });
  dest.on("error", () => {
    log("Destination server error:", err);
    process.exit(1);
  });

  await connect(source);
  await connect(dest);

  try {
    await forwardEmails(db, source, dest, "Inbox", "INBOX");
    await forwardEmails(db, source, dest, "Bulk", "Junk");
  } catch (err) {
    log("Forwarding error:", err);
    process.exit(1);
  }

  process.exit(0);
}

main();

// timeAfterUnblockTillBlocked = 15m
// successTriesAfterUnblockTillBlocked = 5
// timeAfterBlockTillUnblocked = 40m
