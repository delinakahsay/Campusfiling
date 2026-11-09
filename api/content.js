/* Campus Filing: editable site text and figure overrides.

   GET  /api/content                 everything, for any visitor
   POST /api/content { slot, content }          save a piece of page text
   POST /api/content { figure: {year, name, value} }   save a figure

   Reading is open because the content is public page text: the pages
   that render it are open to signed-out visitors, so the endpoint that
   feeds them is too. Writing is decided in the database, which reads
   the caller's role from their profile row; this file forwards the
   student's token and nothing else, so there is nothing here for a
   crafted request to impersonate. The write functions also record who
   saved each change and when, which is the audit line the dashboard and
   the write-up lean on. */

const sb = require("./_supabase.js");

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    /* No caller token: these rows are public page text, read as the anon
       role. The key goes in both headers because that is how Supabase's
       own client sends it, and PostgREST reads the role from the second. */
    const anon = { headers: { Authorization: "Bearer " + sb.publishableKey() } };
    const slots = await sb.call("/rest/v1/site_content?select=slot,content", anon);
    const figures = await sb.call(
      "/rest/v1/tax_figure_overrides?select=tax_year,figure,value,updated_by,updated_at", anon);
    if (slots.status !== 200 || figures.status !== 200) {
      return sb.send(res, 503, { error: "Site content could not be loaded." });
    }

    const map = {};
    (Array.isArray(slots.data) ? slots.data : []).forEach(function (row) {
      if (typeof row.slot === "string" && typeof row.content === "string") {
        map[row.slot] = row.content;
      }
    });

    res.setHeader("Cache-Control", "no-store");
    return sb.send(res, 200, {
      slots: map,
      figures: (Array.isArray(figures.data) ? figures.data : []).map(function (row) {
        return {
          taxYear: Number(row.tax_year),
          figure: String(row.figure || ""),
          value: Number(row.value),
          updatedBy: row.updated_by || null,
          updatedAt: row.updated_at || null
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

  const token = await sb.requireSession(req, res);
  if (!token) return;

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== "object") {
    return sb.send(res, 400, { error: "Body was not JSON." });
  }

  /* One figure. */
  if (body.figure && typeof body.figure === "object") {
    const f = body.figure;
    const year = Number(f.year);
    const value = f.value === null ? null : Number(f.value);
    if (!Number.isInteger(year) || typeof f.name !== "string" ||
        (value !== null && (!isFinite(value) || value < 0))) {
      return sb.send(res, 400, { error: "That figure did not make sense." });
    }
    const r = await sb.call("/rest/v1/rpc/set_tax_figure", {
      method: "POST", token: token,
      body: { figure_year: year, figure_name: f.name, figure_value: value }
    });
    if (r.status !== 200 && r.status !== 204) {
      const text = JSON.stringify(r.data || {});
      if (text.indexOf("not permitted") > -1) {
        return sb.send(res, 403, { error: "Only the tax content manager can change figures." });
      }
      if (text.indexOf("not editable") > -1) {
        return sb.send(res, 400, { error: "That figure is not editable here." });
      }
      return sb.send(res, r.status === 0 ? 503 : 502, { error: "That change could not be saved." });
    }
    return sb.send(res, 200, { saved: true });
  }

  /* One piece of page text. */
  const slot = String(body.slot || "");
  if (!/^[a-z0-9:-]{1,80}$/.test(slot)) {
    return sb.send(res, 400, { error: "That part of the page is not editable." });
  }
  const content = typeof body.content === "string" ? body.content : "";
  if (content.length > 2000) {
    return sb.send(res, 413, { error: "That text is longer than a single block takes." });
  }

  const r = await sb.call("/rest/v1/rpc/set_site_content", {
    method: "POST", token: token,
    body: { slot_name: slot, new_content: content }
  });
  if (r.status !== 200 && r.status !== 204) {
    const text = JSON.stringify(r.data || {});
    if (text.indexOf("not permitted") > -1) {
      return sb.send(res, 403, { error: "Only the tax content manager can change the site's text." });
    }
    return sb.send(res, r.status === 0 ? 503 : 502, { error: "That change could not be saved." });
  }
  return sb.send(res, 200, { saved: true });
};
