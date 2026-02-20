export function createToolbar(toolbarEl, tools, onToolToggle) {
    toolbarEl.innerHTML = "";

    const buttons = tools.map((tool, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tool-button";
        button.dataset.index = String(index);
        button.innerHTML = `<span class="tool-icon">${tool.icon || "?"}</span><span class="tool-name">${tool.name}</span><span class="tool-instruction">${tool.instruction || ""}</span>`;
        button.addEventListener("click", () => onToolToggle(index));
        toolbarEl.appendChild(button);
        return button;
    });

    return {
        updateActive(activeIndex) {
            buttons.forEach((button, index) => {
                button.classList.toggle("active", index === activeIndex);
            });
        },
        getHeight() {
            return toolbarEl.offsetHeight || 0;
        },
    };
}
