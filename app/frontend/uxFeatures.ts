// UX trial features (Alex, 2026-10-22): the eight improvements are on for
// testing, each behind its own switch, so "roll back number 7" is one line
// here (set it to false). Each also landed as its own commit, "UX-n: ...".
//   1 Skeleton charts while a filter change loads (no full-screen wait)
//   2 Copy link to the current view
//   3 Click a chart row to filter the page
//   4 Hover cards on bars (value, state, records)
//   5 "What changed" line with undo after a filter change
//   6 Saved views (in this browser)
//   7 Keyboard shortcuts (1-4 views, / filters, ? help)
//   8 Gentle transitions when bars change
export const UX: Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, boolean> = {
	1: true,
	2: true,
	3: true,
	4: true,
	5: true,
	6: true,
	7: true,
	8: true,
};
