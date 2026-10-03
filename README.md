# FruitSlot – going live

The app works in two modes:

- **Demo mode** (now): open `index.html` and everything works, but orders stay on that one phone. Owner key: `1234`. Use this to test the flow with a few customers at the shop.
- **Live mode**: orders from every customer go into one Google Sheet that you see on the owner screen.

## 1. Set up the Google Sheet (about 15 minutes)
1. Create a new Google Sheet called "FruitSlot Orders".
2. Open **Extensions > Apps Script**, delete what's there, and paste in `Code.gs`.
3. Choose `setup` in the function menu and press **Run**. Allow access. This creates the Fruits and Orders tabs.
4. Open **Project Settings > Script properties** and add `OWNER_KEY` with a secret only you know. This is what you type to open the owner screen.
5. Press **Deploy > New deployment > Web app**. Execute as: **Me**. Who has access: **Anyone**. Copy the web app URL.
6. In `index.html`, paste that URL into `API_URL` near the top, and check `UPI_ID` is correct.

## 2. Put the app online (GitHub Pages, free)
1. Create a new public GitHub repository, for example `fruitslot-app`.
2. Upload all files from this folder: `index.html`, `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`. (`Code.gs` and this README don't need to go online.)
3. Open **Settings > Pages**, choose the `main` branch, and save. After a minute your app is at `https://<your-username>.github.io/fruitslot-app/`.
4. Open that link on your phone and use **Add to Home screen**.

## 3. Every day
- **Evening, after 9 PM:** open the owner screen, check each payment against your PhonePe business history using the UTR, and press **Payment received** or **Not received**.
- **Trays to buy** tab: shows how many trays of each fruit to buy for tomorrow and how much is left for the counter.
- **Next day at pickup:** press **Picked up** when the customer collects.
- **Daily book** has 4 steps for each shop. Pick the shop and day at the top.
  1. **Morning, fruit bought:** tap + for each tray bought; check the cost per tray and what was left from last night.
  2. **Night, count stock:** for each fruit, enter what's left and what you threw away. It shows what you sold.
  3. **Night, money:** cash in the drawer, counter UPI (not app orders), other costs.
  4. **Result:** today's profit. Anything missing shows with a Fix button.
  "Save and next" saves each step, so you can stop anytime and come back.
- **Profit** tab: profit per shop and both shops together, the last 7 days, and which fruits are wasting most.
- **Prices** tab: change prices, tray sizes and tray costs, or turn a fruit off when you don't have it.

## Already set up the Sheet before the Daily book was added?
Paste the new `Code.gs` over the old one, run `setup` again (it adds a Book tab and a trayNet column without touching your data), then **Deploy > Manage deployments > Edit > New version**.

## Watermelon, muskmelon, pineapple (sold by size)
These are already in the list but switched off. On **Prices**, enter the lot cost with transport, the lot weight and the sellable kg, check the sizes (name and kg range), switch on **On sale** and save. Customers pick a size and pay a fixed price per piece, worked out from the middle of the range. In the Daily book, count these by kg like other fruits.

## AI assistant
The **✦ Assistant** tab in the owner screen lets you chat in English or Telugu: ask questions about your shops, or say what you bought, counted or got paid. Every change appears as a card and is saved only when you tap **Confirm**.

To switch it on (live mode only):
1. Create an account at console.anthropic.com, add billing, and create an API key. You pay per message; check current prices in the Anthropic docs.
2. In Apps Script, open **Project Settings > Script properties** and add `ANTHROPIC_API_KEY` with your key. Optional: `AI_MODEL` (default `claude-haiku-4-5-20251001`, a fast low-cost model).
3. Paste the latest `Code.gs` and deploy a new version.

Never put the API key inside `index.html`, or anyone opening your app could use it.

## Good to know
- Prices always come from the Sheet, so nobody can change the price on their phone.
- The same UTR can't be used for two orders.
- Change the owner key in Script properties if anyone else learns it.
- After you change `Code.gs`, use **Deploy > Manage deployments > Edit > New version**, or the old code keeps running.
