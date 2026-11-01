#!/usr/bin/env python3
# Builds codea-icons.woff, the font behind the $(codea-logo) icon, from the shapes of
# resources/codea.svg: a rounded square, a "C" and a small circle. Run it from this folder
# with fontTools installed (pip install fonttools).

import math

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

EM = 1000
STEPS = 48


def arc(cx, cy, rx, ry, start, end, steps=STEPS):
    """Points along an ellipse from start to end degrees, counterclockwise"""
    return [(cx + rx * math.cos(math.radians(start + (end - start) * i / steps)),
             cy + ry * math.sin(math.radians(start + (end - start) * i / steps)))
            for i in range(steps + 1)]


def rounded_rect(x0, y0, x1, y1, r):
    """Counterclockwise outline of a rounded rectangle"""
    return (arc(x1 - r, y0 + r, r, r, -90, 0, 8) + arc(x1 - r, y1 - r, r, r, 0, 90, 8) +
            arc(x0 + r, y1 - r, r, r, 90, 180, 8) + arc(x0 + r, y0 + r, r, r, 180, 270, 8))


def draw(pen, points, clockwise):
    # TrueType fills clockwise contours and cuts holes with counterclockwise ones
    points = list(reversed(points)) if clockwise else points
    pen.moveTo(tuple(round(v) for v in points[0]))
    for point in points[1:]:
        pen.lineTo(tuple(round(v) for v in point))
    pen.closePath()


def logo():
    pen = TTGlyphPen(None)

    # The rounded square
    draw(pen, rounded_rect(40, 40, 960, 960, 200), clockwise=True)
    draw(pen, rounded_rect(130, 130, 870, 870, 115), clockwise=False)

    # The C, open on the right
    outer = arc(340, 560, 200, 280, 45, 315)
    inner = arc(340, 560, 120, 200, 45, 315)
    draw(pen, outer + list(reversed(inner)), clockwise=True)

    # The circle, bottom right
    draw(pen, arc(670, 400, 180, 180, 0, 360), clockwise=True)
    draw(pen, arc(670, 400, 100, 100, 0, 360), clockwise=False)

    return pen.glyph()


def main():
    builder = FontBuilder(EM, isTTF=True)
    builder.setupGlyphOrder([".notdef", "codea-logo"])
    builder.setupCharacterMap({0xE000: "codea-logo"})
    builder.setupGlyf({".notdef": TTGlyphPen(None).glyph(), "codea-logo": logo()})
    builder.setupHorizontalMetrics({".notdef": (EM, 0), "codea-logo": (EM, 0)})
    builder.setupHorizontalHeader(ascent=EM, descent=0)
    builder.setupNameTable({"familyName": "Codea Icons", "styleName": "Regular"})
    builder.setupOS2(sTypoAscender=EM, sTypoDescender=0, usWinAscent=EM, usWinDescent=0)
    builder.setupPost()
    builder.font.flavor = "woff"
    builder.save("codea-icons.woff")


if __name__ == "__main__":
    main()
