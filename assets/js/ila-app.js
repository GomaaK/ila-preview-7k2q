// ILA prototype front-end layer (static). Replaces the template's server-backed ila-app.js.
// Cart, wishlist, quick view, search and checkout all run in the browser (localStorage / sessionStorage).
// The only file this script requests is data/prices.json (same origin, static). Checkout sends nothing.
(function () {
  'use strict';
  var metaRoot = document.querySelector('meta[name="ila-root"]');
  var ROOT = metaRoot ? metaRoot.content : '';
  var KEY = 'ila_proto_cart_v1';
  var WKEY = 'ila_proto_wishlist_v1';
  var OKEY = 'ila_proto_last_checkout';
  var CAT = window.ILA_CATALOG || [];
  var bySlug = {};
  CAT.forEach(function (p) { bySlug[p.slug] = p; });
  var fmt = function (n) { return 'EGP ' + Number(n).toLocaleString('en-US'); };
  window.ILA_ROOT = ROOT;
  window.ilaFmt = fmt;
  window.ILA_KEYS = { cart: KEY, order: OKEY };

  // Icons: render once now (before Alpine starts) so Alpine class bindings land on the final <svg>.
  if (window.lucide && window.lucide.createIcons) { window.lucide.createIcons(); }

  // Prices come from data/prices.js (generated from data/prices.json by _tools/build.py) so the site works from file:// with no fetch.
  var pricePromise = Promise.resolve({ prices: (window.ILA_PRICES && window.ILA_PRICES.prices) || {} });

  function applyPrices(prices) {
    document.querySelectorAll('[data-price]').forEach(function (el) {
      var v = prices[el.getAttribute('data-price')];
      if (v != null) { el.textContent = fmt(v); }
    });
    document.querySelectorAll('[data-price-value]').forEach(function (el) {
      var v = prices[el.getAttribute('data-slug')];
      if (v != null) { el.setAttribute('data-price-value', v); }
    });
  }

  function readJSON(k, d) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; }
  }

  // Header/search/menu state for <body x-data="ilaShell()">
  window.ilaShell = function () {
    return {
      mobileMenuOpen: false,
      searchOpen: false,
      searchQuery: '',
      get searchResults() {
        var q = this.searchQuery.trim().toLowerCase();
        if (q.length < 2) { return null; }
        return CAT.filter(function (p) {
          return (p.name + ' ' + p.category_name + ' ' + p.tags.join(' ') + ' ' + p.description).toLowerCase().indexOf(q) !== -1;
        }).map(function (p) {
          return { slug: p.slug, name: p.name, category_name: p.category_name,
                   url: ROOT + 'product/' + p.slug + '.html', image: ROOT + 'img/' + p.images[0] };
        });
      }
    };
  };

  window.toggleWishlist = function (slug, btn) {
    var list = readJSON(WKEY, []);
    var i = list.indexOf(slug);
    var added = i === -1;
    if (added) { list.push(slug); } else { list.splice(i, 1); }
    localStorage.setItem(WKEY, JSON.stringify(list));
    if (btn) { btn.classList.toggle('card-fav-on', added); }
    window.ilaSyncWishlist();
    Alpine.store('toast').show(added ? 'Saved on this device (prototype).' : 'Removed from saved pieces.', 'info');
  };
  window.ilaSyncWishlist = function () {
    var list = readJSON(WKEY, []);
    var badge = document.getElementById('wishlist-counter-badge');
    if (badge) { badge.textContent = list.length; badge.classList.toggle('hidden', list.length === 0); }
    document.querySelectorAll('[data-fav]').forEach(function (b) {
      b.classList.toggle('card-fav-on', list.indexOf(b.getAttribute('data-fav')) !== -1);
    });
  };

  document.addEventListener('alpine:init', function () {

    Alpine.store('toast', {
      message: '', type: 'success', visible: false, _t: null,
      show: function (message, type, duration) {
        var self = this;
        this.message = message; this.type = type || 'success'; this.visible = true;
        clearTimeout(this._t);
        this._t = setTimeout(function () { self.visible = false; }, duration || 3500);
      }
    });

    Alpine.store('cart', {
      isOpen: false,
      prices: {},
      lines: [],
      data: { items: [], items_count: 0, subtotal: 0, subtotal_label: fmt(0) },

      init: function () {
        var self = this;
        this.lines = this.read();
        this.recompute();
        pricePromise.then(function (p) {
          self.prices = p.prices || {};
          self.recompute();
          applyPrices(self.prices);
          document.dispatchEvent(new CustomEvent('ila:prices'));
        });
        window.addEventListener('storage', function (e) {
          if (e.key === KEY) { self.lines = self.read(); self.recompute(); }
        });
      },
      read: function () {
        var v = readJSON(KEY, []);
        return Array.isArray(v) ? v.filter(function (l) { return bySlug[l.slug] && l.size && l.qty > 0; }) : [];
      },
      save: function () {
        localStorage.setItem(KEY, JSON.stringify(this.lines));
        this.recompute();
      },
      priceLabel: function (slug) {
        var v = this.prices[slug];
        return v == null ? '' : fmt(v);
      },
      recompute: function () {
        var self = this;
        var items = this.lines.map(function (l) {
          var p = bySlug[l.slug];
          var price = self.prices[l.slug];
          var total = price == null ? 0 : price * l.qty;
          return {
            id: l.slug + '|' + l.size, product_slug: l.slug, product_name: p.name,
            image: ROOT + 'img/' + p.images[0], url: ROOT + 'product/' + l.slug + '.html',
            size: l.size, variant_name: 'Size ' + l.size, quantity: l.qty,
            price: price, price_label: price == null ? '' : fmt(price),
            line_total: total, line_label: price == null ? '' : fmt(total)
          };
        });
        var count = items.reduce(function (a, i) { return a + i.quantity; }, 0);
        var sub = items.reduce(function (a, i) { return a + i.line_total; }, 0);
        this.data = { items: items, items_count: count, subtotal: sub, subtotal_label: fmt(sub) };
      },
      open: function () { this.isOpen = true; },
      close: function () { this.isOpen = false; },
      addItem: function (slug, qty, size, opts) {
        qty = Math.max(1, parseInt(qty, 10) || 1);
        if (!bySlug[slug] || !size) { return false; }
        var l = this.lines.filter(function (x) { return x.slug === slug && x.size === size; })[0];
        if (l) { l.qty = Math.min(10, l.qty + qty); } else { this.lines.push({ slug: slug, size: size, qty: Math.min(10, qty) }); }
        this.save();
        if (!opts || opts.open !== false) { this.isOpen = true; }
        return true;
      },
      updateQty: function (id, qty) {
        var parts = id.split('|');
        var l = this.lines.filter(function (x) { return x.slug === parts[0] && x.size === parts[1]; })[0];
        if (!l) { return; }
        if (qty <= 0) { return this.removeItem(id); }
        l.qty = Math.min(10, qty);
        this.save();
      },
      removeItem: function (id) {
        var parts = id.split('|');
        this.lines = this.lines.filter(function (x) { return !(x.slug === parts[0] && x.size === parts[1]); });
        this.save();
      },
      clear: function () { this.lines = []; this.save(); }
    });

    Alpine.store('quickView', {
      isOpen: false, product: null, size: null, qty: 1, error: '', hint: false,
      open: function (slug, hint) {
        this.product = bySlug[slug] || null;
        this.size = null; this.qty = 1; this.error = ''; this.hint = !!hint;
        this.isOpen = !!this.product;
      },
      close: function () { this.isOpen = false; },
      img: function (p) { return ROOT + 'img/' + p.images[0]; },
      url: function (p) { return ROOT + 'product/' + p.slug + '.html'; },
      add: function () {
        if (!this.size) { this.error = 'Please select a size.'; return; }
        Alpine.store('cart').addItem(this.product.slug, this.qty, this.size);
        this.close();
      }
    });

    // Checkout form: validation only, all local.
    window.ilaCheckout = function () {
      return {
        f: { email: '', phone: '', first: '', last: '', address: '', address2: '', city: '', region: '', postal: '', country: 'EG', notes: '', ack: false },
        errors: {}, tried: false,
        validate: function () {
          var f = this.f, e = {};
          if (f.first.trim().length < 1) { e.first = 'Please enter your first name.'; }
          if (f.last.trim().length < 1) { e.last = 'Please enter your last name.'; }
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) { e.email = 'Please enter a valid email address.'; }
          var digits = f.phone.replace(/[^0-9]/g, '');
          if (!/^[0-9+\-\s()]+$/.test(f.phone.trim()) || digits.length < 8 || digits.length > 15) { e.phone = 'Please enter a valid phone number (8 to 15 digits).'; }
          if (f.address.trim().length < 5) { e.address = 'Please enter your street address.'; }
          if (f.city.trim().length < 2) { e.city = 'Please enter your city.'; }
          if (f.region.trim().length < 2) { e.region = 'Please enter your governorate or region.'; }
          if (!f.ack) { e.ack = 'Please confirm you understand this is a prototype.'; }
          this.errors = e;
          return Object.keys(e).length === 0;
        },
        submit: function () {
          this.tried = true;
          var cart = Alpine.store('cart');
          if (cart.data.items.length === 0) { return; }
          if (!this.validate()) {
            var first = document.querySelector('[data-field-error="1"]');
            this.$nextTick(function () {
              var el = document.querySelector('.has-error'); if (el) { el.focus(); }
            });
            return;
          }
          var order = {
            placed: false,
            created_at: new Date().toISOString(),
            name: (this.f.first.trim() + ' ' + this.f.last.trim()), city: this.f.city.trim(),
            items: cart.data.items.map(function (i) {
              return { name: i.product_name, size: i.size, quantity: i.quantity, line_label: i.line_label, image: i.image };
            }),
            subtotal_label: cart.data.subtotal_label
          };
          sessionStorage.setItem(OKEY, JSON.stringify(order));
          cart.clear();
          window.location.href = ROOT + 'order-confirmation.html';
        }
      };
    };

    window.ilaConfirmation = function () {
      return {
        order: (function () { try { return JSON.parse(sessionStorage.getItem(OKEY)); } catch (e) { return null; } })()
      };
    };

    // Simple client-side forms (contact, tracking): nothing is sent anywhere.
    window.ilaLocalForm = function (kind) {
      return {
        done: false, errors: {}, v: {},
        submit: function () {
          var e = {}, v = this.v;
          if (kind === 'contact') {
            if (!v.name || v.name.trim().length < 2) { e.name = 'Please enter your name.'; }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((v.email || '').trim())) { e.email = 'Please enter a valid email address.'; }
            if (!v.subject || v.subject.trim().length < 2) { e.subject = 'Please add a subject.'; }
            if (!v.message || v.message.trim().length < 5) { e.message = 'Please write a short message.'; }
          } else {
            if (!v.order || v.order.trim().length < 3) { e.order = 'Please enter an order number.'; }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((v.email || '').trim())) { e.email = 'Please enter a valid email address.'; }
          }
          this.errors = e;
          this.done = Object.keys(e).length === 0;
        }
      };
    };
  });

  // Shop page: client-side category filter + sort (URL: shop.html?category=denim&sort=price_asc)
  function initShop() {
    var grid = document.getElementById('products-container');
    if (!grid) { return; }
    var cards = Array.prototype.slice.call(grid.querySelectorAll('[data-product-card]'));
    var sortSel = document.getElementById('sort-select');
    var names = {};
    document.querySelectorAll('[data-filter-category]').forEach(function (a) {
      names[a.getAttribute('data-filter-category')] = a.getAttribute('data-label');
    });
    function state() {
      var q = new URLSearchParams(location.search);
      var c = q.get('category') || '';
      if (c && !names[c]) { c = ''; }
      return { category: c, sort: q.get('sort') || 'featured' };
    }
    function render() {
      var s = state();
      var shown = cards.filter(function (c) { return !s.category || c.getAttribute('data-category') === s.category; });
      var val = function (c) { return parseFloat(c.getAttribute('data-price-value')) || 0; };
      var idx = function (c) { return parseInt(c.getAttribute('data-index'), 10); };
      shown.sort(function (a, b) {
        if (s.sort === 'price_asc') { return val(a) - val(b) || idx(a) - idx(b); }
        if (s.sort === 'price_desc') { return val(b) - val(a) || idx(a) - idx(b); }
        if (s.sort === 'name') { return a.getAttribute('data-name').localeCompare(b.getAttribute('data-name')); }
        return idx(a) - idx(b);
      });
      cards.forEach(function (c) { c.style.display = shown.indexOf(c) === -1 ? 'none' : ''; });
      shown.forEach(function (c) { grid.appendChild(c); });
      var cnt = document.getElementById('shop-count'); if (cnt) { cnt.textContent = shown.length; }
      var t = document.getElementById('shop-title');
      if (t) { t.textContent = s.category ? names[s.category] : "The Women's Collection"; }
      document.querySelectorAll('[data-filter-category]').forEach(function (a) {
        var on = a.getAttribute('data-filter-category') === s.category;
        a.classList.toggle('font-bold', on); a.classList.toggle('text-eggplant', on);
        if (on) { a.setAttribute('aria-current', 'true'); } else { a.removeAttribute('aria-current'); }
      });
      if (sortSel) { sortSel.value = s.sort; }
      var clear = document.getElementById('shop-clear'); if (clear) { clear.style.display = s.category ? '' : 'none'; }
    }
    function go(params) {
      var q = new URLSearchParams(location.search);
      Object.keys(params).forEach(function (k) { if (params[k]) { q.set(k, params[k]); } else { q.delete(k); } });
      var qs = q.toString();
      history.pushState(null, '', location.pathname + (qs ? '?' + qs : ''));
      render();
      window.dispatchEvent(new CustomEvent('ila-filter'));
    }
    document.querySelectorAll('[data-filter-category]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        go({ category: a.getAttribute('data-filter-category') });
      });
    });
    if (sortSel) { sortSel.addEventListener('change', function () { go({ sort: sortSel.value === 'featured' ? '' : sortSel.value }); }); }
    window.addEventListener('popstate', render);
    document.addEventListener('ila:prices', render);
    render();
  }

  // Home page: category tabs
  document.addEventListener('DOMContentLoaded', function () {
    initShop();
    window.ilaSyncWishlist();
    // Honest placeholders for features that need a server
    document.querySelectorAll('[data-proto-toast]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        var msg = el.getAttribute('data-proto-toast');
        if (el.id === 'header-wishlist') {
          msg = 'Saved pieces: ' + readJSON(WKEY, []).length + ' (stored on this device only).';
        }
        Alpine.store('toast').show(msg, 'info');
      });
    });
  });
})();
