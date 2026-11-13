# FruitSlot

FruitSlot is a fruit pre-order and shop management PWA for two shops in Eluru: **1 Town** and **2 Town Rythu Bazar**.

## Architecture

- `index.html` is the whole app. There is no build step.
- `Code.gs` is the Google Apps Script backend. The owner pastes it into Apps Script by hand after changes.
- `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` make it an installable PWA.
- `supabase/` holds the instant-delivery backend: `schema.sql` (paste into the Supabase SQL Editor), three Edge Functions and `README.md` with the setup steps.

## Ordering flow

- Instant delivery (`CONFIG.INSTANT: true`): customers log in, add an address (current location), buy now, and the shop delivers in about 30 minutes. Set `INSTANT: false` to get the old order-today-pick-up-tomorrow app back.
- Login is Google through Supabase. With `SUPABASE_URL` and `SUPABASE_ANON_KEY` empty the app runs in demo mode: login, orders and the owner board all work, saved on this phone only.
- Payment: UPI (customer pays the shop's UPI ID, taps "I've paid", the owner matches the amount and time in PhonePe and confirms) or cash on delivery. Cashfree online payment is built on the server side (`supabase/functions`) but not yet in the screens.
- The database (`supabase/schema.sql`) decides prices, stock, delivery radius, shop hours, minimum order and delivery fee. The app never sends prices.
- Every new order sends a WhatsApp alert to the owner (`supabase/functions/notify-whatsapp`).
- Rider: the owner types the rider's name and phone when marking Out for delivery. Rapido or another partner comes later.

## Owner tabs

1. Assistant (AI)
2. Orders (in instant mode: the live order board with a beep for each new order, accept / packed / out for delivery / delivered, UPI and cash confirmation, shop open or closed, and item prices and stock)
3. Trays to buy (hidden in instant mode)
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
- Daily book cost per kg = tray cost ÷ tray net weight (not sellable). This applies to the Daily book, Dashboard, Result and the AI assistant, and the Result workings show e.g. "÷ 17.375 kg net". Selling prices (app and shop) still come from sellable kg.
- The Daily book, Dashboard, Result and the AI assistant use these rules for prices, and the net-weight cost per kg above for costs.

## Daily book

1. Morning: fruit bought. Each fruit bought also gets its tray cost and net weight updated in Prices (prices are saved). A day's entry remembers the net weight and wastage it was bought with; old entries without them use the fruit's current values.
2. Night, one action per screen, in this order: money (cash and counter UPI; app orders are added automatically), estimated % of today's stock sold (money in ÷ stock value at shop prices) with "To sell everything you'd need ₹X more", then stock left one fruit per screen (All sold, 1/4, 1/2, 3/4 left, or type the amount; an estimate is pre-selected).
3. Tomorrow: expected counter sales (average of the last 3 recorded days, mixed with the same weekday in earlier weeks when there are at least 2) plus app pre-orders; then suggested trays per fruit = (expected kg + pre-order kg − stock left) ÷ sellable per tray, rounded up, never negative, with a Share on WhatsApp button.
4. Result: today's profit and how each fruit was worked out.

## Supplied shop (1 Town)

- `CONFIG.SHOPS` marks 1 Town with `supplied: true`. Its fruit is billed to the owner's brother at cost.
- Its Daily book Result shows "Billed to brother: ₹X" (sum of tray cost × trays) instead of profit. The numbers are still saved as before, so old entries display.
- "Brother paid" entries (date, amount) are added on the Dashboard and saved in the 1 Town Daily book row for that date (`brotherPaid`, needs the current `Code.gs`). The Dashboard shows billed, paid and the running balance owed.
- 1 Town is left out of the Dashboard's combined profit, sales, waste and charts.

## Rules

- Keep everything in one `index.html`.
- Never put secret keys in the app. The one exception, approved by the owner: the Supabase project URL and the public anon key may go in `CONFIG` (the database security rules decide what that key can do). The service_role key, Cashfree and WhatsApp secrets stay in Supabase only.
- AI changes must always go through the Confirm card.
- Keep screens simple for a phone.
- Demo mode must keep working.
- After changing `Code.gs`, remind the owner to paste it into Apps Script and deploy a new version.
- After changing `supabase/schema.sql`, remind the owner to run the changes in the Supabase SQL Editor. After changing an Edge Function, remind the owner to paste it into that function and deploy.
