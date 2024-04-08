import * as dotenv from "dotenv";
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
  const lineBreak = body.includes("\r\n") ? "\r\n" : "\n";

  for (const line of body.split(lineBreak)) {
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

function shouldArchive(from) {
  const forwardButArchiveEmails = (
    process.env.FORWARD_BUT_ARCHIVE_EMAILS || ""
  ).split(",");

  if (forwardButArchiveEmails.includes(from)) {
    return true;
  }

  return false;
}

function shouldForward(from) {
  const doNotForwardEmails = (process.env.DO_NOT_FORWARD_EMAILS || "").split(
    ","
  );

  if (doNotForwardEmails.includes(from)) {
    return false;
  }

  return true;
}

async function forwardEmails(
  db,
  source,
  dest,
  { sourceMailbox, destMailbox, archiveMailbox }
) {
  log(`Forwarding ${sourceMailbox} -> ${destMailbox}`);

  let forwared = 0;
  let skipped = 0;

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
    const from = parseFrom(body.toString("utf-8"));

    if (shouldForward(from)) {
      if (archiveMailbox && shouldArchive(from)) {
        await append(dest, body, {
          date: attributes.date,
          mailbox: archiveMailbox,
          flags: ["\\Seen"],
        });
      } else {
        await append(dest, body, {
          date: attributes.date,
          mailbox: destMailbox,
        });
      }
      forwared++;
    } else {
      skipped++;
    }

    await addFlags(source, id, ["\\Seen"]);
  }

  log("All messages forwarded");

  return { forwared, skipped };
}

async function report(body) {
  try {
    const baseUrl = process.env.INFLUXDB_BASE_URL;
    const org = process.env.INFLUXDB_ORG;
    const bucket = process.env.INFLUXDB_BUCKET;
    const token = process.env.INFLUXDB_TOKEN;
    await fetch(`${baseUrl}/api/v2/write?org=${org}&bucket=${bucket}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
      },
      body,
    });
  } catch (err) {
    console.log(err);
  }
}

function timeNs() {
  return process.hrtime.bigint();
}

async function reportError(start, end) {
  const duration = end - start;
  const now = Date.now() * 1000000;
  await report(`imap_forward,status="error" duration=${duration}i ${now}`);
}

async function reportSuccess(start, end, forwarded, skipped) {
  const duration = end - start;
  const now = Date.now() * 1000000;
  await report(
    `imap_forward,status="success" duration=${duration}i,forwarded=${forwarded}i,skipped=${skipped} ${now}`
  );
}

async function main() {
  const configFile = process.env.CONFIG_FILE || "./data/config";
  dotenv.config({
    path: configFile,
  });

  const start = timeNs();
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

  source.on("error", async (err) => {
    log("Source server error:", err);
    await reportError(start, timeNs());
    process.exit(1);
  });
  dest.on("error", async (err) => {
    log("Destination server error:", err);
    await reportError(start, timeNs());
    process.exit(1);
  });

  await connect(source);
  await connect(dest);

  let forwarded = 0;
  let skipped = 0;

  try {
    const inboxRes = await forwardEmails(db, source, dest, {
      sourceMailbox: "Inbox",
      destMailbox: "Inbox",
      archiveMailbox: "Archive",
    });
    forwarded += inboxRes.forwared;
    skipped += inboxRes.skipped;
    const junkRes = await forwardEmails(db, source, dest, {
      sourceMailbox: "Bulk",
      destMailbox: "Junk",
    });
    forwarded += junkRes.forwared;
    skipped += junkRes.skipped;
  } catch (err) {
    log("Forwarding error:", err);
    await reportError(start, timeNs());
    process.exit(1);
  }

  await reportSuccess(start, timeNs(), forwarded, skipped);

  process.exit(0);
}

main();

// timeAfterUnblockTillBlocked = 15m
// successTriesAfterUnblockTillBlocked = 5
// timeAfterBlockTillUnblocked = 40m
