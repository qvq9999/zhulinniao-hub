/* ============================================================
   Zhuque Headphone Hub — Prototype interactions
   - sidebar active state (per-page via data-page attribute)
   - connection 3-state via ?state=disconnected|scanning|connected
   - EQ drag interaction (10-band svg)
   - lucide.createIcons() + inline SVG fallback for key icons
   No build step, works from file://
   ============================================================ */
(function () {
  'use strict';

  /* ---------- Lucide boot + fallback ---------- */
  function bootIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try {
        window.lucide.createIcons({ attrs: { 'stroke-width': 1.5, 'aria-hidden': 'true' } });
      } catch (e) {
        /* fall through to fallback */
      }
    }
    applyIconFallback();
  }

  /* For each <i data-lucide="name"> that did not get replaced by an <svg>,
     inject a minimal inline stroke SVG so the prototype never shows empty boxes.
     Fallback uses a generic rounded-square glyph ONLY when the real icon library
     failed to load (offline file:// preview). */
  function applyIconFallback() {
    var placeholders = document.querySelectorAll('i[data-lucide]');
    for (var i = 0; i < placeholders.length; i++) {
      var el = placeholders[i];
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>';
      var tmp = document.createElement('span');
      tmp.innerHTML = svg;
      var node = tmp.firstChild;
      var size = el.getAttribute('data-size');
      if (size) { node.setAttribute('width', size); node.setAttribute('height', size); }
      el.parentNode.replaceChild(node, el);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootIcons);
  } else {
    bootIcons();
  }

  /* ---------- Sidebar active state ---------- */
  function markActiveNav() {
    var page = document.body.getAttribute('data-page');
    if (!page) return;
    var items = document.querySelectorAll('.nav-item[data-nav]');
    for (var i = 0; i < items.length; i++) {
      if (items[i].getAttribute('data-nav') === page) {
        items[i].setAttribute('aria-current', 'page');
      } else {
        items[i].removeAttribute('aria-current');
      }
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', markActiveNav);
  } else {
    markActiveNav();
  }

  /* ---------- Mobile sidebar toggle ---------- */
  function bindMenuToggle() {
    var btn = document.querySelector('.menu-toggle');
    var sidebar = document.querySelector('.sidebar');
    if (!btn || !sidebar) return;
    btn.addEventListener('click', function () {
      sidebar.classList.toggle('is-open');
      var open = sidebar.classList.contains('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  document.addEventListener('DOMContentLoaded', bindMenuToggle);

  /* ---------- Connection 3-state (index.html) ---------- */
  function initConnectionState() {
    var hero = document.querySelector('[data-connection]');
    if (!hero) return;
    var params = new URLSearchParams(window.location.search);
    var state = params.get('state') || 'disconnected';
    if (['disconnected', 'scanning', 'connected'].indexOf(state) === -1) state = 'disconnected';
    setConnectionState(state);

    // wire the switch buttons (demo controls)
    var opts = document.querySelectorAll('[data-set-state]');
    for (var i = 0; i < opts.length; i++) {
      opts[i].addEventListener('click', function (e) {
        e.preventDefault();
        setConnectionState(this.getAttribute('data-set-state'));
      });
    }
  }

  function setConnectionState(state) {
    var hero = document.querySelector('[data-connection]');
    if (!hero) return;
    hero.setAttribute('data-state', state);

    var panels = document.querySelectorAll('[data-panel]');
    for (var i = 0; i < panels.length; i++) {
      if (panels[i].getAttribute('data-panel') === state) {
        panels[i].classList.remove('hidden');
      } else {
        panels[i].classList.add('hidden');
      }
    }

    var statePill = document.querySelector('[data-state-pill]');
    if (statePill) {
      var map = {
        disconnected: { text: '未连接', cls: 'pill--warn', icon: 'triangle-alert' },
        scanning: { text: '检测中', cls: '', icon: 'loader-circle' },
        connected: { text: '已连接 · USB', cls: 'pill--ok', icon: 'circle-check' }
      };
      var cfg = map[state];
      statePill.className = 'pill ' + (cfg.cls || '');
      statePill.innerHTML = '<i data-lucide="' + cfg.icon + '"></i><span>' + cfg.text + '</span>';
      bootIcons();
    }

    // stagger reveal of hotspot cards on connected
    if (state === 'connected') {
      var cards = document.querySelectorAll('.hotspot-card');
      for (var c = 0; c < cards.length; c++) {
        (function (card, idx) {
          card.style.opacity = '0';
          card.style.transform = 'translateY(8px)';
          setTimeout(function () {
            card.style.transition = 'opacity 180ms cubic-bezier(0.2,0,0,1), transform 180ms cubic-bezier(0.2,0,0,1)';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
          }, 60 * idx);
        })(cards[c], c);
      }
    }

    // update URL without reload (keep demo shareable)
    try {
      var url = new URL(window.location.href);
      url.searchParams.set('state', state);
      window.history.replaceState({}, '', url.toString());
    } catch (e) { /* ignore */ }
  }

  document.addEventListener('DOMContentLoaded', initConnectionState);

  /* ---------- EQ interaction (any .eq svg with data-eq) ---------- */
  function initEQ() {
    var eq = document.querySelector('[data-eq]');
    if (!eq) return;
    var svg = eq.querySelector('svg');
    if (!svg) return;

    var W = 640, H = 240;
    var padL = 40, padR = 20, padT = 24, padB = 32;
    var innerW = W - padL - padR;
    var innerH = H - padT - padB;
    var minDb = -12, maxDb = 12;

    var freqs = eq.getAttribute('data-freqs').split(',').map(Number);
    var bands = eq.getAttribute('data-band-labels').split(',');
    var gains = eq.getAttribute('data-gains').split(',').map(Number);
    var n = freqs.length;

    var readout = eq.querySelector('[data-eq-readout]');
    var presetSel = document.querySelector('[data-eq-preset]');
    var presets = window.EQ_PRESETS || [];

    function markCustom() {
      if (presetSel) presetSel.value = 'custom';
    }

    function xAt(i) { return padL + (innerW * i) / (n - 1); }
    function yAt(db) { return padT + innerH * (maxDb - db) / (maxDb - minDb); }
    function clamp(v) { return Math.max(minDb, Math.min(maxDb, v)); }

    var gridGroup = svg.querySelector('.eq__grid-group');
    var curve = svg.querySelector('.eq__curve');
    var nodesGroup = svg.querySelector('.eq__nodes');
    var labelsGroup = svg.querySelector('.eq__labels');

    // build grid (horizontal db lines + vertical freq lines)
    if (gridGroup && !gridGroup.childNodes.length) {
      var ns = 'http://www.w3.org/2000/svg';
      for (var db = minDb; db <= maxDb; db += 4) {
        var line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', padL); line.setAttribute('x2', W - padR);
        line.setAttribute('y1', yAt(db)); line.setAttribute('y2', yAt(db));
        line.setAttribute('class', 'eq__grid');
        gridGroup.appendChild(line);
      }
      for (var f = 0; f < n; f++) {
        var v = document.createElementNS(ns, 'line');
        v.setAttribute('x1', xAt(f)); v.setAttribute('x2', xAt(f));
        v.setAttribute('y1', padT); v.setAttribute('y2', padT + innerH);
        v.setAttribute('class', 'eq__grid');
        gridGroup.appendChild(v);
      }
    }

    // build nodes + labels
    var nodeEls = [];
    if (nodesGroup) {
      var ns2 = 'http://www.w3.org/2000/svg';
      for (var k = 0; k < n; k++) {
        var c = document.createElementNS(ns2, 'circle');
        c.setAttribute('r', 5);
        c.setAttribute('cx', xAt(k));
        c.setAttribute('cy', yAt(gains[k]));
        c.setAttribute('class', 'eq__node');
        c.setAttribute('tabindex', '0');
        c.setAttribute('role', 'slider');
        c.setAttribute('aria-label', bands[k] + ' 增益');
        c.setAttribute('aria-valuemin', minDb);
        c.setAttribute('aria-valuemax', maxDb);
        c.setAttribute('aria-valuenow', gains[k]);
        c.setAttribute('data-idx', k);
        nodesGroup.appendChild(c);
        nodeEls.push(c);

        var t = document.createElementNS(ns2, 'text');
        t.setAttribute('x', xAt(k));
        t.setAttribute('y', H - 12);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('class', 'eq__label');
        t.textContent = bands[k];
        labelsGroup.appendChild(t);
      }
    }

    function redraw() {
      var pts = [];
      for (var i = 0; i < n; i++) pts.push(xAt(i) + ',' + yAt(gains[i]));
      if (curve) curve.setAttribute('points', pts.join(' '));
      for (var j = 0; j < n; j++) {
        nodeEls[j].setAttribute('cy', yAt(gains[j]));
        nodeEls[j].setAttribute('aria-valuenow', gains[j].toFixed(1));
      }
      if (readout) {
        readout.textContent = '当前曲线：' + gains.map(function (g, idx) {
          return bands[idx] + ' ' + (g > 0 ? '+' : '') + g.toFixed(1) + ' dB';
        }).join('  ·  ');
      }
    }
    redraw();

    /* preset selector: apply original game preset gains */
    if (presetSel && presets.length) {
      presetSel.addEventListener('change', function () {
        var idx = Number(this.value);
        if (this.value === 'custom' || isNaN(idx) || !presets[idx]) return;
        for (var p = 0; p < n; p++) {
          if (typeof presets[idx].gains[p] === 'number') {
            gains[p] = clamp(presets[idx].gains[p]);
          }
        }
        redraw();
      });
    }

    // pointer drag
    var dragIdx = -1;
    function clientToDb(clientY) {
      var rect = svg.getBoundingClientRect();
      var scale = H / rect.height;
      var y = (clientY - rect.top) * scale;
      var db = maxDb - (y - padT) / innerH * (maxDb - minDb);
      return clamp(Math.round(db * 2) / 2);
    }
    function nearestIdx(clientX) {
      var rect = svg.getBoundingClientRect();
      var scale = W / rect.width;
      var x = (clientX - rect.left) * scale;
      var best = 0, bestD = Infinity;
      for (var i = 0; i < n; i++) {
        var d = Math.abs(xAt(i) - x);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }
    svg.addEventListener('pointerdown', function (e) {
      dragIdx = nearestIdx(e.clientX);
      gains[dragIdx] = clientToDb(e.clientY);
      redraw();
      markCustom();
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', function (e) {
      if (dragIdx < 0) return;
      gains[dragIdx] = clientToDb(e.clientY);
      redraw();
      markCustom();
    });
    svg.addEventListener('pointerup', function () { dragIdx = -1; });
    svg.addEventListener('pointercancel', function () { dragIdx = -1; });

    // keyboard adjust
    for (var m = 0; m < nodeEls.length; m++) {
      (function (node, idx) {
        node.addEventListener('keydown', function (e) {
          var step = e.shiftKey ? 1 : 0.5;
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { gains[idx] = clamp(gains[idx] + step); redraw(); markCustom(); e.preventDefault(); }
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { gains[idx] = clamp(gains[idx] - step); redraw(); markCustom(); e.preventDefault(); }
          else if (e.key === 'Home' || e.key === 'End') { gains[idx] = 0; redraw(); markCustom(); e.preventDefault(); }
        });
      })(nodeEls[m], m);
    }
  }
  document.addEventListener('DOMContentLoaded', initEQ);

  /* ---------- Sliders: sync fill width + value text ---------- */
  function initSliders() {
    var sliders = document.querySelectorAll('.slider input[type="range"]');
    for (var i = 0; i < sliders.length; i++) {
      (function (input) {
        var wrap = input.closest('.slider');
        var fill = wrap.querySelector('.slider__fill');
        var thumb = wrap.querySelector('.slider__thumb');
        var valEl = wrap.parentNode.querySelector('[data-slider-val]');
        function sync() {
          var min = Number(input.min) || 0;
          var max = Number(input.max) || 100;
          var pct = (Number(input.value) - min) / (max - min) * 100;
          if (fill) fill.style.width = pct + '%';
          if (thumb) thumb.style.left = pct + '%';
          if (valEl) valEl.textContent = input.getAttribute('data-suffix') ? input.value + input.getAttribute('data-suffix') : input.value;
        }
        input.addEventListener('input', sync);
        sync();
      })(sliders[i]);
    }
  }
  document.addEventListener('DOMContentLoaded', initSliders);

  /* ---------- Segmented controls ---------- */
  function initSegmented() {
    var groups = document.querySelectorAll('.segmented');
    for (var i = 0; i < groups.length; i++) {
      (function (group) {
        group.addEventListener('click', function (e) {
          var btn = e.target.closest('button');
          if (!btn || !group.contains(btn)) return;
          var btns = group.querySelectorAll('button');
          for (var j = 0; j < btns.length; j++) btns[j].setAttribute('aria-pressed', 'false');
          btn.setAttribute('aria-pressed', 'true');
        });
      })(groups[i]);
    }
  }
  document.addEventListener('DOMContentLoaded', initSegmented);

  /* ---------- Lighting swatches ---------- */
  function initSwatches() {
    var grids = document.querySelectorAll('.swatches');
    for (var i = 0; i < grids.length; i++) {
      (function (grid) {
        grid.addEventListener('click', function (e) {
          var sw = e.target.closest('.swatch');
          if (!sw) return;
          var all = grid.querySelectorAll('.swatch');
          for (var j = 0; j < all.length; j++) all[j].setAttribute('aria-pressed', 'false');
          sw.setAttribute('aria-pressed', 'true');
        });
      })(grids[i]);
    }
  }
  document.addEventListener('DOMContentLoaded', initSwatches);

  /* ---------- Global LED master switch: disable dependents ---------- */
  function initMasterSwitch() {
    var master = document.querySelector('[data-master-led]');
    if (!master) return;
    var dependents = document.querySelectorAll('[data-led-dependent]');
    function sync() {
      for (var i = 0; i < dependents.length; i++) {
        if (master.checked) { dependents[i].classList.remove('is-disabled'); }
        else { dependents[i].classList.add('is-disabled'); }
      }
    }
    master.addEventListener('change', sync);
    sync();
  }
  document.addEventListener('DOMContentLoaded', initMasterSwitch);

  /* ---------- Copy serial -> toast ---------- */
  function initCopy() {
    var btns = document.querySelectorAll('[data-copy]');
    var toast = document.querySelector('.toast');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var text = btn.getAttribute('data-copy');
          if (navigator.clipboard) { navigator.clipboard.writeText(text).catch(function () {}); }
          if (toast) {
            toast.classList.add('is-visible');
            setTimeout(function () { toast.classList.remove('is-visible'); }, 2000);
          }
        });
      })(btns[i]);
    }
  }
  document.addEventListener('DOMContentLoaded', initCopy);

  /* ---------- Theme toggle (device page) ---------- */
  function initTheme() {
    var seg = document.querySelector('[data-theme-seg]');
    if (!seg) return;
    seg.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-theme-val]');
      if (!btn) return;
      var val = btn.getAttribute('data-theme-val');
      if (val === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      else if (val === 'light') document.documentElement.removeAttribute('data-theme');
      else {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
          document.documentElement.setAttribute('data-theme', 'dark');
        else document.documentElement.removeAttribute('data-theme');
      }
    });
  }
  document.addEventListener('DOMContentLoaded', initTheme);

  /* ---------- Overview hotspot map: SVG leader lines ---------- */
  function initLeaderLines() {
    var hero = document.querySelector('[data-hotspot-map]');
    if (!hero) return;
    var svg = hero.querySelector('[data-leader-svg]');
    if (!svg) return;
    var SVG_NS = 'http://www.w3.org/2000/svg';

    function draw() {
      if (!hero.isConnected) return;
      var heroRect = hero.getBoundingClientRect();
      if (heroRect.width < 2 || heroRect.height < 2) return; /* hidden / collapsed */
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      svg.setAttribute('viewBox', '0 0 ' + Math.round(heroRect.width) + ' ' + Math.round(heroRect.height));
      svg.setAttribute('preserveAspectRatio', 'none');

      var hotspots = hero.querySelectorAll('.hotspot[data-target]');
      for (var i = 0; i < hotspots.length; i++) {
        var hs = hotspots[i];
        var targetId = hs.getAttribute('data-target');
        var card = targetId ? document.getElementById(targetId) : null;
        if (!card) continue;
        var hr = hs.getBoundingClientRect();
        var cr = card.getBoundingClientRect();
        var x1 = hr.left + hr.width / 2 - heroRect.left;
        var y1 = hr.top + hr.height / 2 - heroRect.top;
        var onLeft = x1 < heroRect.width / 2;
        var x2 = onLeft ? (cr.right - heroRect.left) : (cr.left - heroRect.left);
        var y2 = cr.top + cr.height / 2 - heroRect.top;
        var bend = 56, tail = 20;
        var d = 'M ' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
          ' C ' + (x1 + (onLeft ? -bend : bend)).toFixed(1) + ' ' + y1.toFixed(1) +
          ', ' + (x2 + (onLeft ? tail : -tail)).toFixed(1) + ' ' + y2.toFixed(1) +
          ', ' + x2.toFixed(1) + ' ' + y2.toFixed(1);
        var p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', d);
        p.setAttribute('class', 'leader-line');
        p.setAttribute('data-target', targetId);
        svg.appendChild(p);
      }
    }

    function setActive(targetId, on) {
      if (!targetId) return;
      var p = svg.querySelector('.leader-line[data-target="' + targetId + '"]');
      if (p) p.classList.toggle('is-active', on);
      var card = document.getElementById(targetId);
      if (card) card.classList.toggle('is-linked', on);
    }

    var zones = hero.querySelectorAll('.hotspot[data-target], .hotspot-card[id]');
    for (var i = 0; i < zones.length; i++) {
      (function (zone) {
        var id = zone.hasAttribute('data-target') ? zone.getAttribute('data-target') : zone.id;
        if (!id) return;
        zone.addEventListener('mouseenter', function () { setActive(id, true); });
        zone.addEventListener('mouseleave', function () { setActive(id, false); });
        zone.addEventListener('focus', function () { setActive(id, true); });
        zone.addEventListener('blur', function () { setActive(id, false); });
      })(zones[i]);
    }

    draw();
    var rafId = 0;
    window.addEventListener('resize', function () {
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(function () { rafId = 0; draw(); });
    });
    window.addEventListener('load', draw); /* re-measure after icons/fonts settle */
  }
  document.addEventListener('DOMContentLoaded', initLeaderLines);

  /* ---------- Overview hotspot buttons -> navigate ---------- */
  function initHotspotNav() {
    var btns = document.querySelectorAll('button.hotspot[data-href]');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var href = btn.getAttribute('data-href');
          if (href) window.location.href = href;
        });
      })(btns[i]);
    }
  }
  document.addEventListener('DOMContentLoaded', initHotspotNav);

})();
