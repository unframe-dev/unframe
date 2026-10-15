import sys
from fontTools.ttLib import TTCollection


with TTCollection(sys.argv[1], lazy=True) as collection:
    fonts = [
        font for font in collection.fonts
        if font["name"].getDebugName(6) == "NotoSansCJKjp-Regular"
    ]
    if len(fonts) != 1:
        raise ValueError("Expected exactly one Noto Sans CJK JP Regular face")
    font = fonts[0]
    font.recalcTimestamp = False
    font.save(sys.argv[2])
