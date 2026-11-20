/* AETHER · builds the abstract Halloween stage and the claw-slash effect. */
(function () {
  var AetherStage = {
    /** o: { cracks, moon, branch, bats, haunt, spider, peek } */
    mount: function (o) {
      o = o || {};
      var s = document.createElement("div");
      s.className = "stage"; s.setAttribute("aria-hidden", "true");
      var h = (o.cracks ? '<img class="cracks" src="assets/cracks.webp" alt="">' : '') + '<i class="blob b1"></i><i class="blob b2"></i><i class="blob b3"></i>' +
        '<i class="band" style="top:260px"></i><i class="band" style="top:520px;animation-delay:-4s;width:42%"></i><i class="band" style="top:760px;animation-delay:-7s"></i>';
      if (o.moon) h += '<img class="moon" src="assets/moon.webp" alt="">';
      if (o.bats) h += '<img class="bats" src="assets/bats.webp" alt=""><img class="bats rev" src="assets/bats.webp" alt="">';
      if (o.haunt) h += '<img class="haunt" src="assets/ghost-scary.webp" alt="">';
      if (o.branch) h += '<img class="branch" src="assets/branch.webp" alt="">';
      if (o.peek) h += '<img class="peek" src="assets/casper.webp" alt="">';
      if (o.spider) h += '<div class="spider"><i></i><img src="assets/spider.webp" alt=""></div>';
      s.innerHTML = h;
      document.body.insertBefore(s, document.body.firstChild);
      return s;
    },
    /** Claw marks slash across an element (it must be position:relative with overflow hidden). */
    slash: function (el) {
      if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      var c = el.querySelector(".claws");
      if (!c) { c = document.createElement("img"); c.className = "claws"; c.alt = ""; c.src = "assets/claws.webp"; el.appendChild(c); }
      c.classList.remove("go"); void c.offsetWidth; c.classList.add("go");
    }
  };
  window.AetherStage = AetherStage;

})();
