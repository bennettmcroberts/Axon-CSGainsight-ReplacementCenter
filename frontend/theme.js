/* Compact light/dark toggle — shared across classic UI, Axon UI, and Resource Library. */
(function () {
  const KEY = 'cscc-color-theme';
  const ICON_SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const ICON_MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>';

  function defaultTheme() {
    if (document.documentElement.getAttribute('data-ui') === 'axon') return 'light';
    if (location.pathname.indexOf('/resources/') !== -1) return 'light';
    if (location.pathname.indexOf('/axon') === 0) return 'light';
    return 'dark';
  }

  function getTheme() {
    const t = localStorage.getItem(KEY);
    return t === 'dark' || t === 'light' ? t : defaultTheme();
  }

  function applyTheme(t) {
    const theme = t === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(KEY, theme);
    window.CSCC_THEME = theme;
    document.querySelectorAll('#themeToggle, .theme-toggle').forEach(function (btn) {
      const next = theme === 'dark' ? 'light' : 'dark';
      btn.innerHTML = theme === 'dark' ? ICON_SUN : ICON_MOON;
      btn.setAttribute('aria-label', 'Switch to ' + next + ' mode');
      btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
      btn.title = next === 'dark' ? 'Dark mode' : 'Light mode';
    });
    if (typeof window.route === 'function' && window.STATE && window.STATE.tree) {
      try { window.route(); } catch (e) { /* ignore */ }
    }
  }

  function toggleTheme() {
    applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
  }

  applyTheme(getTheme());
  window.toggleColorTheme = toggleTheme;
  window.getColorTheme = getTheme;

  document.addEventListener('DOMContentLoaded', function () {
    applyTheme(getTheme());
    document.querySelectorAll('#themeToggle, .theme-toggle').forEach(function (btn) {
      btn.addEventListener('click', toggleTheme);
    });
  });
})();
