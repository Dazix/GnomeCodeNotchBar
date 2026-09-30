import Cairo from 'cairo';

const KAPPA = 0.5522847;
/** Sample points per outline segment; the outline is 6 segments. */
const STEPS = 24;
const SEGMENTS = 6;

/** Points along a cubic Bezier, excluding the start point. */
function bezier(p0, c1, c2, p3) {
    const points = [];
    for (let i = 1; i <= STEPS; i++) {
        const t = i / STEPS;
        const u = 1 - t;
        points.push([
            u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1],
        ]);
    }
    return points;
}

/**
 * The docked taper: two tangent quarter-ellipses, a concave one leaving the
 * screen edge and a convex one rounding into the wall of the data block.
 * Both ends are vertical, and the join in the middle is horizontal, so the
 * outline is tangent-continuous everywhere (a classic inverted-corner flare).
 * With edgeCurve equal to the widget width the arcs are true circles.
 */
function taper(p0, p3) {
    const sx = Math.sign(p3[0] - p0[0]);
    const sy = Math.sign(p3[1] - p0[1]);
    const rx = Math.abs(p3[0] - p0[0]) / 2;
    const ry = Math.abs(p3[1] - p0[1]) / 2;
    const half = STEPS / 2;
    const points = [];
    // Concave quarter: centre beside the start point, on the block side.
    for (let i = 1; i <= half; i++) {
        const a = (i / half) * Math.PI / 2;
        points.push([p0[0] + sx * rx - sx * rx * Math.cos(a), p0[1] + sy * ry * Math.sin(a)]);
    }
    // Convex quarter: from the horizontal midpoint down into the block wall.
    const midX = p0[0] + sx * rx;
    const midY = p0[1] + sy * ry;
    for (let i = 1; i <= half; i++) {
        const a = (i / half) * Math.PI / 2;
        points.push([midX + sx * rx * Math.sin(a), midY + sy * ry * (1 - Math.cos(a))]);
    }
    return points;
}

/** A straight (or degenerate) run, sampled to the same point count. */
const line = (p0, p3) => bezier(p0, p0, p3, p3);

/**
 * Outline of each notch shape in a w x h box as a fixed-size point list
 * (start point + SEGMENTS * STEPS), so shapes can be blended point by point:
 * a free floating pill, and the pill docked to the right / left screen edge.
 */
function shapes(w, h, {cornerRadius: R, edgeCurve: C}) {
    const Rk = R * KAPPA;
    return {
        floating: [
            [w / 2, 0],
            ...bezier([w / 2, 0], [w / 2 + Rk, 0], [w, R - Rk], [w, R]),
            ...line([w, R], [w, h - R]),
            ...bezier([w, h - R], [w, h - R + Rk], [w / 2 + Rk, h], [w / 2, h]),
            ...bezier([w / 2, h], [w / 2 - Rk, h], [0, h - R + Rk], [0, h - R]),
            ...line([0, h - R], [0, R]),
            ...bezier([0, R], [0, R - Rk], [w / 2 - Rk, 0], [w / 2, 0]),
        ],
        right: [
            [w, 0],
            ...line([w, 0], [w, 0]),
            ...line([w, 0], [w, h]),
            ...line([w, h], [w, h]),
            ...taper([w, h], [0, h - C]),
            ...line([0, h - C], [0, C]),
            ...taper([0, C], [w, 0]),
        ],
        left: [
            [0, 0],
            ...taper([0, 0], [w, C]),
            ...line([w, C], [w, h - C]),
            ...taper([w, h - C], [0, h]),
            ...line([0, h], [0, h]),
            ...line([0, h], [0, 0]),
            ...line([0, 0], [0, 0]),
        ],
    };
}

/**
 * Paint the notch background, blending the three shapes by weight.
 *
 * @param {St.DrawingArea} area
 * @param {{f:number, r:number, l:number}} weights floating / right / left
 * @param {object} style
 * @param {ReturnType<typeof import('./metrics.js').metrics>} style.metrics
 * @param {{r:number,g:number,b:number}} style.color
 * @param {number} style.opacity
 */
export function paintNotch(area, weights, {metrics, color, opacity}) {
    const cr = area.get_context();
    try {
        const [w, h] = area.get_surface_size();
        if (w < metrics.minSize || h < metrics.minSize)
            return;

        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);
        cr.setSourceRGBA(color.r, color.g, color.b, opacity);

        const total = (weights.f + weights.r + weights.l) || 1;
        const f = weights.f / total;
        const r = weights.r / total;
        const l = weights.l / total;
        const s = shapes(w, h, metrics);

        for (let i = 0; i <= SEGMENTS * STEPS; i++) {
            const x = s.floating[i][0] * f + s.right[i][0] * r + s.left[i][0] * l;
            const y = s.floating[i][1] * f + s.right[i][1] * r + s.left[i][1] * l;
            if (i === 0)
                cr.moveTo(x, y);
            else
                cr.lineTo(x, y);
        }
        cr.closePath();
        cr.fill();
    } finally {
        cr.$dispose();
    }
}
