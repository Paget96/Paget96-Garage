# Icons

Every Paget96 Garage icon uses one template, so the apps read as one family (owner, 2026-11-26 19:28 to 19:33:
set "B2", the solid orange one with a light detail colour, and the car in the garage as the brand mark).
No other style, and always the iDrive 7 rounded square, never round (owner, 19:27).

![Sample](icons/sample.png)

## The template

| Part | Value |
|---|---|
| Size | 140 x 140 px, drawn at 4x (560 px) and scaled down with Lanczos; at most 128 KiB |
| Shape | the iDrive 7 rounded square, corner radius 23.5 % of the side |
| Fill | vertical gradient, orange (255,158,70) at the top to (232,92,20) at the bottom |
| Glyph | dark lines (28,18,10), line weight 6 % of the side in every icon |
| Details | light cream orange (255,205,160): the needle, the beat, the flap, the star, the car |
| Size of the glyph | the same in every icon: its box has the area of a square 58 % of the side, no side over 68 % (owner, 19:29: "sve ikonice moraju da budu srazmerne") |
| Shadow | the glyph's shape blurred by 1.2 %, black, 35 %, moved down 1.2 % |

The numbers live in `tools/make_icon.py` (constants at the top); this table only describes them.

## Making one

```
python tools/make_icon.py <glyph> apps/<id>/icon.png
python tools/make_icon.py --mask glyph.png apps/<id>/icon.png    # a white-on-transparent glyph drawing
python tools/make_icon.py --sheet docs/icons/sample.png          # the sample sheet
```

A new app adds its glyph to `GLYPHS` in `tools/make_icon.py`: dark line art with one or two details in the
detail colour, nothing from BMW. Icons are committed PNGs, so Pillow is needed only on the developer's PC.
