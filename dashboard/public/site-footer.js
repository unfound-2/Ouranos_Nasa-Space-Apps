const slot = document.querySelector('[data-site-footer]')
if (slot) {
  slot.innerHTML = `
    <footer class="ouranos-footer">
      <img class="ouranos-footer-logo" src="/astronaut/mission-logo.png" width="443" height="464" alt="Ouranos logo" loading="lazy">
      <div class="ouranos-footer-row">
        <p class="ouranos-footer-note">OURANOS organises recorded evidence for human review. It does not diagnose or clear anyone for duty.</p>
        <nav class="ouranos-footer-links" aria-label="Footer">
          <a href="/legal/">Licenses &amp; credits</a>
          <a href="/legal/THIRD-PARTY-NOTICES.txt">Third-party notices</a>
          <a href="/legal/#nasa">NASA sources</a>
          <a href="/legal/#data">Data &amp; AI</a>
          <a href="https://github.com/unfound-2/NASASPACEAPP26/tree/feat/dhruv-mission-ui-v2">Source code</a>
        </nav>
      </div>
      <p class="ouranos-footer-credit">“Astronaut by Jungle Jim” by Jungle Jim is licensed under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Suit colors and shoulder patch were modified.</p>
    </footer>`
}
