# Executive Summary: Wrenqueue Outbound Webhook & Match Result API

## 1. High-Level Overview

When a PikolScore match concludes (either by reaching the winning score or when the match countdown timer expires), the officiating umpire reviews the final result and clicks **Confirm** in the Victory Modal (`GameWonModal`) or on the match-complete inline bar (`Scoreboard.jsx`).

Confirming the match triggers a server-side conclusion workflow (`POST /api/match/results`) that:
1. Finalizes the match session in Supabase (`status = 'completed'`) and persists the canonical result snapshot.
2. **Pushes an Outbound Webhook (`POST`)** to the external **Wrenqueue** application (`MATCH_WEBHOOK_URL`) containing the winning team details, full team/player rosters, final score, and chronological rally-by-rally match logs.
3. **Exposes a Pull API (`GET /api/match/results`)** so Wrenqueue can fetch a specific match's result (`?sessionId=<uuid>`) or query recent completed matches at any time—ensuring zero data loss even if a webhook delivery fails or is missed.

> **Why Confirmation-Gated?**  
> Triggering the API call on explicit **Confirm** (rather than immediately when the last point is tapped) ensures the umpire can safely use **Undo Winning Point** without sending false match-end notifications to Wrenqueue.

---

## 2. End-to-End Integration Architecture

```text
[Umpire clicks "Confirm"]
        │
        ▼
POST /api/match/results  (PikolScore Next.js Server)
        │
        ├──► 1. Build canonical payload (lib/match-results.js)
        │         └─ Merges match_sessions, active match_events, and client snapshot
        │
        ├──► 2. POST to MATCH_WEBHOOK_URL (Wrenqueue receiver endpoint)
        │         └─ Headers: X-PikolScore-Event, Authorization: Bearer <secret>, X-Webhook-Secret
        │         └─ 5s timeout, 1 automatic retry (400ms delay) on network/5xx/408/429 errors
        │
        └──► 3. Persist confirmedResult + webhookDelivery status in Supabase & close court
                  └─ Queryable anytime via GET /api/match/results?sessionId=<uuid>
```

* **Resilient Closure**: If Wrenqueue is temporarily unreachable when the umpire clicks **Confirm**, PikolScore still closes the court, stores the delivery status (`webhookDelivery`) and `confirmedResult` in `match_sessions.player_names`, and redirects the umpire to `/matches`. Wrenqueue can reconcile via `GET /api/match/results`.

---

## 3. Environment Configuration

Configure the following environment variables on the **PikolScore** Next.js server (see [`.env.example`](../.env.example)):

| Variable | Required | Description |
| :--- | :--- | :--- |
| `MATCH_WEBHOOK_URL` | For push webhook | Full HTTPS URL of Wrenqueue's webhook receiver endpoint. If unset/empty, outbound webhook dispatch is skipped cleanly (`configured: false`). |
| `MATCH_WEBHOOK_SECRET` | Recommended | Shared secret sent by PikolScore on outbound webhook `POST` requests and accepted by PikolScore for server-to-server `GET /api/match/results` calls. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL used by `/api/match/results`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key used server-side by `/api/match/results` to read/update `match_sessions` and `match_events`. |

---

## 4. Outbound Webhook Specification (PikolScore → Wrenqueue)

### Request Details
* **Method**: `POST`
* **Destination**: `process.env.MATCH_WEBHOOK_URL`
* **Headers**:
  * `Content-Type: application/json`
  * `X-PikolScore-Event: match.concluded`
  * `Authorization: Bearer <MATCH_WEBHOOK_SECRET>` *(included when `MATCH_WEBHOOK_SECRET` is configured)*
  * `X-Webhook-Secret: <MATCH_WEBHOOK_SECRET>` *(included when `MATCH_WEBHOOK_SECRET` is configured)*

### Timeout & Retry Policy
Implemented in `dispatchMatchWebhook` ([`lib/match-results.js`](../lib/match-results.js)):
* **Timeout**: `5000 ms` per request attempt (`AbortController`).
* **Retries**: Up to `1` retry (`2` total attempts) with a `400 ms` delay between attempts.
* **Retry Conditions**: Retries on network/timeout errors, `408`, `429`, and `5xx` responses. Does **not** retry non-transient `4xx` responses (e.g. `400`, `401`, `403`, `404`).

### Receiver Guidelines for Wrenqueue
1. Validate `X-Webhook-Secret` or `Authorization: Bearer ...` against your shared `MATCH_WEBHOOK_SECRET`.
2. Check `event === "match.concluded"`.
3. Use `sessionId` as an idempotency key so duplicate deliveries do not create duplicate match records.
4. Respond quickly with HTTP `200` (or `2xx`) within 5 seconds.

---

## 5. Inbound Match Results API (Wrenqueue → PikolScore)

Wrenqueue can pull concluded match results directly from PikolScore via:

### `GET /api/match/results`
Implemented in [`app/api/match/results/route.js`](../app/api/match/results/route.js).

#### Authentication
Pass the shared `MATCH_WEBHOOK_SECRET` using any of these headers (a valid Supabase user Bearer JWT is also accepted):
* `Authorization: Bearer <MATCH_WEBHOOK_SECRET>`
* `X-API-Key: <MATCH_WEBHOOK_SECRET>`
* `X-Webhook-Secret: <MATCH_WEBHOOK_SECRET>`

#### Query Parameters

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `sessionId` | `uuid` | — | Fetch the exact result and logs for a specific match session. Returns `{ success, result }`. |
| `courtNumber` | `1 \| 2 \| 3 \| 4` | — | Filter recent completed matches by court number (used when `sessionId` is omitted). |
| `limit` | `number` | `10` | Maximum number of recent completed matches to return (`1`–`50`, used when `sessionId` is omitted). |

#### HTTP Status Codes
* `200 OK`: Match result(s) returned.
* `401 Unauthorized`: Missing or invalid credentials.
* `404 Not Found`: Specified `sessionId` does not exist.
* `500 Internal Server Error`: Server configuration or database query error.

---

## 6. Example Payloads

### A. Example Outbound Webhook `POST` Payload (Doubles Win)
Sent directly as the JSON request body to Wrenqueue (`MATCH_WEBHOOK_URL`) when the umpire clicks **Confirm**:

```json
{
  "event": "match.concluded",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "courtNumber": 2,
  "format": "doubles",
  "status": "completed",
  "isConfirmed": true,
  "isDraw": false,
  "isTimeExpired": false,
  "message": "Team A wins (11–8)",
  "finalScore": {
    "team0": 11,
    "team1": 8,
    "display": "11–8"
  },
  "winner": {
    "teamIndex": 0,
    "teamKey": "omega",
    "teamName": "Team A",
    "score": 11,
    "opponentScore": 8,
    "players": [
      {
        "slotIndex": 0,
        "userId": "9a1f2c34-1111-4444-8888-1234567890ab",
        "name": "Alice"
      },
      {
        "slotIndex": 1,
        "userId": "7b2e3d45-2222-4444-8888-1234567890cd",
        "name": "Bob"
      }
    ]
  },
  "teams": [
    {
      "teamIndex": 0,
      "teamKey": "omega",
      "teamName": "Team A",
      "score": 11,
      "isWinner": true,
      "players": [
        {
          "slotIndex": 0,
          "userId": "9a1f2c34-1111-4444-8888-1234567890ab",
          "name": "Alice"
        },
        {
          "slotIndex": 1,
          "userId": "7b2e3d45-2222-4444-8888-1234567890cd",
          "name": "Bob"
        }
      ]
    },
    {
      "teamIndex": 1,
      "teamKey": "alpha",
      "teamName": "Team B",
      "score": 8,
      "isWinner": false,
      "players": [
        {
          "slotIndex": 0,
          "userId": "4c3d5e67-3333-4444-8888-1234567890ef",
          "name": "Charlie"
        },
        {
          "slotIndex": 1,
          "userId": null,
          "name": "Dana"
        }
      ]
    }
  ],
  "umpire": {
    "id": "1d4e5f67-9999-4444-8888-abcdef123456",
    "name": "Ref John"
  },
  "timestamps": {
    "startedAt": "2026-11-17T08:00:00.000Z",
    "completedAt": "2026-11-17T08:18:30.000Z",
    "confirmedAt": "2026-11-17T08:18:35.000Z",
    "elapsedSeconds": 1110,
    "formattedDuration": "18:30"
  },
  "matchLogs": [
    {
      "step": 1,
      "sequence": 1,
      "source": "database",
      "eventType": "point",
      "elapsedSeconds": 15,
      "formattedTime": "00:15",
      "call": "1–0–2",
      "message": "Team A scored",
      "stateAfter": {
        "format": "doubles",
        "scores": [1, 0],
        "servingTeam": 0,
        "serverNumber": 2,
        "serverCourt": "left",
        "gameOver": false,
        "winner": null
      },
      "createdAt": "2026-11-17T08:00:15.000Z"
    },
    {
      "step": 2,
      "sequence": 2,
      "source": "database",
      "eventType": "sideOut",
      "elapsedSeconds": 42,
      "formattedTime": "00:42",
      "call": "0–1–1",
      "message": "Fault. Side out, Team B serves",
      "stateAfter": {
        "format": "doubles",
        "scores": [1, 0],
        "servingTeam": 1,
        "serverNumber": 1,
        "serverCourt": "right",
        "gameOver": false,
        "winner": null
      },
      "createdAt": "2026-11-17T08:00:42.000Z"
    },
    {
      "step": 3,
      "sequence": 3,
      "source": "database",
      "eventType": "gameWon",
      "elapsedSeconds": 1110,
      "formattedTime": "18:30",
      "call": "11–8–1",
      "message": "🏆 Team A won the match (11–8)",
      "stateAfter": {
        "format": "doubles",
        "scores": [11, 8],
        "servingTeam": 0,
        "serverNumber": 1,
        "serverCourt": "left",
        "gameOver": true,
        "winner": 0
      },
      "createdAt": "2026-11-17T08:18:30.000Z"
    }
  ]
}
```

### B. Example Outbound Webhook `POST` Payload (Time-Expired Draw)
If the 30:00 timer expires while scores are tied, `isDraw` and `isTimeExpired` are `true` and `winner` is `null`:

```json
{
  "event": "match.concluded",
  "sessionId": "661f9511-f3ac-52e5-b827-557766551111",
  "courtNumber": 1,
  "format": "doubles",
  "status": "completed",
  "isConfirmed": true,
  "isDraw": true,
  "isTimeExpired": true,
  "message": "Match tied (9–9)",
  "finalScore": {
    "team0": 9,
    "team1": 9,
    "display": "9–9"
  },
  "winner": null,
  "teams": [
    {
      "teamIndex": 0,
      "teamKey": "omega",
      "teamName": "Team A",
      "score": 9,
      "isWinner": false,
      "players": [
        { "slotIndex": 0, "userId": "uuid-1", "name": "Player 1" },
        { "slotIndex": 1, "userId": "uuid-2", "name": "Player 2" }
      ]
    },
    {
      "teamIndex": 1,
      "teamKey": "alpha",
      "teamName": "Team B",
      "score": 9,
      "isWinner": false,
      "players": [
        { "slotIndex": 0, "userId": "uuid-3", "name": "Player 3" },
        { "slotIndex": 1, "userId": "uuid-4", "name": "Player 4" }
      ]
    }
  ],
  "umpire": {
    "id": "1d4e5f67-9999-4444-8888-abcdef123456",
    "name": "Ref John"
  },
  "timestamps": {
    "startedAt": "2026-11-17T08:30:00.000Z",
    "completedAt": "2026-11-17T09:00:00.000Z",
    "confirmedAt": "2026-11-17T09:00:05.000Z",
    "elapsedSeconds": 1800,
    "formattedDuration": "30:00"
  },
  "matchLogs": [
    {
      "step": 1,
      "sequence": 1,
      "source": "database",
      "eventType": "gameWon",
      "elapsedSeconds": 1800,
      "formattedTime": "30:00",
      "call": "9–9–2",
      "message": "⏰ Time expired. Match tied (9–9)",
      "stateAfter": {
        "format": "doubles",
        "scores": [9, 9],
        "gameOver": true,
        "winner": null
      },
      "createdAt": "2026-11-17T09:00:00.000Z"
    }
  ]
}
```

### C. Fetching a Specific Match Result (`GET /api/match/results?sessionId=<uuid>`)
Use this endpoint when Wrenqueue receives a `sessionId` (or needs to re-fetch/verify a specific match result and its logs).

#### Example Request
```bash
curl -X GET "https://<pikolscore-domain>/api/match/results?sessionId=550e8400-e29b-41d4-a716-446655440000" \
  -H "X-API-Key: <MATCH_WEBHOOK_SECRET>"
```

#### Example Response (`200 OK`)
The `result` property returns the exact same match object structure delivered by the webhook:

```json
{
  "success": true,
  "result": {
    "event": "match.concluded",
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "courtNumber": 2,
    "format": "doubles",
    "status": "completed",
    "isConfirmed": true,
    "isDraw": false,
    "isTimeExpired": false,
    "message": "Team A wins (11–8)",
    "finalScore": {
      "team0": 11,
      "team1": 8,
      "display": "11–8"
    },
    "winner": {
      "teamIndex": 0,
      "teamKey": "omega",
      "teamName": "Team A",
      "score": 11,
      "opponentScore": 8,
      "players": [
        {
          "slotIndex": 0,
          "userId": "9a1f2c34-1111-4444-8888-1234567890ab",
          "name": "Alice"
        },
        {
          "slotIndex": 1,
          "userId": "7b2e3d45-2222-4444-8888-1234567890cd",
          "name": "Bob"
        }
      ]
    },
    "teams": [
      {
        "teamIndex": 0,
        "teamKey": "omega",
        "teamName": "Team A",
        "score": 11,
        "isWinner": true,
        "players": [
          { "slotIndex": 0, "userId": "9a1f2c34-1111-4444-8888-1234567890ab", "name": "Alice" },
          { "slotIndex": 1, "userId": "7b2e3d45-2222-4444-8888-1234567890cd", "name": "Bob" }
        ]
      },
      {
        "teamIndex": 1,
        "teamKey": "alpha",
        "teamName": "Team B",
        "score": 8,
        "isWinner": false,
        "players": [
          { "slotIndex": 0, "userId": "4c3d5e67-3333-4444-8888-1234567890ef", "name": "Charlie" },
          { "slotIndex": 1, "userId": null, "name": "Dana" }
        ]
      }
    ],
    "umpire": {
      "id": "1d4e5f67-9999-4444-8888-abcdef123456",
      "name": "Ref John"
    },
    "timestamps": {
      "startedAt": "2026-11-17T08:00:00.000Z",
      "completedAt": "2026-11-17T08:18:30.000Z",
      "confirmedAt": "2026-11-17T08:18:35.000Z",
      "elapsedSeconds": 1110,
      "formattedDuration": "18:30"
    },
    "matchLogs": [
      {
        "step": 1,
        "sequence": 1,
        "source": "database",
        "eventType": "point",
        "elapsedSeconds": 15,
        "formattedTime": "00:15",
        "call": "1–0–2",
        "message": "Team A scored",
        "stateAfter": {
          "format": "doubles",
          "scores": [1, 0],
          "servingTeam": 0,
          "serverNumber": 2
        },
        "createdAt": "2026-11-17T08:00:15.000Z"
      }
    ]
  }
}
```

### D. Listing Recent Completed Matches (`GET /api/match/results?courtNumber=2&limit=10`)

#### Example Request
```bash
curl -X GET "https://<pikolscore-domain>/api/match/results?courtNumber=2&limit=10" \
  -H "Authorization: Bearer <MATCH_WEBHOOK_SECRET>"
```

#### Example Response (`200 OK`)
```json
{
  "success": true,
  "count": 1,
  "results": [
    {
      "event": "match.concluded",
      "sessionId": "550e8400-e29b-41d4-a716-446655440000",
      "courtNumber": 2,
      "format": "doubles",
      "status": "completed",
      "isConfirmed": true,
      "isDraw": false,
      "isTimeExpired": false,
      "message": "Team A wins (11–8)",
      "finalScore": { "team0": 11, "team1": 8, "display": "11–8" },
      "winner": { "...": "..." },
      "teams": [ "..." ],
      "umpire": { "...": "..." },
      "timestamps": { "...": "..." },
      "matchLogs": [ "..." ]
    }
  ]
}
```

---

## 7. Payload Schema Reference

| Field | Type | Description |
| :--- | :--- | :--- |
| `event` | `string` | Always `"match.concluded"`. |
| `sessionId` | `string \| null` | PikolScore match session UUID. Recommended idempotency key. |
| `courtNumber` | `number \| null` | Court number (`1`–`4`) where the match took place. |
| `format` | `"doubles" \| "singles"` | Match format. |
| `status` | `string` | Always `"completed"`. |
| `isConfirmed` | `boolean` | `true` once confirmed by the umpire. |
| `isDraw` | `boolean` | `true` only when the match timer expires with tied scores. |
| `isTimeExpired` | `boolean` | `true` if the match ended via countdown timer expiration. |
| `message` | `string` | Human-readable summary (e.g., `"Team A wins (11–8)"` or `"Match tied (9–9)"`). |
| `finalScore` | `object` | `{ team0, team1, display }` where `display` is `"<team0>–<team1>"`. |
| `winner` | `object \| null` | Winning team details (`teamIndex`, `teamKey`, `teamName`, `score`, `opponentScore`, `players`), or `null` if `isDraw` is `true`. |
| `winner.players[]` | `array` | Roster entries `{ slotIndex, userId, name }`. `userId` is the Supabase player UUID if claimed via QR/app, or `null` for walk-up players. |
| `teams[]` | `array` | Both teams (`teamIndex` `0` and `1`) with `teamKey`, `teamName`, `score`, `isWinner`, and `players`. |
| `umpire` | `object` | `{ id, name }` of the officiating umpire. |
| `timestamps` | `object` | `{ startedAt, completedAt, confirmedAt, elapsedSeconds, formattedDuration }`. |
| `matchLogs[]` | `array` | Chronological rally/scoring events `{ step, sequence, source, eventType, elapsedSeconds, formattedTime, call, message, stateAfter, createdAt }`. |

---

## 8. Key Source Files in PikolScore

* [`lib/match-results.js`](../lib/match-results.js) — Canonical payload builder (`buildMatchResultPayload`, `buildNormalizedMatchLogs`) and webhook dispatcher (`dispatchMatchWebhook`).
* [`app/api/match/results/route.js`](../app/api/match/results/route.js) — `POST /api/match/results` (confirm, persist, and dispatch webhook) and `GET /api/match/results` (pull API by `sessionId` or `courtNumber`).
* [`components/scoreboard/Scoreboard.jsx`](../components/scoreboard/Scoreboard.jsx) — Umpire `handleConfirmMatch` workflow and auto-opening victory modal.
* [`components/scoreboard/GameWonModal.jsx`](../components/scoreboard/GameWonModal.jsx) — Confirmation modal with **Confirm** and **Undo Winning Point**.
* [`.env.example`](../.env.example) — Environment variable template (`MATCH_WEBHOOK_URL`, `MATCH_WEBHOOK_SECRET`).
