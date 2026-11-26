# Design: the Paget96 Garage look

Every Paget96 Garage app looks like this (owner, 2026-11-26 16:54 to 16:56: layout B, top tabs; later the same
day: scrolling tabs, the two buttons top right, round ends everywhere). The rule: "Every app interface
must be modern, never as plain as the upstream iDrive apps."

Reference, drawn as the target: ![Reference](design/ui-B-final.png)
(the first version without scrolling tabs and buttons: [ui-B-toptabs.png](design/ui-B-toptabs.png))

The same page drawn by `lib/ui.js` (`node tools/ui_demo.js`, the head unit's software path):
![lib/ui.js](design/ui-demo.png)

## Layout (1600 x 520)

| Part | Where | Look |
|---|---|---|
| Background | whole page | vertical gradient (16,18,22) to (6,7,9) |
| App name | top left, x 28, baseline 44 | bold 24, orange, soft orange glow |
| Tabs | glass bar x 270 to 1170, y 12, 56 high | pills; the selected one filled orange with a glow and dark text, the others dim. Many tabs scroll sideways: the ends fade out, round-ended arrows (left, right) show where there is more, position dots sit under the bar, the selected tab glides into view, and the iDrive knob goes through all tabs |
| Status pill | glass pill 130 x 44, left of the two buttons (x 1250) | a dot and LIVE (green) or demo |
| How to use, Settings | round glass buttons, r 30, flush right at the title's margin (28 px): Settings centred at x 1542, How to use at 1462; the Settings button's right edge is the content cards' right edge | "?" and a gear in orange, a small dim label under each. Both pages are mandatory in every app |
| Hero ring | left column, centre (200, 300), r 150 | dark track, orange arc with glow over 270 degrees, the number large in the middle, a unit line, an uppercase label below. Only where an app has one main number |
| Cards | right of the ring, 3 x 2, 386 x 200, 14 px apart | glass: white 6 % fill, 10 % outline, radius 22; uppercase dim label, big condensed number, small unit, a coloured one-line status, a sparkline on the right |

Status colours: green (70,210,130) ok, amber (255,186,70) warming, orange (255,128,40) accent, dim
(140,148,160) neutral, red bad, blue info. Text (236,240,245).

## lib/ui.js

Built on upstream's kit only (`canvas.js`, `record.js`, `gauges.js`), so it draws through the same
frame surface as every kit widget: the GPU renderer at 60 fps, or the software canvas.

| Call | Draws |
|---|---|
| `background(cv)` | the gradient |
| `title(cv, name)` | the app name with its glow |
| `tabs(cv, items, sel, { onSelect })` | the tab bar, scrolling when needed; returns the tab rects and adds a touch and knob target per tab. Draw it right after `background()` |
| `nextTab(sel, n, step)` | the next or previous tab, round the end (for an app that turns the knob itself) |
| `header(cv, { status, statusColor, onHelp, onSettings })` | status pill and the How to use and Settings buttons |
| `status(cv, label, note, color)` | LIVE / demo as plain text (a page without the header) |
| `bar(cv, x, y, w, h, frac, color)` | a progress bar with round ends |
| `curve(cv, pts, width, color)` | a smoothed line with round caps and joins |
| `card(cv, x, y, w, h, label)` | a glass card |
| `stat(cv, x, y, w, h, { label, value, decimals, unit, sub, color, history })` | a stat card with sparkline |
| `ring(cv, cx, cy, r, { value, min, max, text, unit, label, color })` | the hero ring (the arc glides) |
| `pill(cv, x, y, text, color, filled)` | a status pill |
| `chart(cv, x, y, w, h, series, { label, min, max })` | a chart card: grid, lines, a soft fill under the first |
| `spark`, `glass`, `glowRoundRect`, `glowArc`, `glowText` | the parts, for new widgets |

## Round ends everywhere

Owner, 2026-11-26: every progress bar, arc or ring end and every chart line has fully round ends.
Arcs use the kit's `{ round: true }`, bars are pills (radius h / 2), lines go through `curve()`:
Catmull-Rom smoothing, then `stroke()`, whose segments have round caps, so joins are round too. No
square ends anywhere.

`color` takes a status name (`ok`, `warm`, `accent`, `dim`, `bad`, `info`) or a `#hex`.

**Speed.** The renderer has no blur, so a glow is a halo of 8 stacked shapes with falling alpha.
Everything static (background, title, tab bar per selection, card glass and label, ring track and
label, chart grid) is a cached layer (`gauges.layer`), drawn into a texture once; a frame records only
numbers, sparklines and the ring's arc. `tools/ui_demo.js` reports the recording time of a frame
(about 0.15 ms on a PC for the reference page, 1386 words).

**In an app** the file ships as `garage_ui.js` beside `main.js` (`tools/build.py` copies it):
`const UI = require('./garage_ui');`. Node 8 only syntax.

A widget an app needs goes into `lib/ui.js` and this table, never into one app.

## Follow the ambient light (owner, D11)

The UI accent (the orange of tabs, ring, buttons, title) follows the colour of the car's FRONT
ambient light (the area around the dashboard), so the screen matches the cabin. Only `C.orange` /
`C.amber` change at run time. **The icons always stay orange.**

Where the colour comes from, in order:

1. The front colour the Ambient config app saved (its `look` setting), if our apps can read it. (unsure:
   not checked yet whether one app can read another app's settings on the head unit)
2. The car's own colour: `ComfortFunctionIuK.statusAmbientLightInteriorColour` gives the slot (1 to 12)
   of BMW's menu; a table maps the slot to a colour. Which colour a slot is depends on the car, so the
   table is checked on a real car before it ships.
3. Orange.

Never read the light modules over LIN for this: the read holds the gateway for seconds, fights the
Ambient config app's writes, and hangs some body modules (upstream #197).

**Live, with the driving modes (owner, 17:18, D13).** The accent changes when the front colour
changes, also when the Ambient config app changes it for a driving mode: the car's own colour slot
signal changes with it, and for its own per-mode looks the app's saved `mode_<mode>` look is read for
the mode the car reports (`FES statusFESVehicleDynamicSwitchHMI`), if readable. The accent glides
to the new colour (about 0.5 s). Short overlays (turn glow, open door red, strobe, welcome) are
ignored so the UI does not blink (proposed, claude).

**Only the chrome follows (owner, 17:19, D14).** `C.accent` is the chrome: title, selected tab, tab
arrows and dots, the button glyphs. Every chart, sparkline, ring, gauge, bar, pill and status text
keeps its fixed colour (`C.orange`, the status colours), because red means the limit or bad, amber
warm, green ok, and that must never change with the cabin light. When the accent becomes live, the
cached chrome layers must carry the accent in their cache key.

A colour too dark, too pale or too close to the status colours (green ok, amber warming) is adjusted
in lightness so text and charts stay readable. On by default, with a setting "Follow ambient lighting" to turn it off
(owner, 17:13). Every app has it on its Settings page.
