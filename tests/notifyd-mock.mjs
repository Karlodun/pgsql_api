// TEST DOUBLE of notifyd — same HTTP contract, no ring buffer, no LISTEN.
// It polls notify.horizon() via psql every 300 ms. Only for the e2e test; production is notifyd (Rust).
// Usage: PGPORT=5433 PGDATABASE=e2e NOTIFYD_SECRET=... NOTIFYD_AUD=test PORT=8091 ORIGIN=http://localhost:8080 node notifyd-mock.mjs
import http from "node:http";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const env = process.env;
const SECRET = env.NOTIFYD_SECRET, AUD = env.NOTIFYD_AUD, ORIGIN = env.ORIGIN;
const psqlArgs = ["-h", "127.0.0.1", "-p", env.PGPORT || "5432", "-U", "postgres", "-d", env.PGDATABASE, "-X", "-tA", "-c"];
const sql = (q) => execFileSync("psql", [...psqlArgs, q], { encoding: "utf8" }).trim();

const b64 = (s) => Buffer.from(s, "base64url");
function verify(tok) {
  const [h, p, s, extra] = String(tok || "").split(".");
  if (!s || extra !== undefined) throw new Error("malformed token");
  const want = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest();
  const got = b64(s);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw new Error("invalid token signature");
  const c = JSON.parse(b64(p).toString());
  if (c.exp <= Date.now() / 1000) throw new Error("token expired");
  if (c.aud !== AUD) throw new Error("token audience mismatch");
  return c;
}
function allows(c, e) {
  if (!Object.hasOwn(c.topics || {}, e.topic)) return false;
  const scopes = c.topics[e.topic];
  return scopes === null || (e.scope !== null && scopes.map(String).includes(e.scope));
}
function load(from, to) {
  return JSON.parse(sql(`select coalesce(json_agg(json_build_object('id', id, 'ts', ts, 'topic', topic, 'scope', scope,
     'table', table_name, 'op', op, 'pk', pk, 'changed', changed_columns) order by xid, id), '[]')
     from notify.events_between('${from}'::xid8, '${to}'::xid8)`));
}

let horizon = BigInt(sql("select notify.horizon()"));
const streams = new Set();

setInterval(() => {
  const h = BigInt(sql("select notify.horizon()"));
  if (h <= horizon) return;
  const evs = load(horizon, h);
  horizon = h;
  for (const s of streams) if (evs.some((e) => allows(s.claims, e))) s.res.write(`event: hint\ndata: {"cursor":"${h}"}\n\n`);
}, 300);

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const cors = { "Access-Control-Allow-Origin": ORIGIN, Vary: "Origin" };
  const send = (code, obj) => { res.writeHead(code, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...cors, "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "Authorization" });
    return res.end();
  }
  let claims;
  try {
    const bearer = (req.headers.authorization || "").replace(/^Bearer /, "");
    claims = verify(bearer || url.searchParams.get("token"));
  } catch (e) { return send(401, { error: e.message }); }

  if (url.pathname === "/events") {
    const c = url.searchParams.get("cursor");
    const out = (cursor, events, reset) => send(200, { cursor: String(cursor), more: false, reset, events });
    if (!c) return out(horizon, [], false);
    const cur = BigInt(c);
    const purged = BigInt(sql("select purged_below from notify.meta"));
    if (cur > horizon || cur < purged) return out(horizon, [], true);
    return out(horizon, load(cur, horizon).filter((e) => allows(claims, e)), false);
  }
  if (url.pathname === "/stream") {
    res.writeHead(200, { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    res.write(`event: hint\ndata: {"cursor":"${horizon}"}\n\n`);
    const s = { res, claims };
    streams.add(s);
    req.on("close", () => streams.delete(s));
    return;
  }
  send(404, { error: "not found" });
}).listen(Number(env.PORT || 8091), "127.0.0.1", () => console.log("notifyd-mock ready"));
