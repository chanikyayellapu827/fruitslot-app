# FruitSlot

FruitSlot is a fruit pre-order and shop management PWA for two shops in Eluru: **1 Town** and **2 Town Rythu Bazar**.

## Architecture

- `index.html` is the whole app. There is no build step.
- `Code.gs` is the Google Apps Script backend. The owner pastes it into Apps Script by hand after changes.
- `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` make it an installable PWA.

## Ordering flow

- Customers pre-order today and pick up tomorrow.
- Orders close at 9 PM IST.
- Payment is upfront by UPI, with a UTR number.

## Owner tabs

1. Assistant (AI)
2. Orders
3. Trays to buy
4. Daily book (4 steps)
5. Dashboard
6. Prices

## Pricing

- App price = tray cost x 1.10 / sellable per tray, rounded up.
- Shop price = app price + 10%.
- Daily book cost per kg uses tray cost ÷ sellable per tray.

## Rules

- Keep everything in one `index.html`.
- Never put API keys in the app.
- AI changes must always go through the Confirm card.
- Keep screens simple for a phone.
- Demo mode must keep working.
- After changing `Code.gs`, remind the owner to paste it into Apps Script and deploy a new version.
