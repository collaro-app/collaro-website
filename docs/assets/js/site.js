/*
 * Collaro website — the only JavaScript on the site. Everything here is
 * progressive enhancement: the pages read and navigate fine without it.
 *
 *  1. Mobile navigation toggle (accessible disclosure: aria-expanded, Escape closes).
 *  2. Header bottom border once the page is scrolled.
 *  3. Reveal-on-scroll for `.reveal` blocks (respects prefers-reduced-motion via CSS).
 */
(function () {
  "use strict";

  var header = document.querySelector(".site-header");
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");

  // 1. Mobile navigation
  if (header && toggle && nav) {
    var setOpen = function (open) {
      header.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    };

    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) setOpen(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && header.classList.contains("is-open")) {
        setOpen(false);
        toggle.focus();
      }
    });

    document.addEventListener("click", function (event) {
      if (header.classList.contains("is-open") && !header.contains(event.target)) setOpen(false);
    });

    // Tabbing out of the open panel must not leave it covering the newly focused element.
    header.addEventListener("focusout", function (event) {
      if (header.classList.contains("is-open") && !header.contains(event.relatedTarget)) setOpen(false);
    });
  }

  // 2. Scrolled header
  if (header) {
    var onScroll = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // 3. Reveal on scroll
  var revealables = document.querySelectorAll(".reveal");
  if (revealables.length) {
    var revealAll = function () {
      revealables.forEach(function (el) {
        el.classList.add("is-visible");
      });
    };

    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              observer.unobserve(entry.target);
            }
          });
        },
        { rootMargin: "0px 0px -10% 0px", threshold: 0.1 }
      );
      revealables.forEach(function (el) {
        observer.observe(el);
      });
      // Safety net: content must never stay hidden if the observer never fires
      // (some embedded browsers, print, automated capture).
      window.setTimeout(revealAll, 2500);
    } else {
      revealAll();
    }
  }
})();
