#define _DARWIN_C_SOURCE
#include "darwin-policy-hashes.h"
#include <CommonCrypto/CommonDigest.h>
#include <CoreFoundation/CFString.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <libproc.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <poll.h>
#include <pwd.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/sysctl.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

/* XNU's code-signing status interface is exported by libSystem but its header
 * is not included in the public SDK. These values are the XNU ABI constants. */
extern int csops(pid_t, unsigned int, void *, size_t);
#define CS_OPS_STATUS 0
#define CS_OPS_ENTITLEMENTS_BLOB 7
#define CS_GET_TASK_ALLOW 0x00000004
#define CS_RESTRICT 0x00000800
#define CS_REQUIRE_LV 0x00002000
#define CS_RUNTIME 0x00010000
#define CS_DEBUGGED 0x10000000

#define MAX_BLOB (1024U * 1024U)
#define MAX_REGISTRY (1024U * 1024U)
#define MAX_SOURCE (256U * 1024U)
#define FIELDS 18
#define ARRAY_COUNT(a) (sizeof(a) / sizeof((a)[0]))
typedef struct {
  uint8_t *data;
  size_t size, offset;
} Slice;
typedef struct {
  char *key, *value;
} Parameter;
typedef struct {
  char *builtin;
  const uint8_t *data;
  size_t size;
} Profile;
typedef struct {
  pid_t pid;
  uint64_t sec, usec;
  char path[PROC_PIDPATHINFO_MAXSIZE];
} Identity;
typedef struct {
  char *field[FIELDS];
  int directory;
} Registry;
typedef struct {
  int role, oldfd, pipe;
  char **argv;
  int argc;
} Arguments;
enum { ROOT, RENDERER, GPU, NETWORK };
static void fail(const char *message) __attribute__((noreturn));
static void fail(const char *message) {
  fprintf(stderr, "unframe-darwin-opaque: %s\n", message);
  _exit(78);
}
static void *allocate(size_t n) {
  void *p = calloc(1, n);
  if (!p)
    fail("allocation");
  return p;
}
static char *copy(const char *s) {
  char *p = strdup(s);
  if (!p)
    fail("allocation");
  return p;
}
static int64_t now_ms(void) {
  struct timespec t;
  if (clock_gettime(CLOCK_MONOTONIC, &t))
    fail("clock");
  return (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}
static uint64_t decimal(const char *s, uint64_t maximum) {
  if (!*s || (s[0] == '0' && s[1]) || s[strspn(s, "0123456789")])
    fail("noncanonical number");
  errno = 0;
  uint64_t n = strtoull(s, NULL, 10);
  if (errno || n > maximum)
    fail("number range");
  return n;
}
static void signed_decimal(const char *value) {
  if (*value == '-') {
    if (!decimal(value + 1, (uint64_t)INT64_MAX + 1))
      fail("negative zero");
  } else
    (void)decimal(value, INT64_MAX);
}
static int transfer(int fd, uint8_t *p, size_t n, int writing,
                    int64_t deadline) {
  while (n) {
    int64_t remaining = deadline - now_ms();
    if (remaining <= 0)
      return -1;
    struct pollfd pollfd = {.fd = fd, .events = writing ? POLLOUT : POLLIN};
    int r = poll(&pollfd, 1, (int)remaining);
    if (r < 0 && errno == EINTR)
      continue;
    if (r <= 0 || (pollfd.revents & (POLLERR | POLLNVAL)))
      return -1;
    ssize_t count = writing ? write(fd, p, n) : read(fd, p, n);
    if (count < 0 && (errno == EINTR || errno == EAGAIN))
      continue;
    if (count <= 0)
      return -1;
    p += count;
    n -= (size_t)count;
  }
  return 0;
}
static int utf8(const uint8_t *p, size_t n) {
  if (n > LONG_MAX || memchr(p, 0, n))
    return 0;
  CFStringRef string = CFStringCreateWithBytes(
      kCFAllocatorDefault, p, (CFIndex)n, kCFStringEncodingUTF8, false);
  if (!string)
    return 0;
  CFRelease(string);
  return 1;
}
static uint32_t little32(Slice *s) {
  if (s->size - s->offset < 4)
    fail("truncated registry");
  uint8_t *p = s->data + s->offset;
  s->offset += 4;
  return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 |
         (uint32_t)p[3] << 24;
}
static uint64_t integer(Slice *s) {
  uint64_t n = 0;
  for (unsigned shift = 0; shift <= 28; shift += 7) {
    if (s->offset == s->size)
      fail("truncated varint");
    unsigned b = s->data[s->offset++];
    if (shift == 28 && (b & 0xf0))
      fail("varint overflow");
    n |= (uint64_t)(b & 127) << shift;
    if (!(b & 128)) {
      if (shift && !b)
        fail("noncanonical varint");
      return n;
    }
  }
  fail("overlong varint");
}
static Slice bytestring(Slice *s) {
  uint64_t n = integer(s);
  if (n > s->size - s->offset)
    fail("truncated string");
  Slice result = {s->data + s->offset, (size_t)n, 0};
  s->offset += (size_t)n;
  return result;
}
static char *text_string(Slice *s) {
  Slice b = bytestring(s);
  if (b.size > 4096 || !utf8(b.data, b.size))
    fail("invalid parameter string");
  char *p = allocate(b.size + 1);
  memcpy(p, b.data, b.size);
  return p;
}
static void encode_integer(Slice *s, uint64_t n) {
  do {
    if (s->offset == s->size)
      fail("encoding overflow");
    unsigned b = n & 127;
    n >>= 7;
    s->data[s->offset++] = (uint8_t)(b | (n ? 128 : 0));
  } while (n);
}
static void encode_bytes(Slice *s, const uint8_t *p, size_t n) {
  encode_integer(s, n);
  if (n > s->size - s->offset)
    fail("encoding overflow");
  memcpy(s->data + s->offset, p, n);
  s->offset += n;
}
static void put32(Slice *s, uint32_t n) {
  if (s->size - s->offset < 4)
    fail("registry encoding overflow");
  for (unsigned i = 0; i < 4; ++i)
    s->data[s->offset++] = (uint8_t)(n >> (i * 8));
}
static int same_stat(const struct stat *a, const struct stat *b) {
  return a->st_dev == b->st_dev && a->st_ino == b->st_ino &&
         a->st_size == b->st_size &&
         a->st_mtimespec.tv_sec == b->st_mtimespec.tv_sec &&
         a->st_mtimespec.tv_nsec == b->st_mtimespec.tv_nsec &&
         a->st_ctimespec.tv_sec == b->st_ctimespec.tv_sec &&
         a->st_ctimespec.tv_nsec == b->st_ctimespec.tv_nsec;
}
static Slice read_file(int fd, size_t maximum) {
  struct stat before, after;
  if (fstat(fd, &before) || !S_ISREG(before.st_mode) || before.st_size < 1 ||
      (uint64_t)before.st_size > maximum)
    fail("file shape");
  Slice result = {allocate((size_t)before.st_size + 1), (size_t)before.st_size,
                  0};
  if (transfer(fd, result.data, result.size, 0, now_ms() + 1500))
    fail("file read");
  uint8_t extra;
  if (read(fd, &extra, 1) != 0 || fstat(fd, &after) ||
      !same_stat(&before, &after))
    fail("file changed");
  return result;
}
static void hash_bytes(const uint8_t *p, size_t n, char output[65]) {
  unsigned char hash[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(p, (CC_LONG)n, hash);
  for (size_t i = 0; i < sizeof(hash); ++i)
    snprintf(output + 2 * i, 3, "%02x", hash[i]);
}
static void hash_file(const char *path, char output[65],
                      struct stat *metadata) {
  int fd = open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
  if (fd < 0)
    fail("binary open");
  struct stat after;
  if (fstat(fd, metadata) || !S_ISREG(metadata->st_mode))
    fail("binary shape");
  CC_SHA256_CTX context;
  CC_SHA256_Init(&context);
  uint8_t buffer[65536];
  ssize_t n;
  while ((n = read(fd, buffer, sizeof(buffer))) > 0)
    CC_SHA256_Update(&context, buffer, (CC_LONG)n);
  if (n < 0 || fstat(fd, &after) || !same_stat(metadata, &after))
    fail("binary changed");
  unsigned char digest[32];
  CC_SHA256_Final(digest, &context);
  close(fd);
  for (size_t i = 0; i < sizeof(digest); ++i)
    snprintf(output + 2 * i, 3, "%02x", digest[i]);
}
static Identity identity(pid_t pid) {
  struct proc_bsdinfo before, after;
  Identity result = {.pid = pid};
  if (pid <= 1 ||
      proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &before, sizeof(before)) !=
          sizeof(before) ||
      before.pbi_uid != getuid() ||
      proc_pidpath(pid, result.path, sizeof(result.path)) <= 0 ||
      proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &after, sizeof(after)) !=
          sizeof(after) ||
      before.pbi_start_tvsec != after.pbi_start_tvsec ||
      before.pbi_start_tvusec != after.pbi_start_tvusec ||
      after.pbi_uid != getuid())
    fail("process identity");
  result.sec = before.pbi_start_tvsec;
  result.usec = before.pbi_start_tvusec;
  return result;
}
static void birth(const Identity *i, char output[64]) {
  snprintf(output, 64, "%llu:%llu", (unsigned long long)i->sec,
           (unsigned long long)i->usec);
}
static char *self_path(void) {
  char path[PATH_MAX], resolved[PATH_MAX];
  uint32_t n = sizeof(path);
  if (_NSGetExecutablePath(path, &n) || !realpath(path, resolved))
    fail("helper path");
  return copy(resolved);
}
static void verify_signature(void) {
  uint32_t flags = 0;
  if (csops(getpid(), CS_OPS_STATUS, &flags, sizeof(flags)) ||
      (flags & (CS_RUNTIME | CS_REQUIRE_LV | CS_RESTRICT)) !=
          (CS_RUNTIME | CS_REQUIRE_LV | CS_RESTRICT) ||
      (flags & (CS_GET_TASK_ALLOW | CS_DEBUGGED)))
    fail("helper signature flags");
  uint8_t entitlements[4096] = {0};
  if (!csops(getpid(), CS_OPS_ENTITLEMENTS_BLOB, entitlements,
             sizeof(entitlements))) {
    for (size_t i = 0; i < sizeof(entitlements); ++i)
      if (entitlements[i])
        fail("helper entitlements");
  } else if (errno != ENOENT && errno != EINVAL)
    fail("helper entitlement inspection");
  for (uint32_t i = 0; i < _dyld_image_count(); ++i) {
    const char *image = _dyld_get_image_name(i);
    if (i && strncmp(image, "/usr/lib/", 9) &&
        strncmp(image, "/System/Library/", 16) &&
        strncmp(image, "/System/Cryptexes/OS/usr/lib/", 27))
      fail("non-system library");
  }
}
static int private_directory(int parent, const char *name, int exact) {
  int fd =
      openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  struct stat st;
  if (fd < 0 || fstat(fd, &st) || st.st_uid != getuid() ||
      (exact ? (st.st_mode & 0777) != 0700 : (st.st_mode & 0022) != 0))
    fail("registry directory");
  return fd;
}
static int subjects(void) {
  struct passwd *pw = getpwuid(getuid());
  if (!pw || pw->pw_dir[0] != '/')
    fail("passwd home");
  int fd = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (fd < 0)
    fail("root directory");
  char *home = copy(pw->pw_dir), *state = NULL,
       *part = strtok_r(home, "/", &state);
  while (part) {
    if (!strcmp(part, ".") || !strcmp(part, ".."))
      fail("home component");
    int next =
        openat(fd, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (next < 0)
      fail("home directory");
    close(fd);
    fd = next;
    part = strtok_r(NULL, "/", &state);
  }
  free(home);
  struct stat st;
  if (fstat(fd, &st) || st.st_uid != getuid() || (st.st_mode & 0022))
    fail("home permissions");
  const char *names[] = {".cache", "unframe", "darwin-opaque", "subjects"};
  for (size_t i = 0; i < ARRAY_COUNT(names); ++i) {
    int next = private_directory(fd, names[i], i != 0);
    close(fd);
    fd = next;
  }
  return fd;
}
static void registry_name(const Identity *i, char name[128]) {
  snprintf(name, 128, "%ld-%llu-%llu.bin", (long)i->pid,
           (unsigned long long)i->sec, (unsigned long long)i->usec);
}
static Registry decode_registry(Slice s) {
  Registry r = {.directory = -1};
  if (s.size > MAX_REGISTRY || s.size < 12 || memcmp(s.data, "UNFDM004", 8))
    fail("registry magic");
  s.offset = 8;
  if (little32(&s) != FIELDS)
    fail("registry field count");
  for (unsigned i = 0; i < FIELDS; ++i) {
    uint32_t n = little32(&s);
    if (n > (i >= 14 ? MAX_SOURCE : 4096) || n > s.size - s.offset ||
        !utf8(s.data + s.offset, n))
      fail("registry field");
    r.field[i] = allocate((size_t)n + 1);
    memcpy(r.field[i], s.data + s.offset, n);
    s.offset += n;
  }
  if (s.offset != s.size || strlen(r.field[0]) != 32 ||
      strspn(r.field[0], "0123456789abcdef") != 32 ||
      (strcmp(r.field[1], "worker") && strcmp(r.field[1], "browser")))
    fail("registry shape");
  for (unsigned i = 5; i <= 8; ++i)
    if (i == 6 || i == 8) {
      if (strlen(r.field[i]) != 64 ||
          strspn(r.field[i], "0123456789abcdef") != 64)
        fail("registry hash");
    }
  for (unsigned i = 9; i <= 12; ++i)
    (void)decimal(r.field[i], UINT64_MAX);
  return r;
}
static Registry authenticate(const Identity *parent, const char *self) {
  int dir = subjects();
  char name[128];
  registry_name(parent, name);
  int fd = openat(dir, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
  struct stat st;
  if (fd < 0 || fstat(fd, &st) || st.st_uid != getuid() ||
      (st.st_mode & 0777) != 0400 || !S_ISREG(st.st_mode) || st.st_nlink != 1)
    fail("registry permissions");
  Registry r = decode_registry(read_file(fd, MAX_REGISTRY));
  close(fd);
  r.directory = dir;
  char expected_birth[64], hash[65];
  birth(parent, expected_birth);
  if (decimal(r.field[2], INT_MAX) != (uint64_t)parent->pid ||
      strcmp(r.field[3], expected_birth) || strcmp(r.field[4], parent->path) ||
      strcmp(r.field[5], self))
    fail("registry identity");
  struct stat metadata;
  hash_file(self, hash, &metadata);
  if (strcmp(hash, r.field[6]))
    fail("helper hash");
  hash_file(r.field[7], hash, &metadata);
  uint64_t mtime = (uint64_t)metadata.st_mtimespec.tv_sec * 1000000000 +
                   metadata.st_mtimespec.tv_nsec;
  if (strcmp(hash, r.field[8]) ||
      decimal(r.field[9], UINT64_MAX) != (uint64_t)metadata.st_dev ||
      decimal(r.field[10], UINT64_MAX) != metadata.st_ino ||
      decimal(r.field[11], UINT64_MAX) != (uint64_t)metadata.st_size ||
      decimal(r.field[12], UINT64_MAX) != mtime)
    fail("Chromium identity");
  if (!strcmp(r.field[1], "browser") && strcmp(parent->path, r.field[7]))
    fail("browser executable");
  Identity again = identity(parent->pid);
  if (again.sec != parent->sec || again.usec != parent->usec ||
      strcmp(again.path, parent->path) || getppid() != parent->pid)
    fail("parent changed");
  return r;
}
static void browser_registry(Registry *r) {
  Identity self = identity(getpid());
  char pid[32], born[64], name[128];
  snprintf(pid, sizeof(pid), "%ld", (long)getpid());
  birth(&self, born);
  registry_name(&self, name);
  r->field[1] = "browser";
  r->field[2] = pid;
  r->field[3] = born;
  r->field[4] = r->field[7];
  Slice out = {allocate(MAX_REGISTRY), MAX_REGISTRY, 8};
  memcpy(out.data, "UNFDM004", 8);
  put32(&out, FIELDS);
  for (unsigned i = 0; i < FIELDS; ++i) {
    size_t n = strlen(r->field[i]);
    put32(&out, (uint32_t)n);
    if (n > out.size - out.offset)
      fail("registry size");
    memcpy(out.data + out.offset, r->field[i], n);
    out.offset += n;
  }
  int fd = openat(r->directory, name,
                  O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0400);
  if (fd < 0 || transfer(fd, out.data, out.offset, 1, now_ms() + 1500) ||
      fsync(fd) || close(fd) || fsync(r->directory))
    fail("browser registry write");
  r->field[2] = copy(pid);
  r->field[3] = copy(born);
}

static int listed(const char *s, const char *const *list, size_t count) {
  for (size_t i = 0; i < count; ++i)
    if (!strcmp(s, list[i]))
      return 1;
  return 0;
}
static int under(const char *path, const char *root) {
  size_t n = strlen(root);
  return !strncmp(path, root, n) && (path[n] == '/' || !path[n]);
}
static int canonical_path(const char *path) {
  if (*path != '/' || !path[1])
    return 0;
  const char *component = path + 1;
  for (const char *p = component;; ++p) {
    if (*p && *p != '/')
      continue;
    size_t n = (size_t)(p - component);
    if (!n || (n == 1 && component[0] == '.') ||
        (n == 2 && component[0] == '.' && component[1] == '.'))
      return 0;
    if (!*p)
      return 1;
    component = p + 1;
  }
}
static void handle(const char *s) {
  if (!*s || s[0] == ',' || s[strlen(s) - 1] == ',' || strstr(s, ",,"))
    fail("handle empty component");
  char *value = copy(s), *state = NULL;
  unsigned i = 0;
  for (char *p = strtok_r(value, ",", &state); p;
       p = strtok_r(NULL, ",", &state), ++i) {
    if (i == 1) {
      if (strcmp(p, "r"))
        fail("handle access");
    } else {
      if (i > 4)
        fail("handle shape");
      uint64_t number = decimal(p, i == 4 ? 8U * 1024U * 1024U : UINT64_MAX);
      if (i == 4 && !number)
        fail("shared memory size");
    }
  }
  free(value);
  if (i != 5)
    fail("handle shape");
}
static void disabled_features(const char *v) {
  static const char *const features[] = {
      "AvoidUnnecessaryBeforeUnloadCheckSync",
      "BoundaryEventDispatchTracksNodeRemoval",
      "DestroyProfileOnBrowserClose",
      "DialMediaRouteProvider",
      "GlobalMediaControls",
      "HttpsUpgrades",
      "LensOverlay",
      "MediaRouter",
      "PaintHolding",
      "ThirdPartyStoragePartitioning",
      "BlockOriginHeaderModificationOnRedirect",
      "Translate",
      "AutoDeElevate",
      "OptimizationHints",
      "msForceBrowserSignIn",
      "msEdgeUpdateLaunchServicesPreferredVersion"};
  if (!v || !*v || *v == ',' || v[strlen(v) - 1] == ',' || strstr(v, ",,"))
    fail("feature value");
  char *s = copy(v), *state = NULL;
  const char *seen[ARRAY_COUNT(features)];
  size_t count = 0;
  for (char *p = strtok_r(s, ",", &state); p; p = strtok_r(NULL, ",", &state)) {
    if (!listed(p, features, ARRAY_COUNT(features)) || listed(p, seen, count))
      fail("unsupported or duplicate feature");
    seen[count++] = p;
  }
  free(s);
}
static Arguments arguments(int argc, char **argv, const Registry *r,
                           const char *self) {
  if (argc < 2 || argc > 256)
    fail("argument count");
  Arguments a = {.role = ROOT,
                 .oldfd = -1,
                 .argv = allocate(((size_t)argc + 4) * sizeof(char *)),
                 .argc = 1};
  a.argv[0] = r->field[7];
  const char *type = NULL, *subtype = NULL, *service = NULL;
  char *names[256];
  int count = 0, about = 0, dump = 0, search_choice = 0;
  for (int i = 1; i < argc; ++i) {
    if (strlen(argv[i]) > 8192)
      fail("argument length");
    if (!strcmp(argv[i], "about:blank")) {
      if (about++)
        fail("duplicate URL");
      continue;
    }
    if (strncmp(argv[i], "--", 2) || !argv[i][2])
      fail("argument form");
    char *name = copy(argv[i] + 2), *eq = strchr(name, '=');
    if (eq)
      *eq++ = 0;
    for (int j = 0; j < count; ++j)
      if (!strcmp(names[j], name) &&
          (strcmp(name, "disable-search-engine-choice-screen") || eq ||
           search_choice != 1))
        fail("duplicate switch");
    if (!strcmp(name, "disable-search-engine-choice-screen"))
      ++search_choice;
    names[count++] = name;
    if (!strcmp(name, "type")) {
      if (!eq)
        fail("role value");
      type = eq;
    }
    if (!strcmp(name, "utility-sub-type"))
      subtype = eq;
    if (!strcmp(name, "service-sandbox-type"))
      service = eq;
  }
  if (type) {
    if (!strcmp(type, "renderer"))
      a.role = RENDERER;
    else if (!strcmp(type, "gpu-process"))
      a.role = GPU;
    else if (!strcmp(type, "utility") && subtype &&
             !strcmp(subtype, "network.mojom.NetworkService") && service &&
             !strcmp(service, "none"))
      a.role = NETWORK;
    else
      fail("unsupported child role");
  }
  if ((a.role == ROOT) != !strcmp(r->field[1], "worker"))
    fail("registry role routing");
  if (search_choice > 1 && a.role != ROOT)
    fail("duplicate child switch");
  static const char *const root_boolean[] = {
      "disable-edgeupdater",
      "disable-updater-scheduler",
      "edge-skip-compat-layer-relaunch",
      "disable-infobars",
      "enable-unsafe-swiftshader",
      "disable-gpu",
      "disable-field-trial-config",
      "disable-background-networking",
      "disable-background-timer-throttling",
      "disable-backgrounding-occluded-windows",
      "disable-back-forward-cache",
      "disable-breakpad",
      "disable-client-side-phishing-detection",
      "disable-component-extensions-with-background-pages",
      "disable-component-update",
      "disable-default-apps",
      "disable-dev-shm-usage",
      "disable-extensions",
      "disable-hang-monitor",
      "disable-ipc-flooding-protection",
      "disable-popup-blocking",
      "disable-prompt-on-repost",
      "disable-renderer-backgrounding",
      "disable-search-engine-choice-screen",
      "disable-sync",
      "no-default-browser-check",
      "no-first-run",
      "no-service-autorun",
      "no-startup-window",
      "allow-pre-commit-input",
      "enable-automation",
      "export-tagged-pdf",
      "unsafely-disable-devtools-self-xss-warnings",
      "headless",
      "hide-scrollbars",
      "mute-audio",
      "metrics-recording-only",
      "use-mock-keychain",
      "dump-dom",
      "remote-debugging-pipe"};
  static const char *const child_boolean[] = {
      "mute-audio",
      "disable-back-forward-cache",
      "remote-debugging-pipe",
      "enable-zero-copy",
      "enable-gpu-memory-buffer-compositor-resources",
      "enable-automation",
      "disable-breakpad",
      "disable-dev-shm-usage",
      "disable-background-timer-throttling",
      "disable-renderer-backgrounding",
      "allow-pre-commit-input",
      "enable-main-frame-before-activation",
      "disable-gpu-compositing",
      "no-first-run",
      "enable-unsafe-swiftshader",
      "enable-low-end-device-mode",
      "disable-backgrounding-occluded-windows"};
  int emitted_search_choice = 0;
  for (int i = 1; i < argc; ++i) {
    if (!strcmp(argv[i], "about:blank"))
      continue;
    char *name = copy(argv[i] + 2), *v = strchr(name, '=');
    if (v)
      *v++ = 0;
    int accepted = 0;
    if (a.role == ROOT) {
      if (listed(name, root_boolean, ARRAY_COUNT(root_boolean))) {
        if (v)
          fail("boolean switch value");
        accepted = 1;
        if (!strcmp(name, "dump-dom"))
          dump = 1;
        if (!strcmp(name, "remote-debugging-pipe"))
          a.pipe = 1;
      } else if (!strcmp(name, "user-data-dir")) {
        if (!v || !canonical_path(v) || !under(v, r->field[13]))
          fail("user data directory");
        accepted = 1;
      } else if (!strcmp(name, "force-color-profile"))
        accepted = v && !strcmp(v, "srgb");
      else if (!strcmp(name, "password-store"))
        accepted = v && !strcmp(v, "basic");
      else if (!strcmp(name, "blink-settings"))
        accepted =
            v && !strcmp(v, "primaryHoverType=2,availableHoverTypes=2,"
                            "primaryPointerType=4,availablePointerTypes=4");
      else if (!strcmp(name, "enable-features"))
        accepted = v && !strcmp(v, "CDPScreenshotNewSurface");
      else if (!strcmp(name, "disable-features")) {
        disabled_features(v);
        accepted = 1;
      }
    } else {
      if (listed(name, child_boolean, ARRAY_COUNT(child_boolean))) {
        if (v)
          fail("boolean switch value");
        accepted = 1;
      } else if (!strcmp(name, "type"))
        accepted = v != NULL;
      else if (!strcmp(name, "utility-sub-type"))
        accepted = a.role == NETWORK && v &&
                   !strcmp(v, "network.mojom.NetworkService");
      else if (!strcmp(name, "service-sandbox-type"))
        accepted = a.role == NETWORK && v && !strcmp(v, "none");
      else if (!strcmp(name, "seatbelt-client")) {
        if (a.role == NETWORK || !v)
          fail("unexpected policy descriptor");
        uint64_t n = decimal(v, INT_MAX);
        if (n < 3)
          fail("policy descriptor range");
        a.oldfd = (int)n;
        accepted = 1;
      } else if (!strcmp(name, "lang"))
        accepted = v && !strcmp(v, "en-US");
      else if (!strcmp(name, "force-color-profile"))
        accepted = v && !strcmp(v, "srgb");
      else if (!strcmp(name, "blink-settings"))
        accepted =
            v && !strcmp(v, "primaryHoverType=2,availableHoverTypes=2,"
                            "primaryPointerType=4,availablePointerTypes=4");
      else if (!strcmp(name, "headless"))
        accepted = !v || !strcmp(v, "old");
      else if (!strcmp(name, "use-angle"))
        accepted = v && !strcmp(v, "swiftshader-webgl");
      else if (!strcmp(name, "use-gl"))
        accepted = v && !strcmp(v, "angle");
      else if (!strcmp(name, "shared-files")) {
        if (v && *v)
          fail("unsupported shared descriptors");
        accepted = 1;
      } else if (!strcmp(name, "variations-seed-version"))
        accepted = !v || !*v;
      else if (!strcmp(name, "field-trial-handle") ||
               !strcmp(name, "pseudonymization-salt-handle")) {
        if (!v)
          fail("handle missing");
        handle(v);
        accepted = 1;
      } else if (!strcmp(name, "trace-process-track-uuid") ||
                 !strcmp(name, "renderer-client-id") ||
                 !strcmp(name, "num-raster-threads") ||
                 !strcmp(name, "launch-time-ticks")) {
        if (!v)
          fail("number missing");
        (void)decimal(v, UINT64_MAX);
        accepted = 1;
      } else if (!strcmp(name, "time-ticks-at-unix-epoch")) {
        if (!v)
          fail("time ticks missing");
        signed_decimal(v);
        accepted = 1;
      } else if (!strcmp(name, "gpu-preferences")) {
        if (!v || strlen(v) > 4096 ||
            strspn(v, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123"
                      "456789+/=") != strlen(v))
          fail("GPU preferences");
        accepted = a.role == GPU;
      } else if (!strcmp(name, "disable-features")) {
        disabled_features(v);
        accepted = 1;
      } else if (!strcmp(name, "enable-features"))
        accepted = v && !strcmp(v, "CDPScreenshotNewSurface");
    }
    if (!accepted) {
      fprintf(stderr, "unframe-darwin-opaque: rejected switch %s\n", name);
      fprintf(stderr, "unframe-darwin-opaque: switch names:");
      for (int j = 0; j < count; ++j)
        fprintf(stderr, " %s", names[j]);
      fputc('\n', stderr);
      fail("unsupported switch");
    }
    /* Playwright 1.62.1 emits this cosmetic boolean twice. Canonicalize only
     * that exact upstream duplicate; security-relevant duplicates are rejected.
     */
    int skip_duplicate = !strcmp(name, "disable-search-engine-choice-screen") &&
                         emitted_search_choice++;
    if (strcmp(name, "seatbelt-client") && !skip_duplicate)
      a.argv[a.argc++] = copy(argv[i]);
    free(name);
  }
  if (a.role == ROOT) {
    if (dump != about || (dump && a.pipe) || (!dump && !a.pipe))
      fail("root launch shape");
    char *subprocess = allocate(strlen(self) + 32);
    sprintf(subprocess, "--browser-subprocess-path=%s", self);
    a.argv[a.argc++] = subprocess;
    if (about)
      a.argv[a.argc++] = "about:blank";
  } else if (about || (a.role != NETWORK && a.oldfd < 0))
    fail("child launch shape");
  return a;
}

static void close_except(const int *keep, size_t count) {
  int size = proc_pidinfo(getpid(), PROC_PIDLISTFDS, 0, NULL, 0);
  if (size <= 0 || size > 32 * 1024 * 1024)
    fail("descriptor enumeration size");
  size += 64 * (int)sizeof(struct proc_fdinfo);
  struct proc_fdinfo *fds = allocate((size_t)size);
  int used = proc_pidinfo(getpid(), PROC_PIDLISTFDS, 0, fds, size);
  if (used <= 0 || used >= size || used % sizeof(*fds))
    fail("descriptor enumeration");
  for (size_t i = 0; i < (size_t)used / sizeof(*fds); ++i) {
    int retained = 0;
    for (size_t j = 0; j < count; ++j)
      if (fds[i].proc_fd == keep[j])
        retained = 1;
    if (!retained && close(fds[i].proc_fd) && errno != EBADF)
      fail("descriptor close");
  }
  free(fds);
}
static void debug_pipe(int fd, int writing) {
  struct stat st;
  int flags = fcntl(fd, F_GETFL);
  if (fstat(fd, &st) || flags < 0 ||
      (writing ? (flags & O_ACCMODE) == O_RDONLY
               : (flags & O_ACCMODE) == O_WRONLY))
    fail("debug descriptor access");
  if (S_ISFIFO(st.st_mode))
    return;
  if (S_ISSOCK(st.st_mode)) {
    int type;
    socklen_t length = sizeof(type);
    struct sockaddr_storage address;
    socklen_t address_length = sizeof(address);
    if (!getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &length) &&
        type == SOCK_STREAM &&
        !getsockname(fd, (struct sockaddr *)&address, &address_length) &&
        address.ss_family == AF_UNIX)
      return;
  }
  fail("debug descriptor kind");
}
static Slice receive_policy(int fd) {
  struct stat st;
  int flags = fcntl(fd, F_GETFL);
  if (fstat(fd, &st) || !S_ISFIFO(st.st_mode) || flags < 0 ||
      (flags & O_ACCMODE) != O_RDONLY || fcntl(fd, F_SETFL, flags | O_NONBLOCK))
    fail("policy descriptor");
  int64_t deadline = now_ms() + 2000;
  uint8_t header[8];
  if (transfer(fd, header, sizeof(header), 0, deadline))
    fail("policy frame header");
  uint64_t size = 0;
  for (unsigned i = 0; i < 8; ++i)
    size |= (uint64_t)header[i] << (i * 8);
  if (!size || size > MAX_BLOB)
    fail("policy frame size");
  Slice result = {allocate((size_t)size), (size_t)size, 0};
  if (transfer(fd, result.data, result.size, 0, deadline))
    fail("policy frame read");
  struct pollfd eof = {.fd = fd, .events = POLLIN};
  uint8_t extra;
  int64_t remaining = deadline - now_ms();
  if (remaining <= 0 || poll(&eof, 1, (int)remaining) <= 0 ||
      read(fd, &extra, 1) != 0)
    fail("policy frame EOF");
  close(fd);
  return result;
}
static Slice canonical(const char *self, int role) {
  char *prefix = copy(self), *slash = strrchr(prefix, '/');
  if (!slash)
    fail("resource prefix");
  *slash = 0;
  slash = strrchr(prefix, '/');
  if (!slash)
    fail("resource prefix");
  *slash = 0;
  const char *names[] = {"common", "renderer", "gpu", "network"};
  const char *hashes[] = {
      UNFRAME_CHROMIUM_COMMON_SHA256, UNFRAME_CHROMIUM_RENDERER_SHA256,
      UNFRAME_CHROMIUM_GPU_SHA256, UNFRAME_CHROMIUM_NETWORK_SHA256};
  Slice parts[2];
  for (unsigned i = 0; i < 2; ++i) {
    unsigned index = i ? (unsigned)role : 0;
    char path[PATH_MAX];
    if (snprintf(path, sizeof(path), "%s/share/unframe-darwin-opaque/%s.sb",
                 prefix, names[index]) >= (int)sizeof(path))
      fail("resource path size");
    int fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0)
      fail("canonical source open");
    parts[i] = read_file(fd, MAX_SOURCE);
    close(fd);
    char hash[65];
    hash_bytes(parts[i].data, parts[i].size, hash);
    if (strcmp(hash, hashes[index]) || !utf8(parts[i].data, parts[i].size))
      fail("canonical source hash");
  }
  Slice result = {allocate(parts[0].size + parts[1].size + 1),
                  parts[0].size + parts[1].size, 0};
  memcpy(result.data, parts[0].data, parts[0].size);
  memcpy(result.data + parts[0].size, parts[1].data, parts[1].size);
  free(parts[0].data);
  free(parts[1].data);
  free(prefix);
  return result;
}
static const char *common_keys[] = {"BROWSER_PID",
                                    "BUNDLE_ID",
                                    "BUNDLE_PATH",
                                    "DISABLE_SANDBOX_DENIAL_LOGGING",
                                    "ENABLE_DISTRIBUTED_NOTIFICATIONS",
                                    "ENABLE_LOGGING",
                                    "EXECUTABLE_PATH",
                                    "LOG_FILE_PATH",
                                    "OS_VERSION",
                                    "USER_HOMEDIR_AS_LITERAL"};
static const char *gpu_keys[] = {"BROWSER_PID",
                                 "BUNDLE_ID",
                                 "BUNDLE_PATH",
                                 "DARWIN_USER_CACHE_DIR",
                                 "DARWIN_USER_DIR",
                                 "DARWIN_USER_TEMP_DIR",
                                 "DISABLE_METAL_SHADER_CACHE",
                                 "DISABLE_SANDBOX_DENIAL_LOGGING",
                                 "ENABLE_DISTRIBUTED_NOTIFICATIONS",
                                 "ENABLE_LOGGING",
                                 "EXECUTABLE_PATH",
                                 "LOG_FILE_PATH",
                                 "ODME_USER_DIR_ACCESS",
                                 "OS_VERSION",
                                 "USER_HOMEDIR_AS_LITERAL"};
static const char *network_keys[] = {"BROWSER_PID",
                                     "BUNDLE_ID",
                                     "BUNDLE_PATH",
                                     "DARWIN_USER_CACHE_DIR",
                                     "DARWIN_USER_DIR",
                                     "DARWIN_USER_TEMP_DIR",
                                     "DISABLE_SANDBOX_DENIAL_LOGGING",
                                     "ENABLE_DISTRIBUTED_NOTIFICATIONS",
                                     "ENABLE_LOGGING",
                                     "EXECUTABLE_PATH",
                                     "LOG_FILE_PATH",
                                     "NETWORK_SERVICE_STORAGE_PATHS_COUNT",
                                     "NETWORK_USER_DIR_ACCESS",
                                     "OS_VERSION",
                                     "USER_HOMEDIR_AS_LITERAL"};
static size_t expected_parameters(Parameter *params, int role,
                                  const Registry *r, const char *self) {
  const char **keys = role == GPU       ? gpu_keys
                      : role == NETWORK ? network_keys
                                        : common_keys;
  size_t count = role == RENDERER ? 10 : 15;
  char version[128];
  size_t version_size = sizeof(version);
  unsigned major, minor;
  if (sysctlbyname("kern.osproductversion", version, &version_size, NULL, 0) ||
      sscanf(version, "%u.%u", &major, &minor) != 2 || major > 999 ||
      minor > 99)
    fail("OS version");
  char os[32];
  snprintf(os, sizeof(os), "%u", major * 100 + minor);
  char *bundle = copy(r->field[7]), *slash = strrchr(bundle, '/');
  if (!slash)
    fail("bundle path");
  *slash = 0;
  for (size_t i = 0; i < count; ++i) {
    const char *key = keys[i];
    params[i].key = (char *)key;
    if (!strcmp(key, "BROWSER_PID"))
      params[i].value = r->field[2];
    else if (!strcmp(key, "BUNDLE_ID"))
      params[i].value = "org.chromium.Chromium";
    else if (!strcmp(key, "BUNDLE_PATH"))
      params[i].value = bundle;
    else if (!strcmp(key, "EXECUTABLE_PATH"))
      params[i].value = (char *)self;
    else if (!strcmp(key, "DISABLE_SANDBOX_DENIAL_LOGGING"))
      params[i].value = "TRUE";
    else if (!strcmp(key, "LOG_FILE_PATH"))
      params[i].value = "";
    else if (!strcmp(key, "OS_VERSION"))
      params[i].value = copy(os);
    else if (!strcmp(key, "USER_HOMEDIR_AS_LITERAL")) {
      struct passwd *pw = getpwuid(getuid());
      if (!pw || !pw->pw_dir || !canonical_path(pw->pw_dir))
        fail("OS user home");
      params[i].value = copy(pw->pw_dir);
    }
    else if (!strcmp(key, "NETWORK_SERVICE_STORAGE_PATHS_COUNT"))
      params[i].value = "0";
    else if (!strncmp(key, "DARWIN_USER_", 12)) {
      int name =
          !strcmp(key, "DARWIN_USER_CACHE_DIR")  ? _CS_DARWIN_USER_CACHE_DIR
          : !strcmp(key, "DARWIN_USER_TEMP_DIR") ? _CS_DARWIN_USER_TEMP_DIR
                                                 : _CS_DARWIN_USER_DIR;
      size_t length = confstr(name, NULL, 0);
      if (!length || length > PATH_MAX)
        fail("Darwin directory size");
      params[i].value = allocate(length);
      if (confstr(name, params[i].value, length) != length)
        fail("Darwin directory");
    } else
      params[i].value = "FALSE";
  }
  return count;
}
typedef struct {
  void *(*create)(void);
  int (*set)(void *, const char *, const char *);
  Profile *(*compile)(const char *, void *, char **);
  int (*apply)(Profile *);
  void (*free_profile)(Profile *);
  void (*free_params)(void *);
} Sandbox;
static Sandbox sandbox_api(void) {
  void *library = dlopen("/usr/lib/libsandbox.1.dylib", RTLD_NOW | RTLD_LOCAL);
  if (!library)
    fail("sandbox library");
  Sandbox s = {.create = dlsym(library, "sandbox_create_params"),
               .set = dlsym(library, "sandbox_set_param"),
               .compile = dlsym(library, "sandbox_compile_string"),
               .apply = dlsym(library, "sandbox_apply"),
               .free_profile = dlsym(library, "sandbox_free_profile"),
               .free_params = dlsym(library, "sandbox_free_params")};
  if (!s.create || !s.set || !s.compile || !s.apply || !s.free_profile ||
      !s.free_params)
    fail("sandbox symbols");
  return s;
}
static Profile *compile(Sandbox *api, const char *source, Parameter *parameters,
                        size_t count) {
  void *params = api->create();
  if (!params)
    fail("sandbox parameters");
  for (size_t i = 0; i < count; ++i)
    if (api->set(params, parameters[i].key, parameters[i].value))
      fail("sandbox parameter");
  char *error = NULL;
  Profile *profile = api->compile(source, params, &error);
  api->free_params(params);
  if (!profile || !profile->data || !profile->size ||
      profile->size > MAX_BLOB - 16)
    fail("sandbox compile");
  return profile;
}
static void authenticate_original(Sandbox *api, const char *self, Arguments *a,
                                  Registry *r, Parameter *params,
                                  size_t count) {
  if (a->role == NETWORK)
    return;
  Slice source = canonical(self, a->role), wire = receive_policy(a->oldfd);
  uint64_t mode = integer(&wire);
  if (mode != (uint64_t)(a->role == GPU ? 0 : 1))
    fail("original policy mode");
  Slice received = bytestring(&wire);
  if (a->role == GPU) {
    if (source.size != received.size ||
        memcmp(source.data, received.data, source.size))
      fail("original policy source");
    for (size_t i = 0; i < count; ++i) {
      char *key = text_string(&wire), *value = text_string(&wire);
      if (strcmp(key, params[i].key) || strcmp(value, params[i].value)) {
        fprintf(stderr, "unframe-darwin-opaque: parameter mismatch %s\n", key);
        fail("original parameters");
      }
      free(key);
      free(value);
    }
  } else {
    Profile *original = compile(api, (char *)source.data, params, count);
    if (original->size != received.size ||
        memcmp(original->data, received.data, received.size))
      fail("original compiled policy");
    api->free_profile(original);
  }
  if (wire.offset != wire.size)
    fail("original policy trailing bytes");
  free(source.data);
  free(wire.data);
  (void)r;
}
static void launch(Sandbox *api, Profile *policy, Arguments *a, Registry *r)
    __attribute__((noreturn));
static void launch(Sandbox *api, Profile *policy, Arguments *a, Registry *r) {
  if (a->pipe) {
    debug_pipe(3, 0);
    debug_pipe(4, 1);
  }
  Slice wire = {allocate(policy->size + 16), policy->size + 16, 0};
  encode_integer(&wire, 1);
  encode_bytes(&wire, policy->data, policy->size);
  int descriptors[2];
  if (pipe(descriptors))
    fail("policy pipe");
  int flags = fcntl(descriptors[1], F_GETFL);
  if (flags < 0 || fcntl(descriptors[1], F_SETFL, flags | O_NONBLOCK))
    fail("policy writer flags");
  char *fd_argument = allocate(64);
  snprintf(fd_argument, 64, "--seatbelt-client=%d", descriptors[0]);
  a->argv[a->argc++] = fd_argument;
  char *home = allocate(strlen(r->field[13]) + 6),
       *tmp = allocate(strlen(r->field[13]) + 8);
  sprintf(home, "HOME=%s", r->field[13]);
  sprintf(tmp, "TMPDIR=%s", r->field[13]);
  char *environment[] = {home, tmp, NULL};
  pid_t writer = fork();
  if (writer < 0)
    fail("policy writer fork");
  if (!writer) {
    alarm(2);
    signal(SIGPIPE, SIG_IGN);
    int keep[] = {STDERR_FILENO, descriptors[1]};
    close_except(keep, ARRAY_COUNT(keep));
    if (api->apply(policy))
      fail("writer policy apply");
    uint8_t header[8];
    for (unsigned i = 0; i < 8; ++i)
      header[i] = (uint8_t)((uint64_t)wire.offset >> (i * 8));
    int64_t deadline = now_ms() + 2000;
    int failed = transfer(descriptors[1], header, 8, 1, deadline) ||
                 transfer(descriptors[1], wire.data, wire.offset, 1, deadline);
    close(descriptors[1]);
    _exit(failed ? 78 : 0);
  }
  int keep[6] = {
      STDIN_FILENO, STDOUT_FILENO, STDERR_FILENO, descriptors[0], 3, 4};
  close_except(keep, a->pipe ? 6 : 4);
  // macOS 15 forbids sandbox reinitialization. The pinned headless entry point
  // CHECKs SeatbeltExecServer application before content startup for every role;
  // the worker receives capture input only after the ready barrier.
  alarm(0);
  execve(r->field[7], a->argv, environment);
  fail("Chromium exec");
}
static void json_string(const char *s) {
  putchar('"');
  for (const unsigned char *p = (const unsigned char *)s; *p; ++p) {
    if (*p == '"' || *p == '\\') {
      putchar('\\');
      putchar(*p);
    } else if (*p < 32)
      printf("\\u%04x", *p);
    else
      putchar(*p);
  }
  putchar('"');
}
#ifndef UNFRAME_DARWIN_LAUNCHER_TEST
int main(int argc, char **argv) {
  alarm(5);
  verify_signature();
  int (*sandbox_status)(pid_t, const char *, int, ...) =
      dlsym(RTLD_DEFAULT, "sandbox_check");
  if (!sandbox_status || sandbox_status(getpid(), NULL, 0) != 0)
    fail("helper bootstrap sandbox inherited");
  if (argc == 3 && !strcmp(argv[1], "--inspect")) {
    int (*check)(pid_t, const char *, int, ...) =
        dlsym(RTLD_DEFAULT, "sandbox_check");
    if (!check || check(getppid(), NULL, 0) != 0)
      fail("inspection caller sandbox");
    Identity i = identity((pid_t)decimal(argv[2], INT_MAX));
    char born[64];
    birth(&i, born);
    pid_t pgid = getpgid(i.pid);
    if (pgid <= 1)
      fail("inspection group");
    printf("{\"pid\":%ld,\"birth\":", (long)i.pid);
    json_string(born);
    printf(",\"executable\":");
    json_string(i.path);
    printf(",\"pgid\":%ld}\n", (long)pgid);
    return 0;
  }
  char *self = self_path();
  Identity parent = identity(getppid());
  Registry registry = authenticate(&parent, self);
  Arguments args = arguments(argc, argv, &registry, self);
  Sandbox api = sandbox_api();
  Parameter params[15];
  size_t count;
  if (args.role == ROOT) {
    browser_registry(&registry);
    params[0] = (Parameter){"UNFRAME_BROWSER_PID", registry.field[2]};
    count = 1;
  } else {
    count = expected_parameters(params, args.role, &registry, self);
    authenticate_original(&api, self, &args, &registry, params, count);
    for (size_t i = 0; i < count; ++i)
      if (!strcmp(params[i].key, "EXECUTABLE_PATH"))
        params[i].value = registry.field[7];
  }
  Profile *policy =
      compile(&api, registry.field[14 + args.role], params, count);
  launch(&api, policy, &args, &registry);
}
#endif
