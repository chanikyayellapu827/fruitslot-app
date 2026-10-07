# FruitSlot

FruitSlot is a fruit pre-order and shop management PWA for two shops in Eluru: **1 Town** and **2 Town Rythu Bazar**.

## Architecture

- `index.html` is the whole app. There is no build step.
- `Code.gs` is the Google Apps Script backend. The owner pastes it into Apps Script by hand after changes.
- `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` make it an installable PWA.

## Ordering flow

- Customers pre-order today and pick up tomorrow.
- Orders close at 9 PM IST.
- Payment is upfront by UPI. There is no UTR: the owner matches the amount and time against PhonePe, then marks Payment received / Not received.

## Owner tabs

1. Assistant (AI)
2. Orders
3. Trays to buy
4. Daily book (4 steps, below)
5. Dashboard
6. Prices

## Pricing

- Defaults: wastage 8%, profit 8%, shop 10%. Wastage, profit and shop % can be set per fruit, and "Apply to all" at the top of Prices sets them for every fruit.
- Each fruit keeps its own tray net weight.
- Sellable per tray = tray net weight x (1 - wastage%). It is calculated, never typed.
- Cost per kg = tray cost with transport ÷ sellable per tray.
- App price = cost per kg x (1 + profit%), rounded up (round to 2 decimals first).
- Shop price = app price + shop %.
- Example: net 18, cost 3250 → sellable 16.56 kg → ₹196.26/kg → app ₹212 → shop ₹234.
- Daily book cost per kg uses tray cost ÷ sellable per tray (the same cost per kg).
- The Daily book, Dashboard, Result and the AI assistant all use these rules.

## Daily book

1. Morning: fruit bought. Each fruit bought also gets its tray cost and net weight updated in Prices (prices are saved). A day's entry remembers the net weight and wastage it was bought with; old entries without them use the fruit's current values.
2. Night, one action per screen, in this order: money (cash and counter UPI; app orders are added automatically), estimated % of today's stock sold (money in ÷ stock value at shop prices) with "To sell everything you'd need ₹X more", then stock left one fruit per screen (All sold, 1/4, 1/2, 3/4 left, or type the amount; an estimate is pre-selected).
3. Tomorrow: expected counter sales (average of the last 3 recorded days, mixed with the same weekday in earlier weeks when there are at least 2) plus app pre-orders; then suggested trays per fruit = (expected kg + pre-order kg − stock left) ÷ sellable per tray, rounded up, never negative, with a Share on WhatsApp button.
4. Result: today's profit and how each fruit was worked out.

## Rules

- Keep everything in one `index.html`.
- Never put API keys in the app.
- AI changes must always go through the Confirm card.
- Keep screens simple for a phone.
- Demo mode must keep working.
- After changing `Code.gs`, remind the owner to paste it into Apps Script and deploy a new version.
