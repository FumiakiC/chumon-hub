#!/usr/bin/env python3
"""chumon-hub fix/manifest-drift ①: 本番 k3s の実体を、秘匿値を共有用の出力に出さずに採取する。

使い方（本番ホストで実行。必ず python3 -I で実行する）:
  段階1（GET のみ）:
    python3 -I collect_live_state.py --context <context 名>
  段階1 + 段階2（kubectl diff。同じ実行の段階1で、比較対象の3オブジェクトに未確認・平文が無いときだけ動く）:
    python3 -I collect_live_state.py --context <context 名> --diff
  修正 PR の検証（マージ前。比較元を PR の head コミットにする）:
    python3 -I collect_live_state.py --context <context 名> --diff --sha <PR の head の完全なコミット SHA>

出力の規則:
  - 値を出すのは「repo の値と一致した値（公開済み）」「数値・真偽値・null」「既知の安全な値の表に一致した文字列」だけ。
    それ以外の文字列は <伏せた> とし、「未確認」として数える。未確認 0 は秘匿値が無いことの証明ではなく、
    「既知の安全な値以外は見つからなかった」ことを意味する。
  - フィールド管理情報（managedFields）は参考情報。伏せた項目は別に数え、段階2の停止判定には使わない。
  - 外部コマンドの stdout / stderr はすべてこのプログラムが受け取り、生のまま表示しない。
    失敗時は「操作名・終了コード・分類」だけを出して停止する。
  - 取得したオブジェクトや秘匿値を永続ファイルに保存しない。段階2で kubectl diff が内部で作る一時ファイルは
    tmpfs（/dev/shm）上の専用ディレクトリに置き、終了時に削除して、削除できたことを確かめる。
    swap が有効、または swap の状態を読めないときは、明示の許可が無い限り停止する。
    kubectl 自体の discovery キャッシュ（~/.kube/cache。API の型情報で、オブジェクトは含まない）は対象外。

確認しない範囲: 対象 namespace 以外のリソースの中身（名前の一覧のみ）、Cloudflare 側の設定、操作の履歴（監査ログ）。

終了コード（採取の完了と、受け入れ条件の充足を分けて表示する。0 はすべてを満たしたときだけ）:
  0 = 採取が完了し、全項目を満たした（段階2なら差分なし） / 1 = 段階2で差分あり /
  2 = 前提条件の不備 / 3 = 外部コマンドや後片付けの失敗 /
  10 = 採取は完了したが未完了の項目がある（未確認・平文・相違・必須 Secret の欠落・復旧用 digest の未確保など）
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from fractions import Fraction

REPO = "FumiakiC/chumon-hub"
DEFAULT_SHA = "1dabc2baa6d67070d1440854f27b807b61b9277d"  # main, 2026-10-10
SHM = "/dev/shm"

# (repo のファイル, kubectl の種類, 名前, namespace の引数名)
WORKLOADS = [
    ("deployment", "deploy", "chumon-hub", "app_ns"),
    ("service", "svc", "chumon-hub-service", "app_ns"),
    ("tunnel", "deploy", "cloudflared", "tunnel_ns"),
]
INVENTORY_KINDS = "deploy,sts,ds,svc,ingress,cm,secret,cronjob,job"


class Stop(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code
        self.msg = msg


# ---------- 外部コマンド（出力はすべて捕捉し、生のまま表示しない） ----------

def classify_stderr(raw):
    t = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
    rules = [
        ("NotFound", r"\(NotFound\)|not found"),
        ("Forbidden", r"\(Forbidden\)|forbidden"),
        ("Unauthorized", r"\(Unauthorized\)|Unauthorized|must be logged in"),
        ("context", r"context .* (does not exist|not found)|no context exists"),
        ("接続", r"connection refused|no such host|i/o timeout|dial tcp|TLS handshake|certificate"),
        ("パッチ計算", r"creating patch|applying patch|retrieving original configuration|serializing current"),
    ]
    for name, pat in rules:
        if re.search(pat, t, re.IGNORECASE):
            return name
    return "その他"


def run(op, argv, stdin=None, env=None, timeout=180, notfound_ok=False):
    try:
        p = subprocess.run(argv, input=stdin, capture_output=True, env=env, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise Stop(3, "%s: タイムアウト（%d 秒）" % (op, timeout))
    except OSError as e:
        raise Stop(3, "%s: 起動できない (%s)" % (op, type(e).__name__))
    if p.returncode != 0:
        cls = classify_stderr(p.stderr)
        if notfound_ok and cls == "NotFound":
            return None
        raise Stop(3, "%s: 失敗 exit=%d 分類=%s（エラー文は表示しない）" % (op, p.returncode, cls))
    return p.stdout


def parse_json(op, raw):
    try:
        return json.loads(raw)
    except Exception as e:
        raise Stop(3, "%s: JSON を解析できない (%s)" % (op, type(e).__name__))


# ---------- 値の分類 ----------

IDX = r"\[\d+\]"
CT = r"spec\.template\.spec\.(?:containers|initContainers)" + IDX
PROBE = CT + r"\.(?:startupProbe|livenessProbe|readinessProbe)"
K8S_NAME = r"[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?"
ENV_NAME = r"[A-Z_][A-Z0-9_]{0,63}"
QTY = r"[0-9]+(?:\.[0-9]+)?(?:m|k|Ki|M|Mi|G|Gi)?"
RFC3339 = r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})"
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
IMAGE = r"(?:ghcr\.io/fumiakic/chumon-hub|cloudflare/cloudflared)(?::[A-Za-z0-9._-]{1,128})?(?:@sha256:[0-9a-f]{64})?"

SAFE = [(re.compile(r"^(?:%s)$" % p), re.compile(r"^(?:%s)$" % v)) for p, v in [
    (r"kind", r"Deployment|ReplicaSet|Service"),
    (r"apiVersion", r"apps/v1|v1"),
    (r"metadata\.(?:name|namespace)", K8S_NAME),
    (r"metadata\.finalizers" + IDX, r"orphan|foregroundDeletion"),
    (r"metadata\.ownerReferences" + IDX + r"\.kind", r"Deployment|ReplicaSet"),
    (r"metadata\.ownerReferences" + IDX + r"\.apiVersion", r"apps/v1"),
    (r"metadata\.ownerReferences" + IDX + r"\.name", K8S_NAME),
    (r"metadata\.ownerReferences" + IDX + r"\.uid", UUID),
    (r"(?:metadata|spec\.template\.metadata)\.labels\.app", r"chumon-hub|cloudflared"),
    (r"spec\.selector(?:\.matchLabels)?\.app", r"chumon-hub|cloudflared"),
    (r"(?:metadata|spec\.template\.metadata)\.labels\.pod-template-hash", r"[a-z0-9]{1,16}"),
    (r"spec\.selector\.matchLabels\.pod-template-hash", r"[a-z0-9]{1,16}"),
    (r"metadata\.annotations\.deployment\.kubernetes\.io/(?:revision|desired-replicas|max-replicas)", r"\d{1,9}"),
    (r"metadata\.annotations\.deployment\.kubernetes\.io/revision-history", r"\d{1,9}(?:,\d{1,9})*"),
    (r"spec\.template\.metadata\.annotations\.kubectl\.kubernetes\.io/restartedAt", RFC3339),
    (r"spec\.strategy\.type", r"RollingUpdate|Recreate"),
    (r"spec\.strategy\.rollingUpdate\.(?:maxSurge|maxUnavailable)", r"\d{1,3}%"),
    (r"spec\.template\.spec\.restartPolicy", r"Always"),
    (r"spec\.template\.spec\.dnsPolicy", r"ClusterFirst|Default|ClusterFirstWithHostNet"),
    (r"spec\.template\.spec\.schedulerName", r"default-scheduler"),
    (r"spec\.template\.spec\.serviceAccount(?:Name)?", r"default"),
    (r"spec\.template\.spec\.imagePullSecrets" + IDX + r"\.name", r"ghcr-secret"),
    (CT + r"\.name", r"chumon-hub|cloudflared"),
    (CT + r"\.image", IMAGE),
    (CT + r"\.imagePullPolicy", r"Always|IfNotPresent|Never"),
    (CT + r"\.terminationMessagePath", r"/dev/termination-log"),
    (CT + r"\.terminationMessagePolicy", r"File|FallbackToLogsOnError"),
    (CT + r"\.ports" + IDX + r"\.protocol", r"TCP|UDP"),
    (CT + r"\.ports" + IDX + r"\.name", r"[a-z0-9-]{1,15}"),
    (CT + r"\.resources\.(?:limits|requests)\.(?:cpu|memory|ephemeral-storage)", QTY),
    (CT + r"\.env" + IDX + r"\.name", ENV_NAME),
    (CT + r"\.env" + IDX + r"\.valueFrom\.secretKeyRef\.name", r"chumon-hub-secret|tunnel-credentials"),
    (CT + r"\.env" + IDX + r"\.valueFrom\.secretKeyRef\.key", ENV_NAME),
    (CT + r"\.env" + IDX + r"\.valueFrom\.fieldRef\.fieldPath", r"metadata\.name|metadata\.namespace|status\.podIP|spec\.nodeName"),
    (CT + r"\.env" + IDX + r"\.valueFrom\.fieldRef\.apiVersion", r"v1"),
    (CT + r"\.(?:args|command)" + IDX, r"tunnel|--no-autoupdate|run"),
    (PROBE + r"\.httpGet\.path", r"/|/healthz"),
    (PROBE + r"\.httpGet\.scheme", r"HTTP|HTTPS"),
    (r"spec\.type", r"ClusterIP|NodePort|LoadBalancer"),
    (r"spec\.clusterIPs?(?:" + IDX + r")?", r"None|\d{1,3}(?:\.\d{1,3}){3}"),
    (r"spec\.ipFamilies" + IDX, r"IPv4|IPv6"),
    (r"spec\.ipFamilyPolicy", r"SingleStack|PreferDualStack|RequireDualStack"),
    (r"spec\.sessionAffinity", r"None|ClientIP"),
    (r"spec\.internalTrafficPolicy", r"Cluster|Local"),
    (r"spec\.ports" + IDX + r"\.name", r"[a-z0-9-]{1,15}"),
    (r"spec\.ports" + IDX + r"\.protocol", r"TCP|UDP"),
]]

ENV_VALUE = re.compile(r"^" + CT + r"\.env" + IDX + r"\.value$")
# 設定ではないメタデータだけを除外する（finalizers・ownerReferences は検査対象）
SKIP = re.compile(r"^(?:status|metadata\.(?:managedFields|uid|resourceVersion|selfLink|generation|creationTimestamp))(?:\.|\[|$)")
LAST_APPLIED = "metadata.annotations.kubectl.kubernetes.io/last-applied-configuration"
KEY_OK = re.compile(r"^[A-Za-z0-9_.\-/]{1,253}$")
NAME_RE = re.compile("^" + K8S_NAME + "$")


def flatten(node, path="", out=None):
    """リストは常に添字で表す（名前をパスに含めない）。辞書のキーは識別子として検査する。"""
    if out is None:
        out = {}
    if isinstance(node, dict):
        if not node and path:
            out[path] = {}
        for k, v in node.items():
            seg = k if KEY_OK.match(k) else "<キー>"
            flatten(v, "%s.%s" % (path, seg) if path else seg, out)
    elif isinstance(node, list):
        if not node and path:
            out[path] = []
        for i, v in enumerate(node):
            flatten(v, "%s[%d]" % (path, i), out)
    else:
        out[path] = node
    return out


QTY_PATH = re.compile("^" + CT + r"\.resources\.(?:limits|requests)\.[A-Za-z0-9.\-/]+$")
_QTY_SUFFIX = {"": 1, "n": Fraction(1, 10**9), "u": Fraction(1, 10**6), "m": Fraction(1, 1000),
               "k": 10**3, "M": 10**6, "G": 10**9, "T": 10**12, "P": 10**15, "E": 10**18,
               "Ki": 2**10, "Mi": 2**20, "Gi": 2**30, "Ti": 2**40, "Pi": 2**50, "Ei": 2**60}


def parse_quantity(v):
    """Kubernetes の数量表記（1000m / 1 / 512Mi / 1e3 など）を数値にする。解析できなければ None。"""
    m = re.match(r"^([+-]?[0-9]+(?:\.[0-9]*)?|[+-]?\.[0-9]+)(?:([eE][+-]?[0-9]+)|(n|u|m|k|M|G|T|P|E|Ki|Mi|Gi|Ti|Pi|Ei)?)$", v)
    if not m:
        return None
    n = Fraction(m.group(1))
    if m.group(2):
        return n * Fraction(10) ** int(m.group(2)[1:])
    return n * _QTY_SUFFIX[m.group(3) or ""]


def same_quantity(path, a, b):
    if not (QTY_PATH.match(path) and isinstance(a, str) and isinstance(b, str)):
        return False
    qa, qb = parse_quantity(a), parse_quantity(b)
    return qa is not None and qa == qb


def is_safe_string(path, value):
    return any(p.match(path) and v.match(value) for p, v in SAFE)


def show(v):
    return json.dumps(v, ensure_ascii=False)


class Tally:
    def __init__(self):
        self.unverified = []
        self.plaintext = []
        self.differs = []
        self.mf_hidden = []  # 管理情報の伏せた項目（参考。判定には使わない）
        self.history_differs = []  # last-applied 注釈（適用履歴）と repo の相違（参考。現在の設定の相違とは分ける）

    def merge(self, other):
        self.unverified += other.unverified
        self.plaintext += other.plaintext
        self.differs += other.differs
        self.mf_hidden += other.mf_hidden
        self.history_differs += other.history_differs


def classify_tree(label, live, repo, tally, prefix=""):
    """live を repo（無ければ None）と照合して表示する。"""
    lf = {p: v for p, v in flatten(live).items() if not SKIP.match(p)}
    rf = {p: v for p, v in flatten(repo).items() if not SKIP.match(p)} if repo is not None else {}
    # 注釈の中（適用履歴）の相違は、現在の設定の相違と分けて数える。秘匿の検査（未確認・平文）は同じ規則で行う
    differs = tally.history_differs if prefix.startswith("lastApplied:") else tally.differs
    for path, val in lf.items():
        shown = prefix + path
        if path == LAST_APPLIED:
            try:
                inner = json.loads(val)
            except Exception:
                tally.unverified.append("%s:%s（解析不能）" % (label, shown))
                print("  %s = <解析不能・伏せた>" % shown)
                continue
            print("  %s = <JSON。以下 lastApplied: として repo と照合>" % shown)
            classify_tree(label, inner, repo, tally, prefix="lastApplied:")
            continue
        in_repo = path in rf
        if ENV_VALUE.match(path):
            tally.plaintext.append("%s:%s" % (label, shown))
            print("  %s = <平文・伏せた>" % shown)
            continue
        if not isinstance(val, str):
            if not in_repo:
                print("  %s = %s  [live のみ]" % (shown, show(val)))
            elif rf[path] == val:
                print("  %s = %s" % (shown, show(val)))
            else:
                differs.append("%s:%s" % (label, shown))
                print("  %s = %s  [相違: repo=%s]" % (shown, show(val), show(rf[path])))
            continue
        if in_repo and rf[path] == val:
            print("  %s = %s" % (shown, show(val)))
        elif in_repo and is_safe_string(path, val) and same_quantity(path, val, rf[path]):
            # API サーバーが数量を正規化した表記（例: 1000m → 1）。値は同じなので相違に数えない
            print("  %s = %s  [repo と同値・API による表記の正規化: repo=%s]" % (shown, show(val), show(rf[path])))
        elif is_safe_string(path, val):
            if in_repo:
                differs.append("%s:%s" % (label, shown))
                print("  %s = %s  [相違: repo=%s]" % (shown, show(val), show(rf[path])))
            else:
                print("  %s = %s  [live のみ・既知の値]" % (shown, show(val)))
        else:
            tally.unverified.append("%s:%s" % (label, shown))
            if in_repo:
                differs.append("%s:%s" % (label, shown))
                print("  %s = <伏せた>  [未確認・相違: repo=%s]" % (shown, show(rf[path])))
            else:
                print("  %s = <伏せた>  [未確認・live のみ]" % shown)
    if repo is not None:
        for path, rv in rf.items():
            if path not in lf:
                differs.append("%s:%s" % (label, prefix + path))
                print("  %s  [repo のみ: %s]" % (prefix + path, show(rv)))


def classify_quiet(label, obj):
    """ReplicaSet 用: 全項目を同じ規則で検査し、問題のある項目のパスだけを返す。"""
    t = Tally()
    lf = {p: v for p, v in flatten(obj).items() if not SKIP.match(p)}
    for path, val in lf.items():
        if path == LAST_APPLIED:
            try:
                inner = classify_quiet(label + ":lastApplied", json.loads(val))
                t.merge(inner)
            except Exception:
                t.unverified.append("%s:%s（解析不能）" % (label, path))
            continue
        if ENV_VALUE.match(path):
            t.plaintext.append("%s:%s" % (label, path))
        elif isinstance(val, str) and not is_safe_string(path, val):
            t.unverified.append("%s:%s" % (label, path))
    return t


# ---------- managedFields（フィールド管理情報。監査履歴ではない。参考情報） ----------

KNOWN_MANAGERS = {
    "kubectl-client-side-apply", "kubectl-patch", "kubectl-edit", "kubectl-create", "kubectl-rollout",
    "kubectl", "kube-controller-manager", "k3s", "kubectl-set", "kubectl-annotate", "kubectl-label",
    "kubectl-scale", "kubectl-replace",
}
K_KEYS = {"name", "containerPort", "protocol", "port"}
K_VAL = re.compile(r"^[A-Za-z0-9_.\-]{1,63}$")
INTEREST = ("f:env", "f:args", "f:command", "f:image", "f:resources", "Probe", "f:annotations",
            "f:labels", "f:strategy", "f:imagePullSecrets", "f:data", "f:type", "f:ports", "f:finalizers")


def seg_mf(k):
    if k == ".":
        return "."
    if k.startswith("f:"):
        return k if KEY_OK.match(k[2:]) else "f:<伏せた>"
    if k.startswith("i:") and k[2:].isdigit():
        return k
    if k.startswith("k:"):
        try:
            d = json.loads(k[2:])
            if isinstance(d, dict) and set(d) <= K_KEYS and all(
                    isinstance(v, int) or (isinstance(v, str) and K_VAL.match(v)) for v in d.values()):
                return "k:" + json.dumps(d, separators=(",", ":"), sort_keys=True)
        except Exception:
            pass
        return "k:<伏せた>"
    return "<伏せた>"


def mf_paths(node, path=""):
    if not isinstance(node, dict) or not node:
        yield path or "."
        return
    for k, v in node.items():
        s = seg_mf(k)
        yield from mf_paths(v, "%s/%s" % (path, s) if path else s)


def print_managed(label, obj, only_interest, tally):
    mfs = obj.get("metadata", {}).get("managedFields") or []
    if not mfs:
        print("  -- フィールド管理情報: 無し（取得できていない可能性）")
        return
    print("  -- フィールド管理情報（参考。どの管理者がどのフィールドを持つか。操作の履歴ではない）")
    for mf in mfs:
        mgr = mf.get("manager")
        if mgr not in KNOWN_MANAGERS:
            tally.mf_hidden.append("%s:manager" % label)
            mgr = "<その他の管理者>"
        op = mf.get("operation") if mf.get("operation") in ("Update", "Apply") else "<?>"
        tm = mf.get("time") if isinstance(mf.get("time"), str) and re.match("^" + RFC3339 + "$", mf["time"]) else "<?>"
        sub = mf.get("subresource") if mf.get("subresource") in ("status", "scale") else "-"
        print("  manager=%s operation=%s time=%s subresource=%s" % (mgr, op, tm, sub))
        for p in mf_paths(mf.get("fieldsV1") or {}):
            if "<伏せた>" in p:
                tally.mf_hidden.append("%s:%s" % (label, p))
            if not only_interest or any(x in p for x in INTEREST):
                print("      %s" % p)


# ---------- 各セクション ----------

def kubectl(ctx, op, *args, **kw):
    return run(op, ["kubectl", "--context", ctx] + list(args), **kw)


def fetch_manifest(sha, fname):
    url = "https://raw.githubusercontent.com/%s/%s/k8s/%s.yaml" % (REPO, sha, fname)
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise Stop(3, "manifest %s: 取得失敗 HTTP %d" % (fname, e.code))
    except Exception as e:
        raise Stop(3, "manifest %s: 取得失敗 (%s)" % (fname, type(e).__name__))


def manifest_to_obj(ctx, fname, yaml_bytes):
    # PyYAML（cloud-init の依存で多くのホストに入っている）があれば使い、無ければ kubectl でクライアント側変換する
    try:
        import yaml
    except ImportError:
        yaml = None
    if yaml is not None:
        try:
            return yaml.safe_load(yaml_bytes)
        except Exception as e:
            raise Stop(3, "manifest %s: YAML を解析できない (%s)" % (fname, type(e).__name__))
    out = kubectl(ctx, "manifest %s の JSON 変換" % fname,
                  "create", "--dry-run=client", "--validate=false", "-o", "json", "-f", "-", stdin=yaml_bytes)
    return parse_json("manifest %s" % fname, out)


def required_secrets(repo_objs, nsmap):
    """repo のマニフェストが参照する Secret とキー。{(ns, name): {"keys": set, "pull": bool}}
    pull=True は imagePullSecrets として参照されるもの（型と所定のキーを検査する）。"""
    req = {}

    def ent(ns, name):
        return req.setdefault((ns, name), {"keys": set(), "pull": False})
    for fname, kind, name, nskey in WORKLOADS:
        ns = nsmap[nskey]
        spec = ((repo_objs[fname].get("spec") or {}).get("template") or {}).get("spec") or {}
        for ips in spec.get("imagePullSecrets") or []:
            ent(ns, ips.get("name"))["pull"] = True
        for c in (spec.get("containers") or []) + (spec.get("initContainers") or []):
            for e in c.get("env") or []:
                ref = (e.get("valueFrom") or {}).get("secretKeyRef")
                if ref:
                    ent(ns, ref.get("name"))["keys"].add(ref.get("key"))
            for ef in c.get("envFrom") or []:
                if ef.get("secretRef"):
                    ent(ns, ef["secretRef"].get("name"))
    return req


def section_inventory(ctx):
    print("### 全 namespace のリソース（種類/名前のみ。一覧表示の取得で、Secret の中身は取得しない）")
    out = kubectl(ctx, "inventory", "get", INVENTORY_KINDS, "-A", "--no-headers").decode("utf-8", "replace")
    pat_nm = re.compile(r"^[a-z0-9.\-]{1,63}/" + K8S_NAME + "$")
    for line in out.splitlines():
        cols = line.split()
        if len(cols) < 2:
            continue
        ns = cols[0] if NAME_RE.match(cols[0]) else "<伏せた>"
        nm = cols[1] if pat_nm.match(cols[1]) else "<伏せた>"
        print("  %-20s %s" % (ns, nm))
    print("### CRD（名前のみ）")
    out = kubectl(ctx, "crd", "get", "crd", "--no-headers").decode("utf-8", "replace")
    for line in out.splitlines():
        cols = line.split()
        if cols:
            print("  %s" % (cols[0] if re.match(r"^[a-z0-9.\-]{1,253}$", cols[0]) else "<伏せた>"))


def section_pods(ctx, ns):
    """復旧用 digest を確保できたか（Pod が1つ以上あり、すべての imageID が digest 形式）を返す。"""
    print("### 稼働中のイメージ digest（マニフェスト変更を本番に入れる前の復旧点）")
    doc = parse_json("pods", kubectl(ctx, "pods", "get", "pod", "-n", ns, "-l", "app=chumon-hub", "-o", "json"))
    pat = re.compile(r"^[A-Za-z0-9./:_\-]{1,200}@sha256:[0-9a-f]{64}$")
    n_ok, n_bad = 0, 0
    for o in doc.get("items", []):
        name = o["metadata"].get("name", "")
        name = name if NAME_RE.match(name) else "<伏せた>"
        for s in (o.get("status", {}).get("containerStatuses") or []):
            iid = s.get("imageID", "")
            if pat.match(iid):
                n_ok += 1
            else:
                n_bad += 1
            print("  %s imageID=%s restarts=%s ready=%s" % (
                name, iid if pat.match(iid) else "<伏せた>", show(s.get("restartCount")), show(s.get("ready"))))
    if n_ok == 0 and n_bad == 0:
        print("  （Pod が見つからない）")
    return n_ok > 0 and n_bad == 0


def section_workload(ctx, ns, kind, name, repo_obj, tally):
    label = "%s/%s/%s" % (kind, ns, name)
    print("## %s" % label)
    doc = parse_json(label, kubectl(ctx, label, "get", kind, name, "-n", ns, "-o", "json", "--show-managed-fields"))
    t = Tally()
    classify_tree(label, doc, repo_obj, t)
    print_managed(label, doc, True, t)
    print("  == 判定: 未確認 %d / 平文 %d / repo との相違 %d（参考: 適用履歴との相違 %d・管理情報の伏せた項目 %d）" % (
        len(t.unverified), len(t.plaintext), len(t.differs), len(t.history_differs), len(t.mf_hidden)))
    tally.merge(t)
    return doc


def section_replicasets(ctx, ns, owners, tally):
    """owners: {Deployment 名: 現在の UID}。ラベルに頼らず、ownerReferences の UID と controller で選別する。
    戻り値: 同名だが別 UID の Deployment を参照する ReplicaSet の件数。"""
    doc = parse_json("rs " + ns, kubectl(ctx, "rs " + ns, "get", "rs", "-n", ns, "-o", "json"))
    stale, others = 0, 0
    buckets = {o: [] for o in owners}
    stale_items = []
    for o in doc.get("items", []):
        refs = [r for r in (o["metadata"].get("ownerReferences") or []) if r.get("kind") == "Deployment"]
        hit = None
        for owner, uid in owners.items():
            if any(r.get("name") == owner and r.get("uid") == uid and r.get("controller") is True for r in refs):
                hit = owner
        if hit:
            buckets[hit].append(o)
        elif any(r.get("name") in owners for r in refs):
            stale_items.append(o)
        else:
            others += 1

    def report(o):
        name = o["metadata"].get("name", "")
        name = name if NAME_RE.match(name) else "<伏せた>"
        ann = o["metadata"].get("annotations") or {}
        rev = ann.get("deployment.kubernetes.io/revision", "")
        created = o["metadata"].get("creationTimestamp", "")
        imgs = [c.get("image", "") for c in (o.get("spec", {}).get("template", {}).get("spec", {}).get("containers") or [])]
        imgs = [i if re.match("^" + IMAGE + "$", i) else "<伏せた>" for i in imgs]
        t = classify_quiet("rs/" + name, o)
        print("  %s revision=%s replicas=%s created=%s images=%s 未確認=%d 平文=%d" % (
            name, rev if rev.isdigit() else "<?>", show(o.get("spec", {}).get("replicas")),
            created if re.match("^" + RFC3339 + "$", created or "") else "<?>", ",".join(imgs) or "-",
            len(t.unverified), len(t.plaintext)))
        for p in t.plaintext:
            print("      平文: %s" % p)
        for p in t.unverified:
            print("      未確認: %s" % p)
        tally.merge(t)

    for owner, items in buckets.items():
        print("## ReplicaSet（現在の Deployment/%s が controller として所有。旧版を含め全項目を検査）: %d 件" % (owner, len(items)))
        for o in items:
            report(o)
    if stale_items:
        print("## ReplicaSet（同名だが別 UID の Deployment を参照。旧 Deployment の残骸の可能性）: %d 件" % len(stale_items))
        for o in stale_items:
            report(o)
    print("  （namespace %s の他の ReplicaSet: %d 件。対象外）" % (ns, others))
    return len(stale_items)


def section_secrets(ctx, required):
    """repo が参照する Secret とキーの有無を確かめる。値は扱わない。戻り値: 欠落の一覧。"""
    print("### Secret（repo のマニフェストが参照するものだけ。キー名と管理情報のみ）")
    missing = []
    # imagePullSecrets 用の型と必須キー（k8s.io/api core/v1: SecretTypeDockerConfigJson / SecretTypeDockercfg）
    pull_types = {"kubernetes.io/dockerconfigjson": ".dockerconfigjson", "kubernetes.io/dockercfg": ".dockercfg"}
    for (ns, name), use in sorted(required.items(), key=lambda x: (x[0][0], str(x[0][1]))):
        keys = use["keys"]
        if not (isinstance(name, str) and NAME_RE.match(name)):
            missing.append("Secret 名が不正")
            continue
        label = "secret/%s/%s" % (ns, name)
        raw = kubectl(ctx, label, "get", "secret", name, "-n", ns, "-o", "json", "--show-managed-fields", notfound_ok=True)
        if raw is None:
            print("## %s: 存在しない" % label)
            missing.append(label)
            continue
        o = parse_json(label, raw)
        typ = o.get("type", "")
        typ = typ if typ in ("Opaque", "kubernetes.io/dockerconfigjson", "kubernetes.io/dockercfg", "kubernetes.io/tls") else "<その他>"
        have = set((o.get("data") or {}).keys())
        shown = sorted(k if re.match(r"^[A-Za-z0-9_.\-]{1,253}$", k) else "<キー>" for k in have)
        lack = sorted(k for k in keys if k not in have)
        print("## %s type=%s" % (label, typ))
        print("  data のキー: %s" % (", ".join(shown) or "（無し）"))
        if lack:
            print("  repo が参照するのに無いキー: %s" % ", ".join(lack))
            missing += ["%s:%s" % (label, k) for k in lack]
        else:
            print("  repo が参照するキー: すべてある（%d 件）" % len(keys))
        if use["pull"]:
            raw_type = o.get("type", "")
            need = pull_types.get(raw_type)
            if need is None:
                print("  imagePullSecrets 用: 型が不適合（%s。dockerconfigjson / dockercfg ではない）" % typ)
                missing.append("%s:imagePullSecrets 用の型ではない" % label)
            elif need not in have:
                print("  imagePullSecrets 用: 型は適合、必須キー %s が無い" % need)
                missing.append("%s:%s" % (label, need))
            else:
                print("  imagePullSecrets 用: 型と必須キー %s は適合（認証情報の有効性は検証しない）" % need)
        print_managed(label, o, False, Tally())
        del o
    return missing


def check_shm(accept_swap):
    try:
        mounts = open("/proc/mounts", encoding="utf-8").read().splitlines()
    except OSError:
        raise Stop(2, "/proc/mounts を読めない")
    if not any(len(l.split()) > 2 and l.split()[1] == SHM and l.split()[2] == "tmpfs" for l in mounts):
        raise Stop(2, "%s が tmpfs ではない（一時ファイルをメモリ上に置けない）" % SHM)
    try:
        swaps = [l for l in open("/proc/swaps", encoding="utf-8").read().splitlines()[1:] if l.strip()]
    except OSError:
        if not accept_swap:
            raise Stop(2, "swap の状態を読めない。承知のうえで続けるなら --accept-swap")
        swaps = []
    if swaps and not accept_swap:
        raise Stop(2, "swap が有効（%d 件）。tmpfs の内容が swap に書かれうる。承知のうえで続けるなら --accept-swap" % len(swaps))
    if not shutil.which("diff"):
        raise Stop(2, "diff コマンドが無い")


def remove_tmp(path):
    try:
        shutil.rmtree(path)
    except OSError:
        pass
    return not os.path.exists(path)


def with_private_tmp(body):
    """tmpfs 上の専用ディレクトリで body(tmp) を実行し、必ず削除して、削除できたことを確かめる。
    本体のエラーと後片付けのエラーは両方を報告する。"""
    tmp = tempfile.mkdtemp(prefix="chumon-drift.", dir=SHM)
    primary = None
    try:
        os.chmod(tmp, 0o700)
        return body(tmp)
    except BaseException as e:
        primary = e
        raise
    finally:
        if not remove_tmp(tmp):
            msg = "一時ディレクトリ %s を削除できなかった。手動で削除すること" % tmp
            if primary is not None:
                msg += "（本体のエラーも発生: %s）" % (primary.msg if isinstance(primary, Stop) else type(primary).__name__)
            raise Stop(3, msg)


def stage2(ctx, nsmap, manifests, accept_swap):
    check_shm(accept_swap)
    print("# 段階2: kubectl diff（差分のあるオブジェクトの識別子だけを出す。内容・エラー文は出さない）")

    def body(tmp):
        overall = 0
        env = dict(os.environ, TMPDIR=tmp, KUBECTL_EXTERNAL_DIFF="diff -rq")
        for fname, kind, name, nskey in WORKLOADS:
            ns = nsmap[nskey]
            try:
                p = subprocess.run(["kubectl", "--context", ctx, "diff", "-n", ns, "-f", "-"],
                                   input=manifests[fname], capture_output=True, env=env, timeout=180)
            except subprocess.TimeoutExpired:
                raise Stop(3, "diff %s: タイムアウト" % fname)
            if p.returncode not in (0, 1):
                raise Stop(3, "diff %s: 検査失敗 exit=%d 分類=%s（エラー文は表示しない）" % (
                    fname, p.returncode, classify_stderr(p.stderr)))
            ids, odd = set(), 0
            for line in p.stdout.decode("utf-8", "replace").splitlines():
                m = re.findall(r"(?:LIVE|MERGED)-[^/\s]+/([A-Za-z0-9._\-]+)", line)
                if m:
                    ids.update(m)
                elif line.strip():
                    odd += 1
            warn = " / kubectl の警告出力あり（内容は表示しない）" if p.stderr.strip() else ""
            if p.returncode == 0:
                print("  %s: 差分なし (exit=0)%s" % (fname, warn))
            else:
                overall = 1
                print("  %s: 差分あり (exit=1) 対象=%s%s%s" % (
                    fname, ",".join(sorted(ids)) or "<?>", " / 解析できない行 %d" % odd if odd else "", warn))
        return overall

    overall = with_private_tmp(body)
    print("  一時ディレクトリ: 削除を確認した")
    print("# 段階2 完了: %s" % ("差分なし" if overall == 0 else "差分あり"))
    return overall


def main():
    ap = argparse.ArgumentParser(description="chumon-hub 本番の実体を秘匿値なしで採取する")
    ap.add_argument("--context", required=True)
    ap.add_argument("--app-ns", default="default")
    ap.add_argument("--tunnel-ns", default="default")
    ap.add_argument("--sha", default=DEFAULT_SHA, help="比較元の repo コミット（完全な 40 桁）")
    ap.add_argument("--diff", action="store_true", help="段階2（kubectl diff）も行う")
    ap.add_argument("--accept-swap", action="store_true")
    a = ap.parse_args()

    if not re.match(r"^[0-9a-f]{40}$", a.sha):
        raise Stop(2, "--sha は完全な 40 桁のコミット SHA で指定する")
    for ns in (a.app_ns, a.tunnel_ns):
        if not NAME_RE.match(ns):
            raise Stop(2, "namespace の形式が不正")
    if not shutil.which("kubectl"):
        raise Stop(2, "kubectl が無い")
    ctxs = kubectl(a.context, "context 一覧", "config", "get-contexts", "-o", "name").decode().split()
    if a.context not in ctxs:
        raise Stop(2, "指定の context が kubeconfig に無い")
    nsmap = {"app_ns": a.app_ns, "tunnel_ns": a.tunnel_ns}

    print("# 段階1: 棚卸し（比較元 %s/%s、app ns=%s、tunnel ns=%s）" % (REPO, a.sha, a.app_ns, a.tunnel_ns))
    manifests, repo_objs = {}, {}
    for fname, kind, name, nskey in WORKLOADS:
        manifests[fname] = fetch_manifest(a.sha, fname)
        repo_objs[fname] = manifest_to_obj(a.context, fname, manifests[fname])

    section_inventory(a.context)
    digest_ok = section_pods(a.context, a.app_ns)
    print("### Deployment / Service（repo と照合）")
    wl = Tally()
    uids = {}
    for fname, kind, name, nskey in WORKLOADS:
        doc = section_workload(a.context, nsmap[nskey], kind, name, repo_objs[fname], wl)
        if kind == "deploy":
            uids[(nsmap[nskey], name)] = doc.get("metadata", {}).get("uid")
    print("### ReplicaSet")
    rs = Tally()
    stale = 0
    for ns in sorted(set(nsmap.values())):
        owners = {name: uid for (n, name), uid in uids.items() if n == ns}
        stale += section_replicasets(a.context, ns, owners, rs)
    missing = section_secrets(a.context, required_secrets(repo_objs, nsmap))

    incomplete = []
    if wl.unverified or wl.plaintext:
        incomplete.append("比較対象の未確認・平文")
    if wl.differs:
        incomplete.append("repo との相違")
    if rs.unverified or rs.plaintext or stale:
        incomplete.append("ReplicaSet の未確認・平文・別 UID")
    if missing:
        incomplete.append("必須 Secret・キーの欠落")
    if not digest_ok:
        incomplete.append("復旧用 digest の未確保")

    print("# 段階1 判定（項目ごと）")
    print("  採取: 完了")
    print("  比較対象の3オブジェクト: 未確認 %d / 平文 %d / repo との相違 %d" % (
        len(wl.unverified), len(wl.plaintext), len(wl.differs)))
    print("  ReplicaSet（現 Deployment 所有）: 未確認 %d / 平文 %d、別 UID の Deployment を参照: %d 件" % (
        len(rs.unverified), len(rs.plaintext), stale))
    print("  repo が参照する Secret とキー: %s" % ("すべてある" if not missing else "欠落 %d 件（%s）" % (len(missing), ", ".join(missing))))
    print("  復旧用 digest: %s" % ("確保" if digest_ok else "未確保"))
    print("  適用履歴（last-applied 注釈）と repo の相違（参考・判定に使わない。修正の要否は段階2の diff と合わせて判断）: %d" % len(wl.history_differs))
    print("  管理情報（参考・判定に使わない）: 伏せた項目 %d" % len(wl.mf_hidden))
    print("  未完了の項目: %s" % (", ".join(incomplete) or "なし"))
    print("  注: 未確認 0 は「既知の安全な値以外は見つからなかった」ことを意味し、秘匿値が無いことの証明ではない")

    if a.diff:
        if wl.unverified or wl.plaintext:
            raise Stop(10, "比較対象に未確認または平文があるため、段階2は実行しない")
        diff_rc = stage2(a.context, nsmap, manifests, a.accept_swap)
        if diff_rc == 1:
            return 1
    return 10 if incomplete else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Stop as s:
        sys.stdout.flush()
        print("STOP: %s" % s.msg, file=sys.stderr)
        sys.exit(s.code)
    except KeyboardInterrupt:
        sys.stdout.flush()
        print("STOP: 中断", file=sys.stderr)
        sys.exit(2)
    except Exception as e:
        # 想定外の例外も、メッセージ（値を含みうる）は出さず型名だけを出す
        sys.stdout.flush()
        print("STOP: 想定外のエラー (%s)" % type(e).__name__, file=sys.stderr)
        sys.exit(3)
