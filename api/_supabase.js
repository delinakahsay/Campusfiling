/* Campus Filing: the one place that talks to Supabase.

   The browser never calls Supabase directly. vercel.json sets
   connect-src 'self', so a page here can only talk to this domain, and
   loosening that to let a login form reach another domain would weaken
   the promise the rest of the site keeps. So sign-in, sign-out and saved
   plans go through /api/auth and /api/plans, and those call Supabase
   from the server. Same pattern as the Anthropic reader.

   Only the publishable key is used. It is safe in code because every
   table has Row Level Security, and every data request carries the
   student's own access token, so Postgres itself decides which rows they
   can see. The service role key bypasses all of that and must never
   appear here, in Vercel, or in the repository.

   Sessions live in two cookies, both HttpOnly so page script cannot read
   them, Secure, SameSite=Strict, and scoped to /api so static pages never
   carry them. A leading underscore keeps Vercel from serving this file as
   a route. */

/* Public configuration, not secrets. The environment variables win when
   they are set (Production has them); the fallbacks let preview
   deployments work, since Vercel only gave the variables to Production. */
const FALLBACK_URL = "https://tkldxfpzfmbojfxujlkx.supabase.co";
const FALLBACK_KEY = "sb_publishable_Fbd1oYJfTjk1o5GLndyvbw_PG_QKz4O";

const TIMEOUT_MS = 15000;
const ACCESS_COOKIE = "cf_at";
const REFRESH_COOKIE = "cf_rt";
const REFRESH_DAYS = 30;

function supabaseUrl() {
  return (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_URL).replace(/\/+$/, "");
}

function publishableKey() {
  return process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_KEY;
}

/* One request to Supabase. Never throws: a network failure or timeout
   comes back as status 0 so callers handle every failure in one place. */
async function call(path, options) {
  options = options || {};
  const headers = Object.assign({
    apikey: publishableKey(),
    "Content-Type": "application/json"
  }, options.headers || {});
  if (options.token) headers.Authorization = "Bearer " + options.token;

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  try {
    const res = await fetch(supabaseUrl() + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    return { status: res.status, data: data };
  } catch (e) {
    return { status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

/* Supabase's own error text is never forwarded. It can name internals,
   and it is written for developers. These are written for a student. */
function authMessage(result) {
  const d = result.data || {};
  const code = d.error_code || d.code || d.error || "";

  /* A database trigger refuses signups from outside a GW domain. Its
     message is already written for a student to read, so pass it through
     rather than letting it fall to the generic failure at the bottom,
     which would tell them to check what they entered when the address is
     fine and simply not eligible. */
  const text = [d.msg, d.message, d.error_description, d.error]
    .filter(function (v) { return typeof v === "string"; }).join(" ");
  if (text.indexOf("limited to GW email addresses") > -1) {
    return "Campus Filing accounts are limited to GW email addresses. Use your @gwu.edu or @gwmail.gwu.edu address.";
  }
  const MESSAGES = {
    invalid_credentials: "That email and password do not match an account.",
    invalid_grant: "That email and password do not match an account.",
    email_not_confirmed: "Confirm your email first. The link is in the message we sent when you created the account.",
    user_already_exists: "An account with that email already exists. Sign in instead.",
    email_exists: "An account with that email already exists. Sign in instead.",
    weak_password: "Choose a longer password. It needs at least 8 characters.",
    email_address_invalid: "Enter a valid email address.",
    validation_failed: "Check the email and password and try again.",
    over_email_send_rate_limit: "Too many emails have been sent in the last hour. Try again later.",
    over_request_rate_limit: "Too many attempts. Wait a minute and try again.",
    signup_disabled: "New accounts are turned off right now.",
    same_password: "Your new password has to be different from the old one.",
    session_not_found: "Your session has ended. Sign in again.",
    refresh_token_not_found: "Your session has ended. Sign in again."
  };
  if (MESSAGES[code]) return MESSAGES[code];
  if (result.status === 0) return "The account service did not respond. Try again in a moment.";
  if (result.status === 429) return MESSAGES.over_request_rate_limit;
  if (result.status >= 500) return "The account service is having trouble. Try again in a moment.";
  return "That did not work. Check what you entered and try again.";
}

/* ---------- cookies ---------- */

function readCookies(req) {
  const out = {};
  String((req.headers && req.headers.cookie) || "").split(";").forEach(function (part) {
    const i = part.indexOf("=");
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function cookie(name, value, maxAge) {
  return name + "=" + encodeURIComponent(value) +
    "; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=" + Math.max(0, Math.floor(maxAge));
}

function setSession(res, session) {
  res.setHeader("Set-Cookie", [
    cookie(ACCESS_COOKIE, session.access_token, session.expires_in || 3600),
    cookie(REFRESH_COOKIE, session.refresh_token, REFRESH_DAYS * 86400)
  ]);
}

function clearSession(res) {
  res.setHeader("Set-Cookie", [cookie(ACCESS_COOKIE, "", 0), cookie(REFRESH_COOKIE, "", 0)]);
}

/* Seconds until the token expires, read from the JWT itself. Not a
   signature check: Supabase verifies the token on every request, so this
   only decides whether to refresh before using it. */
function secondsLeft(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload.exp - Math.floor(Date.now() / 1000);
  } catch (e) {
    return -1;
  }
}

/* The access token for this request, refreshed if it is about to expire.
   Returns null when nobody is signed in. Sets new cookies on refresh, and
   clears them when the refresh token is no longer valid. */
async function sessionToken(req, res) {
  const jar = readCookies(req);
  const access = jar[ACCESS_COOKIE];
  if (access && secondsLeft(access) > 30) return access;

  const refresh = jar[REFRESH_COOKIE];
  if (!refresh) return null;

  const r = await call("/auth/v1/token?grant_type=refresh_token", {
    method: "POST", body: { refresh_token: refresh }
  });
  if (r.status === 200 && r.data && r.data.access_token) {
    setSession(res, r.data);
    return r.data.access_token;
  }
  if (r.status >= 400 && r.status < 500) clearSession(res);
  return null;
}

/* ---------- request guards ---------- */

/* Cross-site requests are refused. SameSite=Strict already keeps the
   cookies off them; this is the second lock, and it costs one line. */
function sameOrigin(req) {
  const origin = req.headers && req.headers.origin;
  if (!origin) return true;
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  try { return new URL(origin).host === host; } catch (e) { return false; }
}

function siteOrigin(req) {
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  return proto + "://" + host;
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { return null; }
  }
  return body && typeof body === "object" ? body : null;
}

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

module.exports = {
  call, authMessage, sessionToken, setSession, clearSession, readCookies,
  sameOrigin, siteOrigin, parseBody, send, secondsLeft, supabaseUrl, publishableKey,
  requireSession, recordDocumentRead
};

/* The two endpoints that call Anthropic are the only ones that cost real
   money per request, which makes them the only ones worth shutting to
   strangers. Returns the caller's token, or sends the refusal and returns
   null, in which case the handler should return immediately. */
async function requireSession(req, res) {
  const token = await sessionToken(req, res);
  if (!token) {
    send(res, 401, { error: "Sign in to use this.", signin: true });
    return null;
  }
  return token;
}

/* One row per read, for the per-institution counts. It records that a
   read happened and nothing about what the document said, so the
   reporting table never becomes a second copy of anyone's tax data.
   Failure here is ignored on purpose: a student's document should not
   fail to be read because a counter could not be written. */
async function recordDocumentRead(token, kind) {
  try {
    await call("/rest/v1/document_reads", {
      method: "POST", token: token, body: { kind: kind }
    });
  } catch (e) {
    console.error("document_reads insert failed:", e && e.message);
  }
}
