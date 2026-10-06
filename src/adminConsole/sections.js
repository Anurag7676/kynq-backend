// The admin dashboard's sidebar sections — the unit RBAC grants access by.
// One entry per top-level nav item (see kynq-admin/components/layout/nav.ts,
// which must be kept in sync by hand: same keys, same labels).
export const SECTIONS = [
  { key: "overview", label: "Overview" },
  { key: "analytics", label: "Analytics" },
  { key: "nudges", label: "Nudges" },
  { key: "traffic", label: "Traffic" },
  { key: "seo", label: "SEO" },
  { key: "finance", label: "Finance" },
  { key: "moderation", label: "Moderation" },
  { key: "users", label: "Users" },
  { key: "ambassadors", label: "Ambassadors" },
  { key: "campus-links", label: "Campus links" },
  { key: "videos", label: "Demo videos" },
  { key: "inbox", label: "Inbox" },
  { key: "audit", label: "Audit log" },
];
