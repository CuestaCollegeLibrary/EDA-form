# Device Agreements (Alma Cloud App, private)

Staff-only Alma Cloud App for Cuesta College Library. Records a signed electronic device loan agreement
as a pop-up note on a patron record ("Device agreement signed - <semester>").

What it does
- One patron: open a patron in Alma (or type an ID) -> shows whether the note exists -> "Mark signed".
- From a list: paste the Student ID column (or a .csv) -> "Check" (read-only) -> confirm -> "Add notes".
- Settings page (config): current semester, note text, note type code, pop-up / patron-visible.

Sync from a Google Sheet (v0.2)
- Settings page: paste the sheet's "Publish to web" CSV link. The link is stored in Alma's app settings, never in the code.
- "From a list" tab: "Load sign-ups from the Google Sheet" reads the sheet. Only rows for the current semester are used.
- Each sign-up is checked against Alma. If the name on the form does not fit the patron, the row is held for review
  and gets no note unless staff tick "Add anyway".
- UNVERIFIED: whether a browser inside Alma may read a published sheet (CORS). If it fails, use paste or upload.

What it never does
- Never deletes or edits existing data. It only appends one note, and skips patrons who already have it.
- Stores nothing outside Alma. The pasted list stays in the browser tab. The results CSV has IDs only.

NOT YET VERIFIED IN REAL ALMA (verify in the sandbox first)
- Note type code "LIBRARY" must exist in your note-type code table (change on the settings page).
- Field names popup_note / user_viewable / segment_type on user_note.
- PUT of the full user record round-trips cleanly (no required fields stripped).
- Patron lookup by Student ID (all_unique id types).

Run / build (needs Node 18+ on one machine)
  npm install
  npx eca start      # dev server on http://localhost:4200, then in the Alma SANDBOX add ?almaUrl... (see Ex Libris docs)
  npx eca build      # produces build/

Set the sandbox URL in config.json ("env") before `eca start`.
