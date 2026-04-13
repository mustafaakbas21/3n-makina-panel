/**
 * 3N Makine — Giriş (sabit kimlik; yalnızca bu sayfa için)
 */
(function () {
  "use strict";

  var EXPECTED_USER = "hasanbasrielem";
  var EXPECTED_PASS = "123456789";

  document.addEventListener("DOMContentLoaded", function () {
    try {
      if (localStorage.getItem("isLoggedIn") === "true") {
        window.location.replace("./index.html");
        return;
      }
    } catch (e) {
      /* devam */
    }

    var form = document.getElementById("loginForm");
    var errEl = document.getElementById("loginError");
    if (!form || !errEl) return;

    var passInput = document.getElementById("loginPassword");
    var passToggle = document.getElementById("loginPasswordToggle");
    if (passInput && passToggle) {
      passToggle.addEventListener("click", function () {
        var visible = passInput.getAttribute("type") === "text";
        passInput.setAttribute("type", visible ? "password" : "text");
        passToggle.setAttribute("aria-pressed", visible ? "false" : "true");
        passToggle.setAttribute(
          "aria-label",
          visible ? "Şifreyi göster" : "Şifreyi gizle"
        );
        passToggle.setAttribute(
          "title",
          visible ? "Şifreyi göster" : "Şifreyi gizle"
        );
        var icon = passToggle.querySelector("i");
        if (icon) {
          icon.className = visible
            ? "fa-regular fa-eye"
            : "fa-regular fa-eye-slash";
        }
      });
    }

    function hideError() {
      errEl.hidden = true;
      errEl.textContent = "";
      errEl.setAttribute("aria-live", "polite");
    }

    function showError() {
      errEl.hidden = false;
      errEl.textContent = "Hatalı kullanıcı adı veya şifre!";
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      hideError();

      var emailEl = document.getElementById("loginEmail");
      var passEl = document.getElementById("loginPassword");
      var email = emailEl ? String(emailEl.value || "").trim() : "";
      var pass = passEl ? String(passEl.value || "") : "";

      if (email === EXPECTED_USER && pass === EXPECTED_PASS) {
        try {
          localStorage.setItem("isLoggedIn", "true");
          localStorage.setItem("3n_session_user", email);
        } catch (err) {
          showError();
          return;
        }
        window.location.href = "./index.html";
        return;
      }

      showError();
    });
  });
})();
