/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage, p96-renderd. See NOTICE.
 *
 * A frame that repeats the one on screen is not drawn again (T24; mgu-render 0.6.26 does the same): the picture would
 * not change, only GPU time would be spent. The app still gets its TICK, one display frame (or its cap) later, as if
 * the frame had been drawn. "Nothing it draws has changed" is a count of the messages that can change a picture (a
 * layer, an atlas, a ramp, an image, a placement, a show): the frame is a repeat only while that count is the one it
 * had when the frame on screen was drawn. A video changes its picture without a message, so an app with one is
 * always drawn. No GL, no Wayland: host-testable (test/test_framesame.c). */
#ifndef P96_FRAMESAME_H
#define P96_FRAMESAME_H
#include <stddef.h>
#include <stdint.h>
#include <string.h>

/* the frame p (nw words) repeats the one on screen (on, on_n words, drawn when the change count was drawn) */
static inline int frame_repeats(const uint32_t *on, size_t on_n, const void *p, size_t nw, int dirty, int shown, int videos,
                                uint32_t changes, uint32_t drawn) {
    return nw && on && nw == on_n && !dirty && shown && !videos && changes == drawn && !memcmp(on, p, nw * 4);
}

#endif
