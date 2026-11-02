(function () {
    const vscode = acquireVsCodeApi();

    const ViewType = {
        None: 'None',
        Chapters: 'Chapters',
        Functions: 'Functions',
        Details: 'Details'
    };      

    const legacyContent = document.getElementById('legacy-content');
    const modernContent = document.getElementById('modern-content');
    const legacyButton = document.getElementById('legacy');
    const modernButton = document.getElementById('modern');

    var viewType = ViewType.None;
    var isLegacy = true;
    var modernIsNative = false;

    const modernFrame = modernContent.innerHTML;

    // Each reference draws into its own tab
    function contentFor(modern) {
        return (modern ? modernContent : legacyContent).querySelector('.reference-content');
    }

    function imageId(chapter, modern) {
        return `${modern ? 'modern' : 'legacy'}-${chapter}-image`;
    }

    // Codea from 3.20 serves the Carbide reference; before that, the Modern tab shows the online one
    function setModernIsNative(native) {
        modernIsNative = native;
        if (native) {
            modernContent.className = '';
            modernContent.innerHTML = '<div class="reference-content">Loading...</div>';
        }
        else {
            modernContent.className = 'modern-div';
            modernContent.innerHTML = modernFrame;
        }
        if (!isLegacy) {
            modernContent.style.display = native ? 'block' : 'flex';
        }
    }

    // Handle messages sent from the extension to the webview
    window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        switch (message.type) {
            case 'setModernIsNative':
                {
                    setModernIsNative(message.data);

                    break;
                }
            case 'showReference':
                {
                    (message.data ? modernButton : legacyButton).click();

                    break;
                }
            case 'setChapters':
                {
                    setChapters(message.data, message.modern);

                    break;
                }
            case 'setChapterImage':
                {
                    setChapterImage(message.data.chapter, message.data.image, message.modern);

                    break;
                }
            case 'setFunctions':
                {
                    setFunctions(
                        message.data.chapter, 
                        message.data.chapterTitle, 
                        message.data.chapterImage,
                        message.data.groups,
                        message.data.localGroups,
                        message.data.functions,
                        message.data.categoryImages,
                        message.modern);

                    break;
                }
            case 'setCategoryImage':
                {
                    setCategoryImage(message.data.category, message.data.image);

                    break;
                }
            case 'setFunctionDetails':
                {
                    setFunctionDetails(message.data.chapter, message.data.details, message.data.categoryImages, message.modern);
                    (message.modern ? modernButton : legacyButton).click();
                    break;
                }
        }
    });

    vscode.postMessage({ type: 'webViewReady' });

    legacyButton.addEventListener('click', () => {
        if (!isLegacy) {
            isLegacy = true;
            modernButton.classList.remove('selected');
            legacyButton.classList.add('selected');
            legacyContent.style.display = 'block';
            modernContent.style.display = 'none';
        }
    });

    modernButton.addEventListener('click', () => {
        if (isLegacy) {
            isLegacy = false;
            legacyButton.classList.remove('selected');
            modernButton.classList.add('selected');
            legacyContent.style.display = 'none';
            modernContent.style.display = modernIsNative ? 'block' : 'flex';
        }
    });

    function setChapters(chapters, modern) {
        const content = contentFor(modern);

        if (content) {
            content.textContent = '';

            for (const chapter of chapters) {
                const chapterNameValue = chapter['name'];
                const chapterTitleValue = chapter['title'];
                const chapterSubtitleValue = chapter['subtitle'];
                const chapterImageValue = chapter['image'];
                
                const chapterDiv = document.createElement('div');
                chapterDiv.className = 'chapter-button';
                chapterDiv.onclick = function() {
                    vscode.postMessage({ type: 'getFunctions', chapter: chapterNameValue, modern });
                }
                content.appendChild(chapterDiv)

                const chapterImageDiv = document.createElement('div');
                chapterImageDiv.className = 'chapter-image-container';
                chapterDiv.appendChild(chapterImageDiv);

                const chapterImage = document.createElement('img');
                chapterImage.id = imageId(chapterNameValue, modern);
                if (chapterImageValue) {
                    chapterImage.src = `data:image/png;base64,${chapterImageValue}`;
                }
                else {
                    chapterImage.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
                    vscode.postMessage({ type: 'getChapterImage', chapter: chapterNameValue, modern });
                }
                chapterImage.className = 'chapter-image';
                chapterImageDiv.appendChild(chapterImage);

                const chapterText = document.createElement('div');
                chapterText.className = 'chapter-text-container';
                chapterDiv.appendChild(chapterText);

                const chapterTitle = document.createElement('div');
                chapterTitle.className = 'chapter-title';
                chapterTitle.textContent = chapterTitleValue;
                chapterText.appendChild(chapterTitle);

                const chapterSubtitle = document.createElement('div');
                chapterSubtitle.className = 'chapter-subtitle';
                chapterSubtitle.textContent = chapterSubtitleValue;
                chapterText.appendChild(chapterSubtitle);
            }

            window.scrollTo(0, 0);

            viewType = ViewType.Chapters;
        }
    }

    function setChapterImage(chapter, image, modern) {
        const img = document.getElementById(imageId(chapter, modern));
        if (img instanceof HTMLImageElement) {
            img.src = `data:image/png;base64,${image}`;
        }
    }

    function setFunctions(chapter, chapterTitle, chapterImage, groups, localGroups, functions, categoryImages, modern) {
        const content = contentFor(modern);
        var missingCategories = []

        if (content) {
            content.textContent = ``;

            const topBar = document.createElement('div');
            topBar.className = "top-bar";
            content.appendChild(topBar);

            const backButton = document.createElement('a');
            backButton.textContent = "◀";
            backButton.className = "back-button";
            backButton.onclick = function() {
                vscode.postMessage({ type: 'getChapters', modern });
            }
            topBar.appendChild(backButton);

            const chapterImageElement = document.createElement('img');
            chapterImageElement.id = imageId(chapter, modern);
            if (chapterImage) {
                chapterImageElement.src = `data:image/png;base64,${chapterImage}`;
            }
            else {
                chapterImageElement.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
                vscode.postMessage({ type: 'getChapterImage', chapter: chapter, modern });
            }
            chapterImageElement.className = 'top-image-small';
            topBar.appendChild(chapterImageElement);            

            const chapterTitleDiv = document.createElement('div');
            chapterTitleDiv.className = 'title-top';
            chapterTitleDiv.textContent = chapterTitle;
            topBar.appendChild(chapterTitleDiv);

            for (const group of groups) {
                const groupDiv = document.createElement('div');
                groupDiv.textContent = localGroups[group];
                groupDiv.className = "category-header";
                content.appendChild(groupDiv);

                for (const func of functions[group]) {
                    const funcIdValue = func['id'];
                    const funcNameValue = func['name'];
                    const funcCategoryValue = func['category'];

                    const categoryImage = categoryImages ? categoryImages[funcCategoryValue] : undefined;
                    if (!categoryImage && !missingCategories.includes(funcCategoryValue)) {
                        missingCategories.push(funcCategoryValue);
                    }

                    const functionDiv = document.createElement('div');
                    functionDiv.className = 'function-button';
                    if (func['indentation']) {
                        functionDiv.style.marginLeft = `${func['indentation'] * 16}px`;
                    }
                    functionDiv.onclick = function() {
                        vscode.postMessage({ type: 'getFunctionDetails', chapter: chapter, functionId: funcIdValue, modern });
                    }
                    content.appendChild(functionDiv);

                    const functionImageDiv = document.createElement('div');
                    functionImageDiv.className = 'function-image-container';
                    functionDiv.appendChild(functionImageDiv);
    
                    const functionImage = document.createElement('div');
                    functionImage.className = `function-${funcCategoryValue}-image`;
                    if (categoryImage) {
                        functionImage.style.backgroundImage = `url('data:image/png;base64,${categoryImage}')`;
                    }
                    else {
                        functionImage.style.backgroundImage = "url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=')";
                    }
                    functionImage.style.width = "32px";
                    functionImage.style.height = "32px";
                    functionImage.style.backgroundSize = "cover";
                    functionImage.style.borderRadius = "5px";
                    functionImageDiv.appendChild(functionImage);

                    const functionText = document.createElement('div');
                    functionText.className = 'function-text-container';
                    functionDiv.appendChild(functionText);

                    const functionName = document.createElement('div');
                    functionName.className = 'function-name';
                    functionName.textContent = funcNameValue;
                    functionText.appendChild(functionName);
                }
            }

            for (const missingCategory of missingCategories) {
                vscode.postMessage({ type: 'getCategoryImage', category: missingCategory });
            }

            window.scrollTo(0, 0);

            viewType = ViewType.Functions;
        }
    }

    function setCategoryImage(category, image) {
        let elements = document.getElementsByClassName(`function-${category}-image`);
        for (const element of elements) {
            if (element instanceof HTMLElement) {
                element.style.backgroundImage = `url('data:image/png;base64,${image}')`
            }
        }
    }

    function setFunctionDetails(chapter, details, categoryImages, modern) {
        const content = contentFor(modern);

        if (content) {
            content.textContent = '';

            const {markedHighlight} = globalThis.markedHighlight;
            const markedInstance = new marked.Marked(
                markedHighlight({
                    langPrefix: 'hljs language-',
                    highlight(code, lang) {
                        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                        return hljs.highlight(code, { language }).value;
                    }
                })
            );
              
            markedInstance.use({
                breaks: true
            });              

            const funcCategoryValue = details['category'];

            const categoryImage = categoryImages ? categoryImages[funcCategoryValue] : undefined;
            if (!categoryImage) {
                vscode.postMessage({ type: 'getCategoryImage', category: funcCategoryValue });
            }

            const topBar = document.createElement('div');
            topBar.className = "top-bar";
            content.appendChild(topBar);

            const backButton = document.createElement('a');
            backButton.textContent = "◀";
            backButton.className = "back-button";
            backButton.onclick = function() {
                vscode.postMessage({ type: 'getFunctions', chapter: chapter, modern });
            }
            topBar.appendChild(backButton);

            const categoryImageElement = document.createElement('div');
            categoryImageElement.className = `function-${funcCategoryValue}-image`;
            if (categoryImage) {
                categoryImageElement.style.backgroundImage = `url('data:image/png;base64,${categoryImage}')`;
            }
            else {
                categoryImageElement.style.backgroundImage = "url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=')";
            }
            categoryImageElement.style.width = "32px";
            categoryImageElement.style.height = "32px";
            categoryImageElement.style.backgroundSize = "cover";
            categoryImageElement.style.borderRadius = "5px";
            topBar.appendChild(categoryImageElement);            

            const detailsTitle = document.createElement('div');
            detailsTitle.className = 'details-header-title';
            detailsTitle.textContent = details['name'];
            topBar.appendChild(detailsTitle);

            var syntax = details['syntax'];
            if (syntax) {
                syntax = syntax.replace("\n", "<br>");
                const syntaxDiv = document.createElement('div');
                syntaxDiv.className = 'details-syntax';
                content.appendChild(syntaxDiv);    

                const syntaxTitle = document.createElement('div');
                syntaxTitle.className = 'details-syntax-title';
                syntaxTitle.textContent = details['syntaxTitle'];
                syntaxDiv.appendChild(syntaxTitle);
    
                const syntaxValue = document.createElement('div');
                syntaxValue.className = 'details-syntax-value';
                // The Carbide reference writes its syntax in Markdown
                syntaxValue.innerHTML = modern ? markedInstance.parseInline(details['syntax']) : syntax;
                syntaxDiv.appendChild(syntaxValue);
            }

            var description = details['description'];
            if (description) {
                const descriptionDiv = document.createElement('div');
                descriptionDiv.className = 'details-description';
                descriptionDiv.innerHTML = markedInstance.parse(description);
                content.appendChild(descriptionDiv);
            }

            const parameters = details['parameters'] || [];
            for (let i = 0; i < parameters.length; ++i) {
                const className = (i % 2 == 0) ? 'details-parameter-odd' : 'details-parameter-even';

                const parameterDiv = document.createElement('div');
                parameterDiv.className = className;
                content.appendChild(parameterDiv);    

                const parameterName = document.createElement('div');
                parameterName.className = 'details-parameter-name';
                parameterName.textContent = parameters[i].name;
                parameterDiv.appendChild(parameterName);

                const parameterDescription = document.createElement('div');
                parameterDescription.className = 'details-parameter-description';
                parameterDescription.textContent = parameters[i].description;
                parameterDiv.appendChild(parameterDescription);
            }

            const examples = details['examples'];
            if (examples) {
                for (let i = 0; i < examples.length; ++i) {
                    const example = examples[i];
                    const exampleValue = "```lua\n" + example['example'] + "\n```";

                    const exampleHeader = document.createElement('div');
                    exampleHeader.className = 'details-example-header';
                    exampleHeader.textContent = `Example ${i+1}`;
                    content.appendChild(exampleHeader);

                    const exampleCode = document.createElement('div');
                    exampleCode.className = 'details-example-code';
                    exampleCode.innerHTML = markedInstance.parse(exampleValue);
                    content.appendChild(exampleCode);
                }
            }

            const returns = details['returns'];
            if (returns) {
                const returnsDiv = document.createElement('div');
                returnsDiv.className = 'details-returns';
                content.appendChild(returnsDiv);    

                const returnsName = document.createElement('div');
                returnsName.className = 'details-parameter-name';
                returnsName.textContent = details['returnsTitle'];
                returnsDiv.appendChild(returnsName);

                const returnsDescription = document.createElement('div');
                returnsDescription.className = 'details-parameter-description';
                returnsDescription.textContent = returns;
                returnsDiv.appendChild(returnsDescription);
            }

            const related = details['related'];
            if (related && related.length > 0) {
                const relatedTitle = document.createElement('div');
                relatedTitle.className = 'details-related-title';
                relatedTitle.textContent = details['relatedTitle'];
                content.appendChild(relatedTitle);

                const relatedButtons = document.createElement('div');
                relatedButtons.className = 'details-related-buttons';
                content.appendChild(relatedButtons);

                for (const relatedId of related) {
                    const relatedButton = document.createElement('div');
                    relatedButton.className = 'details-related-button';
                    relatedButton.textContent = relatedId;
                    relatedButton.onclick = function() {
                        vscode.postMessage({ type: 'getFunctionDetails', chapter: chapter, functionId: relatedId, modern });
                    }
                    relatedButtons.appendChild(relatedButton);    
                }
            }

            window.scrollTo(0, 0);

            viewType = ViewType.Details;
        }
    }
}());
