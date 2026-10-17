#define UNFRAME_DARWIN_LAUNCHER_TEST
#define proc_pidinfo test_proc_pidinfo
#include "darwin-launcher.c"
#undef proc_pidinfo
#include <sys/resource.h>

static int enumeration_failure;

int test_proc_pidinfo(int pid, int flavor, uint64_t arg, void *buffer,
                      int buffer_size) {
  if (flavor == PROC_PIDLISTFDS &&
      (enumeration_failure == 1 || (enumeration_failure == 2 && buffer)))
    return 0;
  int (*actual)(int, int, uint64_t, void *, int) =
      dlsym(RTLD_DEFAULT, "proc_pidinfo");
  if (!actual)
    return 0;
  return actual(pid, flavor, arg, buffer, buffer_size);
}

int main(int argc, char **argv) {
  if (argc != 2)
    return 1;
  const char *test = argv[1];
  if (!strcmp(test, "handle-size-max")) {
    handle("1,r,2,3,8388608");
    return 0;
  }
  if (!strcmp(test, "handle-size-zero")) {
    handle("1,r,2,3,0");
    return 1;
  }
  if (!strcmp(test, "handle-size-overflow")) {
    handle("1,r,2,3,8388609");
    return 1;
  }
  if (!strcmp(test, "time-negative")) {
    signed_decimal("-9223372036854775808");
    return 0;
  }
  if (!strcmp(test, "time-overflow")) {
    signed_decimal("-9223372036854775809");
    return 1;
  }
  if (!strcmp(test, "time-negative-zero")) {
    signed_decimal("-0");
    return 1;
  }
  if (!strcmp(test, "fd-enumeration-size-zero") ||
      !strcmp(test, "fd-enumeration-result-zero")) {
    enumeration_failure = !strcmp(test, "fd-enumeration-size-zero") ? 1 : 2;
    const int keep[] = {0, 1, 2};
    close_except(keep, ARRAY_COUNT(keep));
    return 1;
  }
  if (!strcmp(test, "decimal-valid"))
    return decimal("123", 123) != 123 || decimal("0", 0) != 0 ||
           decimal("18446744073709551615", UINT64_MAX) != UINT64_MAX;
  if (!strcmp(test, "decimal-leading-zero")) {
    decimal("01", 100);
    return 1;
  }
  if (!strcmp(test, "decimal-overflow")) {
    decimal("18446744073709551616", UINT64_MAX);
    return 1;
  }
  if (!strcmp(test, "decimal-sign")) {
    decimal("-1", UINT64_MAX);
    return 1;
  }
  const struct {
    const char *name, *value;
    uint64_t maximum;
  } decimals[] = {{"decimal-empty", "", UINT64_MAX},
                  {"decimal-plus", "+1", UINT64_MAX},
                  {"decimal-whitespace", " 1", UINT64_MAX},
                  {"decimal-trailing", "1 ", UINT64_MAX},
                  {"decimal-above-limit", "124", 123},
                  {"decimal-hex", "0x10", UINT64_MAX}};
  for (size_t i = 0; i < ARRAY_COUNT(decimals); ++i)
    if (!strcmp(test, decimals[i].name)) {
      decimal(decimals[i].value, decimals[i].maximum);
      return 1;
    }
  if (!strcmp(test, "handle-empty")) {
    handle("1,,r,2,3,4");
    return 1;
  }
  if (!strcmp(test, "utf8")) {
    const uint8_t valid[][4] = {
        {0x01}, {0x7f}, {0xc2, 0x80}, {0xdf, 0xbf},
        {0xe0, 0xa0, 0x80}, {0xed, 0x9f, 0xbf}, {0xee, 0x80, 0x80},
        {0xef, 0xbf, 0xbf}, {0xf0, 0x90, 0x80, 0x80},
        {0xf0, 0x9f, 0x98, 0x80}, {0xf4, 0x8f, 0xbf, 0xbf}};
    const size_t valid_sizes[] = {1, 1, 2, 2, 3, 3, 3, 3, 4, 4, 4};
    const uint8_t invalid[][4] = {
        {0}, {0x61, 0, 0x62}, {0x80}, {0xc0, 0xaf}, {0xc1, 0xbf},
        {0xc2}, {0xc2, 0x7f}, {0xe0, 0x9f, 0xbf}, {0xed, 0xa0, 0x80},
        {0xed, 0xbf, 0xbf}, {0xe2, 0x82}, {0xf0, 0x8f, 0xbf, 0xbf},
        {0xf4, 0x90, 0x80, 0x80}, {0xf0, 0x9f, 0x98}, {0xf5, 0x80, 0x80, 0x80},
        {0xff}};
    const size_t invalid_sizes[] = {1, 3, 1, 2, 2, 1, 2, 3, 3, 3, 2, 4, 4, 3, 4, 1};
    for (size_t i = 0; i < ARRAY_COUNT(valid); ++i)
      if (!utf8(valid[i], valid_sizes[i]))
        return 1;
    for (size_t i = 0; i < ARRAY_COUNT(invalid); ++i)
      if (utf8(invalid[i], invalid_sizes[i]))
        return 1;
    return !utf8(valid[0], 0);
  }
  if (!strcmp(test, "varint-overlong")) {
    uint8_t bytes[] = {0x80, 0};
    Slice s = {bytes, sizeof(bytes), 0};
    integer(&s);
    return 1;
  }
  if (!strcmp(test, "varint-overflow")) {
    uint8_t bytes[] = {0xff, 0xff, 0xff, 0xff, 0x10};
    Slice s = {bytes, sizeof(bytes), 0};
    integer(&s);
    return 1;
  }
  if (!strcmp(test, "registry-trailing")) {
    Slice s = {allocate(MAX_REGISTRY), MAX_REGISTRY, 8};
    memcpy(s.data, "UNFDM004", 8);
    put32(&s, FIELDS);
    const char *fields[FIELDS] = {
        "0123456789abcdef0123456789abcdef",
        "worker",
        "123",
        "1:2",
        "/node",
        "/helper",
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "/chrome",
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "1",
        "2",
        "3",
        "4",
        "/scratch",
        "root",
        "renderer",
        "gpu",
        "network"};
    for (unsigned i = 0; i < FIELDS; ++i) {
      size_t n = strlen(fields[i]);
      put32(&s, (uint32_t)n);
      memcpy(s.data + s.offset, fields[i], n);
      s.offset += n;
    }
    s.size = s.offset + 1;
    s.offset = 0;
    decode_registry(s);
    return 1;
  }
  if (!strcmp(test, "close-high-fd")) {
    struct rlimit limit;
    if (getrlimit(RLIMIT_NOFILE, &limit))
      return 2;
    limit.rlim_cur = 20000;
    if (setrlimit(RLIMIT_NOFILE, &limit))
      return 2;
    int fd = open("/dev/null", O_RDONLY), high = fcntl(fd, F_DUPFD, 15000);
    if (fd < 0 || high < 0)
      return 2;
    const int keep[] = {0, 1, 2};
    close_except(keep, ARRAY_COUNT(keep));
    return fcntl(high, F_GETFD) != -1 || errno != EBADF;
  }
  Registry registry = {.directory = -1};
  registry.field[1] = "worker";
  registry.field[7] = "/chrome";
  registry.field[13] = "/scratch";
  if (!strcmp(test, "renderer-propagated") ||
      !strcmp(test, "child-color-invalid") ||
      !strcmp(test, "child-blink-invalid") ||
      !strcmp(test, "child-boolean-value")) {
    registry.field[1] = "browser";
    char *child[] = {"/helper",
                     "--type=renderer",
                     "--seatbelt-client=9",
                     "--mute-audio",
                     "--disable-back-forward-cache",
                     "--remote-debugging-pipe",
                     "--force-color-profile=srgb",
                     "--blink-settings=primaryHoverType=2,availableHoverTypes="
                     "2,primaryPointerType=4,availablePointerTypes=4",
                     NULL};
    if (!strcmp(test, "child-color-invalid"))
      child[6] = "--force-color-profile=display-p3";
    if (!strcmp(test, "child-blink-invalid"))
      child[7] = "--blink-settings=scriptEnabled=true";
    if (!strcmp(test, "child-boolean-value"))
      child[3] = "--mute-audio=true";
    Arguments a = arguments(8, child, &registry, "/helper");
    return !strcmp(test, "renderer-propagated") && a.role == RENDERER &&
                   a.pipe == 0
               ? 0
               : 1;
  }
  if (!strcmp(test, "network-muted")) {
    registry.field[1] = "browser";
    char *child[] = {"/helper",
                     "--type=utility",
                     "--utility-sub-type=network.mojom.NetworkService",
                     "--service-sandbox-type=none",
                     "--mute-audio",
                     NULL};
    Arguments a = arguments(5, child, &registry, "/helper");
    return a.role == NETWORK && a.pipe == 0 ? 0 : 1;
  }
  if (!strcmp(test, "upstream-duplicate") ||
      !strcmp(test, "upstream-triplicate")) {
    char *upstream[] = {"/helper",
                        "--dump-dom",
                        "about:blank",
                        "--disable-search-engine-choice-screen",
                        "--disable-search-engine-choice-screen",
                        "--disable-search-engine-choice-screen",
                        NULL};
    Arguments a = arguments(!strcmp(test, "upstream-duplicate") ? 5 : 6,
                            upstream, &registry, "/helper");
    return a.argc == 5 && !strcmp(test, "upstream-duplicate") ? 0 : 1;
  }
  char *args[] = {"/helper", "--headless", "--dump-dom", "about:blank", NULL};
  int n = 4;
  if (!strcmp(test, "root-valid")) {
    Arguments a = arguments(n, args, &registry, "/helper");
    return a.role != ROOT || a.argc != 5;
  }
  if (!strcmp(test, "duplicate"))
    args[1] = "--dump-dom";
  else if (!strcmp(test, "bypass"))
    args[1] = "--no-sandbox";
  else if (!strcmp(test, "separator"))
    args[1] = "--";
  else if (!strcmp(test, "worker-child"))
    args[1] = "--type=renderer";
  else if (!strcmp(test, "browser-root"))
    registry.field[1] = "browser";
  else if (!strcmp(test, "unknown-flag"))
    args[1] = "--unframe-unknown";
  else if (!strcmp(test, "url"))
    args[3] = "https://example.invalid/";
  else if (!strcmp(test, "user-data-escape"))
    args[1] = "--user-data-dir=/scratch/../escape";
  else if (!strcmp(test, "user-data-dotdot"))
    args[1] = "--user-data-dir=/scratch/..";
  else if (!strcmp(test, "user-data-slashes"))
    args[1] = "--user-data-dir=/scratch//data";
  else if (!strcmp(test, "network-ui") || !strcmp(test, "network-valid") ||
           !strcmp(test, "network-absent-type")) {
    registry.field[1] = "browser";
    char *network[] = {"/helper",
                       "--type=utility",
                       "--utility-sub-type=network.mojom.NetworkService",
                       "--service-sandbox-type=none",
                       "--shared-files",
                       NULL};
    if (!strcmp(test, "network-ui"))
      network[4] = "--message-loop-type-ui";
    if (!strcmp(test, "network-absent-type"))
      network[3] = "--lang=en-US";
    Arguments a = arguments(5, network, &registry, "/helper");
    return !strcmp(test, "network-valid") && a.role == NETWORK ? 0 : 1;
  } else
    return 2;
  arguments(n, args, &registry, "/helper");
  return 1;
}
