/**
 * Pixel sizes for every UI element at a given scale. Sizes are computed
 * (not stretched with set_scale) so Cairo output stays sharp at any scale.
 * At scale 1.0 these equal the original hardcoded values.
 *
 * @param {number} scale
 * @param {boolean} [compact] narrow notch: small icon and percentage, no ring
 */
export function metrics(scale, compact = false) {
    const px = value => Math.round(value * scale);
    const floatPadV = px(16);
    // Radius of the concave arc joining a docked notch to the screen edge.
    const edgeCurve = px(20);
    const iconSize = compact ? px(16) : px(20);
    return {
        widgetWidth: compact ? px(44) : px(64),
        // A free floating pill only needs its rounded ends.
        floatPadV,
        // A docked notch also needs room for the edge arc above and below the body.
        containerPadV: floatPadV + edgeCurve,
        containerPadH: compact ? px(6) : px(10),
        itemPadBottom: compact ? px(8) : px(16),
        ringSize: compact ? iconSize : px(44),
        ringLine: Math.max(2, px(4)),
        iconSize,
        labelFontPt: (compact ? 8 : 10) * scale,
        labelMarginTop: compact ? px(2) : px(4),
        // notch shape
        cornerRadius: compact ? px(22) : px(32),
        edgeCurve,
        minSize: compact ? px(36) : px(48),
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
