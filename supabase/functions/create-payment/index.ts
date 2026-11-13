// Called by the app after place_order() for online orders.
// Creates a Cashfree order and returns the payment_session_id the app needs to open checkout.
// Secrets (set in Supabase, never in the app): CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV, APP_URL
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: auth } = await asUser.auth.getUser();
    if (!auth?.user) return json({ error: "Please log in" }, 401);

    const { order_id } = await req.json();
    // RLS means a customer can only read their own order here.
    const { data: order, error } = await asUser.from("orders").select("*").eq("id", order_id).single();
    if (error || !order) return json({ error: "Order not found" }, 404);
    if (order.payment_method !== "online" || order.payment_status !== "pending" || order.status === "cancelled") {
      return json({ error: "This order does not need payment" }, 400);
    }

    const base = Deno.env.get("CASHFREE_ENV") === "production"
      ? "https://api.cashfree.com"
      : "https://sandbox.cashfree.com";
    const headers = {
      "Content-Type": "application/json",
      "x-api-version": "2023-08-01",
      "x-client-id": Deno.env.get("CASHFREE_APP_ID")!,
      "x-client-secret": Deno.env.get("CASHFREE_SECRET_KEY")!,
    };

    const phone = String(order.address?.phone ?? "").replace(/\D/g, "").slice(-10);
    if (phone.length !== 10) return json({ error: "A 10-digit phone number is needed on the address" }, 400);

    const cfOrderId = `FS${order.id}`;
    const appUrl = Deno.env.get("APP_URL")!;
    let res = await fetch(`${base}/pg/orders`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        order_id: cfOrderId,
        order_amount: Number(order.total),
        order_currency: "INR",
        customer_details: { customer_id: auth.user.id, customer_phone: phone },
        order_meta: {
          return_url: `${appUrl}/?order=${order.id}&cf_order_id={order_id}`,
          notify_url: `${url}/functions/v1/cashfree-webhook`,
        },
      }),
    });
    let cf = await res.json();

    // Customer retried payment: the Cashfree order already exists, so fetch it instead.
    if (!res.ok && (cf?.code === "order_already_exists" || res.status === 409)) {
      res = await fetch(`${base}/pg/orders/${cfOrderId}`, { headers });
      cf = await res.json();
    }
    if (!res.ok || !cf?.payment_session_id) {
      console.error("Cashfree error", res.status, JSON.stringify(cf));
      return json({ error: "Could not start payment. Please try again." }, 502);
    }

    await admin.from("orders").update({ cashfree_order_id: cfOrderId }).eq("id", order.id);
    return json({ payment_session_id: cf.payment_session_id, cashfree_order_id: cfOrderId, env: Deno.env.get("CASHFREE_ENV") ?? "sandbox" });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong" }, 500);
  }
});
