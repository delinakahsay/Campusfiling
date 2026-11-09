/* Campus Filing: accounts.

   GET  /api/auth                       who is signed in, or { user: null }
   POST /api/auth  { action: ... }

     signup    email, password    create an account
     signin    email, password    sign in
     signout                      end this session
     adopt     access_token, refresh_token
                                  finish a confirmation or reset link
     recover   email              send a password reset link
     password  password           set a new password while signed in
     delete                       delete the account and everything saved

   An account is optional. The walkthrough works without one, and the only
   thing an account adds is somewhere to keep answers between visits. */

const sb = require("./_supabase.js");

const MIN_PASSWORD = 8;
const MAX_FIELD = 320;

function validEmail(email) {
  return typeof email === "string" && email.length <= MAX_FIELD && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validPassword(password) {
  return typeof password === "string" && password.length >= MIN_PASSWORD && password.length <= 72;
}

function publicUser(user) {
  if (!user) return null;
  return { email: user.email || "", createdAt: user.created_at || null };
}

/* Where confirmation and reset links send people back to. It must be on
   the Supabase redirect allow list, which holds the production domain. */
function returnUrl(req) {
  return encodeURIComponent(sb.siteOrigin(req) + "/account.html");
}

/* The role travels with the identity, because every page that cares who
   is looking also cares what they are allowed to see, and a second round
   trip to find out would show the wrong navigation first and correct it
   a moment later. Resolved by the database, never by anything the
   browser sends. */
async function roleFor(token) {
  const r = await sb.call("/rest/v1/rpc/my_role", { method: "POST", token: token, body: {} });
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  if (r.status !== 200 || !row) return { role: "student", institution: null, name: null };
  return {
    role: typeof row.role === "string" ? row.role : "student",
    institution: typeof row.institution === "string" ? row.institution : null,
    name: typeof row.full_name === "string" ? row.full_name : null
  };
}

async function whoami(req, res) {
  const token = await sb.sessionToken(req, res);
  if (!token) return sb.send(res, 200, { user: null });
  const r = await sb.call("/auth/v1/user", { token: token });
  if (r.status === 200) {
    const who = publicUser(r.data);
    const extra = await roleFor(token);
    who.role = extra.role;
    who.institution = extra.institution;
    who.name = extra.name;
    return sb.send(res, 200, { user: who });
  }
  if (r.status === 401 || r.status === 403 || r.status === 404) {
    sb.clearSession(res);
    return sb.send(res, 200, { user: null });
  }
  return sb.send(res, 503, { error: sb.authMessage(r) });
}

const ACTIONS = {
  async signup(req, res, body) {
    const email = String(body.email || "").trim().toLowerCase();
    if (!validEmail(email)) return sb.send(res, 400, { error: "Enter a valid email address." });
    if (!validPassword(body.password)) return sb.send(res, 400, { error: "Choose a password of at least " + MIN_PASSWORD + " characters." });

    /* The name is carried as sign-up metadata, which the profile trigger
       reads when it creates the row. Optional: a student who leaves it
       blank gets a working account and initials drawn from their
       address instead. */
    const name = String(body.name || "").trim().slice(0, 80);

    const r = await sb.call("/auth/v1/signup?redirect_to=" + returnUrl(req), {
      method: "POST",
      body: name
        ? { email: email, password: body.password, data: { full_name: name } }
        : { email: email, password: body.password }
    });
    if (r.status !== 200) return sb.send(res, r.status === 0 ? 503 : 400, { error: sb.authMessage(r) });

    /* With email confirmation on, Supabase returns the new user and no
       session. With it off, it signs them straight in. */
    if (r.data && r.data.access_token) {
      sb.setSession(res, r.data);
      return sb.send(res, 200, { user: publicUser(r.data.user) });
    }
    return sb.send(res, 200, { user: null, confirmEmail: true });
  },

  async signin(req, res, body) {
    const email = String(body.email || "").trim().toLowerCase();
    if (!validEmail(email) || typeof body.password !== "string" || !body.password) {
      return sb.send(res, 400, { error: "Enter your email and password." });
    }
    const r = await sb.call("/auth/v1/token?grant_type=password", {
      method: "POST", body: { email: email, password: body.password }
    });
    if (r.status !== 200 || !r.data || !r.data.access_token) {
      return sb.send(res, r.status === 0 ? 503 : 400, { error: sb.authMessage(r) });
    }
    sb.setSession(res, r.data);
    return sb.send(res, 200, { user: publicUser(r.data.user) });
  },

  /* A student correcting their own name. The database function decides
     whose row that is, so there is no user id to pass and none to get
     wrong. The role and institution are not editable here by design: a
     student who could change either would be granting themselves
     access. */
  async name(req, res, body) {
    if (!sb.sameOrigin(req)) return sb.send(res, 403, { error: "That request did not come from this site." });
    const token = await sb.requireSession(req, res);
    if (!token) return;

    const value = String(body.name || "").trim().slice(0, 80);
    const r = await sb.call("/rest/v1/rpc/set_my_name", {
      method: "POST", token: token, body: { new_name: value }
    });
    if (r.status !== 200) {
      return sb.send(res, r.status === 0 ? 503 : 400, { error: "That name could not be saved." });
    }
    return sb.send(res, 200, { name: value || null });
  },

  async signout(req, res) {
    const token = await sb.sessionToken(req, res);
    if (token) await sb.call("/auth/v1/logout?scope=local", { method: "POST", token: token });
    sb.clearSession(res);
    return sb.send(res, 200, { user: null });
  },

  /* A confirmation or reset link lands on account.html with the tokens in
     the URL fragment, which never reaches a server. The page posts them
     here once, they are checked with Supabase, and from then on they live
     only in HttpOnly cookies. */
  async adopt(req, res, body) {
    const access = body.access_token, refresh = body.refresh_token;
    if (typeof access !== "string" || typeof refresh !== "string" || access.length > 4096 || refresh.length > 512) {
      return sb.send(res, 400, { error: "That link is incomplete. Request a new one." });
    }
    const r = await sb.call("/auth/v1/user", { token: access });
    if (r.status !== 200) return sb.send(res, 400, { error: "That link has expired or was already used. Request a new one." });
    sb.setSession(res, { access_token: access, refresh_token: refresh, expires_in: Math.max(60, sb.secondsLeft(access)) });
    return sb.send(res, 200, { user: publicUser(r.data) });
  },

  /* Always reports success, so the form cannot be used to find out which
     emails have accounts. */
  async recover(req, res, body) {
    const email = String(body.email || "").trim().toLowerCase();
    if (!validEmail(email)) return sb.send(res, 400, { error: "Enter a valid email address." });
    const r = await sb.call("/auth/v1/recover?redirect_to=" + returnUrl(req), { method: "POST", body: { email: email } });
    if (r.status === 429) return sb.send(res, 429, { error: sb.authMessage(r) });
    return sb.send(res, 200, { sent: true });
  },

  async password(req, res, body) {
    if (!validPassword(body.password)) return sb.send(res, 400, { error: "Choose a password of at least " + MIN_PASSWORD + " characters." });
    const token = await sb.sessionToken(req, res);
    if (!token) return sb.send(res, 401, { error: "Your session has ended. Sign in again." });
    const r = await sb.call("/auth/v1/user", { method: "PUT", token: token, body: { password: body.password } });
    if (r.status !== 200) return sb.send(res, r.status === 0 ? 503 : 400, { error: sb.authMessage(r) });
    return sb.send(res, 200, { user: publicUser(r.data) });
  },

  /* delete_my_account() runs in Postgres as the table owner, deletes the
     row in auth.users for whoever called it, and the foreign key takes
     every saved plan with it. No service key involved. */
  async delete(req, res, body) {
    if (body.confirm !== "delete") return sb.send(res, 400, { error: "Confirm before deleting." });
    const token = await sb.sessionToken(req, res);
    if (!token) return sb.send(res, 401, { error: "Your session has ended. Sign in again." });
    const r = await sb.call("/rest/v1/rpc/delete_my_account", { method: "POST", token: token, body: {} });
    if (r.status !== 200 && r.status !== 204) {
      return sb.send(res, 503, { error: "Your account could not be deleted just now. Nothing was removed. Try again in a moment." });
    }
    sb.clearSession(res);
    return sb.send(res, 200, { user: null, deleted: true });
  }
};

module.exports = async function handler(req, res) {
  if (req.method === "GET") return whoami(req, res);
  if (req.method !== "POST") return sb.send(res, 405, { error: "GET or POST only." });
  if (!sb.sameOrigin(req)) return sb.send(res, 403, { error: "Requests from other sites are refused." });

  const body = sb.parseBody(req);
  if (!body) return sb.send(res, 400, { error: "Send JSON." });
  const action = Object.prototype.hasOwnProperty.call(ACTIONS, body.action) ? ACTIONS[body.action] : null;
  if (!action) return sb.send(res, 400, { error: "Unknown action." });
  return action(req, res, body);
};
