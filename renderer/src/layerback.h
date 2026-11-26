/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage, p96-renderd. See NOTICE.
 *
 * A shown app's layer that another program took off the screen goes back at once (F45; mgu-render 0.6.7 does the
 * same): the compositor tells the layer's listener its screen is none. Put back at most LAYERBACK_MAX times in
 * LAYERBACK_WINDOW_US while shown; past that it waits for the app's next show, so two programs never fight over the
 * screen's list in a loop. No GL, no Wayland: host-testable (test/test_layerback.c). */
#ifndef P96_LAYERBACK_H
#define P96_LAYERBACK_H
#include <stdint.h>

#define LAYERBACK_MAX 10
#define LAYERBACK_WINDOW_US 10000000ull

enum { LAYERBACK_IGNORE = 0, LAYERBACK_PUT = 1, LAYERBACK_WAIT = 2, LAYERBACK_GIVE_UP = 3 };

/* What to do when the layer's screen event says "none" at time t (us). shown: the layer is on and shown now.
 * *window_t, *count: the current window's start and how often it was put back in it (kept by the caller, 0 at
 * first). LAYERBACK_WAIT: hidden, it goes on at its next show anyway; LAYERBACK_GIVE_UP: the first time over the
 * limit (log it once); later ones over the limit are LAYERBACK_IGNORE. */
static inline int layerback_decide(uint64_t t, int shown, uint64_t *window_t, int *count) {
    if (!shown) return LAYERBACK_WAIT;
    if (t - *window_t > LAYERBACK_WINDOW_US) { *window_t = t; *count = 0; }
    if (++*count > LAYERBACK_MAX) return *count == LAYERBACK_MAX + 1 ? LAYERBACK_GIVE_UP : LAYERBACK_IGNORE;
    return LAYERBACK_PUT;
}

#endif
