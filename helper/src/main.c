/*
 * galaxy-discovery-helper
 *
 * Minimal IEEE 1722.1 ATDECC ADP listener for the Meyer Sound Galaxy
 * auto-discovery Companion module.
 *
 * Scope: discovery only. We parse just the fields the module needs to
 * find a Galaxy and connect to it. AVB / streaming / association /
 * gPTP details are not surfaced.
 *
 *   stdin commands (newline-terminated):
 *     "discover\n" -> send another ENTITY_DISCOVER on every iface
 *     "quit\n"     -> exit cleanly
 *
 *   stdout NDJSON:
 *     {"event":"ready", "interfaces":[{"name":"en15","src_mac":"a0:ce:..."}]}
 *     {"event":"sent_discover","entity_id":"...","ifaces":3}
 *     {"event":"adp","iface":"en15","msg_type":"ENTITY_AVAILABLE",
 *      "src_mac":"00:1c:ab:01:1a:dc",
 *      "entity_id":"001cabfffe011adc",
 *      "entity_model_id":"001cabb80400400a",
 *      "valid_time_s":20}
 *     {"event":"error","msg":"..."}
 *
 * macOS    uses BPF (/dev/bpf*); needs group access_bpf (admin default).
 * Linux    uses AF_PACKET; needs CAP_NET_RAW (`setcap cap_net_raw=eip`).
 * Windows  uses libpcap (Npcap); needs Npcap installed system-wide.
 */

#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <stdint.h>
#include <stdarg.h>
#include <time.h>

#if defined(_WIN32)
#  define WIN32_LEAN_AND_MEAN
#  include <winsock2.h>
#  include <ws2tcpip.h>
#  include <windows.h>
#  include <iphlpapi.h>
#  include <fcntl.h>
#  include <io.h>
#  include <pcap.h>
#  ifdef _MSC_VER
#    pragma comment(lib, "ws2_32.lib")
#    pragma comment(lib, "iphlpapi.lib")
#    pragma comment(lib, "wpcap.lib")
#  endif
#  define MAX_IFACE_NAME 260
#else
#  include <unistd.h>
#  include <fcntl.h>
#  include <sys/types.h>
#  include <sys/socket.h>
#  include <sys/ioctl.h>
#  include <sys/select.h>
#  include <net/if.h>
#  include <net/ethernet.h>
#  include <netinet/in.h>
#  include <arpa/inet.h>
#  include <ifaddrs.h>
#  define MAX_IFACE_NAME IFNAMSIZ
#endif

#if defined(__APPLE__)
#  include <net/bpf.h>
#  include <net/if_dl.h>
#elif defined(__linux__)
/* <netpacket/packet.h> is the userspace wrapper around the kernel
 * <linux/if_packet.h> structs (sockaddr_ll, packet_mreq, ...). Pulling
 * both at once redefines them on glibc — use only the userspace header. */
#  include <netpacket/packet.h>
#endif

/* ---- protocol constants --------------------------------------------- */

#define ETHERTYPE_AVTP        0x22F0
#define AVTP_SUBTYPE_ADP      0xFA
#define ADP_MSG_ENTITY_AVAILABLE  0
#define ADP_MSG_ENTITY_DEPARTING  1
#define ADP_MSG_ENTITY_DISCOVER   2
static const uint8_t ADP_MULTICAST_MAC[6] = { 0x91, 0xe0, 0xf0, 0x01, 0x00, 0x00 };
#define ADP_FRAME_LEN 82          /* 14 eth + 12 AVTPDU + 56 ADP body */

/* ---- one bound interface -------------------------------------------- */

/* Headroom for hosts with lots of VLANs / VPN tunnels / bridges. If we
 * still hit the cap, enumerate_and_open() emits a warning so the user
 * knows interfaces past the limit were ignored. */
#define MAX_IFACES 32

typedef struct {
    char     name[MAX_IFACE_NAME];
    int      fd;            /* POSIX only; -1 on Windows                    */
    uint8_t  src_mac[6];
    int      dead;          /* set once read() reports the iface has gone   */
#if defined(__APPLE__)
    unsigned bpf_bufsize;
#elif defined(__linux__)
    int      ifindex;
#elif defined(_WIN32)
    pcap_t  *pcap;
#endif
} iface_t;

static iface_t IFACES[MAX_IFACES];
static int N_IFACES = 0;

/* ---- json helpers --------------------------------------------------- */

static void emit_event(const char *event, const char *fmt, ...) {
    fprintf(stdout, "{\"event\":\"%s\"", event);
    if (fmt && *fmt) {
        fputc(',', stdout);
        va_list ap; va_start(ap, fmt); vfprintf(stdout, fmt, ap); va_end(ap);
    }
    fprintf(stdout, "}\n"); fflush(stdout);
}
static void emit_error(const char *fmt, ...) {
    fprintf(stdout, "{\"event\":\"error\",\"msg\":\"");
    va_list ap; va_start(ap, fmt); vfprintf(stdout, fmt, ap); va_end(ap);
    fprintf(stdout, "\"}\n"); fflush(stdout);
}
static void mac_to_str(const uint8_t mac[6], char *out) {
    snprintf(out, 18, "%02x:%02x:%02x:%02x:%02x:%02x",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

/* ---- big-endian helpers --------------------------------------------- */

static inline void be_put16(uint8_t *p, uint16_t v) { p[0] = v >> 8; p[1] = v; }
static inline void be_put64(uint8_t *p, uint64_t v) {
    for (int i = 0; i < 8; i++) p[i] = (v >> (56 - 8*i)) & 0xff;
}
static inline uint16_t be_get16(const uint8_t *p) { return ((uint16_t)p[0] << 8) | p[1]; }
static inline uint64_t be_get64(const uint8_t *p) {
    uint64_t v = 0; for (int i = 0; i < 8; i++) v = (v << 8) | p[i]; return v;
}

/* ---- ADP frame build + parse --------------------------------------- */

static void build_entity_discover_frame(uint8_t *out, const uint8_t src_mac[6],
                                        uint64_t target_entity_id) {
    memset(out, 0, ADP_FRAME_LEN);
    memcpy(out + 0, ADP_MULTICAST_MAC, 6);
    memcpy(out + 6, src_mac, 6);
    be_put16(out + 12, ETHERTYPE_AVTP);
    out[14] = AVTP_SUBTYPE_ADP;
    out[15] = ADP_MSG_ENTITY_DISCOVER & 0x0f;
    be_put16(out + 16, 56);                /* valid_time=0, cdl=56 */
    be_put64(out + 18, target_entity_id);  /* 0 = wildcard         */
}

static void handle_frame(const char *ifname, const uint8_t *frame, size_t len) {
    if (len < 14 + 12 + 56) return;
    if (be_get16(frame + 12) != ETHERTYPE_AVTP) return;
    const uint8_t *avtp = frame + 14;
    if (avtp[0] != AVTP_SUBTYPE_ADP) return;

    /* Drop frames we sent ourselves (BPF reflects writes, bridges echo). */
    for (int i = 0; i < N_IFACES; i++) {
        if (memcmp(frame + 6, IFACES[i].src_mac, 6) == 0) return;
    }

    uint8_t msg_type = avtp[1] & 0x0f;
    if (msg_type != ADP_MSG_ENTITY_AVAILABLE && msg_type != ADP_MSG_ENTITY_DEPARTING) return;

    uint8_t  valid_time     = (be_get16(avtp + 2) >> 11) & 0x1f;
    uint64_t entity_id      = be_get64(avtp + 4);
    uint64_t entity_model_id = be_get64(avtp + 12);          /* body[0..7]   */

    const char *mtname = (msg_type == ADP_MSG_ENTITY_AVAILABLE)
        ? "ENTITY_AVAILABLE" : "ENTITY_DEPARTING";

    char src_mac[18]; mac_to_str(frame + 6, src_mac);

    fprintf(stdout,
        "{\"event\":\"adp\","
        "\"iface\":\"%s\","
        "\"msg_type\":\"%s\","
        "\"src_mac\":\"%s\","
        "\"entity_id\":\"%016llx\","
        "\"entity_model_id\":\"%016llx\","
        "\"valid_time_s\":%u}\n",
        ifname, mtname, src_mac,
        (unsigned long long)entity_id,
        (unsigned long long)entity_model_id,
        (unsigned)(valid_time * 2));
    fflush(stdout);
}

/* ---- per-iface MAC lookup ------------------------------------------ */

#if defined(__APPLE__)
static int get_iface_mac(const char *ifname, uint8_t out[6]) {
    struct ifaddrs *ifa, *p;
    if (getifaddrs(&ifa) < 0) return -1;
    int found = -1;
    for (p = ifa; p; p = p->ifa_next) {
        if (p->ifa_addr && p->ifa_addr->sa_family == AF_LINK &&
            strcmp(p->ifa_name, ifname) == 0) {
            struct sockaddr_dl *sdl = (struct sockaddr_dl *)p->ifa_addr;
            if (sdl->sdl_alen == 6) { memcpy(out, LLADDR(sdl), 6); found = 0; break; }
        }
    }
    freeifaddrs(ifa);
    return found;
}
#elif defined(__linux__)
static int get_iface_mac(const char *ifname, uint8_t out[6]) {
    int s = socket(AF_INET, SOCK_DGRAM, 0);
    if (s < 0) return -1;
    struct ifreq ifr; memset(&ifr, 0, sizeof(ifr));
    strncpy(ifr.ifr_name, ifname, IFNAMSIZ - 1);
    int rc = ioctl(s, SIOCGIFHWADDR, &ifr);
    close(s);
    if (rc < 0) return -1;
    memcpy(out, ifr.ifr_hwaddr.sa_data, 6);
    return 0;
}
#elif defined(_WIN32)
/* Windows pcap names look like "\Device\NPF_{GUID}" while iphlpapi's
 * AdapterName is the bare "{GUID}". We extract the GUID portion of the
 * pcap name and match it against GetAdaptersAddresses output. */
static int get_iface_mac(const char *pcap_name, uint8_t out[6]) {
    const char *brace = strchr(pcap_name, '{');
    if (!brace) return -1;

    ULONG sz = 16 * 1024;
    IP_ADAPTER_ADDRESSES *addrs = (IP_ADAPTER_ADDRESSES *)malloc(sz);
    if (!addrs) return -1;

    ULONG flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST |
                  GAA_FLAG_SKIP_DNS_SERVER | GAA_FLAG_SKIP_FRIENDLY_NAME;
    DWORD rc = GetAdaptersAddresses(AF_UNSPEC, flags, NULL, addrs, &sz);
    if (rc == ERROR_BUFFER_OVERFLOW) {
        free(addrs);
        addrs = (IP_ADAPTER_ADDRESSES *)malloc(sz);
        if (!addrs) return -1;
        rc = GetAdaptersAddresses(AF_UNSPEC, flags, NULL, addrs, &sz);
    }
    if (rc != NO_ERROR) { free(addrs); return -1; }

    int found = -1;
    for (IP_ADAPTER_ADDRESSES *p = addrs; p; p = p->Next) {
        if (p->PhysicalAddressLength != 6) continue;
        if (!p->AdapterName) continue;
        /* AdapterName is "{GUID}"; brace points at "{GUID}" inside pcap_name. */
        if (strstr(brace, p->AdapterName) != NULL) {
            memcpy(out, p->PhysicalAddress, 6);
            found = 0;
            break;
        }
    }
    free(addrs);
    return found;
}
#endif

/* ---- open BPF (macOS) / AF_PACKET (Linux) / pcap (Windows) --------- */

#if defined(__APPLE__)
static int open_iface(iface_t *iface) {
    char path[32]; int fd = -1;
    for (int i = 0; i < 256; i++) {
        snprintf(path, sizeof(path), "/dev/bpf%d", i);
        fd = open(path, O_RDWR);
        if (fd >= 0) break;
        if (errno != EBUSY) return -1;
    }
    if (fd < 0) return -1;

    u_int blen = 64 * 1024;
    if (ioctl(fd, BIOCSBLEN, &blen) < 0) { close(fd); return -1; }
    if (ioctl(fd, BIOCGBLEN, &blen) < 0) { close(fd); return -1; }
    iface->bpf_bufsize = blen;

    struct ifreq ifr; memset(&ifr, 0, sizeof(ifr));
    strncpy(ifr.ifr_name, iface->name, IFNAMSIZ - 1);
    if (ioctl(fd, BIOCSETIF, &ifr) < 0) { close(fd); return -1; }

    u_int yes = 1;
    if (ioctl(fd, BIOCIMMEDIATE, &yes) < 0) { close(fd); return -1; }
    if (ioctl(fd, BIOCSHDRCMPLT, &yes) < 0) { close(fd); return -1; }

    iface->fd = fd;
    return fd;
}

static void process_bpf_buffer(const char *ifname, uint8_t *buf, size_t len) {
    size_t off = 0;
    while (off + sizeof(struct bpf_hdr) <= len) {
        struct bpf_hdr *bh = (struct bpf_hdr *)(buf + off);
        size_t pkt_start = off + bh->bh_hdrlen;
        size_t pkt_end   = pkt_start + bh->bh_caplen;
        if (pkt_end > len) break;
        handle_frame(ifname, buf + pkt_start, bh->bh_caplen);
        off = (pkt_end + (BPF_ALIGNMENT - 1)) & ~(BPF_ALIGNMENT - 1);
    }
}
#endif /* __APPLE__ */

#if defined(__linux__)
static int open_iface(iface_t *iface) {
    int s = socket(AF_PACKET, SOCK_RAW, htons(ETHERTYPE_AVTP));
    if (s < 0) return -1;
    struct ifreq ifr; memset(&ifr, 0, sizeof(ifr));
    strncpy(ifr.ifr_name, iface->name, IFNAMSIZ - 1);
    if (ioctl(s, SIOCGIFINDEX, &ifr) < 0) { close(s); return -1; }
    iface->ifindex = ifr.ifr_ifindex;
    struct sockaddr_ll sll = {0};
    sll.sll_family = AF_PACKET;
    sll.sll_protocol = htons(ETHERTYPE_AVTP);
    sll.sll_ifindex  = iface->ifindex;
    if (bind(s, (struct sockaddr *)&sll, sizeof(sll)) < 0) { close(s); return -1; }
    iface->fd = s;
    return s;
}
#endif

#if defined(_WIN32)
static int open_iface(iface_t *iface) {
    char errbuf[PCAP_ERRBUF_SIZE];
    /* read_timeout 50ms — pcap_next_ex will return 0 within this window
     * if no frames arrived, letting our main poll loop stay responsive. */
    pcap_t *p = pcap_open_live(iface->name, 65535, 0 /* not promisc */, 50, errbuf);
    if (!p) { emit_error("pcap_open_live(%s) failed: %s", iface->name, errbuf); return -1; }

    /* Kernel-side filter so we only wake up for ATDECC frames. */
    struct bpf_program fp;
    if (pcap_compile(p, &fp, "ether proto 0x22F0", 1, PCAP_NETMASK_UNKNOWN) == 0) {
        pcap_setfilter(p, &fp);
        pcap_freecode(&fp);
    }

    /* Non-blocking mode: pcap_next_ex returns rc=0 immediately when the
     * receive buffer is empty, instead of waiting for read_timeout. */
    if (pcap_setnonblock(p, 1, errbuf) < 0) {
        emit_error("pcap_setnonblock(%s) failed: %s", iface->name, errbuf);
        pcap_close(p);
        return -1;
    }

    iface->pcap = p;
    iface->fd = -1;
    return 0;
}
#endif

static int send_frame(iface_t *iface, const uint8_t *frame, size_t len) {
#if defined(__APPLE__)
    return write(iface->fd, frame, len) == (ssize_t)len ? 0 : -1;
#elif defined(__linux__)
    struct sockaddr_ll sll = {0};
    sll.sll_family = AF_PACKET;
    sll.sll_protocol = htons(ETHERTYPE_AVTP);
    sll.sll_ifindex  = iface->ifindex;
    sll.sll_halen    = 6;
    memcpy(sll.sll_addr, frame, 6);
    return sendto(iface->fd, frame, len, 0,
                  (struct sockaddr *)&sll, sizeof(sll)) == (ssize_t)len ? 0 : -1;
#elif defined(_WIN32)
    return pcap_sendpacket(iface->pcap, frame, (int)len);  /* 0 = ok */
#endif
}

static int send_discover_on_all(uint64_t target_entity_id) {
    int sent = 0;
    uint8_t frame[ADP_FRAME_LEN];
    for (int i = 0; i < N_IFACES; i++) {
#if defined(_WIN32)
        if (IFACES[i].dead || !IFACES[i].pcap) continue;
#else
        if (IFACES[i].dead || IFACES[i].fd < 0) continue;
#endif
        build_entity_discover_frame(frame, IFACES[i].src_mac, target_entity_id);
        if (send_frame(&IFACES[i], frame, ADP_FRAME_LEN) == 0) sent++;
    }
    return sent;
}

/* ---- interface enumeration ----------------------------------------- */

/* ---- platform preflight (run before opening any interface) --------- */

#if defined(__APPLE__)
/* Try opening /dev/bpf0 to see whether the user has BPF access at all.
 * EACCES here means they're not in the access_bpf group — emit a
 * dedicated message instead of EACCES repeated per interface. */
static int preflight(void) {
    int fd = open("/dev/bpf0", O_RDWR);
    if (fd >= 0) { close(fd); return 0; }
    if (errno == EBUSY) return 0;  /* in use but we have permission */
    if (errno == EACCES) {
        emit_error("permission denied on /dev/bpf0 — add this user to "
                   "the access_bpf group: "
                   "sudo dseditgroup -o edit -a $USER -t user access_bpf "
                   "(then log out and back in)");
        return -1;
    }
    /* Any other errno: let the per-iface loop surface it. */
    return 0;
}
#elif defined(__linux__)
static int preflight(void) {
    int s = socket(AF_PACKET, SOCK_RAW, htons(ETHERTYPE_AVTP));
    if (s >= 0) { close(s); return 0; }
    if (errno == EPERM || errno == EACCES) {
        emit_error("permission denied opening AF_PACKET socket — give "
                   "the helper binary CAP_NET_RAW: "
                   "sudo setcap cap_net_raw=eip <path-to-galaxy-discovery-helper>");
        return -1;
    }
    return 0;
}
#else
static int preflight(void) { return 0; }
#endif

#if !defined(_WIN32)
/* Skip interfaces that can't realistically carry ATDECC traffic. The
 * blocked-prefix list below is macOS-centric (utun = VPN tunnels,
 * awdl/llw = AirDrop, anpi = Apple Network Privacy, gif/stf = tunnels,
 * vmenet = Parallels/UTM, ap = AirPlay). Linux has equivalents
 * (docker0, veth*, br-*, wg*) that aren't filtered here — they fall
 * through and bind successfully but simply see no ATDECC frames, which
 * is harmless apart from a few extra file descriptors. */
static int is_candidate_iface(const char *name) {
    if (strcmp(name, "lo0") == 0 || strcmp(name, "lo") == 0) return 0;
    static const char *blocked[] = {
        "utun", "awdl", "llw", "anpi", "gif", "stf", "vmenet", "ap", NULL,
    };
    for (const char **p = blocked; *p; p++) {
        size_t L = strlen(*p);
        if (strncmp(name, *p, L) == 0) {
            const char *rest = name + L;
            int all_digits = (*rest != 0);
            for (; *rest; rest++) if (*rest < '0' || *rest > '9') { all_digits = 0; break; }
            if (all_digits) return 0;
        }
    }
    return 1;
}

static int enumerate_and_open(void) {
    struct ifaddrs *ifap, *p;
    if (getifaddrs(&ifap) < 0) { emit_error("getifaddrs: %s", strerror(errno)); return 0; }

    char seen[MAX_IFACES][MAX_IFACE_NAME]; int n_seen = 0;
    int hit_cap = 0;
    for (p = ifap; p; p = p->ifa_next) {
        if (n_seen >= MAX_IFACES) { hit_cap = 1; break; }
        const char *name = p->ifa_name;
        if (!name) continue;
        if (!(p->ifa_flags & IFF_UP)) continue;
        if (!is_candidate_iface(name)) continue;

        int dup = 0;
        for (int i = 0; i < n_seen; i++) if (strcmp(seen[i], name) == 0) { dup = 1; break; }
        if (dup) continue;

        uint8_t mac[6];
        if (get_iface_mac(name, mac) < 0) continue;
        int zero = 1; for (int i = 0; i < 6; i++) if (mac[i]) { zero = 0; break; }
        if (zero) continue;

        iface_t *iface = &IFACES[N_IFACES];
        memset(iface, 0, sizeof(*iface));
        strncpy(iface->name, name, MAX_IFACE_NAME - 1);
        memcpy(iface->src_mac, mac, 6);
        if (open_iface(iface) < 0) {
            char macs[18]; mac_to_str(mac, macs);
            emit_error("could not open %s (%s): %s — skipping",
                       name, macs, strerror(errno));
            continue;
        }
        strncpy(seen[n_seen++], name, MAX_IFACE_NAME);
        N_IFACES++;
    }
    freeifaddrs(ifap);
    if (hit_cap) {
        emit_error("hit MAX_IFACES (%d) — additional interfaces were "
                   "ignored. Increase MAX_IFACES in helper/src/main.c "
                   "if your host has more usable adapters than that.",
                   MAX_IFACES);
    }
    return N_IFACES;
}
#endif /* !_WIN32 */

#if defined(_WIN32)
static int enumerate_and_open(void) {
    pcap_if_t *alldevs = NULL;
    char errbuf[PCAP_ERRBUF_SIZE];
    if (pcap_findalldevs(&alldevs, errbuf) != 0 || !alldevs) {
        emit_error("pcap_findalldevs: %s (is Npcap installed?)",
                   errbuf[0] ? errbuf : "no devices");
        return 0;
    }

    int hit_cap = 0;
    for (pcap_if_t *d = alldevs; d; d = d->next) {
        if (N_IFACES >= MAX_IFACES) { hit_cap = 1; break; }
        if (!d->name) continue;
        if (d->flags & PCAP_IF_LOOPBACK) continue;

        uint8_t mac[6];
        if (get_iface_mac(d->name, mac) < 0) continue;
        int zero = 1; for (int i = 0; i < 6; i++) if (mac[i]) { zero = 0; break; }
        if (zero) continue;

        iface_t *iface = &IFACES[N_IFACES];
        memset(iface, 0, sizeof(*iface));
        strncpy(iface->name, d->name, MAX_IFACE_NAME - 1);
        memcpy(iface->src_mac, mac, 6);
        iface->fd = -1;
        if (open_iface(iface) < 0) continue;
        N_IFACES++;
    }
    pcap_freealldevs(alldevs);
    if (hit_cap) {
        emit_error("hit MAX_IFACES (%d) — additional interfaces were "
                   "ignored. Increase MAX_IFACES in helper/src/main.c "
                   "if your host has more usable adapters than that.",
                   MAX_IFACES);
    }
    return N_IFACES;
}
#endif /* _WIN32 */

/* ---- stdin commands ------------------------------------------------ */

static void handle_stdin_command(char *line) {
    size_t n = strlen(line);
    while (n > 0 && (line[n-1] == '\n' || line[n-1] == '\r')) line[--n] = 0;
    if (n == 0) return;

    if (strcmp(line, "quit") == 0) { emit_event("quit", ""); exit(0); }

    if (strncmp(line, "discover", 8) == 0) {
        int sent = send_discover_on_all(0);
        emit_event("sent_discover", "\"entity_id\":\"0000000000000000\",\"ifaces\":%d", sent);
        return;
    }
    emit_error("unknown command: %s", line);
}

/* ---- main ---------------------------------------------------------- */

/* Discovery cadence — applied AFTER the initial discover at startup.
 *
 * On a busy LAN with many ATDECC controllers any single multicast
 * ENTITY_DISCOVER can be dropped by the switch. We compensate by:
 *
 *   1. Bursting BURST_COUNT discovers at startup, BURST_INTERVAL_MS apart.
 *   2. Re-sending one discover every REFRESH_INTERVAL_MS in steady state.
 *
 * Real Galaxys announce on their own every ~10s; this halves the worst-case
 * time-to-discovery and pulls back devices that got lost in a packet drop. */
#define BURST_COUNT             4
#define BURST_INTERVAL_MS       200
#define REFRESH_INTERVAL_MS     5000     /* poll every 5s so new Galaxys appear
                                            quickly without needing a restart  */

static uint64_t now_ms(void) {
#if defined(_WIN32)
    return (uint64_t)GetTickCount64();
#else
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000ULL + (uint64_t)(ts.tv_nsec / 1000000);
#endif
}

/* ---- stdin line buffering (shared) --------------------------------- */

static char  linebuf[256];
static size_t line_used = 0;

static void feed_stdin_bytes(const char *tmp, size_t n) {
    for (size_t i = 0; i < n; i++) {
        if (line_used < sizeof(linebuf) - 1) linebuf[line_used++] = tmp[i];
        if (tmp[i] == '\n') {
            linebuf[line_used] = 0;
            handle_stdin_command(linebuf);
            line_used = 0;
        }
    }
}

#if defined(_WIN32)
/* ---- Windows main loop (pcap + polled stdin) ----------------------- */

static int win_drain_iface(iface_t *iface) {
    struct pcap_pkthdr *hdr;
    const u_char *pkt;
    for (;;) {
        int rc = pcap_next_ex(iface->pcap, &hdr, &pkt);
        if (rc == 1) {
            handle_frame(iface->name, pkt, (size_t)hdr->caplen);
        } else if (rc == 0) {
            return 0;          /* non-blocking timeout — no more packets */
        } else {
            emit_error("pcap_next_ex(%s): %s — removing from listen set",
                       iface->name, pcap_geterr(iface->pcap));
            pcap_close(iface->pcap);
            iface->pcap = NULL;
            iface->dead = 1;
            return -1;
        }
    }
}

static int run_main_loop_win(int listen_only) {
    int discovers_sent = 0;
    uint64_t next_discover_at = listen_only ? UINT64_MAX : now_ms();

    HANDLE hstdin = GetStdHandle(STD_INPUT_HANDLE);
    DWORD  stdin_type = GetFileType(hstdin);
    char   tmp[256];

    for (;;) {
        uint64_t now = now_ms();
        if (!listen_only && now >= next_discover_at) {
            int sent = send_discover_on_all(0);
            discovers_sent++;
            emit_event("sent_discover",
                       "\"entity_id\":\"0000000000000000\",\"ifaces\":%d,\"n\":%d",
                       sent, discovers_sent);
            next_discover_at = now + (discovers_sent < BURST_COUNT
                                      ? BURST_INTERVAL_MS
                                      : REFRESH_INTERVAL_MS);
        }

        for (int i = 0; i < N_IFACES; i++) {
            if (IFACES[i].dead || !IFACES[i].pcap) continue;
            win_drain_iface(&IFACES[i]);
        }

        /* Companion spawns us with stdin as a pipe — handle that case. */
        if (stdin_type == FILE_TYPE_PIPE) {
            DWORD avail = 0;
            if (!PeekNamedPipe(hstdin, NULL, 0, NULL, &avail, NULL)) {
                if (GetLastError() == ERROR_BROKEN_PIPE) {
                    emit_event("stdin_closed", "");
                    return 0;
                }
            } else if (avail > 0) {
                DWORD n = 0;
                if (ReadFile(hstdin, tmp, (DWORD)sizeof(tmp), &n, NULL) && n > 0) {
                    feed_stdin_bytes(tmp, (size_t)n);
                } else if (GetLastError() == ERROR_BROKEN_PIPE) {
                    emit_event("stdin_closed", "");
                    return 0;
                }
            }
        }

        /* Sleep just enough that we don't burn CPU while still being
         * responsive to packets and stdin commands. */
        uint64_t wait_ms = (next_discover_at > now) ? (next_discover_at - now) : 0;
        if (wait_ms > 20) wait_ms = 20;
        Sleep((DWORD)wait_ms);
    }
}
#endif /* _WIN32 */

#if !defined(_WIN32)
/* ---- POSIX main loop (select() over BPF/AF_PACKET fds) ------------- */

static int run_main_loop_posix(int listen_only) {
    int discovers_sent = 0;
    uint64_t next_discover_at = listen_only ? UINT64_MAX : now_ms();

    size_t pktbuf_cap = 64 * 1024;
#  if defined(__APPLE__)
    for (int i = 0; i < N_IFACES; i++)
        if (IFACES[i].bpf_bufsize > pktbuf_cap) pktbuf_cap = IFACES[i].bpf_bufsize;
#  endif
    uint8_t *pktbuf = (uint8_t *)malloc(pktbuf_cap);
    if (!pktbuf) { emit_error("malloc(%zu) failed", pktbuf_cap); return 1; }

    for (;;) {
        uint64_t now = now_ms();
        if (!listen_only && now >= next_discover_at) {
            int sent = send_discover_on_all(0);
            discovers_sent++;
            emit_event("sent_discover",
                       "\"entity_id\":\"0000000000000000\",\"ifaces\":%d,\"n\":%d",
                       sent, discovers_sent);
            next_discover_at = now + (discovers_sent < BURST_COUNT
                                      ? BURST_INTERVAL_MS
                                      : REFRESH_INTERVAL_MS);
        }

        fd_set rfds; FD_ZERO(&rfds);
        int maxfd = STDIN_FILENO;
        for (int i = 0; i < N_IFACES; i++) {
            if (IFACES[i].dead || IFACES[i].fd < 0) continue;
            FD_SET(IFACES[i].fd, &rfds);
            if (IFACES[i].fd > maxfd) maxfd = IFACES[i].fd;
        }
        FD_SET(STDIN_FILENO, &rfds);

        uint64_t wait_ms = (next_discover_at > now) ? (next_discover_at - now) : 0;
        if (wait_ms > 30000) wait_ms = 30000;
        struct timeval tv = {
            .tv_sec  = (time_t)(wait_ms / 1000),
            .tv_usec = (suseconds_t)((wait_ms % 1000) * 1000),
        };

        int rc = select(maxfd + 1, &rfds, NULL, NULL, &tv);
        if (rc < 0) {
            if (errno == EINTR) continue;
            emit_error("select: %s", strerror(errno));
            break;
        }
        if (rc == 0) continue;

        for (int i = 0; i < N_IFACES; i++) {
            if (IFACES[i].dead || IFACES[i].fd < 0) continue;
            if (!FD_ISSET(IFACES[i].fd, &rfds)) continue;
            ssize_t n = read(IFACES[i].fd, pktbuf, pktbuf_cap);
            if (n > 0) {
#  if defined(__APPLE__)
                process_bpf_buffer(IFACES[i].name, pktbuf, (size_t)n);
#  elif defined(__linux__)
                handle_frame(IFACES[i].name, pktbuf, (size_t)n);
#  endif
            } else if (n < 0 && errno != EINTR && errno != EAGAIN) {
                /* ENXIO / ENODEV / EIO / EBADF all mean the interface or
                 * BPF descriptor is gone (USB unplug, VM stopped, Wi-Fi
                 * disabled). Close + flag so we don't spin forever. */
                emit_error("read(%s): %s — removing from listen set",
                           IFACES[i].name, strerror(errno));
                close(IFACES[i].fd);
                IFACES[i].fd = -1;
                IFACES[i].dead = 1;
            }
        }

        if (FD_ISSET(STDIN_FILENO, &rfds)) {
            char tmp[256];
            ssize_t n = read(STDIN_FILENO, tmp, sizeof(tmp));
            if (n <= 0) { emit_event("stdin_closed", ""); break; }
            feed_stdin_bytes(tmp, (size_t)n);
        }
    }

    free(pktbuf);
    return 0;
}
#endif /* !_WIN32 */

int main(int argc, char **argv) {
    int listen_only = 0;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--listen-only") == 0) listen_only = 1;
        else { fprintf(stderr, "Usage: %s [--listen-only]\n", argv[0]); return 2; }
    }
    setvbuf(stdout, NULL, _IOLBF, 0);

#if defined(_WIN32)
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        emit_error("WSAStartup failed");
        return 1;
    }
    /* Force stdin/stdout into binary mode so newline translation doesn't
     * desync our NDJSON or chunked stdin reads. */
    _setmode(_fileno(stdin),  _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif

    if (preflight() < 0) return 1;

    if (enumerate_and_open() == 0) {
        emit_error("no usable network interface — nothing to listen on");
        return 1;
    }

    fprintf(stdout, "{\"event\":\"ready\",\"interfaces\":[");
    for (int i = 0; i < N_IFACES; i++) {
        char macs[18]; mac_to_str(IFACES[i].src_mac, macs);
        fprintf(stdout, "%s{\"name\":\"%s\",\"src_mac\":\"%s\"}",
                i ? "," : "", IFACES[i].name, macs);
    }
#if defined(_WIN32)
    fprintf(stdout, "],\"pid\":%lu}\n", (unsigned long)GetCurrentProcessId());
#else
    fprintf(stdout, "],\"pid\":%d}\n", (int)getpid());
#endif
    fflush(stdout);

#if defined(_WIN32)
    int rc = run_main_loop_win(listen_only);
    for (int i = 0; i < N_IFACES; i++) if (IFACES[i].pcap) pcap_close(IFACES[i].pcap);
    WSACleanup();
    return rc;
#else
    int rc = run_main_loop_posix(listen_only);
    for (int i = 0; i < N_IFACES; i++) if (IFACES[i].fd >= 0) close(IFACES[i].fd);
    return rc;
#endif
}
