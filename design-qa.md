# Ticket 09 Design QA

- Reference: `product-ui/admin/design-reference/mg-01-option-1.png`
- Implementation: `http://127.0.0.1:5174/manager/workbench`
- Comparison artifact: `/tmp/store-appointment-ticket09/workbench-comparison-final.png`
- Comparison viewport: 1440 × 1024; the reference was scaled to the browser capture size and reviewed side by side in one image.

## Comparison passes

1. The first pass found a vertically oversized page heading, a capacity strip absent from the reference, a large empty-risk surface, missing timeline grid marks, and a sidebar/wordmark width mismatch. The workbench was tightened to the reference hierarchy, capacity moved into the timeline summary, the empty state collapsed, real brand and staff imagery retained, and the timeline/sidebar geometry aligned.
2. The second pass aligned the status-panel and four-row timeline rhythm with the source, added half-hour labels and readable capacity segments, fixed the end-label clipping, and replaced the blank disabled date control with a visible disabled chevron.
3. The final combined comparison confirmed matching information order, page frame, brand palette, bordered surfaces, staff imagery, icon family, current-time marker, and desktop density. The reference's three risks and multiple appointments intentionally differ from the live API state, which correctly shows the required compact no-risk state and the one booking created by the end-to-end flow.

## Coverage

- Typography, spacing, borders, color tokens, image crop, icon alignment, dynamic copy, live/reconnecting state, loading skeleton, retained-data error, empty risk, forbidden state, direct routes, keyboard-semantic controls, alt text, reduced motion, and visible focus rules were checked.
- The workbench was inspected at 1440 × 1024, 1024 × 768, and 390 × 844. The narrow layouts keep controls readable and use deliberate horizontal overflow for the dense employee timeline rather than overlapping or clipping facts.
- MG-02 was inspected at desktop width with all four employee columns, off-shift, breaks, booking, turnover, date navigation, legend, and capacity summary visible.

Result: passed
