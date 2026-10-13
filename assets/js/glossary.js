/* Glossary filter. The guides hub invites people to look something up,
   so there has to be something to look up with. Plain substring match
   across both the term and its definition. */
(function () {
  const input = document.getElementById("term-filter");
  const list = document.getElementById("terms");
  const count = document.getElementById("term-count");
  if (!input || !list) return;

  const pairs = [];
  let dt = null;
  Array.from(list.children).forEach(function (el) {
    if (el.tagName === "DT") dt = el;
    else if (el.tagName === "DD" && dt) { pairs.push([dt, el]); dt = null; }
  });

  function apply() {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    pairs.forEach(function (pair) {
      const hit = !q || (pair[0].textContent + " " + pair[1].textContent).toLowerCase().indexOf(q) > -1;
      pair[0].hidden = !hit;
      pair[1].hidden = !hit;
      if (hit) shown++;
    });
    count.textContent = q
      ? shown + (shown === 1 ? " term matches " : " terms match ") + '"' + input.value.trim() + '"'
      : pairs.length + " terms";
  }

  input.addEventListener("input", apply);
  apply();
})();
