# Utkarsh Minds — project instructions

Persistent working instructions for Claude Code sessions on this repository.

## Project

Redesign of the existing Utkarsh Minds website: https://utkarshminds.com/index.html

Design / information-architecture reference: https://talentsprint.com/course/agentic-and-generative-ai-iisc

TalentSprint is **only** a reference for design quality, information hierarchy, course
presentation, CTA placement, responsiveness and overall UX. Do **not** copy its branding,
text, images or exact design. The site must have its own Utkarsh Minds identity.

## Client requirements

- Modern, professional, responsive UI — mobile-first
- Fast performance
- Clear navigation
- Apply Now / Enquire Now / Contact Us / Download Brochure CTAs
- WhatsApp, phone, email and enquiry integrations

### Main offerings

Data Science · Artificial Intelligence · Machine Learning · Generative AI · Python · SQL ·
Power BI · Live Projects · Internships · Placement Assistance · Corporate Training ·
Faculty Development Programs · Workshops & Bootcamps · Research & Journal Publication
Support · Engineering & MBA Training Programs

### Pages eventually required

Home · About · Courses · Corporate Training · Research & Journal · Faculty · Student
Success Stories · Placement · Events · Blog · Contact · FAQ

### Journal eventually needs

Article pages · categories/filtering · search · featured articles · authors · sharing ·
SEO URLs · related articles

### SEO eventually needs

Page metadata · proper heading hierarchy · alt text · Organization/Course/FAQ/Article/
Breadcrumb schema · sitemap.xml · robots.txt · canonical URLs · internal linking ·
Open Graph/Twitter metadata · Core Web Vitals optimization · GA4/Search Console
readiness · local SEO

## Current state (summary)

- The project has a frontend and some Supabase backend work. The frontend is too basic
  and lacks relevant content. Only one course is implemented.
- `astro-site/` is the active frontend (Astro 5, static output). The `.html`/`.js`/`.css`
  files at the repo root are an older static version.
- Supabase project: auth, `profiles` (role = `student` | `assistant`), enrollments,
  payments/receipts, resumes, LinkedIn generator, `marketing_leads`.
- SQL migrations live at the repo root (`init.sql`, `phase1`–`phase10_*.sql`,
  `marketing_leads.sql`) and are run **manually** in the Supabase SQL Editor. Follow
  the existing phase-file header convention (HOW TO RUN / WHY, safe to re-run).
- Edge Functions live in `supabase/functions/`. Their secrets are set as Supabase
  secrets, never committed.
- Website enquiry forms (brochure, demo lecture, next-batch alert) all use
  `LeadCaptureDialog.astro` and the `lead-otp` Edge Function (email OTP via Resend with
  cPanel SMTP fallback, Turnstile CAPTCHA). Leads are managed in the Assistant
  Dashboard's Leads tab. Setup: `docs/otp-and-leads-setup.md`; accounts/secrets map:
  `HANDOVER.md`. Validation rules are shared: `supabase/functions/lead-otp/rules.ts`.
- Tests for that feature: `deno test --allow-read --allow-env supabase/functions/lead-otp/`.
- `DECISIONS.md` is the running log of non-obvious decisions — add to it.
- `RESET_BEFORE_GO_LIVE.md` is a one-time, destructive pre-launch procedure — never run
  it casually.

## Working rules

1. First inspect and understand the existing repository.
2. Preserve useful existing code instead of unnecessarily rebuilding everything.
3. Reuse the existing Supabase implementation where appropriate.
4. Never invent important business facts, statistics, testimonials, faculty credentials,
   placement numbers, prices, addresses, partnerships, certifications or course details.
5. If important business/content information is missing, ask.
6. Ask before making important product/design/architecture decisions where multiple
   reasonable options exist.
7. Files may be read, created and edited autonomously when implementing an approved task.
8. Safe development/build/lint commands may be run as needed.
9. **Never** delete files, folders, database tables, database records or major existing
   functionality without asking first.
10. Never expose secrets, API keys, Supabase service-role keys or credentials.
11. Do not make unrelated changes.
12. Prefer reusable components and maintainable architecture.
13. Keep responsive design, accessibility, SEO and performance in mind from the start.
14. Do not make the UI look like a generic AI-generated template.
15. Do not implement the entire redesign in one huge step.
16. Do not begin implementation of a plan until it has been approved.

## Git rules

- **Never commit or push directly to `main`.** All work goes on a feature branch; it is
  tested there and merged into `main` only after the owner approves.
- Commits must be attributed to **Rajat only**:
  - Author/committer: `Rajat Raghatwan` (set per repo with `git config --local`).
  - Do **not** add `Co-Authored-By:` trailers, `Claude-Session:` lines, or any
    "Generated with Claude Code" / Claude mention in commit messages, PR titles or
    PR descriptions.
- Never commit `.env` files, credentials or `node_modules/`.

## Security baseline for any form or user input

- Validate and normalise on the **server** (Edge Function / SQL constraint), not only in
  the browser — client-side checks are for UX only.
- Render user-supplied text with `textContent`, never `innerHTML`.
- Escape spreadsheet formula characters (`= + - @`, tab, CR) when exporting data that
  will be opened in Excel / Google Sheets.
- Rate-limit anything that sends an email or SMS.
