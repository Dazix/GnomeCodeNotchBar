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

/** A straight (or degenerate) run, sampled to the same point count. */
const line = (p0, p3) => bezier(p0, p0, p3, p3);

/** Straight run of n points, excluding the start point. */
function run(p0, p3, n) {
    const points = [];
    for (let i = 1; i <= n; i++)
        points.push([p0[0] + (p3[0] - p0[0]) * i / n, p0[1] + (p3[1] - p0[1]) * i / n]);
    return points;
}

/** Circular arc of n points around (cx, cy) from angle a0 to a1, excluding the start point. */
function arc(cx, cy, r, a0, a1, n) {
    const points = [];
    for (let i = 1; i <= n; i++) {
        const a = a0 + (a1 - a0) * i / n;
        points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return points;
}

/** Points of a segment given to the flat run; the rest go to the arc. */
const RUN_STEPS = 8;
const ARC_STEPS = STEPS - RUN_STEPS;

/**
 * Outline of each notch shape in a w x h box as a fixed-size point list
 * (start point + SEGMENTS * STEPS), so shapes can be blended point by point:
 * a free floating pill, and the pill docked to the right / left screen edge.
 *
 * A docked notch keeps the pill's rounded corners (radius R) on the side away
 * from the screen. Only the side at the screen edge changes: the pill top and
 * bottom run flat to the edge and join the wall with a concave circular arc of
 * radius C. The body sits C below / above the box edge, which the arc fills.
 */
function shapes(w, h, {cornerRadius: R, edgeCurve: C}) {
    const Rk = R * KAPPA;
    const top = C;
    const bottom = h - C;
    const mid = w / 2;
    return {
        floating: [
            [mid, 0],
            ...bezier([mid, 0], [mid + Rk, 0], [w, R - Rk], [w, R]),
            ...line([w, R], [w, h - R]),
            ...bezier([w, h - R], [w, h - R + Rk], [mid + Rk, h], [mid, h]),
            ...bezier([mid, h], [mid - Rk, h], [0, h - R + Rk], [0, h - R]),
            ...line([0, h - R], [0, R]),
            ...bezier([0, R], [0, R - Rk], [mid - Rk, 0], [mid, 0]),
        ],
        // Screen edge on the right.
        right: [
            [mid, top],
            ...run([mid, top], [w - C, top], RUN_STEPS),
            ...arc(w - C, 0, C, Math.PI / 2, 0, ARC_STEPS),
            ...line([w, 0], [w, h]),
            ...arc(w - C, h, C, 0, -Math.PI / 2, ARC_STEPS),
            ...run([w - C, bottom], [mid, bottom], RUN_STEPS),
            ...bezier([mid, bottom], [mid - Rk, bottom], [0, bottom - R + Rk], [0, bottom - R]),
            ...line([0, bottom - R], [0, top + R]),
            ...bezier([0, top + R], [0, top + R - Rk], [mid - Rk, top], [mid, top]),
        ],
        // Screen edge on the left.
        left: [
            [mid, top],
            ...bezier([mid, top], [mid + Rk, top], [w, top + R - Rk], [w, top + R]),
            ...line([w, top + R], [w, bottom - R]),
            ...bezier([w, bottom - R], [w, bottom - R + Rk], [mid + Rk, bottom], [mid, bottom]),
            ...run([mid, bottom], [C, bottom], RUN_STEPS),
            ...arc(C, h, C, -Math.PI / 2, -Math.PI, ARC_STEPS),
            ...line([0, h], [0, 0]),
            ...arc(C, 0, C, Math.PI, Math.PI / 2, ARC_STEPS),
            ...run([C, top], [mid, top], RUN_STEPS),
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
