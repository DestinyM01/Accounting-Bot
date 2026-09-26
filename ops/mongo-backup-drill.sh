#!/bin/sh
# MongoDB backup and restore drill for AccBot.
#
#   sh mongo-backup-drill.sh              back up mongodb-0 into the current
#                                         directory, then prove the backup restores
#   sh mongo-backup-drill.sh drill FILE   prove an existing backup restores
#                                         (FILE.counts must sit next to FILE)
#
# A backup is two files: accbot-<UTC time>.archive.gz (mongodump --gzip of every
# database) and accbot-<UTC time>.archive.gz.counts (each accbot collection's
# document count when it was taken). The drill restores the archive into a
# throwaway pod running the same image as mongodb-0, counts again, and prints
# MATCH only if every collection has the same count. The live database is only
# ever read. Run it where kubectl reaches the cluster.
set -eu

NS=accounting-bot
DRILL=mongo-drill
IMAGE=$(kubectl -n "$NS" get pod mongodb-0 -o jsonpath='{.spec.containers[0].image}')

# Each accbot collection and its document count, one per line, sorted.
COUNT_JS='var d = db.getSiblingDB("accbot"); d.getCollectionNames().sort().forEach(function (c) { print(c + " " + d.getCollection(c).countDocuments({})); })'

# The shell inside a pod's image: mongosh from MongoDB 6.0 on, mongo before.
shell_in() {
  if kubectl -n "$NS" exec "$1" -- sh -c 'command -v mongosh' >/dev/null 2>&1; then echo mongosh; else echo mongo; fi
}

counts() { # pod shell
  kubectl -n "$NS" exec "$1" -- "$2" --quiet --eval "$COUNT_JS"
}

drill() { # archive
  file=$1
  [ -s "$file" ] || { echo "No such backup: $file" >&2; exit 1; }
  [ -s "$file.counts" ] || { echo "Missing $file.counts (the counts taken with the backup)" >&2; exit 1; }

  trap 'kubectl -n "$NS" delete pod "$DRILL" --ignore-not-found --wait=false >/dev/null 2>&1 || true' EXIT
  kubectl -n "$NS" delete pod "$DRILL" --ignore-not-found --wait=true >/dev/null

  # On mongodb-0's node, which already has the image: pulling it fresh on
  # another node can take minutes.
  node=$(kubectl -n "$NS" get pod mongodb-0 -o jsonpath='{.spec.nodeName}')
  kubectl -n "$NS" run "$DRILL" --image="$IMAGE" --restart=Never --labels=app=mongo-drill \
    --overrides="{\"apiVersion\":\"v1\",\"spec\":{\"nodeSelector\":{\"kubernetes.io/hostname\":\"$node\"}}}" >/dev/null
  if ! kubectl -n "$NS" wait --for=condition=Ready "pod/$DRILL" --timeout=300s >/dev/null; then
    echo "The drill pod didn't start. What Kubernetes says about it:" >&2
    kubectl -n "$NS" get pod "$DRILL" -o wide >&2 || true
    kubectl -n "$NS" describe pod "$DRILL" 2>/dev/null | sed -n '/^Events:/,$p' >&2 || true
    exit 1
  fi

  sh_bin=$(shell_in "$DRILL")
  tries=0
  until kubectl -n "$NS" exec "$DRILL" -- "$sh_bin" --quiet --eval 'db.adminCommand({ ping: 1 }).ok' >/dev/null 2>&1; do
    tries=$((tries + 1))
    [ "$tries" -lt 60 ] || { echo "The drill pod's MongoDB never answered" >&2; exit 1; }
    sleep 2
  done

  kubectl -n "$NS" cp "$file" "$DRILL:/tmp/restore.archive.gz"
  kubectl -n "$NS" exec "$DRILL" -- mongorestore --quiet --archive=/tmp/restore.archive.gz --gzip
  counts "$DRILL" "$sh_bin" > "$file.restored"

  if diff "$file.counts" "$file.restored"; then
    rm -f "$file.restored"
    echo "MATCH: $file restores with the same count in every collection"
  else
    echo "MISMATCH: counts at backup time (<) vs after restore (>) are above" >&2
    exit 1
  fi
}

backup() {
  file="accbot-$(date -u +%Y%m%dT%H%MZ).archive.gz"
  sh_bin=$(shell_in mongodb-0)

  counts mongodb-0 "$sh_bin" > "$file.counts.before"
  kubectl -n "$NS" exec mongodb-0 -- mongodump --quiet --archive=/tmp/backup.archive.gz --gzip
  kubectl -n "$NS" cp mongodb-0:/tmp/backup.archive.gz "$file"
  kubectl -n "$NS" exec mongodb-0 -- rm -f /tmp/backup.archive.gz
  counts mongodb-0 "$sh_bin" > "$file.counts"

  # A write that lands during the dump makes the counts uncertain: start over.
  if ! diff "$file.counts.before" "$file.counts" >/dev/null; then
    rm -f "$file.counts.before"
    echo "Writes landed during the backup; run the script again." >&2
    exit 1
  fi
  rm -f "$file.counts.before"
  [ -s "$file" ] || { echo "The backup came out empty" >&2; exit 1; }
  echo "Backup: $file ($(wc -c < "$file") bytes), counts in $file.counts"

  drill "$file"
}

case "${1:-backup}" in
  backup) backup ;;
  drill)
    [ $# -eq 2 ] || { echo "usage: $0 drill FILE" >&2; exit 2; }
    drill "$2"
    ;;
  *) echo "usage: $0 [backup | drill FILE]" >&2; exit 2 ;;
esac
