(function () {
  "use strict";

  var data = window.SCHOLAR;
  var PAGE = 10;
  var YEARS_SHOWN = 8; // citations chart shows the most recent years only
  var SELF = /\b(D\.?\s?R\.?\s?Amancio|Diego R(?:aphael|\.)? Amancio|DR Amancio)\b/g;
  // Scholar entries hidden from the list: the PhD thesis and its duplicate (ids from the Scholar URLs).
  var EXCLUDE = ["BUYA1_V_uYcC", "M3NEmzRMIkIC"];
  // Proper nouns kept capitalized when titles are converted to sentence case.
  var PROPER = ["Brazil", "Brazilian", "Portuguese", "English", "Voynich", "Wikipedia", "Caatinga", "Leopardus"];
  var PROPER_PHRASES = ["Chamber of Deputies", "Brazilian Congress", "Chemistry of Materials"];
  // Papers in the top share by citations per year since publication get a highlight.
  var TOP_SHARE = 0.10;
  var TOP_MIN_CITES = 10;

  // Mobile menu
  var btn = document.querySelector(".menu-btn");
  var nav = document.getElementById("nav");
  btn.addEventListener("click", function () {
    var open = nav.classList.toggle("open");
    btn.setAttribute("aria-expanded", open);
  });
  nav.addEventListener("click", function (e) {
    if (e.target.tagName === "A") { nav.classList.remove("open"); btn.setAttribute("aria-expanded", false); }
  });
  document.getElementById("year").textContent = new Date().getFullYear();

  if (!data || !data.publications) {
    document.getElementById("pub-list").innerHTML =
      '<li class="muted">The publication list is syncing from <a href="https://scholar.google.com/citations?user=WHdCNq0AAAAJ&hl=en">Google Scholar</a>.</li>';
    return;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(n) { return Number(n).toLocaleString("en-US"); }

  // "Clustering Algorithms: A Comparative Approach" -> "Clustering algorithms: a comparative approach".
  // Acronyms and mixed-case words (GANs, GraphRAG, 2D) and known proper nouns are left untouched.
  function sentenceCase(title) {
    var out = title.split(" ").map(function (word, i) {
      // Hyphenated words are handled part by part ("Network-Based" -> "Network-based", "AI-assisted" stays).
      return word.split("-").map(function (w, j) {
        var letters = w.replace(/[^A-Za-zÀ-ÿ]/g, "");
        if (/\d/.test(w) || /[A-ZÀ-Þ]/.test(letters.slice(1)) || PROPER.indexOf(letters) >= 0) return w;
        var lower = w.toLowerCase();
        return i === 0 && j === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
      }).join("-");
    }).join(" ");
    PROPER_PHRASES.forEach(function (phrase) { out = out.replace(new RegExp(phrase, "gi"), phrase); });
    return out;
  }

  var pubs = data.publications.filter(function (p) {
    return !EXCLUDE.some(function (id) { return p.url.indexOf(":" + id) >= 0; });
  }).map(function (p) {
    var copy = {};
    for (var k in p) copy[k] = p[k];
    copy.title = sentenceCase(p.title);
    copy.rate = citesPerYear(p);
    return copy;
  });

  // Age-normalized impact: citations per year since mid-publication-year (at least half a year).
  function citesPerYear(p) {
    if (!p.year || !p.citations) return 0;
    var now = new Date();
    var nowYears = now.getFullYear() + (now - new Date(now.getFullYear(), 0, 1)) / 31557600000;
    return p.citations / Math.max(0.5, nowYears - (p.year + 0.5));
  }
  (function markTop() {
    var cited = pubs.filter(function (p) { return p.rate > 0; }).sort(function (a, b) { return b.rate - a.rate; });
    var n = Math.max(1, Math.round(cited.length * TOP_SHARE));
    cited.slice(0, n).forEach(function (p) { if (p.citations >= TOP_MIN_CITES) p.top = true; });
  })();
  function fill(attr, values) {
    Object.keys(values).forEach(function (k) {
      var el = document.querySelector("[" + attr + '="' + k + '"]');
      if (el) el.textContent = fmt(values[k]);
    });
  }

  // Metrics (all time and, where the page has the column, the recent window)
  var m = data.metrics;
  fill("data-m", { citations: m.citations.all, h: m.h_index.all, i10: m.i10_index.all, pubs: pubs.length });
  fill("data-mr", { citations: m.citations.recent, h: m.h_index.recent, i10: m.i10_index.recent });
  var sinceLabel = document.getElementById("since-label");
  if (sinceLabel && m.since_year) sinceLabel.textContent = "Since " + m.since_year;

  var updated = new Date(data.updated_at);
  document.getElementById("updated").innerHTML =
    'Synced from <a href="' + esc(data.profile_url) + '" target="_blank" rel="noopener">Google Scholar</a> on ' +
    updated.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) + ".";

  var interestsEl = document.getElementById("interests");
  if (interestsEl && data.interests && data.interests.length) {
    interestsEl.innerHTML = data.interests.map(function (t) {
      return "<li>" + esc(t) + "</li>";
    }).join("");
  }

  // Citations-per-year chart: journal-style bars with a value axis and light gridlines.
  function niceStep(max, ticks) {
    var rough = max / ticks;
    var mag = Math.pow(10, Math.floor(Math.log10(rough)));
    var norm = rough / mag;
    return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  }

  // Linear year-end projection for the current year, based on the date of the last Scholar sync.
  // Skipped early in the year, when a few weeks of data would make it unreliable.
  function projectYearEnd(row) {
    var asOf = new Date(data.updated_at);
    if (!row || row.year !== asOf.getFullYear()) return 0;
    var start = new Date(row.year, 0, 1), end = new Date(row.year + 1, 0, 1);
    var frac = (asOf - start) / (end - start);
    return frac >= 0.15 && frac < 1 ? Math.round(row.count / frac) : 0;
  }

  function chart() {
    var rows = (data.citations_per_year || []).slice(-YEARS_SHOWN);
    var el = document.getElementById("cites-chart");
    if (!el || !rows.length) return;
    var W = el.clientWidth || 640, H = 250, top = 14, bottom = 28, left = 42, right = 4;
    var plotH = H - top - bottom;
    var max = Math.max.apply(null, rows.map(function (r) { return r.count; }));
    var thisYear = new Date().getFullYear();
    var projected = projectYearEnd(rows[rows.length - 1]);
    if (projected) max = Math.max(max, projected);
    var step = niceStep(max, 4);
    var niceMax = Math.ceil(max / step) * step;
    var slot = (W - left - right) / rows.length;
    var bw = Math.min(46, slot * 0.58);
    var y = function (v) { return top + plotH * (1 - v / niceMax); };

    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '">' +
      '<defs><pattern id="cites-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<rect class="hatch-bg" width="5" height="5"/><line class="hatch-line" x1="0" y1="0" x2="0" y2="5"/></pattern></defs>';
    for (var t = 0; t <= niceMax; t += step) {
      svg += '<line class="' + (t === 0 ? "baseline" : "grid") + '" x1="' + left + '" x2="' + (W - right) + '" y1="' + y(t) + '" y2="' + y(t) + '"/>' +
        '<text class="ylab" x="' + (left - 8) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + fmt(t) + "</text>";
    }
    var labelEvery = slot < 34 ? 2 : 1;
    rows.forEach(function (r, i) {
      var cx = left + slot * i + slot / 2, x = cx - bw / 2, yy = y(r.count), h = H - bottom - yy;
      var partial = r.year === thisYear;
      var proj = partial && projected > r.count;
      svg += "<g" + (partial ? ' class="partial"' : "") + ">" +
        '<rect class="bar-hit" tabindex="0" x="' + (cx - slot / 2) + '" y="' + top + '" width="' + slot + '" height="' + plotH + '">' +
        "<title>" + r.year + ": " + fmt(r.count) + " citations" + (partial ? " (year to date)" : "") +
        (proj ? "; projected ≈ " + fmt(projected) + " by year end" : "") + "</title></rect>" +
        '<rect class="bar" x="' + x + '" y="' + yy + '" width="' + bw + '" height="' + Math.max(h, 0) + '" rx="1.5"/>' +
        (proj ? '<rect class="proj" x="' + x + '" y="' + y(projected) + '" width="' + bw + '" height="' + (yy - y(projected)) + '" rx="1.5"/>' +
          '<text class="proj-val" x="' + cx + '" y="' + (y(projected) - 6) + '" text-anchor="middle">≈' + fmt(projected) + "</text>" : "") +
        '<text class="val" x="' + cx + '" y="' + (yy - 6) + '" text-anchor="middle">' + fmt(r.count) + "</text></g>";
      if (i % labelEvery === 0 || i === rows.length - 1) {
        svg += '<text class="axis" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + r.year + "</text>";
      }
    });
    svg += "</svg>";
    el.innerHTML = svg;

    var lastYear = rows[rows.length - 1].year;
    var caption = document.querySelector(".chart-card figcaption");
    if (caption) {
      caption.innerHTML = '<span class="chart-title">Citations per year, ' + rows[0].year + "–" + lastYear + "</span>" +
        (lastYear === thisYear ? '<span class="chart-legend"><i class="swatch swatch-partial"></i>' + lastYear + " to date" +
          (projected ? '<i class="swatch swatch-proj"></i>Projected year end' : "") + "</span>" : "");
    }
  }
  chart();
  var lastWidth = window.innerWidth;
  window.addEventListener("resize", function () {
    if (window.innerWidth !== lastWidth) { lastWidth = window.innerWidth; chart(); }
  });

  // Publication list
  var list = document.getElementById("pub-list");
  var search = document.getElementById("pub-search");
  var yearSel = document.getElementById("pub-year");
  var sortSel = document.getElementById("pub-sort");
  var moreBtn = document.getElementById("pub-more");
  var countEl = document.getElementById("pub-count");
  var showAll = false;

  var years = [];
  pubs.forEach(function (p) { if (p.year && years.indexOf(p.year) < 0) years.push(p.year); });
  years.sort(function (a, b) { return b - a; }).forEach(function (yv) {
    var o = document.createElement("option"); o.value = yv; o.textContent = yv; yearSel.appendChild(o);
  });

  function render() {
    var q = search.value.trim().toLowerCase();
    var yv = yearSel.value;
    var sortBy = sortSel.value;
    var sorted = pubs.slice().sort({
      cites: function (a, b) { return b.citations - a.citations || (b.year || 0) - (a.year || 0); },
      rate: function (a, b) { return b.rate - a.rate || b.citations - a.citations; },
      year: function (a, b) { return (b.year || 0) - (a.year || 0) || b.citations - a.citations; }
    }[sortBy]);
    // Numbers come from the full list so they stay fixed while searching:
    // by year, the newest has the highest number; otherwise 1 is the top-ranked paper.
    sorted.forEach(function (p, i) { p.num = sortBy === "year" ? sorted.length - i : i + 1; });
    var rows = sorted.filter(function (p) {
      if (yv && String(p.year) !== yv) return false;
      if (!q) return true;
      return (p.title + " " + p.authors + " " + p.venue).toLowerCase().indexOf(q) >= 0;
    });

    var filtered = q || yv;
    var visible = showAll || filtered ? rows : rows.slice(0, PAGE);
    list.innerHTML = visible.length ? visible.map(function (p) {
      var authors = esc(p.authors).replace(SELF, "<b>$1</b>");
      var meta = [authors, p.venue ? "<em>" + esc(p.venue) + "</em>" : "", p.year || ""].filter(Boolean).join(" · ");
      var perYear = p.rate >= 10 ? Math.round(p.rate) : p.rate.toFixed(1);
      var hint = ' title="' + perYear + (perYear == 1 ? " citation" : " citations") + ' per year since publication' + (p.top ? ", top 10% of these papers for its age" : "") + '"';
      var cites = p.citations
        ? (p.cites_url ? '<a href="' + esc(p.cites_url) + '" target="_blank" rel="noopener"' + hint + ">" + fmt(p.citations) + "</a>" : "<span" + hint + ">" + fmt(p.citations) + "</span>") +
          (p.top ? '<small class="top-note">★ Top 10%</small>' : "<small>" + (p.citations === 1 ? "citation" : "citations") + "</small>")
        : "";
      return '<li class="pub"><a class="pub-title" href="' + esc(p.url) + '" target="_blank" rel="noopener"><span class="pub-num">' + p.num + "</span>" + esc(p.title) + "</a>" +
        '<div class="pub-cites' + (p.top ? " is-top" : "") + '">' + cites + "</div>" +
        '<div class="pub-meta">' + meta + "</div></li>";
    }).join("") : '<li class="muted pub">No publications match your search.</li>';

    countEl.textContent = filtered
      ? rows.length + " of " + pubs.length + " publications"
      : "Showing " + visible.length + " of " + pubs.length + " publications";
    moreBtn.hidden = showAll || filtered || rows.length <= PAGE;
  }

  search.addEventListener("input", render);
  yearSel.addEventListener("change", render);
  sortSel.addEventListener("change", render);
  moreBtn.addEventListener("click", function () { showAll = true; render(); });
  render();
})();
