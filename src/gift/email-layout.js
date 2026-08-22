// Shared HTML email shell — kynq's dark/brass palette, table-based layout
// with inline styles throughout (email clients strip <style> blocks and
// don't reliably support flexbox/grid, so this stays deliberately old-school).
// Used by otp.js and order-email.js so every kynq email looks like one system.

const COLORS = {
  estate: "#08060f",
  estateSoft: "#120f1d",
  estateEdge: "#26203a",
  brass: "#7c5cff",
  brassSoft: "#9d84ff",
  purple: "#ff4d97",
  ink: "#f2eeff",
  inkDim: "#a49db8",
  inkFaint: "#6f6885",
};

// System-font stack only — no @font-face in email, most clients strip it.
const DISPLAY_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO_FONT = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const LOGO_URL = `${CLIENT_URL}/images/kynq-logo.png`;

export function eyebrow(text) {
  return `<p style="margin:0 0 12px;font-family:${MONO_FONT};font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:${COLORS.brassSoft};">${text}</p>`;
}

export function heading(text) {
  return `<h1 style="margin:0 0 16px;font-family:${DISPLAY_FONT};font-size:26px;font-weight:600;color:${COLORS.ink};line-height:1.3;">${text}</h1>`;
}

export function paragraph(text) {
  return `<p style="margin:0 0 16px;font-family:${DISPLAY_FONT};font-size:15px;line-height:1.6;color:${COLORS.inkDim};">${text}</p>`;
}

export function button(text, href) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
      <tr>
        <td style="border-radius:999px;background:${COLORS.brass};">
          <a href="${href}" style="display:inline-block;padding:14px 28px;font-family:${DISPLAY_FONT};font-size:14px;font-weight:600;color:${COLORS.estate};text-decoration:none;border-radius:999px;">${text}</a>
        </td>
      </tr>
    </table>`;
}

export function divider() {
  return `<hr style="border:none;border-top:1px solid ${COLORS.estateEdge};margin:24px 0;" />`;
}

export function renderEmailLayout({ preheader = "", bodyHtml }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>kynq</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.estate};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.estate};padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
          <tr>
            <td style="padding-bottom:28px;">
              <img src="${LOGO_URL}" width="28" height="28" alt="kynq" style="display:inline-block;vertical-align:middle;border-radius:6px;" />
              <span style="display:inline-block;vertical-align:middle;margin-left:8px;font-family:${DISPLAY_FONT};font-size:20px;font-weight:600;color:${COLORS.ink};">kynq</span>
            </td>
          </tr>
          <tr>
            <td style="background:${COLORS.estateSoft};border:1px solid ${COLORS.estateEdge};border-radius:20px;padding:36px 32px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding-top:24px;text-align:center;">
              <p style="margin:0;font-family:${MONO_FONT};font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.inkFaint};">
                kynq &middot; curated gifts, made with love in India
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export { COLORS, DISPLAY_FONT, MONO_FONT, CLIENT_URL };
