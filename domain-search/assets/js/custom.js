// Main JavaScript Entry Point
$(document).ready(function () {
    // Cached DOM elements for performance
    const $toTop = $('#toTop');
    const $darkModeToggle = $('#darkModeToggle');
    const $searchBtn = $('#searchBtn');
    const $loadingSpinner = $('#loadingSpinner');
    const $results = $('#results');
    const $resultsInfo = $('#resultsInfo');
    const $resultsContainer = $('#resultsContainer');
    const $viewSelect = $('#viewSelect');
    const $sortSelect = $('#sortSelect'); // Add sort selector
    const $highlightCheckbox = $('#highlightResults'); // Checkbox for enabling highlight tags

    // Initialization
    initializeTooltips();
    initializeDarkMode();
    initializeEventListeners();

    /*************************
     * Initialization Functions
     *************************/

    // Sets up tooltips on elements with data-bs-toggle="tooltip" attribute
    function initializeTooltips() {
        $('body').tooltip({
            selector: '[data-bs-toggle="tooltip"]',
        });
    }

    // Initializes Dark Mode based on user preference or system preference
    function initializeDarkMode() {
        const savedPreference = localStorage.getItem('darkMode');

        if (savedPreference === 'enabled') {
            toggleDarkMode(true);
            $darkModeToggle.prop('checked', true);
        } else if (savedPreference === 'disabled') {
            toggleDarkMode(false);
            $darkModeToggle.prop('checked', false);
        } else {
            const prefersDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
            toggleDarkMode(prefersDarkMode);
            $darkModeToggle.prop('checked', prefersDarkMode);
        }
    }

    // Adds core event listeners for buttons and user actions
    function initializeEventListeners() {
        // Scroll button visibility based on window scroll position
        $(window).scroll(handleScroll);

        // Scroll to top of the page when the 'To Top' button is clicked
        $toTop.click(scrollToTop);

        // Dark mode toggle switch
        $darkModeToggle.change(handleDarkModeToggle);

        // Search button click event
        $searchBtn.on('click', handleSearchClick);
    }

    /*************************
     * Event Handlers
     *************************/

    // Handle scroll to determine visibility of the "toTop" button
    function handleScroll() {
        if ($(this).scrollTop() > 200) {
            $toTop.fadeIn();
        } else {
            $toTop.fadeOut();
        }
    }

    // Scrolls the page to the top when called
    function scrollToTop() {
        $('html, body').animate({ scrollTop: 0 }, 500);
        return false; // Prevent default link behavior
    }

    // Handles dark mode toggle button state and updates preferences in localStorage
    function handleDarkModeToggle() {
        const isDarkMode = $(this).is(':checked');
        toggleDarkMode(isDarkMode);
        localStorage.setItem('darkMode', isDarkMode ? 'enabled' : 'disabled');
    }

    // Handles search button click, initiates search if a phrase is provided
    function handleSearchClick() {
        const listUrl = $('#listSelect').val();
        const searchPhrase = $('#searchInput').val().trim();

        if (!searchPhrase) {
            showToast('<i class="bi bi-exclamation-circle-fill"></i> Please enter a search phrase.', 'text-bg-warning');
            return;
        }

        performSearch(listUrl, searchPhrase);
    }

    /*************************
     * Core Functionalities
     *************************/

    // Toggles dark mode styles based on parameter
    function toggleDarkMode(enable) {
        $('html').attr('data-bs-theme', enable ? 'dark' : null);
        $('body').toggleClass('dark-mode', enable);
        $('.btn').toggleClass('btn-dark-mode', enable);
    }

    // Sets loading state for the search button and other UI elements
    function setLoadingState(isLoading) {
        $loadingSpinner.toggleClass('d-none', !isLoading);
        $('body').toggleClass('loading-active', isLoading);
        $searchBtn.prop('disabled', isLoading).html(
            isLoading
                ? '<span class="spinner-grow spinner-grow-sm" role="status" aria-hidden="true"></span> Loading...'
                : '<i class="bi bi-search"></i> Search'
        );
    }

    // Handles performing the search by making an AJAX call
    function performSearch(listUrl, searchPhrase) {
        setLoadingState(true);
        $resultsInfo.empty();
        $resultsContainer.empty();

        $.ajax({
            url: listUrl,
            method: 'GET',
        })
            .done(function (data) {
                const highlightEnabled = $highlightCheckbox.is(':checked'); // Check if highlight is enabled
                let matches = getMatches(data, searchPhrase, highlightEnabled);
                displayResults(matches);
            })
            .fail(function () {
                showToast('Error fetching the data. Please try again later.', 'text-bg-danger');
            })
            .always(function () {
                setLoadingState(false);
                if ($results[0]) {
                    $results[0].scrollIntoView({ behavior: 'smooth' });
                }
            });
    }

    // Extracts lines that match the search phrase from the response data and highlights them
    function getMatches(data, searchPhrase, highlightEnabled) {
        const lines = data.split('\n');

        try {
            const regex = new RegExp(`(${searchPhrase})`, 'gi'); // Capturing group for the matching part
            return lines
                .map((line, index) => ({
                    original: line, // Original line for sorting without tags
                    highlighted: highlightEnabled ? line.replace(regex, '<mark>$1</mark>') : line, // Conditionally apply highlights
                    matchCount: (line.match(regex) || []).length, // Number of matches in the line
                    index: index, // Original index for sorting by "best matching"
                }))
                .filter((entry) => entry.matchCount > 0); // Keep only lines that have matches
        } catch (regexError) {
            showToast('Invalid regular expression. Please check your input.', 'text-bg-danger');
            return [];
        }
    }

    // Displays the search results or a no results message
    function displayResults(matches) {
        if (matches.length > 0) {
            // Get sorting preference
            const sortBy = $sortSelect.val();
            if (sortBy === "alphabetical") {
                matches.sort((a, b) => a.original.localeCompare(b.original)); // Sort based on the original line without HTML tags
            } else if (sortBy === "best") {
                // Sort by "best matching", which prioritizes match count (descending) and keeps original order for ties
                matches.sort((a, b) => b.matchCount - a.matchCount || a.index - b.index);
            }

            const formattedMatchesCount = matches.length.toLocaleString(); // Format number with thousands separator
            $resultsInfo.html(`<p class="fs-3">Found <span class="badge bg-primary">${formattedMatchesCount}</span> matches:</p>`);
            renderAllResults(matches.map((entry) => entry.highlighted));
        } else {
            $results.html(
                `<div class="alert alert-secondary" role="alert">No matches found. Try a different keyword or use regular expression.</div>`
            );
            showToast('<i class="bi bi-exclamation-circle-fill"></i> No matches found.', 'text-bg-info');
        }
    }

    // Renders the search results, managing a load more button if necessary
    function renderAllResults(results) {
        const viewType = $viewSelect.val(), batchSize = 100;
        let currentIndex = 0;

        function renderBatch() {
            const batch = results.slice(currentIndex, currentIndex + batchSize);
            currentIndex += batch.length;

            const renderedHtml = batch.map(result => viewType === "cards" ?
                `<div class="col"><div class="card h-100 shadow-sm bg-body"><div class="card-body d-flex justify-content-between align-items-center"><p class="card-text mb-0 text-break">${result}</p><button class="btn btn-outline-primary btn-sm ms-3 p-2 copy-btn" data-domain="${result}" data-bs-toggle="tooltip" data-bs-placement="top" title="Copy domain to clipboard"><i class="bi bi-clipboard"></i> Copy</button></div></div></div>` :
                `<div class="list-group-item d-flex justify-content-between align-items-center"><p class="mb-0 text-break">${result}</p><button class="btn btn-outline-primary btn-sm ms-3 p-2 copy-btn" data-domain="${result}" data-bs-toggle="tooltip" data-bs-placement="top" title="Copy domain to clipboard"><i class="bi bi-clipboard"></i> Copy</button></div>`
            ).join("");

            if (viewType === "cards") {
                $resultsContainer.append(`<div class="row row-cols-1 row-cols-md-2 g-4">${renderedHtml}</div>`);
            } else {
                $resultsContainer.append(`<div class="list-group">${renderedHtml}</div>`);
            }

            initializeTooltips();
            addCopyButtonFunctionality();

            if (currentIndex >= results.length) {
                $("#loadMoreBtn").hide();
            }
        }

        // Remove existing Load More button if it exists
        $("#loadMoreBtn").remove();
        $resultsContainer.empty();
        renderBatch();

        if (results.length > batchSize) {
            // Append new Load More button
            $resultsContainer.after('<button id="loadMoreBtn" class="btn btn-primary mt-3">Load More</button>');
            $("#loadMoreBtn").on("click", renderBatch);
        }
    }

    /*************************
     * Utility Functions
     *************************/

    // Displays a toast notification
    function showToast(message, toastClass = 'text-bg-primary') {
        const $toastElement = $('#notificationToast');
        const $toastMessage = $('#toastMessage');
        $toastMessage.html(message);
        $toastElement.attr('class', `toast align-items-center border-0 ${toastClass}`);
        new bootstrap.Toast($toastElement[0]).show();
    }

    // Adds copy-to-clipboard functionality for the generated buttons
    function addCopyButtonFunctionality() {
        $('.copy-btn').on('click', function () {
            // Find the text container and get its plain text (without HTML tags)
            const rawText = $(this).closest('.d-flex').find('p').text();
            navigator.clipboard.writeText(rawText);
            showToast('<i class="bi bi-clipboard-check"></i> Copied to clipboard', 'text-bg-success');
        });
    }
});
