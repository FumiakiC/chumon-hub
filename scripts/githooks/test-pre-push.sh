#!/usr/bin/env bash

set -euo pipefail

# Keep the source repository's protected configuration (including safe.directory).
source_root=$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)
hook_dir="$source_root/.githooks"
hook_index=$(git -C "$source_root" ls-files -s -- .githooks/pre-push)
work_root=$(mktemp -d)
trap 'rm -rf -- "$work_root"' EXIT

isolate_git() {
  local variable
  for variable in ${!GIT_@}; do
    unset "$variable"
  done
  export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
  export GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0
  export GIT_AUTHOR_NAME='Hook Test' GIT_AUTHOR_EMAIL='hook-test@example.invalid'
  export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
  export GIT_TEMPLATE_DIR="$case_dir/template"
  mkdir -p "$GIT_TEMPLATE_DIR"
}

setup_case() {
  case_dir="$work_root/case-$1"
  mkdir -p "$case_dir"
  isolate_git
  remote="$case_dir/remote.git"
  repo="$case_dir/work"
  git init --bare --initial-branch=main "$remote"
  git clone "$remote" "$repo"
  cd "$repo"
  mkdir -p docs src
  printf 'initial documentation\n' > docs/a.md
  printf 'initial code\n' > src/b.ts
  git add .
  git commit -m 'Initial main'
  git push origin main
  base=$(git rev-parse HEAD)
  git config --local core.hooksPath "$hook_dir"
}

commit_all() {
  git add -A
  git commit -m "$1"
}

docs_commit() {
  printf '%s\n' "$1" >> docs/a.md
  commit_all "$1"
}

code_commit() {
  printf '%s\n' "$1" >> src/b.ts
  commit_all "$1"
}

all_refs() {
  git --git-dir="$remote" for-each-ref --format='%(refname) %(objectname)'
}

assert_ref() {
  local actual
  actual=$(git --git-dir="$remote" rev-parse --verify "$1")
  if [[ "$actual" != "$2" ]]; then
    printf 'Unexpected %s: expected %s, got %s\n' "$1" "$2" "$actual" >&2
    return 1
  fi
}

assert_marker() {
  if ! grep -Fq '[pre-push-main-guard]' "$case_dir/push.err"; then
    printf 'Missing hook diagnostic\n' >&2
    return 1
  fi
}

assert_no_marker() {
  if grep -Fq '[pre-push-main-guard]' "$case_dir/push.err"; then
    printf 'Unexpected hook diagnostic\n' >&2
    return 1
  fi
}

push_expect() {
  local outcome=$1 expected=$2 before after status=0
  shift 2
  before=$(all_refs)
  git push "$@" > "$case_dir/push.out" 2> "$case_dir/push.err" || status=$?
  after=$(all_refs)
  case "$outcome" in
    allow)
      [[ "$status" == 0 ]] || { cat "$case_dir/push.err" >&2; return 1; }
      assert_ref refs/heads/main "$expected"
      assert_marker
      grep -Fq "Allowed docs-only main update; checked $expected_count commit(s)." "$case_dir/push.err"
      [[ $(grep -Fc '[pre-push-main-guard]' "$case_dir/push.err") == 1 ]]
      ;;
    other)
      [[ "$status" == 0 ]] || { cat "$case_dir/push.err" >&2; return 1; }
      assert_ref refs/heads/main "$base"
      assert_ref refs/heads/topic "$expected"
      assert_no_marker
      ;;
    bypass)
      [[ "$status" == 0 ]] || { cat "$case_dir/push.err" >&2; return 1; }
      assert_ref refs/heads/main "$expected"
      assert_no_marker
      ;;
    deny)
      [[ "$status" != 0 ]] || { printf 'Push unexpectedly succeeded\n' >&2; return 1; }
      assert_marker
      [[ "$before" == "$after" ]] || { printf 'Remote refs changed after rejection\n' >&2; return 1; }
      # Hook diagnostics must not advertise ways to evade the guard.
      if grep -F '[pre-push-main-guard]' "$case_dir/push.err" |
        grep -Ei -- 'no-verify|hooksPath|chmod|rm |bypass|disable|迂回'; then
        printf 'Rejection diagnostic mentions bypass instructions\n' >&2
        return 1
      fi
      ;;
  esac
}

advance_remote() {
  local other="$case_dir/other"
  git clone "$remote" "$other"
  printf 'remote advance\n' >> "$other/docs/a.md"
  git -C "$other" add .
  git -C "$other" commit -m 'Advance remote main'
  git -C "$other" push origin main
}

direct_deny() {
  local input=$1 before after status=0
  shift
  before=$(all_refs)
  printf '%s' "$input" > "$case_dir/hook.in"
  env "$@" "$hook_dir/pre-push" origin "$remote" < "$case_dir/hook.in" \
    > "$case_dir/push.out" 2> "$case_dir/push.err" || status=$?
  after=$(all_refs)
  [[ "$status" != 0 ]] || { printf 'Direct invocation unexpectedly succeeded\n' >&2; return 1; }
  assert_marker
  [[ "$before" == "$after" ]]
}

check_git_failures() {
  local real_git failure input
  real_git=$(command -v git)
  mkdir "$case_dir/failing-git"
  cat > "$case_dir/failing-git/git" <<'EOF'
#!/bin/sh
if [ "$1" = "$HOOK_TEST_FAIL" ]; then
  exit 128
fi
if [ "$HOOK_TEST_FAIL" = merges ] && [ "$1" = rev-list ] &&
  [ "${2-}" = --min-parents=2 ]; then
  exit 128
fi
exec "$HOOK_TEST_REAL_GIT" "$@"
EOF
  chmod +x "$case_dir/failing-git/git"
  docs_commit 'Docs for command failure checks'
  input="refs/heads/main $(git rev-parse HEAD) refs/heads/main $base"
  for failure in cat-file merge-base rev-list merges diff-tree; do
    direct_deny "$input" \
      "PATH=$case_dir/failing-git:$PATH" \
      "HOOK_TEST_REAL_GIT=$real_git" "HOOK_TEST_FAIL=$failure"
    if grep -Fq 'Allowed docs-only main update' "$case_dir/push.err"; then
      printf 'Git failure produced a success diagnostic\n' >&2
      return 1
    fi
  done
}

case_body() {
  local number=$1 expected_count=1 main_sha topic_sha odd_name missing input
  setup_case "$number"
  case "$number" in
    1)
      docs_commit 'Docs update'
      push_expect allow "$(git rev-parse HEAD)" origin main
      ;;
    2)
      docs_commit 'First docs update'
      docs_commit 'Second docs update'
      expected_count=2
      push_expect allow "$(git rev-parse HEAD)" origin main
      ;;
    3)
      git switch -c local-docs
      docs_commit 'Docs from another branch'
      push_expect allow "$(git rev-parse HEAD)" origin HEAD:main
      ;;
    4|5|24|25)
      if [[ "$number" != 4 ]]; then
        git config --local core.quotePath false
      fi
      if [[ "$number" == 4 || "$number" == 24 ]]; then
        odd_name='日本語.md'
      else
        odd_name=$'space tab\tnewline\nquote".md'
      fi
      if [[ "$number" == 4 || "$number" == 5 ]]; then
        printf 'docs\n' > "docs/$odd_name"
        commit_all 'Unusual docs path'
        push_expect allow "$(git rev-parse HEAD)" origin main
      else
        printf 'code\n' > "src/$odd_name"
        commit_all 'Unusual non-docs path'
        push_expect deny '' origin main
      fi
      ;;
    6)
      git switch -c topic
      code_commit 'Code on topic'
      push_expect other "$(git rev-parse HEAD)" origin topic
      ;;
    7)
      docs_commit 'Docs on main'
      main_sha=$(git rev-parse HEAD)
      git switch -c topic "$base"
      code_commit 'Code on topic'
      topic_sha=$(git rev-parse HEAD)
      push_expect allow "$main_sha" origin main topic
      assert_ref refs/heads/topic "$topic_sha"
      ;;
    8)
      code_commit 'Code bypass test'
      push_expect bypass "$(git rev-parse HEAD)" --no-verify origin main
      ;;
    9)
      code_commit 'Code on main'
      push_expect deny '' origin main
      grep -Fq "Commit: $(git show -s --format='%h %s' HEAD)" "$case_dir/push.err"
      grep -Fq 'Path: src/b.ts' "$case_dir/push.err"
      ;;
    10)
      docs_commit 'Docs before code'
      code_commit 'Code after docs'
      push_expect deny '' origin main
      ;;
    11)
      code_commit 'Code to revert'
      git revert --no-edit HEAD
      push_expect deny '' origin main
      [[ $(grep -Fc '[pre-push-main-guard] Commit:' "$case_dir/push.err") == 2 ]]
      ;;
    12)
      git switch -c local-code
      code_commit 'Code from another branch'
      push_expect deny '' origin HEAD:main
      ;;
    13)
      code_commit 'Code on main'
      git switch -c topic "$base"
      docs_commit 'Docs on topic'
      push_expect deny '' origin main topic
      ;;
    14|16)
      advance_remote
      if [[ "$number" == 14 ]]; then
        git fetch origin
      fi
      docs_commit 'Divergent docs'
      push_expect deny '' --force origin main
      if [[ "$number" == 14 ]]; then
        grep -Fq 'Non-fast-forward' "$case_dir/push.err"
      else
        grep -Fq 'commits available in the local repository' "$case_dir/push.err"
      fi
      ;;
    15)
      push_expect deny '' origin :main
      ;;
    17)
      git --git-dir="$remote" update-ref -d refs/heads/main
      docs_commit 'Docs creating main'
      push_expect deny '' origin main
      ;;
    18)
      git switch -c docs-topic
      docs_commit 'Docs branch'
      git switch main
      git merge --no-ff docs-topic -m 'Merge docs branch'
      push_expect deny '' origin main
      grep -Fq 'Merge commits' "$case_dir/push.err"
      ;;
    19)
      git mv docs/a.md src/a.md
      commit_all 'Move docs outside'
      push_expect deny '' origin main
      grep -Fq 'Path: src/a.md' "$case_dir/push.err"
      ;;
    20)
      git mv src/b.ts docs/b.ts
      commit_all 'Move code into docs'
      push_expect deny '' origin main
      grep -Fq 'Path: src/b.ts' "$case_dir/push.err"
      ;;
    21|22|23)
      case "$number" in
        21) mkdir docs-old; printf 'outside\n' > docs-old/x.md ;;
        22) mkdir mydocs; printf 'outside\n' > mydocs/x.md ;;
        23) printf 'outside\n' > README.md ;;
      esac
      commit_all 'Docs lookalike outside docs'
      push_expect deny '' origin main
      ;;
    26)
      code_commit 'Code dry run'
      push_expect deny '' --dry-run origin main
      ;;
    27)
      missing=$(printf '%s' "$base" | sed 's/./f/g')
      direct_deny "refs/heads/main $missing refs/heads/main $base"
      grep -Fq 'commits available in the local repository' "$case_dir/push.err"
      # All-zero detection must not depend on the object hash length.
      direct_deny "refs/heads/main 0 refs/heads/main $base"
      grep -Fq 'Deleting main' "$case_dir/push.err"
      direct_deny "refs/heads/main $base refs/heads/main 000"
      grep -Fq 'Creating main' "$case_dir/push.err"
      check_git_failures
      ;;
    28)
      for input in \
        $'\n' \
        "refs/heads/main $base refs/heads/main" \
        "refs/heads/topic $base refs/heads/topic $base extra"; do
        direct_deny "$input"
        grep -Fq 'Malformed pre-push input' "$case_dir/push.err"
      done
      input="refs/heads/topic $base refs/heads/topic $base extra"
      input+=$'\n'
      input+="(delete) 000 refs/heads/main $base"
      direct_deny "$input"
      grep -Fq 'Malformed pre-push input' "$case_dir/push.err"
      grep -Fq 'Deleting main' "$case_dir/push.err"
      ;;
    29)
      [[ "$hook_index" == "100755 "*$'\t.githooks/pre-push' ]]
      ;;
  esac
}

names=(
  'docs-only single commit'
  'docs-only multiple commits'
  'docs-only HEAD:main from another branch'
  'Japanese filename inside docs/'
  'spaces, tab, newline and quote inside docs/'
  'code to a non-main branch without guard output'
  'docs main and code topic in one push'
  'explicit bypass updates main without guard output'
  'code-only commit to main'
  'docs and code commits'
  'code change followed by revert'
  'code HEAD:main from another branch'
  'rejected main also leaves topic uncreated'
  'fetched divergent docs history with force'
  'main deletion'
  'unfetched remote commit with force'
  'main creation'
  'docs-only merge commit'
  'move docs/a.md to src/a.md'
  'move src/b.ts to docs/b.ts'
  'docs-old/x.md'
  'mydocs/x.md'
  'root README.md'
  'Japanese filename outside docs/'
  'spaces, tab, newline and quote outside docs/'
  'code dry-run push'
  'direct invocation with missing local commit'
  'direct invocation with malformed input'
  'indexed hook mode is 100755'
)

passed=0
failed=0
for number in "${!names[@]}"; do
  case_number=$((number + 1))
  # Run outside an if-condition so errexit still catches fixture failures.
  set +e
  (
    set -euo pipefail
    case_body "$case_number"
  ) > "$work_root/case-$case_number.log" 2>&1
  status=$?
  set -e
  if [[ "$status" == 0 ]]; then
    printf 'PASS %02d %s\n' "$case_number" "${names[$number]}"
    passed=$((passed + 1))
  else
    printf 'FAIL %02d %s\n' "$case_number" "${names[$number]}"
    cat "$work_root/case-$case_number.log" >&2
    failed=$((failed + 1))
  fi
done
printf 'Results: %d passed, %d failed\n' "$passed" "$failed"
[[ "$failed" == 0 ]]
