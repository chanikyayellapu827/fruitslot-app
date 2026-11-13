// Sends you a WhatsApp alert for every new order that is ready to prepare:
//   - cash-on-delivery orders, the moment they are placed
//   - online orders, the moment payment is confirmed
//   - manual UPI orders, when the customer taps "I have paid" (you then check PhonePe and confirm in the app)
// Triggered by a Supabase Database Webhook on the orders table (INSERT and UPDATE).
// Secrets: WEBHOOK_SECRET, WA_TOKEN, WA_PHONE_NUMBER_ID, OWNER_WHATSAPP (country code + number, digits only),
//          WA_TEMPLATE (approved template name, see README for the exact text)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ok = (msg = "ok") => new Response(msg, { status: 200 });

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== Deno.env.get("WEBHOOK_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }
  const evt = await req.json(); // { type, table, record, old_record }
  const o = evt.record;
  const old = evt.old_record;
  if (evt.table !== "orders" || !o) return ok("ignored");

  const newCod = evt.type === "INSERT" && o.payment_method === "cod";
  const upiPaid = evt.type === "UPDATE" && o.payment_method === "upi" && o.payment_status === "to_verify" && old?.payment_status !== "to_verify";
  const justPaid = evt.type === "UPDATE" && o.payment_method === "online" &&
    o.payment_status === "paid" && old?.payment_status !== "paid";
  if (!newCod && !justPaid && !upiPaid) return ok("ignored");

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const [{ data: items }, { data: shop }] = await Promise.all([
    admin.from("order_items").select("name,qty,unit,line_total").eq("order_id", o.id),
    admin.from("shops").select("name").eq("id", o.shop_id).single(),
  ]);

  const lines = (items ?? []).map((i) => `${i.name} ${i.qty}${i.unit}`).join(", ");
  const a = o.address ?? {};
  const where = [a.name, a.phone, a.house, a.area, a.landmark].filter(Boolean).join(", ");
  const map = a.lat && a.lng ? ` https://maps.google.com/?q=${a.lat},${a.lng}` : "";
  const pay = o.payment_method === "cod" ? `COD Rs ${o.total}` : o.payment_method === "upi" ? `UPI Rs ${o.total} - check PhonePe` : `PAID online Rs ${o.total}`;

  // WhatsApp template parameters cannot contain newlines or long gaps, so keep each one a single line.
  const params = [`#${o.id}`, shop?.name ?? o.shop_id, lines.slice(0, 600), pay, `${where}${map}`.slice(0, 600)];

  const res = await fetch(`https://graph.facebook.com/v21.0/${Deno.env.get("WA_PHONE_NUMBER_ID")}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("WA_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: Deno.env.get("OWNER_WHATSAPP"),
      type: "template",
      template: {
        name: Deno.env.get("WA_TEMPLATE"),
        language: { code: "en" },
        components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
      },
    }),
  });
  if (!res.ok) {
    console.error("WhatsApp error", res.status, await res.text());
    return new Response("whatsapp failed", { status: 500 });
  }
  return ok();
});
