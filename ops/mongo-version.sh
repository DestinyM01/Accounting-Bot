#!/bin/sh
# MongoDB version and feature compatibility (FCV) for AccBot, for upgrades.
#
#   sh mongo-version.sh status        the version mongodb-0 runs, and its FCV
#   sh mongo-version.sh set-fcv X.Y   raise the FCV to X.Y; refuses unless
#                                     mongodb-0 runs version X.Y
#
# Upgrade one major version at a time: new image first, check the app, and
# only then raise the FCV. Run it where kubectl reaches the cluster.
set -eu

NS=accounting-bot
POD=mongodb-0

# The shell inside the image: mongosh from MongoDB 6.0 on, mongo before.
# (-c mongodb: the pod also has an init container.)
if kubectl -n "$NS" exec -c mongodb "$POD" -- sh -c 'command -v mongosh' >/dev/null 2>&1; then
  SHELL_BIN=mongosh
else
  SHELL_BIN=mongo
fi

# Runs JavaScript in mongodb-0's shell: without a login whenever the server
# allows it, otherwise as the pod's admin (MONGO_ADMIN_*, from MongoDB D3b on).
run() {
  # shellcheck disable=SC2016  # these expand inside the pod
  kubectl -n "$NS" exec -c mongodb "$POD" -- sh -c '
    if "$1" --quiet --eval "db.getSiblingDB(\"admin\").getUsers()" >/dev/null 2>&1; then
      exec "$1" --quiet --eval "$2"
    fi
    if [ -n "${MONGO_ADMIN_PASSWORD:-}" ]; then
      exec "$1" --quiet -u "$MONGO_ADMIN_USERNAME" -p "$MONGO_ADMIN_PASSWORD" --authenticationDatabase admin --eval "$2"
    fi
    exec "$1" --quiet --eval "$2"
  ' _ "$SHELL_BIN" "$1"
}

version() {
  run 'print(db.version())'
}

fcv() {
  run 'print(db.adminCommand({ getParameter: 1, featureCompatibilityVersion: 1 }).featureCompatibilityVersion.version)'
}

# rs0 primary | rs0 not-primary | uninitiated (started with --replSet, never
# initiated: nothing can be read or written) | standalone
replset() {
  run 'const h = db.hello(); print(h.setName ? h.setName + " " + (h.isWritablePrimary ? "primary" : "not-primary") : (h.isreplicaset ? "uninitiated" : "standalone"))'
}

status() {
  echo "version=$(version) fcv=$(fcv) rs=$(replset)"
}

set_fcv() {
  target=$1
  case "$target" in
    [0-9]*.[0-9]*) ;;
    *) echo "usage: $0 set-fcv X.Y (for example 5.0)" >&2; exit 2 ;;
  esac

  running=$(version)
  # 5.0.33 -> 5.0: the FCV can only be raised to the version that is running.
  if [ "${running%.*}" != "$target" ]; then
    echo "mongodb-0 runs $running, not $target: the FCV can only be set to the running version" >&2
    exit 1
  fi

  # 7.0 and later ask for an explicit confirm; earlier versions reject the field.
  if [ "${target%%.*}" -ge 7 ]; then confirm=', confirm: true'; else confirm=''; fi
  run "var r = db.adminCommand({ setFeatureCompatibilityVersion: \"$target\"$confirm }); printjson(r); if (!r.ok) quit(1);"
  status
}

case "${1:-}" in
  status) status ;;
  set-fcv)
    [ $# -eq 2 ] || { echo "usage: $0 set-fcv X.Y" >&2; exit 2; }
    set_fcv "$2"
    ;;
  *) echo "usage: $0 status | set-fcv X.Y" >&2; exit 2 ;;
esac
