import { appState, cam, isSelected } from "./state.js";

function normalize(dx, dy) {
    const d = Math.hypot(dx, dy);
    if(d < 1e-9) return [1, 0];
    return [dx / d, dy / d];
}

export function buildDerivedCompute(descriptor, parents) {
    if(!descriptor) return null;
    switch(descriptor.kind) {
        case "lineDirection":
            return () => {
                const through = parents[descriptor.throughIndex ?? 1];
                const linePoint1 = parents[descriptor.linePoint1Index ?? 2];
                const linePoint2 = parents[descriptor.linePoint2Index ?? 3];
                const dx = linePoint2.x - linePoint1.x;
                const dy = linePoint2.y - linePoint1.y;
                const dir = descriptor.mode === "perpendicular" ? normalize(-dy, dx) : normalize(dx, dy);
                return [through.x + dir[0], through.y + dir[1]];
            };
        case "angleBisector":
            return () => {
                const vertex = parents[descriptor.vertexIndex ?? 0];
                const armA = parents[descriptor.armAIndex ?? 1];
                const armB = parents[descriptor.armBIndex ?? 2];
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
            };
        case "compassOuter":
            return () => {
                const center = parents[descriptor.centerIndex ?? 0];
                const radiusA = parents[descriptor.radiusAIndex ?? 1];
                const radiusB = parents[descriptor.radiusBIndex ?? 2];
                const r = Math.hypot(radiusA.x - radiusB.x, radiusA.y - radiusB.y);
                const dir = normalize(radiusA.x - center.x, radiusA.y - center.y);
                return [center.x + dir[0] * r, center.y + dir[1] * r];
            };
        case "midpoint":
            return () => {
                const a = parents[descriptor.aIndex ?? 0];
                const b = parents[descriptor.bIndex ?? 1];
                return [(a.x + b.x) / 2, (a.y + b.y) / 2];
            };
        case "perpendicularBisectorEndpoint":
            return () => {
                const a = parents[descriptor.aIndex ?? 0];
                const b = parents[descriptor.bIndex ?? 1];
                const mid = parents[descriptor.midIndex ?? 2];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dir = normalize(-dy, dx);
                return [mid.x + dir[0], mid.y + dir[1]];
            };
        default:
            return null;
    }
}

function drawPointName(construct) {
    if(!construct.exists || !construct.pointName) return;
    const p = cam.worldToCamera(construct.x, construct.y);
    const ox = Number.isFinite(construct.labelOffsetX) ? construct.labelOffsetX : 8;
    const oy = Number.isFinite(construct.labelOffsetY) ? construct.labelOffsetY : -8;
    push();
    noStroke();
    fill(20);
    textSize(12);
    textAlign(LEFT, BOTTOM);
    text(construct.pointName, p[0] + ox, p[1] + oy);
    pop();
}

function drawLineName(construct) {
    if(!construct.exists || !construct.lineName) return;
    const mx = (construct.point1.x + construct.point2.x) * 0.5;
    const my = (construct.point1.y + construct.point2.y) * 0.5;
    const p = cam.worldToCamera(mx, my);
    const ox = Number.isFinite(construct.labelOffsetX) ? construct.labelOffsetX : 8;
    const oy = Number.isFinite(construct.labelOffsetY) ? construct.labelOffsetY : -8;
    push();
    noStroke();
    fill(30);
    textSize(12);
    textAlign(LEFT, BOTTOM);
    text(construct.lineName, p[0] + ox, p[1] + oy);
    pop();
}

export class Point {
    constructor(x, y, locked = false) {
        this.x = x;
        this.y = y;
        this.exists = true;
        this.locked = locked;
        this.col = locked ? [255, 0, 0] : [0, 100, 255];
    }
    childOf(c) {
        return this.locked === c;
    }
    resolve() {
        deleteConstruct(this);
    }
    update() {
        if(isSelected(this) && mouseIsPressed && mouseButton === LEFT) {
            const n = cam.cameraToWorld(mouseX, mouseY);
            const p = cam.cameraToWorld(pmouseX, pmouseY);
            if(this.locked) {
                [this.x, this.y] = n;
            }
            else {
                this.x += n[0] - p[0];
                this.y += n[1] - p[1];
            }
        }
        if(this.locked)
            [this.x, this.y] = this.locked.closest(this.x, this.y);
    }
    display() {
        const p = cam.worldToCamera(this.x, this.y);
        if(appState.hovering === this || isSelected(this)) {
            stroke(...this.col, isSelected(this) ? 100 : 50);
            strokeWeight(30);
            point(...p);
        }
        stroke(...this.col);
        strokeWeight(20);
        point(...p);
        drawPointName(this);
    }
    hovering() {
        const m = cam.worldToCamera(this.x, this.y);
        return sq(mouseX - m[0]) + sq(mouseY - m[1]) < 10 * 10;
    }
}

export class DerivedPoint extends Point {
    constructor(parents, compute, hidden = true, descriptor = null) {
        super(0, 0, false);
        this.parents = parents;
        this.descriptor = descriptor;
        this.compute = compute || buildDerivedCompute(descriptor, parents);
        this.hidden = hidden;
        this.col = [120, 0, 180];
    }
    childOf(c) {
        return this.parents.indexOf(c) !== -1;
    }
    update() {
        this.exists = this.parents.every((p) => p.exists);
        if(!this.exists) return;
        if(typeof this.compute !== "function") {
            this.compute = buildDerivedCompute(this.descriptor, this.parents);
        }
        if(typeof this.compute !== "function") {
            this.exists = false;
            return;
        }
        const next = this.compute();
        if(!next || !Number.isFinite(next[0]) || !Number.isFinite(next[1])) {
            this.exists = false;
            return;
        }
        this.x = next[0];
        this.y = next[1];
    }
    display() {
        if(this.hidden) return;
        if(appState.hovering === this || isSelected(this)) {
            stroke(...this.col, isSelected(this) ? 100 : 50);
            strokeWeight(30);
            point(...cam.worldToCamera(this.x, this.y));
        }
        stroke(...this.col);
        strokeWeight(20);
        point(...cam.worldToCamera(this.x, this.y));
        drawPointName(this);
    }
    hovering() {
        if(this.hidden || !this.exists) return false;
        const m = cam.worldToCamera(this.x, this.y);
        return sq(mouseX - m[0]) + sq(mouseY - m[1]) < 10 * 10;
    }
}

export class Line {
    constructor(point1, point2) {
        this.point1 = point1;
        this.point2 = point2;
        this.exists = true;
    }
    childOf(c) {
        return (this.point1 === c) || (this.point2 === c);
    }
    resolve() {
        deleteConstruct(this);
    }
    update() {
        this.exists = this.point1.exists && this.point2.exists;
    }
    display() {
        const p1 = cam.worldToCamera(this.point1.x, this.point1.y);
        const p2 = cam.worldToCamera(this.point2.x, this.point2.y);
        if(appState.hovering === this || isSelected(this)) {
            stroke(0, appState.selected.length ? 100 : 50);
            strokeWeight(5);
            drawInfiniteLine(p1, p2);
        }
        stroke(this.exists ? 0 : color(255, 0, 0, 50));
        strokeWeight(2);
        drawInfiniteLine(p1, p2);
        drawLineName(this);
    }
    closest(x, y) {
        const dx = this.point2.x - this.point1.x;
        const dy = this.point2.y - this.point1.y;
        const d = (dx * (this.point1.y - y) - dy * (this.point1.x - x)) / (dx * dx + dy * dy);
        return [x - dy * d, y + dx * d];
    }
    hovering() {
        const p1 = cam.worldToCamera(this.point1.x, this.point1.y);
        const p2 = cam.worldToCamera(this.point2.x, this.point2.y);
        return Math.abs((p2[0] - p1[0]) * (p1[1] - mouseY) - (p1[0] - mouseX) * (p2[1] - p1[1])) / Math.sqrt(sq(p2[0] - p1[0]) + sq(p2[1] - p1[1])) < 10;
    }
}

function drawInfiniteLine(p1, p2) {
    if(Math.abs(p1[0] - p2[0]) < 0.1) {
        line(p1[0], 0, p1[0], height);
        return;
    }
    const m = (p2[1] - p1[1]) / (p2[0] - p1[0]);
    const b = p1[1] - m * p1[0];
    line(0, b, width, width * m + b);
}

export class Circle {
    constructor(center, outer) {
        this.center = center;
        this.outer = outer;
        this.exists = true;
        this.radius = 0;
    }
    childOf(c) {
        return (this.center === c) || (this.outer === c);
    }
    resolve() {
        deleteConstruct(this);
    }
    update() {
        this.exists = this.center.exists && this.outer.exists;
    }
    display() {
        const p1 = cam.worldToCamera(this.center.x, this.center.y);
        this.radius = Math.sqrt(sq(this.outer.x - this.center.x) + sq(this.outer.y - this.center.y));
        const r = cam.scaleToCamera(this.radius);
        noFill();
        if(appState.hovering === this || isSelected(this)) {
            stroke(0, appState.selected.length ? 100 : 50);
            strokeWeight(5);
            ellipse(p1[0], p1[1], r * 2, r * 2);
        }
        stroke(this.exists ? 0 : color(255, 0, 0, 50));
        strokeWeight(2);
        ellipse(p1[0], p1[1], r * 2, r * 2);
    }
    closest(x, y) {
        const d = this.radius / Math.sqrt(sq(x - this.center.x) + sq(y - this.center.y));
        return [this.center.x + (x - this.center.x) * d, this.center.y + (y - this.center.y) * d];
    }
    hovering() {
        const p1 = cam.worldToCamera(this.center.x, this.center.y);
        const d = Math.sqrt(sq(mouseX - p1[0]) + sq(mouseY - p1[1]));
        const r = cam.scaleToCamera(this.radius);
        return d > r - 5 && d < r + 5;
    }
}

export class Intersection {
    constructor(construct1, construct2, n = 0) {
        if(construct2 instanceof Line) {
            this.construct1 = construct2;
            this.construct2 = construct1;
        }
        else {
            this.construct1 = construct1;
            this.construct2 = construct2;
        }
        this.n = n;
        this.exists = false;
        this.x = 0;
        this.y = 0;
    }
    childOf(c) {
        return (this.construct1 === c) || (this.construct2 === c);
    }
    resolve() {
        deleteConstruct(this);
    }
    update() {
        this.exists = false;
        if(this.construct1 instanceof Line) {
            if(this.construct2 instanceof Line) {
                const line1 = this.construct1;
                const line2 = this.construct2;
                const x1 = line1.point1.x;
                const y1 = line1.point1.y;
                const x2 = line1.point2.x;
                const y2 = line1.point2.y;
                const x3 = line2.point1.x;
                const y3 = line2.point1.y;
                const x4 = line2.point2.x;
                const y4 = line2.point2.y;
                const xa = x1 - x2;
                const xb = x3 - x4;
                const ya = y1 - y2;
                const yb = y3 - y4;
                const A = x1 * y2 - y1 * x2;
                const B = x3 * y4 - y3 * x4;
                let d = xa * yb - ya * xb;
                if(d !== 0) {
                    this.exists = true;
                    d = 1 / d;
                }
                this.x = (A * xb - B * xa) * d;
                this.y = (A * yb - B * ya) * d;
            }
            else {
                const line = this.construct1;
                const circle = this.construct2;
                const x1 = line.point1.x - circle.center.x;
                const y1 = line.point1.y - circle.center.y;
                const x2 = line.point2.x - circle.center.x;
                const y2 = line.point2.y - circle.center.y;
                const dx = x2 - x1;
                const dy = y2 - y1;
                const dr = dx * dx + dy * dy;
                const D = x1 * y2 - x2 * y1;
                let disc = circle.radius * circle.radius * dr - D * D;
                if(disc >= 0) {
                    this.exists = true;
                    disc = Math.sqrt(disc);
                }
                else {
                    disc = 0;
                }
                if(this.n) {
                    this.x = (D * dy + dx * disc) / dr + circle.center.x;
                    this.y = (-D * dx + dy * disc) / dr + circle.center.y;
                }
                else {
                    this.x = (D * dy - dx * disc) / dr + circle.center.x;
                    this.y = (-D * dx - dy * disc) / dr + circle.center.y;
                }
            }
        }
        else {
            const circle1 = this.construct1;
            const circle2 = this.construct2;
            const r1 = circle1.radius;
            const r2 = circle2.radius;
            const d = sq(circle2.center.x - circle1.center.x) + sq(circle2.center.y - circle1.center.y);
            let id = 0;
            if(d > 0) {
                this.exists = true;
                id = 1 / d;
            }
            const c = d - r1 * r1 + r2 * r2;
            const r = c * id / 2;
            const rx = circle2.center.x + r * (circle1.center.x - circle2.center.x);
            const ry = circle2.center.y + r * (circle1.center.y - circle2.center.y);
            let a = r2 * r2 - c * c * id / 4;
            if(a >= 0) {
                a = Math.sqrt(a);
            }
            else {
                this.exists = false;
                a = 0;
            }
            let bx = circle2.center.y - circle1.center.y;
            let by = circle1.center.x - circle2.center.x;
            id = Math.sqrt(id);
            bx *= id;
            by *= id;
            if(this.n) {
                this.x = rx + bx * a;
                this.y = ry + by * a;
            }
            else {
                this.x = rx - bx * a;
                this.y = ry - by * a;
            }
        }

        if(!this.construct1.exists || !this.construct2.exists) {
            this.exists = false;
        }
    }
    display() {
        const p = cam.worldToCamera(this.x, this.y);
        if(appState.hovering === this || isSelected(this)) {
            stroke(0, 200, 50, isSelected(this) ? 100 : 50);
            strokeWeight(30);
            point(...p);
        }
        stroke(this.exists ? color(0, 200, 50, 255) : color(255, 0, 0, 50));
        strokeWeight(20);
        point(...p);
        drawPointName(this);
    }
    hovering() {
        const m = cam.worldToCamera(this.x, this.y);
        return (mouseX - m[0]) * (mouseX - m[0]) + (mouseY - m[1]) * (mouseY - m[1]) < 10 * 10;
    }
}

export function initializeConstructs() {
    appState.constructs.push(new Point(-10, 0), new Point(10, 0));
    appState.constructs.push(new Circle(appState.constructs[0], appState.constructs[1]));
    appState.constructs.push(new Circle(appState.constructs[1], appState.constructs[0]));
    appState.constructs.push(new Intersection(appState.constructs[2], appState.constructs[3], 0));
    appState.constructs.push(new Intersection(appState.constructs[2], appState.constructs[3], 1));
    appState.constructs.push(new Line(appState.constructs[4], appState.constructs[5]));
    appState.constructs.push(new Line(appState.constructs[0], appState.constructs[1]));
}

export function deleteConstruct(c) {
    appState.constructs.splice(appState.constructs.indexOf(c), 1);
    let go = false;
    while(!go) {
        go = true;
        for(const c2 of appState.constructs) {
            if(c2.childOf(c)) {
                go = false;
                c2.resolve(c);
                break;
            }
        }
    }
}
