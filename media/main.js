//@ts-check

class VsCodeState {
    colors = [];
}

(function () {
    const vscode = acquireVsCodeApi();

    const oldState = vscode.getState() || { parameters: [] };

    // Handle messages sent from the extension to the webview
    window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        switch (message.type) {
            case 'setParameters':
                {
                    setParameters(message.data);

                    break;
                }
            case 'setParameter':
                {
                    setParameter(message.data);

                    break;
                }

        }
    });

    setInterval(keepAlive, 1000);

    vscode.postMessage({ type: 'webViewReady' });

    function keepAlive() {
        vscode.postMessage({ type: 'webViewKeepAlive' });
    }

    function setParameter(parameter) {
        const li = document.getElementById(getParameterId(parameter));
        if (li) {
            initParameter(li, parameter);
        }
        else {
            const ul = document.querySelector('.parameter-list');
            if (ul) {
                createParameter(ul, parameter);
            }    
        }
    }

    function setParameters(parameters) {
        const ul = document.querySelector('.parameter-list');
        if (ul) {
            ul.textContent = '';

            for (const parameter of parameters) {
                createParameter(ul, parameter);
            }
        }
    }

    function getParameterId(parameter) {
        return `${parameter.type}_${parameter.name}`;
    }

    function updateSlider(slider) {
        var value = (slider.value - slider.min) / (slider.max - slider.min) * 100.0;
        slider.style.background = 'linear-gradient(to right, white 0%, white ' + value + '%, #888 ' + value + '%, #888 100%)';
    }

    function RGBToHex(r, g, b) {
        r = Math.floor(r).toString(16);
        g = Math.floor(g).toString(16);
        b = Math.floor(b).toString(16);

        if (r.length === 1) {
            r = "0" + r;
        }

        if (g.length === 1) {
            g = "0" + g;
        }

        if (b.length === 1) {
            b = "0" + b;
        }

        return "#" + r + g + b;
    }

    function hexToRGB(h) {
        let r = 0, g = 0, b = 0, a = 1;

        if (h.length === 4) {
            r = Number.parseInt("0x" + h[1] + h[1]);
            g = Number.parseInt("0x" + h[2] + h[2]);
            b = Number.parseInt("0x" + h[3] + h[3]);
        } else if (h.length === 7) {
            r = Number.parseInt("0x" + h[1] + h[2]);
            g = Number.parseInt("0x" + h[3] + h[4]);
            b = Number.parseInt("0x" + h[5] + h[6]);
        }

        return [r, g, b];
    }

    function refreshColorValue(colorInput, parameter) {
        const red = Math.floor(parameter.red * 255.0);
        const green = Math.floor(parameter.green * 255.0);
        const blue = Math.floor(parameter.blue * 255.0);
        const alpha = Math.floor(parameter.alpha * 255.0);
        colorInput.innerText = `${red} ${green} ${blue} ${alpha}`;
    }

    const sliderPrecision = 500.0;

    function initParameter(li, parameter) {
        li.innerHTML = '';

        switch (parameter.type) {
            case "Function":
                {
                    const input = document.createElement('input');
                    input.className = 'parameter-button';
                    input.type = 'button';
                    input.value = parameter.name;
                    input.onclick = function () {
                        vscode.postMessage({ type: 'setParameter', parameter: JSON.stringify(parameter) });
                    };
                    li.appendChild(input);

                    break;
                }
            case "Numeric":
                {
                    const parent = document.createElement('div');
                    parent.className = "slider-container";

                    const top = document.createElement('div');
                    top.className = "slider-top";
                    parent.appendChild(top);

                    const name = document.createElement('div');
                    name.className = "slider-name";
                    name.innerText = parameter.name;
                    top.appendChild(name);

                    const value = document.createElement('div');
                    value.className = "slider-value";
                    value.innerText = parameter.value.toFixed(2);
                    value.id = `slider-value-${parameter.name}`;
                    top.appendChild(value);

                    const slider = document.createElement('input');
                    slider.className = "slider";
                    slider.type = 'range';
                    slider.id = `slider-${parameter.name}`;
                    slider.min = "0";
                    slider.max = sliderPrecision.toString();
                    slider.value = (((parameter.value - parameter.min) / (parameter.max - parameter.min)) * sliderPrecision).toString();
                    slider.oninput = function () {
                        const newValue = parameter.min + ((Number.parseInt(slider.value) / sliderPrecision) * (parameter.max - parameter.min));
                        value.innerHTML = newValue.toFixed(2);
                        parameter.value = newValue;
                        vscode.postMessage({ type: 'setParameter', parameter: JSON.stringify(parameter) });
                        updateSlider(slider);
                    };
                    parent.appendChild(slider);

                    li.appendChild(parent);

                    updateSlider(slider);

                    break;
                }
            case "Boolean":
                {
                    const root = document.createElement('div');
                    root.className = "toggle-container";

                    const name = document.createElement('div');
                    name.className = "toggle-name";
                    name.innerText = parameter.name;
                    root.appendChild(name);

                    const toggleParent = document.createElement('div');
                    toggleParent.className = "toggle-parent";
                    root.appendChild(toggleParent);

                    const checkbox = document.createElement('input');
                    checkbox.className = "toggle";
                    checkbox.type = 'checkbox';
                    checkbox.id = `toggle-${parameter.name}`;
                    checkbox.checked = parameter.value;
                    checkbox.oninput = function () {
                        parameter.value = checkbox.checked;
                        vscode.postMessage({ type: 'setParameter', parameter: JSON.stringify(parameter) });
                    };
                    toggleParent.appendChild(checkbox);

                    li.appendChild(root);

                    break;
                }
            case "Text":
                {
                    const root = document.createElement('div');
                    root.className = "text-container";

                    const name = document.createElement('div');
                    name.className = "parameter-name";
                    name.innerText = parameter.name;
                    root.appendChild(name);

                    const text = document.createElement('input');
                    text.className = "text";
                    text.type = 'text';
                    text.id = `text-${parameter.name}`;
                    text.value = parameter.text;
                    text.oninput = function () {
                        parameter.text = text.value;
                        vscode.postMessage({ type: 'setParameter', parameter: JSON.stringify(parameter) });
                    };
                    root.appendChild(text);

                    li.appendChild(root);

                    break;
                }
            case "Watch":
                {
                    const root = document.createElement('div');
                    root.className = "text-container";

                    const name = document.createElement('div');
                    name.className = "parameter-name";
                    name.innerText = parameter.name;
                    root.appendChild(name);

                    const text = document.createElement('div');
                    text.className = "parameter-value";
                    text.id = `watch-${parameter.name}`;
                    text.innerText = parameter.result;
                    root.appendChild(text);

                    li.appendChild(root);

                    break;
                }
            case "Color":
                {
                    const root = document.createElement('div');
                    root.className = "color-container";

                    const top = document.createElement('div');
                    top.className = "color-top";
                    root.appendChild(top);

                    const left = document.createElement('div');
                    left.className = "color-left";
                    top.appendChild(left);

                    const right = document.createElement('div');
                    right.className = "color-right";
                    top.appendChild(right);

                    const name = document.createElement('div');
                    name.className = "parameter-name";
                    name.innerText = parameter.name;
                    left.appendChild(name);

                    const value = document.createElement('div');
                    value.className = "parameter-value";
                    left.appendChild(value);

                    const color = document.createElement('input');
                    color.className = 'color';
                    color.type = 'color';
                    color.id = `color-${parameter.name}`;
                    color.value = RGBToHex(parameter.red * 255, parameter.green * 255, parameter.blue * 255);
                    color.oninput = function () {
                        console.log(color.value);
                        const rgba = hexToRGB(color.value);
                        parameter.red = rgba[0] / 255.0;
                        parameter.green = rgba[1] / 255.0;
                        parameter.blue = rgba[2] / 255.0;
                        refreshColorValue(value, parameter);
                        vscode.postMessage({ type: 'setParameter', parameter: JSON.stringify(parameter) });
                    };
                    right.appendChild(color);

                    const slider = document.createElement('input');
                    slider.className = "slider";
                    slider.type = 'range';
                    slider.id = `color-slider-${parameter.name}`;
                    slider.min = "0";
                    slider.max = "255";
                    slider.value = (parameter.alpha * 255).toString();
                    slider.oninput = function () {
                        parameter.alpha = (Number.parseInt(slider.value) / 255.0);
                        refreshColorValue(value, parameter);
                        vscode.postMessage({ type: 'setParameter', parameter: JSON.stringify(parameter) });
                        updateSlider(slider);
                    };
                    root.appendChild(slider);                    

                    refreshColorValue(value, parameter);
                    updateSlider(slider);

                    li.appendChild(root);

                    break;
                }
            default:
                {
                    const text = document.createElement('div');
                    text.className = 'parameter-text';
                    text.innerText = `${parameter.type} ${parameter.name}`;
                    li.appendChild(text);

                    break;
                }
        }
    }

    function createParameter(ul, parameter) {
        const li = document.createElement('li');
        li.className = 'parameter-entry';
        li.id = getParameterId(parameter);
        ul.appendChild(li);

        initParameter(li, parameter);

        const hrLi = document.createElement('li');
        const hr = document.createElement('hr');
        hrLi.appendChild(hr);
        ul.appendChild(hrLi);
    }
}());
