/* Campus Filing: the one place that talks to Anthropic.

   Both endpoints need the same four things and all four were learned the
   hard way during setup, so they live here rather than in two copies that
   drift:

     which environment variable holds the key
     whether the key needs a workspace named alongside it
     that forced tool choice is not accepted by every model
     that an upstream error must never be forwarded verbatim

   A leading underscore keeps Vercel from serving this as a route. */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5-5";
const TIMEOUT_MS = 90000;

function model() {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

/* Either name works. ANTHROPIC_API_KEY is what Anthropic's own tooling
   uses and is the one to prefer, but ANTHROPIC_KEY is a natural thing to
   type and getting it wrong costs a deploy and a confusing 503. */
function apiKey() {
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY || "";
}

/* A key created at the organization level is not tied to a workspace, and
   Anthropic rejects those unless the request names one. A key created
   inside a workspace carries it already and needs nothing here. */
function workspaceId() {
  return process.env.ANTHROPIC_WORKSPACE_ID || "";
}

/* The structured answer arrives as a tool_use block when the model calls
   the tool, which is the normal path. When it answers in prose instead,
   the JSON object is usually still in the text, so that is tried before
   giving up. Pinning this to one response shape would make the feature
   break on a model change rather than on anything real. */
function resultFrom(payload, toolName) {
  const blocks = (payload && payload.content) || [];

  const used = blocks.filter(function (b) {
    return b.type === "tool_use" && b.name === toolName && b.input;
  })[0];
  if (used) return used.input;

  const text = blocks.filter(function (b) { return b.type === "text"; })
    .map(function (b) { return b.text || ""; }).join("\n");
  if (!text) return null;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!candidate) return null;

  try {
    const parsed = JSON.parse(candidate);
    return (parsed && typeof parsed === "object") ? parsed : null;
  } catch (e) { return null; }
}

/* Messages that name the actual fix rather than saying something broke.
   `detail` is Anthropic's own wording, passed in only for the statuses
   that describe the key, the model or the shape of the call. */
function messageFor(status, detail) {
  if (status === 400 && /workspace/i.test(detail || "")) {
    return "The API key is not scoped to a workspace. Either set ANTHROPIC_WORKSPACE_ID on this deployment, or create the key inside a workspace in the Anthropic Console.";
  }
  const byStatus = {
    400: "Anthropic rejected the request. This is a bug in the deployment, not in your answers.",
    401: "The API key is not valid. Check ANTHROPIC_API_KEY on this deployment.",
    403: "The API key is not permitted to do this. Check its permissions and that the account is in good standing.",
    404: "This deployment is configured for a model the key cannot reach: " + model() + ". Set ANTHROPIC_MODEL to one the account has access to.",
    413: "That was too large to send.",
    429: "Rate limited right now. Try again in a moment.",
    529: "Anthropic is overloaded right now. Try again in a moment."
  };
  return byStatus[status] || "The request failed. Try again, or carry on without this step.";
}

/* Returns { ok: true, result } or { ok: false, status, body }.
   The caller sends body as-is; it never contains upstream text. */
async function callAnthropic(options) {
  if (!apiKey()) {
    return { ok: false, status: 503, body: {
      error: "This feature is not configured on this deployment. Set ANTHROPIC_API_KEY (or ANTHROPIC_KEY) and redeploy."
    } };
  }

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, options.timeoutMs || TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: Object.assign({
        "content-type": "application/json",
        "x-api-key": apiKey(),
        "anthropic-version": API_VERSION
      }, workspaceId() ? { "anthropic-workspace-id": workspaceId() } : {}),
      body: JSON.stringify({
        model: model(),
        max_tokens: options.maxTokens || 2000,
        system: options.system,
        tools: [options.tool],
        /* Forced tool choice is not accepted by every model, so the tool
           is offered and the system prompt asks for it. */
        tool_choice: { type: "auto" },
        messages: options.messages
      })
    });
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, status: 504, body: {
      error: (e && e.name === "AbortError")
        ? "That took too long and was stopped. Try again."
        : "Could not reach Anthropic. Try again in a moment."
    } };
  }
  clearTimeout(timer);

  if (!upstream.ok) {
    /* The upstream body can echo request content, so it is never
       forwarded. The status and the error category describe the key, the
       model or the shape of the call, never anything a student typed. */
    let category = "", detail = "";
    try {
      const err = await upstream.json();
      category = (err && err.error && err.error.type) || "";
      if ([400, 401, 403, 404].indexOf(upstream.status) > -1) {
        detail = String((err && err.error && err.error.message) || "").slice(0, 300);
      }
    } catch (e) { /* nothing to add */ }

    console.error("anthropic upstream " + upstream.status + " " + category +
      (detail ? ": " + detail : "") + " (model " + model() + ")");

    return { ok: false, status: upstream.status === 429 ? 429 : 502, body: {
      error: messageFor(upstream.status, detail),
      upstreamStatus: upstream.status,
      category: category,
      detail: detail
    } };
  }

  let payload;
  try { payload = await upstream.json(); }
  catch (e) { return { ok: false, status: 502, body: { error: "Anthropic returned something unreadable." } }; }

  /* A truncated answer is the dangerous case. The tool block still
     arrives and still parses, it is simply missing most of what was
     asked for, and the caller has no way to tell that from a short
     answer. One run of the guide came back with a headline and zero
     steps, and the page rendered an empty guide rather than an error.
     So truncation is reported as a failure here. */
  if (payload && payload.stop_reason === "max_tokens") {
    console.error("anthropic truncated at max_tokens (model " + model() + ")");
    return { ok: false, status: 502, body: {
      error: "The answer was cut off before it finished. Try again.",
      truncated: true
    } };
  }

  const result = resultFrom(payload, options.tool.name);
  if (!result) {
    return { ok: false, status: 502, body: { error: "Anthropic did not return a result in the expected shape." } };
  }

  return { ok: true, result: result, stopReason: payload && payload.stop_reason };
}

module.exports = { callAnthropic, resultFrom, messageFor, apiKey, workspaceId, model };
