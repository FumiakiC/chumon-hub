#!/usr/bin/env python3
"""chumon-hub fix/manifest-drift ①: 本番の Service に repo のポート名（http）を反映する（案 A）。

対象は default namespace の Service「chumon-hub-service」だけ。Pod は再起動しない。
すべての kubectl 呼び出しに --context と -n default を付ける。

使い方（本番ホストで。必ず python3 -I で実行する）:
  1. 確認（本番は変えない）:
       sudo python3 -I apply_service_portname.py --context <context 名>
  2. 適用（確認をもう一度行い、想定どおりのときだけ書き込む）:
       sudo python3 -I apply_service_portname.py --context <context 名> --apply
  3. 切り戻し（必要なときだけ。2 で保存した切り戻し情報を使う）:
       sudo python3 -I apply_service_portname.py --context <context 名> --rollback
  状態確認（いつでも実行できる。読み取りだけで、本番は変えない）:
       sudo python3 -I apply_service_portname.py --context <context 名> --status
     現在の Service が「適用前」「適用後」「その他」のどれかを判別し、EndpointSlice と /healthz も確かめる。
     切り戻し情報が保存されていれば、uid と注釈もそれと照合する。

書き込みの方式:
  kubectl apply ではなく JSON Patch（RFC 6902）で書き込む。パッチの先頭に test 操作を置き、
  確認した時点の uid・resourceVersion・ポート名・last-applied 注釈と一致するときだけサーバーが反映する。
  確認の後に別の操作で Service が変わっていれば、サーバーが拒否する（上書きしない）。
  変更するのは ports[0].name と last-applied 注釈（kubectl apply が書くのと同じ内容）の2つだけ。

確認の内容（すべて満たさなければ書き込まない）:
  - repo（固定コミット）の service.yaml を取得・解析できる。
  - 現在の last-applied 注釈が「repo の service.yaml から ports[0].name を除いたもの」と一致する。
  - kubectl apply のサーバー側 dry-run で、変わるのがポート名と注釈だけで、新しい注釈が repo の内容と一致する。
  - 書き込むパッチそのもののサーバー側 dry-run でも、変わるのがポート名と注釈だけ。
  - ClusterIP 経由の /healthz が ok を返す（適用後と比べる基準）。

表示の規則: 値を出すのは、検証済みの想定値（ポート名「なし」「http」、EndpointSlice のポート名「(なし)」「http」）と
  固定の文言だけ。想定外の変更は、件数と spec / metadata のどちらの配下かだけを出し、パスと値は出さない。
  kubectl のエラー文も出さない。

保存するもの: 切り戻し情報（uid と、書き込み前後の last-applied 注釈。どちらも repo の公開済みの内容と一致する
  ことを確認したもの）だけを、スクリプトと同じ場所の svc-portname-work/（0700、ファイルは 0600）に置く。
  取得したオブジェクトそのものは保存しない。① の完了後に sudo rm -r svc-portname-work で削除する。

終了コード:
  0 = 成功
  2 = 前提条件の不備（何も変えていない）
  3 = 書き込み前の外部コマンドの失敗（何も変えていない）
  4 = 書き込み前に想定外の状態・差分を検出（何も変えていない）
  5 = 書き込みは成功したが、その後の確認が失敗した、または確認できなかった（反映済み）
  6 = 書き込みの結果が不明（タイムアウト・接続断・中断など。反映済みの可能性がある）
  7 = 書き込みをサーバーが拒否した（事前条件の不一致など。反映されていないはず）
  5〜7 のときは、自動で再試行・切り戻しをせず、まず状態確認（--status）で現在の状態を確かめる。
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO = "FumiakiC/chumon-hub"
DEFAULT_SHA = "1dabc2baa6d67070d1440854f27b807b61b9277d"  # main, 2026-10-10
NS = "default"
NAME = "chumon-hub-service"
PORT_NAME = "http"
WORKDIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "svc-portname-work")
ROLLBACK_FILE = os.path.join(WORKDIR, "rollback.json")
LAST_APPLIED = "kubectl.kubernetes.io/last-applied-configuration"
LA_PATH = "metadata.annotations." + LAST_APPLIED
LA_POINTER = "/metadata/annotations/" + LAST_APPLIED.replace("~", "~0").replace("/", "~1")
NAME_PATH = "spec.ports[0].name"
NOISE = re.compile(r"^(?:status|metadata\.(?:managedFields|resourceVersion|generation|uid|creationTimestamp|selfLink))(?:\.|\[|$)")
ODD = object()  # ポートが1つでない


class Stop(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code
        self.msg = msg


def classify_stderr(raw):
    t = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
    for name, pat in [("NotFound", r"\(NotFound\)|not found"), ("Forbidden", r"forbidden"),
                      ("Unauthorized", r"Unauthorized|must be logged in"),
                      ("Invalid", r"\(Invalid\)|is invalid"), ("Conflict", r"\(Conflict\)|conflict"),
                      ("接続", r"connection refused|no such host|i/o timeout|dial tcp|TLS handshake|certificate|Unable to connect"),
                      ("kubeconfig", r"error loading config|permission denied")]:
        if re.search(pat, t, re.IGNORECASE):
            return name
    return "その他"


# サーバーが応答として拒否した（＝反映されていない）と判断できるもの。タイムアウト・内部エラーは含めない
DEFINITIVE_REJECT = re.compile(
    r"Error from server \((?:Conflict|Invalid|BadRequest|Forbidden|NotFound|UnprocessableEntity|"
    r"UnsupportedMediaType|NotAcceptable|MethodNotAllowed|RequestEntityTooLarge)\)|"
    r"is invalid|The request is invalid|the server rejected our request|test(?:ing value)? .*failed", re.IGNORECASE)
UNKNOWN_OUTCOME = re.compile(r"Timeout|timed out|InternalError|ServiceUnavailable|deadline exceeded|"
                             r"Unable to connect|connection reset|EOF|i/o timeout", re.IGNORECASE)


def kubectl(ctx, op, *args, stdin=None):
    """読み取りと dry-run 用。失敗は「書き込み前の失敗」として扱う。"""
    argv = ["kubectl", "--context", ctx, "-n", NS] + list(args)
    try:
        p = subprocess.run(argv, input=stdin, capture_output=True, timeout=120)
    except subprocess.TimeoutExpired:
        raise Stop(3, "%s: タイムアウト" % op)
    except OSError as e:
        raise Stop(3, "%s: 起動できない (%s)" % (op, type(e).__name__))
    if p.returncode != 0:
        raise Stop(3, "%s: 失敗 exit=%d 分類=%s（エラー文は表示しない）" % (op, p.returncode, classify_stderr(p.stderr)))
    return p.stdout


def write_patch(ctx, ops, label):
    """本番への書き込み。開始した後の失敗は、反映状態に応じて 6（不明）か 7（拒否）にする。"""
    argv = ["kubectl", "--context", ctx, "-n", NS, "patch", "service", NAME, "--type=json", "-p", json.dumps(ops), "-o", "json"]
    try:
        p = subprocess.run(argv, capture_output=True, timeout=60)
    except subprocess.TimeoutExpired:
        raise Stop(6, "%s: タイムアウト。反映されたかどうかは不明。--status で現在の状態を確かめる" % label)
    except KeyboardInterrupt:
        raise Stop(6, "%s: 書き込み中に中断。反映されたかどうかは不明。--status で現在の状態を確かめる" % label)
    except OSError as e:
        raise Stop(3, "%s: kubectl を起動できない (%s)。書き込みは始まっていない" % (label, type(e).__name__))
    except Exception as e:
        raise Stop(6, "%s: 想定外のエラー (%s)。反映されたかどうかは不明。--status で現在の状態を確かめる" % (label, type(e).__name__))
    if p.returncode != 0:
        err = p.stderr.decode("utf-8", "replace")
        if DEFINITIVE_REJECT.search(err) and not UNKNOWN_OUTCOME.search(err):
            raise Stop(7, "%s: サーバーが拒否した（分類=%s）。反映されていないはず。--status で現在の状態を確かめる" % (label, classify_stderr(p.stderr)))
        raise Stop(6, "%s: 失敗 exit=%d 分類=%s。反映されたかどうかは不明。--status で現在の状態を確かめる" % (label, p.returncode, classify_stderr(p.stderr)))


def as_json(op, raw):
    try:
        return json.loads(raw)
    except Exception as e:
        raise Stop(3, "%s: JSON を解析できない (%s)" % (op, type(e).__name__))


def flatten(node, path="", out=None):
    if out is None:
        out = {}
    if isinstance(node, dict):
        if not node and path:
            out[path] = {}
        for k, v in node.items():
            flatten(v, "%s.%s" % (path, k) if path else k, out)
    elif isinstance(node, list):
        if not node and path:
            out[path] = []
        for i, v in enumerate(node):
            flatten(v, "%s[%d]" % (path, i), out)
    else:
        out[path] = node
    return out


def changes(before, after):
    """変化したパスの集合（ノイズのメタデータは除く）。値は返さない。"""
    a = {p: v for p, v in flatten(before).items() if not NOISE.match(p)}
    b = {p: v for p, v in flatten(after).items() if not NOISE.match(p)}
    return {p for p in set(a) | set(b) if (p in a) != (p in b) or a.get(p) != b.get(p)}


def report_unexpected(paths):
    """想定外の変更は、件数と配下だけを出す（パスと値は出さない）。"""
    spec = sum(1 for p in paths if p.startswith("spec"))
    meta = sum(1 for p in paths if p.startswith("metadata"))
    print("  想定外の変更: %d 件（spec 配下 %d / metadata 配下 %d / その他 %d）。パスと値は表示しない" % (
        len(paths), spec, meta, len(paths) - spec - meta))


def comparable_manifest(m):
    """apply が last-applied に加える metadata.namespace と空の annotations を除いて比べられる形にする。"""
    m = json.loads(json.dumps(m))
    md = m.get("metadata", {})
    if md.get("namespace") == NS:
        md.pop("namespace")
    if md.get("annotations") == {}:
        md.pop("annotations")
    return m


def port_name(obj):
    ports = obj.get("spec", {}).get("ports") or []
    return ports[0].get("name") if len(ports) == 1 else ODD


def show_port_name(v):
    if v is None:
        return "なし"
    if v == PORT_NAME:
        return PORT_NAME
    return "<想定外・伏せた>"


def annotation(obj):
    v = (obj.get("metadata", {}).get("annotations") or {}).get(LAST_APPLIED)
    return v if isinstance(v, str) else None


def parse_annotation(s):
    try:
        return json.loads(s)
    except Exception:
        raise Stop(4, "last-applied 注釈を解析できない")


# ---------- 取得 ----------

def fetch_repo_manifest(ctx, sha):
    url = "https://raw.githubusercontent.com/%s/%s/k8s/service.yaml" % (REPO, sha)
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        raise Stop(3, "service.yaml の取得失敗 HTTP %d" % e.code)
    except Exception as e:
        raise Stop(3, "service.yaml の取得失敗 (%s)" % type(e).__name__)
    try:
        import yaml
        m = yaml.safe_load(raw)
    except ImportError:
        m = as_json("service.yaml の変換", kubectl(ctx, "service.yaml の変換", "create", "--dry-run=client",
                                                    "--validate=false", "-o", "json", "-f", "-", stdin=raw))
    except Exception as e:
        raise Stop(3, "service.yaml を解析できない (%s)" % type(e).__name__)
    if not (isinstance(m, dict) and m.get("kind") == "Service" and m.get("metadata", {}).get("name") == NAME):
        raise Stop(4, "取得した service.yaml が想定の Service ではない")
    ports = m.get("spec", {}).get("ports") or []
    if len(ports) != 1 or ports[0].get("name") != PORT_NAME:
        raise Stop(4, "取得した service.yaml のポートが想定と違う")
    return m


def get_live(ctx):
    return as_json("Service の取得", kubectl(ctx, "Service の取得", "get", "service", NAME, "-o", "json"))


def healthz(svc):
    ip = svc.get("spec", {}).get("clusterIP")
    ports = svc.get("spec", {}).get("ports") or []
    if not (isinstance(ip, str) and re.match(r"^\d{1,3}(?:\.\d{1,3}){3}$", ip) and len(ports) == 1
            and isinstance(ports[0].get("port"), int)):
        return "ClusterIP またはポートが想定外"
    url = "http://%s:%d/healthz" % (ip, ports[0]["port"])
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(url, timeout=5) as r:
            body = r.read(64)
            return "ok" if r.status == 200 and body.strip() == b"ok" else "応答が想定外（HTTP %d）" % r.status
    except urllib.error.HTTPError as e:
        return "応答が想定外（HTTP %d）" % e.code
    except Exception as e:
        return "接続失敗 (%s)" % type(e).__name__


def endpoint_state(ctx):
    """EndpointSlice のポート名（想定値以外は伏せる）と ready 数。"""
    doc = as_json("EndpointSlice の取得", kubectl(ctx, "EndpointSlice の取得", "get", "endpointslices",
                                                 "-l", "kubernetes.io/service-name=" + NAME, "-o", "json"))
    names, ready = set(), 0
    for es in doc.get("items", []):
        for p in es.get("ports") or []:
            n = p.get("name") or ""
            names.add(n if n in ("", PORT_NAME) else "<想定外>")
        for ep in es.get("endpoints") or []:
            if (ep.get("conditions") or {}).get("ready") is True:
                ready += 1
    return names, ready


def show_es(names):
    return ", ".join(sorted("(なし)" if n == "" else n for n in names)) or "（スライス無し）"


# ---------- 確認 ----------

def precheck(ctx, sha):
    """書き込み前の確認。本番は変えない。すべて満たしたときだけ、書き込みに必要な情報を返す。"""
    repo_m = fetch_repo_manifest(ctx, sha)
    expected_prev = comparable_manifest(repo_m)
    expected_prev["spec"]["ports"][0].pop("name")

    live = get_live(ctx)
    uid = live.get("metadata", {}).get("uid")
    rv = live.get("metadata", {}).get("resourceVersion")
    if not (isinstance(uid, str) and isinstance(rv, str)):
        raise Stop(4, "uid または resourceVersion を取得できない")
    pn = port_name(live)
    print("## 現在の Service: ポート名 = %s" % (show_port_name(pn) if pn is not ODD else "<ポートが1つではない>"))
    if pn == PORT_NAME:
        raise Stop(4, "すでにポート名 %s が入っている（適用済みの可能性）。何も変えない" % PORT_NAME)
    if pn is not None:
        raise Stop(4, "現在のポート名が想定（なし）と違う。何も変えない")

    prev_ann = annotation(live)
    if prev_ann is None:
        raise Stop(4, "last-applied 注釈が無い。切り戻し情報を作れないので止める")
    if comparable_manifest(parse_annotation(prev_ann)) != expected_prev:
        raise Stop(4, "現在の last-applied が「repo の service.yaml からポート名を除いたもの」と一致しない")
    print("## 現在の last-applied: repo の service.yaml からポート名を除いたものと一致")

    # kubectl apply が書く注釈を、apply のサーバー側 dry-run から得る
    after_apply = as_json("apply の dry-run", kubectl(ctx, "apply の dry-run", "apply", "--dry-run=server", "-o", "json",
                                                       "-f", "-", stdin=json.dumps(repo_m).encode()))
    ch = changes(live, after_apply)
    if ch != {NAME_PATH, LA_PATH}:
        print("## apply の dry-run: NG")
        report_unexpected(ch - {NAME_PATH, LA_PATH})
        raise Stop(4, "apply の dry-run に想定外の変更がある。何も変えない")
    new_ann = annotation(after_apply)
    if port_name(after_apply) != PORT_NAME or new_ann is None or \
            comparable_manifest(parse_annotation(new_ann)) != comparable_manifest(repo_m):
        raise Stop(4, "apply の dry-run の結果が想定（ポート名 http、注釈が repo と一致）と違う。何も変えない")
    print("## apply の dry-run: 変わるのはポート名（なし → http）と注釈（repo と一致する内容）だけ")

    ops = [
        {"op": "test", "path": "/metadata/uid", "value": uid},
        {"op": "test", "path": "/metadata/resourceVersion", "value": rv},
        {"op": "test", "path": LA_POINTER, "value": prev_ann},
        {"op": "add", "path": "/spec/ports/0/name", "value": PORT_NAME},
        {"op": "replace", "path": LA_POINTER, "value": new_ann},
    ]
    after_patch = as_json("パッチの dry-run", kubectl(ctx, "パッチの dry-run", "patch", "service", NAME, "--type=json",
                                                       "-p", json.dumps(ops), "--dry-run=server", "-o", "json"))
    ch = changes(live, after_patch)
    if ch != {NAME_PATH, LA_PATH} or port_name(after_patch) != PORT_NAME or annotation(after_patch) != new_ann:
        print("## パッチの dry-run: NG")
        report_unexpected(ch - {NAME_PATH, LA_PATH})
        raise Stop(4, "書き込むパッチの dry-run が想定と違う。何も変えない")
    print("## パッチの dry-run: 変わるのはポート名と注釈だけ（確認時の uid・resourceVersion・注釈を条件にする）")

    hz = healthz(live)
    print("## ClusterIP 経由の /healthz（基準）: %s" % hz)
    if hz != "ok":
        raise Stop(4, "適用前の /healthz が ok ではない。比較の基準が取れないので止める")
    names, ready = endpoint_state(ctx)
    print("## EndpointSlice（基準）: ポート名=%s ready=%d" % (show_es(names), ready))
    return {"ops": ops, "live": live, "uid": uid, "prev_ann": prev_ann, "new_ann": new_ann}


def save_rollback(info):
    os.makedirs(WORKDIR, mode=0o700, exist_ok=True)
    os.chmod(WORKDIR, 0o700)
    fd = os.open(ROLLBACK_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"uid": info["uid"], "prev_ann": info["prev_ann"], "new_ann": info["new_ann"]}, f)
    print("## 切り戻し情報を保存: %s（0600。uid と書き込み前後の注釈のみ）" % ROLLBACK_FILE)


def verify_after(ctx, before, want_name, want_ann):
    """書き込み後の確認。問題の有無を返す（例外は呼び出し側で 5 にする）。"""
    live, names, ready = None, set(), 0
    for _ in range(10):
        live = get_live(ctx)
        names, ready = endpoint_state(ctx)
        if port_name(live) == want_name and names == {want_name or ""} and ready >= 1:
            break
        time.sleep(2)
    ok = True
    print("## 書き込み後の Service: ポート名 = %s" % show_port_name(port_name(live)))
    print("## 書き込み後の EndpointSlice: ポート名=%s ready=%d" % (show_es(names), ready))
    if port_name(live) != want_name:
        print("  NG: ポート名が想定と違う")
        ok = False
    if annotation(live) != want_ann:
        print("  NG: last-applied 注釈が想定と違う")
        ok = False
    if names != {want_name or ""} or ready < 1:
        print("  NG: EndpointSlice が想定どおりでない")
        ok = False
    other = changes(before, live) - {NAME_PATH, LA_PATH}
    if other:
        print("  NG: ポート名と注釈以外の変更がある")
        report_unexpected(other)
        ok = False
    hz = "?"
    for _ in range(5):
        hz = healthz(live)
        if hz == "ok":
            break
        time.sleep(2)
    print("## 書き込み後の /healthz（ClusterIP 経由）: %s" % hz)
    return ok and hz == "ok"


def after_write(ctx, before, want_name, want_ann, done_msg):
    try:
        ok = verify_after(ctx, before, want_name, want_ann)
    except Stop as e:
        raise Stop(5, "書き込みは成功したが、その後の確認ができない（%s）。--status で現在の状態を確かめる" % e.msg)
    except KeyboardInterrupt:
        raise Stop(5, "書き込みは成功したが、その後の確認中に中断した。--status で現在の状態を確かめる")
    except Exception as e:
        raise Stop(5, "書き込みは成功したが、その後の確認で想定外のエラー (%s)。--status で現在の状態を確かめる" % type(e).__name__)
    if not ok:
        raise Stop(5, "書き込みは成功したが、その後の確認で想定と違う点がある。--status で現在の状態を確かめ、必要なら切り戻す")
    print(done_msg)


# ---------- 状態確認（読み取りだけ） ----------

def load_rollback():
    if not os.path.isfile(ROLLBACK_FILE):
        return None
    try:
        saved = json.load(open(ROLLBACK_FILE, encoding="utf-8"))
        return {"uid": saved["uid"], "prev_ann": saved["prev_ann"], "new_ann": saved["new_ann"]}
    except Exception as e:
        raise Stop(2, "切り戻し情報を読めない (%s)" % type(e).__name__)


def do_status(ctx, sha):
    repo_m = fetch_repo_manifest(ctx, sha)
    exp_after = comparable_manifest(repo_m)
    exp_before = comparable_manifest(repo_m)
    exp_before["spec"]["ports"][0].pop("name")
    saved = load_rollback()
    print("## 切り戻し情報: %s" % ("あり（uid と注釈も照合する）" if saved else "なし（repo の内容とだけ照合する）"))

    live = get_live(ctx)
    pn = port_name(live)
    ann = annotation(live)
    try:
        ann_cmp = comparable_manifest(parse_annotation(ann)) if ann is not None else None
    except Stop:
        ann_cmp = "<解析不能>"
    uid_ok = saved is None or live.get("metadata", {}).get("uid") == saved["uid"]

    if not uid_ok:
        state = "その他（Service の uid が適用時と違う。作り直された可能性）"
    elif pn is None and ann_cmp == exp_before and (saved is None or ann == saved["prev_ann"]):
        state = "適用前"
    elif pn == PORT_NAME and ann_cmp == exp_after and (saved is None or ann == saved["new_ann"]):
        state = "適用後"
    else:
        state = "その他"
    print("## Service: ポート名 = %s" % (show_port_name(pn) if pn is not ODD else "<ポートが1つではない>"))
    if ann_cmp == exp_before:
        print("## last-applied 注釈: repo からポート名を除いた内容（適用前の形）")
    elif ann_cmp == exp_after:
        print("## last-applied 注釈: repo と一致する内容（適用後の形）")
    else:
        print("## last-applied 注釈: 適用前・適用後のどちらの形とも一致しない（内容は表示しない）")
    print("## 判定: %s" % state)

    ok = state in ("適用前", "適用後")
    want_names = {"" if state == "適用前" else PORT_NAME} if ok else None
    names, ready = set(), 0
    for _ in range(5):
        names, ready = endpoint_state(ctx)
        if want_names is None or (names == want_names and ready >= 1):
            break
        time.sleep(2)
    es_ok = want_names is not None and names == want_names and ready >= 1
    print("## EndpointSlice: ポート名=%s ready=%d%s" % (show_es(names), ready,
                                                     "" if es_ok else "  （Service の状態と一致しない、または ready が 0）"))
    hz = healthz(live)
    print("## /healthz（ClusterIP 経由）: %s" % hz)
    if ok and es_ok and hz == "ok":
        print("# 状態確認: %s で整合している（本番は変えていない）" % state)
        return 0
    raise Stop(4, "状態確認: 判定=%s、EndpointSlice=%s、/healthz=%s。本番は変えていない。この出力を共有して判断する" % (
        state, "整合" if es_ok else "不整合", hz))


# ---------- 各モード ----------

def do_check(ctx, sha):
    precheck(ctx, sha)
    print("# 確認のみ完了（本番は変えていない）。適用するなら --apply を付けて再実行する")


def do_apply(ctx, sha):
    info = precheck(ctx, sha)
    save_rollback(info)
    print("# 書き込む（確認時の状態と一致するときだけサーバーが反映する）")
    write_patch(ctx, info["ops"], "書き込み")
    after_write(ctx, info["live"], PORT_NAME, info["new_ann"],
                "# 適用完了。Access 経由のログインと画面の確認を行い、collect_live_state.py --diff で再照合する")


def do_rollback(ctx, sha):
    saved = load_rollback()
    if saved is None:
        raise Stop(2, "切り戻し情報が無い（%s）" % ROLLBACK_FILE)
    uid, prev_ann, new_ann = saved["uid"], saved["prev_ann"], saved["new_ann"]
    repo_m = fetch_repo_manifest(ctx, sha)
    expected_prev = comparable_manifest(repo_m)
    expected_prev["spec"]["ports"][0].pop("name")
    if comparable_manifest(parse_annotation(prev_ann)) != expected_prev or \
            comparable_manifest(parse_annotation(new_ann)) != comparable_manifest(repo_m):
        raise Stop(4, "保存した切り戻し情報が想定（repo の内容）と一致しない")
    live = get_live(ctx)
    rv = live.get("metadata", {}).get("resourceVersion")
    if live.get("metadata", {}).get("uid") != uid:
        raise Stop(4, "Service の uid が適用時と違う（作り直された可能性）。何も変えない")
    if port_name(live) != PORT_NAME or annotation(live) != new_ann:
        raise Stop(4, "現在の Service が適用直後の状態と一致しない。何も変えない")
    ops = [
        {"op": "test", "path": "/metadata/uid", "value": uid},
        {"op": "test", "path": "/metadata/resourceVersion", "value": rv},
        {"op": "test", "path": "/spec/ports/0/name", "value": PORT_NAME},
        {"op": "test", "path": LA_POINTER, "value": new_ann},
        {"op": "remove", "path": "/spec/ports/0/name"},
        {"op": "replace", "path": LA_POINTER, "value": prev_ann},
    ]
    after_patch = as_json("切り戻しパッチの dry-run", kubectl(ctx, "切り戻しパッチの dry-run", "patch", "service", NAME,
                                                               "--type=json", "-p", json.dumps(ops), "--dry-run=server", "-o", "json"))
    ch = changes(live, after_patch)
    if ch != {NAME_PATH, LA_PATH} or port_name(after_patch) is not None or annotation(after_patch) != prev_ann:
        print("## 切り戻しパッチの dry-run: NG")
        report_unexpected(ch - {NAME_PATH, LA_PATH})
        raise Stop(4, "切り戻しパッチの dry-run が想定と違う。何も変えない")
    print("## 切り戻しパッチの dry-run: 変わるのはポート名（http → なし）と注釈だけ")
    print("# 切り戻す（適用直後の状態と一致するときだけサーバーが反映する）")
    write_patch(ctx, ops, "切り戻し")
    after_write(ctx, live, None, prev_ann, "# 切り戻し完了")


def main():
    ap = argparse.ArgumentParser(description="chumon-hub-service に repo のポート名を反映する")
    ap.add_argument("--context", required=True)
    ap.add_argument("--sha", default=DEFAULT_SHA)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--apply", action="store_true")
    g.add_argument("--rollback", action="store_true")
    g.add_argument("--status", action="store_true", help="読み取りだけの状態確認")
    a = ap.parse_args()
    if not re.match(r"^[0-9a-f]{40}$", a.sha):
        raise Stop(2, "--sha は完全な 40 桁のコミット SHA で指定する")
    if not shutil.which("kubectl"):
        raise Stop(2, "kubectl が無い")
    try:
        ctxs = subprocess.run(["kubectl", "config", "get-contexts", "-o", "name"], capture_output=True, timeout=30)
    except Exception as e:
        raise Stop(3, "context 一覧: 失敗 (%s)" % type(e).__name__)
    if ctxs.returncode != 0:
        raise Stop(3, "context 一覧: 失敗 exit=%d 分類=%s（sudo の付け忘れに注意）" % (ctxs.returncode, classify_stderr(ctxs.stderr)))
    if a.context not in ctxs.stdout.decode().split():
        raise Stop(2, "指定の context が kubeconfig に無い")
    print("# 対象: context=%s namespace=%s service=%s 比較元=%s/%s" % (a.context, NS, NAME, REPO, a.sha))
    if a.apply:
        do_apply(a.context, a.sha)
    elif a.rollback:
        do_rollback(a.context, a.sha)
    elif a.status:
        return do_status(a.context, a.sha)
    else:
        do_check(a.context, a.sha)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Stop as s:
        sys.stdout.flush()
        print("STOP: %s" % s.msg, file=sys.stderr)
        sys.exit(s.code)
    except KeyboardInterrupt:
        # 書き込み中・書き込み後の中断は write_patch / after_write が 6 / 5 に変換する。ここに来るのは書き込み前だけ
        sys.stdout.flush()
        print("STOP: 中断（書き込み前。何も変えていない）", file=sys.stderr)
        sys.exit(2)
    except Exception as e:
        sys.stdout.flush()
        print("STOP: 想定外のエラー (%s)" % type(e).__name__, file=sys.stderr)
        sys.exit(3)
