# Design QA｜茸光宠物洗护小程序

## Evidence

- Source visual truth: `design-reference/mp-01-option-1.png`
- Browser-rendered implementation: `design-qa/implementation-home.png`
- Full-view side-by-side comparison: `design-qa/home-comparison.png`
- Focused appointment-region comparison: `design-qa/home-focus-appointment.png`
- Browser: Codex in-app browser, local Vite preview at `http://127.0.0.1:4173/`
- Compared state: MP-01 首页｜有未来预约｜iPhone
- CSS viewport: `393 × 852`
- Source pixels: `853 × 1844`; normalized to `393 × 852` with Lanczos resampling for comparison
- Implementation pixels: `393 × 852`, `deviceScaleFactor: 1`
- Browser QA viewport: `1400 × 1200`; verified `[data-phone-screen]` at exactly `393 × 852` before visual review
- Device chrome: the source intentionally omitted device chrome; the implementation preserves the mobile template’s protected iPhone status bar, Dynamic Island, bezel and home indicator. Fidelity was judged on app-owned content.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the implementation retains the source’s Songti-style brand wordmark and system sans-serif product typography. Booking time, price and code use stable tabular numerals; hierarchy and wrapping remain readable at the 393px viewport.
- Spacing and layout rhythm: hero photography, primary CTA, appointment card and service discovery preserve the source order and relative emphasis. The protected device chrome reduces the immediately visible height versus the chrome-free source, so the promise row scrolls beneath the fixed navigation on iPhone; this is an intentional runtime constraint rather than app-content overflow.
- Colors and tokens: cream canvas, off-white surfaces, deep sage primary actions, pale sage selection states and restrained coral attention cues match the selected direction and map consistently across all screens.
- Image quality: all visible pets, hero photography and employee portraits use independent raster assets with the same warm natural-light art direction. Crops remain sharp and correctly framed at avatar and hero sizes; no CSS art, placeholder shapes, emoji or handcrafted SVG imagery substitutes are present.
- Copy and content: the UI uses the PRD’s domain language (“预约”“员工”“增项”“核销码”“爽约”“服务终止”) and does not introduce payment, membership, coupons, ratings or multi-store capabilities.
- Icons and accessibility: interface icons come from one consistent icon set. Visible homepage controls were measured in the browser; no interactive target was below `44 × 44px`. Focus styles, labels, selected states and non-color status text are present.
- Responsive behavior: iPhone `393 × 852` and Pixel 10 `427 × 952` were visually inspected. No horizontal overflow or clipped persistent controls appeared.

## Interaction evidence

- Complete booking path tested: 首页 → 选择宠物 → 服务与增项 → 员工偏好 → 日期与时段 → 确认预约 → 预约成功.
- Conflict path tested by selecting `16:30`: the inline conflict state preserved prior selections and displayed three nearby suggestions.
- Appointment detail tested: six-digit verification code, valid time window, reschedule and cancel actions were visible.
- Cancellation consequence sheet tested and opened successfully.
- iPhone / Pixel 10 device switching tested.
- Browser console checked after the primary interactions: no warnings or errors.
- Runtime integration tests: 8 passed.
- Sites packaging tests: 4 passed.

## Focused comparison

The appointment-card crop was reviewed separately because the full-screen comparison makes its small labels difficult to judge. Status, time, pet, service, employee and detail action remain legible; alignment, divider treatment and card radius preserve the source’s visual grammar.

## Comparison history

- Pass 1: source and implementation were normalized and combined into `design-qa/home-comparison.png`; no P0/P1/P2 mismatch was found.
- Focus pass: appointment region combined into `design-qa/home-focus-appointment.png`; no additional P0/P1/P2 mismatch was found.
- No visual fix loop was required after the formal comparison. The final evidence is the same browser-rendered pass described above.

## Follow-up polish

- P3: the generated hero asset uses a slightly softer, closer crop than the concept image. It preserves the selected direction and improves text contrast, so it is accepted for this design round.

final result: passed
