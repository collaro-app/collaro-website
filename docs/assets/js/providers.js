/*
 * Collaro website — the provider list (/providers/), the web twin of the app's
 * public guest list. It reads the API's PUBLIC provider search in the visitor's
 * browser (GET <data-api>/api/v1/providers — the API grants this site's origin a
 * CORS read of that one route, see PUBLIC_WEB_ORIGINS in the app repo) and renders
 * it the way the app does: area chips, the same filters (applied live, mirrored in
 * the page URL so a filtered list can be reloaded or shared), photo cards, and the
 * loading / error / empty states. The markup it fills — the card, the states, the
 * copy and the glyphs — is in the page's <template>s, so every string stays in
 * src/strings/<lang>.json.
 *
 * Everything the API returns is untrusted: text is written with textContent, image
 * URLs must be https, and a card links only to a well-formed provider id (the same
 * /provider/?id=… link a provider shares from the app).
 */
(function () {
  "use strict";

  var root = document.getElementById("provider-list");
  if (!root || !window.fetch || !("content" in document.createElement("template"))) return;

  var MAX_RATING = 5;
  /** A provider id is a MongoDB ObjectId: exactly 24 hex characters (as the app's deepLinks.ts). */
  var PROVIDER_ID = /^[0-9a-f]{24}$/i;
  var PRESTIGE_LEVELS = ["$", "$$", "$$$"];
  /** Generous: a cold API instance can take a while to answer its first request. */
  var REQUEST_TIMEOUT_MS = 45000;
  var LIST_FILTERS = ["areas", "serviceTypes", "providerTypes"];
  var SINGLE_FILTERS = ["minRating", "minCompletedBookings"];

  var html = document.documentElement;
  var isRtl = html.dir === "rtl";
  var plurals = new Intl.PluralRules(html.lang || "en");
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var searchUrl = root.getAttribute("data-api") + "/api/v1/providers";
  var profileHref = root.getAttribute("data-profile-href");

  var grid = document.getElementById("plist-grid");
  var status = document.getElementById("plist-status");
  var count = document.getElementById("plist-count");
  var sheet = document.getElementById("plist-filters");
  var openFilters = document.getElementById("plist-filters-open");
  var badge = openFilters.querySelector(".filter-btn__badge");
  var verifiedSwitch = sheet.querySelector('[data-filter="verifiedOnly"]');
  var quickChips = root.querySelectorAll("[data-quick-area]");
  var sheetChips = sheet.querySelectorAll(".chip[data-filter]");
  var cardTemplate = document.getElementById("plist-card").content.firstElementChild;
  var statesTemplate = document.getElementById("plist-states").content;

  // ---------------------------------------------------------------------------
  // Copy and glyphs (from the page's templates)
  // ---------------------------------------------------------------------------

  var has = function (object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  };

  var STRINGS = {};
  var ICONS = {};
  var stringsTemplate = document.getElementById("plist-strings").content;
  stringsTemplate.querySelectorAll("[data-string]").forEach(function (el) {
    STRINGS[el.getAttribute("data-string")] = el.textContent.trim();
  });
  stringsTemplate.querySelectorAll("[data-icon]").forEach(function (el) {
    ICONS[el.getAttribute("data-icon")] = el.firstElementChild;
  });

  /** Fills `{name}` placeholders. */
  function format(template, values) {
    return template.replace(/\{(\w+)\}/g, function (match, name) {
      return has(values, name) ? String(values[name]) : match;
    });
  }

  /** A counted phrase in the page language's plural form (Hebrew has one/two/other). */
  function plural(key, n) {
    var form = key + "." + plurals.select(n);
    return format(has(STRINGS, form) ? STRINGS[form] : STRINGS[key + ".other"], { count: n });
  }

  // ---------------------------------------------------------------------------
  // Filters — the app's ProviderFilters, named as the API's query parameters
  // ---------------------------------------------------------------------------

  /** The values each filter accepts, in display order — whatever the sheet offers. */
  var allowed = {};
  LIST_FILTERS.concat(SINGLE_FILTERS).forEach(function (key) {
    allowed[key] = [];
    sheet.querySelectorAll('.chip[data-filter="' + key + '"]').forEach(function (chip) {
      var value = chip.getAttribute("data-value");
      if (value) allowed[key].push(value);
    });
  });

  function emptyFilters() {
    return { areas: [], serviceTypes: [], providerTypes: [], minRating: "", minCompletedBookings: "", verifiedOnly: false };
  }

  var filters = filtersFromQuery(window.location.search);

  /** Each picked area / service / type counts on its own, as the app's badge does. */
  function activeFilterCount() {
    var n = filters.areas.length + filters.serviceTypes.length + filters.providerTypes.length;
    if (filters.minRating) n += 1;
    if (filters.minCompletedBookings) n += 1;
    if (filters.verifiedOnly) n += 1;
    return n;
  }

  /** Reads a query string, keeping only values the sheet offers (anything else is dropped). */
  function filtersFromQuery(search) {
    var params = new URLSearchParams(search);
    var next = emptyFilters();
    LIST_FILTERS.forEach(function (key) {
      var picked = params.getAll(key);
      next[key] = allowed[key].filter(function (value) {
        return picked.indexOf(value) !== -1;
      });
    });
    SINGLE_FILTERS.forEach(function (key) {
      var value = params.get(key);
      if (value && allowed[key].indexOf(value) !== -1) next[key] = value;
    });
    next.verifiedOnly = params.get("verifiedOnly") === "true";
    return next;
  }

  /** The filters as the search's query string (also the page's own). Repeated keys, as the API takes lists. */
  function filtersToQuery() {
    var params = new URLSearchParams();
    LIST_FILTERS.forEach(function (key) {
      filters[key].forEach(function (value) {
        params.append(key, value);
      });
    });
    SINGLE_FILTERS.forEach(function (key) {
      if (filters[key]) params.set(key, filters[key]);
    });
    if (filters.verifiedOnly) params.set("verifiedOnly", "true");
    return params.toString();
  }

  /** Adds or removes `value`, keeping the display order. */
  function toggle(key, value) {
    var on = filters[key].indexOf(value) === -1;
    filters[key] = allowed[key].filter(function (v) {
      return v === value ? on : filters[key].indexOf(v) !== -1;
    });
  }

  /** The page URL (and the language switch) carry the filters, so a reload or the other language keeps them. */
  function syncUrl(query) {
    var suffix = query ? "?" + query : "";
    window.history.replaceState(null, "", window.location.pathname + suffix + window.location.hash);
    document.querySelectorAll(".site-nav__lang a").forEach(function (link) {
      link.setAttribute("href", link.getAttribute("href").split("?")[0] + suffix);
    });
  }

  function renderControls() {
    quickChips.forEach(function (chip) {
      var area = chip.getAttribute("data-quick-area");
      var pressed = area ? filters.areas.indexOf(area) !== -1 : filters.areas.length === 0;
      chip.setAttribute("aria-pressed", String(pressed));
    });
    sheetChips.forEach(function (chip) {
      var key = chip.getAttribute("data-filter");
      var value = chip.getAttribute("data-value");
      var pressed = LIST_FILTERS.indexOf(key) !== -1 ? filters[key].indexOf(value) !== -1 : filters[key] === value;
      chip.setAttribute("aria-pressed", String(pressed));
    });
    verifiedSwitch.checked = filters.verifiedOnly;

    var active = activeFilterCount();
    badge.hidden = active === 0;
    badge.textContent = String(active);
    openFilters.setAttribute(
      "aria-label",
      active > 0 ? format(STRINGS["filters.openWithCount"], { count: active }) : STRINGS["filters.open"]
    );
    sheet.querySelectorAll("[data-clear-filters]").forEach(function (button) {
      button.hidden = active === 0;
    });
  }

  /** Every change applies at once (like the app's sheet) and refetches. */
  function applyFilters() {
    renderControls();
    syncUrl(filtersToQuery());
    load();
  }

  function clearFilters() {
    filters = emptyFilters();
    applyFilters();
  }

  quickChips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      var area = chip.getAttribute("data-quick-area");
      if (area) toggle("areas", area);
      else filters.areas = [];
      applyFilters();
    });
  });

  sheetChips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      var key = chip.getAttribute("data-filter");
      var value = chip.getAttribute("data-value");
      if (LIST_FILTERS.indexOf(key) !== -1) toggle(key, value);
      // A single-choice group: "Any" clears it, and tapping the active value again does too.
      else filters[key] = value && filters[key] !== value ? value : "";
      applyFilters();
    });
  });

  verifiedSwitch.addEventListener("change", function () {
    filters.verifiedOnly = verifiedSwitch.checked;
    applyFilters();
  });

  // The sheet's own clear button and the filtered-empty state's (cloned in later).
  document.addEventListener("click", function (event) {
    if (event.target.closest("[data-clear-filters]")) clearFilters();
    else if (event.target.closest("[data-retry]")) load();
  });

  if (typeof sheet.showModal === "function") {
    openFilters.addEventListener("click", function () {
      sheet.showModal();
    });
    sheet.querySelectorAll("[data-close-filters]").forEach(function (button) {
      button.addEventListener("click", function () {
        sheet.close();
      });
    });
    // A click on the backdrop lands on the <dialog> itself (the panel fills it).
    sheet.addEventListener("click", function (event) {
      if (event.target === sheet) sheet.close();
    });
  } else {
    // No modal dialog support: the area chips still narrow the list.
    openFilters.hidden = true;
  }

  // ---------------------------------------------------------------------------
  // Loading the list
  // ---------------------------------------------------------------------------

  var requestId = 0;
  var inFlight = null;
  var showingCards = false;

  function showState(name) {
    status.textContent = "";
    if (!name) return;
    status.appendChild(statesTemplate.querySelector('[data-state="' + name + '"]').cloneNode(true));
  }

  function load() {
    requestId += 1;
    var id = requestId;
    if (inFlight) inFlight.abort();
    var controller = window.AbortController ? new AbortController() : null;
    inFlight = controller;
    var timer = controller
      ? window.setTimeout(function () {
          controller.abort();
        }, REQUEST_TIMEOUT_MS)
      : 0;

    // The previous answer stays up (dimmed) while the new one loads; its count is
    // withheld, since it isn't the new answer (as in the app).
    count.textContent = "";
    if (showingCards) {
      grid.classList.add("is-stale");
      grid.setAttribute("aria-busy", "true");
      showState("updating");
    } else {
      showState("loading");
    }

    var query = filtersToQuery();
    window
      .fetch(searchUrl + (query ? "?" + query : ""), {
        headers: { Accept: "application/json" },
        credentials: "omit",
        signal: controller ? controller.signal : undefined,
      })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (body) {
        if (id !== requestId) return;
        if (!body || body.success !== true || !Array.isArray(body.data)) throw new Error("Unexpected response");
        showResults(body.data);
      })
      .catch(function () {
        // A superseded request (including the abort above) is not an error.
        if (id === requestId) showError();
      })
      .then(function () {
        window.clearTimeout(timer);
      });
  }

  function showResults(providers) {
    var cards = providers.map(renderCard).filter(Boolean);
    grid.textContent = "";
    cards.forEach(function (card) {
      grid.appendChild(card);
    });
    grid.classList.remove("is-stale");
    grid.removeAttribute("aria-busy");
    showingCards = cards.length > 0;
    count.textContent = plural("count", cards.length);
    if (cards.length > 0) showState(null);
    else showState(activeFilterCount() > 0 ? "empty-filtered" : "empty");
  }

  /** A failed load is never shown as an empty result: the cards go, and Retry replaces them. */
  function showError() {
    grid.textContent = "";
    grid.classList.remove("is-stale");
    grid.removeAttribute("aria-busy");
    showingCards = false;
    count.textContent = "";
    showState("error");
  }

  // ---------------------------------------------------------------------------
  // One card (app: ProviderPhotoCard)
  // ---------------------------------------------------------------------------

  var text = function (value) {
    return typeof value === "string" ? value.trim() : "";
  };

  var number = function (value) {
    return typeof value === "number" && isFinite(value) ? value : 0;
  };

  function isHttpsUrl(value) {
    if (typeof value !== "string") return false;
    try {
      return new URL(value).protocol === "https:";
    } catch (error) {
      return false;
    }
  }

  /** As the app's Avatar fallback: first + last initial, or a single name's first two letters. */
  function initials(name) {
    var parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join("").toUpperCase();
    return (Array.from(parts[0])[0] + Array.from(parts[parts.length - 1])[0]).toUpperCase();
  }

  function slot(card, name) {
    return card.querySelector('[data-slot="' + name + '"]');
  }

  function renderCard(provider) {
    if (!provider || typeof provider.userId !== "string" || !PROVIDER_ID.test(provider.userId)) return null;
    var card = cardTemplate.cloneNode(true);
    var displayName = text(provider.displayName);
    var href = profileHref + "?id=" + encodeURIComponent(provider.userId);

    var link = slot(card, "link");
    link.href = href;
    link.textContent = displayName || STRINGS["card.unnamed"];

    var images = Array.isArray(provider.images) ? provider.images.filter(isHttpsUrl) : [];
    if (images.length > 0) renderPhotos(card, images, href);

    renderPrice(card, provider.prestige);
    renderAvatar(card, provider.avatarUrl, displayName);
    renderPills(card, provider);
    renderMeta(card, provider);
    return card;
  }

  /** The gallery as a swipeable strip; each photo is its own (unfocusable) link to the profile. */
  function renderPhotos(card, images, href) {
    var track = card.querySelector(".pcard__track");
    images.forEach(function (url) {
      var slide = document.createElement("a");
      slide.className = "pcard__slide";
      slide.href = href;
      slide.tabIndex = -1;
      slide.setAttribute("aria-hidden", "true");
      var img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.src = url;
      slide.appendChild(img);
      track.appendChild(slide);
    });
    track.hidden = false;
    card.querySelector(".pcard__placeholder").hidden = true;
    if (images.length < 2) return;

    var dotsRow = card.querySelector(".pcard__dots");
    var dots = images.map(function () {
      var dot = document.createElement("span");
      dot.className = "pcard__dot";
      dotsRow.appendChild(dot);
      return dot;
    });
    dotsRow.hidden = false;
    var prev = card.querySelector(".pcard__nav--prev");
    var next = card.querySelector(".pcard__nav--next");
    prev.hidden = false;
    next.hidden = false;

    // scrollLeft is negative in RTL, so the page is read from its magnitude.
    var showPage = function (index) {
      dots.forEach(function (dot, i) {
        dot.classList.toggle("is-active", i === index);
      });
      prev.disabled = index === 0;
      next.disabled = index === images.length - 1;
    };
    var pending = false;
    track.addEventListener(
      "scroll",
      function () {
        if (pending) return;
        pending = true;
        window.requestAnimationFrame(function () {
          pending = false;
          showPage(Math.round(Math.abs(track.scrollLeft) / (track.clientWidth || 1)));
        });
      },
      { passive: true }
    );
    var page = function (step) {
      track.scrollBy({ left: step * (isRtl ? -1 : 1) * track.clientWidth, behavior: reduceMotion ? "auto" : "smooth" });
    };
    prev.addEventListener("click", function () {
      page(-1);
    });
    next.addEventListener("click", function () {
      page(1);
    });
    showPage(0);
  }

  /** "$" / "$$" / "$$$": the active tiers in brand blue, the rest dimmed (app: PrestigeBadge). */
  function renderPrice(card, prestige) {
    var level = PRESTIGE_LEVELS.indexOf(prestige);
    var pill = card.querySelector(".pcard__price");
    if (level === -1) {
      pill.hidden = true;
      return;
    }
    card.querySelectorAll(".pcard__price-glyphs span").forEach(function (glyph, i) {
      glyph.classList.toggle("is-active", i <= level);
    });
    slot(card, "price").textContent = format(STRINGS["card.priceLevel"], { level: prestige });
  }

  function renderAvatar(card, url, name) {
    var avatar = card.querySelector(".pcard__avatar");
    var showInitials = function () {
      avatar.textContent = initials(name);
    };
    if (!isHttpsUrl(url)) {
      showInitials();
      return;
    }
    var img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", showInitials);
    img.src = url;
    avatar.appendChild(img);
  }

  /** The branded type paw pill and the verified badge — the row goes when neither applies. */
  function renderPills(card, provider) {
    var typeKey = "type." + provider.providerType;
    var type = slot(card, "type");
    if (typeof provider.providerType === "string" && has(STRINGS, typeKey)) {
      type.querySelector("img").src = "/assets/img/providers/paw-" + provider.providerType + ".png";
      type.querySelector("span").textContent = STRINGS[typeKey];
      type.hidden = false;
    }
    var verified = provider.isVerified === true;
    slot(card, "verified").hidden = !verified;
    card.querySelector(".pcard__pills").hidden = type.hidden && !verified;
  }

  /** ONE meta line: rating (count) · area · completed bookings; missing facts drop out. */
  function renderMeta(card, provider) {
    var rating = number(provider.ratingAverage);
    var reviews = Math.max(0, Math.round(number(provider.ratingCount)));
    var stars = card.querySelector(".pcard__stars");
    for (var star = 1; star <= MAX_RATING; star += 1) {
      var name = rating >= star ? "star" : rating >= star - 0.5 ? "star-half" : "star-outline";
      var glyph = document.createElement("span");
      if (name === "star-half") glyph.className = "is-half";
      glyph.appendChild(ICONS[name].cloneNode(true));
      stars.appendChild(glyph);
    }
    card.querySelector(".pcard__rating-value").textContent = (rating > 0 ? rating.toFixed(1) : "—") + " (" + reviews + ")";
    slot(card, "rating").textContent =
      rating > 0
        ? format(STRINGS["card.rating"], { value: rating.toFixed(1), max: MAX_RATING, count: reviews })
        : STRINGS["card.ratingEmpty"];

    var areaKey = "area." + provider.area;
    if (typeof provider.area === "string" && has(STRINGS, areaKey)) {
      var area = slot(card, "area");
      area.querySelector("span").textContent = STRINGS[areaKey];
      area.hidden = false;
    }

    var completed = Math.max(0, Math.round(number(provider.completedBookings)));
    if (completed > 0) {
      var done = slot(card, "completed");
      done.querySelector("span").textContent = plural("card.completed", completed);
      done.hidden = false;
    }
  }

  renderControls();
  load();
})();
