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
- Days before the profit cycle start date use the old daily profit: cost per kg from the cost method on the Result screen ("Sellable kg" by default, or "Net weight"), a running average of opening stock and today's trays, and no profit until every fruit has its "Left now" count.
- The Daily book, Dashboard, Result and the AI assistant use these rules for prices, and the cost per kg above for costs.

## Profit cycles

- Profit is per cycle, not per day. A cycle is a run of open days (default 3: Wed-Thu-Fri, then Sat-Sun-Mon). The closed day (default Tuesday) is skipped; an entry on it belongs to the next cycle. The cycle start date, open days per cycle and closed day are editable under "Cycle settings" on the Dashboard (saved in the Book sheet as a row with shop `settings`, needs the current `Code.gs`). The first cycle starts 7 Oct 2026.
- Cycle profit = collected (cash + counter UPI + app orders) − purchases (trays × tray cost) − expenses + closing stock value − opening stock value.
- Closing stock is counted only on the cycle's last day, per fruit, in kg or baskets (kg per basket is a per-fruit setting in Prices, `basketKg`). It is valued at the cycle's average cost per sellable kg = (opening stock value + purchases) ÷ (opening kg + sellable kg bought).
- Opening stock of a cycle = the previous cycle's closing stock, at the same cost. In the very first cycle it is typed on the first day. If the previous cycle has no closing count, the next cycle's profit is "not ready".
- Daily revenue, purchases and costs are shown for each day, never a daily profit (`calcShop()` returns `profit: null` and `daily: true` for days inside a cycle; `calcCycle()` does the cycle maths). The Dashboard and the AI assistant (`profit_cycles`) show cycle profit.
- The "tomorrow" kg guess uses each fruit's average daily kg sold over the last two counted cycles, and leftover stock is subtracted only on a cycle's last day.

## Daily book

1. Morning: fruit bought (trays, tray cost, net weight). Each fruit bought also gets its tray cost and net weight updated in Prices (prices are saved). A day's entry remembers the net weight and wastage it was bought with; old entries without them use the fruit's current values.
2. Night: cash, counter UPI (app orders are added automatically) and other costs. On a cycle's last day, then the closing stock, one fruit per screen. There is no nightly "Left now" count on other days.
3. Tomorrow: expected counter sales (average of the last 3 recorded days, mixed with the same weekday in earlier weeks when there are at least 2) plus app pre-orders; then suggested trays per fruit = (expected kg + pre-order kg − stock left) ÷ sellable per tray, rounded up, never negative, with a Share on WhatsApp button.
4. Result: today's money in, fruit bought and costs, and the cycle profit (or why it is not ready).

## Supplied shop (1 Town)

- `CONFIG.SHOPS` marks 1 Town with `supplied: true`. Its fruit is billed to the owner's brother at cost.
- Its Daily book Result shows "Billed to brother: ₹X" (sum of tray cost × trays) instead of profit. The numbers are still saved as before, so old entries display.
- "Brother paid" entries (date, amount) are added on the Dashboard and saved in the 1 Town Daily book row for that date (`brotherPaid`, needs the current `Code.gs`). The Dashboard shows billed, paid and the running balance owed.
- 1 Town is left out of the Dashboard's combined profit, sales, waste and charts.

## Rules

- Keep everything in one `index.html`.
- Never put API keys in the app.
- AI changes must always go through the Confirm card.
- Keep screens simple for a phone.
- Demo mode must keep working.
- After changing `Code.gs`, remind the owner to paste it into Apps Script and deploy a new version.
