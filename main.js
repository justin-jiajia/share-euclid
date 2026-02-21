import { appState, cam, isSelected } from "./state.js";
import { buildDerivedCompute, Circle, deleteConstruct, DerivedPoint, initializeConstructs, Intersection, Line, Point } from "./constructs.js";
import { tools } from "./tools.js";
import { createToolbar } from "./toolbar.js";

const toolbarElement = document.getElementById("toolbar");
const toolbarUi = createToolbar(toolbarElement, tools, toggleRootTool);
const historyPanel = document.getElementById("history-panel");
const historyList = document.getElementById("history-list");
const undoBtn = document.getElementById("undo-btn");
const redoBtn = document.getElementById("redo-btn");
const shareBtn = document.getElementById("share-btn");
const infoBtn = document.getElementById("info-btn");
const infoModal = document.getElementById("info-modal");
const infoCloseBtn = document.getElementById("info-close");
const infoReadme = document.getElementById("info-readme");
const loadDefaultBtn = document.getElementById("load-default-btn");
const remarkEditor = document.getElementById("remark-editor");
const remarkLabel = document.getElementById("remark-label");
const remarkInput = document.getElementById("remark-input");
const remarkSaveBtn = document.getElementById("remark-save");
const remarkCancelBtn = document.getElementById("remark-cancel");

let historyEntries = [];
let activeRemarkEntry = null;
let lastHashState = "";
let lastHistoryRenderKey = "";
const undoStack = [];
const redoStack = [];
let currentStateSignature = "";
let dragUndoPending = false;
let touchGesture = null;

function getToolbarHeight() {
    return toolbarUi.getHeight();
}

function getActiveRootTool() {
    return appState.toolStack.length ? appState.toolStack[0][0] : null;
}

function toggleRootTool(index) {
    appState.toolStack = getActiveRootTool() === index ? [] : [[index, 0]];
    appState.constructStack.length = 0;
    toolbarUi.updateActive(getActiveRootTool());
}

function updateHoveringPriority(points, intersections, lines, circles) {
    for(const c of appState.constructs)
        if(((c instanceof Line && lines) || (c instanceof Circle && circles)) && c.hovering()) appState.hovering = c;
    for(const c of appState.constructs)
        if((c instanceof Intersection && intersections) && c.hovering()) appState.hovering = c;
    for(const c of appState.constructs)
        if((c instanceof Point && points) && c.hovering()) appState.hovering = c;
}

function isMouseInsideElement(el, x = mouseX, y = mouseY) {
    if(!el) return false;
    const rect = el.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function isCanvasInteractionBlockedAt(x, y) {
    return y <= getToolbarHeight() || isMouseInsideElement(historyPanel, x, y);
}

function applyPinchGesture(previousGesture, nextA, nextB) {
    const nextMidX = (nextA.x + nextB.x) * 0.5;
    const nextMidY = (nextA.y + nextB.y) * 0.5;
    const previousMidX = previousGesture.midX;
    const previousMidY = previousGesture.midY;
    const nextDistance = Math.hypot(nextA.x - nextB.x, nextA.y - nextB.y);
    if(previousGesture.distance > 0 && nextDistance > 0) {
        const p = cam.rcameraToWorld(previousMidX, previousMidY);
        cam.rzoom = constrain(cam.rzoom * (nextDistance / previousGesture.distance), 1, 5);
        const n = cam.rcameraToWorld(nextMidX, nextMidY);
        cam.rx += p[0] - n[0];
        cam.ry += p[1] - n[1];
    }
    touchGesture = {
        mode: "pinch",
        midX: nextMidX,
        midY: nextMidY,
        distance: nextDistance,
    };
}

function getActiveTouches(event) {
    const touchSource = event?.touches?.length ? Array.from(event.touches) : (Array.isArray(touches) ? touches : []);
    if(!touchSource.length) return [];
    return touchSource
        .map((touch) => {
            const x = Number.isFinite(touch?.x) ? touch.x : (Number.isFinite(touch?.clientX) ? touch.clientX : (Number.isFinite(touch?.winX) ? touch.winX : null));
            const y = Number.isFinite(touch?.y) ? touch.y : (Number.isFinite(touch?.clientY) ? touch.clientY : (Number.isFinite(touch?.winY) ? touch.winY : null));
            return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
        })
        .filter(Boolean);
}

function escapeHtml(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#39;");
}

function renderRemarkMarkup(text) {
    const source = (text || "").trim();
    if(!source) return "";
    return `<div>${escapeHtml(source).replaceAll("\n", "<br>")}</div>`;
}

function autoRenderRemarkMath() {
    if(typeof window.renderMathInElement !== "function" || !historyList) return;
    const blocks = historyList.querySelectorAll(".remark-body");
    for(const block of blocks) {
        window.renderMathInElement(block, {
            delimiters: [
                { left: "$$", right: "$$", display: true },
                { left: "$", right: "$", display: false },
            ],
            throwOnError: false,
        });
    }
}

function closeRemarkEditor() {
    activeRemarkEntry = null;
    if(remarkEditor) remarkEditor.classList.remove("open");
}

function openRemarkEditor(entryIndex) {
    const entry = historyEntries[entryIndex];
    if(!entry || !remarkEditor || !remarkInput) return;
    activeRemarkEntry = entry;
    remarkLabel.textContent = `Remark for ${entry.text}`;
    remarkInput.value = entry.construct.remark || "";
    remarkEditor.classList.add("open");
    remarkInput.focus();
}

function saveRemark() {
    if(!activeRemarkEntry || !remarkInput) return;
    const value = remarkInput.value.trim();
    if(value) activeRemarkEntry.construct.remark = value;
    else delete activeRemarkEntry.construct.remark;
    captureUndoSnapshot();
    closeRemarkEditor();
}

function wireRemarkEditor() {
    if(historyPanel) {
        historyPanel.addEventListener("pointerdown", (event) => {
            event.stopPropagation();
        });
        historyPanel.addEventListener("click", (event) => {
            const target = event.target;
            if(!(target instanceof Element)) return;
            const btn = target.closest(".remark-btn");
            if(!btn) return;
            const idx = Number(btn.dataset.entryIndex);
            if(Number.isFinite(idx)) openRemarkEditor(idx);
        });
    }
    if(remarkSaveBtn) remarkSaveBtn.addEventListener("click", saveRemark);
    if(remarkCancelBtn) remarkCancelBtn.addEventListener("click", closeRemarkEditor);
}

function updateUndoButtonState() {
    if(undoBtn) {
        undoBtn.disabled = undoStack.length === 0;
        undoBtn.title = undoStack.length ? "Undo last change" : "Nothing to undo";
    }
    if(redoBtn) {
        redoBtn.disabled = redoStack.length === 0;
        redoBtn.title = redoStack.length ? "Redo last undone change" : "Nothing to redo";
    }
}

function markUndoBaseline(clearStack = false) {
    currentStateSignature = JSON.stringify(serializeConstruction());
    if(clearStack) {
        undoStack.length = 0;
        redoStack.length = 0;
    }
    updateUndoButtonState();
}

function captureUndoSnapshot() {
    const nextSignature = JSON.stringify(serializeConstruction());
    if(!currentStateSignature) {
        currentStateSignature = nextSignature;
        updateUndoButtonState();
        return;
    }
    if(nextSignature === currentStateSignature) return;

    undoStack.push(currentStateSignature);
    if(undoStack.length > 120) undoStack.shift();
    redoStack.length = 0;
    currentStateSignature = nextSignature;
    updateUndoButtonState();
}

function performUndo() {
    if(!undoStack.length) return;
    const current = JSON.stringify(serializeConstruction());
    const signature = undoStack.pop();
    redoStack.push(current);
    if(redoStack.length > 120) redoStack.shift();
    const data = JSON.parse(signature);
    loadConstruction(data);
    closeRemarkEditor();
    currentStateSignature = signature;
    lastHistoryRenderKey = "";
    trySaveStateToHash();
    updateUndoButtonState();
}

function performRedo() {
    if(!redoStack.length) return;
    const current = JSON.stringify(serializeConstruction());
    const signature = redoStack.pop();
    undoStack.push(current);
    if(undoStack.length > 120) undoStack.shift();
    const data = JSON.parse(signature);
    loadConstruction(data);
    closeRemarkEditor();
    currentStateSignature = signature;
    lastHistoryRenderKey = "";
    trySaveStateToHash();
    updateUndoButtonState();
}

async function shareCurrentLink() {
    const defaultLabel = shareBtn ? (shareBtn.dataset.defaultLabel || shareBtn.textContent || "Share") : "Share";
    if(shareBtn && !shareBtn.dataset.defaultLabel) {
        shareBtn.dataset.defaultLabel = defaultLabel;
    }
    const setShareLabel = (text, timeout = 0) => {
        if(!shareBtn) return;
        shareBtn.textContent = text;
        if(timeout > 0) {
            window.setTimeout(() => {
                shareBtn.textContent = defaultLabel;
            }, timeout);
        }
    };

    if(!trySaveStateToHash()) {
        setShareLabel("Too long", 1800);
        alert("Unable to put current state into URL hash (too large). Try reducing steps or note content.");
        return;
    }

    const url = window.location.href;
    try {
        if(navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
            setShareLabel("Copied!", 1400);
            return;
        }
    }
    catch(error) {
        console.warn("Clipboard write failed.", error);
    }
    window.prompt("Copy this link:", url);
    setShareLabel("Use prompt", 1400);
}

function wireTopActions() {
    if(undoBtn) undoBtn.addEventListener("click", performUndo);
    if(redoBtn) redoBtn.addEventListener("click", performRedo);
    if(shareBtn) shareBtn.addEventListener("click", () => {
        shareCurrentLink();
    });
    if(infoBtn) infoBtn.addEventListener("click", () => {
        openInfoModal();
    });
    updateUndoButtonState();
}

function openInfoModal() {
    if(infoModal) infoModal.classList.add("open");
}

function closeInfoModal() {
    if(infoModal) infoModal.classList.remove("open");
}

async function loadReadmeIntoInfo() {
    if(!infoReadme) return;
    try {
        const response = await fetch("./README.md", { cache: "no-store" });
        if(!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        infoReadme.textContent = text;
    }
    catch(error) {
        infoReadme.textContent = `Failed to load README.md: ${error.message || error}`;
    }
}

function loadDefaultConstruction() {
    const previousSignature = currentStateSignature || JSON.stringify(serializeConstruction());

    appState.constructs.length = 0;
    appState.selected = [];
    appState.hovering = null;
    appState.toolStack = [];
    appState.constructStack = [];

    initializeConstructs();
    closeRemarkEditor();
    closeInfoModal();

    const nextSignature = JSON.stringify(serializeConstruction());
    if(previousSignature && previousSignature !== nextSignature) {
        undoStack.push(previousSignature);
        if(undoStack.length > 120) undoStack.shift();
    }
    currentStateSignature = nextSignature;
    lastHistoryRenderKey = "";
    updateUndoButtonState();
    trySaveStateToHash();
}

function wireInfoModal() {
    if(infoCloseBtn) infoCloseBtn.addEventListener("click", closeInfoModal);
    if(infoModal) {
        infoModal.addEventListener("click", (event) => {
            if(event.target === infoModal) closeInfoModal();
        });
    }
    if(loadDefaultBtn) loadDefaultBtn.addEventListener("click", loadDefaultConstruction);
}

function renderHistory() {
    if(!historyList) return;

    function labelPoint(p) {
        return p?.pointName || p?.helperPointName || "P?";
    }

    function describe(construct) {
        if(construct.historyLabel) {
            if(construct.historyLabel === "Parallel" && construct.historyMeta) {
                const through = construct.historyMeta.through;
                const baseLine = construct.historyMeta.baseLine;
                if(baseLine?.point1 && baseLine?.point2) {
                    const linePrefix = construct.lineName ? ` ${construct.lineName}` : "";
                    return `Parallel${linePrefix}: ${labelPoint(through)}, Line(${labelPoint(baseLine.point1)}, ${labelPoint(baseLine.point2)})`;
                }
            }
            if(construct instanceof Line) {
                const linePrefix = construct.lineName ? ` ${construct.lineName}` : "";
                return `${construct.historyLabel}${linePrefix}: Line(${labelPoint(construct.point1)}, ${labelPoint(construct.point2)})`;
            }
            if(construct instanceof Circle) {
                return `${construct.historyLabel}: Circle(${labelPoint(construct.center)} → ${labelPoint(construct.outer)})`;
            }
            return construct.historyLabel;
        }
        if(construct instanceof Line) {
            return `Line(${labelPoint(construct.point1)}, ${labelPoint(construct.point2)})`;
        }
        if(construct instanceof Circle) {
            return `Circle(${labelPoint(construct.center)} → ${labelPoint(construct.outer)})`;
        }
        if(construct instanceof Intersection) {
            return `Intersection(${construct.n ? "2" : "1"})`;
        }
        if(construct instanceof DerivedPoint) {
            return `Point(${labelPoint(construct)})`;
        }
        if(construct instanceof Point) {
            if(construct.locked) return `Point on construct (${labelPoint(construct)})`;
            return `Point(${labelPoint(construct)})`;
        }
        return "Construct";
    }

    const entries = [];
    const seenOperations = new Set();
    for(const c of appState.constructs) {
        if(c instanceof DerivedPoint && c.hidden) continue;
        if(c.historyOp) {
            if(c.historyRoot === false) continue;
            if(seenOperations.has(c.historyOp)) continue;
            seenOperations.add(c.historyOp);
        }
        entries.push({ construct: c, text: describe(c) });
    }

    historyEntries = entries.slice(0, 24);

    const renderKey = historyEntries
        .map((entry) => `${entry.text}\u241f${entry.construct.remark || ""}`)
        .join("\u241e");

    if(!historyEntries.length) {
        if(lastHistoryRenderKey !== "__empty__") {
            historyList.innerHTML = "<li class=\"history-empty\">No constructions yet.</li>";
            lastHistoryRenderKey = "__empty__";
        }
        if(activeRemarkEntry) closeRemarkEditor();
        return;
    }

    if(renderKey === lastHistoryRenderKey) {
        return;
    }
    lastHistoryRenderKey = renderKey;

    historyList.innerHTML = historyEntries
        .map((entry, index) => {
            const remarkHtml = renderRemarkMarkup(entry.construct.remark);
            return `<li>
                <div class="history-row">
                    <span><span class="history-index">${index + 1}.</span> ${escapeHtml(entry.text)}</span>
                    <button class="remark-btn" type="button" data-entry-index="${index}">${entry.construct.remark ? "Edit note" : "Add note"}</button>
                </div>
                ${remarkHtml ? `<div class="remark-body">${remarkHtml}</div>` : ""}
            </li>`;
        })
        .join("");

    autoRenderRemarkMath();
}

function refreshPointNames() {
    let pointIndex = 1;
    let helperIndex = 1;
    for(const c of appState.constructs) {
        c.pointName = null;
        c.helperPointName = null;
    }
    for(const c of appState.constructs) {
        if(c instanceof DerivedPoint && c.hidden) {
            c.helperPointName = `H${helperIndex}`;
            helperIndex += 1;
            continue;
        }
        if(c instanceof Point || c instanceof Intersection || c instanceof DerivedPoint) {
            c.pointName = `P${pointIndex}`;
            pointIndex += 1;
        }
    }
}

function refreshLineNames() {
    let lineIndex = 1;
    for(const c of appState.constructs) {
        c.lineName = null;
    }
    for(const c of appState.constructs) {
        if(c instanceof Line && c.historyLabel) {
            c.lineName = `L${lineIndex}`;
            lineIndex += 1;
        }
    }
}

function rectsOverlap(a, b) {
    return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function layoutLabels() {
    const labeled = [];
    for(const c of appState.constructs) {
        if((c instanceof Point || c instanceof Intersection || c instanceof DerivedPoint) && c.pointName && !(c instanceof DerivedPoint && c.hidden) && c.exists) {
            const p = cam.worldToCamera(c.x, c.y);
            labeled.push({ construct: c, text: c.pointName, anchorX: p[0], anchorY: p[1] });
        }
        else if(c instanceof Line && c.lineName && c.exists) {
            const mx = (c.point1.x + c.point2.x) * 0.5;
            const my = (c.point1.y + c.point2.y) * 0.5;
            const p = cam.worldToCamera(mx, my);
            labeled.push({ construct: c, text: c.lineName, anchorX: p[0], anchorY: p[1] });
        }
    }

    const placed = [];
    const candidates = [
        [8, -8], [10, -20], [12, 10], [-48, -8], [-52, 10], [18, -32], [-60, -22], [24, 22], [-66, 24], [0, -40], [0, 28],
    ];

    push();
    textSize(12);
    for(const item of labeled) {
        let best = null;
        const w = Math.max(24, textWidth(item.text) + 4);
        const h = 14;
        for(const [ox, oy] of candidates) {
            const r = {
                x: item.anchorX + ox,
                y: item.anchorY + oy - h,
                w,
                h,
                ox,
                oy,
            };
            let overlaps = 0;
            for(const p of placed) {
                if(rectsOverlap(r, p)) overlaps += 1;
            }
            if(best === null || overlaps < best.overlaps) {
                best = { ...r, overlaps };
                if(overlaps === 0) break;
            }
        }

        if(best) {
            item.construct.labelOffsetX = best.ox;
            item.construct.labelOffsetY = best.oy;
            placed.push(best);
        }
    }
    pop();
}

function encodeMeta(meta, indexMap) {
    if(meta === null || meta === undefined) return meta;
    if(typeof meta !== "object") return meta;
    if(indexMap.has(meta)) return { __ref: indexMap.get(meta) };
    if(Array.isArray(meta)) return meta.map((item) => encodeMeta(item, indexMap));
    const out = {};
    for(const key of Object.keys(meta)) {
        out[key] = encodeMeta(meta[key], indexMap);
    }
    return out;
}

function encodeStateToHash(payload) {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    for(const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeStateFromHash(hashValue) {
    const normalized = hashValue.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + "=".repeat(padLength);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
}

function saveStateToHash() {
    const payload = serializeConstruction();
    const encoded = encodeStateToHash(payload);
    const next = `state=${encoded}`;
    if(next === lastHashState) return;
    lastHashState = next;
    history.replaceState(null, "", `#${next}`);
}

function trySaveStateToHash() {
    try {
        saveStateToHash();
        return true;
    }
    catch(error) {
        console.warn("Failed to save state to URL hash.", error);
        return false;
    }
}

function tryLoadStateFromHash(pushUndo = false) {
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    if(!hash) return false;

    const value = hash.startsWith("state=") ? hash.slice("state=".length) : hash;
    if(!value) return false;
    try {
        const previousSignature = JSON.stringify(serializeConstruction());
        const data = decodeStateFromHash(value);
        loadConstruction(data);
        lastHashState = `state=${value}`;
        const nextSignature = JSON.stringify(serializeConstruction());
        if(pushUndo && previousSignature && previousSignature !== nextSignature) {
            undoStack.push(previousSignature);
            if(undoStack.length > 120) undoStack.shift();
            redoStack.length = 0;
        }
        currentStateSignature = nextSignature;
        updateUndoButtonState();
        return true;
    }
    catch(error) {
        console.warn("Failed to load construction from hash.", error);
        return false;
    }
}

function wireHashLoading() {
    window.addEventListener("hashchange", () => {
        const loaded = tryLoadStateFromHash(true);
        if(loaded) {
            closeRemarkEditor();
            closeInfoModal();
            lastHistoryRenderKey = "";
        }
    });
}

function decodeMeta(meta, constructs) {
    if(meta === null || meta === undefined) return meta;
    if(typeof meta !== "object") return meta;
    if(Object.prototype.hasOwnProperty.call(meta, "__ref")) {
        return constructs[meta.__ref] || null;
    }
    if(Array.isArray(meta)) return meta.map((item) => decodeMeta(item, constructs));
    const out = {};
    for(const key of Object.keys(meta)) {
        out[key] = decodeMeta(meta[key], constructs);
    }
    return out;
}

function serializeConstruction() {
    const constructs = appState.constructs;
    const indexMap = new Map();
    for(let i = 0; i < constructs.length; i += 1) {
        indexMap.set(constructs[i], i);
    }

    const opTokenToId = new Map();
    let opCounter = 1;
    const getOpId = (token) => {
        if(!token) return null;
        if(!opTokenToId.has(token)) {
            opTokenToId.set(token, opCounter);
            opCounter += 1;
        }
        return opTokenToId.get(token);
    };

    const items = constructs.map((c) => {
        const item = {};
        if(c instanceof DerivedPoint) {
            item.kind = "DerivedPoint";
            item.parents = c.parents.map((p) => indexMap.get(p));
            item.hidden = !!c.hidden;
            item.descriptor = c.descriptor || null;
        }
        else if(c instanceof Intersection) {
            item.kind = "Intersection";
            item.construct1 = indexMap.get(c.construct1);
            item.construct2 = indexMap.get(c.construct2);
            item.n = c.n;
        }
        else if(c instanceof Line) {
            item.kind = "Line";
            item.point1 = indexMap.get(c.point1);
            item.point2 = indexMap.get(c.point2);
        }
        else if(c instanceof Circle) {
            item.kind = "Circle";
            item.center = indexMap.get(c.center);
            item.outer = indexMap.get(c.outer);
        }
        else if(c instanceof Point) {
            item.kind = "Point";
            item.x = c.x;
            item.y = c.y;
            item.locked = c.locked && indexMap.has(c.locked) ? indexMap.get(c.locked) : null;
        }
        else {
            item.kind = "Unknown";
        }

        if(c.historyLabel || c.historyOp || c.historyMeta || c.historyRoot === false) {
            item.history = {
                label: c.historyLabel || null,
                root: c.historyRoot !== false,
                opId: getOpId(c.historyOp),
                meta: c.historyMeta ? encodeMeta(c.historyMeta, indexMap) : null,
            };
        }

        if(typeof c.remark === "string" && c.remark.trim()) {
            item.remark = c.remark;
        }

        return item;
    });

    return {
        version: 1,
        constructs: items,
    };
}

function loadConstruction(data) {
    if(!data || !Array.isArray(data.constructs)) {
        throw new Error("Invalid construction file format");
    }

    const constructs = [];
    const pendingMeta = [];
    const opIdToToken = new Map();
    const getToken = (opId) => {
        if(opId === null || opId === undefined) return null;
        if(!opIdToToken.has(opId)) opIdToToken.set(opId, {});
        return opIdToToken.get(opId);
    };

    for(const item of data.constructs) {
        let construct = null;
        switch(item.kind) {
            case "Point": {
                const locked = Number.isInteger(item.locked) ? constructs[item.locked] : false;
                construct = new Point(item.x ?? 0, item.y ?? 0, locked || false);
                break;
            }
            case "DerivedPoint": {
                const parents = (item.parents || []).map((i) => constructs[i]);
                construct = new DerivedPoint(parents, null, !!item.hidden, item.descriptor || null);
                if(!construct.compute) {
                    construct.compute = buildDerivedCompute(construct.descriptor, construct.parents);
                }
                break;
            }
            case "Line":
                construct = new Line(constructs[item.point1], constructs[item.point2]);
                break;
            case "Circle":
                construct = new Circle(constructs[item.center], constructs[item.outer]);
                break;
            case "Intersection":
                construct = new Intersection(constructs[item.construct1], constructs[item.construct2], item.n || 0);
                break;
            default:
                throw new Error(`Unsupported construct kind: ${item.kind}`);
        }

        if(item.history) {
            if(item.history.label) construct.historyLabel = item.history.label;
            if(item.history.root === false) construct.historyRoot = false;
            const token = getToken(item.history.opId);
            if(token) construct.historyOp = token;
            if(item.history.meta) {
                pendingMeta.push([construct, item.history.meta]);
            }
        }

        if(typeof item.remark === "string") {
            construct.remark = item.remark;
        }

        constructs.push(construct);
    }

    for(const [construct, meta] of pendingMeta) {
        construct.historyMeta = decodeMeta(meta, constructs);
    }

    appState.constructs = constructs;
    appState.selected = [];
    appState.hovering = null;
    appState.toolStack = [];
    appState.constructStack = [];
}

window.setup = function() {
    createCanvas(windowWidth, windowHeight);
    if(!tryLoadStateFromHash()) {
        markUndoBaseline(true);
        openInfoModal();
    }
    else {
        closeInfoModal();
    }
    wireRemarkEditor();
    wireTopActions();
    wireInfoModal();
    loadReadmeIntoInfo();
    wireHashLoading();
    toolbarUi.updateActive(getActiveRootTool());
};

window.windowResized = function() {
    resizeCanvas(windowWidth, windowHeight);
};

window.keyPressed = function() {
    appState.keys[key.toString().toLowerCase()] = true;
    appState.pkeys[key.toString().toLowerCase()] = true;
    if(key === "Delete" && appState.selected.length) {
        for(const c of appState.selected)
            deleteConstruct(c);
        appState.selected.length = 0;
        captureUndoSnapshot();
    }
};

window.keyReleased = function() {
    appState.keys[key.toString().toLowerCase()] = false;
};

window.mousePressed = function() {
    if(isCanvasInteractionBlockedAt(mouseX, mouseY)) {
        return;
    }

    if(!appState.hovering) appState.selected = [];
    else if(appState.keys.shift) {
        if(!isSelected(appState.hovering)) appState.selected.push(appState.hovering);
    }
    else appState.selected = [appState.hovering];

    appState.pressed = true;
    dragUndoPending = mouseButton === LEFT && appState.selected.length > 0;
};

window.mouseReleased = function() {
    appState.released = true;
    if(dragUndoPending) {
        captureUndoSnapshot();
        dragUndoPending = false;
    }
};

window.mouseClicked = function() {
    if(isCanvasInteractionBlockedAt(mouseX, mouseY)) return false;
    if(!appState.pressed) appState.pressed = true;
    return false;
};

window.touchStarted = function(event) {
    const activeTouches = getActiveTouches(event);
    if(!activeTouches || !activeTouches.length) return false;

    if(activeTouches.length >= 2) {
        appState.touchIsDown = false;
        const [a, b] = activeTouches;
        touchGesture = {
            mode: "pinch",
            midX: (a.x + b.x) * 0.5,
            midY: (a.y + b.y) * 0.5,
            distance: Math.hypot(a.x - b.x, a.y - b.y),
        };
        return false;
    }

    const touch = activeTouches[0];
    if(isCanvasInteractionBlockedAt(touch.x, touch.y)) {
        appState.touchIsDown = false;
        touchGesture = null;
        return false;
    }

    appState.touchIsDown = true;
    touchGesture = { mode: "drag", x: touch.x, y: touch.y, prevX: touch.x, prevY: touch.y };
    mouseX = touch.x;
    mouseY = touch.y;
    pmouseX = touch.x;
    pmouseY = touch.y;
    window.mousePressed();
    return false;
};

window.touchMoved = function(event) {
    const activeTouches = getActiveTouches(event);
    if(!activeTouches || !activeTouches.length) return false;

    if(activeTouches.length >= 2) {
        appState.touchIsDown = false;
        const [a, b] = activeTouches;
        if(!touchGesture || touchGesture.mode !== "pinch") {
            touchGesture = {
                mode: "pinch",
                midX: (a.x + b.x) * 0.5,
                midY: (a.y + b.y) * 0.5,
                distance: Math.hypot(a.x - b.x, a.y - b.y),
            };
        }
        else {
            applyPinchGesture(touchGesture, a, b);
        }
        return false;
    }

    const touch = activeTouches[0];
    pmouseX = mouseX;
    pmouseY = mouseY;
    mouseX = touch.x;
    mouseY = touch.y;
    if(!touchGesture || touchGesture.mode !== "drag") {
        touchGesture = { mode: "drag", x: touch.x, y: touch.y, prevX: touch.x, prevY: touch.y };
    }
    else if(!appState.selected.length && !appState.toolStack.length) {
        const n = cam.cameraToWorld(touch.x, touch.y);
        const p = cam.cameraToWorld(touchGesture.x, touchGesture.y);
        cam.rx += p[0] - n[0];
        cam.ry += p[1] - n[1];
    }
    touchGesture.prevX = touchGesture.x;
    touchGesture.prevY = touchGesture.y;
    touchGesture.x = touch.x;
    touchGesture.y = touch.y;
    return false;
};

window.touchEnded = function(event) {
    const activeTouches = getActiveTouches(event);
    if(activeTouches && activeTouches.length) {
        if(activeTouches.length === 1) {
            const touch = activeTouches[0];
            touchGesture = { mode: "drag", x: touch.x, y: touch.y, prevX: touch.x, prevY: touch.y };
            appState.touchIsDown = !isCanvasInteractionBlockedAt(touch.x, touch.y);
        }
        return false;
    }

    appState.touchIsDown = false;
    touchGesture = null;
    window.mouseReleased();
    return false;
};

window.mouseWheel = function(e) {
    const p = cam.rcameraToWorld(mouseX, mouseY);
    cam.rzoom -= e.delta * 0.001;
    cam.rzoom = constrain(cam.rzoom, 1, 5);
    const n = cam.rcameraToWorld(mouseX, mouseY);
    cam.rx += p[0] - n[0];
    cam.ry += p[1] - n[1];
};

function useTools() {
    appState.hovering = null;
    if(mouseY <= appState.toolbarHeight || isMouseInsideElement(historyPanel)) return;

    if(appState.toolStack.length) {
        const last = appState.toolStack[appState.toolStack.length - 2];
        const current = appState.toolStack[appState.toolStack.length - 1];

        if(current[0] === 0) {
            updateHoveringPriority(true, true, true, true);
            if(appState.hovering) {
                if((appState.hovering instanceof Point || appState.hovering instanceof Intersection)) {
                    if(appState.pressed) {
                        appState.pressed = false;
                        appState.toolStack.splice(appState.toolStack.length - 1, 1);
                        appState.constructStack.push(appState.hovering);
                        if(appState.toolStack.length)
                            last[1] += 1;
                    }
                }
                else {
                    const closest = appState.hovering.closest(...cam.cameraToWorld(mouseX, mouseY));
                    strokeWeight(20);
                    stroke(255, 0, 0, 50);
                    point(...cam.worldToCamera(...closest));
                    if(appState.pressed) {
                        appState.pressed = false;
                        appState.toolStack.splice(appState.toolStack.length - 1, 1);
                        const p = new Point(...closest, appState.hovering);
                        appState.constructStack.push(p);
                        appState.constructs.push(p);
                        captureUndoSnapshot();
                        if(appState.toolStack.length)
                            last[1] += 1;
                    }
                }
            }
            else {
                stroke(0, 100, 255, 50);
                strokeWeight(20);
                point(mouseX, mouseY);
                if(appState.pressed) {
                    appState.pressed = false;
                    const p = new Point(...cam.cameraToWorld(mouseX, mouseY));
                    appState.constructs.push(p);
                    appState.toolStack.splice(appState.toolStack.length - 1, 1);
                    appState.constructStack.push(p);
                    captureUndoSnapshot();
                    if(appState.toolStack.length)
                        last[1] += 1;
                }
            }
        }
        else {
            const tool = current[0];
            const step = current[1];
            switch(tools[tool].process[step].action) {
                case "tool":
                    appState.toolStack.push([tools[tool].process[step].tool, 0]);
                    break;
                case "create": {
                    const args = tools[tool].process[step].args.map((i) => appState.constructStack[i]);
                    const shape = new tools[tool].process[step].construct(...args);
                    appState.constructs.push(shape);
                    appState.constructStack.push(shape);
                    captureUndoSnapshot();
                    current[1] += 1;
                    break;
                }
                case "pick": {
                    const points = tools[tool].process[step].possible.includes(Point);
                    const intersections = tools[tool].process[step].possible.includes(Intersection);
                    const lines = tools[tool].process[step].possible.includes(Line);
                    const circles = tools[tool].process[step].possible.includes(Circle);
                    updateHoveringPriority(points, intersections, lines, circles);
                    if(appState.hovering && appState.pressed) {
                        appState.pressed = false;
                        appState.constructStack.push(appState.hovering);
                        current[1] += 1;
                    }
                    break;
                }
                case "function":
                    if(tools[tool].process[step].function()) {
                        captureUndoSnapshot();
                        appState.toolStack.splice(appState.toolStack.length - 1, 1);
                        current[1] += 1;
                    }
                    break;
                case "end":
                    appState.toolStack.splice(appState.toolStack.length - 1, 1);
                    if(appState.toolStack.length)
                        last[1] += 1;
                    break;
            }
        }
    }
    else {
        updateHoveringPriority(true, true, true, true);
        appState.constructStack.length = 0;
    }
}

function update() {
    for(const c of appState.constructs)
        c.update();
}

function display() {
    for(const c of appState.constructs)
        if(c instanceof Line || c instanceof Circle) c.display();
    for(const c of appState.constructs)
        if(c instanceof Intersection) c.display();
    for(const c of appState.constructs)
        if(c instanceof Point) c.display();
}

function controls() {
    cam.zoom += (cam.rzoom - cam.zoom) * 0.5;
    cam.x += (cam.rx - cam.x) * 0.5;
    cam.y += (cam.ry - cam.y) * 0.5;

    if(mouseY > appState.toolbarHeight && !isMouseInsideElement(historyPanel) && mouseIsPressed && (mouseButton === RIGHT || (mouseButton === LEFT && !appState.selected.length))) {
        const n = cam.cameraToWorld(mouseX, mouseY);
        const p = cam.cameraToWorld(pmouseX, pmouseY);
        cam.rx += p[0] - n[0];
        cam.ry += p[1] - n[1];
    }
}

window.draw = function() {
    if(appState.touchIsDown && touchGesture && touchGesture.mode === "drag") {
        pmouseX = touchGesture.prevX;
        pmouseY = touchGesture.prevY;
        mouseX = touchGesture.x;
        mouseY = touchGesture.y;
    }
    appState.toolbarHeight = getToolbarHeight();
    toolbarUi.updateActive(getActiveRootTool());

    background(255);
    useTools();
    update();
    refreshPointNames();
    refreshLineNames();
    layoutLabels();
    display();
    controls();
    renderHistory();
    if(frameCount % 15 === 0) {
        trySaveStateToHash();
    }

    appState.pkeys = {};
    appState.pressed = false;
    appState.released = false;
};
