import { appState } from "./state.js";
import { buildDerivedCompute, Circle, DerivedPoint, Intersection, Line, Point } from "./constructs.js";

function normalize(dx, dy) {
    const d = Math.hypot(dx, dy);
    if(d < 1e-9) return [1, 0];
    return [dx / d, dy / d];
}

function beginOperation(label, meta = null) {
    return {
        token: {},
        label,
        meta,
    };
}

function addConstruct(construct, operation = null, historyRoot = true) {
    if(operation) {
        construct.historyOp = operation.token;
        construct.historyLabel = operation.label;
        if(operation.meta) {
            construct.historyMeta = operation.meta;
        }
        construct.historyRoot = historyRoot;
    }
    appState.constructs.push(construct);
    appState.constructStack.push(construct);
    return construct;
}

export const tools = [
    {
        name: "Point",
        icon: "●",
        instruction: "click to place",
    },
    {
        name: "Line",
        icon: "／",
        instruction: "pick 2 points",
        process: [
            { action: "tool", tool: 0 },
            { action: "tool", tool: 0 },
            { action: "create", construct: Line, args: [0, 1] },
            { action: "end" },
        ],
    },
    {
        name: "Circle",
        icon: "◯",
        instruction: "center + point",
        process: [
            { action: "tool", tool: 0 },
            { action: "tool", tool: 0 },
            { action: "create", construct: Circle, args: [0, 1] },
            { action: "end" },
        ],
    },
    {
        name: "Intersect",
        icon: "×",
        instruction: "pick 2 curves",
        process: [
            { action: "pick", possible: [Line, Circle] },
            { action: "pick", possible: [Line, Circle] },
            {
                action: "function",
                function() {
                    const first = appState.constructStack[appState.constructStack.length - 2];
                    const last = appState.constructStack[appState.constructStack.length - 1];
                    const p1 = new Intersection(first, last, 0);
                    const op = beginOperation("Intersection");
                    addConstruct(p1, op, true);
                    if(first instanceof Circle || last instanceof Circle) {
                        const p2 = new Intersection(first, last, 1);
                        addConstruct(p2, op, false);
                    }
                    return true;
                },
            },
            { action: "end" },
        ],
    },
    {
        name: "Perpendicular",
        icon: "⟂",
        instruction: "line + point",
        process: [
            { action: "pick", possible: [Line] },
            { action: "pick", possible: [Point, Intersection] },
            {
                action: "function",
                function() {
                    const baseLine = appState.constructStack[appState.constructStack.length - 2];
                    const through = appState.constructStack[appState.constructStack.length - 1];
                    const op = beginOperation("Perpendicular");
                    const descriptor = {
                        kind: "lineDirection",
                        mode: "perpendicular",
                        throughIndex: 1,
                        linePoint1Index: 2,
                        linePoint2Index: 3,
                    };
                    const endpoint = new DerivedPoint([baseLine, through, baseLine.point1, baseLine.point2], () => {
                        const dx = baseLine.point2.x - baseLine.point1.x;
                        const dy = baseLine.point2.y - baseLine.point1.y;
                        const dir = normalize(-dy, dx);
                        return [through.x + dir[0], through.y + dir[1]];
                    }, true, descriptor);
                    endpoint.compute = buildDerivedCompute(descriptor, endpoint.parents);
                    addConstruct(endpoint, op, false);
                    addConstruct(new Line(through, endpoint), op, true);
                    return true;
                },
            },
            { action: "end" },
        ],
    },
    {
        name: "Angle bisector",
        icon: "∡",
        instruction: "A, vertex, B",
        process: [
            { action: "pick", possible: [Point, Intersection] },
            { action: "pick", possible: [Point, Intersection] },
            { action: "pick", possible: [Point, Intersection] },
            {
                action: "function",
                function() {
                    const armA = appState.constructStack[appState.constructStack.length - 3];
                    const vertex = appState.constructStack[appState.constructStack.length - 2];
                    const armB = appState.constructStack[appState.constructStack.length - 1];
                    const op = beginOperation("Angle bisector");
                    const descriptor = {
                        kind: "angleBisector",
                        vertexIndex: 0,
                        armAIndex: 1,
                        armBIndex: 2,
                    };
                    const endpoint = new DerivedPoint([vertex, armA, armB], () => {
                        const ua = normalize(armA.x - vertex.x, armA.y - vertex.y);
                        const ub = normalize(armB.x - vertex.x, armB.y - vertex.y);
                        let vx = ua[0] + ub[0];
                        let vy = ua[1] + ub[1];
                        if(Math.hypot(vx, vy) < 1e-9) {
                            vx = -ua[1];
                            vy = ua[0];
                        }
                        const dir = normalize(vx, vy);
                        return [vertex.x + dir[0], vertex.y + dir[1]];
                    }, true, descriptor);
                    endpoint.compute = buildDerivedCompute(descriptor, endpoint.parents);
                    addConstruct(endpoint, op, false);
                    addConstruct(new Line(vertex, endpoint), op, true);
                    return true;
                },
            },
            { action: "end" },
        ],
    },
    {
        name: "Compass",
        icon: "🧭",
        instruction: "center + distance",
        process: [
            { action: "pick", possible: [Point, Intersection] },
            { action: "pick", possible: [Point, Intersection] },
            { action: "pick", possible: [Point, Intersection] },
            {
                action: "function",
                function() {
                    const center = appState.constructStack[appState.constructStack.length - 3];
                    const radiusA = appState.constructStack[appState.constructStack.length - 2];
                    const radiusB = appState.constructStack[appState.constructStack.length - 1];
                    const op = beginOperation("Compass");
                    const descriptor = {
                        kind: "compassOuter",
                        centerIndex: 0,
                        radiusAIndex: 1,
                        radiusBIndex: 2,
                    };
                    const outer = new DerivedPoint([center, radiusA, radiusB], () => {
                        const r = Math.hypot(radiusA.x - radiusB.x, radiusA.y - radiusB.y);
                        const dir = normalize(radiusA.x - center.x, radiusA.y - center.y);
                        return [center.x + dir[0] * r, center.y + dir[1] * r];
                    }, true, descriptor);
                    outer.compute = buildDerivedCompute(descriptor, outer.parents);
                    addConstruct(outer, op, false);
                    addConstruct(new Circle(center, outer), op, true);
                    return true;
                },
            },
            { action: "end" },
        ],
    },
    {
        name: "Midpoint",
        icon: "⊙",
        instruction: "pick 2 points",
        process: [
            { action: "pick", possible: [Point, Intersection] },
            { action: "pick", possible: [Point, Intersection] },
            {
                action: "function",
                function() {
                    const a = appState.constructStack[appState.constructStack.length - 2];
                    const b = appState.constructStack[appState.constructStack.length - 1];
                    const op = beginOperation("Midpoint");
                    const descriptor = {
                        kind: "midpoint",
                        aIndex: 0,
                        bIndex: 1,
                    };
                    const midpoint = new DerivedPoint([a, b], () => [(a.x + b.x) / 2, (a.y + b.y) / 2], false, descriptor);
                    midpoint.compute = buildDerivedCompute(descriptor, midpoint.parents);
                    addConstruct(midpoint, op, true);
                    return true;
                },
            },
            { action: "end" },
        ],
    },
    {
        name: "Parallel",
        icon: "∥",
        instruction: "line + point",
        process: [
            { action: "pick", possible: [Line] },
            { action: "pick", possible: [Point, Intersection] },
            {
                action: "function",
                function() {
                    const baseLine = appState.constructStack[appState.constructStack.length - 2];
                    const through = appState.constructStack[appState.constructStack.length - 1];
                    const op = beginOperation("Parallel", { through, baseLine });
                    const descriptor = {
                        kind: "lineDirection",
                        mode: "parallel",
                        throughIndex: 1,
                        linePoint1Index: 2,
                        linePoint2Index: 3,
                    };
                    const endpoint = new DerivedPoint([baseLine, through, baseLine.point1, baseLine.point2], () => {
                        const dx = baseLine.point2.x - baseLine.point1.x;
                        const dy = baseLine.point2.y - baseLine.point1.y;
                        const dir = normalize(dx, dy);
                        return [through.x + dir[0], through.y + dir[1]];
                    }, true, descriptor);
                    endpoint.compute = buildDerivedCompute(descriptor, endpoint.parents);
                    addConstruct(endpoint, op, false);
                    addConstruct(new Line(through, endpoint), op, true);
                    return true;
                },
            },
            { action: "end" },
        ],
    },
];

export { Point, Line, Circle, Intersection, DerivedPoint };
