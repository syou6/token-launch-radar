// Token Launch Radar dashboard. Static and offline: every figure comes from
// window.RADAR, the data.js main.ts writes beside this page from the same board
// it hands in as board.json. Views: the ranked board, a detail view per protocol
// (its model's working and its farm plan), the protocols that already trade,
// kept apart. Filters: text, category, watchlist only. Hash routes:
// #detail=<slug> opens a protocol, #filtered&cat=<category> a filtered board.

(function () {
  'use strict';
  var D = window.RADAR;
  var main = document.getElementById('board');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null) return 'n/a';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function pct(n) {
    if (n == null) return '<span>n/a</span>';
    var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }

  var state = { view: 'board', q: '', cat: '', watch: false, sort: 'rank', dir: 1, slug: null };

  function fromHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var parts = h.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      var k = kv[0], v = decodeURIComponent(kv.slice(1).join('=') || '');
      if (k === 'detail') { state.slug = v; state.view = 'board'; }
      if (k === 'filtered') { state.view = 'board'; }
      if (k === 'cat') state.cat = v;
      if (k === 'q') state.q = v;
      if (k === 'watch') state.watch = v === '1';
      if (k === 'view' && v === 'live') state.view = 'live';
    }
  }

  function categories() {
    var seen = {};
    D.rows.forEach(function (r) { if (r.category) seen[r.category] = 1; });
    return Object.keys(seen).sort();
  }

  function filteredRows() {
    var rows = D.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    rows.sort(function (a, b) {
      var x = a[key], y = b[key];
      if (typeof x === 'string') return state.dir * x.localeCompare(y);
      return state.dir * ((x || 0) - (y || 0));
    });
    return rows;
  }

  function header() {
    return '<header class="masthead"><h1>Token Launch <span class="radar">Radar</span></h1>' +
      '<p class="tagline">Protocols that record no token yet, ranked by what their launch would be worth ' +
      'if their record stayed as it is, each with the steps to farm it. Implied value is this board\'s own ' +
      'claim from the snapshot\'s figures, never a prediction that a token will come.</p>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + D.board_size + '</b><span>protocols ranked</span></div>' +
      '<div class="stat"><b>' + D.watchlist_size + '</b><span>on the $50M watchlist, all covered</span></div>' +
      '<div class="stat"><b>' + D.early_size + '</b><span>early finds below the floor</span></div>' +
      '<div class="stat"><b>' + D.excluded_total + '</b><span>derivative lookalikes excluded</span></div>' +
      '<div class="stat"><b>' + esc(D.as_of) + '</b><span>snapshot date (UTC)</span></div>' +
      '</div>' +
      '<p class="model-note"><b>Model ' + esc(D.model_version) + ':</b> ' + esc(D.formula) + '. ' +
      'Category multiples compress at scale; growth is the 7-day TVL change only, clamped; maturity rewards ' +
      'years run with no token. Likelihood (0-100) is scored apart from value: size, growth, maturity, chains.</p></header>';
  }

  function controls() {
    var cats = categories().map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    return '<div class="controls">' +
      '<div><label for="q">Search name or slug</label><input type="search" id="q" value="' + esc(state.q) + '" placeholder="e.g. lending protocol"></div>' +
      '<div><label for="cat">Category</label><select id="cat"><option value="">All categories</option>' + cats + '</select></div>' +
      '<label class="check"><input type="checkbox" id="watch"' + (state.watch ? ' checked' : '') + '> Watchlist only</label>' +
      '<div class="views">' +
      '<button class="tab" id="v-board" aria-pressed="' + (state.view === 'board') + '">Pre-token board</button>' +
      '<button class="tab" id="v-live" aria-pressed="' + (state.view === 'live') + '">Already trading</button>' +
      '</div></div>';
  }

  function sortHead(label, key, cls) {
    var arrow = state.sort === key ? (state.dir === 1 ? ' ^' : ' v') : '';
    return '<th class="' + (cls || '') + '"><button data-sort="' + key + '">' + label + arrow + '</button></th>';
  }

  function boardTable(rows) {
    var body = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.slug === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + '<span class="sub">' + esc(r.slug) + '</span></td>' +
        '<td class="hide-s">' + esc(r.category || 'Uncategorised') + (r.watchlist ? ' <span class="pill watch">WATCHLIST</span>' : '') + '</td>' +
        '<td class="hide-s">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + r.likelihood_score.toFixed(1) + '</td></tr>';
    }).join('');
    return '<p class="count">Showing ' + rows.length + ' of ' + D.board_size + ' ranked protocols. Click a row for its detail and farm plan.</p>' +
      '<table><thead><tr>' + sortHead('#', 'rank', 'num') + sortHead('Protocol', 'name') +
      '<th class="hide-s">Category</th><th class="hide-s">Chains</th>' + sortHead('TVL', 'tvl_usd', 'num') +
      '<th class="num">7d</th>' + sortHead('Implied value', 'implied_value_usd', 'num') +
      sortHead('Likelihood', 'likelihood_score', 'num') + '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function liveTable() {
    var body = D.live.map(function (r) {
      return '<tr><td class="name">' + esc(r.name) + '<span class="sub">' + esc(r.slug) + '</span></td>' +
        '<td class="hide-s">' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + money(r.mcap_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td></tr>';
    }).join('');
    return '<p class="count">These protocols already have a token that trades, so the board never ranks them: ' +
      'it shows the market\'s own value instead of a model\'s. ' + D.live_size + ' largest by market cap.</p>' +
      '<table><thead><tr><th>Protocol</th><th class="hide-s">Category</th><th class="num">TVL</th>' +
      '<th class="num">Market cap</th><th class="num">7d</th></tr></thead><tbody>' + body + '</tbody></table>';
  }

  function detail() {
    if (!state.slug) return '';
    var r = null;
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === state.slug) r = D.rows[i];
    if (!r) return '';
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    return '<section class="detail" id="detail"><button class="close" id="close-detail">Close</button>' +
      '<h2>' + esc(r.name) + (r.watchlist ? ' <span class="pill watch">WATCHLIST</span>' : '') + '</h2>' +
      '<p class="meta">Rank #' + r.rank + ' of ' + D.board_size + ' - ' + esc(r.category || 'Uncategorised') +
      ' - on ' + esc(r.chains.join(', ') || 'no chain recorded') + ' - records no token in the snapshot.</p>' +
      '<div class="detail-grid">' +
      '<div class="cell"><b>' + money(r.implied_value_usd) + '</b><span>implied launch value</span></div>' +
      '<div class="cell"><b>' + money(r.tvl_usd) + '</b><span>TVL in the snapshot</span></div>' +
      '<div class="cell"><b>' + (r.change_7d == null ? 'n/a' : (r.change_7d > 0 ? '+' : '') + r.change_7d + '%') + '</b><span>TVL change, 7 days</span></div>' +
      '<div class="cell"><b>' + r.likelihood_score.toFixed(1) + ' / 100</b><span>launch likelihood score</span></div>' +
      '<div class="cell"><b>' + (r.age_days == null ? 'unknown' : r.age_days + ' days') + '</b><span>tracked with no token</span></div>' +
      '</div>' +
      '<h3>How the value follows</h3><p class="explain">TVL x category multiple ' + r.category_multiple.toFixed(2) +
      ' x growth multiplier ' + r.growth_multiplier.toFixed(3) + ' (7-day change, clamped) x maturity multiplier ' +
      r.maturity_multiplier.toFixed(2) + ' = ' + money(r.implied_value_usd) + '. The full arithmetic for every row is in board.json.</p>' +
      '<h3>How to farm it</h3><ol>' + steps + '</ol></section>';
  }

  function render() {
    var html = header() + controls();
    html += state.view === 'live' ? liveTable() : boardTable(filteredRows()) + detail();
    html += '<footer>Data: ' + esc(D.source) + '. Every figure on this page is computed by the entry\'s program ' +
      'from that sealed snapshot; nothing is fetched. A protocol here records no token in DefiLlama\'s record, ' +
      'which is not proof it has none.</footer>';
    main.innerHTML = html;
    main.setAttribute('aria-busy', 'false');
    wire();
    var d = document.getElementById('detail');
    if (d) d.scrollIntoView();
  }

  function wire() {
    var q = document.getElementById('q');
    q.addEventListener('input', function () { state.q = q.value; refreshTable(); });
    var cat = document.getElementById('cat');
    cat.addEventListener('change', function () { state.cat = cat.value; refreshTable(); });
    var watch = document.getElementById('watch');
    watch.addEventListener('change', function () { state.watch = watch.checked; refreshTable(); });
    document.getElementById('v-board').addEventListener('click', function () { state.view = 'board'; render(); });
    document.getElementById('v-live').addEventListener('click', function () { state.view = 'live'; render(); });
    var heads = main.querySelectorAll('[data-sort]');
    for (var i = 0; i < heads.length; i++) heads[i].addEventListener('click', function () {
      var k = this.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
      render();
    });
    wireRows();
  }

  function wireRows() {
    var trs = main.querySelectorAll('tbody tr[data-slug]');
    for (var i = 0; i < trs.length; i++) trs[i].addEventListener('click', function () {
      state.slug = this.getAttribute('data-slug');
      render();
    });
    var close = document.getElementById('close-detail');
    if (close) close.addEventListener('click', function () { state.slug = null; render(); });
  }

  // Re-render only the table and detail on filter changes, keeping the search box focused.
  function refreshTable() {
    if (state.view !== 'board') { render(); return; }
    var old = main.querySelector('table');
    var holder = document.createElement('div');
    holder.innerHTML = boardTable(filteredRows()) + detail();
    if (old) { old.previousElementSibling.remove(); old.replaceWith(holder.querySelector('table')); }
    var prev = main.querySelector('.detail');
    if (prev) prev.remove();
    var nd = holder.querySelector('.detail');
    if (nd) main.insertBefore(nd, main.querySelector('footer'));
    var count = main.querySelector('.count');
    if (count && holder.querySelector('.count')) count.replaceWith(holder.querySelector('.count'));
    wireRows();
  }

  fromHash();
  render();
})();
