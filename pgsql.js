/* pgsql.js
   Minimal browser client for pgsql.php
   - No magic
   - No client-side auth
   - Session handled via cookies (fetch credentials: 'include')
*/
(function (global) {
  "use strict";

  function defaultBaseUrl() {
    // Default: pgsql.php in the same directory as this pgsql.js
    const cs = document.currentScript;
    if (!cs || !cs.src) return "pgsql.php";

    const url = new URL(cs.src, window.location.href);
    const path = url.pathname;
    const dir = path.slice(0, path.lastIndexOf("/") + 1);
    return dir + "pgsql.php";
  }

  function jsonHeaders(extra) {
    const h = { "Content-Type": "application/json; charset=utf-8" };
    if (extra && typeof extra === "object") {
      for (const k of Object.keys(extra)) h[k] = extra[k];
    }
    return h;
  }

  async function readJsonOrThrow(resp) {
    // If server returns non-JSON, this will throw. Good. Let it explode.
    const out = await resp.json();

    if (!resp.ok) {
      // Prefer server error payload when available
      const msg =
        out && typeof out === "object" && out.error
          ? String(out.error)
          : `HTTP ${resp.status} ${resp.statusText}`;
      const e = new Error(msg);
      e.status = resp.status;
      e.payload = out;
      throw e;
    }

    if (out && typeof out === "object" && out.error) {
      const e = new Error(String(out.error));
      e.status = resp.status;
      e.payload = out;
      throw e;
    }

    return out;
  }

  class Pgsql {
    constructor(opts) {
      const o = opts && typeof opts === "object" ? opts : {};

      this.baseUrl = typeof o.baseUrl === "string" && o.baseUrl.length
        ? o.baseUrl
        : defaultBaseUrl();

      // Optional headers (e.g., you might set X-Requested-With)
      this.headers = o.headers && typeof o.headers === "object" ? o.headers : null;

      // If you want to pin a connection id as “default” on client side too
      this.connId = typeof o.connId === "string" && o.connId.length ? o.connId : null;

      // Default application_name to help you see clients in pg_stat_activity
      this.applicationName =
        typeof o.applicationName === "string" && o.applicationName.length
          ? o.applicationName
          : null;
    }

    async request(action, payload, opts) {
      const p = payload && typeof payload === "object" ? payload : {};
      const o = opts && typeof opts === "object" ? opts : {};

      // Build request body
      const body = { action, ...p };

      // When caller did not pass conn_id, we may use pinned this.connId
      if (!("conn_id" in body) && this.connId) body.conn_id = this.connId;

      const resp = await fetch(this.baseUrl, {
        method: "POST",
        credentials: "include",
        headers: jsonHeaders(this.headers),
        body: JSON.stringify(body),
        signal: o.signal,
      });

      return readJsonOrThrow(resp);
    }

    // --- API methods ---

    async getProfiles(opts) {
      const out = await this.request("get_profiles", {}, opts);
      return out.data;
    }

    async connect(profileId, user, password, opts) {
      const o = opts && typeof opts === "object" ? opts : {};
      const credentials = {
        user: String(user),
        password: String(password),
      };

      if (this.applicationName && !("application_name" in (o.credentials || {}))) {
        credentials.application_name = this.applicationName;
      }

      // Allow per-call override/extra credentials (e.g. application_name)
      if (o.credentials && typeof o.credentials === "object") {
        for (const k of Object.keys(o.credentials)) credentials[k] = o.credentials[k];
      }

      const payload = {
        profile_id: String(profileId),
        credentials,
      };

      if (o.connId) payload.conn_id = String(o.connId);

      const out = await this.request("connect", payload, o);

      // Pin connId on client for convenience
      if (out && out.data && out.data.conn_id) this.connId = out.data.conn_id;

      return out.data;
    }

    async setRole(role, opts) {
      const payload = { role: role };
      const out = await this.request("set_role", payload, opts);
      return out.data;
    }

    async listRoles(opts) {
      const out = await this.request("list_roles", {}, opts);
      // backend returns JSON string (from json_build_object) or an object depending on pg behavior
      // If it is a string, parse it. If it is already object, return as-is.
      const d = out.data;
      if (typeof d === "string") return JSON.parse(d);
      return d;
    }

    // opts.params: optional array for $1, $2, ... placeholders (server uses pg_query_params)
    async query(sql, opts) {
      const payload = { sql: String(sql) };
      if (opts && Array.isArray(opts.params)) payload.params = opts.params;
      const out = await this.request("query", payload, opts);
      return out; // {data, meta}
    }

    // Token for the event daemon (notifyd): {token, url, exp}
    async eventToken(opts) {
      const out = await this.request("event_token", {}, opts);
      return out.data;
    }

    // Change feed: see EventFeed below and docs/EVENTS.md
    events(opts) {
      return new EventFeed(this, opts);
    }
  }

  /* EventFeed
     - polls notifyd every ~30 s (with jitter): this is the reliable path
     - optionally keeps an SSE stream open: a "hint" only triggers an immediate poll
     - events contain only what/where/when; re-read the data through pgsql.query()
     Usage:
       const feed = db.events({ onEvents: evs => ..., onReset: () => reloadAll() });
       await feed.start();
  */
  class EventFeed {
    constructor(pgsql, opts) {
      const o = opts && typeof opts === "object" ? opts : {};
      this.pgsql = pgsql;
      this.interval = typeof o.interval === "number" ? o.interval : 30000;
      this.jitter = typeof o.jitter === "number" ? o.jitter : 0.2;
      this.useStream = o.stream !== false && typeof EventSource === "function";
      this.connId = typeof o.connId === "string" ? o.connId : undefined;
      this.handlers = { events: [], reset: [], error: [] };
      if (typeof o.onEvents === "function") this.on("events", o.onEvents);
      if (typeof o.onReset === "function") this.on("reset", o.onReset);
      if (typeof o.onError === "function") this.on("error", o.onError);

      this.cursor = null;
      this.auth = null;      // {token, url, exp}
      this.timer = null;
      this.es = null;
      this.running = false;
      this.polling = null;   // promise of the poll in flight
      this.pollAgain = false;
      this.streamRetry = 1000;
    }

    on(type, fn) {
      (this.handlers[type] || (this.handlers[type] = [])).push(fn);
      return this;
    }

    off(type, fn) {
      const list = this.handlers[type];
      if (list) this.handlers[type] = list.filter((f) => f !== fn);
      return this;
    }

    _emit(type, arg) {
      for (const fn of this.handlers[type] || []) {
        try { fn(arg); } catch (e) { if (type !== "error") this._emit("error", e); }
      }
    }

    // Get the cursor FIRST, then load your data: changes made in between arrive as events.
    async start() {
      if (this.running) return this;
      this.running = true;
      await this._refreshToken();
      const first = await this._fetch(null);
      this.cursor = first.cursor;
      if (this.useStream) this._openStream();
      this._schedule();
      return this;
    }

    stop() {
      this.running = false;
      clearTimeout(this.timer);
      this.timer = null;
      if (this.es) { this.es.close(); this.es = null; }
    }

    // Poll now. Concurrent calls are merged into one follow-up poll.
    poll() {
      if (!this.running) return Promise.resolve();
      if (this.polling) { this.pollAgain = true; return this.polling; }
      this.polling = (async () => {
        try {
          do {
            this.pollAgain = false;
            let more = true;
            while (more && this.running) {
              const res = await this._fetch(this.cursor);
              if (res.reset) {
                this.cursor = res.cursor;
                this._emit("reset", res);
                break;
              }
              if (res.events.length) this._emit("events", res.events);
              this.cursor = res.cursor;
              more = res.more;
            }
          } while (this.pollAgain && this.running);
        } catch (e) {
          this._emit("error", e);
        } finally {
          this.polling = null;
          this._schedule();
        }
      })();
      return this.polling;
    }

    _schedule() {
      if (!this.running) return;
      clearTimeout(this.timer);
      const spread = 1 - this.jitter + Math.random() * 2 * this.jitter;
      this.timer = setTimeout(() => this.poll(), Math.max(1000, this.interval * spread));
    }

    async _refreshToken() {
      this.auth = await this.pgsql.eventToken(this.connId ? { connId: this.connId } : undefined);
      this.auth.url = new URL(this.auth.url, window.location.href).href.replace(/\/+$/, "");
    }

    async _fetch(cursor, retried) {
      if (!this.auth || this.auth.exp - 10 < Date.now() / 1000) await this._refreshToken();
      const q = cursor === null ? "" : "?cursor=" + encodeURIComponent(cursor);
      const resp = await fetch(this.auth.url + "/events" + q, {
        headers: { Authorization: "Bearer " + this.auth.token },
        cache: "no-store",
      });
      if (resp.status === 401 && !retried) {
        await this._refreshToken();
        return this._fetch(cursor, true);
      }
      const out = await resp.json();
      if (!resp.ok || out.error) {
        const e = new Error(out.error || `HTTP ${resp.status}`);
        e.status = resp.status;
        throw e;
      }
      return out;
    }

    _openStream() {
      if (!this.running || !this.useStream) return;
      const es = new EventSource(this.auth.url + "/stream?token=" + encodeURIComponent(this.auth.token));
      this.es = es;

      es.addEventListener("open", () => { this.streamRetry = 1000; });
      es.addEventListener("hint", (ev) => {
        let c;
        try { c = JSON.parse(ev.data).cursor; } catch (_) { return; }
        if (this.cursor === null || BigInt(c) > BigInt(this.cursor)) {
          // spread the load when thousands of clients get the same hint
          setTimeout(() => this.poll(), Math.random() * 300);
        }
      });
      const reopen = (delay) => {
        es.close();
        if (this.es === es) this.es = null;
        setTimeout(async () => {
          if (!this.running) return;
          try { await this._refreshToken(); this._openStream(); }
          catch (e) { this._emit("error", e); reopen(Math.min(this.streamRetry *= 2, 60000)); }
        }, delay);
      };
      es.addEventListener("expired", () => reopen(0));
      es.addEventListener("error", () => {
        // the daemon may be restarting, or the token expired; polling keeps working meanwhile
        if (es.readyState === EventSource.CLOSED || this.auth.exp - 10 < Date.now() / 1000) {
          reopen(this.streamRetry);
          this.streamRetry = Math.min(this.streamRetry * 2, 60000);
        }
      });
    }
  }

  // Friendly factory
  function createPgsql(opts) {
    return new Pgsql(opts);
  }

  // Export to window
  global.Pgsql = Pgsql;
  global.PgsqlEventFeed = EventFeed;
  global.createPgsql = createPgsql;
})(window);
