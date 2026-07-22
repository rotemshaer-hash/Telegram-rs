// Minimal fake window.emailjs for smoke tests — avoids real network calls / OAuth.
(function () {
  window.emailjs = {
    init: () => {},
    send: () => Promise.resolve({ status: 200, text: 'OK' }),
  };
})();
