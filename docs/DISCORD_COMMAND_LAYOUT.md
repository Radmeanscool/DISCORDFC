# Discord Command Layout

The guild registry is organized around the three gameplay modes rather than a flat list of commands. `/play` is the single player-facing entry point; it opens Game Home and the following actions use owner-bound buttons/select menus whenever possible.

## Player Mode

The normal user does not need `/player`; open `/play` and use the Player buttons. `/player` remains a fallback command surface only when `REGISTER_FALLBACK_COMMANDS=true` is used during command registration. Its command groups are:

- `/player career ...` for profile, match, weekly progression, injury, contract, and retirement.
- `/player training ...` for abilities, detailed skills, trainers, tricks, and culture study.
- `/player club ...` for the official club, squad, formation, tactic, fixtures, standings, and transfer market.
- `/player honors ...` for honors, World Footballer, achievements, and claims.

The Player root command maps to existing internal handler names, so this is a Discord adapter/UX change and does not alter Player domain formulas or state isolation. From Game Home, Player creation is now position-select driven, and Player Home exposes Profile, Training, Weekly Update, Match, Club Office, and mode navigation buttons. The weekly flow is explicitly `Weekly Update → Match → pending EXP allocation → next cycle`; the legacy `advanceWeek` primitive remains as a compatibility wrapper for existing internal callers. Player Daily Event is not registered or generated; conditional career incidents remain evidence-gated and must not be represented as a daily Money choice.

## Coach Mode

Use Coach buttons from Game Home for management career. `/coach` remains a fallback command surface when `REGISTER_FALLBACK_COMMANDS=true`; supported subcommands are `career`, `profile`, `event`, `round`, `exp`, `formation`, `tactic`, `job`, `retire`, `rebirth`, and `champions`. Here `event` means a pending **Coach management decision** and not a Player daily event. Formation, tactic, and Champions actions default to Coach state when invoked through the Coach root.

## Versus Mode

Use Versus buttons from Game Home for system-managed multiplayer. `/versus` remains a fallback command surface when `REGISTER_FALLBACK_COMMANDS=true`; supported subcommands are `home`, `profile`, `roster`, `lineup`, `bid`, `standings`, `round`, `season`, and the evidence-limited `join` fallback. Matchmaking remains system-managed; no user-created club or technical `/versus-matchmake` command is exposed.

## Help and migration

`/help` explains the mode-first workflow. The default guild registry contains three root commands: `/play`, `/help`, and `/admin`. `/play` is the only gameplay entry point; `/player`, `/coach`, and `/versus` remain in source as compatibility handlers but are not registered unless `REGISTER_FALLBACK_COMMANDS=true`. This keeps Discord's command menu focused while preserving a recovery path for operators and testing.

All mutating roots are included in the mutation rate-limit bucket. Every chat input command is acknowledged before rate limiting and per-user queue work. Component interactions are also acknowledged centrally; `handleComponent` only defers when an interaction has not already been acknowledged. The handler then resolves the root/subcommand path to the existing internal command name and runs the original isolated domain logic.

## Button-driven gameplay contract

The normal player journey is `/play` → Game Home → mode menu → contextual action panel. Player Home now exposes weekly update, match, training, daily reward, injury/recovery, honors, contract, Champions, and Club Office navigation. Club Office exposes match, league table, squad, formation/tactic, and market panels. Coach Home exposes round, management decision, EXP allocation, strategy, job offers, and Champions panels. Versus Home already exposes assignment, Next Battle, lineup builder, results, standings, market, rewards, schedule, rankings, and sponsor surfaces.

Every new component ID remains owner-bound. The component adapter acknowledges the interaction centrally and returns the user to the appropriate mode menu after an action. Slash subcommands remain as optional fallback/operator surfaces because Discord cannot expose every possible state transition as a persistent native button, but normal gameplay does not require typing each operation. Registration uses `REGISTER_FALLBACK_COMMANDS=false` by default.
