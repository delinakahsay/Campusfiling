/* Campus Filing: seats and the subscription, for a university.

   GET  /api/institution          the subscription and the seat roster
   POST /api/institution { userId, suspend }   release or restore a seat

   The university administrator's two jobs that are not reporting. The
   database decides who may call this and which institution they govern,
   reading both from the caller's profile row, so nothing this file
   forwards can widen the answer.

   What comes back names people but knows nothing about their taxes. The
   roster carries an address, a join date and whether the seat is active,
   and no column that could say whether that person saved a plan. The
   counts live in /api/usage, which names nobody. An administrator
   holding both still cannot learn that a named student used a tax
   service, because neither query returns the other's column and neither
   can be joined to the other from their session. */

const sb = require("./_supabase.js");

module.exports = async function handler(req, res) {
  const token = await sb.requireSession(req, res);
  if (!token) return;

  if (req.method === "GET") {
    const detail = await sb.call("/rest/v1/rpc/my_institution", {
      method: "POST", token: token, body: {}
    });
    if (detail.status === 400 || detail.status === 403) {
      return sb.send(res, 403, { error: "This page is for Campus Filing staff." });
    }
    if (detail.status !== 200) {
      return sb.send(res, detail.status === 0 ? 503 : 502, {
        error: "The subscription could not be loaded."
      });
    }

    const roster = await sb.call("/rest/v1/rpc/institution_roster", {
      method: "POST", token: token, body: {}
    });
    if (roster.status !== 200) {
      return sb.send(res, roster.status === 0 ? 503 : 502, {
        error: "The student list could not be loaded."
      });
    }

    const rows = Array.isArray(detail.data) ? detail.data : [];
    res.setHeader("Cache-Control", "no-store");
    return sb.send(res, 200, {
      institutions: rows.map(function (row) {
        return {
          institution: String(row.institution || ""),
          enrollment: row.enrollment === null ? null : Number(row.enrollment),
          seats: row.seats === null ? null : Number(row.seats),
          pricePerStudent: row.price_per_student === null ? null : Number(row.price_per_student),
          termStart: row.term_start || null,
          termEnd: row.term_end || null,
          seatsUsed: Number(row.seats_used || 0)
        };
      }),
      students: (Array.isArray(roster.data) ? roster.data : []).map(function (row) {
        return {
          userId: String(row.user_id || ""),
          email: String(row.email || ""),
          joined: row.joined || null,
          suspended: row.suspended === true
        };
      })
    });
  }

  if (req.method !== "POST") {
    return sb.send(res, 405, { error: "GET or POST." });
  }
  if (!sb.sameOrigin(req)) {
    return sb.send(res, 403, { error: "That request did not come from this site." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== "object") {
    return sb.send(res, 400, { error: "Body was not JSON." });
  }

  const userId = String(body.userId || "");
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    return sb.send(res, 400, { error: "That is not a student account." });
  }
  if (typeof body.suspend !== "boolean") {
    return sb.send(res, 400, { error: "Say whether to release or restore the seat." });
  }

  const r = await sb.call("/rest/v1/rpc/set_student_access", {
    method: "POST", token: token,
    body: { target: userId, suspend: body.suspend }
  });
  if (r.status !== 200 && r.status !== 204) {
    const text = JSON.stringify(r.data || {});
    if (text.indexOf("not permitted") > -1) {
      return sb.send(res, 403, { error: "You can only manage seats at your own institution." });
    }
    return sb.send(res, r.status === 0 ? 503 : 502, { error: "That change could not be saved." });
  }
  return sb.send(res, 200, { saved: true, suspended: body.suspend });
};
