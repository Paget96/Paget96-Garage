/* SPDX-License-Identifier: GPL-3.0-only */
/* Changes Copyright (c) 2026 Danijel Markov (Paget96). Paget96 Garage, p96-renderd. See NOTICE.
 * Based on mgu-render (idrive7-apps kit/renderd), GPL-3.0-or-later, Copyright (C) 2026 Robert Nisipeanu and
 * IterioDev. nft beside the loop and the file-less rule_out follow mgu-store's mgu-render 0.6.14 and 0.6.16. */
/*
 * Touch routing (touch.h), from IterioDev's mgu-renderd src/touch.c (the renderer it
 * extends is idrive7-apps kit/renderd, MIT, Copyright (c) 2026 cauliflowermossgrape). The rule's interface and
 * source address come from the configuration (touch_iface, touch_saddr), per unit.
 *
 * The HMI (Hmi8 on iDrive 8, HmiMain3D on iDrive 7) reads the centre display's touch as UDP PDUs on port 30567 -
 * on the car from the display (APIX3 Ethernet, 160.48.199.115 on vlan73), in the MGU VM from vminput (lo). While a
 * visible app has claimed an area, one stateless nftables rule (raw prerouting, notrack, destination port
 * rewritten 30567 -> 30570) sends them here instead. Per gesture, decided when the finger goes down: inside a
 * claim (and the -a area) -> the app's (E_TOUCH), else every PDU goes on to the HMI unchanged (127.0.0.1:30567,
 * from port 30571, which the VM rule skips so nothing loops). Non-finger PDUs always go to the HMI. One finger.
 *
 * Beside IterioDev's renderer, which diverts the same PDUs with its own rule (table ip touchroute, ports 30568 in
 * and 30569 out), and beside the other mgu-render (the Store's: table ip mgu_render, 30570 and 30571; idrive7-apps'
 * kit renderer: table ip idrive7_render, 30572 and 30573; touch_table and touch_port, touch_ports()):
 * ours has its own table and ports, so neither removes the other's rule or takes
 * the other's port. Each diverts only while one of its own apps is shown with claims, so they take turns. Were
 * both in at once, the first chain to see a PDU takes it; on lo our rule lets IterioDev's re-injections (from
 * 30569) through as well as ours, and his catches ours, so a PDU passes each renderer at most once. On the car
 * our rule also takes what the other two hand on to the HMI over lo (from 30569 and 30571): the Store's
 * renderer keeps its rule in while an overlay of its stays on screen, and without that our apps got no touch.
 * A gesture that goes to the HMI while apps claim closes them (E_CLOSED): the user tapped the HMI, e.g. its home
 * button - with no claim left the rule goes, and the rest of that gesture reaches the HMI directly.
 *
 * Fail open: no claim -> no rule. A guard process (forked at start) gets a heartbeat; when the renderer dies it
 * removes the rule, when it hangs with the rule in place (no beat for GUARD_MS) it removes the rule and kills it.
 * nft itself runs as a child the loop checks each turn (job_start), so a slow nft never stops the beat.
 *
 * PDU (Hmi8 CHmiTouchScreenDevice::decodeTouchScreenPduData): 16-byte header, big-endian id + length + 8-byte
 * timestamp; touchscreen data = id 0xB0048002, payload [12] >> 4 word type (0/1/2/4/8: the car's display sends
 * other types than the 8 vminput sends, so it is not checked), [37] & 0x1f finger count (0: no finger, the HMI's),
 * first finger [38] X u16, [44] Y u16, [47] bits 4-5 event (1 down, 2 move, 3 up; bits 6-7 its touch type).
 */
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include "touch.h"

/* re-injections of the other renderers: IterioDev's (30569), the Store's mgu-render (30571), the kit's (30573) */
enum { PORT_HMI = 30567, PORT_OTHER_OUT = 30569, PORT_STORE_OUT = 30571, PORT_KIT_OUT = 30573, GUARD_MS = 1500, JOB_MS = 10000, RETRY_MS = 5000 };
static int port_in = 30572, port_out = 30573;
/* one after the other renderers' -300 (still before conntrack's -200, so notrack holds): with both rules in, theirs
 * see a touch first. The Store's overlays are drawn over our apps, so a touch on one is its own; what it doesn't
 * want it hands on over lo, where ours takes it (issue #152: at the same priority the order was the tables', and a
 * tap on an overlay closed our app). */
enum { PRIORITY = -299 };
static int from_port;                          /* the PDU's sender: the display, or another renderer handing it on */
static char table[48] = "ip idrive7_render";
#define PORT_IN port_in
#define PORT_OUT port_out
enum { DOWN = 1, MOVE = 2, UP = 3 };
enum { NONE = -1, HMI = -2, GONE = -3 };       /* gesture owner, else a client slot; GONE: its app left */

/* On the car the release firewall (ip filter input, ends in logblocked = drop) only accepts the display's touch
 * on 30567, so the diverted 30570 needs its own accept in that chain - inserted (once, idempotent) every time
 * the divert goes in, as the firewall may have been reloaded meanwhile; without it diverted touches never arrive
 * (iDrive 8 car). lo (VM, emulator) is accepted anyway. */
static char rule[384], open_fw[512];
static int in = -1, out = -1, beat = -1, loaded, owner = NONE;
static int ax, ay, aw, ah;                     /* area apps may claim; aw 0 = whole screen */

static unsigned be16(const unsigned char *p) { return p[0] << 8 | p[1]; }
static unsigned be32(const unsigned char *p) { return (unsigned)p[0] << 24 | p[1] << 16 | p[2] << 8 | p[3]; }

/* nft runs beside the render loop, never in it: one job at a time, a shell started with posix_spawn in its own
 * process group, looked at (waitpid WNOHANG) every loop turn and killed with its group after JOB_MS. A slow or
 * failing nft only delays the divert; the loop keeps drawing and beating to the guard. Run inline (system()), an
 * nft slower than GUARD_MS while the rule was in made the guard kill the renderer each time an app gave up its
 * touch area (the same bug class mgu-store's mgu-render fixed in 0.6.16). */
enum { JOB_NONE, JOB_CLEAN, JOB_IN, JOB_OUT };
static int job;                                /* the one running, JOB_NONE when idle */
static pid_t job_pid;
static double job_t;
static int job_killed;
static char job_file[40];                      /* the script's file while JOB_IN runs */
static double failed = -1e9;                   /* when a load last failed */
static int stray;                              /* a failed or killed load may have put the rule in all the same */

static double now_ms(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec * 1e3 + t.tv_nsec / 1e6; }

static int job_start(int kind, const char *cmd)
{
    posix_spawnattr_t at;
    sigset_t dfl;
    posix_spawnattr_init(&at);
    sigemptyset(&dfl); sigaddset(&dfl, SIGPIPE);              /* ignored here; nft gets the default */
    posix_spawnattr_setsigdefault(&at, &dfl);
    posix_spawnattr_setpgroup(&at, 0);                        /* its own group: a timeout kills nft too */
    posix_spawnattr_setflags(&at, POSIX_SPAWN_SETSIGDEF | POSIX_SPAWN_SETPGROUP);
    char *argv[] = { "sh", "-c", (char *)cmd, NULL };
    int r = posix_spawn(&job_pid, "/bin/sh", NULL, &at, argv, environ);
    posix_spawnattr_destroy(&at);
    if (r) return -1;
    job = kind; job_t = now_ms(); job_killed = 0;
    return 0;
}

/* The load: the firewall's accept, the script given to nft in a file (the nft of some units, MainApp 6.5.5 cars,
 * cannot read one from "-", and nftables 0.7 still exits 0 then), and the table must be there afterwards: an nft
 * that reports a load done is not proof. */
static int rule_in_start(void)
{
    char s[768], cmd[sizeof open_fw + 320];
    snprintf(s, sizeof s, "table %s\ndelete table %s\ntable %s {\n"
        "chain pre {\ntype filter hook prerouting priority %d; policy accept;\n%s\n}\n}\n", table, table, table, PRIORITY, rule);
    snprintf(job_file, sizeof job_file, "/tmp/p96-renderd-nft-XXXXXX");
    int fd = mkstemp(job_file);
    if (fd < 0) { job_file[0] = 0; return -1; }
    size_t n = strlen(s);
    int ok = write(fd, s, n) == (ssize_t)n;
    close(fd);
    char fw[sizeof open_fw + 128] = "";
    if (open_fw[0])
        snprintf(fw, sizeof fw, "{ %s; } || echo '[mgu-render] touch: opening the firewall for %d failed' >&2; ", open_fw, PORT_IN);
    int len = snprintf(cmd, sizeof cmd, "%snft -f %s 2>&1 && nft list table %s >/dev/null 2>&1", fw, job_file, table);
    if (!ok || len >= (int)sizeof cmd || job_start(JOB_IN, cmd) < 0) { unlink(job_file); job_file[0] = 0; return -1; }
    return 0;
}
/* Out with no file: taking the rule out must work with /tmp full (a script file there would fail first and leave
 * the rule in). An absent table is not an error here. */
static void rule_out_cmd(char *cmd, size_t n) { snprintf(cmd, n, "nft delete table %s >/dev/null 2>&1", table); }
static void rule_out(void) { char cmd[96]; rule_out_cmd(cmd, sizeof cmd); if (system(cmd)) { /* no table: fine */ } }
static int rule_out_start(int kind) { char cmd[96]; rule_out_cmd(cmd, sizeof cmd); return job_start(kind, cmd); }

/* the running job: -1 still running, else 0 done and succeeded, 1 failed (or killed after JOB_MS) */
static int job_poll(void)
{
    int st;
    pid_t r = waitpid(job_pid, &st, WNOHANG);
    if (r == 0) {
        if (!job_killed && now_ms() - job_t > JOB_MS) { kill(-job_pid, SIGKILL); job_killed = 1; }
        return -1;
    }
    if (job_file[0]) { unlink(job_file); job_file[0] = 0; }
    job = JOB_NONE;
    return job_killed || r < 0 || !WIFEXITED(st) || WEXITSTATUS(st) ? 1 : 0;
}

int touch_ports(int in_port, const char *name)
{
    if (in_port < 1024 || in_port > 65534 || in_port == PORT_HMI || !name || !*name || strlen(name) > 32) return -1;
    for (const char *q = name; *q; q++) if (!((*q >= 'a' && *q <= 'z') || (*q >= '0' && *q <= '9') || *q == '_')) return -1;
    port_in = in_port; port_out = in_port + 1;
    snprintf(table, sizeof table, "ip %s", name);
    return 0;
}

/* The guard: beats are '0' (no rule) / '1' (rule in). Dead renderer (pipe closed) -> rule out; hung with the
 * rule in -> rule out + kill it. A hang without the rule (start-up, nothing claimed) touches nobody's input. */
static void guard(int fd, pid_t renderer)
{
    char b[64], state = '0';
    for (int fdn = 3; fdn < 1024; fdn++) if (fdn != fd) close(fdn);
    signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN);
    for (;;) {
        struct pollfd pf = { .fd = fd, .events = POLLIN };
        int r = poll(&pf, 1, GUARD_MS);
        if (r > 0) {
            ssize_t n = read(fd, b, sizeof b);
            if (n > 0) { state = b[n - 1]; continue; }
            rule_out();                                       /* the renderer is gone */
            _exit(0);
        }
        if (r == 0 && state == '1') {
            fprintf(stderr, "[mgu-render guard] renderer hung with touch diverted: rule removed, renderer killed\n");
            rule_out();
            kill(renderer, SIGKILL);
            _exit(0);
        }
    }
}

/* the divert rule and the firewall line for iface (and saddr), into rule and open_fw; -1 for a bad name */
static int touch_rules(const char *iface, const char *saddr)
{
    if (!iface || !*iface) { fprintf(stderr, "touch: no interface\n"); return -1; }
    for (const char *q = iface; *q; q++) if (!((*q >= 'a' && *q <= 'z') || (*q >= '0' && *q <= '9') || *q == '.' || *q == '_' || *q == '-')) return -1;
    for (const char *q = saddr; q && *q; q++) if (!((*q >= '0' && *q <= '9') || *q == '.')) return -1;
    if (!strcmp(iface, "lo")) {
        /* the HMI's touch comes from a local sender: re-injections (ours from PORT_OUT, IterioDev's renderer's from
         * PORT_OTHER_OUT, the other mgu-render's) go on to the HMI */
        snprintf(rule, sizeof rule, "iifname \"lo\" udp sport { %d, %d, %d } accept\n"
                 "iifname \"lo\" udp dport %d notrack udp dport set %d", PORT_OTHER_OUT, PORT_STORE_OUT, PORT_KIT_OUT, PORT_HMI, PORT_IN);
        open_fw[0] = 0;
    } else {
        char src[64] = "";
        if (saddr && *saddr) snprintf(src, sizeof src, "ip saddr %s ", saddr);
        /* and what the other renderers hand on to the HMI (IterioDev's from PORT_OTHER_OUT, the Store's mgu-render's
         * from PORT_STORE_OUT): a renderer whose rule is in all the time (the Store's, for an overlay that stays on
         * screen) sees every PDU first and passes the ones outside its claims to the HMI over lo, past the display
         * rule; without this our apps get no touch while it runs (iDrive 8 car, issue #152). Ours (PORT_OUT) are
         * not caught: nothing loops. */
        snprintf(rule, sizeof rule, "iifname \"%s\" %sudp dport %d notrack udp dport set %d\n"
                 "iifname \"lo\" udp sport { %d, %d } udp dport %d notrack udp dport set %d",
                 iface, src, PORT_HMI, PORT_IN, PORT_OTHER_OUT, PORT_STORE_OUT, PORT_HMI, PORT_IN);
        snprintf(open_fw, sizeof open_fw, "nft list chain ip filter input 2>/dev/null | grep -q 'udp dport %d accept' || "
                 "nft insert rule ip filter input iifname %s %sudp dport %d accept", PORT_IN, iface, src, PORT_IN);
    }
    return 0;
}

int touch_init(const char *iface, const char *saddr, const int area[4])
{
    if (touch_rules(iface, saddr) < 0) return -1;
    aw = 0;
    if (area && area[2] > 0 && area[3] > 0) { ax = area[0]; ay = area[1]; aw = area[2]; ah = area[3]; }
    struct sockaddr_in a = { .sin_family = AF_INET, .sin_port = htons(PORT_IN), .sin_addr.s_addr = htonl(INADDR_ANY) };
    struct sockaddr_in o = { .sin_family = AF_INET, .sin_port = htons(PORT_OUT), .sin_addr.s_addr = htonl(INADDR_LOOPBACK) };
    in = socket(AF_INET, SOCK_DGRAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
    out = socket(AF_INET, SOCK_DGRAM | SOCK_CLOEXEC, 0);
    if (bind(in, (struct sockaddr *)&a, sizeof a) || bind(out, (struct sockaddr *)&o, sizeof o)) {
        fprintf(stderr, "touch: bind %d/%d: ", PORT_IN, PORT_OUT); perror(NULL); close(in); close(out); in = out = -1; return -1;
    }
    int p[2];
    pid_t me = getpid();
    if (pipe2(p, O_CLOEXEC)) return -1;
    pid_t g = fork();
    if (g == 0) { close(p[1]); guard(p[0], me); }
    close(p[0]);
    if (g < 0) { close(p[1]); return -1; }
    beat = p[1];
    fcntl(beat, F_SETFL, O_NONBLOCK);
    if (rule_out_start(JOB_CLEAN) < 0) { /* a leftover from a crash: the guard took it out */ }
    if (aw) fprintf(stderr, "[mgu-render] touch routing on %s, apps may claim %d,%d %dx%d\n", iface, ax, ay, aw, ah);
    else fprintf(stderr, "[mgu-render] touch routing on %s, apps may claim the whole screen\n", iface);
    return 0;
}

int touch_fd(void) { return in; }

void touch_tick(int claimed)
{
    static double last_beat;
    static int failing;
    if (!rule[0]) return;
    double t = now_ms();
    if (job) {
        int was = job, r = job_poll();
        if (r >= 0) {
            if (was == JOB_IN && !r) {
                if (!loaded || failing) fprintf(stderr, "[mgu-render] touch: diverted (an app claims an area)\n");
                loaded = 1; failing = 0; stray = 0;
            } else if (was == JOB_IN) {
                failed = t; stray = 1;
                if (!failing) fprintf(stderr, "[mgu-render] touch: loading the nft rule failed%s, touch stays the HMI's; "
                                      "trying again every 5 s\n", job_killed ? " (no answer in 10 s)" : "");
                failing = 1;
            } else if (was == JOB_OUT && r) {
                fprintf(stderr, "[mgu-render] touch: taking the nft rule out failed%s; trying again\n",
                        job_killed ? " (no answer in 10 s)" : "");
            } else if (was == JOB_OUT) {
                if (loaded) fprintf(stderr, "[mgu-render] touch: nothing claimed, straight to the HMI\n");
                loaded = 0; stray = 0;
            }
            last_beat = 0;
        }
    }
    claimed = claimed != 0;
    if (!job && (claimed != loaded || (!claimed && stray))) {
        if (!claimed) { if (rule_out_start(JOB_OUT) < 0) fprintf(stderr, "[mgu-render] touch: nft could not be started\n"); }
        else if (t - failed > RETRY_MS) {                     /* nft missing / refusing: not every loop turn */
            if (rule_in_start() < 0) {
                failed = t;
                if (!failing) fprintf(stderr, "[mgu-render] touch: loading the nft rule failed, touch stays the HMI's; trying again every 5 s\n");
                failing = 1;
            }
        }
        last_beat = 0;
    }
    if (t - last_beat < 100) return;
    last_beat = t;
    /* '1' while the rule is or may be in: the loop never waits for nft, so a missing beat is a hang */
    if (write(beat, loaded || stray || job == JOB_IN ? "1" : "0", 1) < 0) { /* full pipe: the guard is behind, it reads the latest */ }
}

int touch_busy(void) { return job != JOB_NONE; }

void touch_forget(int slot) { if (owner == slot) owner = GONE; }

/* at exit: a running nft is stopped, the rule taken out here, and the guard, seeing the renderer gone, takes it
 * out too (it does that whatever it last heard) */
void touch_stop(void)
{
    if (job) { kill(-job_pid, SIGKILL); waitpid(job_pid, NULL, 0); if (job_file[0]) unlink(job_file); job_file[0] = 0; job = JOB_NONE; }
    if (loaded || stray) rule_out();
    loaded = stray = 0;
}

/* one finger PDU: 1 = it is an app's (sent to it, or dropped), 0 = forward to the HMI */
static int route_finger(const unsigned char *p)
{
    int x = be16(p + 38), y = be16(p + 44), ev = (p[47] >> 4) & 3;
    touch_unmap(&x, &y);                         /* where the HMI shows smaller or larger than its design size */
    /* every DOWN starts a gesture (one finger): an UP we never saw - the rule went (HMI touched, app gone) or a
     * lost datagram - must not hand the next gesture to the last owner */
    if (ev == DOWN) {
        int slot = aw && (x < ax || y < ay || x >= ax + aw || y >= ay + ah) ? -1 : touch_owner_at(x, y);
        owner = slot >= 0 ? slot : HMI;
        if (owner == HMI) {                      /* e.g. the HMI's home button: the shown app is left */
            fprintf(stderr, "[mgu-render] touch: %d,%d is outside the apps' claims (from %s): to the HMI\n", x, y,
                    from_port == PORT_STORE_OUT ? "the Store's renderer" : from_port == PORT_OTHER_OUT ? "IterioDev's renderer" : "the display");
            touch_outside();
        }
    }
    int app = owner >= 0 || owner == GONE;
    if (owner >= 0 && ev >= DOWN && ev <= UP) touch_send(owner, ev, x, y);
    if (ev == UP) owner = NONE;
    return app;
}

void touch_read(void)
{
    unsigned char b[2048], f[2048];
    struct sockaddr_in hmi = { .sin_family = AF_INET, .sin_port = htons(PORT_HMI), .sin_addr.s_addr = htonl(INADDR_LOOPBACK) };
    struct sockaddr_in src;
    socklen_t sl = sizeof src;
    ssize_t len;
    while ((len = recvfrom(in, b, sizeof b, 0, (struct sockaddr *)&src, &sl)) > 0) {
        from_port = sl >= sizeof src ? ntohs(src.sin_port) : 0;
        sl = sizeof src;
        size_t fn = 0, at = 0;                    /* walk the PDUs; copy the ones that go on to the HMI */
        while (at + 16 <= (size_t)len) {
            size_t plen = be32(b + at + 4), end = at + 16 + plen;
            if (end > (size_t)len) { end = len; plen = len - at - 16; }
            const unsigned char *p = b + at + 16;
            if (!(be32(b + at) == 0xB0048002 && plen >= 48 && (p[37] & 0x1f) && route_finger(p))) {
                memcpy(f + fn, b + at, end - at); fn += end - at;
            }
            at = end;
        }
        if (at < (size_t)len) { memcpy(f + fn, b + at, len - at); fn += len - at; }   /* trailing bytes: as they came */
        if (fn) sendto(out, f, fn, 0, (struct sockaddr *)&hmi, sizeof hmi);
    }
}
