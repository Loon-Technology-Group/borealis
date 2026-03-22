(function () {
  "use strict";

  // ── 1. Constants & Config ───────────────────────────────

  var KP_SEVERITY = [
    { min: 0, max: 2.9, label: "Quiet", cssVar: "--kp-quiet" },
    { min: 3, max: 3.9, label: "Unsettled", cssVar: "--kp-unsettled" },
    { min: 4, max: 4.9, label: "Minor Storm (G1)", cssVar: "--kp-minor" },
    { min: 5, max: 5.9, label: "Moderate Storm (G2)", cssVar: "--kp-moderate" },
    { min: 6, max: 6.9, label: "Strong Storm (G3)", cssVar: "--kp-strong" },
    { min: 7, max: 7.9, label: "Severe Storm (G4)", cssVar: "--kp-severe" },
    { min: 8, max: 9, label: "Extreme Storm (G5)", cssVar: "--kp-extreme" },
  ];

  var REFRESH_SECONDS = 60;

  function kpSeverity(val) {
    for (var i = KP_SEVERITY.length - 1; i >= 0; i--) {
      if (val >= KP_SEVERITY[i].min) return KP_SEVERITY[i];
    }
    return KP_SEVERITY[0];
  }

  function getCssVar(name) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
  }

  function tzInfo() {
    var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    var abbr = new Date()
      .toLocaleTimeString("en-US", { timeZoneName: "short" })
      .split(" ")
      .pop();
    return { tz: tz, abbr: abbr };
  }

  // ── 2. Theme Management ─────────────────────────────────

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("borealis-theme", theme);
    if (state.kpData) buildAllCharts();
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "dark" ? "light" : "dark");
  }

  function initTheme() {
    var saved = localStorage.getItem("borealis-theme") || "light";
    document.documentElement.setAttribute("data-theme", saved);
  }

  // ── 3. Data Fetching ────────────────────────────────────

  function fetchJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status + " " + r.statusText);
      return r.json();
    });
  }

  function fetchLatest() {
    return fetchJSON("/api/latest");
  }
  function fetchKp(w) {
    return fetchJSON("/api/kp?window=" + w);
  }
  function fetchBz(w) {
    return fetchJSON("/api/bz?window=" + w);
  }
  function fetchWind(w) {
    return fetchJSON("/api/wind?window=" + w);
  }

  function fetchAll(w) {
    return Promise.all([
      fetchLatest(),
      fetchKp(w),
      fetchBz(w),
      fetchWind(w),
    ]).then(function (results) {
      return {
        latest: results[0],
        kp: results[1],
        bz: results[2],
        wind: results[3],
      };
    });
  }

  // ── 4. Status Strip ─────────────────────────────────────

  function renderStatus(latest) {
    var kpBlock = document.getElementById("stat-kp");
    var bzBlock = document.getElementById("stat-bz");
    var windBlock = document.getElementById("stat-wind");

    if (latest.kp) {
      var kpVal = latest.kp.k_index;
      var sev = kpSeverity(kpVal);
      var color = getCssVar(sev.cssVar);
      kpBlock.querySelector(".stat-value").textContent = kpVal.toFixed(1);
      kpBlock.querySelector(".stat-value").style.color = color;
      kpBlock.querySelector(".stat-label").textContent = sev.label;
      kpBlock.querySelector(".stat-label").style.color = color;
    } else {
      kpBlock.querySelector(".stat-value").textContent = "\u2014";
      kpBlock.querySelector(".stat-value").style.color = "";
      kpBlock.querySelector(".stat-label").textContent = "KP Index";
      kpBlock.querySelector(".stat-label").style.color = "";
    }

    if (latest.bz) {
      var bzVal = latest.bz.bz_gsm;
      var dir = bzVal >= 0 ? "Northward" : "Southward";
      var arrow = bzVal >= 0 ? "\u2191" : "\u2193";
      var bzColor =
        bzVal >= 0 ? getCssVar("--aurora-teal") : getCssVar("--aurora-purple");
      bzBlock.querySelector(".stat-value").textContent =
        bzVal.toFixed(1) + " nT " + arrow;
      bzBlock.querySelector(".stat-value").style.color = bzColor;
      bzBlock.querySelector(".stat-label").textContent = dir;
      bzBlock.querySelector(".stat-label").style.color = bzColor;
      bzBlock.classList.toggle("stat-bz-southward", bzVal < 0);
    } else {
      bzBlock.querySelector(".stat-value").textContent = "\u2014";
      bzBlock.querySelector(".stat-value").style.color = "";
      bzBlock.querySelector(".stat-label").textContent = "Bz";
      bzBlock.querySelector(".stat-label").style.color = "";
      bzBlock.classList.remove("stat-bz-southward");
    }

    if (latest.wind) {
      var windColor = getCssVar("--aurora-green");
      windBlock.querySelector(".stat-value").textContent =
        latest.wind.speed.toFixed(0) +
        " km/s  " +
        latest.wind.density.toFixed(1) +
        " p/cm\u00B3";
      windBlock.querySelector(".stat-value").style.color = windColor;
      windBlock.querySelector(".stat-label").textContent = "Solar Wind";
      windBlock.querySelector(".stat-label").style.color = windColor;
    } else {
      windBlock.querySelector(".stat-value").textContent = "\u2014";
      windBlock.querySelector(".stat-value").style.color = "";
      windBlock.querySelector(".stat-label").textContent = "Solar Wind";
      windBlock.querySelector(".stat-label").style.color = "";
    }
  }

  // ── 5. Chart Construction ───────────────────────────────

  var state = {
    window: "6h",
    kpData: null,
    bzData: null,
    windData: null,
    charts: { kp: null, bz: null, wind: null },
    countdown: REFRESH_SECONDS,
    intervalId: null,
    paused: false,
  };

  function toUplotData(rows, fields) {
    var xs = new Array(rows.length);
    var series = fields.map(function () {
      return new Array(rows.length);
    });
    for (var i = 0; i < rows.length; i++) {
      xs[i] = new Date(rows[i].time_tag).getTime() / 1000;
      for (var f = 0; f < fields.length; f++) {
        series[f][i] = rows[i][fields[f]];
      }
    }
    return [xs].concat(series);
  }

  function timeAxisValues() {
    var w = state.window;
    return function (self, ticks) {
      return ticks.map(function (ts) {
        var d = new Date(ts * 1000);
        if (w === "7d") {
          return (
            (d.getMonth() + 1).toString().padStart(2, "0") +
            "-" +
            d.getDate().toString().padStart(2, "0") +
            " " +
            d.getHours().toString().padStart(2, "0") +
            ":" +
            d.getMinutes().toString().padStart(2, "0")
          );
        }
        return (
          d.getHours().toString().padStart(2, "0") +
          ":" +
          d.getMinutes().toString().padStart(2, "0")
        );
      });
    };
  }

  function calcSizes() {
    var kpEl = document.getElementById("chart-kp-container");
    var bzEl = document.getElementById("chart-bz-container");
    var windEl = document.getElementById("chart-wind-container");
    return {
      kp: { width: kpEl.clientWidth, height: kpEl.clientHeight },
      bz: { width: bzEl.clientWidth, height: bzEl.clientHeight },
      wind: { width: windEl.clientWidth, height: windEl.clientHeight },
    };
  }

  function kpBarColor(val) {
    return getCssVar(kpSeverity(val).cssVar);
  }

  function buildKpChart(container, data, size) {
    var udata = toUplotData(data, ["k_index"]);

    var opts = {
      width: size.width,
      height: size.height,
      cursor: { show: true },
      scales: {
        y: { range: [0, 8] },
      },
      axes: [
        {
          stroke: getCssVar("--chart-axis"),
          grid: { stroke: getCssVar("--chart-grid"), width: 1 },
          values: timeAxisValues(),
        },
        {
          stroke: getCssVar("--chart-axis"),
          grid: { stroke: getCssVar("--chart-grid"), width: 1 },
          values: function (self, ticks) {
            return ticks.map(function (v) {
              return v.toFixed(0);
            });
          },
        },
      ],
      series: [
        {},
        {
          label: "KP",
          stroke: getCssVar("--aurora-green"),
          fill: getCssVar("--aurora-green") + "40",
          width: 0,
          paths: uPlot.paths.bars({ size: [0.7, 100] }),
        },
      ],
      hooks: {
        draw: [
          function (u) {
            var ctx = u.ctx;
            var levels = [
              { y: 3, label: "Unsettled", color: getCssVar("--kp-unsettled") },
              { y: 5, label: "G1", color: getCssVar("--kp-minor") },
              { y: 7, label: "G4", color: getCssVar("--kp-severe") },
            ];
            ctx.save();
            for (var i = 0; i < levels.length; i++) {
              var py = u.valToPos(levels[i].y, "y", true);
              ctx.strokeStyle = levels[i].color + "60";
              ctx.setLineDash([4, 4]);
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(u.bbox.left, py);
              ctx.lineTo(u.bbox.left + u.bbox.width, py);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = levels[i].color + "80";
              ctx.font = "10px sans-serif";
              ctx.fillText(levels[i].label, u.bbox.left + 4, py - 3);
            }
            ctx.restore();
          },
        ],
        drawSeries: [
          function (u, si) {
            if (si !== 1) return;
            var ctx = u.ctx;
            var data0 = u.data[0];
            var data1 = u.data[1];
            if (!data1 || data1.length === 0) return;

            ctx.save();
            var barWid = Math.max(
              1,
              Math.round((u.bbox.width / data0.length) * 0.7),
            );
            for (var i = 0; i < data0.length; i++) {
              if (data1[i] == null) continue;
              var x = u.valToPos(data0[i], "x", true);
              var y0 = u.valToPos(0, "y", true);
              var y1 = u.valToPos(data1[i], "y", true);
              var color = kpBarColor(data1[i]);
              ctx.fillStyle = color + "b0";
              ctx.fillRect(x - barWid / 2, y1, barWid, y0 - y1);
            }
            ctx.restore();
          },
        ],
      },
    };

    var el = document.getElementById(container);
    el.innerHTML = "";
    return new uPlot(opts, udata, el);
  }

  function buildBzChart(container, data, size) {
    var udata = toUplotData(data, ["bz_gsm"]);

    var opts = {
      width: size.width,
      height: size.height,
      cursor: { show: true },
      axes: [
        {
          stroke: getCssVar("--chart-axis"),
          grid: { stroke: getCssVar("--chart-grid"), width: 1 },
          values: timeAxisValues(),
        },
        {
          stroke: getCssVar("--chart-axis"),
          grid: { stroke: getCssVar("--chart-grid"), width: 1 },
        },
      ],
      series: [
        {},
        {
          label: "Bz (nT)",
          stroke: getCssVar("--aurora-teal"),
          fill: getCssVar("--aurora-teal") + "20",
          width: 1.5,
        },
      ],
      hooks: {
        draw: [
          function (u) {
            var ctx = u.ctx;
            var py = u.valToPos(0, "y", true);
            if (py >= u.bbox.top && py <= u.bbox.top + u.bbox.height) {
              ctx.save();
              ctx.strokeStyle = getCssVar("--chart-axis") + "80";
              ctx.setLineDash([4, 4]);
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(u.bbox.left, py);
              ctx.lineTo(u.bbox.left + u.bbox.width, py);
              ctx.stroke();
              ctx.restore();
            }
          },
        ],
      },
    };

    var el = document.getElementById(container);
    el.innerHTML = "";
    return new uPlot(opts, udata, el);
  }

  function buildWindChart(container, data, size) {
    var udata = toUplotData(data, ["speed", "density"]);

    var opts = {
      width: size.width,
      height: size.height,
      cursor: { show: true },
      axes: [
        {
          stroke: getCssVar("--chart-axis"),
          grid: { stroke: getCssVar("--chart-grid"), width: 1 },
          values: timeAxisValues(),
        },
        {
          stroke: getCssVar("--aurora-green"),
          grid: { stroke: getCssVar("--chart-grid"), width: 1 },
          label: "km/s",
          scale: "speed",
        },
        {
          stroke: getCssVar("--aurora-yellow"),
          side: 1,
          grid: { show: false },
          label: "p/cm\u00B3",
          scale: "density",
        },
      ],
      series: [
        {},
        {
          label: "Speed (km/s)",
          stroke: getCssVar("--aurora-green"),
          width: 1.5,
          scale: "speed",
        },
        {
          label: "Density (p/cm\u00B3)",
          stroke: getCssVar("--aurora-yellow"),
          width: 1.5,
          scale: "density",
        },
      ],
      scales: {
        speed: { auto: true },
        density: { auto: true },
      },
    };

    var el = document.getElementById(container);
    el.innerHTML = "";
    return new uPlot(opts, udata, el);
  }

  // ── 6. Chart Building & Updating ───────────────────────

  function destroyCharts() {
    ["kp", "bz", "wind"].forEach(function (key) {
      if (state.charts[key]) {
        state.charts[key].destroy();
        state.charts[key] = null;
      }
    });
  }

  // Full destroy + rebuild (used on first load and theme toggle)
  function buildAllCharts() {
    destroyCharts();
    var sizes = calcSizes();

    if (state.kpData && state.kpData.length > 0) {
      state.charts.kp = buildKpChart(
        "chart-kp-container",
        state.kpData,
        sizes.kp,
      );
    } else {
      showChartError(
        "chart-kp-container",
        state.kpData ? "No data for selected window" : "Unable to load data",
      );
    }
    if (state.bzData && state.bzData.length > 0) {
      state.charts.bz = buildBzChart(
        "chart-bz-container",
        state.bzData,
        sizes.bz,
      );
    } else {
      showChartError(
        "chart-bz-container",
        state.bzData ? "No data for selected window" : "Unable to load data",
      );
    }
    if (state.windData && state.windData.length > 0) {
      state.charts.wind = buildWindChart(
        "chart-wind-container",
        state.windData,
        sizes.wind,
      );
    } else {
      showChartError(
        "chart-wind-container",
        state.windData ? "No data for selected window" : "Unable to load data",
      );
    }
  }

  // Update data in-place without rebuilding (used on window change + auto-refresh)
  function updateChartData() {
    if (state.charts.kp && state.kpData && state.kpData.length > 0) {
      state.charts.kp.setData(toUplotData(state.kpData, ["k_index"]));
    }
    if (state.charts.bz && state.bzData && state.bzData.length > 0) {
      state.charts.bz.setData(toUplotData(state.bzData, ["bz_gsm"]));
    }
    if (state.charts.wind && state.windData && state.windData.length > 0) {
      state.charts.wind.setData(
        toUplotData(state.windData, ["speed", "density"]),
      );
    }
  }

  function showChartError(containerId, msg) {
    var el = document.getElementById(containerId);
    el.innerHTML = '<div class="chart-error">' + msg + "</div>";
  }

  // ── 7. Window Selector ─────────────────────────────────

  function setWindow(w) {
    state.window = w;
    document
      .querySelectorAll(".window-selector button")
      .forEach(function (btn) {
        btn.classList.toggle("active", btn.getAttribute("data-window") === w);
      });
    Promise.all([fetchKp(w), fetchBz(w), fetchWind(w)])
      .then(function (results) {
        state.kpData = results[0];
        state.bzData = results[1];
        state.windData = results[2];
        updateChartData();
      })
      .catch(function (err) {
        console.error("Failed to fetch chart data:", err);
      });
  }

  // ── 8. Auto-Refresh ────────────────────────────────────

  var countdownEl, toggleEl;

  function updateCountdownDisplay() {
    if (state.paused) {
      countdownEl.textContent = "";
      toggleEl.textContent = "\u25B6";
    } else {
      countdownEl.textContent = "\u27F3 " + state.countdown + "s";
      toggleEl.textContent = "\u23F8";
    }
  }

  function tickCountdown() {
    state.countdown--;
    if (state.countdown <= 0) {
      refreshData();
      state.countdown = REFRESH_SECONDS;
    }
    updateCountdownDisplay();
  }

  function startCountdown() {
    state.countdown = REFRESH_SECONDS;
    state.intervalId = setInterval(tickCountdown, 1000);
    updateCountdownDisplay();
  }

  function pauseCountdown() {
    state.paused = true;
    if (state.intervalId) {
      clearInterval(state.intervalId);
      state.intervalId = null;
    }
    localStorage.setItem("borealis-autorefresh", "false");
    updateCountdownDisplay();
  }

  function resumeCountdown() {
    state.paused = false;
    state.countdown = REFRESH_SECONDS;
    startCountdown();
    localStorage.setItem("borealis-autorefresh", "true");
  }

  function toggleRefresh() {
    if (state.paused) {
      resumeCountdown();
    } else {
      pauseCountdown();
    }
  }

  function refreshData() {
    fetchAll(state.window)
      .then(function (data) {
        renderStatus(data.latest);
        state.kpData = data.kp;
        state.bzData = data.bz;
        state.windData = data.wind;
        updateChartData();
      })
      .catch(function (err) {
        console.error("Auto-refresh failed:", err);
      });
  }

  // ── 10. ResizeObserver ─────────────────────────────────

  function setupResizeObservers() {
    var lastWidth = 0;
    var grid = document.querySelector(".chart-grid");
    new ResizeObserver(function () {
      var w = grid.clientWidth;
      if (w === lastWidth) return;
      lastWidth = w;
      if (state.kpData) buildAllCharts();
    }).observe(grid);
  }

  // ── 11. Init ───────────────────────────────────────────

  function init() {
    initTheme();

    countdownEl = document.querySelector(".refresh-countdown");
    toggleEl = document.querySelector(".refresh-toggle");

    document
      .querySelector(".theme-toggle")
      .addEventListener("click", toggleTheme);
    toggleEl.addEventListener("click", toggleRefresh);

    document
      .querySelectorAll(".window-selector button")
      .forEach(function (btn) {
        btn.addEventListener("click", function () {
          setWindow(btn.getAttribute("data-window"));
        });
      });

    fetchAll(state.window)
      .then(function (data) {
        renderStatus(data.latest);
        state.kpData = data.kp;
        state.bzData = data.bz;
        state.windData = data.wind;
        buildAllCharts();
        setupResizeObservers();
      })
      .catch(function (err) {
        console.error("Initial data load failed:", err);
        showChartError("chart-kp-container", "Unable to load data");
        showChartError("chart-bz-container", "Unable to load data");
        showChartError("chart-wind-container", "Unable to load data");
      });

    var savedRefresh = localStorage.getItem("borealis-autorefresh");
    if (savedRefresh === "false") {
      state.paused = true;
      updateCountdownDisplay();
    } else {
      startCountdown();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
