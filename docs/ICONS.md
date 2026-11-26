# Icons

Every Paget96 Garage icon uses one template, so the apps read as one family (owner, 2026-11-26 16:50 and
16:53: "e ovo vec mi se svidja, sve narandzasto"). No other style.

![Sample](icons/sample.png)

## The template

| Part | Value |
|---|---|
| Size | 140 x 140 px, drawn at 4x (560 px) and scaled down with Lanczos; at most 128 KiB |
| Shape | squircle, corner radius 23.5 % of the side |
| Fill | vertical gradient (30,33,40) at the top to (10,11,14) at the bottom |
| Edge | (255,140,50) at 55 % opacity, about 3 px at 4x |
| Glyph | orange (255,128,40), accents in amber (255,186,70), stroke 5.5 % of the side, glyph radius 26 % |
| Glow | the glyph's shape blurred by 3 % of the side, orange, 70 % opacity, under the glyph |
| Shadow | the glyph's shape blurred by 1.2 %, black, 45 %, moved down 1.2 % |

The numbers live in `tools/make_icon.py` (constants at the top); this table only describes them.

## Making one

```
python tools/make_icon.py <glyph> apps/<id>/icon.png
python tools/make_icon.py --mask glyph.png apps/<id>/icon.png    # a white-on-transparent glyph drawing
python tools/make_icon.py --sheet docs/icons/sample.png          # the sample sheet
```

A new app adds its glyph to `GLYPHS` in `tools/make_icon.py`: line art in orange, at most one or two
amber accents, nothing from BMW. Icons are committed PNGs, so Pillow is needed only on the developer's PC.
