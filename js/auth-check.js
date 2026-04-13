/**
 * Oturum kilidi: giriş yapılmadan panel sayfalarına erişimi engeller.
 * login.html bu dosyayı yüklememelidir.
 */
(function () {
  "use strict";
  try {
    if (localStorage.getItem("isLoggedIn") !== "true") {
      window.location.replace("login.html");
    }
  } catch (e) {
    window.location.replace("login.html");
  }
})();
