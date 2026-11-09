/* Campus Filing: per-institution usage, for staff.

   GET /api/usage   counts for the caller's institution, or every
                    institution when the caller is tax operations.

   This file sends no identity and no institution of its own. It calls
   one database function with the caller's token, and that function
   reads the role from the caller's profile and decides both whether to
   answer and how much to return. Everything a browser could tamper with
   is therefore irrelevant to the answer.

   What comes back is counts. There is no query here that could return a
   student's answers even if someone asked it to, because the function
   returns aggregates and an administrator's session has no read on any
   other student's row to fall back on. */

const sb = require("./_supabase.js");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sb.send(res, 405, { error: "GET only." });
  }

  const token = await sb.requireSession(req, res);
  if (!token) return;

  const r = await sb.call("/rest/v1/rpc/institution_usage", {
    method: "POST", token: token, body: {}
  });

  /* The function raises for a student rather than returning an empty
     set, so that a caller who should not be here gets a refusal rather
     than a report that happens to be blank. Postgres surfaces that as a
     400, which is translated here rather than passed on: the raw text
     names the function and the role system, which is not a student's
     business. */
  if (r.status === 400 || r.status === 403) {
    const text = JSON.stringify(r.data || {});
    if (text.indexOf("not permitted") > -1) {
      return sb.send(res, 403, { error: "This page is for Campus Filing staff." });
    }
    if (text.indexOf("not signed in") > -1) {
      return sb.send(res, 401, { error: "Sign in to use this.", signin: true });
    }
  }
  if (r.status !== 200) {
    return sb.send(res, r.status === 0 ? 503 : 502, {
      error: "The reporting service did not respond. Try again in a moment."
    });
  }

  const rows = Array.isArray(r.data) ? r.data : [];
  res.setHeader("Cache-Control", "no-store");
  return sb.send(res, 200, {
    institutions: rows.map(function (row) {
      return {
        institution: String(row.institution || ""),
        students: Number(row.students || 0),
        plans: Number(row.plans || 0),
        documentsRead: Number(row.documents_read || 0),
        lastActivity: row.last_activity || null
      };
    })
  });
};
