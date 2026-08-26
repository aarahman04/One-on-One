# Architecture

Diagrams updated as the system grows. Additive — don't rewrite existing diagrams from scratch when a phase adds structure, extend them.

## System architecture (V1)

```mermaid
graph TD
    Client["Web Client<br/>HTML/CSS/TS + Vite"]
    Server["Railway<br/>Node + Express + Socket.IO"]
    DB["Supabase<br/>Auth + Postgres + RLS"]

    Client -- "HTTPS / WSS" --> Server
    Server -- "SQL" --> DB
```

## Message flow (V1)

```mermaid
sequenceDiagram
    participant You
    participant Server as Railway Backend
    participant DB as Supabase Postgres
    participant Other as Other User

    You->>Server: send message (WebSocket)
    Server->>Server: authenticate + verify connection membership
    Server->>DB: persist message
    Server-->>You: authoritative message record
    Server-->>Other: authoritative message record
```

## Connection state machine

```mermaid
stateDiagram-v2
    [*] --> pending: request sent
    pending --> active: accepted
    pending --> declined: declined
    active --> leave_pending: leave requested
    leave_pending --> active: cancelled / other keeps connection
    leave_pending --> terminated: both agree OR 5 days expire
    terminated --> [*]
```

## Transport abstraction

Load-bearing for V3/V4 — every client message path routes through this, not directly through Socket.IO.

```mermaid
graph TD
    ChatScreen --> MessageService --> Transport
    Transport --> InternetTransport["InternetTransport (V1, implemented)"]
    Transport -.-> BluetoothTransport["BluetoothTransport (V3, future)"]
```
