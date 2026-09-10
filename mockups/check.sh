#!/usr/bin/env bash
# Mechanically verifies the mockup rules that can be checked without a browser.
# Portable to macOS bash 3.2 / BSD grep. Exit 0 = clean.
cd "$(dirname "$0")" || exit 1
fail=0
ok()  { printf '  %-44s ok\n' "$1"; }
skip(){ printf '  %-44s –\n' "$1"; }
bad() { fail=1; printf '  %-44s FAIL\n' "$1"
        printf '%s\n' "$2" | head -8 | sed 's/^/      /'
        n=$(printf '%s\n' "$2" | grep -c .); [ "$n" -gt 8 ] && printf '      … and %d more\n' $((n-8)); }
chk() { if [ -z "$2" ]; then ok "$1"; else bad "$1" "$2"; fi; }
# grep over a file list, but never recurse the tree when the list is empty
gl()  { list="$1"; shift; [ -z "$list" ] && return 0; grep -H "$@" $list 2>/dev/null | sort -u; }

screens=$(find student admin -name '*.html' 2>/dev/null | sort)
allhtml=$(for f in index.html $screens; do [ -f "$f" ] && echo "$f"; done)
css=$(find css -name '*.css' 2>/dev/null | grep -v 'tokens\.css' | sort)
scan=$(for f in $css $screens; do [ -f "$f" ] && echo "$f"; done)

if [ -z "$screens" ]; then echo "No screen files yet — nothing to check."; exit 0; fi
echo "Checking $(printf '%s\n' $screens | grep -c .) screen file(s)"

chk "no external requests" \
  "$(gl "$allhtml $scan" -noE '(src|href)="https?://|@import[^;]*https?://|url\([\"'\'']?https?://')"

# colour scan ignores comments — a literal quoted in a /* */ or <!-- --> note is documentation
chk "no hardcoded colours" "$(python3 - $scan <<'EOF'
import re,sys
for f in sys.argv[1:]:
    src=open(f).read()
    stripped=re.sub(r'/\*.*?\*/|<!--.*?-->', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), src, flags=re.S)
    for i,line in enumerate(stripped.split('\n'),1):
        for m in re.finditer(r'#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(', line):
            print(f"{f}:{i}:{m.group(0)}")
EOF
)"

chk "tokens defined only in tokens.css" \
  "$(gl "$css" -nE '^[[:space:]]*--[a-z0-9-]+[[:space:]]*:')"

chk "JS confined to index.html" "$(gl "$screens" -ln '<script')"

chk "no raw \$...\$ LaTeX" "$(gl "$screens" -noE '\$[^$]{2,}\$')"

for pat in 'css/tokens\.css|links tokens.css' 'name="viewport"|viewport meta' '<html[^>]*lang=|html lang set'; do
  need=${pat%%|*}; label=${pat##*|}; miss=
  for f in $allhtml; do grep -qiE "$need" "$f" || miss="$miss$f "; done
  chk "$label" "$miss"
done

chk "every <img> has alt" "$(gl "$screens" -noE '<img[^>]*>' | grep -v 'alt=')"

if [ -n "$(gl "$css" -lE 'transition|animation')" ]; then
  chk "prefers-reduced-motion handled" \
    "$([ -z "$(gl "$css" -l 'prefers-reduced-motion')" ] && echo 'transitions styled, no prefers-reduced-motion block')"
else skip "prefers-reduced-motion (no transitions yet)"; fi

runf=$(printf '%s\n' $screens | grep -E 'run|question|passage')
if [ -n "$runf" ]; then
  chk "run screens leak nothing" \
    "$(gl "$runf" -noiE 'is-correct|correct-answer|incorrect|explanation|your rank|leaderboard')"
else skip "run screens leak nothing (none yet)"; fi

echo
if [ $fail -eq 0 ]; then echo "PASS"; else echo "FAILURES above — fix before handing over the sprint."; fi
exit $fail
