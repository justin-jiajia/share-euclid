export const appState = {
    constructs: [],
    selected: [],
    hovering: null,
    toolStack: [],
    constructStack: [],
    keys: {},
    pkeys: {},
    pressed: false,
    released: false,
    toolbarHeight: 72,
    touchIsDown: false,
};

export const cam = {
    rx: 0,
    ry: 0,
    x: 0,
    y: 0,
    rzoom: 3,
    zoom: 3,
    scaleToCamera(scalar) {
        return scalar * this.zoom * this.zoom;
    },
    worldToCamera(x, y) {
        return [
            width / 2 + (x - this.x) * this.zoom * this.zoom,
            height / 2 + (y - this.y) * this.zoom * this.zoom,
        ];
    },
    cameraToWorld(x, y) {
        return [
            (x - width / 2) / this.zoom / this.zoom + this.x,
            (y - height / 2) / this.zoom / this.zoom + this.y,
        ];
    },
    rcameraToWorld(x, y) {
        return [
            (x - width / 2) / this.rzoom / this.rzoom + this.x,
            (y - height / 2) / this.rzoom / this.rzoom + this.y,
        ];
    },
};

export function isSelected(obj) {
    return appState.selected.indexOf(obj) !== -1;
}
