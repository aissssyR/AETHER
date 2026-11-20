/* AETHER · GSAP motion layer.
 * Everything here is progressive enhancement: with no GSAP, or with prefers-reduced-motion, the page is fully
 * visible and static. Animations that would otherwise be hidden at start are created with gsap.from() inside
 * gsap.matchMedia(), so they only exist when motion is allowed. */
(function () {
  var g = window.gsap;
  if (!g) return;
  var ST = window.ScrollTrigger;
  try { if (ST) g.registerPlugin(ST); } catch (e) { ST = null; }
  document.documentElement.classList.add("gsap-on");

  var page = document.body.getAttribute("data-page") || "index";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var api = (window.AetherMotion = {});

  // ───────────────────────── dock: a highlight that glides to the hovered link ─────────────────────────
  function initDock() {
    var d = $("#dock"); if (!d) return;
    var ind = $(".dock-ind", d), links = $$("a", d), cur = $('a[aria-current="page"]', d), on = false;
    function to(a, instant) {
      var r = { x: a.offsetLeft, y: a.offsetTop, width: a.offsetWidth, height: a.offsetHeight, opacity: 1 };
      if (instant || !on) g.set(ind, r); else g.to(ind, Object.assign({ duration: 0.38, ease: "power3.out", overwrite: true }, r));
      on = true;
    }
    function back() { if (cur) to(cur); else { g.to(ind, { opacity: 0, duration: 0.25 }); on = false; } }
    links.forEach(function (a) {
      a.addEventListener("mouseenter", function () { to(a); });
      a.addEventListener("focus", function () { to(a); });
    });
    d.addEventListener("mouseleave", back);
    d.addEventListener("focusout", function (e) { if (!d.contains(e.relatedTarget)) back(); });
    window.addEventListener("resize", function () { if (cur) to(cur, true); });
    if (cur) to(cur, true);
  }

  // ───────────────────────── headline: words rise out of a mask ─────────────────────────
  function splitWords(el) {
    if (!el || el.dataset.split) return [];
    el.dataset.split = "1";
    var out = [];
    function wrap(node) { var w = document.createElement("span"), i = document.createElement("span"); w.className = "w"; i.className = "wi"; w.appendChild(i); i.appendChild(node); out.push(i); return w; }
    [].slice.call(el.childNodes).forEach(function (n) {
      if (n.nodeType === 3) {
        var frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(function (t) {
          if (!t) return;
          if (/^\s+$/.test(t)) frag.appendChild(document.createTextNode(" "));
          else frag.appendChild(wrap(document.createTextNode(t)));
        });
        el.replaceChild(frag, n);
      } else if (n.nodeType === 1) {
        el.replaceChild(wrap(n.cloneNode(true)), n);
      }
    });
    return out;
  }

  // ───────────────────────── balloon: swells slowly, bursts into beads ─────────────────────────
  var BEADS = ["#ff7a00", "#8e3bb5", "#b7e02a", "#fbe9d0", "#f2a93b", "#e8667a", "#7ee0c3"];
  function initBalloon() {
    var stage = $(".balloon-stage"), img = stage && $(".balloon", stage);
    if (!stage || !img) return;

    function burst() {
      var sr = stage.getBoundingClientRect(), br = img.getBoundingClientRect();
      var cx = br.left - sr.left + br.width / 2, cy = br.top - sr.top + br.height * 0.42;
      if (!isFinite(cx) || !isFinite(cy)) { cx = stage.clientWidth / 2; cy = stage.clientHeight / 2; }

      var flash = document.createElement("i"); flash.className = "flash";
      flash.style.cssText = "width:120px;height:120px;left:" + (cx - 60) + "px;top:" + (cy - 60) + "px";
      var ring = document.createElement("i"); ring.className = "ring";
      ring.style.cssText = "width:60px;height:60px;left:" + (cx - 30) + "px;top:" + (cy - 30) + "px";
      stage.appendChild(flash); stage.appendChild(ring);
      g.fromTo(flash, { scale: 0.2, opacity: 1 }, { scale: 2.6, opacity: 0, duration: 0.45, ease: "power2.out", onComplete: function () { flash.remove(); } });
      g.fromTo(ring, { scale: 0.3, opacity: 1 }, { scale: 4.2, opacity: 0, duration: 0.7, ease: "power2.out", onComplete: function () { ring.remove(); } });

      var made = 0;
      for (var i = 0; i < 84; i++) {
        var b = document.createElement("i"), s = 4 + Math.random() * 9;
        b.className = "bead";
        b.style.cssText = "width:" + s + "px;height:" + s + "px;left:" + (cx - s / 2) + "px;top:" + (cy - s / 2) + "px;background:" + BEADS[(Math.random() * BEADS.length) | 0] + ";box-shadow:inset -1px -1px 2px rgba(0,0,0,.28),inset 1px 1px 2px rgba(255,255,255,.55)";
        stage.appendChild(b); made++;
        var a = Math.random() * Math.PI * 2, dist = 60 + Math.random() * 200, d = 1.1 + Math.random() * 0.8;
        var dx = Math.cos(a) * dist, up = Math.sin(a) * dist * 0.75 - 30, fall = 140 + Math.random() * 190;
        (function (bead, dx, up, fall, d) {
          var tl = g.timeline({ onComplete: function () { bead.remove(); } });
          tl.to(bead, { x: dx, duration: d, ease: "power2.out" }, 0)
            .to(bead, { y: up, duration: d * 0.42, ease: "power2.out" }, 0)
            .to(bead, { y: up + fall, duration: d * 0.58, ease: "power2.in" }, d * 0.42)
            .to(bead, { opacity: 0, duration: 0.35 }, d - 0.2);
        })(b, dx, up, fall, d);
      }
      return made;
    }

    function wobble() { g.set(img, { rotation: Math.sin(performance.now() / 70) * this.progress() * 3 }); }

    var tl = g.timeline({ repeat: -1, paused: true });
    tl.set(img, { scale: 0.5, opacity: 1, rotation: 0 })
      .to(img, { scale: 1.6, duration: 9, ease: "power1.in", onUpdate: wobble })   // the long, slow inflation
      .to(img, { scale: 1.74, duration: 0.55, ease: "power2.in", onUpdate: wobble }) // the last strain
      .addLabel("pop")
      .add(function () { burst(); })
      .to(img, { opacity: 0, scale: 1.95, duration: 0.08 })
      .to({}, { duration: 2 })                                                       // let the beads fly
      .set(img, { scale: 0.3, rotation: 0 })
      .to(img, { opacity: 1, scale: 0.5, duration: 0.9, ease: "back.out(2.2)" })     // a fresh balloon
      .to({}, { duration: 0.6 });

    img.addEventListener("click", function () { if (tl.time() < tl.labels.pop) tl.play("pop"); });

    if (ST) ST.create({ trigger: "#start", start: "top 85%", end: "bottom top", onToggle: function (self) { if (self.isActive) tl.play(); else tl.pause(); } });
    else tl.play();
    api.balloon = { timeline: tl, burst: burst };
  }

  // ───────────────────────── page choreography ─────────────────────────
  var mm = g.matchMedia();
  mm.add("(prefers-reduced-motion: no-preference)", function () {
    // opening sequence (every page): brand, headline words, lede, dock, rest
    var h1 = $("h1"), words = splitWords(h1);
    var intro = g.timeline({ defaults: { ease: "power3.out" } });
    intro.from(".brandline", { y: -12, opacity: 0, duration: 0.6 })
      .from(words, { yPercent: 115, rotate: 3, duration: 0.9, stagger: 0.07 }, "-=0.3")
      .from(".lede", { y: 22, opacity: 0, duration: 0.7 }, "-=0.5")
      .from("#dock", { y: 20, opacity: 0, duration: 0.6 }, "-=0.45")
      .from("#dock a", { y: 10, opacity: 0, duration: 0.45, stagger: 0.06 }, "-=0.4");

    if (page === "index") {
      intro.from(".cta .btn", { y: 16, opacity: 0, duration: 0.5, stagger: 0.1 }, "-=0.3")
        .from(".proof li", { x: -14, opacity: 0, duration: 0.45, stagger: 0.08 }, "-=0.3")
        .from(".hero .term", { x: 70, opacity: 0, duration: 1, ease: "power4.out" }, 0.35);
      var moon = $(".stage .moon");
      if (moon) {
        intro.from(moon, { scale: 0.7, opacity: 0, duration: 1.6, ease: "power2.out" }, 0.2);
        g.to(moon, { scale: 1.05, duration: 4.5, yoyo: true, repeat: -1, ease: "sine.inOut", delay: 2 });
      }
    } else {
      intro.from(".priv,.chips,.panel,.term", { y: 24, opacity: 0, duration: 0.6, stagger: 0.1 }, "-=0.3");
    }

    // spider lowers and rises on its thread
    var thread = $(".spider i");
    if (thread) g.fromTo(thread, { height: 36 }, { height: 210, duration: 4.5, ease: "sine.inOut", yoyo: true, repeat: -1, repeatDelay: 1.6 });

    if (page === "index") {
      // the tree (flipped) sways, and swings in when section 2 arrives
      var branch = $(".branch2");
      if (branch) g.fromTo(branch, { rotation: -2.6 }, { rotation: 2.6, duration: 3.2, yoyo: true, repeat: -1, ease: "sine.inOut" });

      if (ST) {
        var moon2 = $(".stage .moon");
        if (moon2) g.to(moon2, { y: 130, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: 0.6 } });

        $$("section h2, section .sub").forEach(function (el) {
          g.from(el, { y: 28, opacity: 0, duration: 0.8, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%", once: true } });
        });

        var rows = $$("dl.rituals dt, dl.rituals dd");
        if (rows.length) {
          g.set(rows, { opacity: 0, y: 24 });
          ST.batch(rows, { start: "top 90%", once: true, onEnter: function (b) { g.to(b, { opacity: 1, y: 0, stagger: 0.07, duration: 0.6, ease: "power3.out", overwrite: true }); } });
        }

        g.from(".yard .stone", { opacity: 0, duration: 0.7, stagger: 0.09, scrollTrigger: { trigger: ".yard", start: "top 80%", once: true } });
        g.from(".branch-wrap", { y: -90, opacity: 0, duration: 1.2, ease: "power3.out", scrollTrigger: { trigger: "#rituals", start: "top 75%", once: true } });
        g.from(".tree-scene .totem", { y: 70, opacity: 0, duration: 0.9, delay: 0.35, ease: "back.out(1.6)", scrollTrigger: { trigger: "#rituals", start: "top 75%", once: true } });
        g.to(".tree-scene", { y: -40, ease: "none", scrollTrigger: { trigger: "#rituals", start: "top bottom", end: "bottom top", scrub: true } });
        g.from("#install", { y: 30, opacity: 0, duration: 0.8, ease: "power3.out", scrollTrigger: { trigger: "#install", start: "top 90%", once: true } });
      }
      initBalloon();
    }
  });

  // dock indicator works whether or not motion is reduced (it is a hover affordance, not decoration)
  initDock();
  api.ready = true;
})();
