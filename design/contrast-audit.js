/* Rendered-contrast auditor for the comps.
   Run through the Playwright CLI against a served comp:

     playwright-cli -s=<session> --raw eval "$(cat design/contrast-audit.js)"

   It walks every element that paints text, resolves the real background by
   climbing to the first non-transparent ancestor, and reports every pair that
   falls under its WCAG threshold (4.5:1 normal text, 3:1 for >=24px or
   >=18.66px bold). Output is JSON: { checked, failures: [...] }.            */
(() => {
  const lin = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lum = ([r, g, b]) => 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);
  const parse = s => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const bgOf = el => {
    let n = el;
    let acc = null;
    while (n && n !== document.documentElement.parentNode) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) {
        acc = acc === null ? c.rgb : over(acc, c.rgb, 1);
        if (c.a >= 1) return c.rgb;
      }
      n = n.parentElement;
    }
    return [255, 255, 255];
  };
  const out = [];
  let checked = 0;
  document.querySelectorAll("body *").forEach(el => {
    if (el.closest(".comp-switch")) return;
    const txt = [...el.childNodes]
      .filter(n => n.nodeType === 3 && n.textContent.trim())
      .map(n => n.textContent.trim())
      .join(" ");
    if (!txt) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const fg = parse(cs.color);
    if (!fg) return;
    const bg = bgOf(el);
    const eff = fg.a < 1 ? over(fg.rgb, bg, fg.a) : fg.rgb;
    const px = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = px >= 24 || (bold && px >= 18.66);
    const need = large ? 3 : 4.5;
    const got = ratio(eff, bg);
    checked++;
    if (got < need) {
      out.push({
        text: txt.slice(0, 48),
        sel: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""),
        fg: cs.color, bg: `rgb(${bg.map(Math.round).join(", ")})`,
        px: Math.round(px), got: +got.toFixed(2), need
      });
    }
  });
  return JSON.stringify({ checked, failures: out }, null, 1);
})()
