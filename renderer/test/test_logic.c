/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage, p96-renderd. See NOTICE.
 *
 * T24's two decisions, without GL or Wayland:
 *   framesame.h  a frame that repeats the one on screen is not drawn again
 *   layerback.h  a shown app's layer taken off the screen goes back, at most 10 times in 10 s
 *   build/host/test_logic
 */
#include <stdio.h>
#include <string.h>
#include "framesame.h"
#include "layerback.h"

static int fails, checks;
#define CHECK(cond, what) do { checks++; if (cond) printf("ok   %s\n", what); else { printf("FAIL %s\n", what); fails++; } } while (0)

int main(void) {
    uint32_t on[4] = { 2, 1, 2, 3 }, same[4] = { 2, 1, 2, 3 }, other[4] = { 2, 1, 2, 4 };
    CHECK(frame_repeats(on, 4, same, 4, 0, 1, 0, 5, 5), "the same words, nothing changed, shown: a repeat");
    CHECK(!frame_repeats(on, 4, other, 4, 0, 1, 0, 5, 5), "one word differs: drawn");
    CHECK(!frame_repeats(on, 4, same, 3, 0, 1, 0, 5, 5), "shorter: drawn");
    CHECK(!frame_repeats(on, 4, same, 4, 1, 1, 0, 5, 5), "a frame still waits to be drawn: drawn");
    CHECK(!frame_repeats(on, 4, same, 4, 0, 0, 0, 5, 5), "not shown (it will be drawn when it shows): drawn");
    CHECK(!frame_repeats(on, 4, same, 4, 0, 1, 1, 5, 5), "the app has a video (its picture changes by itself): drawn");
    CHECK(!frame_repeats(on, 4, same, 4, 0, 1, 0, 6, 5), "a layer, atlas or place changed since: drawn");
    CHECK(!frame_repeats(NULL, 0, same, 4, 0, 1, 0, 5, 5), "no frame on screen yet: drawn");
    CHECK(!frame_repeats(on, 0, same, 0, 0, 1, 0, 5, 5), "an empty frame: drawn");

    uint64_t wt = 0; int n = 0;
    CHECK(layerback_decide(1000000, 0, &wt, &n) == LAYERBACK_WAIT && n == 0, "hidden: back at its next show, nothing counted");
    int put = 0, gave = 0, ign = 0;
    for (int i = 0; i < 15; i++) {
        int k = layerback_decide(2000000 + (uint64_t)i * 100000, 1, &wt, &n);
        put += k == LAYERBACK_PUT; gave += k == LAYERBACK_GIVE_UP; ign += k == LAYERBACK_IGNORE;
    }
    CHECK(put == 10 && gave == 1 && ign == 4, "shown: put back 10 times in 10 s, then it waits (said once)");
    CHECK(layerback_decide(2000000 + 10500000, 1, &wt, &n) == LAYERBACK_PUT, "a new 10 s window: put back again");

    printf("%s: %d checks, %d failed\n", fails ? "FAIL" : "ok  ", checks, fails);
    return fails != 0;
}
