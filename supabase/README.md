# FruitSlot Instant: Supabase backend

Files
- `schema.sql`: tables, security rules, `place_order()` and starter data. Paste it into the Supabase SQL Editor once.
- `functions/create-payment`: starts a Cashfree payment for an online order.
- `functions/cashfree-webhook`: Cashfree tells us the payment finished; marks the order paid.
- `functions/notify-whatsapp`: WhatsApp alert to the owner for each new order that is ready to prepare.

## Setup (about 30 minutes, in this order)

1. **Create the project.** supabase.com > New project. Region: Mumbai (ap-south-1). Keep the database password in a password manager.
2. **Database.** SQL Editor > paste all of `schema.sql` > Run. Then set the real shop positions (copy lat, lng from Google Maps):
   `update shops set lat = 16.xxxx, lng = 81.xxxx where id = '1town';` (same for `2town`).
   Opening hours, delivery radius, minimum order, delivery fee and the free-delivery amount are all editable in `shops` and `settings`.
3. **Login.** Authentication > Providers: turn on Google (quickest) or Phone (needs an SMS provider; India SMS needs DLT registration).
4. **Make yourself owner.** Sign in once from the app, then in SQL Editor:
   `select id, phone, email from auth.users;` and insert your id into `staff` (the last lines of `schema.sql` show how).
5. **Functions.** Edge Functions > create each function and paste its `index.ts`.
   - `create-payment`: leave JWT verification ON.
   - `cashfree-webhook` and `notify-whatsapp`: turn JWT verification OFF (they check their own signature or secret).
6. **Secrets** (Edge Functions > Secrets). Enter these in the Supabase dashboard only. Never paste them in chat, in `index.html` or in GitHub:
   - `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV` (`sandbox` first, then `production`), `APP_URL` (your app address)
   - `WEBHOOK_SECRET` (any long random string), `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `OWNER_WHATSAPP` (91 + number, digits only), `WA_TEMPLATE`
7. **Order alert trigger.** Database > Webhooks > new: table `orders`, events Insert and Update, type Supabase Edge Function `notify-whatsapp`, add header `x-webhook-secret` with the same value as `WEBHOOK_SECRET`.
8. **Cashfree.** Dashboard > Developers > Webhooks: `https://<your-project-ref>.supabase.co/functions/v1/cashfree-webhook`. Start in test mode.
9. **WhatsApp template** (Meta Business > WhatsApp Manager > Message templates, category Utility, language English), body exactly:
   `New order {{1}} at {{2}}. Items: {{3}}. Payment: {{4}}. Deliver to: {{5}}. Please accept it in the app.`
   The alert fires for cash orders when placed, for UPI orders when the customer taps "I've paid", and for online orders when paid.

## Connect the app (after step 3)
In `index.html`, find `CONFIG` and fill the two lines `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Supabase > Settings > API: Project URL and the **anon public** key). Nothing else goes there. Leave them empty to keep the phone-only demo.
Google login: in Google Cloud create an OAuth client (Web), paste its client id and secret in Supabase > Authentication > Providers > Google, and add the app address under Authentication > URL Configuration (Site URL and Redirect URLs).

## Payments until Cashfree is live
- **UPI:** the customer pays the shop UPI ID shown on the order screen and taps "I've paid". You get a WhatsApp alert, match the amount and time in PhonePe, then tap Payment received (or Not received) on the Orders tab. You cannot accept an order whose UPI payment is unconfirmed.
- **Cash on delivery:** marked paid automatically when you tap "Delivered, cash collected".
- The UPI ID is read from the `settings` table (`upi_id`), so you can change it without editing the app.

## What the app is allowed to hold
Only the project URL and the public "anon" key go in `index.html`. The database security rules decide what that key can do. The service-role key, Cashfree secret and WhatsApp token stay in Supabase secrets.

## How it behaves (tested locally)
- The app never sends prices. `place_order()` reads prices and stock from the database, checks the delivery radius, shop hours, quantity steps and minimum order, then adds the delivery fee.
- A customer sees only their own orders and addresses; they cannot create or edit orders directly, or change totals or payment status.
- Staff can only see and update orders and stock for their own shop, and can only change status, rider name and rider phone.
- Cash-on-delivery is marked paid with `mark_cod_paid(order_id)`. UPI payments are confirmed with `confirm_upi(order_id, true/false)` by staff only.

## Not done yet
- The app screens were tested in a browser in demo mode and against a mock server that returns what Supabase should return. They have not run against your real Supabase project yet.
- Tested against a local Postgres 16 with stand-ins for Supabase login. Run the same checks on the real project before taking orders.
- The Cashfree and WhatsApp calls follow their documentation but need a test with real sandbox keys.
- Refunds are done by hand in the Cashfree dashboard.
- Rider dispatch (Rapido or others) comes later; for now staff type the rider's name and phone.
