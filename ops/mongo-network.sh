#!/bin/sh
# Who can reach MongoDB over the network, for AccBot. The NetworkPolicy
# "mongodb" (repo/k8s/mongodb-networkpolicy.yaml) lets only pods labelled
# app=accounting-api or app=mongodb-backup reach mongodb-0 on port 27017.
#
#   sh mongo-network.sh clients        who connects to mongodb-0: the
#                                      connections open now, and those
#                                      accepted as far back as mongod's log
#                                      goes (24 hours at most), each with
#                                      the pod or node behind its IP
#   sh mongo-network.sh check [NODE]   from a throwaway pod on mongodb-0's node
#                                      (or on NODE), try to reach mongodb-svc
#                                      unlabelled, then labelled like the
#                                      backup job; prints e.g.
#                                      unlabelled pod: blocked · pod labelled app=mongodb-backup: reachable (from k3scontrolnode)
#
# Before the policy exists both probes say reachable; with it, the unlabelled
# one says blocked. A probe that fails any other way (a name that doesn't
# resolve, say) says "error: ...", and check exits 1 on an error or whenever
# the labelled probe doesn't get through. kubectl exec and port-forward (these
# scripts, Compass) are not pod-network traffic, so the policy never affects
# them. Run it where kubectl reaches the cluster.
set -eu

NS=accounting-bot
POD=mongodb-0
PROBE=mongo-netcheck

# Each client IP with connections open to mongodb-0 and how many, one
# "IP COUNT" line each. $currentOp only runs on admin; allUsers needs the
# inprog privilege (root has it).
CLIENTS_JS='const seen = {}; db.getSiblingDB("admin").aggregate([{ $currentOp: { allUsers: true, idleConnections: true, idleSessions: false } }, { $match: { client: { $exists: true }, connectionId: { $exists: true } } }]).forEach(function (op) { const ip = op.client.replace(/:[0-9]+$/, ""); (seen[ip] = seen[ip] || {})[String(op.connectionId)] = true; }); Object.keys(seen).sort().forEach(function (ip) { print(ip + " " + Object.keys(seen[ip]).length); })'

# Runs JavaScript in mongodb-0's mongosh: without a login whenever the server
# allows it, otherwise as the pod's admin (MONGO_ADMIN_*). -c mongodb: the pod
# also has an init container.
run() {
  # shellcheck disable=SC2016  # these expand inside the pod
  kubectl -n "$NS" exec -c mongodb "$POD" -- sh -c '
    if mongosh --quiet --eval "db.getSiblingDB(\"admin\").getUsers()" >/dev/null 2>&1; then
      exec mongosh --quiet --eval "$1"
    fi
    if [ -n "${MONGO_ADMIN_PASSWORD:-}" ]; then
      exec mongosh --quiet -u "$MONGO_ADMIN_USERNAME" -p "$MONGO_ADMIN_PASSWORD" --authenticationDatabase admin --eval "$1"
    fi
    exec mongosh --quiet --eval "$1"
  ' _ "$1"
}

# Names what is behind an IP: mongodb-0 itself; a node, by its own address or
# by its pod network's gateway (the source of the kubelet's probes); else a
# pod, running ones first (a finished pod keeps its last IP). Reads $NODES
# ("address|gateway|name") and $PODS ("IP|namespace/name|app=label|phase").
who() { # ip
  if [ "$1" = 127.0.0.1 ]; then
    echo "local (inside $POD)"
    return
  fi
  w=$(printf '%s\n' "$NODES" | awk -F'|' -v ip="$1" '
    $1 == ip { print "node " $3 " (or a host-network pod on it)"; exit }
    $2 == ip { print "node " $3 " (from the node itself: kubelet probes)"; exit }')
  [ -n "$w" ] || w=$(printf '%s\n' "$PODS" | awk -F'|' -v ip="$1" '$1 == ip && $4 == "Running" { print $2 " " $3; exit }')
  [ -n "$w" ] || w=$(printf '%s\n' "$PODS" | awk -F'|' -v ip="$1" '$1 == ip { print $2 " " $3 " (" $4 ")"; exit }')
  echo "${w:-unknown}"
}

list() { # "IP COUNT" lines
  printf '%s\n' "$1" | while read -r ip count; do
    [ -n "$ip" ] || continue
    printf '%-15s  %5s  %s\n' "$ip" "$count" "$(who "$ip")"
  done
}

clients() {
  open=$(run "$CLIENTS_JS")

  # mongod logs "Connection accepted" (id 22943) with the client's address for
  # every connection, probes included, so this also shows clients that only
  # come now and then, like the nightly backup. kubectl only reads the log
  # since mongod's last start and the log file's last rotation (the probes
  # alone write several MB a day), so the header says where it really starts.
  log=$(mktemp)
  trap 'rm -f "$log"' EXIT
  trap 'exit 130' INT TERM HUP
  kubectl -n "$NS" logs "$POD" -c mongodb --since=24h > "$log"
  since=$(sed -n '1s/^{"t":{"\$date":"\([^"]*\)".*/\1/p' "$log")
  accepted=$(sed -n 's/.*"id":22943,.*"remote":"\([0-9.]*\):[0-9]*".*/\1/p' "$log" | sort | uniq -c | awk '{ print $2 " " $1 }')

  # A node's pod-network gateway is the first address of its pod CIDR. (One
  # InternalIP per node: this cluster is IPv4 only.)
  nodes=$(kubectl get nodes -o jsonpath='{range .items[*]}{.status.addresses[?(@.type=="InternalIP")].address}|{.spec.podCIDR}|{.metadata.name}{"\n"}{end}')
  NODES=$(printf '%s\n' "$nodes" | awk -F'|' 'NF { split($2, c, "/"); split(c[1], o, "."); print $1 "|" o[1] "." o[2] "." o[3] "." o[4] + 1 "|" $3 }')
  PODS=$(kubectl get pods -A -o jsonpath='{range .items[*]}{.status.podIP}|{.metadata.namespace}/{.metadata.name}|app={.metadata.labels.app}|{.status.phase}{"\n"}{end}')

  echo "Open now:"
  list "$open"
  echo
  echo "Accepted since ${since:-?} (mongod's log, 24 hours at most; each IP named by what holds it now):"
  list "$accepted"
}

# Waits for the probe pod; if it never starts, prints what Kubernetes says and fails.
wait_ready() {
  if ! kubectl -n "$NS" wait --for=condition=Ready "pod/$PROBE" --timeout=300s >/dev/null; then
    echo "The $PROBE pod didn't start. What Kubernetes says about it:" >&2
    kubectl -n "$NS" get pod "$PROBE" -o wide >&2 || true
    kubectl -n "$NS" describe pod "$PROBE" 2>/dev/null | sed -n '/^Events:/,$p' >&2 || true
    exit 1
  fi
}

# Asks mongodb-svc for hello (no login needed) from the probe pod, retrying
# for 30 s: kube-router takes a moment to apply a label change. Prints
# reachable if any attempt answers; blocked if the last one was refused (the
# policy rejects) or timed out; otherwise "error: " and mongosh's last line.
probe() {
  # shellcheck disable=SC2016  # these expand inside the pod
  result=$(kubectl -n "$NS" exec "$PROBE" -- sh -c '
    if ! getent hosts mongodb-svc >/dev/null; then echo "error: mongodb-svc does not resolve"; exit 0; fi
    uri="mongodb://mongodb-svc:27017/?directConnection=true&serverSelectionTimeoutMS=5000&connectTimeoutMS=5000"
    end=$(($(date +%s) + 30))
    while :; do
      out=$(mongosh "$uri" --quiet --eval "db.hello().ok" 2>&1)
      if printf "%s\n" "$out" | grep -qx 1; then echo reachable; exit 0; fi
      [ "$(date +%s)" -lt "$end" ] || break
      sleep 2
    done
    last=$(printf "%s\n" "$out" | grep -v "^[[:space:]]*\$" | tail -n 1)
    case "$last" in
      *ECONNREFUSED*|*"timed out"*|*ETIMEDOUT*) echo blocked ;;
      *) echo "error: ${last:-no output from mongosh}" ;;
    esac
  ' 2>/dev/null) || result="error: kubectl exec exited $?"
  echo "${result:-error: no answer from the probe pod}"
}

check() { # [node]
  node=$1
  [ -n "$node" ] || node=$(kubectl -n "$NS" get pod "$POD" -o jsonpath='{.spec.nodeName}')
  image=$(kubectl -n "$NS" get pod "$POD" -o jsonpath='{.spec.containers[0].image}')
  # With mongodb-0 not ready the Service has no endpoints, and every probe
  # would be refused whatever the policy says.
  ready=$(kubectl -n "$NS" get pod "$POD" -o jsonpath='{.status.containerStatuses[?(@.name=="mongodb")].ready}')
  if [ "$ready" != true ]; then
    echo "$POD isn't ready, so every probe would fail; check it first." >&2
    exit 1
  fi

  # Remove the probe pod however the script ends, Ctrl-C included.
  trap 'kubectl -n "$NS" delete pod "$PROBE" --ignore-not-found --wait=false >/dev/null 2>&1 || true' EXIT
  trap 'exit 130' INT TERM HUP
  kubectl -n "$NS" delete pod "$PROBE" --ignore-not-found --wait=true >/dev/null
  # mongodb-0's image, already on its node (and on the backup job's); the pod
  # only sleeps while the probes run from it (sleep, as the container's PID 1,
  # ignores SIGTERM, hence the 1 s grace period).
  kubectl -n "$NS" run "$PROBE" --image="$image" --restart=Never --labels=app=mongo-netcheck \
    --overrides="{\"apiVersion\":\"v1\",\"spec\":{\"nodeSelector\":{\"kubernetes.io/hostname\":\"$node\"},\"terminationGracePeriodSeconds\":1}}" \
    --command -- sleep 600 >/dev/null
  wait_ready

  unlabelled=$(probe)
  # The backup job's label, which the policy allows. No controller or Service
  # selects pods by it (Jobs track their pods by their own labels).
  kubectl -n "$NS" label pod "$PROBE" app=mongodb-backup --overwrite >/dev/null
  labelled=$(probe)
  echo "unlabelled pod: $unlabelled · pod labelled app=mongodb-backup: $labelled (from $node)"
  case "$unlabelled $labelled" in
    *error:*) exit 1 ;;
  esac
  # With or without the policy, the backup job's label must get through.
  if [ "$labelled" != reachable ]; then
    echo "The pod labelled app=mongodb-backup should always get through; something besides the policy is wrong." >&2
    exit 1
  fi
}

case "${1:-}" in
  clients) clients ;;
  check)
    [ $# -le 2 ] || { echo "usage: $0 check [NODE]" >&2; exit 2; }
    check "${2:-}"
    ;;
  *) echo "usage: $0 clients | check [NODE]" >&2; exit 2 ;;
esac
