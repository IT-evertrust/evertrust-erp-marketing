# Front-end design standard (`apps/web`)

Every page should read as a **designed surface**, not a bare list/table. New pages
start enriched — do not ship a lone table under a title.

## Page anatomy
1. `<PageHeader title description actions />` — the masthead (always present).
2. _(optional)_ a stat row — `<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">…<StatTile/>…</div>` — KPIs/summary computed from data the page **already** fetches.
3. Content in `<Card>`s. Lists become tables with avatars/badges; empty → `<EmptyState/>`; loading → `<Skeleton/>`.

Wrap the page body in `<div className="flex flex-col gap-6">`.

## The kit (reuse; don't reinvent)
- `@/components/common/page-header` — `<PageHeader title description? actions? />`
- `@/components/common/stat-tile` — `<StatTile label value hint? accent? icon? />` (`accent` = a `bg-*` top-bar class, e.g. `bg-emerald-400`)
- `@/components/common/empty-state` — `<EmptyState icon? title description? action? />`

## Conventions
- Dark-themed shadcn. Use existing primitives (`@/components/ui/*`: Card, Badge, Table, Avatar, Select, Skeleton) and tokens (`bg-card`, `text-muted-foreground`, `border`, `text-foreground`).
- Status/role colour = **semantic**, on dark: `border-{c}-500/30 bg-{c}-500/10 text-{c}-400` (emerald = ok/active, amber = attention, sky/violet = accent, destructive = error). Pick a small palette — don't rainbow.
- People → `<Avatar>` with tinted initials. Numbers → `tabular-nums`.
- **NO** new fonts, **NO** theme changes, **NO** new deps, **NO** custom CSS files. Consistency > novelty (AGENTS Rule 11).
- A StatTile's number must come from data the page already fetches — never invent an endpoint just for decoration.

## Reference implementation
`src/components/users/users-view.tsx` + `users-table.tsx` + `role-styles.ts` — the canonical enriched page: PageHeader, color-coded role/stat tiles, avatar table, status indicators, empty/loading states.
