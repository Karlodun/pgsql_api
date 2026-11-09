// End-to-end test in a real browser: pgsql.php session + roles + event feed (SSE and polling) + RLS re-read.
// Run through tests/run-e2e.sh, which starts PostgreSQL fixtures, php -S and the notifyd mock.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

// require() honours NODE_PATH (global installs), ESM import does not
const { chromium } = createRequire(import.meta.url)("playwright");

const PAGE = process.env.PAGE_URL || "http://localhost:8080/tests/e2e.html";
const psqlAs = (user, q) =>
  execFileSync("psql", ["-h", "127.0.0.1", "-p", process.env.PGPORT, "-U", user, "-d", process.env.PGDATABASE, "-X", "-tA", "-c", q], { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(page, fn, arg, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn, arg)) return Date.now() - t0;
    await sleep(50);
  }
  throw new Error("timeout waiting for: " + fn.toString());
}

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log("  ok  ", name); }
  catch (e) { failures++; console.log("  FAIL", name, "\n       ", e.message); }
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("   [browser]", m.text()); });
await page.goto(PAGE);

await page.evaluate(async () => {
  window.db = createPgsql({ baseUrl: "/pgsql.php" });
  window.info = await db.connect("test", "alice", "alice");
});

await test("connect returns session user", async () => {
  const info = await page.evaluate(() => window.info);
  assert.equal(info.session_user, "alice");
});

await test("query with params ($1)", async () => {
  const r = await page.evaluate(() => db.query("select $1::int + 1 as v, $2::text as t", { params: [41, "x"] }));
  assert.deepEqual(r.data, [{ v: "42", t: "x" }]);
});

await test("set_role persists across requests (was a bug)", async () => {
  const r = await page.evaluate(async () => {
    await db.setRole("crm_readonly");
    const a = (await db.query("select current_user as u")).data[0].u;
    await db.setRole(null);
    const b = (await db.query("select current_user as u")).data[0].u;
    return [a, b];
  });
  assert.deepEqual(r, ["crm_readonly", "alice"]);
});

await test("set_role to a foreign role is refused by PostgreSQL", async () => {
  const msg = await page.evaluate(() => db.setRole("bob").then(() => "accepted", (e) => e.message));
  assert.match(msg, /permission denied/);
});

await test("CSRF: non-JSON content type is rejected", async () => {
  const st = await page.evaluate(() =>
    fetch("/pgsql.php", { method: "POST", credentials: "include", headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "query", sql: "select 1" }) }).then((r) => r.status));
  assert.equal(st, 415);
});

await test("event_token carries claims computed by PostgreSQL", async () => {
  const claims = await page.evaluate(async () => {
    const t = await db.eventToken();
    return JSON.parse(atob(t.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  });
  assert.equal(claims.sub, "alice");
  assert.deepEqual(claims.topics, { "crm.customer": ["1"] });
});

// Feed 1: SSE hint path. Poll interval 60 s, so anything fast must come through the hint.
// Feed 2: polling only, every 1.5 s.
await page.evaluate(async () => {
  window.got = { sse: [], poll: [] };
  window.rows = [];
  window.resets = 0;
  const reload = async () => { window.rows = (await db.query("select id, tenant_id, name, note from crm.customer order by id")).data; };
  window.feedSse = db.events({ interval: 60000, onEvents: (evs) => { window.got.sse.push(...evs); reload(); } });
  window.feedPoll = db.events({ interval: 1500, jitter: 0, stream: false, onEvents: (evs) => window.got.poll.push(...evs), onReset: () => window.resets++ });
  await feedSse.start();
  await feedPoll.start();
});
await sleep(500);

await test("change by another user arrives via SSE hint (<2 s) and data is re-read", async () => {
  psqlAs("alice", "insert into crm.customer (tenant_id, name) values (1, 'Acme')");
  const ms = await until(page, () => window.rows.some((r) => r.name === "Acme"), null, 2000);
  const ev = await page.evaluate(() => window.got.sse.at(-1));
  assert.equal(ev.op, "INSERT");
  assert.equal(ev.topic, "crm.customer");
  assert.equal(ev.scope, "1");
  assert.ok(ev.pk.id > 0 && ev.ts, "pk and ts present");
  assert.equal(ev.name, undefined, "no row content in events");
  console.log("        (arrived after", ms, "ms)");
});

await test("other tenant's change is not delivered (claims scope) and not readable (RLS)", async () => {
  psqlAs("bob", "insert into crm.customer (tenant_id, name) values (2, 'BobCorp')");
  psqlAs("alice", "update crm.customer set note = 'vip' where name = 'Acme'");
  await until(page, () => window.got.sse.some((e) => e.op === "UPDATE"));
  const r = await page.evaluate(() => ({ scopes: window.got.sse.map((e) => e.scope), names: window.rows.map((x) => x.name) }));
  assert.ok(r.scopes.every((s) => s === "1"), "only tenant 1 events: " + r.scopes);
  assert.ok(!r.names.includes("BobCorp"));
});

await test("UPDATE reports changed columns", async () => {
  const ev = await page.evaluate(() => window.got.sse.find((e) => e.op === "UPDATE"));
  assert.deepEqual(ev.changed, ["note"]);
});

await test("polling-only feed receives the same events", async () => {
  await until(page, () => window.got.poll.length >= 2, null, 4000);
  const r = await page.evaluate(() => [window.got.sse.map((e) => e.id), window.got.poll.map((e) => e.id)]);
  assert.deepEqual(r[1], r[0]);
});

await test("long transaction: events are held back, nothing is lost", async () => {
  const before = await page.evaluate(() => window.got.sse.length);
  const slow = new Promise((resolve) => {
    import("node:child_process").then(({ execFile }) =>
      execFile("psql", ["-h", "127.0.0.1", "-p", process.env.PGPORT, "-U", "alice", "-d", process.env.PGDATABASE, "-X", "-c",
        "begin; select pg_current_xact_id(); select pg_sleep(0.5); insert into crm.customer (tenant_id, name) values (1, 'Slow'); select pg_sleep(1.5); commit;"], resolve));
  });
  await sleep(1000);
  psqlAs("alice", "insert into crm.customer (tenant_id, name) values (1, 'Fast')");
  await sleep(600);
  const mid = await page.evaluate(() => window.got.sse.length);
  assert.equal(mid, before, "Fast must wait for the older open transaction");
  await slow;
  await until(page, (n) => window.got.sse.length >= n + 2, before);
  await until(page, () => ["Slow", "Fast"].every((n) => window.rows.some((r) => r.name === n)));
});

await test("cursor older than retention -> reset", async () => {
  await page.evaluate(() => feedPoll.stop());
  psqlAs("postgres", "select notify.purge('0 seconds')");
  const r = await page.evaluate(async () => {
    feedPoll.cursor = "1";
    feedPoll.running = true;
    await feedPoll.poll();
    feedPoll.stop();
    return window.resets;
  });
  assert.equal(r, 1);
});

await page.evaluate(() => { feedSse.stop(); feedPoll.stop(); });
await browser.close();
console.log(failures ? `\n${failures} test(s) FAILED` : "\nall e2e tests passed");
process.exit(failures ? 1 : 0);
