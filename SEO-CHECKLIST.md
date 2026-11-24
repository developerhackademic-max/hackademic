# SEO Checklist

## Completed in the codebase

| Page | Done |
|---|---|
| `/` | Unique title and meta description, canonical, favicon, Open Graph, Twitter Card, Dehradun keyword H1, Organization/EducationalOrganization and BreadcrumbList JSON-LD, lazy course imagery, GA4 and Search Console placeholders |
| `/about.html` | Unique title and description, canonical, favicon, social tags, one About Hackademic H1, Organization and BreadcrumbList JSON-LD, responsive navigation and shared footer |
| `/contact.html` | Unique title and description, canonical, favicon, social tags, one contact-focused H1, ContactPage and BreadcrumbList JSON-LD, accessible enquiry form, Dehradun contact details and shared footer |
| `/courses.html` | Unique title and description, canonical, social tags, location-focused H1, main landmark, BreadcrumbList JSON-LD, course image dimensions and lazy loading |
| `/course-graphic-design.html` | Unique title and description, canonical, favicon, social tags, location-focused H1, Course and BreadcrumbList JSON-LD, descriptive image alts and dimensions |
| `/course-web-development.html` | Unique title and description, canonical, favicon, social tags, Course and BreadcrumbList JSON-LD, full curriculum, descriptive course-tool labels |
| `/course-ccna.html` | Unique title and description, canonical, favicon, social tags, Course and BreadcrumbList JSON-LD, full curriculum and networking tools |
| `/course-threat-intelligence.html` | Unique title and description, canonical, favicon, social tags, Course and BreadcrumbList JSON-LD, full curriculum, threat intelligence tools and projects |
| `/course-cyber-security.html` | Unique title and description, canonical, favicon, social tags, Course and BreadcrumbList JSON-LD, full curriculum, security tools and projects |
| `/services.html` | Unique title and description, canonical, favicon, social tags, institute-focused H1, Service and FAQPage JSON-LD, corrected H2/H3 hierarchy |
| `/careers.html` | Unique title and description, canonical, favicon, social tags and exactly one H1 |
| `/certificate.html` | Unique title and description, canonical, favicon, social tags, verification-focused H1 and FAQPage JSON-LD |
| `/quotation.html` | Unique title and description, canonical, favicon, social tags and quotation-focused H1 |
| `/portal.html` | Unique title and description, canonical, favicon, social tags and portal-focused H1 |
| `/privacy-policy.html` | Unique title and description, canonical, favicon, social tags and one H1 |
| `/terms.html` | Unique title and description, canonical, favicon, social tags and one H1 |
| `/404.html` | Custom 404 response, noindex directive and navigation back home |

### Technical changes
- Added `public/sitemap.xml` and `public/robots.txt`.
- Updated Node static-file handling so missing pages return HTTP 404 and serve `404.html`.
- Added XML and text MIME types.
- Added Google Analytics 4 and Search Console placeholders on the homepage.
- Added `lang="en"` and viewport metadata to public pages.
- Added `defer` to selected non-critical page scripts.
- Preserved existing page layouts and navigation.

## Manual work still required

1. Replace `G-XXXXXXXXXX` with the real GA4 measurement ID and install the GA4 script approved for this site.
2. Replace `VERIFICATION_CODE` with the Google Search Console HTML verification token.
3. Submit `https://www.hackademic.in/sitemap.xml` in Google Search Console.
4. Verify HTTPS, canonical domain and redirect behaviour (`www`/non-`www`, HTTP/HTTPS).
5. Claim and complete the Google Business Profile for Dehradun and add accurate opening hours, phone number, address and course categories.
6. Add high-quality local backlinks from education directories, partner organizations and Uttarakhand business listings.
7. Replace illustrative course statistics and reviews with verified evidence or approved content.
8. Add original syllabus, faculty, fees and placement content to thin course pages.
9. Configure production analytics consent/Cookie handling according to applicable privacy requirements.
10. Generate and upload a branded SVG/PNG favicon where possible.
11. Review page titles and descriptions after publishing under the production domain.
