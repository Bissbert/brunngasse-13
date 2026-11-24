// Zeichnet die Linienzeichen, sobald sie ins Bild kommen, für Browser ohne scroll-gesteuerte CSS-Animation.
(function () {
  var ruhig = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (ruhig || !('IntersectionObserver' in window)) return;
  if (window.CSS && CSS.supports && CSS.supports('animation-timeline: view()')) return;
  document.documentElement.classList.add('zeichnet');
  document.addEventListener('DOMContentLoaded', function () {
    var io = new IntersectionObserver(function (eintraege) {
      eintraege.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('gezeichnet'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -15% 0px' });
    document.querySelectorAll('.satz, .strasse').forEach(function (el) { io.observe(el); });
  });
})();
