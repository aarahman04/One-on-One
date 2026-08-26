Name - One on One

concept -

Version 1 — One-to-One Private Chat Web App

This is the first-version master plan. The goal is to build the complete Internet-based product first, make the experience polished, and deliberately structure it so that a native Android version and Bluetooth/BitChat transport can be added later without rebuilding the whole system.

The central rule stays unchanged:

One account. One active connection. One person. One conversation.

The app should never feel like a social network, contact manager, or generic WhatsApp clone.

⸻

1. Product concept

The application is a private communication space designed specifically for one relationship at a time.

A user:

1. Signs in with Google.
2. Receives a unique Connection ID.
3. Gives that ID to another person through any outside channel.
4. The other person enters the ID.
5. A connection request is created.
6. The recipient accepts or rejects it.
7. Once accepted, both users have exactly one chat.
8. Opening the application takes them directly into that conversation.

There is no:

* contact list
* group chat
* public profile
* follower system
* social feed
* stories
* media sharing in V1
* voice/video calls
* AI chatbot
* discovery/search for people
* “new chat” button

The lack of features is intentional.

⸻

2. Core product philosophy

The application should communicate three ideas:

One

There is one active relationship.

Private

The conversation is between the two connected users.

Minimal

The application gets out of the way and lets the conversation exist.

The strongest product statement is:

No contacts. No groups. No feed. Just one connection.

⸻

3. Version roadmap

The project should be developed in stages rather than trying to solve everything simultaneously.

V1
WEB APPLICATION
Internet-based
Google authentication
One-to-one connection
Real-time text chat
Persistent history
Nickname
Export
Leave/termination system
Polished UI
        │
        ▼
V2
ANDROID APPLICATION
Native Android
Same account/backend model
Same conversation model
Internet transport initially
Google Play Store
        │
        ▼
V3
BLUETOOTH
Direct device-to-device communication
        │
        ▼
V4
BITCHAT-STYLE MESH
Multi-hop Bluetooth
Offline communication
Store-and-forward

This project document covers V1.

The Android version is intentionally not implemented yet, but V1 is designed to make it possible.

⸻

4. V1 technology stack

My recommended stack is:

Layer	Technology
Frontend	HTML + CSS + TypeScript
Frontend tooling	Vite
Backend	Node.js + TypeScript
API	Express
Real-time messaging	WebSocket / Socket.IO
Authentication	Supabase Auth
Google login	Google OAuth through Supabase
Database	Supabase PostgreSQL
Backend hosting	Railway
Source control	GitHub
Initial deployment	Railway + static frontend hosting
Later Android	Kotlin + Jetpack Compose
Later Bluetooth	Native Android Bluetooth + BitChat-derived transport

Supabase officially supports Google authentication for web and native applications, and its Auth system integrates with its Postgres database and row-level access controls. 

Railway supports long-running web/API services, GitHub-based deployment, environment variables, health checks and scaling, so it is a suitable place for the Node backend. 

⸻

5. Why Railway + Supabase?

This is the architecture I’d choose rather than trying to make everything live on one platform.

                    INTERNET
                       │
                       ▼
               ┌───────────────┐
               │   WEB CLIENT  │
               │ HTML/CSS/TS   │
               └───────┬───────┘
                       │
                 HTTPS / WSS
                       │
                       ▼
               ┌───────────────┐
               │    RAILWAY    │
               │ Node + Express│
               │  WebSocket    │
               └───────┬───────┘
                       │
                       ▼
               ┌───────────────┐
               │   SUPABASE    │
               │ Auth + Postgres│
               └───────────────┘

Railway

Handles:

* API
* WebSocket connections
* connection validation
* message routing
* leave logic
* server-side business rules
* exports
* future scheduled jobs

Supabase

Handles:

* Google authentication
* PostgreSQL
* user records
* connection records
* message persistence

You therefore don’t need to build your own authentication system or database infrastructure.

⸻

6. Don’t use Ruby on Rails

If by “Rails” you meant Ruby on Rails, I wouldn’t use it for this project.

Not because Rails is bad.

It’s because the stack above fits your project and your current development environment better:

TypeScript
   +
Node.js
   +
Express
   +
WebSocket
   +
PostgreSQL

Railway itself has official deployment guidance for Node/Express services, making that deployment path straightforward. 

⸻

7. User identity

There should be two concepts:

Account identity

Google authenticates the user.

Connection identity

Your application generates a unique Connection ID.

Example:

K7F29PQ

The Connection ID is what people exchange.

The Google email/name should not become the publicly displayed identity inside the conversation.

⸻

8. First-time user flow

Step 1 — Login

ONE
one connection.
nothing else.
[ Continue with Google ]

Google authentication happens.

⸻

Step 2 — Connection ID

The application generates:

YOUR CONNECTION ID
K7F29PQ
[ COPY ]

Text:

Give this ID to the person you want to connect with.

The user can send it through WhatsApp, SMS, Instagram, email, etc.

The other app does not need to know anything about the Google account behind that ID.

⸻

9. Connecting to somebody

The user who wants to connect enters:

CONNECT
Connection ID
[ K7F29PQ ]
[ CONNECT ]

The backend validates the ID.

Important server-side rules:

Does ID exist?
        ↓
Is this the user's own ID?
        ↓
Already connected?
        ↓
Does the recipient already have an active connection?
        ↓
Is there already a pending request?

The client should never be trusted to enforce these rules by itself.

⸻

10. Connection request

The recipient sees:

CONNECTION REQUEST
K7F29PQ
wants to connect with you.
[ ACCEPT ]
[ DECLINE ]

Don’t show a person’s email address.

Don’t show their Google profile picture.

Don’t create a mini social profile.

The Connection ID is enough.

⸻

11. Nickname system

This is one of the features I would definitely include in V1.

After accepting:

CONNECTION ACCEPTED
What would you like
to call this person?
[ Arjun____________ ]
[ SAVE ]

The important design decision:

Nicknames are local.

Suppose I call you:

Arjun

You could call me:

Bro

I see:

ARJUN

You see:

BRO

There is no globally assigned display name.

This reinforces the concept that the application is about your connection, not a public identity system.

⸻

12. Main screen

Opening the application after connection should go directly to the chat.

No dashboard.

No homepage.

No chat list.

No “new message.”

Something approximately like:

┌─────────────────────────────────────────┐
│                                         │
│  ARJUN                         •••      │
│  ● connected                            │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│             26 AUGUST 2026              │
│                                         │
│  11:32                                  │
│  > hey, are you free today?             │
│                                         │
│                          11:33          │
│                    > yeah, what's up?   │
│                                         │
│  11:34                                  │
│  > nothing much                         │
│                                         │
│                                         │
├─────────────────────────────────────────┤
│  > Type a message...                  ↑ │
└─────────────────────────────────────────┘

This is terminal-inspired, not an actual terminal.

⸻

13. Visual design system

Your clarification about timestamps is important.

The visual hierarchy should be:

Highest emphasis

Actual message text

Medium emphasis

Sender name

Low emphasis

Timestamp

Very low emphasis

Connection metadata/status

For example:

11:32  ARJUN
       > hey, are you free today?
11:33  YOU
       > yeah, what's up?

Timestamp

Muted gray.

Small.

Never as bright as the message.

Sender name

A dedicated accent color.

For example:

ARJUN

could have one accent.

YOU

could have another.

Message

Bright, readable, relatively neutral.

Terminal indicator

> can be subtle.

This keeps the terminal aesthetic without making the conversation difficult to read.

⸻

14. Date separators

Use WhatsApp-like day separation, but with your own aesthetic.

When a new calendar day starts:

────────────────────────────
       27 AUGUST 2026
────────────────────────────

Then messages continue.

You should not display:

26/08/2026 11:32:48
26/08/2026 11:33:12
26/08/2026 11:33:59

for every message.

The date establishes context.

The timestamp remains lightweight.

⸻

15. Timestamp behavior

Same day:

11:32
11:34
11:37

A tap/click on a message can reveal the complete timestamp:

26 August 2026
11:32:14 AM

That provides precision without cluttering the main conversation.

⸻

16. The chat should not have message bubbles

This is another area where I’d deliberately differ from WhatsApp/Telegram.

Don’t do:

╭────────────────╮
│ hey            │
╰────────────────╯

Instead:

11:32  ARJUN
       > hey

and:

11:33  YOU
       > yeah, what's up?

This creates the distinctive visual identity you’re describing.

⸻

17. Top navigation

Keep it extremely small.

ARJUN                          •••
● connected

The ••• menu can contain:

Connection
────────────
Connection ID
Rename connection
Status
Conversation
────────────
Export
Search
Connection
────────────
Leave connection

That’s enough navigation for V1.

⸻

18. Database architecture

The database should remain tiny.

users

id
auth_user_id
connection_code
created_at

Supabase’s auth.users remains the authentication source; your application table stores the product-specific information.

⸻

connections

id
user_a_id
user_b_id
status
leave_requested_by
leave_requested_at
created_at
updated_at

Possible status values:

pending
active
leave_pending
terminated
declined

⸻

connection_members

connection_id
user_id
nickname
created_at
updated_at

This is where each participant’s local nickname lives.

⸻

messages

id
connection_id
sender_id
content
created_at

That’s essentially your entire core database.

⸻

19. Critical database constraint

The application must enforce:

A user can have only one active connection.

This is extremely important.

You don’t just hide the “new connection” UI.

The database/backend must enforce the rule.

Otherwise someone could eventually manipulate requests and create multiple relationships.

The product’s central concept should be a technical constraint, not merely a visual decision.

⸻

20. Message flow

When I send:

> hello

the flow is:

YOU
 │
 │ WebSocket
 ▼
RAILWAY BACKEND
 │
 ├── Authenticate user
 ├── Verify connection
 ├── Validate message
 ├── Store message
 │
 ▼
SUPABASE POSTGRES
 │
 ▼
RAILWAY
 │
 ▼
OTHER USER

Both clients receive the same authoritative message record.

This avoids trusting the browser to determine who said what.

⸻

21. Real-time messaging

For V1:

WebSocket/Socket.IO over the Internet.

This gives you:

* instant delivery
* typing can be added later
* connection status
* message events
* acknowledgement
* reconnect handling

You don’t need Bluetooth yet.

You don’t need mesh networking yet.

You don’t need offline routing yet.

⸻

22. Transport abstraction — extremely important

This is the part that prepares V1 for future BitChat integration.

Your application code should conceptually have:

MessageTransport
        │
        ├── InternetTransport
        │
        └── BluetoothTransport [future]

V1 implements only:

InternetTransport

Later, Android can implement:

BluetoothTransport

The chat UI doesn’t care.

So instead of writing:

ChatScreen → Socket.IO

design it more like:

ChatScreen
    ↓
MessageService
    ↓
Transport
    ↓
InternetTransport

Eventually:

MessageService
    ↓
Transport
    ├── Internet
    └── Bluetooth

This architectural decision is extremely valuable.

⸻

23. BitChat belongs in V3, not V1

The BitChat projects already contain Bluetooth mesh and protocol/networking concepts that can become relevant later. The official Android repository describes its implementation as protocol-compatible with iOS and supports Bluetooth LE mesh communication. 

The iOS project describes Bluetooth mesh, encryption, packet handling, fragmentation, deduplication and related transport machinery. 

But we should not copy that into the web version.

Instead:

V1
InternetTransport
      ↓
done
V2
Android
      ↓
InternetTransport
      ↓
Google Play
V3
Android
      ↓
BluetoothTransport
      ↓
BitChat protocol/networking concepts

For the first Bluetooth prototype, I’d even start with:

Phone A ↔ Phone B

before attempting:

Phone A → Phone C → Phone D → Phone B

Mesh routing comes later.

⸻

24. Important BitChat caveat

Don’t blindly copy cryptographic/security code and assume it is production-safe.

The current BitChat repository itself warns that its private-message/channel functionality has not had an external security review. 

So when we reach that stage, we’d treat BitChat as a technical foundation/reference, carefully review its exact repository and license, and separately validate our own security design.

For the current V1, none of that is necessary.

⸻

25. Leave/connection termination

This belongs in V1 because it defines the relationship model.

Normal state:

ACTIVE

Someone presses:

LEAVE CONNECTION

State becomes:

LEAVE_PENDING

The other person sees:

CONNECTION TERMINATION REQUEST
Arjun has requested to end this connection.
5 days remaining.
[ KEEP CONNECTION ]
[ ACCEPT TERMINATION ]

Possible states:

ACTIVE
   │
   ▼
LEAVE_PENDING
   │
   ├── Cancel → ACTIVE
   │
   ├── Both agree → TERMINATED
   │
   └── 5 days expire → TERMINATED

The five-day countdown must be calculated server-side.

⸻

26. Export

V1 should allow exporting the conversation.

Start with:

TXT
JSON

PDF can come afterward.

Example:

EXPORT CONVERSATION
Messages: 4,821
Connection started: 26 August 2026
[ EXPORT TXT ]
[ EXPORT JSON ]

This is consistent with the product philosophy:

The conversation belongs to the participants.

⸻

27. Slash commands

Don’t make commands essential.

They are an optional layer.

Potential commands:

/help
/status
/info
/export
/leave

Later:

/search
/count
/uptime

The UI can still expose buttons.

Commands are part of the terminal-inspired personality, not a usability requirement.

⸻

28. Security V1

Even though this isn’t yet the offline encrypted version, the web version should still be built properly.

At minimum:

Authentication

Google OAuth via Supabase.

Authorization

Every message request checks:

Is this authenticated user a member of this connection?

Database security

Use Postgres Row Level Security where appropriate.

Supabase explicitly supports RLS-based row-level authorization around authenticated user tokens. 

Backend validation

Validate:

* message length
* connection membership
* connection state
* request state
* nickname length
* Connection ID format
* rate limits

Never trust frontend state

The browser must not be able to say:

I am connected to user X.

The backend/database decides that.

⸻

29. V1 non-goals

This is important because otherwise the project will grow endlessly.

Do not implement:

Groups
Images
Videos
Voice calls
Video calls
Stories
Public profiles
Contact lists
Follower system
Social feed
AI
Channels
Communities
Reactions
Stickers
GIFs
Public discovery
Bluetooth
Bluetooth mesh
Cryptocurrency
End-to-end encryption redesign

Some of these may eventually be useful.

They simply don’t belong in the first release.

⸻

30. Recommended repository structure

I’d keep it like this:

one-connection/
│
├── client/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── state/
│   │   ├── styles/
│   │   └── utils/
│   │
│   └── public/
│
├── server/
│   ├── src/
│   │   ├── controllers/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── websocket/
│   │   ├── middleware/
│   │   ├── database/
│   │   └── utils/
│
├── shared/
│   ├── types/
│   └── constants/
│
├── database/
│   ├── migrations/
│   └── seed/
│
├── docs/
│
└── README.md

The shared directory becomes particularly useful later when Android and other clients need to understand the same connection/message concepts.

⸻

31. Development order

Don’t build everything simultaneously.

Stage A — visual prototype

Build the complete UI using fake data.

Screens:

Login
Connection ID
Connect
Request
Accept
Nickname
Chat
Menu
Export
Leave

No real backend yet.

The goal is:

Does the product feel right?

⸻

Stage B — authentication

Add:

Google
 ↓
Supabase Auth
 ↓
user

Then generate Connection IDs.

⸻

Stage C — connection system

Implement:

ID lookup
Request
Accept
Decline
One active connection
Nickname

⸻

Stage D — chat

Implement:

Send
Receive
Persist
Reconnect
Load history

⸻

Stage E — lifecycle

Add:

Leave
Five-day timer
Termination
Reconnection after termination

⸻

Stage F — export

Add TXT/JSON.

⸻

Stage G — production hardening

Add:

Rate limiting
Validation
RLS
Error handling
Logging
Monitoring
Reconnect handling
Mobile responsiveness
Security review

⸻

Stage H — deploy

GitHub
   ↓
Railway
   ↓
Production backend

Railway supports GitHub deployment and automatic deployment workflows, so your development loop can eventually be:

git push
   ↓
Railway
   ↓
deploy

⸻

32. What “finished V1” means

V1 is finished when a new person can:

Google Login
      ↓
Receive Connection ID
      ↓
Give ID to friend
      ↓
Friend enters ID
      ↓
Request arrives
      ↓
Friend accepts
      ↓
Choose nickname
      ↓
Chat instantly
      ↓
Close app
      ↓
Open app tomorrow
      ↓
Conversation is still there
      ↓
New date separator appears
      ↓
Export conversation
      ↓
Request to leave
      ↓
Five-day process works

And nothing else is necessary.

⸻

33. Android is already part of the design

Even though we are not building Android V2 yet, V1 should be designed with this eventual architecture in mind:

                    PRODUCT MODEL
                         │
               ┌─────────┴─────────┐
               │                   │
              WEB               ANDROID
               │                   │
        InternetTransport   InternetTransport
                                   │
                                   ▼
                            BluetoothTransport
                                   │
                                   ▼
                              BitChat-style
                              networking

The Android application should eventually be a real native Android application, rather than simply being a website wrapped inside an APK, because native Android will give us proper access to Bluetooth and the background/device capabilities we’ll eventually need.

For the Android stage, I’d use Kotlin + Jetpack Compose. That is separate from V1 and we should not start implementing it until the web product is stable.

⸻

34. What I would not try to share between Web and Android

Don’t worry about sharing the entire frontend.

The web UI and Android UI can be completely different implementations.

What should be shared conceptually is:

Authentication model
Connection model
Message model
Connection states
Business rules
Protocol definitions

Later:

Web → Internet
Android → Internet + Bluetooth

That’s the important reuse.

⸻

35. Final architecture

The finished V1 should look approximately like this:

                         USER
                          │
                          ▼
                  ┌──────────────┐
                  │   WEB CLIENT │
                  │ HTML/CSS/TS  │
                  │ Vite         │
                  └──────┬───────┘
                         │
                     HTTPS/WSS
                         │
                         ▼
                  ┌──────────────┐
                  │    RAILWAY   │
                  │              │
                  │ Node.js      │
                  │ Express      │
                  │ WebSocket    │
                  │ Auth checks  │
                  │ Business     │
                  │ rules        │
                  └──────┬───────┘
                         │
                         ▼
                  ┌──────────────┐
                  │   SUPABASE   │
                  │              │
                  │ Google Auth  │
                  │ PostgreSQL   │
                  │ RLS          │
                  └──────────────┘

And the future:

                  ONE CONNECTION
                        │
          ┌─────────────┴─────────────┐
          │                           │
       INTERNET                   BLUETOOTH
          │                           │
       Railway                  BitChat layer
          │                           │
       Supabase                  Android
                                      │
                              Bluetooth Mesh
                                      │
                               Offline messaging

⸻

36. My recommendation for the project

I would not start by touching BitChat.

I would not start by building Android.

I would not start by configuring Bluetooth.

I would not start by building the final backend infrastructure.

Start with this:

Build the V1 web experience so well that the application already feels complete even though it currently uses the Internet.

The first milestone is therefore:

Google login → Connection ID → connection request → nickname → beautiful one-person chat → persistent messages → date/time presentation → leave system → export.

Once that is working properly, we move to the Android version, and only after that do we introduce Bluetooth and the BitChat networking layer. The current BitChat Android project is already described as protocol-compatible with its iOS counterpart, which makes it a useful future reference when we reach that stage. 

That separation is what will keep this project simple now without boxing us in later.