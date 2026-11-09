/* Campus Filing: accounts and saved plans, with Supabase stubbed.
   Run with: node tests-accounts.js   (no dependencies)

   What this checks is the part that would hurt if it were wrong: that a
   session can only ever live in an HttpOnly cookie, that another site
   cannot drive these endpoints, that Supabase's own error text never
   reaches a student, and that the server never tells the database whose
   rows to touch. Row Level Security decides that, and nothing here may
   pretend to. */

const assert = require("assert");
const path = require("path");

let calls = [];
let replies = [];

global.fetch = async function (url, init) {
  calls.push({ url: url, init: init, body: init && init.body ? JSON.parse(init.body) : undefined });
  const next = replies.shift() || { status: 500, body: {} };
  return {
    status: next.status,
    text: async function () { return next.body === undefined ? "" : JSON.stringify(next.body); }
  };
};

const auth = require(path.join(__dirname, "api", "auth.js"));
const plans = require(path.join(__dirname, "api", "plans.js"));

function jwt(secondsFromNow) {
  const b = function (o) { return Buffer.from(JSON.stringify(o)).toString("base64url"); };
  return b({ alg: "HS256" }) + "." + b({ exp: Math.floor(Date.now() / 1000) + secondsFromNow }) + ".sig";
}

function req(method, opts) {
  opts = opts || {};
  return {
    method: method,
    headers: Object.assign({ host: "campusfiling.vercel.app", "x-forwarded-proto": "https" }, opts.headers || {}),
    body: opts.body,
    query: opts.query || {}
  };
}

function res() {
  const r = { statusCode: 0, headers: {}, payload: null };
  r.setHeader = function (k, v) { r.headers[k.toLowerCase()] = v; };
  r.status = function (c) { r.statusCode = c; return r; };
  r.json = function (p) { r.payload = p; return r; };
  return r;
}

const ANSWERS = { version: 1, taxYear: 2026, savedAt: "2026-11-08T00:00:00Z",
  fields: { w2wage: "7840", age: "20" }, radios: { status: "citizen" }, checks: ["havedoc|w2"] };

let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

/* ---------- auth ---------- */

test("signing in sets HttpOnly, Secure, SameSite=Strict cookies scoped to /api", async function () {
  replies = [{ status: 200, body: { access_token: jwt(3600), refresh_token: "r1", expires_in: 3600, user: { email: "a@b.co" } } }];
  const r = res();
  await auth(req("POST", { body: { action: "signin", email: "A@B.co ", password: "longenough" } }), r);
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual(r.payload, { user: { email: "a@b.co", createdAt: null } });
  const cookies = r.headers["set-cookie"];
  assert.strictEqual(cookies.length, 2);
  cookies.forEach(function (c) {
    assert.ok(/HttpOnly/.test(c) && /Secure/.test(c) && /SameSite=Strict/.test(c) && /Path=\/api/.test(c), c);
  });
  assert.strictEqual(calls[0].body.email, "a@b.co", "email is trimmed and lowercased");
});

test("the token never appears in a response body", async function () {
  const token = jwt(3600);
  replies = [{ status: 200, body: { access_token: token, refresh_token: "r1", expires_in: 3600, user: { email: "a@b.co" } } }];
  const r = res();
  await auth(req("POST", { body: { action: "signin", email: "a@b.co", password: "longenough" } }), r);
  assert.ok(JSON.stringify(r.payload).indexOf(token) < 0);
  assert.ok(JSON.stringify(r.payload).indexOf("r1") < 0);
});

test("a wrong password gets a plain message, not Supabase's", async function () {
  replies = [{ status: 400, body: { error_code: "invalid_credentials", msg: "Invalid login credentials (internal detail)" } }];
  const r = res();
  await auth(req("POST", { body: { action: "signin", email: "a@b.co", password: "wrongpass" } }), r);
  assert.strictEqual(r.statusCode, 400);
  assert.strictEqual(r.payload.error, "That email and password do not match an account.");
  assert.strictEqual(r.headers["set-cookie"], undefined);
});

test("an unknown Supabase error is not forwarded verbatim", async function () {
  replies = [{ status: 422, body: { error_code: "something_new", msg: "relation auth.foo does not exist" } }];
  const r = res();
  await auth(req("POST", { body: { action: "signin", email: "a@b.co", password: "longenough" } }), r);
  assert.ok(r.payload.error.indexOf("relation") < 0);
});

test("a request from another site is refused before Supabase is called", async function () {
  calls = [];
  const r = res();
  await auth(req("POST", { headers: { origin: "https://evil.example" }, body: { action: "signout" } }), r);
  assert.strictEqual(r.statusCode, 403);
  assert.strictEqual(calls.length, 0);
});

test("signup with confirmation on asks the student to check their email", async function () {
  replies = [{ status: 200, body: { id: "u1", email: "a@b.co" } }];
  calls = [];
  const r = res();
  await auth(req("POST", { body: { action: "signup", email: "a@b.co", password: "longenough" } }), r);
  assert.deepStrictEqual(r.payload, { user: null, confirmEmail: true });
  assert.ok(calls[0].url.indexOf("redirect_to=" + encodeURIComponent("https://campusfiling.vercel.app/account.html")) > -1);
});

test("short passwords are refused without calling Supabase", async function () {
  calls = [];
  const r = res();
  await auth(req("POST", { body: { action: "signup", email: "a@b.co", password: "short" } }), r);
  assert.strictEqual(r.statusCode, 400);
  assert.strictEqual(calls.length, 0);
});

test("a password reset always reports success, so it cannot reveal who has an account", async function () {
  replies = [{ status: 400, body: { error_code: "user_not_found" } }];
  const r = res();
  await auth(req("POST", { body: { action: "recover", email: "nobody@b.co" } }), r);
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual(r.payload, { sent: true });
});

test("an expired access token is refreshed and the new cookies are set", async function () {
  replies = [
    { status: 200, body: { access_token: jwt(3600), refresh_token: "r2", expires_in: 3600 } },
    { status: 200, body: { email: "a@b.co", created_at: "2026-11-08" } }
  ];
  calls = [];
  const r = res();
  await auth(req("GET", { headers: { cookie: "cf_at=" + jwt(-10) + "; cf_rt=r1" } }), r);
  assert.ok(calls[0].url.indexOf("grant_type=refresh_token") > -1);
  assert.strictEqual(calls[0].body.refresh_token, "r1");
  assert.strictEqual(r.payload.user.email, "a@b.co");
  assert.ok(r.headers["set-cookie"][1].indexOf("cf_rt=r2") === 0);
});

test("a revoked refresh token signs the student out cleanly", async function () {
  replies = [{ status: 400, body: { error_code: "refresh_token_not_found" } }];
  const r = res();
  await auth(req("GET", { headers: { cookie: "cf_rt=old" } }), r);
  assert.deepStrictEqual(r.payload, { user: null });
  assert.ok(r.headers["set-cookie"].every(function (c) { return /Max-Age=0/.test(c); }));
});

test("deleting an account needs an explicit confirm", async function () {
  calls = [];
  const r = res();
  await auth(req("POST", { headers: { cookie: "cf_at=" + jwt(3600) }, body: { action: "delete" } }), r);
  assert.strictEqual(r.statusCode, 400);
  assert.strictEqual(calls.length, 0);
});

test("deleting an account calls delete_my_account with the student's own token", async function () {
  const token = jwt(3600);
  replies = [{ status: 204 }];
  calls = [];
  const r = res();
  await auth(req("POST", { headers: { cookie: "cf_at=" + token }, body: { action: "delete", confirm: "delete" } }), r);
  assert.ok(calls[0].url.endsWith("/rest/v1/rpc/delete_my_account"));
  assert.strictEqual(calls[0].init.headers.Authorization, "Bearer " + token);
  assert.strictEqual(r.payload.deleted, true);
});

test("adopting a link checks the token with Supabase before trusting it", async function () {
  replies = [{ status: 401, body: {} }];
  const r = res();
  await auth(req("POST", { body: { action: "adopt", access_token: jwt(3600), refresh_token: "r" } }), r);
  assert.strictEqual(r.statusCode, 400);
  assert.strictEqual(r.headers["set-cookie"], undefined);
});

/* ---------- plans ---------- */

test("plans without a session answer 401 and never reach Supabase", async function () {
  calls = [];
  const r = res();
  await plans(req("GET"), r);
  assert.strictEqual(r.statusCode, 401);
  assert.strictEqual(calls.length, 0);
});

test("saving never sends a user_id; the database fills it from the token", async function () {
  replies = [{ status: 201, body: [{ updated_at: "2026-11-08T12:00:00Z" }] }];
  calls = [];
  const r = res();
  await plans(req("PUT", { headers: { cookie: "cf_at=" + jwt(3600) }, body: { answers: ANSWERS } }), r);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(calls[0].body.user_id, undefined);
  assert.strictEqual(calls[0].body.tax_year, 2026);
  assert.ok(calls[0].url.indexOf("on_conflict=user_id,tax_year") > -1);
  assert.ok(/merge-duplicates/.test(calls[0].init.headers.Prefer));
});

test("a user_id smuggled into the answers is dropped", async function () {
  replies = [{ status: 201, body: [{}] }];
  calls = [];
  const sneaky = Object.assign({}, ANSWERS, { user_id: "someone-else", extra: "x" });
  await plans(req("PUT", { headers: { cookie: "cf_at=" + jwt(3600) }, body: { answers: sneaky, user_id: "someone-else" } }), res());
  assert.strictEqual(calls[0].body.user_id, undefined);
  assert.strictEqual(calls[0].body.answers.user_id, undefined);
  assert.strictEqual(calls[0].body.answers.extra, undefined);
});

test("answers that are not the walkthrough's shape are refused", async function () {
  calls = [];
  const bad = [
    { version: 2, taxYear: 2026, fields: {}, radios: {}, checks: [] },
    { version: 1, taxYear: "next year", fields: {}, radios: {}, checks: [] },
    { version: 1, taxYear: 2026, fields: { a: { nested: true } }, radios: {}, checks: [] },
    { version: 1, taxYear: 2026, fields: { a: "x".repeat(70000) }, radios: {}, checks: [] }
  ];
  for (const a of bad) {
    const r = res();
    await plans(req("PUT", { headers: { cookie: "cf_at=" + jwt(3600) }, body: { answers: a } }), r);
    assert.strictEqual(r.statusCode, 400, JSON.stringify(a).slice(0, 60));
  }
  assert.strictEqual(calls.length, 0);
});

test("opening and deleting a plan need a real tax year", async function () {
  calls = [];
  for (const y of ["", "2026; drop table", "1999", "20260"]) {
    const r = res();
    await plans(req("DELETE", { headers: { cookie: "cf_at=" + jwt(3600) }, query: { year: y } }), r);
    assert.strictEqual(r.statusCode, 400, y);
  }
  assert.strictEqual(calls.length, 0);
});

test("listing plans returns years and dates, not answers", async function () {
  replies = [{ status: 200, body: [{ tax_year: 2026, updated_at: "2026-11-08T12:00:00Z" }] }];
  calls = [];
  const r = res();
  await plans(req("GET", { headers: { cookie: "cf_at=" + jwt(3600) } }), r);
  assert.ok(calls[0].url.indexOf("select=tax_year,updated_at") > -1);
  assert.deepStrictEqual(r.payload, { plans: [{ taxYear: 2026, updatedAt: "2026-11-08T12:00:00Z" }] });
});

test("a cross-site save is refused", async function () {
  calls = [];
  const r = res();
  await plans(req("PUT", { headers: { cookie: "cf_at=" + jwt(3600), origin: "https://evil.example" }, body: { answers: ANSWERS } }), r);
  assert.strictEqual(r.statusCode, 403);
  assert.strictEqual(calls.length, 0);
});

test("no response is cacheable", async function () {
  const r = res();
  await plans(req("GET"), r);
  assert.strictEqual(r.headers["cache-control"], "no-store");
});

test("the service role key is nowhere in the API code", async function () {
  const fs = require("fs");
  ["_supabase.js", "auth.js", "plans.js"].forEach(function (f) {
    const src = fs.readFileSync(path.join(__dirname, "api", f), "utf8");
    assert.ok(!/sb_secret_|service_role\s*[:=]|SUPABASE_SERVICE/i.test(src), f);
  });
});

/* ---------- the endpoints that spend money ---------- */

const readDoc = require(path.join(__dirname, "api", "read-document.js"));
const guide = require(path.join(__dirname, "api", "filing-guide.js"));

test("the document reader refuses a caller with no session", async function () {
  const r = res();
  await readDoc(req("POST", { body: { text: "Wages, tips 12000" } }), r);
  assert.strictEqual(r.statusCode, 401, "anonymous callers must not reach Anthropic");
  assert.strictEqual(r.payload.signin, true);
  assert.strictEqual(calls.length, 0, "no upstream call may be made for an anonymous caller");
});

test("the filing guide refuses a caller with no session", async function () {
  const r = res();
  await guide(req("POST", { body: { situation: { wages: 1 }, software: "freetaxusa" } }), r);
  assert.strictEqual(r.statusCode, 401);
  assert.strictEqual(calls.length, 0);
});

test("neither endpoint leaks why it refused", async function () {
  const r = res();
  await readDoc(req("POST", { body: { text: "x" } }), r);
  assert.ok(!/token|cookie|supabase/i.test(JSON.stringify(r.payload)), r.payload.error);
});

/* ---------- who may hold an account ---------- */

test("a non-GW signup is refused in words a student can act on", async function () {
  replies = [{ status: 500, body: { msg: 'Database error saving new user: Campus Filing accounts are limited to GW email addresses.' } }];
  const r = res();
  await auth(req("POST", { body: { action: "signup", email: "someone@gmail.com", password: "longenough" } }), r);
  assert.ok(/limited to GW email addresses/.test(r.payload.error), r.payload.error);
  assert.ok(/gwmail\.gwu\.edu/.test(r.payload.error), "it should name the address to use");
});

test("a GW signup is not blocked by the client", async function () {
  replies = [{ status: 200, body: { access_token: jwt(3600), refresh_token: "r1", expires_in: 3600, user: { email: "d@gwmail.gwu.edu" } } }];
  const r = res();
  await auth(req("POST", { body: { action: "signup", email: "D@gwmail.gwu.edu", password: "longenough" } }), r);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.payload.user.email, "d@gwmail.gwu.edu");
});

/* The staff list lives in the database, not here, so the API must not
   second-guess an address it does not recognise. Supabase decides. */
test("the API does not pre-reject an address that may be an invited staff account", async function () {
  replies = [{ status: 200, body: { access_token: jwt(3600), refresh_token: "r1", expires_in: 3600, user: { email: "kahdelina@gmail.com" } } }];
  const r = res();
  await auth(req("POST", { body: { action: "signup", email: "kahdelina@gmail.com", password: "longenough" } }), r);
  assert.strictEqual(r.statusCode, 200, "a staff invite must be allowed through to the database");
});

/* ---------- the reporting boundary ---------- */

test("the schema never grants an administrator a read on saved_plans", function () {
  const fs = require("fs");
  const roles = fs.readFileSync(path.join(__dirname, "supabase", "roles.sql"), "utf8");
  assert.ok(!/grant[^;]*\bon\s+public\.saved_plans\b[^;]*to[^;]*(university_admin|tax_operations)/i.test(roles),
    "reporting must go through the aggregate function, never a row read");
  assert.ok(/institution_usage\(\)/.test(roles), "the aggregate function must exist");
  assert.ok(/raise exception 'not permitted'/.test(roles), "it must refuse a student caller");
});

test("the signup trigger and the profile trigger both pin search_path", function () {
  const fs = require("fs");
  const roles = fs.readFileSync(path.join(__dirname, "supabase", "roles.sql"), "utf8");
  const definers = roles.match(/security definer[^$]*/gi) || [];
  assert.ok(definers.length >= 4, "expected several definer functions, found " + definers.length);
  definers.forEach(function (d) {
    assert.ok(/set search_path = ''/.test(d), "a definer function is missing search_path: " + d.slice(0, 60));
  });
});

(async function () {
  for (const t of tests) {
    calls = []; replies = [];
    try { await t.fn(); passed++; }
    catch (e) { console.log("FAIL  " + t.name + "\n      " + (e.message || e)); }
  }
  console.log(passed + " passed, " + (tests.length - passed) + " failed");
  process.exit(passed === tests.length ? 0 : 1);
})();
