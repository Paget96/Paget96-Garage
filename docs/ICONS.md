# Icons

Every Paget96 Garage icon uses one template, so the apps read as one family (owner, 2026-11-26 20:02: set "T1",
three tones on the diagonal, like the best icons in the Store but in our own colours; the car in the garage as
the brand mark). No other style, and always the iDrive 7 rounded square, never round (owner, 19:27). BMW's
M colours are never used.

![Sample](icons/sample.png)

## The template

| Part | Value |
|---|---|
| Size | 140 x 140 px tile, drawn at 4x (560 px) and scaled down with Lanczos; the icon fills 84 % of it, centred, so the HMI focus frame shows round it (owner, 20:59); at most 128 KiB |
| Shape | the iDrive 7 rounded square, corner radius 23.5 % of the side |
| Background | three tones split on the diagonal, from the top left: orange (255,150,60 to 235,95,20) to 62 % of the way, deep orange (200,70,10 to 150,45,5) to 78 %, graphite (48,52,62 to 22,24,30) in the bottom right corner |
| Glyph | white lines (250,250,252), line weight 6 % of the side in every icon |
| Details | light cream (255,214,170): the needle, the beat, the flap, the star, the car |
| Size of the glyph | the same in every icon: its box has the area of a square 58 % of the side, no side over 68 % (owner, 19:29: "sve ikonice moraju da budu srazmerne") |
| Shadow | the glyph's shape blurred by 2 %, black, 45 %, moved 0.8 % right and 2 % down |
| Light | white from the top edge at alpha 38, fading out by the middle, like glass; a thin white edge at 25 % |

The numbers live in `tools/make_icon.py` (constants at the top); this table only describes them.

## Making one

```
python tools/make_icon.py <glyph> apps/<id>/icon.png
python tools/make_icon.py --mask glyph.png apps/<id>/icon.png    # a white-on-transparent glyph drawing
python tools/make_icon.py --sheet docs/icons/sample.png          # the sample sheet
```

A new app adds its glyph to `GLYPHS` in `tools/make_icon.py`: white line art with one or two details in the
detail colour, nothing from BMW. Icons are committed PNGs, so Pillow is needed only on the developer's PC.
