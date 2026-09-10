#!/usr/bin/env bash
# Reads PROGRESS.md and prints which sprints are ready, plus a ready-to-paste
# subagent brief for the first one. No side effects.
cd "$(dirname "$0")" || exit 1
python3 - "$@" <<'PY'
import re,sys,os

rows=[]
for line in open('PROGRESS.md'):
    m=re.match(r'\|\s*\*\*(S\d+)\*\*\s*\|(.+?)\|(.+?)\|(.+?)\|(.+?)\|\s*$', line)
    if m:
        sid,desc,deps,states,status=[x.strip() for x in m.groups()]
        rows.append(dict(id=sid,desc=desc,
                         deps=[d for d in re.findall(r'S\d+',deps)],
                         states=states,
                         done='done' in status.lower(),
                         status=re.sub(r'\*','',status)))
by={r['id']:r for r in rows}
done={r['id'] for r in rows if r['done']}
ready=[r for r in rows if not r['done'] and all(d in done for d in r['deps'])]
blocked=[r for r in rows if not r['done'] and not all(d in done for d in r['deps'])]

print(f"DONE     {' '.join(sorted(done)) or '—'}")
print(f"READY    {' '.join(r['id'] for r in ready) or '—'}   (different chains may run concurrently)")
print(f"BLOCKED  {' '.join(r['id']+'←'+','.join(d for d in r['deps'] if d not in done) for r in blocked) or '—'}")
print()

if not ready:
    print("Nothing ready. Every sprint is done, or PROGRESS.md is malformed.")
    raise SystemExit(0)

want=sys.argv[1] if len(sys.argv)>1 else ready[0]['id']
r=by.get(want)
if r is None: print(f"No such sprint: {want}"); raise SystemExit(1)
if r['id'] not in {x['id'] for x in ready}:
    print(f"{r['id']} is blocked on {', '.join(d for d in r['deps'] if d not in done)}"); raise SystemExit(1)

print("="*72)
print(f"SUBAGENT BRIEF — {r['id']}")
print("="*72)
print(f"""
Invoke the `quizzer-mockups` skill, then build sprint {r['id']} of the Quizzer mockups.

  Sprint:   {r['desc']}
  States:   {r['states']}
  Repo:     {os.path.abspath('..')}

Read before writing anything:
  mockups/PROGRESS.md                          the to-do list and handover notes
  mockups/css/components.css                   the S0 contract — conventions to copy
  mockups/student/home.html                    the reference screen
  design-system/guidelines/selections.md       the locked A/B/C picks and consequences
  design-system/guidelines/*.html              source CSS+markup for components you need
  JOURNEYS.md §7                               the screen inventory
  BANK.md / PRD.md                             behaviour, when a screen's rules are unclear

Rules that are not negotiable — the skill lists all ten. The ones that get broken:
  - Build the PICKED variant only. Losing variants never reach mockups/.
  - Tokens only. No hardcoded colour, size, radius or shadow.
  - No external requests. Icons/illustrations inline SVG or assets/.
  - New shared component -> APPEND to css/components.css. Screen CSS is layout only.
  - Nothing on a run screen may reveal correctness, rank, score or another student.

Finish by, in this order:
  1. bash mockups/check.sh   — must exit 0
  2. the acceptance checklist in MOCKUP_PROMPT.md for the states you added
  3. a responsive proof page: your key screens in iframes at 390 / 820 / 1440
  4. append anything the design system lacked to mockups/SYSTEM-GAPS.md
  5. add your screens to the directory list in mockups/index.html
  6. tick {r['id']} off in mockups/PROGRESS.md with a handover note

Report back in 15 lines or fewer: files created, components appended to
components.css, check.sh result, system gaps, what the next sprint needs.
""".rstrip())
PY
