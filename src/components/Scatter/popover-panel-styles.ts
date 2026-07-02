// The SDK Popover portals its panel to document.body — OUTSIDE the widget
// subtree. On the platform the widget bundle's stylesheet is scoped to the
// widget container, so panel rules written in Scatter.css can never reach the
// portaled panels there (they only worked in the dev harness, where CSS is
// injected globally). Injecting a <style> into document.head at module load
// reaches the top document in every host, so these rules apply everywhere.
//
// The rules make the Popover panel itself invisible — no background, border,
// shadow, padding, or arrow notch — so the DropdownMenu inside it paints the
// only visible surface (it carries its own card: background, border, radius,
// shadow), matching the platform chart menu.

const STYLE_ID = 'scatter-popover-panel-styles';

const PANEL_IDS = [
  '#scatter-chart-title-menu',
  '#scatter-chart-control-menu',
  '#scatter-chart-export-menu',
];

const CSS = `
${PANEL_IDS.join(',\n')} {
  width: auto;
  min-width: 200px;
  padding: 0;
  background: transparent;
  border: none;
  box-shadow: none;
}

${PANEL_IDS.map((id) => `${id} .fds-popover__arrow`).join(',\n')} {
  display: none;
}

/* Edge-to-edge hairline between "View in full screen" and the Download Type
   section — the default separator is inset by horizontal padding. */
${PANEL_IDS.map((id) => `${id} .fds-action-list-item--separator`).join(',\n')} {
  padding: var(--spacing-01, 2px) 0;
}
`;

export function injectPopoverPanelStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}
