#!/usr/bin/env python3
# Builds codea-logo.woff, the font behind the $(codea-logo) icon, from Codea's app icon:
# the "Co" mark of AppIcon.icon (CoThick.svg in the Codea app's sources), placed on the
# icon's canvas as Icon Composer places it. Run it from this folder with fontTools
# installed (pip install fonttools). VS Code caches icon fonts by path, so a changed
# logo needs a new file name to show up for people who had the old one.
#
#     python3 make-icon-font.py [outline|knockout|mark]   (outline by default)

import math
import re
import sys

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

EM = 1000

# CoThick.svg, 811 x 668
MARK_PATH = (
    "M335.547963,0 C385.694965,0 433.27267,10.9497193 475.999607,30.5782107 L436.415113,91.9609107 "
    "C405.35324,79.0998901 371.2829,72 335.547963,72 C190.297074,72 72.5479631,189.301396 72.5479631,334 "
    "C72.5479631,478.698604 190.297074,596 335.547963,596 C361.273397,596 386.136153,592.320481 409.634853,585.460917 "
    "C377.373323,546.327505 358,496.176193 358,441.5 C358,316.407504 459.407504,215 584.5,215 "
    "C709.592496,215 811,316.407504 811,441.5 C811,566.592496 709.592496,668 584.5,668 "
    "C543.999199,668 505.981176,657.369962 473.083744,638.747699 C431.115036,657.54092 384.558585,668 335.547963,668 "
    "C150.22994,668 0,518.463106 0,334 C0,149.536894 150.22994,0 335.547963,0 Z "
    "M584.5,290 C501.105003,290 433.5,357.82886 433.5,441.5 C433.5,525.17114 501.105003,593 584.5,593 "
    "C667.894997,593 735.5,525.17114 735.5,441.5 C735.5,357.82886 667.894997,290 584.5,290 Z")
MARK_SIZE = (811, 668)

# AppIcon.icon draws the mark centred on a 1024 point canvas, moved 6 points left
CANVAS = 1024
MARK_OFFSET = (-6, 0)


def mark_contours(scale, origin):
    """The mark's contours as point lists in font units (y up), curves flattened"""
    tokens = re.findall(r"[MLCZ]|-?[\d.]+", MARK_PATH)
    contours, current, i, position = [], [], 0, (0.0, 0.0)

    def number():
        nonlocal i
        i += 1
        return float(tokens[i - 1])

    def to_font(x, y):
        return (origin[0] + x * scale, origin[1] - y * scale)

    while i < len(tokens):
        command = tokens[i]
        i += 1
        if command == "M":
            position = (number(), number())
            current = [to_font(*position)]
        elif command == "L":
            position = (number(), number())
            current.append(to_font(*position))
        elif command == "C":
            p1, p2, p3 = (number(), number()), (number(), number()), (number(), number())
            p0 = position
            for step in range(1, 17):
                t = step / 16
                x = (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t ** 2 * p2[0] + t ** 3 * p3[0]
                y = (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t ** 2 * p2[1] + t ** 3 * p3[1]
                current.append(to_font(x, y))
            position = p3
        elif command == "Z":
            if current[0] == current[-1]:
                current.pop()
            contours.append(current)
    return contours


def area(points):
    return sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1])) / 2


def rounded_rect(x0, y0, x1, y1, r):
    def arc(cx, cy, start):
        return [(cx + r * math.cos(math.radians(start + 90 * k / 8)), cy + r * math.sin(math.radians(start + 90 * k / 8)))
                for k in range(9)]
    return arc(x1 - r, y0 + r, -90) + arc(x1 - r, y1 - r, 0) + arc(x0 + r, y1 - r, 90) + arc(x0 + r, y0 + r, 180)


def draw(pen, points, filled):
    # TrueType fills clockwise contours and cuts holes with counterclockwise ones
    if (area(points) < 0) != filled:
        points = list(reversed(points))
    pen.moveTo(tuple(round(v) for v in points[0]))
    for point in points[1:]:
        pen.lineTo(tuple(round(v) for v in point))
    pen.closePath()


def logo(style):
    pen = TTGlyphPen(None)

    if style == "mark":
        # The mark alone, as large as the em allows
        scale = EM / MARK_SIZE[0]
        origin = (0, EM - (EM - MARK_SIZE[1] * scale) / 2)
    else:
        scale = EM / CANVAS
        origin = (((CANVAS - MARK_SIZE[0]) / 2 + MARK_OFFSET[0]) * scale,
                  EM - ((CANVAS - MARK_SIZE[1]) / 2 + MARK_OFFSET[1]) * scale)

    outer, hole = mark_contours(scale, origin)
    if style == "knockout":
        draw(pen, rounded_rect(0, 0, EM, EM, 225), filled=True)
        draw(pen, outer, filled=False)
        draw(pen, hole, filled=True)
    else:
        if style == "outline":
            draw(pen, rounded_rect(0, 0, EM, EM, 225), filled=True)
            draw(pen, rounded_rect(55, 55, EM - 55, EM - 55, 175), filled=False)
        draw(pen, outer, filled=True)
        draw(pen, hole, filled=False)

    return pen.glyph()


def main():
    style = sys.argv[1] if len(sys.argv) > 1 else "outline"
    builder = FontBuilder(EM, isTTF=True)
    builder.setupGlyphOrder([".notdef", "codea-logo"])
    builder.setupCharacterMap({0xE000: "codea-logo"})
    builder.setupGlyf({".notdef": TTGlyphPen(None).glyph(), "codea-logo": logo(style)})
    builder.setupHorizontalMetrics({".notdef": (EM, 0), "codea-logo": (EM, 0)})
    builder.setupHorizontalHeader(ascent=EM, descent=0)
    builder.setupNameTable({"familyName": "Codea Icons", "styleName": "Regular"})
    builder.setupOS2(sTypoAscender=EM, sTypoDescender=0, usWinAscent=EM, usWinDescent=0)
    builder.setupPost()
    builder.font.flavor = "woff"
    builder.save("codea-logo.woff")


if __name__ == "__main__":
    main()
