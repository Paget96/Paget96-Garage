<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage. See NOTICE. -->

# p96-renderd and mgu-store's renderer: reported problems, side by side

What people reported about the renderer of the MGU Store (`native/mgu-render` in robertnisipeanu/mgu-store), and
whether p96-renderd has the same problem. "Theirs" is mgu-store's `main` at commit `37702a8` (mgu-render 0.6.26),
read on 2026-11-26. The open pull requests were read from their branches. The issue tracker there is empty, so the
reports are the pull requests and the fixes in their history.

How each line was checked:

- **tested**: a test in `test/` shows it, and `make test` passes (Ubuntu 24.04 in Docker, Mesa's software GPU).
- **read**: the code was read; no test runs it.
- **unsure**: a guess, or only a car can tell.

Nothing here has run on a car. Every "fixed" below means fixed and tested on a PC.

## The open pull requests

| # | Problem reported | Theirs (main) | Ours before | Ours now | Checked |
|---|---|---|---|---|---|
| 156 | The foreground gate never watches an HMI instance again once its proxy failed (as while the HMI still starts after an iDrive start), and does not read an instance's stack when it becomes available. An app shown there is never "in front", so it is drawn in the HMI's page with the HMI's button bar instead of full screen. | Has it (the PR is open) | Had it | Fixed: a failed instance is tried again every 5 s (logged once, and once more when it works), and an instance that becomes available has its stack read at once. `js/foreground_gate.js` | tested: `test/test_gate_watch.js` on a mock SOME/IP; it fails on the old gate |
| 139 | In embed mode (the app drawn inside the HMI's page), the HMI shows a black box for 100 to 200 ms on every page change. | Has it (the PR is open) | Does not apply | Does not apply: embed is off in p96-renderd (`embed = 0`); our apps draw on their own layer, where a page change is just the app's next frame. It will matter when embed is turned on. | read |
| 134 | On some firmware (MainApp 6.5.5) the gate does not find the HMI's `RemoteHmiApplication` description, so no app is ever in front. | Main finds it another way (the copy MainApp's installer writes into each app's folder); the search under `/usr/lib` is still an open PR | Had the fix already (the search in `src-gen` folders under `/usr/lib`, two levels deep, from idrive7-apps) | No change | tested: `test/test_gate_iface.js` (new) |
| 133 | An earlier install's folder still claims the same app uuid, so the gate picks the wrong uid (or none) and the app never shows. | Fixed in 0.6.12 | Had the fix already (the uid the app manager registered wins; none when it is not exactly one) | No change | tested: `test/test_gate_apps.js` |
| 132 | The nft of some units cannot read a script from `-`, so the touch divert never went in while the log said "diverted". | Fixed in 0.6.13 | Had the fix already (script in a file, and the table must exist after the load) | No change | tested: `test/test_touch.c` (the stand-in nft reads the script from the file) |

## Bug classes from their closed history

The fixes in mgu-render's history that are about the same kinds of problem, and whether ours had them.

| Problem | Theirs | Ours before | Ours now | Checked |
|---|---|---|---|---|
| nft ran inside the render loop. An nft slower than 1.5 s while the touch rule was in stopped the heartbeat, so the touch guard killed the renderer each time an app gave up its touch area; repeated kills hit the service's start limit. | Fixed in 0.6.16 | Had it | Fixed: nft runs as a child process the loop checks each turn, stopped after 10 s. The loop keeps drawing and beating meanwhile; a failed load is tried again every 5 s, and a load that failed or was stopped is still taken out when nothing claims. `src/touch.c` | tested: `test/test_touch.c` with a 3 s nft (no tick over 100 ms, the guard does not kill), and with an nft whose table is missing after the load |
| Taking the touch rule out needed a script file in `/tmp`; with `/tmp` full the rule stayed in. | Fixed in 0.6.14 | Had it | Fixed: `nft delete table` with no file | tested: the command is checked in `test/test_touch.c`; a full `/tmp` was not simulated |
| An HMI popup, the header menu, the voice assistant or a screen opened from there covers an app, but touch and the controller stay with the app: the popup cannot be closed by touch and the menu answers nothing. | Fixed in 0.6.20 | Had it | Fixed: the gate follows the HMI's focus on each app's states and reports `covered [uid ...]` once none of an app's states had the focus for 150 ms (a page change inside the app moves it in one burst and does not count). A covered app's layer is taken off, so touch and the controller go back to the HMI with it, and the popup is on top. `js/foreground_gate.js`, `src/gate.c`, `src/main.c` | tested: the gate's report (`test/test_gate_watch.js`) and its parsing (`test/test_gate.c`); the renderer taking the layer off: read. Whether every popup takes the focus: unsure, car only |
| A visible camera or video surface with no picture (iDrive 8, G82) hid every layer app for good. | Fixed in 0.6.10 | Had the fix already (a yield surface counts only when visible and with a size) | No change | read |
| Upstream's later "an app that does not react to 4 inputs loses touch and the controller for 10 s". | In 0.6.20 | Not there | Not taken: it guesses from the picture whether an app reacted, and a Garage page that shows the same value after a tap would lose its input. | read |
| The shared glyph texture is never given back: after many apps or large fonts it fills up and text stops drawing. | Fixed in 0.6.23 | Had it | Fixed as theirs: glyphs live in texture pages made when needed, an atlas is freed with the last app that used it and a page with its last atlas (64 MiB at most). `src/gfx.c` | tested: `test/test_p9.c`, 40 apps with six 1024 x 4000 atlases each come and go, text still draws, no page left after |
| Another program sets the screen's layers without ours while an app is shown: our layer is off the screen until the app is shown again. | Fixed in 0.6.7 (the layer's `screen` event puts it back) | Had it (unsure how often it happens: ours puts the layer back at every show) | Fixed: the layer's `screen` event; shown, the layer goes back at once through a fresh connection, at most 10 times in 10 s, then at its next show. `src/main.c`, `src/layerback.h` | tested: the decision (`test/test_logic.c`); the compositor's event itself: read, car only |
| A frame that repeats the one on screen is drawn again. Costs GPU time, not a bug. | Skipped since 0.6.26 | Drew it again | Skipped: the same words with nothing it draws changed since (no layer, atlas, ramp, image, place or show message) and no video stay on screen; the app gets its TICK one display frame (or its cap) later. `src/main.c`, `src/framesame.h` | tested: the decision (`test/test_logic.c`); the GPU time saved: car only |

## What only p96-renderd does

These are in `README.md` of this folder:

- **Its own socket, ids and touch divert** (`/run/p96-renderd/render.sock`, layers `0x50390000`, table
  `p96_render` on port 30574). It never takes the community socket or display-bridge's, so it runs beside the
  MGU Store's renderer and the kit's and does not take their apps.
- **The popup watch**: every other program's surface that comes up over the app area is noticed and logged, and with
  `popup_watch = yield` our layers step back while it is up (`test/test_popup.c`). This is for popups that do not
  take the focus (volume, a notification), which the covered report above cannot see.

## Not measured

CPU, memory and frame time on the head unit. Nothing in this file claims ours is faster or lighter.
