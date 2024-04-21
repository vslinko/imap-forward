import * as dotenv from "dotenv";
import Imap from "imap";
import fs from "fs/promises";
import util from "util";
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
import { parse, evaluate } from "./lib/sieve.mjs";
import { simpleParser } from "mailparser";

async function forwardEmails(
  db,
  source,
  dest,
  { sourceMailbox, destMailbox, sieveScript }
) {
  log(`Processing ${sourceMailbox}`);

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

    let mailDescMailbox = destMailbox;
    let keep = true;
    let flags = [];

    if (sieveScript) {
      try {
        const parsedMail = await simpleParser(body);
        const result = evaluate(sieveScript, parsedMail);
        if (result.keep !== null) {
          keep = result.keep;
        }
        if (result.fileinto) {
          mailDescMailbox = result.fileinto;
        }
        flags = Array.from(result.flags);
      } catch (err) {
        log("Sieve script evaluation error:", err);
      }
    }

    log(
      `keep = ${keep} mailbox = ${mailDescMailbox} flags = [${flags.join(" ")}]`
    );

    if (keep) {
      await append(dest, body, {
        date: attributes.date,
        mailbox: mailDescMailbox,
        flags,
      });
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

  let sieveScript;
  if (process.env.SIEVE_SCRIPT) {
    try {
      log(`Loading sieve script ${process.env.SIEVE_SCRIPT}`);
      const src = await fs.readFile(process.env.SIEVE_SCRIPT, "utf8");
      sieveScript = parse(src);
      if (process.env.DEBUG_SIEVE) {
        console.log(
          util.inspect(sieveScript, {
            showHidden: false,
            depth: null,
            colors: true,
          })
        );
        console.log(src);
      }
    } catch (err) {
      log("Sieve script loading error:", err);
    }
  }

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
      sieveScript,
    });
    forwarded += inboxRes.forwared;
    skipped += inboxRes.skipped;
    const junkRes = await forwardEmails(db, source, dest, {
      sourceMailbox: "Bulk",
      destMailbox: "Junk",
      sieveScript,
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
