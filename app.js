(function () {
  "use strict";

  // ============================================================
  // JSON-CONTROLLED DATA LOADING
  // All content lives under sections/<remedies|diy|recipes>/ as a
  // manifest.json (labels/icons/category list) plus one JSON file per
  // sub-section (category), each holding {label, icon, items:[...]}.
  // Shared icon/diagram SVG fragments live in assets/icons.json and
  // assets/diagrams.json. This file fetches all of that, reshapes it
  // into the same in-memory shape the renderer expects, then renders.
  //
  // NOTE: fetch() of local files is blocked by the browser's CORS
  // rules when this page is opened directly as a file:// URL in most
  // browsers. Serve this folder over HTTP - e.g. run
  //   python3 -m http.server
  // from this folder and open http://localhost:8000/ - or host it on
  // any static web host (GitHub Pages, Netlify, etc).
  // ============================================================

  var SECTIONS = [
    { key: "tips", folder: "sections/remedies" },
    { key: "diy", folder: "sections/diy" },
    { key: "recipes", folder: "sections/recipes" },
    { key: "traditions", folder: "sections/traditions" }
  ];

  function slugify(text) {
    return String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function fetchJSON(path) {
    return fetch(path).then(function (res) {
      if (!res.ok) throw new Error("Failed to load " + path + " (" + res.status + ")");
      return res.json();
    });
  }

  function normalizeItem(raw, tabKey) {
    var item = {
      slug: slugify(raw.heading),
      title: raw.heading,
      emergency: !!raw.emergency,
      diagram: raw.diagram || null,
      precautions: raw.precautionsFirst || [],
      steps: raw.details || [],
      images: raw.images || [],
      icon: raw.icon || null
    };
    if (tabKey === "recipes") {
      if (typeof raw.veg === "boolean") item.veg = raw.veg;
      if (raw.type) item.type = raw.type;
    }
    return item;
  }

  function loadCategoryFile(folder, file, tabKey) {
    return fetchJSON(folder + "/" + file).then(function (json) {
      return {
        label: json.label,
        icon: json.icon,
        items: (json.items || []).map(function (it) { return normalizeItem(it, tabKey); })
      };
    });
  }

  // Loading is split into two phases so the page can render the first
  // tab as soon as possible instead of waiting on every section:
  //   1. fetchManifest() - just the small manifest.json per section
  //      (label, icon, and the list of category files - no item data).
  //      Cheap enough to fetch for all sections up front, so every tab
  //      button can appear immediately.
  //   2. loadTabCategories() - the actual category/item JSON files for
  //      one section. This is the expensive part (recipes alone is 200+
  //      files), so it's only run for the active tab first; the other
  //      tabs are loaded afterwards, in the background, without
  //      blocking the initial render.
  function fetchManifest(section) {
    return fetchJSON(section.folder + "/manifest.json").then(function (manifest) {
      return { key: manifest.key, folder: section.folder, label: manifest.label, icon: manifest.icon, manifest: manifest };
    });
  }

  function loadTabCategories(meta) {
    var manifest = meta.manifest;
    var catPromises = manifest.categories.map(function (cat) {
      if (cat.subcategories && cat.subcategories.length) {
        var subPromises = cat.subcategories.map(function (sub) {
          return loadCategoryFile(meta.folder, sub.file, meta.key).then(function (loaded) {
            return {
              slug: sub.slug,
              label: loaded.label || sub.label,
              icon: loaded.icon || sub.icon,
              items: loaded.items
            };
          });
        });
        return Promise.all(subPromises).then(function (subcategories) {
          return { slug: cat.slug, label: cat.label, icon: cat.icon, items: [], subcategories: subcategories };
        });
      }
      return loadCategoryFile(meta.folder, cat.file, meta.key).then(function (loaded) {
        return {
          slug: cat.slug,
          label: loaded.label || cat.label,
          icon: loaded.icon || cat.icon,
          items: loaded.items,
          region: cat.region || null
        };
      });
    });
    return Promise.all(catPromises).then(function (categories) {
      return {
        key: meta.key,
        folder: meta.folder,
        label: meta.label,
        icon: meta.icon,
        categories: categories,
        loaded: true
      };
    });
  }

  function placeholderTab(meta) {
    return { key: meta.key, folder: meta.folder, label: meta.label, icon: meta.icon, categories: [], loaded: false };
  }

  // ============================================================
  // CONFIG: the Google Apps Script endpoint, "Our Other Sites" list,
  // Disclaimer text, and Privacy Policy text all live as JSON under
  // config/, so they can be edited without touching this script.
  // Fetched once, in parallel with the section data, right away.
  // ============================================================
  var CONFIG = { appsScriptEndpoint: "", otherSitesIntro: "", otherSites: [], disclaimer: null, privacyPolicy: null, cookies: null, feedback: null };
  function loadConfig() {
    return Promise.all([
      fetchJSON("config/settings.json").catch(function () { return {}; }),
      fetchJSON("config/other-sites.json").catch(function () { return {}; }),
      fetchJSON("config/disclaimer.json").catch(function () { return null; }),
      fetchJSON("config/privacy-policy.json").catch(function () { return null; }),
      fetchJSON("config/cookies.json").catch(function () { return null; }),
      fetchJSON("config/feedback.json").catch(function () { return null; })
    ]).then(function (results) {
      var settings = results[0] || {};
      var otherSites = results[1] || {};
      CONFIG.appsScriptEndpoint = settings.appsScriptEndpoint || "";
      CONFIG.otherSitesIntro = otherSites.intro || "";
      CONFIG.otherSites = otherSites.sites || [];
      CONFIG.disclaimer = results[2];
      CONFIG.privacyPolicy = results[3];
      CONFIG.cookies = results[4];
      CONFIG.feedback = results[5];
    });
  }
  var configReady = loadConfig();

  // ============================================================
  // RENDERER (unchanged from the original single-file app, operating
  // on the DATA object assembled above instead of an embedded blob).
  // ============================================================

  var mainEl = document.querySelector("main");
  var tabsEl = document.getElementById("tabs");
  var contentEl = document.getElementById("content");
  var emptyEl = document.getElementById("emptyState");
  var loadingEl = document.getElementById("loadingState");
  var searchInput = document.getElementById("search");
  var searchClearBtn = document.getElementById("searchClear");
  var searchTagsEl = document.getElementById("searchTags");
  var resultCount = document.getElementById("resultcount");
  var toggleAllBtn = document.getElementById("toggleAllBtn");
  var mastheadTitleEl = document.getElementById("mastheadTitle");
  var mastheadLogoEl = document.getElementById("mastheadLogo");

  function syncMastheadLogoHeight() {
    if (!mastheadTitleEl || !mastheadLogoEl) return;
    var h = mastheadTitleEl.getBoundingClientRect().height;
    if (h > 0) {
      mastheadLogoEl.style.height = h + "px";
      mastheadLogoEl.style.width = h + "px";
    }
  }
  syncMastheadLogoHeight();
  window.addEventListener("resize", syncMastheadLogoHeight);
  window.addEventListener("load", syncMastheadLogoHeight);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncMastheadLogoHeight);
  }

  var dietRow = document.getElementById("dietRow");
  var recipeScopeTabs = document.getElementById("recipeScopeTabs");
  var vegToggle = document.getElementById("vegToggle");
  var typeChips = document.getElementById("typeChips");

  var DATA = { tabs: [], icons: {}, diagrams: {}, maps: null };
  var state = { tabKey: null, query: "", searchTags: [], expandedAll: {}, vegFilter: "all", typeFilter: "", recipeScope: "india" };
  var built = {};
  var tabByKey = {};
  var tabMetaByKey = {};
  var tabLoadPromises = {};

  // Fetches (or reuses an in-flight fetch of) one tab's full category/item
  // data. Called both by the background loader after the first tab
  // renders, and by showTab() when the person switches to a tab that
  // hasn't loaded yet - so clicking ahead jumps that tab to the front
  // instead of waiting behind the background queue.
  function ensureTabLoaded(key) {
    if (tabLoadPromises[key]) return tabLoadPromises[key];
    var meta = tabMetaByKey[key];
    if (!meta) return Promise.resolve();
    var promise = loadTabCategories(meta).then(function (loadedTab) {
      tabByKey[loadedTab.key] = loadedTab;
      var i = DATA.tabs.findIndex(function (t) { return t.key === loadedTab.key; });
      if (i !== -1) DATA.tabs[i] = loadedTab;
      delete built[loadedTab.key];
      if (state.tabKey === loadedTab.key) showTab(loadedTab.key);
      return loadedTab;
    }).catch(function (err) {
      console.error("Failed to load section " + key + ":", err);
      delete tabLoadPromises[key]; // allow a retry on the next visit to this tab
      throw err;
    });
    tabLoadPromises[key] = promise;
    return promise;
  }

  function icon(key) { return DATA.icons[key] || ""; }

  // A recipe category's outline map: DATA.maps.india/world hold a slug ->
  // SVG path "d" string, all sharing one viewBox, generated from public
  // country/state boundary data at build time (see build/build_maps.js).
  function mapPathFor(cat) {
    if (!DATA.maps || !cat.region) return null;
    var bucket = cat.region === "india" ? DATA.maps.india : DATA.maps.world;
    return (bucket && bucket[cat.slug]) || null;
  }
  function compositeId(tabKey, catSlug, itemSlug) { return tabKey + "__" + catSlug + "__" + itemSlug; }

  var ARROW_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="square" stroke-linejoin="miter"><polyline points="4 8 12 16 20 8"></polyline></svg>';
  var CAT_ARROW_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="square" stroke-linejoin="miter"><polyline points="8 4 16 12 8 20"></polyline></svg>';

  // Dish-type -> icon key, for the small type badge shown next to the
  // veg/non-veg dot on each recipe item (see buildCard()). Reuses a few
  // existing icons (cook/flame/leaf/jar) where they already fit.
  var TYPE_ICON = {
    "Curry": "cook",
    "Fry": "type-fry",
    "Rice": "type-rice",
    "Sweet": "type-sweet",
    "Tiffin/Snack": "type-snack",
    "Soup/Stew": "type-soup",
    "Bread/Flatbread": "type-bread",
    "Salad": "leaf",
    "Beverage": "type-beverage",
    "Pickle/Chutney": "jar",
    "Dal/Lentil": "type-dal",
    "Dumpling": "type-dumpling",
    "Noodles/Pasta": "type-noodles",
    "Grill/Roast": "flame",
    "Baked/Pastry": "type-pastry",
    "Porridge/Grain": "type-porridge",
    "Other": "type-other"
  };

  // Adds the matching dish-type icon to each filter chip (so the filter
  // row shows the same glyph used on item rows), once icons are loaded.
  // The "All" chip (empty data-type) is left as plain text.
  function populateTypeChipIcons() {
    if (!typeChips) return;
    Array.prototype.forEach.call(typeChips.querySelectorAll(".chip[data-type]"), function (chip) {
      var type = chip.dataset.type;
      if (!type || !TYPE_ICON[type] || chip.querySelector("svg")) return;
      var iconSpan = document.createElement("span");
      iconSpan.className = "chip-icon";
      iconSpan.innerHTML = icon(TYPE_ICON[type]);
      iconSpan.setAttribute("aria-hidden", "true");
      chip.insertBefore(iconSpan, chip.firstChild);
    });
  }

  function buildCard(tabKey, cat, item, idx, labelPath) {
    var det = document.createElement("details");
    det.className = "card";
    det.id = compositeId(tabKey, cat.slug, item.slug);
    var searchText = (item.title + " " + (labelPath || "")).toLowerCase();
    det.dataset.text = searchText;
    if (typeof item.veg === "boolean") det.dataset.veg = item.veg ? "veg" : "nonveg";
    if (item.type) det.dataset.type = item.type;

    var summary = document.createElement("summary");
    var numSpan = document.createElement("span");
    numSpan.className = "item-num row-icon-fall";
    numSpan.textContent = (idx + 1) + ".";
    summary.appendChild(numSpan);
    if (typeof item.veg === "boolean") {
      var vegWrap = document.createElement("span");
      vegWrap.className = "item-veg";
      vegWrap.title = item.veg ? "Vegetarian" : "Non-vegetarian";
      var vegDot = document.createElement("span");
      vegDot.className = "veg-dot " + (item.veg ? "veg" : "nonveg");
      vegWrap.appendChild(vegDot);
      summary.appendChild(vegWrap);
    }
    if (item.type && TYPE_ICON[item.type]) {
      var typeWrap = document.createElement("span");
      typeWrap.className = "item-type";
      typeWrap.title = item.type;
      typeWrap.innerHTML = icon(TYPE_ICON[item.type]);
      summary.appendChild(typeWrap);
    }
    if (item.icon) {
      var itemIconWrap = document.createElement("span");
      itemIconWrap.className = "item-icon row-icon-fall";
      itemIconWrap.innerHTML = icon(item.icon);
      summary.appendChild(itemIconWrap);
    }
    var titleSpan = document.createElement("span");
    titleSpan.textContent = item.title;
    summary.appendChild(titleSpan);
    if (item.emergency) {
      var badge = document.createElement("span");
      badge.className = "badge-em";
      badge.textContent = "Emergency";
      summary.appendChild(badge);
    }
    var chev = document.createElement("span");
    chev.className = "chev";
    chev.innerHTML = ARROW_ICON;
    summary.appendChild(chev);
    det.appendChild(summary);

    var panel = document.createElement("div");
    panel.className = "panel";

    if (item.images && item.images.length) {
      var gal = document.createElement("div");
      gal.className = "gallery";
      item.images.forEach(function (img) {
        var el = document.createElement("img");
        el.src = img.src; el.alt = img.alt || item.title; el.loading = "lazy";
        gal.appendChild(el);
      });
      panel.appendChild(gal);
    }

    if (item.diagram && DATA.diagrams[item.diagram]) {
      var dwrap = document.createElement("div");
      dwrap.className = "diagram-wrap";
      var diagram = DATA.diagrams[item.diagram];
      dwrap.style.setProperty("--accent", diagram.accent === "tips" ? "var(--green-dark)" : "var(--brown-deep)");
      dwrap.innerHTML = diagram.svg;
      panel.appendChild(dwrap);
    }

    if (item.precautions && item.precautions.length) {
      var pbox = document.createElement("div");
      pbox.className = "box precaution";
      var h4 = document.createElement("h4");
      h4.innerHTML = icon("warn") + "Precautions first";
      pbox.appendChild(h4);
      var ul = document.createElement("ul");
      item.precautions.forEach(function (line) {
        var li = document.createElement("li"); li.textContent = line; ul.appendChild(li);
      });
      pbox.appendChild(ul);
      panel.appendChild(pbox);
    }

    var ol = document.createElement("ol");
    ol.className = "steps";
    (item.steps || []).forEach(function (line, i) {
      var li = document.createElement("li");
      var num = document.createElement("span"); num.className = "num"; num.textContent = String(i + 1);
      var txt = document.createElement("span"); txt.textContent = line;
      li.appendChild(num); li.appendChild(txt); ol.appendChild(li);
    });
    panel.appendChild(ol);

    det.appendChild(panel);
    return det;
  }

  function countCatItems(cat) {
    if (cat.subcategories && cat.subcategories.length) {
      return cat.subcategories.reduce(function (sum, sub) { return sum + sub.items.length; }, 0);
    }
    return cat.items.length;
  }

  function buildCatHead(cat, count, extraClass) {
    var head = document.createElement("summary");
    head.className = extraClass ? "cathead " + extraClass : "cathead";
    // A recipe category (state/country) shows its outline map instead of
    // the dish icon, since the dish icon is identical for every category.
    // Anything without a map (or outside Recipes) keeps the icon badge.
    var mapPath = mapPathFor(cat);
    if (mapPath) {
      var mapWrap = document.createElement("span");
      mapWrap.className = "map-badge";
      mapWrap.setAttribute("aria-hidden", "true");
      mapWrap.innerHTML = '<svg viewBox="' + DATA.maps.viewBox + '"><path d="' + mapPath + '"></path></svg>';
      head.appendChild(mapWrap);
    } else {
      var iconWrap = document.createElement("span");
      iconWrap.className = "icon-badge";
      iconWrap.innerHTML = icon(cat.icon);
      head.appendChild(iconWrap);
    }
    var h2 = document.createElement("h2");
    h2.textContent = cat.label;
    head.appendChild(h2);
    var countEl = document.createElement("span");
    countEl.className = "count";
    countEl.textContent = count + (count === 1 ? " item" : " items");
    head.appendChild(countEl);
    var chev = document.createElement("span");
    chev.className = "cat-chev";
    chev.innerHTML = CAT_ARROW_ICON;
    head.appendChild(chev);
    return head;
  }

  function buildTab(tab) {
    var container = document.createElement("div");
    var visibleCatIdx = 0;
    var palette = tab.key === "diy"
      ? ["var(--brown)", "var(--brown-alt)"]
      : tab.key === "recipes"
      ? ["var(--recipe)", "var(--recipe-alt)"]
      : tab.key === "traditions"
      ? ["var(--tradition)", "var(--tradition-alt)"]
      : ["var(--green-light)", "var(--green-light-alt)"];
    tab.categories.forEach(function (cat) {
      var hasSub = cat.subcategories && cat.subcategories.length;
      var totalCount = countCatItems(cat);
      if (!totalCount) return;

      var section = document.createElement("details");
      section.className = "category";
      section.dataset.cat = cat.slug;
      if (cat.region) section.dataset.region = cat.region;
      section.style.setProperty("--sec-color", palette[visibleCatIdx % 2]);
      visibleCatIdx++;
      section.appendChild(buildCatHead(cat, totalCount, null));

      var grid = document.createElement("div");
      grid.className = "grid";

      if (hasSub) {
        cat.subcategories.forEach(function (sub) {
          if (!sub.items.length) return;
          var subSection = document.createElement("details");
          subSection.className = "category subcategory";
          subSection.dataset.cat = sub.slug;
          subSection.style.setProperty("--sec-color", palette[visibleCatIdx % 2]);
          visibleCatIdx++;
          subSection.appendChild(buildCatHead(sub, sub.items.length, "subcat-head"));
          var subGrid = document.createElement("div");
          subGrid.className = "grid";
          sub.items.forEach(function (item, idx) { subGrid.appendChild(buildCard(tab.key, sub, item, idx, cat.label + " " + sub.label)); });
          subSection.appendChild(subGrid);
          grid.appendChild(subSection);
        });
      } else {
        cat.items.forEach(function (item, idx) { grid.appendChild(buildCard(tab.key, cat, item, idx, cat.label)); });
      }

      section.appendChild(grid);
      container.appendChild(section);
    });
    return container;
  }

  function buildTabButtons() {
    tabsEl.innerHTML = "";
    DATA.tabs.forEach(function (tab) {
      var btn = document.createElement("button");
      btn.dataset.tab = tab.key;
      btn.setAttribute("role", "tab");
      btn.innerHTML = icon(tab.icon) + "<span>" + tab.label + "</span>";
      btn.addEventListener("click", function () { showTab(tab.key); });
      tabsEl.appendChild(btn);
    });
  }

  function applyFilters() {
    var tabKey = state.tabKey;
    var container = built[tabKey];
    if (!container) return;
    var query = state.query.trim().toLowerCase();
    var tags = state.searchTags;
    var isRecipes = tabKey === "recipes";
    var searching = query !== "" || tags.length > 0 || (isRecipes && (state.vegFilter !== "all" || state.typeFilter !== ""));

    container.querySelectorAll("details.card").forEach(function (card) {
      var textOk = (query === "" || card.dataset.text.indexOf(query) !== -1) &&
        tags.every(function (t) { return card.dataset.text.indexOf(t.toLowerCase()) !== -1; });
      var vegOk = !isRecipes || state.vegFilter === "all" || card.dataset.veg === state.vegFilter;
      var typeOk = !isRecipes || state.typeFilter === "" || card.dataset.type === state.typeFilter;
      var scopeOk = true;
      if (isRecipes) {
        var topCat = card.closest("details.category");
        scopeOk = !topCat || !topCat.dataset.region || topCat.dataset.region === state.recipeScope;
      }
      card.hidden = !(textOk && vegOk && typeOk && scopeOk);
    });

    container.querySelectorAll("details.category").forEach(function (section) {
      var sectionVisibleCount = 0;
      section.querySelectorAll("details.card").forEach(function (card) {
        if (!card.hidden) sectionVisibleCount++;
      });
      section.hidden = sectionVisibleCount === 0;
      if (searching && sectionVisibleCount > 0) section.open = true;
    });

    var visibleTotal = 0;
    container.querySelectorAll("details.card").forEach(function (card) { if (!card.hidden) visibleTotal++; });

    emptyEl.hidden = visibleTotal !== 0;
    var showCount = searching || isRecipes;
    resultCount.textContent = !showCount ? "" : (visibleTotal + (visibleTotal === 1 ? " result" : " results"));
  }

  function tabTone(tabKey) {
    return tabKey === "diy" ? "var(--brown-deep)" : tabKey === "recipes" ? "var(--recipe-deep)" : tabKey === "traditions" ? "var(--tradition-deep)" : "var(--green-dark)";
  }

  function updateMastheadColor(tabKey) {
    var tone = tabTone(tabKey);
    document.documentElement.style.setProperty("--tab-tone", tone);
    if (mastheadTitleEl) mastheadTitleEl.style.color = tone;
  }

  function updateToggleAllUI(tabKey) {
    var isOpen = state.expandedAll[tabKey];
    toggleAllBtn.classList.toggle("is-open", isOpen);
    var label = isOpen ? "Collapse all sections" : "Expand all sections";
    toggleAllBtn.setAttribute("aria-label", label);
    toggleAllBtn.setAttribute("title", label);
    var tone = tabTone(tabKey);
    toggleAllBtn.style.color = tone;
    toggleAllBtn.style.borderColor = tone;
  }

  function toggleAll() {
    var tabKey = state.tabKey;
    var container = built[tabKey];
    if (!container) return;
    var nextOpen = !state.expandedAll[tabKey];
    state.expandedAll[tabKey] = nextOpen;
    container.querySelectorAll("details.category").forEach(function (section) {
      section.open = nextOpen;
    });
    updateToggleAllUI(tabKey);
  }

  function fallLikeLeaves(container) {
    if (!container || !window.Element || !Element.prototype.animate) return;
    var icons = container.querySelectorAll("details.category:not([hidden]) details.card:not([hidden]) .row-icon-fall");
    var i = 0;
    icons.forEach(function (el) {
      var idx = i++;
      var delay = (idx % 14) * 55;
      var drift = ((idx % 2 === 0) ? 1 : -1) * (12 + (idx % 4) * 5);
      var rot1 = 210 + (idx % 5) * 22;
      var rot2 = -26 + (idx % 3) * 12;
      try {
        el.animate([
          { transform: "translateY(-72vh) translateX(0) rotate(0deg)", opacity: 0, offset: 0 },
          { opacity: 1, offset: 0.16 },
          { transform: "translateY(-20vh) translateX(" + drift + "px) rotate(" + rot1 + "deg)", opacity: 1, offset: 0.58 },
          { transform: "translateY(-3vh) translateX(" + (-drift / 2) + "px) rotate(" + rot2 + "deg)", opacity: 1, offset: 0.85 },
          { transform: "translateY(0) translateX(0) rotate(0deg)", opacity: 1, offset: 1 }
        ], { duration: 780, delay: delay, easing: "cubic-bezier(.22,.61,.36,1)", fill: "both" });
      } catch (e) { /* animation is a progressive enhancement */ }
    });
  }

  function showTab(tabKey) {
    var tab = tabByKey[tabKey];
    if (!tab) return;
    state.tabKey = tabKey;
    mainEl.dataset.tabTheme = tabKey;

    Array.prototype.forEach.call(tabsEl.querySelectorAll("button"), function (btn) {
      var isActive = btn.dataset.tab === tabKey;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    dietRow.hidden = tabKey !== "recipes";
    recipeScopeTabs.hidden = tabKey !== "recipes";
    updateMastheadColor(tabKey);
    updateToggleAllUI(tabKey);

    if (!tab.loaded) {
      // Data for this tab hasn't arrived yet. Jump it to the front of
      // the loading queue (ensureTabLoaded reuses any fetch already in
      // flight) and show a lightweight loading state instead of an
      // empty/"no matches" screen; ensureTabLoaded re-calls showTab()
      // for whichever tab is active once its data lands.
      ensureTabLoaded(tabKey);
      contentEl.innerHTML = "";
      emptyEl.hidden = true;
      resultCount.textContent = "";
      if (loadingEl) {
        loadingEl.hidden = false;
        loadingEl.textContent = "Loading...";
      }
      return;
    }
    if (loadingEl) loadingEl.hidden = true;

    if (!built[tabKey]) built[tabKey] = buildTab(tab);
    contentEl.innerHTML = "";
    contentEl.appendChild(built[tabKey]);

    applyFilters();
    requestAnimationFrame(function () { fallLikeLeaves(built[tabKey]); });
  }

  var TAG_X_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>';

  function updateSearchClearVisibility() {
    searchClearBtn.hidden = searchInput.value === "";
  }

  function renderSearchTags() {
    searchTagsEl.innerHTML = "";
    state.searchTags.forEach(function (tag) {
      var pill = document.createElement("span");
      pill.className = "search-tag";
      pill.setAttribute("role", "listitem");
      var label = document.createElement("span");
      label.textContent = tag;
      pill.appendChild(label);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tag-remove";
      btn.dataset.tag = tag;
      btn.setAttribute("aria-label", "Remove keyword: " + tag);
      btn.title = "Remove keyword";
      btn.innerHTML = TAG_X_ICON;
      pill.appendChild(btn);
      searchTagsEl.appendChild(pill);
    });
    searchTagsEl.hidden = state.searchTags.length === 0;
  }

  function commitSearchTag() {
    var val = searchInput.value.trim();
    if (!val) return;
    var exists = state.searchTags.some(function (t) { return t.toLowerCase() === val.toLowerCase(); });
    if (!exists) state.searchTags.push(val);
    searchInput.value = "";
    state.query = "";
    updateSearchClearVisibility();
    renderSearchTags();
    applyFilters();
  }

  searchInput.addEventListener("input", function () {
    state.query = searchInput.value;
    updateSearchClearVisibility();
    applyFilters();
  });

  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitSearchTag();
    }
  });

  searchClearBtn.addEventListener("click", function () {
    searchInput.value = "";
    state.query = "";
    updateSearchClearVisibility();
    applyFilters();
    searchInput.focus();
  });

  searchTagsEl.addEventListener("click", function (e) {
    var btn = e.target.closest(".tag-remove");
    if (!btn) return;
    var tag = btn.dataset.tag;
    state.searchTags = state.searchTags.filter(function (t) { return t !== tag; });
    renderSearchTags();
    applyFilters();
  });

  toggleAllBtn.addEventListener("click", toggleAll);

  recipeScopeTabs.addEventListener("click", function (e) {
    var btn = e.target.closest(".scope-tab");
    if (!btn) return;
    state.recipeScope = btn.dataset.scope;
    Array.prototype.forEach.call(recipeScopeTabs.querySelectorAll(".scope-tab"), function (b) {
      b.classList.toggle("active", b === btn);
    });
    applyFilters();
  });

  vegToggle.addEventListener("click", function (e) {
    var btn = e.target.closest(".veg-btn");
    if (!btn) return;
    state.vegFilter = btn.dataset.veg;
    Array.prototype.forEach.call(vegToggle.querySelectorAll(".veg-btn"), function (b) {
      b.classList.toggle("active", b === btn);
    });
    applyFilters();
  });

  typeChips.addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (!chip) return;
    state.typeFilter = chip.dataset.type;
    Array.prototype.forEach.call(typeChips.querySelectorAll(".chip"), function (c) {
      c.classList.toggle("active", c === chip);
    });
    applyFilters();
  });

  // ============================================================
  // CONTRIBUTE + FEEDBACK
  // Both forms post to the SAME Google Apps Script Web App and the
  // SAME Google Sheet (see google-apps-script/feedback_apps_script.gs),
  // since they share an identical column layout:
  //   Date | Website | Name | Message | Status
  //   1. Create a Google Sheet with that header row.
  //   2. Extensions > Apps Script, paste in feedback_apps_script.gs,
  //      then Deploy > New deployment > Web app
  //      (Execute as: Me, Who has access: Anyone).
  //   3. Copy the deployed URL (ends in /exec) and paste it below.
  // Sent as form-encoded (URLSearchParams), not JSON, and with no
  // custom headers, so the request stays a CORS "simple request" -
  // Apps Script web apps don't handle a JSON POST's pre-flight
  // OPTIONS request, so this avoids that entirely.
  // ============================================================
  // The Apps Script endpoint, other-sites list, disclaimer, and privacy
  // policy text all live under config/ as JSON, loaded by loadConfig()
  // near the bottom of this file, so they can be edited without touching
  // this script. CONFIG is populated once configReady resolves.
  function contributeEndpoint() { return CONFIG.appsScriptEndpoint || ""; }

  function formatContribTimestamp(date) {
    var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var dd = String(date.getDate()).padStart(2, "0");
    var mmm = MONTHS[date.getMonth()];
    var yyyy = date.getFullYear();
    var HH = String(date.getHours()).padStart(2, "0");
    var MM = String(date.getMinutes()).padStart(2, "0");
    return dd + "-" + mmm + "-" + yyyy + " " + HH + ":" + MM;
  }

  var contributeForm = document.getElementById("contributeForm");
  if (contributeForm) {
    contributeForm.addEventListener("submit", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var form = e.target;
      var name = document.getElementById("contribName").value.trim();
      var section = document.getElementById("contribSection").value;
      var contribution = document.getElementById("contribText").value.trim();
      var statusEl = document.getElementById("contribStatus");
      if (!name || !section || !contribution) return false;

      // The sheet only has a single Message column, so Section and
      // Contribution are concatenated with a ":" delimiter before
      // sending. Field order matters here - it controls the order the
      // data arrives in on the receiving end (e.g. spreadsheet columns).
      var entry = {
        Date: formatContribTimestamp(new Date()),
        Website: form.querySelector('[name="Website"]').value,
        Name: name,
        Message: section + ":" + contribution,
        Status: form.querySelector('[name="Status"]').value
      };

      statusEl.textContent = "Sending...";
      statusEl.className = "contribute-status";

      configReady.then(function () {
        var endpoint = contributeEndpoint();
        if (endpoint) {
          fetch(endpoint, {
            method: "POST",
            body: new URLSearchParams(entry)
          }).then(function (res) {
            return res.json().catch(function () { return null; });
          }).then(function (body) {
            if (body && body.status !== "ok") {
              console.error("Contribution sheet update failed:", body);
            }
          }).catch(function (err) {
            console.error("Contribution request failed to reach the endpoint:", err);
          }).finally(function () {
            showContributeConfirmation(form);
          });
        } else {
          showContributeConfirmation(form);
        }
      });
    });
  }

  function showContributeConfirmation(form) {
    var section = form.closest(".contribute-section");
    var statusEl = form.querySelector("#contribStatus");
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.className = "contribute-status";
    }
    form.reset();
    section.open = false;
    var note = document.createElement("p");
    note.className = "contribute-confirm";
    note.textContent = "Thanks! Your contribution has been submitted for review.";
    section.parentNode.insertBefore(note, section.nextSibling);
    setTimeout(function () {
      if (note.parentNode) note.parentNode.removeChild(note);
    }, 4000);
  }

  // ============================================================
  // FOOTER: copyright, and the Disclaimer / Feedback / Cookies icons.
  // Each icon toggles a panel into one shared container, only one open
  // at a time. Feedback is sent to a Google Apps Script Web App the
  // same way as the Contribute form above (form-encoded fetch, no
  // custom headers). Cookies uses localStorage only, to remember the
  // visitor's choice - this app has no ads or trackers, so nothing
  // else is gated on it.
  // ============================================================
  var footerYearEl = document.getElementById("footerYear");
  if (footerYearEl) footerYearEl.textContent = String(new Date().getFullYear());

  var COOKIE_CONSENT_KEY = "diyCookieConsent";
  var footerPanel = document.getElementById("footerPanel");
  var cookieNotice = document.getElementById("cookieNotice");

  function setActiveFooterIcon(id) {
    document.querySelectorAll(".footer-icon").forEach(function (a) {
      a.classList.remove("active");
      a.setAttribute("aria-expanded", "false");
    });
    if (id) {
      var el = document.getElementById(id);
      el.classList.add("active");
      el.setAttribute("aria-expanded", "true");
    }
  }

  function scrollPanelIntoView() {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        footerPanel.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    });
  }

  function closeFooterPanel() {
    footerPanel.innerHTML = "";
    setActiveFooterIcon(null);
  }

  function paragraphsHtml(paragraphs) {
    return (paragraphs || []).map(function (p) { return "<p>" + p + "</p>"; }).join("");
  }

  function openDisclaimerPanel() {
    if (footerPanel.querySelector('[data-panel="disclaimer"]')) { closeFooterPanel(); return; }
    setActiveFooterIcon("disclaimerLink");
    footerPanel.innerHTML = '<div class="footer-panel" data-panel="disclaimer"><h3>Disclaimer</h3></div>';
    scrollPanelIntoView();
    configReady.then(function () {
      if (!footerPanel.querySelector('[data-panel="disclaimer"]')) return;
      var d = CONFIG.disclaimer || {};
      footerPanel.innerHTML =
        '<div class="footer-panel" data-panel="disclaimer">' +
        "<h3>" + (d.title || "Disclaimer") + "</h3>" +
        paragraphsHtml(d.paragraphs) +
        "</div>";
    });
  }

  function openPrivacyPolicyPanel() {
    if (footerPanel.querySelector('[data-panel="privacy"]')) { closeFooterPanel(); return; }
    setActiveFooterIcon("privacyLink");
    footerPanel.innerHTML = '<div class="footer-panel" data-panel="privacy"><h3>Privacy Policy</h3></div>';
    scrollPanelIntoView();
    configReady.then(function () {
      if (!footerPanel.querySelector('[data-panel="privacy"]')) return;
      var p = CONFIG.privacyPolicy || {};
      footerPanel.innerHTML =
        '<div class="footer-panel" data-panel="privacy">' +
        "<h3>" + (p.title || "Privacy Policy") + "</h3>" +
        paragraphsHtml(p.paragraphs) +
        "</div>";
    });
  }

  function showFeedbackConfirmation() {
    footerPanel.innerHTML =
      '<div class="footer-panel"><p class="panel-confirm">Your feedback has been fed back. Thanks!</p></div>';
    setActiveFooterIcon(null);
    setTimeout(function () {
      if (footerPanel.querySelector(".panel-confirm")) footerPanel.innerHTML = "";
    }, 2500);
  }

  function openFeedbackForm() {
    if (footerPanel.querySelector('[data-panel="feedback"]')) { closeFooterPanel(); return; }
    setActiveFooterIcon("feedbackLink");
    footerPanel.innerHTML = '<div class="footer-panel" data-panel="feedback"><h3>Feedback</h3></div>';
    scrollPanelIntoView();

    configReady.then(function () {
      if (!footerPanel.querySelector('[data-panel="feedback"]')) return;
      var f = CONFIG.feedback || {};
      footerPanel.innerHTML =
        '<div class="footer-panel" data-panel="feedback">' +
        "<h3>" + (f.title || "Feedback") + "</h3>" +
        (f.intro ? "<p>" + f.intro + "</p>" : "") +
        '<form id="feedbackForm" class="contribute-form">' +
        '<input type="hidden" name="Website" value="IntiGuttu.com">' +
        '<input type="hidden" name="Status" value="Open">' +
        '<input type="text" id="fbName" name="Name" placeholder="Your name" required maxlength="80">' +
        '<textarea id="fbMessage" name="Message" placeholder="Your feedback..." required maxlength="2000" rows="3"></textarea>' +
        '<div class="panel-actions">' +
        '<button type="submit" class="panel-btn primary">Submit Feedback</button>' +
        '<span id="fbStatus" class="panel-status"></span>' +
        "</div></form></div>";

      var feedbackFormEl = document.getElementById("feedbackForm");
      feedbackFormEl.addEventListener("submit", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var name = document.getElementById("fbName").value.trim();
        var message = document.getElementById("fbMessage").value.trim();
        var statusEl = document.getElementById("fbStatus");
        if (!name || !message) return false;

        var entry = {
          Date: formatContribTimestamp(new Date()),
          Website: "IntiGuttu.com",
          Name: name,
          Message: message,
          Status: "Open"
        };

        statusEl.textContent = "Sending...";
        var endpoint = contributeEndpoint();
        if (endpoint) {
          fetch(endpoint, {
            method: "POST",
            body: new URLSearchParams(entry)
          }).then(function (res) {
            return res.json().catch(function () { return null; });
          }).then(function (body) {
            if (body && body.status !== "ok") console.error("Feedback sheet update failed:", body);
          }).catch(function (err) {
            console.error("Feedback request failed to reach the endpoint:", err);
          }).finally(function () {
            showFeedbackConfirmation();
          });
        } else {
          showFeedbackConfirmation();
        }
      });
    });
  }

  function openCookiesPanel() {
    if (footerPanel.querySelector('[data-panel="cookies"]')) { closeFooterPanel(); return; }
    setActiveFooterIcon("cookiesLink");
    footerPanel.innerHTML = '<div class="footer-panel" data-panel="cookies"><h3>Cookies</h3></div>';
    scrollPanelIntoView();

    configReady.then(function () {
      if (!footerPanel.querySelector('[data-panel="cookies"]')) return;
      var c = CONFIG.cookies || {};
      var current = localStorage.getItem(COOKIE_CONSENT_KEY);
      var currentLine = current
        ? '<p>Current choice: <strong>' + (current === "accepted" ? "Accepted" : "Declined") + "</strong></p>"
        : "<p>No choice recorded yet in this browser.</p>";
      footerPanel.innerHTML =
        '<div class="footer-panel" data-panel="cookies">' +
        "<h3>" + (c.title || "Cookies") + "</h3>" +
        paragraphsHtml(c.paragraphs) +
        currentLine +
        '<div class="panel-actions">' +
        '<button type="button" id="cookiesPanelAccept" class="panel-btn primary">Accept</button>' +
        '<button type="button" id="cookiesPanelDecline" class="panel-btn">Decline</button>' +
        "</div></div>";

      document.getElementById("cookiesPanelAccept").addEventListener("click", function () {
        localStorage.setItem(COOKIE_CONSENT_KEY, "accepted");
        closeFooterPanel();
      });
      document.getElementById("cookiesPanelDecline").addEventListener("click", function () {
        localStorage.setItem(COOKIE_CONSENT_KEY, "declined");
        closeFooterPanel();
      });
    });
  }

  // Other-sites list now lives in config/other-sites.json (see loadConfig()).
  var LINK_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';
  var INFO_ICON =
    '<svg viewBox="0 0 24 24"><g transform="skewX(-10)">' +
    '<ellipse cx="12" cy="12" rx="8" ry="9" fill="none" stroke="currentColor" stroke-width="2.3"></ellipse>' +
    '<rect x="10.7" y="9.6" width="2.6" height="6.6" rx="0.5" fill="currentColor"></rect>' +
    '<rect x="8.9" y="15.4" width="6.2" height="1.7" rx="0.4" fill="currentColor"></rect>' +
    '<ellipse cx="12.1" cy="7.3" rx="1.5" ry="1.3" fill="currentColor"></ellipse>' +
    '</g></svg>';

  function openOtherSitesPanel() {
    if (footerPanel.querySelector('[data-panel="othersites"]')) { closeFooterPanel(); return; }
    setActiveFooterIcon("otherSitesLink");
    footerPanel.innerHTML = '<div class="footer-panel" data-panel="othersites"><h3>Our Other Sites</h3></div>';
    scrollPanelIntoView();

    configReady.then(function () {
      if (!footerPanel.querySelector('[data-panel="othersites"]')) return;
      var intro = CONFIG.otherSitesIntro || "";
      var sites = CONFIG.otherSites || [];
      var html =
        '<div class="footer-panel" data-panel="othersites">' +
        "<h3>Our Other Sites</h3>" +
        (intro ? "<p>" + intro + "</p>" : "");
      sites.forEach(function (site) {
        html +=
          '<div class="site-entry">' +
          '<a href="' + site.url + '" target="_blank" rel="noopener" class="site-link">' +
          site.name +
          "</a>" +
          '<button type="button" class="info-btn" data-info-toggle="' + site.id + '" aria-label="About ' + site.name + '" aria-expanded="false">' +
          INFO_ICON +
          "</button>" +
          "</div>" +
          '<div class="site-desc" data-desc="' + site.id + '" hidden><p>' + site.desc + "</p></div>";
      });
      html += "</div>";
      footerPanel.innerHTML = html;

      footerPanel.querySelectorAll("[data-info-toggle]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-info-toggle");
          var desc = footerPanel.querySelector('[data-desc="' + id + '"]');
          if (!desc) return;
          var isHidden = desc.hidden;
          desc.hidden = !isHidden;
          btn.setAttribute("aria-expanded", isHidden ? "true" : "false");
          if (isHidden) scrollPanelIntoView();
        });
      });
    });
  }

  document.getElementById("disclaimerLink").addEventListener("click", function (e) {
    e.preventDefault();
    openDisclaimerPanel();
  });
  var privacyLinkEl = document.getElementById("privacyLink");
  if (privacyLinkEl) {
    privacyLinkEl.addEventListener("click", function (e) {
      e.preventDefault();
      openPrivacyPolicyPanel();
    });
  }
  document.getElementById("feedbackLink").addEventListener("click", function (e) {
    e.preventDefault();
    openFeedbackForm();
  });
  document.getElementById("cookiesLink").addEventListener("click", function (e) {
    e.preventDefault();
    openCookiesPanel();
  });
  document.getElementById("otherSitesLink").addEventListener("click", function (e) {
    e.preventDefault();
    openOtherSitesPanel();
  });

  function showCookieNotice() { cookieNotice.classList.add("show"); }
  function hideCookieNotice() { cookieNotice.classList.remove("show"); }
  var cookieNoticeTextEl = document.getElementById("cookieNoticeText");
  configReady.then(function () {
    var c = CONFIG.cookies || {};
    if (cookieNoticeTextEl && c.noticeText) cookieNoticeTextEl.textContent = c.noticeText;
    try {
      if (!localStorage.getItem(COOKIE_CONSENT_KEY)) showCookieNotice();
    } catch (e) { /* localStorage unavailable - skip silently */ }
  });

  document.getElementById("cookieAccept").addEventListener("click", function () {
    localStorage.setItem(COOKIE_CONSENT_KEY, "accepted");
    hideCookieNotice();
  });
  document.getElementById("cookieDecline").addEventListener("click", function (e) {
    e.preventDefault();
    localStorage.setItem(COOKIE_CONSENT_KEY, "declined");
    hideCookieNotice();
  });

  // ============================================================
  // BOOTSTRAP: fetch every section's manifest (cheap) plus icons and
  // diagrams up front so all tab buttons appear right away, then load
  // only the first tab's full category/item data before rendering.
  // The remaining tabs load afterwards, one at a time in the
  // background, so a heavy section (Recipes has 200+ category files)
  // never delays the first screen the person sees.
  // ============================================================
  var manifestsPromise = Promise.all(SECTIONS.map(fetchManifest));
  var iconsPromise = fetchJSON("assets/icons.json");
  var diagramsPromise = fetchJSON("assets/diagrams.json");
  var mapsPromise = fetchJSON("assets/maps.json").catch(function () { return null; });

  Promise.all([manifestsPromise, iconsPromise, diagramsPromise, mapsPromise]).then(function (results) {
    var metas = results[0];
    DATA.icons = results[1];
    DATA.diagrams = results[2];
    DATA.maps = results[3];
    populateTypeChipIcons();
    DATA.tabs = metas.map(placeholderTab);
    DATA.tabs.forEach(function (tab) {
      tabByKey[tab.key] = tab;
      state.expandedAll[tab.key] = false;
    });
    metas.forEach(function (meta) { tabMetaByKey[meta.key] = meta; });
    buildTabButtons();

    if (!metas.length) {
      if (loadingEl) loadingEl.hidden = true;
      return;
    }

    var firstKey = metas[0].key;
    ensureTabLoaded(firstKey).then(function () {
      showTab(firstKey);

      // Load the rest of the tabs in the background, one at a time, so
      // Recipes' large file count doesn't compete for bandwidth with
      // whichever section the person switches to next. If the person
      // clicks ahead to one of these tabs first, ensureTabLoaded()
      // (called from showTab) starts it immediately and this loop just
      // reuses that same in-flight fetch instead of starting a second one.
      var rest = metas.slice(1);
      rest.reduce(function (chain, meta) {
        return chain.then(function () {
          return ensureTabLoaded(meta.key).catch(function () { /* already logged */ });
        });
      }, Promise.resolve());
    }).catch(function (err) {
      console.error("Failed to load first tab data:", err);
      if (loadingEl) {
        loadingEl.hidden = false;
        loadingEl.textContent = "Could not load app data. If you opened this file directly (file://), " +
          "serve this folder over HTTP instead - e.g. run \"python3 -m http.server\" here and open " +
          "http://localhost:8000/.";
      }
    });
  }).catch(function (err) {
    console.error("Failed to load app data:", err);
    if (loadingEl) {
      loadingEl.hidden = false;
      loadingEl.textContent = "Could not load app data. If you opened this file directly (file://), " +
        "serve this folder over HTTP instead - e.g. run \"python3 -m http.server\" here and open " +
        "http://localhost:8000/.";
    }
  });
})();
