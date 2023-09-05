(function () {
    const vscode = acquireVsCodeApi();        

    // Handle messages sent from the extension to the webview
    window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        switch (message.type) {
            case 'setResults':
                {
                    setResults(message.data.fileResults, message.data.uriMap);
                    break;
                }
        }
    });

    var isCaseSensitive = false;
    var isWholeWord = false;
    var isRegex = false;

    const previousState = vscode.getState();
    if (previousState) {
        isCaseSensitive = previousState.isCaseSensitive;
        isWholeWord = previousState.isWholeWord;
        isRegex = previousState.isRegex;
    }

    var filenameCollapsed = {}

    document.getElementById("button-refresh").onclick = refreshSearch;
    document.getElementById("button-clear").onclick = clearSearch;

    buttonCollapse = document.getElementById("button-collapse");
    buttonCollapse.onclick = collapseResults

    tooltipCollapse = document.getElementById("tooltip-collapse");

    buttonCaseSensitive = document.getElementById("button-case-sensitive");
    if (isCaseSensitive) {
        buttonCaseSensitive.classList.add('search-button-active');
    }
    buttonCaseSensitive.onclick = toggleCaseSensitive;

    buttonWholeWord = document.getElementById("button-whole-word");
    if (isWholeWord) {
        buttonWholeWord.classList.add('search-button-active');
    }
    buttonWholeWord.onclick = toggleWholeWord;

    buttonRegex = document.getElementById("button-regex");
    if (isRegex) {
        buttonRegex.classList.add('search-button-active');
    }
    buttonRegex.onclick = toggleRegex;

    inputSearch = document.getElementById("input-search");
    inputSearch.addEventListener("keypress", function(event) {
        if (event.key === "Enter") {
            event.preventDefault();
            refreshSearch();
        }
    });

    searchResults = document.getElementById("search-results");

    vscode.postMessage({ type: 'webViewReady' });

    function refreshSearch() {
        if (inputSearch.value) {
            vscode.postMessage({ 
                type: 'findInFiles', 
                text: inputSearch.value, 
                caseSensitive: isCaseSensitive,
                wholeWord: isWholeWord,
                isRegex: isRegex
            });
        }
        else {
            clearSearch();
        }
    }

    function clearSearch() {
        inputSearch.value = "";
        searchResults.textContent = "";
        filenameCollapsed = {};
    }

    function areAllFilesCollapsed() {
        return Object.values(filenameCollapsed).every(x => x);
    }

    function collapseResults() {
        let shouldCollapse = !areAllFilesCollapsed();

        for (const [safeName, isCollapsed] of Object.entries(filenameCollapsed)) {
            if (isCollapsed != shouldCollapse) {
                toggleFile(safeName);
            }
        }

        updateCollapseButton();
    }

    function toggleSearchButton(value, element) {
        var newValue = !value;

        if (newValue) {
            element.classList.add('search-button-active');
        }
        else {
            element.classList.remove('search-button-active');
        }

        return newValue;
    }

    function saveState() {
        vscode.setState({
            isCaseSensitive: isCaseSensitive,
            isWholeWord: isWholeWord,
            isRegex: isRegex
        });
    }

    function toggleCaseSensitive() {
        isCaseSensitive = toggleSearchButton(isCaseSensitive, buttonCaseSensitive);

        refreshSearch();

        saveState();
    }

    function toggleWholeWord() {
        isWholeWord = toggleSearchButton(isWholeWord, buttonWholeWord);

        refreshSearch();

        saveState();
    }

    function toggleRegex() {
        isRegex = toggleSearchButton(isRegex, buttonRegex);

        refreshSearch();

        saveState();
    }

    // Updates the button-collapse element based on the currently collapsed state
    function updateCollapseButton() {
        if (areAllFilesCollapsed()) {
            buttonCollapse.classList.remove('codicon-collapse-all');
            buttonCollapse.classList.add('codicon-expand-all');
            tooltipCollapse.innerText = "Expand All";
        }
        else {
            buttonCollapse.classList.remove('codicon-expand-all');
            buttonCollapse.classList.add('codicon-collapse-all');
            tooltipCollapse.innerText = "Collapse All";
        }
    }

    function toggleFile(safeName) {
        filenameCollapsed[safeName] = !filenameCollapsed[safeName];

        var icon = document.getElementById(`${safeName}-toggle-icon`);
        if (filenameCollapsed[safeName]) {
            icon.classList.remove('codicon-chevron-down');
            icon.classList.add('codicon-chevron-right');
        }
        else {
            icon.classList.remove('codicon-chevron-right');
            icon.classList.add('codicon-chevron-down');
        }

        var content = document.getElementById(`${safeName}-results`);
        if (filenameCollapsed[safeName]) {
            content.style.display = "none";
        }
        else {
            content.style.display = "block";
        }

        updateCollapseButton();
    }

    function onSearchResultClick(uri, line, position, length) {
        vscode.postMessage({ type: 'openFile', uri: uri, line: line, position: position, length: length });
    }

    function setResults(results, uriMap) {
        searchResults.textContent = "";
        filenameCollapsed = {};

        let totalResults = Object.values(results).reduce((a, b) => a + b.length, 0);
        if (totalResults > 0) {
            let totalFiles = Object.keys(results).length;

            // Add a div to summarize the results (e.g. 4 results in 2 files)
            let summary = document.createElement("div");
            summary.className = "search-summary";
            summary.innerText = `${totalResults} results in ${totalFiles} file${totalFiles > 1 ? "s" : ""}`;
            searchResults.appendChild(summary);
        }

        for (const [uri, fileResults] of Object.entries(results)) {
            let filename = uri.replace(/^.*[\\\/]/, '');
            let safeName = filename.replace(/[^a-zA-Z0-9]/g, '-');

            filenameCollapsed[safeName] = false;

            let fileParent = document.createElement("div");
            fileParent.className = "file-parent";
            fileParent.onclick = function() {
                toggleFile(safeName);
            }

            fileParent.style.position = "relative";
            searchResults.appendChild(fileParent);

            let toggleIcon = document.createElement("div");
            toggleIcon.className = "file-toggle-icon codicon codicon-chevron-down";
            toggleIcon.id = `${safeName}-toggle-icon`;
            fileParent.appendChild(toggleIcon);

            let fileNameElement = document.createElement("div");
            fileNameElement.className = "file-name";
            fileNameElement.innerText = filename;
            fileParent.appendChild(fileNameElement);

            let filePathElement = document.createElement("div");
            filePathElement.className = "file-path";
            filePathElement.innerText = uriMap[uri];
            fileParent.appendChild(filePathElement);

            let fileResultCountParent = document.createElement("div");
            fileResultCountParent.className = "file-result-parent";
            fileParent.appendChild(fileResultCountParent);

            let fileResultCount = document.createElement("div");
            fileResultCount.className = "file-result-count";
            fileResultCount.innerText = fileResults.length;
            fileResultCountParent.appendChild(fileResultCount);

            let lineResults = document.createElement("div");
            lineResults.className = "line-results";
            lineResults.id = `${safeName}-results`;
            searchResults.appendChild(lineResults);

            for (const result of fileResults) {
                let lineResult = document.createElement("div");
                lineResult.className = "line-result";
                lineResult.onclick = function() {
                    onSearchResultClick(uri, result.line, result.position, result.length);
                }
                lineResults.appendChild(lineResult);

                let lineResultContent = document.createElement("div");
                lineResultContent.className = "line-result-content";
                lineResult.appendChild(lineResultContent);

                const left = result.text.substr(0, result.position);
                const middle = result.text.substr(result.position, result.length);
                const right = result.text.substr(result.position + result.length);

                let leftElement = document.createElement("span");
                leftElement.className = "line-result-normal";
                leftElement.textContent = left;
                lineResultContent.appendChild(leftElement);

                let middleElement = document.createElement("span");
                middleElement.className = "line-result-match";
                middleElement.textContent = middle;
                lineResultContent.appendChild(middleElement);

                let rightElement = document.createElement("span");
                rightElement.className = "line-result-normal";
                rightElement.textContent = right;
                lineResultContent.appendChild(rightElement);
            }
        }

        updateCollapseButton();
    }
}());
