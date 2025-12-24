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

    async query(sql, opts) {
      const payload = { sql: String(sql) };
      const out = await this.request("query", payload, opts);
      return out; // {data, meta}
    }
  }

  // Friendly factory
  function createPgsql(opts) {
    return new Pgsql(opts);
  }

  // Export to window
  global.Pgsql = Pgsql;
  global.createPgsql = createPgsql;
})(window);
