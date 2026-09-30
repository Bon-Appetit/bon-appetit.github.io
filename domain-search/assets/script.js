$(function () {
  "use strict";

  // These values define where saved data and list metadata come from, plus the render batch size.
  const STORAGE_KEY = "domainSearch.savedSearches.v1";
  const META_URL =
    "https://raw.githubusercontent.com/Bon-Appetit/porn-domains/refs/heads/main/meta.json";
  const BATCH_SIZE = 100;
  const MAX_LIST_URL_LENGTH = 2048;
  const MAX_QUERY_LENGTH = 25600;
  const MAX_SEARCH_TERMS = 100;
  const MAX_TERM_LENGTH = 256;

  const $list = $("#listSelect");
  const $customUrl = $("#customListUrl");
  const $single = $("#searchInput");
  const $multi = $("#multiSearchInput");
  const $multiToggle = $("#multiSearchToggle");
  const $results = $("#results");
  const $resultsInfo = $("#resultsInfo");
  const $resultsActions = $("#resultsActions");
  const $resultsContainer = $("#resultsContainer");
  const $savedSearches = $("#savedSearches");
  const $savedSearchesCount = $("#savedSearchesCount");
  const $savedActions = $("#savedActions");
  let lastSearch = null;
  let loadMoreHandler = null;
  let searchFormVersion = 0;

  // Set up the page from its current browser state before loading the available lists.
  initializeTheme();
  bindEvents();
  renderSavedSearches();
  loadMetaData();

  // Use delegated clicks for result and saved-search buttons, since those are built on the fly.
  function bindEvents() {
    $("#darkModeToggle").on("click", cycleTheme);
    $("#searchBtn").on("click", runSearch);
    $("#permalinkBtn").on("click", copyPermalink);
    $("#multiSearchToggle").on("change", updateSearchMode);
    $("#listSelect").on("change", updateCustomList);
    $("#exactMatch").on("change", updateExactMatch);
    // Any form edit makes the last successful permalink stale.
    $(
      "#listSelect, #customListUrl, #searchInput, #multiSearchInput, #multiSearchToggle, #useRegex, #exactMatch, #highlightResults, #viewSelect, #sortSelect",
    ).on("input change", hidePermalink);
    $("#clearSavedBtn").on("click", clearSavedSearches);
    $("#exportSavedJsonBtn").on("click", () => exportSavedJson());
    $("#toTop").on("click", () =>
      window.scrollTo({ top: 0, behavior: "smooth" }),
    );

    $(window).on("scroll", function () {
      const scrolled = $(window).scrollTop() > 0;
      $(".app-header").toggleClass("is-scrolled", scrolled);
      $("#toTop").toggle($(window).scrollTop() > 200);
    });

    $("#searchInput, #multiSearchInput, #customListUrl").on(
      "keydown",
      function (event) {
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          this.id !== "multiSearchInput"
        ) {
          event.preventDefault();
          runSearch();
        }
      },
    );

    $resultsContainer.on("click", ".copy-btn", async function () {
      const value = $(this).closest("[data-result]").attr("data-result");
      if (value !== undefined)
        await copyText(value, "Copied result to clipboard.");
    });

    $resultsActions.on("click", "[data-action]", function () {
      const action = this.dataset.action;
      if (!lastSearch) return;
      if (action === "save") saveCurrentSearch();
      if (action === "export-json") exportCurrentJson();
      if (action === "export-text") exportCurrentText();
    });

    $savedSearches.on("click", "[data-saved-action]", function () {
      const id = this.dataset.id;
      const action = this.dataset.savedAction;
      if (action === "delete") deleteSavedSearch(id);
      if (action === "load") loadSavedSearch(id);
      if (action === "json") exportSavedJson(id);
    });

    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
    prefersDark.addEventListener?.("change", () => {
      if (($("#darkModeToggle").attr("data-mode") || "auto") === "auto") {
        applyTheme("auto", false);
      }
    });
  }

  // The automatic setting follows the operating system without saving a forced choice.
  function initializeTheme() {
    let mode = "auto";
    try {
      mode = localStorage.getItem("darkMode") || "auto";
    } catch (_) {
      // If storage is blocked, the system theme is still a good default.
    }
    if (mode === "enabled") mode = "dark";
    if (mode === "disabled") mode = "light";
    if (!["auto", "light", "dark"].includes(mode)) mode = "auto";
    applyTheme(mode, false);
  }

  function cycleTheme() {
    const modes = ["auto", "light", "dark"];
    const current = $("#darkModeToggle").attr("data-mode") || "auto";
    applyTheme(modes[(modes.indexOf(current) + 1) % modes.length], true);
  }

  function applyTheme(mode, persist) {
    const details = {
      auto: { label: "Automatic", icon: "bi-circle-half" },
      light: { label: "Light", icon: "bi-sun-fill" },
      dark: { label: "Dark", icon: "bi-moon-fill" },
    };
    const dark =
      mode === "dark" ||
      (mode === "auto" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    document.documentElement.setAttribute(
      "data-bs-theme",
      dark ? "dark" : "light",
    );
    $("#darkModeToggle")
      .attr("data-mode", mode)
      .attr(
        "aria-label",
        `${details[mode].label} theme. Activate to change theme.`,
      )
      .attr("title", `${details[mode].label} theme`)
      .find("i")
      .attr("class", `bi ${details[mode].icon}`);

    if (persist) {
      try {
        localStorage.setItem("darkMode", mode);
      } catch (_) {
        /* The theme still works without storage. */
      }
    }
  }

  // These helpers keep the visible controls in sync with the selected search mode.
  function updateSearchMode() {
    const multi = $multiToggle.is(":checked");
    $("#singleSearchGroup").toggleClass("d-none", multi);
    $("#multiSearchGroup").toggleClass("d-none", !multi);
  }

  function updateCustomList() {
    const custom = $list.val() === "custom";
    $customUrl.toggleClass("d-none", !custom);
    if (custom) $customUrl.trigger("focus");
  }

  function updateExactMatch() {
    const exact = $("#exactMatch").is(":checked");
    $("#useRegex, #highlightResults").prop("disabled", exact);
    if (exact) {
      $("#useRegex, #highlightResults").prop("checked", false);
    }
  }

  // List names and URLs come from the remote metadata file; custom URLs remain available if it fails.
  async function loadMetaData() {
    try {
      const response = await fetch(META_URL);
      if (!response.ok) throw new Error("Could not fetch list metadata.");
      const meta = await response.json();
      if (!meta || typeof meta !== "object")
        throw new Error("Invalid list metadata.");

      $list.empty();
      const $group = $("<optgroup>").attr("label", "Bon-Appetit/porn-domains");
      if (meta.blocklist) {
        $group.append(
          $("<option>")
            .val(meta.blocklist.raw_url)
            .text(`${meta.blocklist.name} ("Blocklist")`),
        );
      }
      if (meta.allowlist) {
        $group.append(
          $("<option>")
            .val(meta.allowlist.raw_url)
            .text(`${meta.allowlist.name} ("Allowlist")`),
        );
      }
      $list.append($group);
      $list.append($("<option>").val("custom").text("Custom list (enter URL)"));

      restorePermalink();
      updateCustomList();
    } catch (error) {
      $list
        .empty()
        .append(
          $("<option>")
            .val("")
            .prop("disabled", true)
            .text("Could not load lists"),
        )
        .append($("<option>").val("custom").text("Custom list (enter URL)"));
      restorePermalink();
      showToast(
        "Could not load the available lists. You can still enter a custom list URL.",
        "warning",
      );
    }
  }

  // Restore a shared search only after the list options have finished loading.
  function restorePermalink() {
    const params = new URLSearchParams(window.location.search);
    const listUrl = params.get("list");
    const query = params.get("q");
    if (!listUrl || query === null) return;

    const exists = $list
      .find("option")
      .toArray()
      .some((option) => option.value === listUrl);
    if (exists) {
      $list.val(listUrl);
    } else {
      $list.val("custom");
      $customUrl.val(listUrl);
    }

    const multi = params.get("multi") === "true";
    $multiToggle.prop("checked", multi);
    (multi ? $multi : $single).val(query);
    updateSearchMode();

    $("#useRegex").prop("checked", params.get("regex") === "true");
    $("#exactMatch").prop("checked", params.get("exact") === "true");
    $("#highlightResults").prop("checked", params.get("highlight") !== "false");
    $("#viewSelect").val(params.get("view") === "list" ? "list" : "cards");
    $("#sortSelect").val(
      params.get("sort") === "alphabetical" ? "alphabetical" : "best",
    );
    updateExactMatch();
  }

  // Read and validate one form snapshot so matching and the permalink use the same options.
  // Ignore blank lines and read only the input mode that is currently active.
  function getFormState() {
    const selectedList = $list.val();
    let listUrl;
    if (selectedList === "custom") {
      const customUrl = $customUrl.val();
      if (
        typeof customUrl !== "string" ||
        customUrl.length > MAX_LIST_URL_LENGTH
      ) {
        throw new Error("The custom list URL is too long or invalid.");
      }
      listUrl = customUrl.trim();
    } else {
      const isAvailableList =
        typeof selectedList === "string" &&
        $list
          .find("option")
          .toArray()
          .some(
            (option) =>
              !option.disabled &&
              option.value !== "custom" &&
              option.value === selectedList,
          );
      if (!isAvailableList) {
        throw new Error("Choose a valid domain list.");
      }
      listUrl = selectedList;
    }

    const multi = $multiToggle.is(":checked");
    const searchText = (multi ? $multi : $single).val();
    if (
      typeof searchText !== "string" ||
      searchText.length > MAX_QUERY_LENGTH
    ) {
      throw new Error("Search terms are too long.");
    }

    const terms = searchText
      .split("\n")
      .map((term) => term.trim())
      .filter(Boolean);
    if (terms.length > MAX_SEARCH_TERMS) {
      throw new Error(`Use no more than ${MAX_SEARCH_TERMS} search terms.`);
    }
    if (terms.some((term) => term.length > MAX_TERM_LENGTH)) {
      throw new Error(
        `Each search term must be ${MAX_TERM_LENGTH} characters or fewer.`,
      );
    }

    const options = {
      multi,
      regex: $("#useRegex").is(":checked"),
      exact: $("#exactMatch").is(":checked"),
      highlight: $("#highlightResults").is(":checked"),
    };
    if (Object.values(options).some((value) => typeof value !== "boolean")) {
      throw new Error("Search options must be checkboxes.");
    }

    const view = $("#viewSelect").val();
    if (!["cards", "list"].includes(view)) {
      throw new Error("Choose a valid results display.");
    }
    const sort = $("#sortSelect").val();
    if (!["best", "alphabetical"].includes(sort)) {
      throw new Error("Choose a valid sort order.");
    }

    return {
      listUrl,
      terms,
      ...options,
      view,
      sort,
    };
  }

  // Take one snapshot so matching, sorting, and the resulting link use the same settings.
  async function runSearch() {
    hidePermalink();
    const formVersion = searchFormVersion;
    let state;
    try {
      state = getFormState();
    } catch (error) {
      showToast(error.message, "warning");
      return;
    }

    if (!state.listUrl) {
      showToast("Select a list or enter a custom list URL.", "warning");
      return;
    }
    if (!validHttpUrl(state.listUrl)) {
      showToast("The list URL must be a valid HTTP or HTTPS URL.", "warning");
      return;
    }
    if (!state.terms.length) {
      showToast("Enter at least one search term.", "warning");
      return;
    }

    let patterns;
    try {
      patterns = compilePatterns(state);
    } catch (error) {
      showToast(`Invalid regular expression: ${error.message}`, "danger");
      return;
    }

    setLoading(true);
    clearResults();

    try {
      const response = await fetch(state.listUrl);
      if (!response.ok)
        throw new Error(`The list request failed (${response.status}).`);
      const text = await response.text();
      const matches = findMatches(text, state, patterns);
      if (state.sort === "alphabetical") {
        matches.sort((a, b) => a.value.localeCompare(b.value));
      } else {
        matches.sort(
          (a, b) => b.matchCount - a.matchCount || a.index - b.index,
        );
      }

      lastSearch = {
        id: makeId(),
        createdAt: new Date().toISOString(),
        listUrl: state.listUrl,
        terms: state.terms,
        permalink: buildPermalink(state),
        options: {
          multi: state.multi,
          regex: state.regex,
          exact: state.exact,
          highlight: state.highlight,
          view: state.view,
          sort: state.sort,
        },
        results: matches.map((match) => ({
          value: match.value,
          matchCount: match.matchCount,
        })),
      };

      displayResults(matches, state);
      if (formVersion === searchFormVersion) {
        $("#permalinkBtn").prop("hidden", false);
      }
    } catch (error) {
      showToast(
        error.message || "Could not fetch the list. Please try again.",
        "danger",
      );
    } finally {
      setLoading(false);
      $results.attr("aria-busy", "false");
    }
  }

  function compilePatterns(state) {
    // Plain-text terms are escaped before building patterns; regex mode uses the input as written.
    if (state.exact) return [];
    if (state.regex) return state.terms.map((term) => new RegExp(term, "gi"));
    return state.terms.map(
      (term) => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
    );
  }

  // Count every hit on each trimmed line so relevance sorting has a simple score.
  function findMatches(text, state, patterns) {
    // Each non-empty line is one candidate, and its original position breaks relevance ties.
    const lines = text.split(/\r?\n/);
    const found = [];

    lines.forEach((raw, index) => {
      const value = raw.trim();
      if (!value) return;

      let matchCount = 0;
      if (state.exact) {
        const lower = value.toLocaleLowerCase();
        matchCount = state.terms.filter(
          (term) => lower === term.toLocaleLowerCase(),
        ).length;
      } else {
        patterns.forEach((pattern) => {
          // Global regular expressions remember their last position between lines.
          pattern.lastIndex = 0;
          const matches = value.match(pattern);
          if (matches) matchCount += matches.length;
        });
      }

      if (matchCount) found.push({ value, matchCount, index });
    });

    return found;
  }

  // Remove the old load-more listener as well as the result markup before a new search.
  function clearResults() {
    if (loadMoreHandler) {
      $("#loadMoreBtn").off("click", loadMoreHandler).remove();
      loadMoreHandler = null;
    }
    $resultsInfo.empty();
    $resultsActions.empty();
    $resultsContainer.empty();
  }

  function displayResults(matches, state) {
    // Summary and actions are refreshed even when the search has no matches.
    $resultsInfo.empty();
    $resultsContainer
      .toggleClass("result-grid", state.view === "cards")
      .toggleClass("result-list", state.view === "list");

    const summary = document.createElement("p");
    summary.className = "mb-2";
    summary.append(document.createTextNode("Found "));
    const count = document.createElement("span");
    count.className = "badge text-bg-primary";
    count.textContent = matches.length.toLocaleString();
    summary.append(
      count,
      document.createTextNode(matches.length === 1 ? " match" : " matches"),
    );
    $resultsInfo.append(summary);

    addActionButton("Save search", "save", "btn-success");
    addExportDropdown();

    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "alert alert-secondary";
      empty.textContent = "No matches found. Try another term or list.";
      $resultsContainer.append(empty);
      return;
    }

    let position = 0;
    // Add a small batch at a time so a long list does not freeze the page while rendering.
    const renderBatch = () => {
      const batch = matches.slice(position, position + BATCH_SIZE);
      position += batch.length;

      batch.forEach((match) => {
        const item = document.createElement("div");
        item.className =
          state.view === "cards" ? "result-card" : "result-list-item";
        item.dataset.result = match.value;

        const content = document.createElement("div");
        content.className =
          state.view === "cards" ? "result-card-inner" : "result-row";

        const value = document.createElement("p");
        value.className = "result-value";
        if (state.highlight && !state.exact) {
          appendHighlightedText(value, match.value, state);
        } else {
          value.textContent = match.value;
        }

        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "btn btn-outline-primary btn-sm copy-btn";
        copy.innerHTML =
          '<i class="bi bi-clipboard" aria-hidden="true"></i> Copy';

        content.append(value, copy);
        item.append(content);
        $resultsContainer[0].append(item);
      });

      // Add a load-more control only while unrendered matches remain.
      if (position < matches.length) {
        if (!$("#loadMoreBtn").length) {
          const more = document.createElement("button");
          more.id = "loadMoreBtn";
          more.type = "button";
          more.className = "btn btn-outline-secondary mt-3";
          more.textContent = "Load more results";
          $resultsContainer.after(more);
          loadMoreHandler = renderBatch;
          $("#loadMoreBtn").on("click", loadMoreHandler);
        }
      } else {
        $("#loadMoreBtn").remove();
        loadMoreHandler = null;
      }
    };

    renderBatch();
  }

  // Build text nodes around matched ranges instead of inserting user data as HTML.
  function appendHighlightedText(container, value, state) {
    // Merge overlapping hits first so the result text gets clean, non-nested highlights.
    let ranges = [];

    if (state.regex) {
      state.terms.forEach((term) => {
        try {
          const regex = new RegExp(term, "gi");
          let match;
          while ((match = regex.exec(value)) !== null) {
            ranges.push([match.index, match.index + match[0].length]);
            if (!match[0].length) regex.lastIndex++;
          }
        } catch (_) {
          // Search already checked these patterns; skip a bad one rather than breaking rendering.
        }
      });
    } else {
      const lower = value.toLocaleLowerCase();
      state.terms.forEach((term) => {
        const needle = term.toLocaleLowerCase();
        let from = 0;
        while (needle && (from = lower.indexOf(needle, from)) !== -1) {
          ranges.push([from, from + needle.length]);
          from += needle.length;
        }
      });
    }

    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged = [];
    ranges.forEach((range) => {
      const previous = merged[merged.length - 1];
      if (previous && range[0] <= previous[1]) {
        previous[1] = Math.max(previous[1], range[1]);
      } else {
        merged.push(range.slice());
      }
    });

    let cursor = 0;
    merged.forEach(([start, end]) => {
      if (start > cursor)
        container.append(document.createTextNode(value.slice(cursor, start)));
      const mark = document.createElement("mark");
      mark.textContent = value.slice(start, end);
      container.append(mark);
      cursor = end;
    });
    if (cursor < value.length)
      container.append(document.createTextNode(value.slice(cursor)));
  }

  function addActionButton(label, action, classes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn btn-sm ${classes}`;
    button.dataset.action = action;
    button.textContent = label;
    $resultsActions.append(button);
  }

  function addExportDropdown() {
    const dropdown = document.createElement("div");
    dropdown.className = "dropdown";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-sm btn-outline-secondary dropdown-toggle";
    toggle.dataset.bsToggle = "dropdown";
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = "Export as";

    const menu = document.createElement("ul");
    menu.className = "dropdown-menu";

    [
      ["JSON", "export-json"],
      ["Text", "export-text"],
    ].forEach(([label, action]) => {
      const item = document.createElement("li");
      const option = document.createElement("button");
      option.type = "button";
      option.className = "dropdown-item";
      option.dataset.action = action;
      option.textContent = label;
      item.append(option);
      menu.append(item);
    });

    dropdown.append(toggle, menu);
    $resultsActions.append(dropdown);
  }

  function setLoading(loading) {
    $("#loadingSpinner")
      .toggleClass("d-none", !loading)
      .attr("aria-hidden", String(!loading));
    $("body").toggleClass("loading-active", loading);
    $results.attr("aria-busy", String(loading));
    $("#searchBtn")
      .prop("disabled", loading)
      .text(loading ? "Searching…" : "Search");
  }

  async function copyPermalink() {
    if (!lastSearch?.permalink) {
      showToast(
        "Run a successful search before copying its permalink.",
        "warning",
      );
      return;
    }

    await copyText(lastSearch.permalink, "Permalink copied to clipboard.");
  }

  function hidePermalink() {
    searchFormVersion += 1;
    $("#permalinkBtn").prop("hidden", true);
  }

  // One permalink builder keeps copied links and exported links in step.
  function buildPermalink(state) {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("list", state.listUrl);
    url.searchParams.set("q", state.terms.join("\n"));
    url.searchParams.set("multi", String(state.multi));
    url.searchParams.set("regex", String(state.regex));
    url.searchParams.set("exact", String(state.exact));
    url.searchParams.set("highlight", String(state.highlight));
    url.searchParams.set("view", state.view);
    url.searchParams.set("sort", state.sort);
    return url.href;
  }

  // Saved searches stay local to this browser, and malformed entries are ignored on read.
  function getSavedSearches() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      // Keep malformed or hand-edited storage entries from breaking the saved-search panel.
      return Array.isArray(data) ? data.filter(isValidSavedSearch) : [];
    } catch (_) {
      return [];
    }
  }

  function isValidSavedSearch(item) {
    const options = item?.options;
    return (
      item &&
      typeof item === "object" &&
      typeof item.id === "string" &&
      item.id.length <= 128 &&
      validHttpUrl(item.listUrl) &&
      Array.isArray(item.terms) &&
      item.terms.length > 0 &&
      item.terms.length <= MAX_SEARCH_TERMS &&
      item.terms.every(
        (term) => typeof term === "string" && term.length <= MAX_TERM_LENGTH,
      ) &&
      Array.isArray(item.results) &&
      item.results.every(
        (result) =>
          result &&
          typeof result === "object" &&
          typeof result.value === "string" &&
          Number.isFinite(result.matchCount) &&
          result.matchCount >= 0,
      ) &&
      options &&
      typeof options === "object" &&
      !Array.isArray(options) &&
      typeof options.multi === "boolean" &&
      typeof options.regex === "boolean" &&
      typeof options.exact === "boolean" &&
      typeof options.highlight === "boolean" &&
      ["cards", "list"].includes(options.view) &&
      ["best", "alphabetical"].includes(options.sort)
    );
  }

  // Storage errors are reported to the user rather than silently dropping a save.
  function writeSavedSearches(items) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      return true;
    } catch (_) {
      showToast(
        "Could not save data. Browser storage may be full or disabled.",
        "danger",
      );
      return false;
    }
  }

  function saveCurrentSearch() {
    if (!lastSearch) return;
    const suggestedName = defaultSearchName(lastSearch.terms);
    const enteredName = window.prompt("Name this saved search:", suggestedName);
    // Cancel changes nothing; an empty name just uses the suggested one.
    if (enteredName === null) return;

    const savedSearch = {
      ...lastSearch,
      // Saving the same search again creates a separate entry with its own export filename.
      id: makeId(),
      name: sanitizeSearchName(enteredName) || suggestedName,
    };
    const saved = getSavedSearches();
    saved.unshift(savedSearch);
    if (writeSavedSearches(saved)) {
      renderSavedSearches();
      showToast("Search and results saved in this browser.", "success");
    }
  }

  // Rebuild the panel from storage so its count and buttons never drift out of sync.
  function renderSavedSearches() {
    const saved = getSavedSearches();
    $savedSearches.empty();

    $savedSearchesCount.text(saved.length.toLocaleString());
    $savedSearchesCount.prop("hidden", !saved.length);
    $("#savedSearchesBtn").attr(
      "aria-label",
      saved.length ? `Saved searches, ${saved.length}` : "Saved searches",
    );
    $savedActions.toggleClass("has-disabled-actions", !saved.length);
    $("#clearSavedBtn, #exportSavedJsonBtn").prop("disabled", !saved.length);
    if (!saved.length) {
      $("<p>")
        .addClass("text-body-secondary mb-0")
        .text(
          "Saved searches will appear here after you save one. They are stored only in this browser and can be deleted at any time.",
        )
        .appendTo($savedSearches);
      return;
    }

    saved.forEach((item) => {
      const card = document.createElement("article");
      card.className = "saved-item";

      const top = document.createElement("div");
      top.className = "saved-item-top";

      const info = document.createElement("div");
      info.className = "min-w-0";

      const title = document.createElement("h3");
      title.className = "h6 saved-item-title";
      title.textContent =
        sanitizeSearchName(item.name) || defaultSearchName(item.terms);

      const meta = document.createElement("p");
      meta.className = "saved-item-meta mb-0";
      // Show dates in the viewer's locale; exports keep the original UTC timestamp.
      const date = item.createdAt
        ? new Date(item.createdAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })
        : "";
      const resultCount = (item.results || []).length;
      const resultLabel = resultCount === 1 ? "result" : "results";
      meta.textContent = `${resultCount.toLocaleString()} ${resultLabel}${date ? ` · ${date}` : ""}`;

      info.append(title, meta);
      const controls = document.createElement("div");
      controls.className = "d-flex flex-wrap gap-2";

      controls.append(
        savedButton("Load", "load", item.id, "btn-outline-primary"),
        savedButton("JSON", "json", item.id, "btn-outline-secondary"),
        savedButton("Delete", "delete", item.id, "btn-outline-danger"),
      );

      top.append(info, controls);
      card.append(top);
      $savedSearches.append(card);
    });
  }

  function savedButton(label, action, id, classes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn btn-sm ${classes}`;
    button.dataset.savedAction = action;
    button.dataset.id = id;
    button.textContent = label;
    return button;
  }

  // Clean up names before showing or storing them, and keep them to a reasonable length.
  function sanitizeSearchName(value) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  }

  // The first term makes a handy title; extra terms are summarized by their count.
  function defaultSearchName(terms) {
    const safeTerms = Array.isArray(terms) ? terms : [];
    const firstTerm = sanitizeSearchName(safeTerms[0]) || "Saved search";
    const remaining = safeTerms.length - 1;
    return `${firstTerm}${remaining > 0 ? ` + ${remaining} ${remaining === 1 ? "line" : "lines"}` : ""}`.slice(
      0,
      120,
    );
  }

  function deleteSavedSearch(id) {
    if (
      writeSavedSearches(getSavedSearches().filter((item) => item.id !== id))
    ) {
      renderSavedSearches();
      showToast("Saved search deleted.", "success");
    }
  }

  function clearSavedSearches() {
    const saved = getSavedSearches();
    if (!saved.length) return;
    if (
      !window.confirm(
        "Delete all saved searches? This will delete all searches and clear the saved-search data from browser storage. This cannot be undone.",
      )
    )
      return;
    if (writeSavedSearches([])) {
      renderSavedSearches();
      showToast("All saved searches deleted.", "success");
    }
  }

  function loadSavedSearch(id) {
    const item = getSavedSearches().find((entry) => entry.id === id);
    if (!item) return;

    // Loading saved values is not a fresh search, so wait until Search runs to show a link.
    hidePermalink();
    const options = item.options || {};
    $list.val(
      $list
        .find("option")
        .toArray()
        .some((option) => option.value === item.listUrl)
        ? item.listUrl
        : "custom",
    );
    if ($list.val() === "custom")
      $customUrl.val(item.listUrl).removeClass("d-none");

    const multi = options.multi === true || item.terms.length > 1;
    $multiToggle.prop("checked", multi);
    (multi ? $multi : $single).val((item.terms || []).join("\n"));
    updateSearchMode();

    $("#useRegex").prop("checked", options.regex);
    $("#exactMatch").prop("checked", options.exact);
    $("#highlightResults").prop("checked", options.highlight);
    $("#viewSelect").val(options.view === "list" ? "list" : "cards");
    $("#sortSelect").val(
      options.sort === "alphabetical" ? "alphabetical" : "best",
    );
    updateExactMatch();
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast(
      "Saved search loaded. Press Search to refresh its results.",
      "success",
    );
  }

  // Exports use the same permalink builder as the copy button.
  function exportCurrentJson() {
    if (!lastSearch) return;
    downloadSearchJson(lastSearch);
  }

  function exportCurrentText() {
    if (!lastSearch) return;
    const fileId = /^[A-Za-z0-9-]{1,128}$/.test(lastSearch.id || "")
      ? lastSearch.id
      : makeId();
    const content = lastSearch.results.map((result) => result.value).join("\n");
    downloadBlob(content, `${fileId}.txt`, "text/plain;charset=utf-8");
  }

  // Pass an ID to export one entry, or leave it empty to export the whole collection.
  function exportSavedJson(id) {
    if (id) {
      const item = getSavedSearches().find((entry) => entry.id === id);
      if (item) downloadSearchJson(item);
      return;
    }
    const saved = getSavedSearches();
    if (saved.length) {
      downloadJson(saved.map(withPermalink), makeSavedSearchesExportFilename());
    }
  }

  function makeSavedSearchesExportFilename() {
    const timestamp = new Date()
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z")
      .replace(/:/g, "-");
    return `domain-search-saved-searches-${timestamp}.json`;
  }

  function downloadSearchJson(search) {
    const fileId = /^[A-Za-z0-9-]{1,128}$/.test(search.id || "")
      ? search.id
      : makeId();
    downloadJson(withPermalink(search), `${fileId}.json`);
  }

  function withPermalink(search) {
    // Rebuild from the saved fields so an edited or outdated permalink is not carried into exports.
    const options = search.options || {};
    const createdAt = new Date(search.createdAt);
    return {
      ...search,
      createdAt: Number.isNaN(createdAt.getTime())
        ? null
        : createdAt.toISOString(),
      permalink: buildPermalink({
        listUrl: typeof search.listUrl === "string" ? search.listUrl : "",
        terms: Array.isArray(search.terms) ? search.terms : [],
        multi: Boolean(options.multi),
        regex: Boolean(options.regex),
        exact: Boolean(options.exact),
        highlight: options.highlight !== false,
        view: options.view === "list" ? "list" : "cards",
        sort: options.sort === "alphabetical" ? "alphabetical" : "best",
      }),
    };
  }

  function downloadJson(data, filename) {
    // Timestamps in the JSON stay in ISO format and UTC, regardless of the viewer's locale.
    downloadBlob(
      JSON.stringify(data, null, 2),
      filename,
      "application/json;charset=utf-8",
    );
  }

  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    // Give the browser a moment to start the download before releasing its temporary URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyText(text, successMessage) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Older or non-secure pages need the selection-based clipboard fallback.
        const input = document.createElement("textarea");
        input.value = text;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.append(input);
        input.select();
        const copied = document.execCommand("copy");
        input.remove();
        if (!copied) throw new Error("Clipboard unavailable");
      }
      showToast(successMessage, "success");
    } catch (_) {
      showToast(
        "Could not access the clipboard. Check browser permissions.",
        "danger",
      );
    }
  }

  // Custom lists can come from regular web URLs, but not other URL schemes.
  function validHttpUrl(value) {
    if (typeof value !== "string" || value.length > MAX_LIST_URL_LENGTH) {
      return false;
    }
    try {
      const url = new URL(value);
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        Boolean(url.hostname) &&
        !url.username &&
        !url.password
      );
    } catch (_) {
      return false;
    }
  }

  // Prefer a UUID when the browser supports it, with a lightweight fallback.
  function makeId() {
    return (
      window.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
  }

  // Pause each toast's progress bar while it is hovered or has keyboard focus.
  function showToast(message, type = "primary") {
    const statuses = {
      success: { label: "Success", icon: "bi-check-circle-fill" },
      warning: { label: "Warning", icon: "bi-exclamation-triangle-fill" },
      danger: { label: "Error", icon: "bi-x-circle-fill" },
      info: { label: "Information", icon: "bi-info-circle-fill" },
      primary: { label: "Notice", icon: "bi-bell-fill" },
    };
    const status = statuses[type] || statuses.primary;
    const delay = 3500;
    const toastElement = document.createElement("div");
    toastElement.className = `toast app-toast toast-status-${type}`;
    toastElement.setAttribute("role", "status");
    toastElement.setAttribute("aria-live", "polite");
    toastElement.setAttribute("aria-atomic", "true");
    toastElement.style.setProperty("--toast-duration", `${delay}ms`);

    const header = document.createElement("div");
    header.className = "toast-header";
    const icon = document.createElement("i");
    icon.className = `bi ${status.icon} toast-status-icon me-2`;
    icon.setAttribute("aria-hidden", "true");
    const title = document.createElement("strong");
    title.className = "me-auto";
    title.textContent = status.label;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn-close";
    close.setAttribute("data-bs-dismiss", "toast");
    close.setAttribute("aria-label", "Close");
    header.append(icon, title, close);

    const body = document.createElement("div");
    body.className = "toast-body";
    body.textContent = message;
    const progress = document.createElement("div");
    progress.className = "toast-progress";
    progress.setAttribute("aria-hidden", "true");
    const fill = document.createElement("div");
    fill.className = "toast-progress-fill";
    progress.append(fill);

    toastElement.append(header, body, progress);
    let hovered = false;
    let focused = false;
    const updateProgressPlayback = () => {
      fill.style.animationPlayState = hovered || focused ? "paused" : "running";
    };
    toastElement.addEventListener("mouseenter", () => {
      hovered = true;
      updateProgressPlayback();
    });
    toastElement.addEventListener("mouseleave", () => {
      hovered = false;
      updateProgressPlayback();
    });
    toastElement.addEventListener("focusin", () => {
      focused = true;
      updateProgressPlayback();
    });
    toastElement.addEventListener("focusout", () => {
      focused = false;
      updateProgressPlayback();
    });
    toastElement.addEventListener(
      "hidden.bs.toast",
      () => {
        bootstrap.Toast.getInstance(toastElement)?.dispose();
        toastElement.remove();
      },
      { once: true },
    );
    document.getElementById("toastContainer").append(toastElement);
    bootstrap.Toast.getOrCreateInstance(toastElement, { delay }).show();
  }
});
