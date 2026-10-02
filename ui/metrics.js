/**
 * Pixel sizes for every UI element at a given scale. Sizes are computed
 * (not stretched with set_scale) so Cairo output stays sharp at any scale.
 * At scale 1.0 these equal the original hardcoded values.
 *
 * @param {number} scale
 */
export function metrics(scale) {
    const px = value => Math.round(value * scale);
    const floatPadV = px(16);
    // Radius of the concave arc joining a docked notch to the screen edge.
    const edgeCurve = px(20);
    return {
        widgetWidth: px(64),
        // A free floating pill only needs its rounded ends.
        floatPadV,
        // A docked notch also needs room for the edge arc above and below the body.
        containerPadV: floatPadV + edgeCurve,
        containerPadH: px(10),
        itemPadBottom: px(16),
        ringSize: px(44),
        ringLine: Math.max(2, px(4)),
        iconSize: px(20),
        labelFontPt: 10 * scale,
        labelMarginTop: px(4),
        // notch shape
        cornerRadius: px(32),
        edgeCurve,
        minSize: px(48),
        // popout
        popoutWidth: px(250),
        popoutPad: px(16),
        popoutRadius: px(16),
        barWidth: px(218),
        barHeight: Math.max(3, px(6)),
        titleFontPt: 12 * scale,
        textFontPt: 9 * scale,
        popoutIcon: px(16),
    };
}
