// Cashfree calls this when a payment finishes. Deploy with JWT verification OFF (Cashfree has no Supabase login);
// security comes from the signature check below, then a second check straight with Cashfree.
// Secrets: CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ok = () => new Response("ok", { status: 200 });

Deno.serve(async (req) => {
  const raw = await req.text(); // must be the exact bytes Cashfree sent
  const timestamp = req.headers.get("x-webhook-timestamp") ?? "";
  const signature = req.headers.get("x-webhook-signature") ?? "";
  const secret = Deno.env.get("CASHFREE_SECRET_KEY")!;

  // Cashfree signature = Base64( HMAC-SHA256( timestamp + rawBody, secretKey ) )
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + raw));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (!signature || expected !== signature) return new Response("bad signature", { status: 401 });

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return ok(); }
  const cfOrderId: string | undefined = payload?.data?.order?.order_id;
  if (!cfOrderId) return ok(); // e.g. Cashfree's dashboard test ping

  const base = Deno.env.get("CASHFREE_ENV") === "production" ? "https://api.cashfree.com" : "https://sandbox.cashfree.com";
  const res = await fetch(`${base}/pg/orders/${cfOrderId}`, {
    headers: {
      "x-api-version": "2023-08-01",
      "x-client-id": Deno.env.get("CASHFREE_APP_ID")!,
      "x-client-secret": Deno.env.get("CASHFREE_SECRET_KEY")!,
    },
  });
  if (!res.ok) return new Response("cashfree lookup failed", { status: 500 }); // Cashfree will retry
  const cf = await res.json();

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: order } = await admin.from("orders").select("id,total,payment_status").eq("cashfree_order_id", cfOrderId).single();
  if (!order) return ok();

  if (cf.order_status === "PAID" && Number(cf.order_amount) === Number(order.total)) {
    if (order.payment_status !== "paid") {
      await admin.from("payments").upsert(
        { order_id: order.id, gateway: "cashfree", gateway_ref: cfOrderId, amount: order.total, status: "paid", raw: cf },
        { onConflict: "gateway,gateway_ref" },
      );
      await admin.from("orders").update({ payment_status: "paid" }).eq("id", order.id);
    }
  } else if (cf.order_status === "EXPIRED" || cf.order_status === "TERMINATED") {
    await admin.from("orders").update({ payment_status: "failed" }).eq("id", order.id).eq("payment_status", "pending");
  }
  return ok();
});
