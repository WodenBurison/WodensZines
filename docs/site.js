
document.addEventListener("DOMContentLoaded", function () {
  var toggle = document.getElementById("navToggle");
  var sidebar = document.getElementById("sidebar");
  var overlay = document.getElementById("sidebarOverlay");
  function closeSidebar() {
    sidebar.classList.remove("sidebar-open");
    overlay.classList.remove("overlay-visible");
    toggle.setAttribute("aria-expanded", "false");
  }
  function openSidebar() {
    sidebar.classList.add("sidebar-open");
    overlay.classList.add("overlay-visible");
    toggle.setAttribute("aria-expanded", "true");
  }
  toggle.addEventListener("click", function () {
    if (sidebar.classList.contains("sidebar-open")) closeSidebar();
    else openSidebar();
  });
  overlay.addEventListener("click", closeSidebar);

  document.querySelectorAll(".nav-folder-toggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      btn.parentElement.classList.toggle("nav-open");
      btn.parentElement.classList.toggle("nav-collapsed");
    });
  });
});
