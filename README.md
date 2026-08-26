# One on One

Private 1:1 messaging app. One account. One active connection. One person. One conversation.

No contacts, no groups, no feed — just one connection.

## Docs

- Full concept/spec: `One on One_concept.txt`
- Execution plan: `~/.claude/plans/you-are-a-experienced-polymorphic-metcalfe.md`
- Progress log: `docs/PROGRESS.md`
- Architecture diagrams: `docs/ARCHITECTURE.md`
- Project rules for coding agents: `CLAUDE.md`

## Roadmap

V1 Web App → V2 Android App → V3 Bluetooth → V4 BitChat-style mesh. Currently building V1.

## Structure

```
client/     Vite + TypeScript web frontend
server/     Node + Express + Socket.IO backend
shared/     Types/constants shared across clients
database/   Migrations + seed data
docs/       Progress log + architecture diagrams
```
