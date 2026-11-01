# A7M Dashbord — agreed plan

Status: implementation authorized for a read-only first version; local Desktop installation requires user action.
Repository: https://github.com/a7madxz6/hermes-Dashbord

## Confirmed decisions
- Desktop plugin navigation entry: `A7M Dashbord` in Hermes's left sidebar.
- Visual direction: Hallmark Terminal, scoped to the dashboard, not a global Hermes skin change.
- Welcome text must be exactly `Welcome to Hermes Dashbord`.
- The welcome fills most of the page with large centered lettering composed of small glyphs, progressively resolving like the Terminal theme's rabbit effect; not a typewriter effect.
- After the animation finishes and briefly holds, automatically enter the dashboard without an entry button.
- Main screen includes Hermes summary, Kanban board, and currently running tasks.
- Hermes's existing Kanban is the single source of truth: no independent task database or duplicated task state.
- Use Ponytail development discipline and Hallmark for design.

## Proposed layout
- Top: connection status, running agents, task counts, last data refresh.
- Main: Kanban view, with human-readable Arabic state labels.
- Side: current work, responsible agent, latest real activity.
- Task details may link to the associated conversation where supported.

## Implementation gates
- Inspect the actual Hermes Kanban schema, board scope, APIs and supported operations before mapping statuses or exposing edits. Proposed labels must not introduce unverified backend states.
- Distinguish connection state, running conversations/agents and Kanban task execution; do not infer one from another.
- Show unavailable data as unavailable, never fabricated counters or estimated progress.
- First integration should be read-only; task movement, creation and dispatch need a separately agreed scope.
- Define loading, empty, error and populated views; preserve keyboard access and reduced-motion support.
- Decide welcome replay frequency and timing during implementation; user has not specified them.
- Desktop plugin files run on the user's Windows app machine. Server-side writes do not install or update the local UI.
- Do not assume pushing to GitHub automatically updates installed desktop plugins.
- Confirm Git install/update behavior and private-repository authentication on the user's Desktop before promising easy updates.

## Delivery scope
Welcome animation and read-only dashboard are implemented with automated tests. Backend activation and Git publication are validated at delivery. The actual Windows Desktop installation remains a user-side acceptance check; fixture browser tests are not a claim of native installation.
