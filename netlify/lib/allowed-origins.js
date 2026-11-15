// The one list of origins the browser-facing functions answer (CORS).
//
// The first entry is also the base of links these functions put in emails
// (parent-consent builds the consent link from it), so it is the *canonical*
// site. drushe.com has been Netlify's primary domain; until 15.11.2026 parents
// were still sent to the old kidemy-app.netlify.app address, which still works
// and stays in the list for CORS.
module.exports = [
  'https://drushe.com',
  'https://kidemy-app.netlify.app',
  'https://www.drushe.com',
  'capacitor://localhost',
  'http://localhost',
];
