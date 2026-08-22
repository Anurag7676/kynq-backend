// Order confirmation email — sent once, right when an order transitions to
// "paid" (demo-mode checkout, the Cashfree webhook, and the GET /orders/:id
// reconciliation fallback all call this; each already guards against
// calling it more than once per order — see the call sites).
import { sendEmail } from "../config/emailConfig.js";
import { renderEmailLayout, eyebrow, heading, paragraph, button, divider, COLORS, MONO_FONT, CLIENT_URL } from "./email-layout.js";

function money(amount, currency = "INR") {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount ?? 0);
}

function itemRow(item) {
  const variantBits = item.variant
    ? [item.variant.colorName, item.variant.sizeLabel, item.variant.wrapLabel].filter(Boolean).join(" · ")
    : "";
  return `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid ${COLORS.estateEdge};">
        <p style="margin:0;font-family:${MONO_FONT};font-size:14px;color:${COLORS.ink};">${item.name}</p>
        ${variantBits ? `<p style="margin:4px 0 0;font-family:${MONO_FONT};font-size:11px;color:${COLORS.inkFaint};">${variantBits}</p>` : ""}
        <p style="margin:4px 0 0;font-family:${MONO_FONT};font-size:11px;color:${COLORS.inkFaint};">qty ${item.qty}</p>
      </td>
      <td style="padding:12px 0;border-bottom:1px solid ${COLORS.estateEdge};text-align:right;vertical-align:top;">
        <span style="font-family:${MONO_FONT};font-size:14px;color:${COLORS.ink};">${money(item.unitPrice * item.qty, item.currency)}</span>
      </td>
    </tr>`;
}

function totalRow(label, value, { strong = false } = {}) {
  const color = strong ? COLORS.ink : COLORS.inkDim;
  const size = strong ? "16px" : "13px";
  return `
    <tr>
      <td style="padding:4px 0;font-family:${MONO_FONT};font-size:${size};color:${color};">${label}</td>
      <td style="padding:4px 0;text-align:right;font-family:${MONO_FONT};font-size:${size};font-weight:${strong ? 600 : 400};color:${color};">${value}</td>
    </tr>`;
}

function orderEmail(order) {
  const itemsHtml = order.items.map(itemRow).join("");

  const totalsHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
      ${totalRow("subtotal", money(order.subtotal, order.currency))}
      ${totalRow("shipping", order.shipping === 0 ? "free" : money(order.shipping, order.currency))}
      ${order.tax ? totalRow("taxes", money(order.tax, order.currency)) : ""}
      ${totalRow("paid today", money(order.amountDueToday, order.currency), { strong: true })}
    </table>`;

  const addressHtml = order.shippingAddress
    ? `
      ${divider()}
      ${eyebrow("shipping to")}
      <p style="margin:0;font-family:${MONO_FONT};font-size:13px;line-height:1.7;color:${COLORS.inkDim};">
        ${order.shippingAddress.name}<br />
        ${order.shippingAddress.line1}${order.shippingAddress.line2 ? `<br />${order.shippingAddress.line2}` : ""}<br />
        ${order.shippingAddress.city}${order.shippingAddress.state ? `, ${order.shippingAddress.state}` : ""} ${order.shippingAddress.postalCode || ""}<br />
        ${order.shippingAddress.country || ""}
      </p>`
    : "";

  const firstName = (order.customer.name || "").trim().split(/\s+/)[0] || "there";

  const bodyHtml = `
    ${eyebrow(`order ${order.id}`)}
    ${heading(`thank you, ${firstName}.`)}
    ${paragraph("we're on it — tracking goes out the morning we hand your package to the courier.")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsHtml}</table>
    ${totalsHtml}
    ${addressHtml}
    ${divider()}
    ${button("view your order", `${CLIENT_URL}/orders/${order.id}`)}
  `;

  const text = `thank you, ${firstName}.\n\norder ${order.id}\n\n` +
    order.items.map((i) => `${i.name} x${i.qty} — ${money(i.unitPrice * i.qty, i.currency)}`).join("\n") +
    `\n\npaid today: ${money(order.amountDueToday, order.currency)}\n\nview your order: ${CLIENT_URL}/orders/${order.id}`;

  return {
    subject: `your kynq order — ${order.id}`,
    text,
    html: renderEmailLayout({ preheader: `Order confirmed — ${money(order.amountDueToday, order.currency)}`, bodyHtml }),
  };
}

export async function sendOrderConfirmationEmail(order) {
  if (!order.customer?.email) return;
  if (process.env.EMAIL_USERNAME && process.env.EMAIL_PASSWORD) {
    await sendEmail({ to: order.customer.email, ...orderEmail(order) });
  } else {
    console.log(`\n──────── ORDER CONFIRMATION (demo mode) ────────\nto:    ${order.customer.email}\norder: ${order.id}\n────────────────────────────────────────\n`);
  }
}
