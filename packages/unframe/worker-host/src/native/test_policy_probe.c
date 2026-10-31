#define _DARWIN_C_SOURCE
#include <arpa/inet.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <unistd.h>

static int denied(int result) {
  return result < 0 && (errno == EPERM || errno == EACCES);
}

int main(int argc, char **argv) {
  alarm(5);
  if (argc < 2 || argc > 64 || (argc - 2) % 2)
    return 1;
  FILE *file = fopen(argv[1], "rb");
  if (!file || fseek(file, 0, SEEK_END))
    return 2;
  long size = ftell(file);
  if (size <= 0 || size > 256 * 1024 || fseek(file, 0, SEEK_SET))
    return 3;
  char *source = calloc((size_t)size + 1, 1);
  if (!source || fread(source, 1, (size_t)size, file) != (size_t)size ||
      fclose(file))
    return 4;
  void *library = dlopen("/usr/lib/libsandbox.1.dylib", RTLD_NOW | RTLD_LOCAL);
  int (*apply)(const char *, uint64_t, const char *const *, char **) =
      library ? dlsym(library, "sandbox_init_with_parameters") : NULL;
  char *error = NULL;
  if (!apply || apply(source, 0, (const char *const *)(argv + 2), &error)) {
    fprintf(stderr, "profile initialization failed: %s\n",
            error ? error : "unknown");
    return 5;
  }
  const char *home_file = getenv("UNFRAME_TEST_HOME_FILE");
  if (!home_file || !denied(open(home_file, O_RDONLY)) ||
      !denied(open(home_file, O_WRONLY | O_TRUNC)))
    return 11;
  const char *paths[] = {"/etc/passwd",
                         "/Library/Preferences/.GlobalPreferences.plist"};
  for (size_t i = 0; i < sizeof(paths) / sizeof(paths[0]); ++i) {
    if (!denied(open(paths[i], O_RDONLY)))
      return 6;
  }
  int root = open("/", O_RDONLY);
  if (root < 0 || !denied(openat(root, "etc/passwd", O_RDONLY)))
    return 7;
  close(root);
  int connection = socket(AF_INET, SOCK_STREAM, 0);
  if (connection < 0) {
    if (!denied(connection))
      return 8;
  } else {
    struct sockaddr_in address = {.sin_family = AF_INET, .sin_port = htons(9)};
    if (inet_pton(AF_INET, "127.0.0.1", &address.sin_addr) != 1 ||
        !denied(
            connect(connection, (struct sockaddr *)&address, sizeof(address))))
      return 9;
    close(connection);
  }
  char *shell[] = {"sh", "-c", "exit 97", NULL};
  char *environment[] = {NULL};
  if (!denied(execve("/bin/sh", shell, environment)))
    return 10;
  puts("compiled; host reads, home reads/writes, root dirfd, TCP and shell exec denied");
  return 0;
}
