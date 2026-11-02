# Working guidance for Codex

## Purpose
Implement and verify a browser-only prototype for Japanese interior-door presentation board generation from quotation PDFs and floor-plan PDFs. The repository is public; all demo assets must be fictional.

## Principles
- Never check in customer documents, real addresses, floor plans, price quotations, or confidential product image databases.
- Preserve the no-backend architecture for the current prototype unless a user explicitly approves a backend.
- Imported PDF processing should run locally in the browser. Never send uploaded files to AI endpoints without explicit agreement.
- Imported quotation data is untrusted and may contain errors. Always allow manual correction.
- A room label is **not** proof of door opening location. Mark any auto-placed position as a candidate.
- Use relative paths so GitHub Pages works under /door-presentation-builder/.
- Keep the current print-to-PDF flow working, and verify Japanese text renders.
- Keep GitHub Pages deployment workflow and README up to date.

## Validation checklist
1. Run JavaScript syntax validation for assets/app.js.
2. Test app loads without console errors.
3. Test estimate PDF upload, including scanned-image PDF OCR manual trigger.
4. Test floorplan PDF upload and pin add/drag/remove.
5. Test catalog editing, image upload, JSON export/import.
6. Test A4 landscape printing and Pages subpath routing.
7. Avoid publishing any real customer examples.
