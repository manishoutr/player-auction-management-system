# Player Auction Management System

A complete offline web app for running a live player auction for a sports tournament: operator console for the auctioneer, a big-screen LED display for the audience, real-time sync between them, purses, squads, sets, timer, sound, results and printable team sheets.

Built for a 10-team cricket auction with 275+ players, run live in front of an audience on a laptop plus LED wall.

## What's inside

| File | Purpose |
| --- | --- |
| `index.html` | Landing page with setup instructions |
| `operator.html` | Operator console: bid entry, sold/unsold, undo, timer, team squads and purses |
| `display.html` | Audience/LED screen: live bids, player reveal, results, stats layouts |
| `shared.js` | Auction state machine, rules engine, localStorage + BroadcastChannel sync |
| `players.js` | Player data (demo set of 60 fictional players) |
| `leadership.js` | Team leadership data (empty demo map) |
| `sound.js` | Auction sounds |
| `assets/` | Fonts, logos and team artwork |
| `vendor/` | jsPDF for on-device PDF export |

## Features

- **Fully offline**: no server, no build step. Plain HTML/JS; state lives in localStorage and syncs between windows over BroadcastChannel.
- **Two-screen workflow**: operator screen on the laptop, audience screen on the projector/LED wall, with a live-link indicator.
- **Auction rules engine**: per-team purses, squad size caps and minimums, set-based minimum bids and increments, blocked/duplicate flags, unsold pool and re-auction.
- **Bid controls**: single-key team bids, custom amounts, step up/down, undo last bid, undo last sale, full sale confirmation flow.
- **Countdown timer** with start/pause/reset and configurable durations.
- **Live audience layouts**: current player, reveal animation, highest bidder strip, squad views, results tables, biggest buys, per-team spends.
- **Exports**: results CSV and per-team PDF sheets generated on device.
- **Backup/restore**: full auction state export/import as JSON.

## Run it

1. Download or clone this repo.
2. Open `index.html` in Chrome and follow the on-screen steps (LED screen first, then the operator screen).
3. To preview the audience layouts without a live auction, open `display.html?demo=1`.

No installation, server or internet connection needed.

## Demo data

All player names, IDs and details in `players.js` are synthetic and fictional, included only so the app can be tried end to end. Replace `players.js` and `leadership.js` with your own data to run a real auction.
