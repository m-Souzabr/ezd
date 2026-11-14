// Runs before the first paint so a dark theme never flashes light. It is a file of its own (not
// an inline script) so the Content-Security-Policy `script-src 'self'` stays as strict as it is.
// The key and the rule are the ones `ThemeProvider` uses.
(function () {
  var theme = 'system';
  try {
    var stored = localStorage.getItem('app-theme');
    if (stored === 'light' || stored === 'dark' || stored === 'system') theme = stored;
  } catch (error) {
    // Storage is unavailable: follow the system.
  }
  var dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
