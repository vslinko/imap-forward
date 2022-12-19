import { promisify } from "util";

export const connect = (imap) =>
  new Promise((resolve, reject) => {
    imap.once("ready", resolve);
    imap.once("error", reject);
    imap.connect();
  });

export const openBox = (imap, ...args) =>
  promisify(imap.openBox.bind(imap))(...args);

export const search = (imap, ...args) =>
  promisify(imap.search.bind(imap))(...args);

export const addFlags = (imap, id, flags) =>
  promisify(imap.addFlags.bind(imap))([id], flags);

export const readMsg = (imap, id) =>
  new Promise((resolve, reject) => {
    const f = imap.fetch([id], { bodies: "" });

    f.on("message", (msg) => {
      let result = { body: null, attributes: null };

      msg.once("error", reject);

      msg.once("attributes", (attrs) => {
        result.attributes = attrs;
      });

      msg.once("body", (stream) => {
        stream.on("data", (data) => {
          if (!result.body) {
            result.body = data;
          } else {
            result.body = Buffer.concat([result.body, data]);
          }
        });

        stream.once("error", reject);

        stream.once("end", () => {
          resolve(result);
        });
      });
    });

    f.once("error", reject);
  });

export const append = (imap, msg, options) =>
  promisify(imap.append.bind(imap))(msg, options);
