import * as dotenv from "dotenv";
dotenv.config({
  path: "./data/config",
});
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

function parseFrom(body) {
  for (const line of body.split("\n")) {
    if (line.trim() === "") {
      break;
    }
    const matches = /^from: .*<(.+)>$/i.exec(line);
    if (matches) {
      return matches[1];
    }
  }
  return null;
}

function shouldForward(body) {
  if (["subscrib@e.litres.ru"].includes(parseFrom(body))) {
    return false;
  }

  return true;
}

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
    if (shouldForward(body.toString("utf-8"))) {
      await append(dest, body, { date: attributes.date, mailbox: destMailbox });
    }
    await addFlags(source, id, ["\\Seen"]);
  }

  log("All messages forwarded");
}

async function main() {
  const db = readDB();

  log("Connecting");

  const authTimeout = Number(process.env.AUTH_TIMEOUT_MS || 5000);
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
  dest.on("error", (err) => {
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
