# NM-AI-04 interface contract

The source reference is the existing administration UI; no external design reference was supplied. Keep its Vietnamese typography, familiar forms and status patterns, while replacing platform branding with neutral AI Studio chrome. Scope the olive NẾP MÙI identity to that workspace's content, not the global Super Admin dashboard.

The platform dashboard's job is to choose/manage a workspace and inspect shared resources. Its primary action is creating a workspace. Use a compact workspace table, three resource counters, inline versioned editing, explicit active/archive labels and a two-step onboarding form. Reject marketing heroes, invented branding, decorative gradients and a uniform grid of oversized cards.

The workspace job is operating content and channels. Put the selector in the sidebar, the current brand inside the content area and focused management forms in the page. Channel registry rows show state, queue/attention counts, token presence and last accepted event without displaying credentials. Permission errors, read-only/archive state, empty lists, loading, validation and success feedback are explicit.

At 320/768/1024/1440px, keep the document within the viewport. Tables scroll within their own container; mobile navigation is a labelled drawer, forms stack and channel statistics use two columns. Use native buttons, labels, selects and visible keyboard focus. A keyboard-only skip link must not overlay touch screenshots. Browser tests exercise the real APIs and capture platform/workspace, agent, channel and team states on desktop/iPhone.
