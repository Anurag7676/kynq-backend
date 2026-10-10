// PDF invoices (pdfkit). The built-in PDF fonts have no ₹ glyph, so amounts read "INR 1,234.00",
// which is also the usual style on Indian invoices.
import PDFDocument from "pdfkit";

const INK = "#15103A", DIM = "#5B5875", LINE = "#D9D6E8", ACCENT = "#6D35E8";
const inr = (n) => `INR ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)}`;
const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "–");

function seller(s) {
  return [
    s.legalName || s.tradeName || "kynq",
    s.legalName && s.tradeName ? `Trading as ${s.tradeName}` : null,
    s.address, [s.city, s.state, s.pincode].filter(Boolean).join(", ") || null,
    s.email ? `Email: ${s.email}` : null, s.phone ? `Phone: ${s.phone}` : null,
    s.pan ? `PAN: ${s.pan}` : null, s.gstRegistered && s.gstin ? `GSTIN: ${s.gstin}` : null,
  ].filter(Boolean);
}

/** Renders into a Buffer. `draw(doc)` lays out the body. */
function render(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Producer: "kynq", Creator: "kynq admin" } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try { draw(doc); doc.end(); } catch (err) { reject(err); }
  });
}

function header(doc, { title, number, rows, settings, stamp }) {
  doc.fillColor(ACCENT).font("Helvetica-Bold").fontSize(22).text(settings.tradeName || "kynq", 48, 48);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(18).text(title, 300, 48, { width: 247, align: "right" });
  // Labels and values in two fixed columns, so long values never run into their label.
  let y = 76;
  for (const [k, v] of [["Invoice no", number], ...rows]) {
    doc.font("Helvetica").fontSize(9.5).fillColor(DIM).text(k, 330, y, { width: 80 });
    doc.font("Helvetica-Bold").fillColor(INK).text(String(v ?? "–"), 410, y, { width: 137, align: "right" });
    y += 14;
  }
  if (stamp) {
    const color = stamp === "PAID" ? "#1F9D55" : "#B42318";
    const w = doc.font("Helvetica-Bold").fontSize(9).widthOfString(stamp) + 18;
    doc.roundedRect(547 - w, y + 4, w, 18, 9).fill(color);
    doc.fillColor("#FFFFFF").text(stamp, 547 - w, y + 9, { width: w, align: "center" });
    y += 24;
  }
  return y + 10;
}

function parties(doc, y, settings, toLines) {
  doc.font("Helvetica-Bold").fontSize(9).fillColor(DIM).text("FROM", 48, y).text("BILL TO", 300, y);
  doc.font("Helvetica").fontSize(10).fillColor(INK);
  const from = seller(settings);
  doc.text(from.join("\n"), 48, y + 14, { width: 230 });
  const leftH = doc.y;
  doc.text(toLines.filter(Boolean).join("\n"), 300, y + 14, { width: 247 });
  return Math.max(leftH, doc.y) + 18;
}

function table(doc, y, items) {
  const cols = [{ x: 48, w: 279, h: "Description" }, { x: 327, w: 50, h: "Qty", a: "right" }, { x: 377, w: 80, h: "Rate", a: "right" }, { x: 457, w: 90, h: "Amount", a: "right" }];
  doc.rect(48, y, 499, 22).fill("#F3F0FF");
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK);
  for (const c of cols) doc.text(c.h, c.x + 6, y + 7, { width: c.w - 12, align: c.a || "left" });
  y += 22;
  doc.font("Helvetica").fontSize(10);
  for (const it of items) {
    const h = Math.max(20, doc.heightOfString(it.description, { width: cols[0].w - 12 }) + 10);
    doc.fillColor(INK).text(it.description, cols[0].x + 6, y + 6, { width: cols[0].w - 12 });
    doc.text(String(it.qty), cols[1].x + 6, y + 6, { width: cols[1].w - 12, align: "right" });
    doc.text(inr(it.rate), cols[2].x + 6, y + 6, { width: cols[2].w - 12, align: "right" });
    doc.text(inr(it.qty * it.rate), cols[3].x + 6, y + 6, { width: cols[3].w - 12, align: "right" });
    y += h;
    doc.moveTo(48, y).lineTo(547, y).strokeColor(LINE).lineWidth(0.7).stroke();
  }
  return y + 8;
}

function totals(doc, y, lines) {
  for (const [label, value, strong] of lines) {
    doc.font(strong ? "Helvetica-Bold" : "Helvetica").fontSize(strong ? 11.5 : 10).fillColor(strong ? INK : DIM);
    doc.text(label, 327, y, { width: 130, align: "right" });
    doc.fillColor(INK).text(value, 457, y, { width: 84, align: "right" });
    y += strong ? 20 : 16;
  }
  return y + 6;
}

function footer(doc, y, text) {
  doc.font("Helvetica").fontSize(9).fillColor(DIM).text(text, 48, Math.max(y + 10, 700), { width: 499 });
}

/** One paid Koin order. */
export function koinInvoicePdf({ order, buyer, settings }) {
  return render((doc) => {
    const refunded = order.status === "refunded";
    let y = header(doc, {
      title: "Invoice", number: order.invoiceNo, settings, stamp: refunded ? "REFUNDED" : "PAID",
      rows: [["Date", fmtDate(order.invoiceDate)], ["Order", order.id], ...(order.cashfreeOrderId && order.cashfreeOrderId !== order.id ? [["Payment ref", order.cashfreeOrderId]] : [])],
    });
    y = parties(doc, y + 6, settings, [buyer.name || "Customer", buyer.email, buyer.phone ? `Phone: ${buyer.phone}` : null]);
    y = table(doc, y, [{ description: `${order.coins} Koins: kynq in-app currency (digital, credited instantly)${settings.gstRegistered && settings.sacCode ? `\nSAC ${settings.sacCode}` : ""}`, qty: 1, rate: order.amount }]);
    const lines = [["Subtotal", inr(order.amount)]];
    // Koin pack prices are GST-inclusive once registered; until then there's no tax line.
    if (settings.gstRegistered && settings.gstRate) {
      const base = order.amount / (1 + settings.gstRate / 100);
      lines.splice(0, 1, ["Taxable value", inr(base)], [`GST ${settings.gstRate}% (included)`, inr(order.amount - base)]);
    }
    lines.push(["Total paid", inr(order.amount), true]);
    if (refunded) lines.push(["Refunded", inr(order.amount)]);
    y = totals(doc, y, lines);
    footer(doc, y, `${settings.invoiceFooter || ""}\nPaid online via Cashfree. Questions: ${settings.email || "hi@kynq.in"}`);
  });
}

/** An invoice we send to a client (brand deal, sponsorship…). */
export function clientInvoicePdf(inv, settings) {
  return render((doc) => {
    let y = header(doc, {
      title: "Invoice", number: inv.number, settings, stamp: inv.status === "paid" ? "PAID" : inv.status === "void" ? "VOID" : null,
      rows: [["Issued", fmtDate(inv.issueDate)], ...(inv.dueDate ? [["Due", fmtDate(inv.dueDate)]] : [])],
    });
    y = parties(doc, y + 6, settings, [inv.client.name, inv.client.address, inv.client.email, inv.client.gstin ? `GSTIN: ${inv.client.gstin}` : null]);
    y = table(doc, y, inv.items);
    const lines = [["Subtotal", inr(inv.subtotal)]];
    if (inv.gstRate) lines.push([`GST ${inv.gstRate}%`, inr(inv.gst)]);
    lines.push(["Total", inr(inv.total), true]);
    if (inv.status === "paid" && inv.paidDate) lines.push(["Paid on", fmtDate(inv.paidDate)]);
    y = totals(doc, y, lines);
    if (inv.notes) { doc.font("Helvetica-Bold").fontSize(9).fillColor(DIM).text("NOTES", 48, y); doc.font("Helvetica").fontSize(10).fillColor(INK).text(inv.notes, 48, y + 13, { width: 499 }); y = doc.y + 10; }
    footer(doc, y, settings.invoiceFooter || "");
  });
}
