#!/bin/sh
# MongoDB authentication for AccBot.
#
#   sh mongo-auth.sh init-secret    create the mongodb-auth Secret: random
#                                   passwords for admin, backup and accbot, the
#                                   replica set keyfile, and the api's connection
#                                   string. Refuses if the Secret exists.
#   sh mongo-auth.sh create-users   create (or update) the three users in
#                                   mongodb-0 with the Secret's passwords
#   sh mongo-auth.sh check          log in as each user, then try an anonymous
#                                   read; prints e.g.
#                                   admin OK · backup OK · accbot OK · anonymous: denied
#
# No password ever reaches a command line or the output: values go from files
# in a private temporary directory into the Secret, and from the Secret into
# mongosh through standard input. Run it where kubectl reaches the cluster.
set -eu

NS=accounting-bot
SECRET=mongodb-auth
POD=mongodb-0

secret_value() { # key
  kubectl -n "$NS" get secret "$SECRET" -o "jsonpath={.data.$1}" | base64 -d
}

init_secret() {
  if kubectl -n "$NS" get secret "$SECRET" >/dev/null 2>&1; then
    echo "The $SECRET Secret already exists; leaving it as it is." >&2
    exit 1
  fi
  command -v openssl >/dev/null 2>&1 || { echo "openssl is needed" >&2; exit 1; }

  dir=$(umask 077; mktemp -d)
  # Remove the password files however the script ends, Ctrl-C included.
  trap 'rm -rf "$dir"' EXIT
  trap 'exit 130' INT TERM HUP
  (
    umask 077
    # Hex passwords: nothing to escape in a URI or in JavaScript.
    printf '%s' "$(openssl rand -hex 24)" > "$dir/adminPassword"
    printf '%s' "$(openssl rand -hex 24)" > "$dir/backupPassword"
    printf '%s' "$(openssl rand -hex 24)" > "$dir/accbotPassword"
    # The replica set's shared key: 6-1024 base64 characters (1008 here),
    # with every line break or other whitespace removed.
    openssl rand -base64 756 | tr -d '[:space:]' > "$dir/keyfile"
    printf 'mongodb://accbot:%s@mongodb-svc:27017/accbot?directConnection=true&authSource=admin' \
      "$(cat "$dir/accbotPassword")" > "$dir/apiUri"
  )
  # openssl failing inside $(…) or a pipe wouldn't stop the script: check what it made.
  for key in adminPassword backupPassword accbotPassword; do
    [ "$(wc -c < "$dir/$key")" -eq 48 ] || { echo "openssl didn't produce $key" >&2; exit 1; }
  done
  [ "$(wc -c < "$dir/keyfile")" -eq 1008 ] || { echo "openssl didn't produce the keyfile" >&2; exit 1; }
  kubectl -n "$NS" create secret generic "$SECRET" \
    --from-file=adminPassword="$dir/adminPassword" \
    --from-file=backupPassword="$dir/backupPassword" \
    --from-file=accbotPassword="$dir/accbotPassword" \
    --from-file=keyfile="$dir/keyfile" \
    --from-file=apiUri="$dir/apiUri" >/dev/null
  echo "Created the $SECRET Secret (admin, backup and accbot passwords, keyfile, apiUri)."
}

create_users() {
  # The passwords travel on stdin; inside the pod, sh reads them into the
  # environment of mongosh, whose script reads process.env. Runs without a
  # login whenever the server allows it (authentication not enforced), so it
  # can also repair users whose passwords no longer match the Secret; logs in
  # as the pod's admin (MONGO_ADMIN_*) only when the server requires it.
  # shellcheck disable=SC2016  # $1, $P… expand inside the pod, not here
  { secret_value adminPassword; echo; secret_value backupPassword; echo; secret_value accbotPassword; echo; } |
    kubectl -n "$NS" exec -i -c mongodb "$POD" -- sh -c '
      read -r PW_ADMIN; read -r PW_BACKUP; read -r PW_ACCBOT
      export PW_ADMIN PW_BACKUP PW_ACCBOT
      if mongosh --quiet --eval "db.getSiblingDB(\"admin\").getUsers()" >/dev/null 2>&1; then
        exec mongosh --quiet --eval "$1"
      fi
      if [ -n "${MONGO_ADMIN_PASSWORD:-}" ]; then
        exec mongosh --quiet -u "$MONGO_ADMIN_USERNAME" -p "$MONGO_ADMIN_PASSWORD" --authenticationDatabase admin --eval "$1"
      fi
      exec mongosh --quiet --eval "$1"
    ' _ '
      const a = db.getSiblingDB("admin");
      const users = [
        ["admin", process.env.PW_ADMIN, [{ role: "root", db: "admin" }]],
        ["backup", process.env.PW_BACKUP, [{ role: "backup", db: "admin" }, { role: "read", db: "accbot" }]],
        ["accbot", process.env.PW_ACCBOT, [{ role: "readWrite", db: "accbot" }]],
      ];
      for (const [name, pwd, roles] of users) {
        if (!pwd) throw new Error("no password for " + name);
        if (a.getUser(name)) { a.updateUser(name, { pwd: pwd, roles: roles }); print(name + ": updated"); }
        else { a.createUser({ user: name, pwd: pwd, roles: roles }); print(name + ": created"); }
      }
    '
}

check() {
  out=""
  for user in admin backup accbot; do
    # shellcheck disable=SC2016  # $1, $P expand inside the pod
    if { secret_value "${user}Password"; echo; } | kubectl -n "$NS" exec -i -c mongodb "$POD" -- sh -c '
      read -r P
      mongosh --quiet -u "$1" -p "$P" --authenticationDatabase admin \
        --eval "print(db.runCommand({ connectionStatus: 1 }).authInfo.authenticatedUsers.length)"
    ' _ "$user" 2>/dev/null | grep -q '^1$'; then
      out="$out$user OK · "
    else
      out="$out$user FAILED · "
    fi
  done
  anon=$(kubectl -n "$NS" exec -c mongodb "$POD" -- mongosh --quiet --eval '
    try { db.getSiblingDB("accbot").getCollectionNames(); print("allowed"); }
    catch (e) { print(e.codeName === "Unauthorized" ? "denied" : "error: " + e.message); }
  ' 2>/dev/null || echo "error: no answer")
  echo "${out}anonymous: $anon"
}

case "${1:-}" in
  init-secret) init_secret ;;
  create-users) create_users ;;
  check) check ;;
  *) echo "usage: $0 init-secret | create-users | check" >&2; exit 2 ;;
esac
