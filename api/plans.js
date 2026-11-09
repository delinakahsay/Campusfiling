/* Campus Filing: saved plans.

   GET    /api/plans             the signed-in student's plans, one per tax year
   GET    /api/plans?year=2026   that year's answers
   PUT    /api/plans             { answers }  save, replacing that year's copy
   DELETE /api/plans?year=2026   delete that year

   What is stored is exactly what "Save my answers to a file" writes:
   the walkthrough's own answers object. Uploaded documents are never in
   it, and there is no field for a name, Social Security number,
   employer or address, so there is nothing of that kind to store.

   Every request carries the student's own token, and Row Level Security
   on saved_plans means Postgres returns and changes only their rows.
   This file does not filter by user at all, on purpose: if it did, a
   mistake here could leak data. The database is the only place the rule
   lives. */

const sb = require("./_supabase.js");

const MAX_BYTES = 60000;
const SAVE_VERSION = 1;

function yearFrom(value) {
  const n = parseInt(value, 10);
  return String(n) === String(value).trim() && n >= 2020 && n <= 2100 ? n : null;
}

/* What the plan concluded, captured by the walkthrough when the student
   saved it. Validated to a fixed shape rather than stored as whatever
   arrived, because it is rendered straight onto a page: a string that
   got here by another route should not be able to put anything into the
   account view. Every field is optional, so an older save without a
   summary is not an error, it just shows less. */
function cleanSummary(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return null;
  const str = function (v, max) {
    return typeof v === "string" && v.length <= (max || 160) ? v : null;
  };
  const list = function (v, max) {
    return Array.isArray(v)
      ? v.slice(0, 12).filter(function (x) { return str(x, max || 200); })
      : [];
  };
  const out = {
    refund: typeof s.refund === "number" && isFinite(s.refund) ? Math.round(s.refund) : null,
    mustFile: typeof s.mustFile === "boolean" ? s.mustFile : null,
    dependency: str(s.dependency, 60),
    income: typeof s.income === "number" && isFinite(s.income) ? Math.round(s.income) : null,
    standardDeduction: typeof s.standardDeduction === "number" && isFinite(s.standardDeduction)
      ? Math.round(s.standardDeduction) : null,
    returns: str(s.returns, 160),
    software: str(s.software, 60),
    educationCredit: str(s.educationCredit, 60),
    steps: list(s.steps, 220),
    documents: list(s.documents, 120)
  };
  return JSON.stringify(out).length <= 6000 ? out : null;
}

/* The same shape answersToObject() in wizard.js writes, and nothing else. */
function cleanAnswers(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return null;
  if (a.version !== SAVE_VERSION) return null;
  const year = yearFrom(a.taxYear);
  if (!year) return null;
  const isMap = function (m) {
    return m && typeof m === "object" && !Array.isArray(m) &&
      Object.keys(m).every(function (k) { return k.length <= 64 && typeof m[k] === "string" && m[k].length <= 500; });
  };
  if (!isMap(a.fields) || !isMap(a.radios)) return null;
  if (!Array.isArray(a.checks) || !a.checks.every(function (c) { return typeof c === "string" && c.length <= 130; })) return null;
  const clean = { version: SAVE_VERSION, taxYear: year, savedAt: new Date().toISOString(),
    fields: a.fields, radios: a.radios, checks: a.checks };
  return JSON.stringify(clean).length <= MAX_BYTES ? clean : null;
}

function failed(res, r) {
  if (r.status === 401 || r.status === 403) return sb.send(res, 401, { error: "Your session has ended. Sign in again." });
  return sb.send(res, 503, { error: "Saved plans could not be reached just now. Try again in a moment." });
}

module.exports = async function handler(req, res) {
  if (["GET", "PUT", "DELETE"].indexOf(req.method) < 0) return sb.send(res, 405, { error: "GET, PUT or DELETE only." });
  if (req.method !== "GET" && !sb.sameOrigin(req)) return sb.send(res, 403, { error: "Requests from other sites are refused." });

  const token = await sb.sessionToken(req, res);
  if (!token) return sb.send(res, 401, { error: "Sign in to use saved plans.", signedOut: true });

  const query = req.query || {};

  if (req.method === "GET" && query.year === undefined) {
    const r = await sb.call("/rest/v1/saved_plans?select=tax_year,updated_at,summary&order=tax_year.desc", { token: token });
    if (r.status !== 200) return failed(res, r);
    return sb.send(res, 200, { plans: (r.data || []).map(function (p) {
      return { taxYear: p.tax_year, updatedAt: p.updated_at };
    }) });
  }

  if (req.method === "GET" || req.method === "DELETE") {
    const year = yearFrom(query.year);
    if (!year) return sb.send(res, 400, { error: "Name a tax year." });

    if (req.method === "GET") {
      const r = await sb.call("/rest/v1/saved_plans?select=answers,updated_at,summary&tax_year=eq." + year, { token: token });
      if (r.status !== 200) return failed(res, r);
      if (!r.data || !r.data.length) return sb.send(res, 404, { error: "There is no saved plan for " + year + "." });
      return sb.send(res, 200, { answers: r.data[0].answers, summary: r.data[0].summary || null, updatedAt: r.data[0].updated_at });
    }

    const r = await sb.call("/rest/v1/saved_plans?tax_year=eq." + year, {
      method: "DELETE", token: token, headers: { Prefer: "return=minimal" }
    });
    if (r.status !== 204 && r.status !== 200) return failed(res, r);
    return sb.send(res, 200, { deleted: year });
  }

  /* PUT */
  const body = sb.parseBody(req);
  const answers = body && cleanAnswers(body.answers);
  if (!answers) return sb.send(res, 400, { error: "Those answers were not written by this walkthrough. Nothing was saved." });

  /* user_id is not sent. The column defaults to auth.uid(), and the
     insert policy rejects any row whose user_id is not the caller's. */
  const r = await sb.call("/rest/v1/saved_plans?on_conflict=user_id,tax_year", {
    method: "POST", token: token,
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: { tax_year: answers.taxYear, answers: answers, summary: cleanSummary(body && body.summary) }
  });
  if (r.status !== 201 && r.status !== 200) return failed(res, r);
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  return sb.send(res, 200, { taxYear: answers.taxYear, updatedAt: row && row.updated_at });
};
