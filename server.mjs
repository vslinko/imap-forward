import "dotenv/config";
import express from "express";
import { fork } from "node:child_process";
import { log } from "./lib/log.mjs";

const syncInterval = Number(process.env.SYNC_INTERVAL_MS || 60000);
const processTimeout = Number(process.env.PROCESS_TIMEOUT_MS || 60000);
let lastSuccess = 0;
let lastFailed = 0;

function runTask() {
  const cp = fork("./index.mjs", {
    stdio: "inherit",
  });

  const t = setTimeout(() => {
    log("Killing process by timeout");
    cp.kill("SIGKILL");
  }, processTimeout);

  cp.on("exit", (code) => {
    if (code === 0) {
      lastSuccess = Date.now();
    } else {
      lastFailed = Date.now();
    }
    setTimeout(runTask, syncInterval);
    clearTimeout(t);
  });
}

const app = express();
app.disable("x-powered-by");

app.get("/status", (_, res) => {
  const isOk =
    lastSuccess > lastFailed && lastSuccess > Date.now() - syncInterval * 2;

  res.status(isOk ? 200 : 500).send();
});

app.listen(
  Number(process.env.SERVER_PORT || 3000),
  process.env.SERVER_HOST,
  runTask
);
