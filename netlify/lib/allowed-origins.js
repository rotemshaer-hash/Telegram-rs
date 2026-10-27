// The one list of origins the browser-facing functions answer (CORS).
//
// The first entry is also the base of links these functions put in emails
// (parent-consent builds the consent link from it), so it is the *canonical*
// site. Moving the canonical site to drushe.com is a one-line change here —
// put drushe.com first once Netlify serves it as the primary domain.
module.exports = [
  'https://kidemy-app.netlify.app',
  'https://drushe.com',
  'https://www.drushe.com',
  'capacitor://localhost',
  'http://localhost',
];
