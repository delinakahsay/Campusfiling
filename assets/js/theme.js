/* Campus Filing: theme.

   Loaded in the head, before anything paints, so a dark theme does not
   arrive as a white flash. It is small on purpose for that reason.

   The system preference decides by default. The control in the footer
   overrides it, and that choice is the only thing this site keeps in
   browser storage. Every read and write is guarded, because storage
   throws rather than returning null in a private window with site data
   blocked, and a theme preference is not worth breaking a page over. */

(function () {
  const KEY = "campusfiling-theme";
  const root = document.documentElement;

  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { saved = null; }
  if (saved === "dark" || saved === "light") root.setAttribute("data-theme", saved);

  function current() {
    const set = root.getAttribute("data-theme");
    if (set) return set;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" : "light";
  }

  function wire() {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;

    function label() {
      const dark = current() === "dark";
      btn.textContent = dark ? "Switch to light" : "Switch to dark";
      btn.setAttribute("aria-pressed", dark ? "true" : "false");
    }

    label();

    btn.addEventListener("click", function () {
      const next = current() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* nothing to do */ }
      label();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
